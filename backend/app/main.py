from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.config import TICK_SECONDS
from app.models.schemas import (
    CalibrateRequest,
    CalibrateResponse,
    ChatCreateRequest,
    ChatDetail,
    ChatSaveRequest,
    ChatSummary,
    CompileRuleRequest,
    CompileRuleResponse,
    ConfigUpdate,
    CorrelationArtifact,
    DecisionAppend,
    DecisionLogPage,
    DriftArtifact,
    DriftScoreRequest,
    HealthResponse,
    MonitorSnapshot,
    ProfileArtifact,
    QualityCheckRequest,
    QualityReport,
    RankingArtifact,
    RolesArtifact,
    RuntimeConfig,
)
from app.state import STATE


@asynccontextmanager
async def lifespan(_app: FastAPI):
    STATE.boot()
    task = asyncio.create_task(_stream())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


async def _stream() -> None:
    while True:
        STATE.tick_live()
        await asyncio.sleep(TICK_SECONDS)


app = FastAPI(title="Trustworthy process monitor — compute plane", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        stream_tick=STATE.source.tick,
        live_rows=len(STATE.source.live),
    )


@app.get("/config", response_model=RuntimeConfig)
def get_config() -> RuntimeConfig:
    return STATE.runtime_config()


@app.post("/config", response_model=RuntimeConfig)
def post_config(body: ConfigUpdate) -> RuntimeConfig:
    try:
        return STATE.update_config(body)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/calibrate", response_model=CalibrateResponse)
def calibrate(body: CalibrateRequest | None = None) -> CalibrateResponse:
    if body and body.dataset_id:
        STATE.update_config(ConfigUpdate(dataset_id=body.dataset_id))
        return CalibrateResponse(
            calibration_id=STATE.calibration_id or "",
            dataset_id=STATE.dataset_id,
            n_sensors=len(STATE.schema.numeric_cols) if STATE.schema else 0,
            n_rows_used=0,
            baseline_established=STATE.model is not None,
            evidence="recalibrated after dataset switch",
        )
    return STATE.calibrate()


@app.get("/profile/{calibration_id}", response_model=ProfileArtifact)
def profile(calibration_id: str) -> ProfileArtifact:
    if not STATE.profile or STATE.calibration_id != calibration_id:
        raise HTTPException(404, "unknown calibration")
    return STATE.profile


@app.get("/correlations/{calibration_id}", response_model=CorrelationArtifact)
def correlations(calibration_id: str) -> CorrelationArtifact:
    if not STATE.corr or STATE.calibration_id != calibration_id:
        raise HTTPException(404, "unknown calibration")
    return STATE.corr


@app.get("/structural-roles/{calibration_id}", response_model=RolesArtifact)
def roles(calibration_id: str) -> RolesArtifact:
    if not STATE.roles or STATE.calibration_id != calibration_id:
        raise HTTPException(404, "unknown calibration")
    return STATE.roles


@app.post("/rules/compile", response_model=CompileRuleResponse)
def rules_compile(body: CompileRuleRequest) -> CompileRuleResponse:
    return STATE.add_rule(body.rule)


@app.post("/quality-check", response_model=QualityReport)
def quality_check(_body: QualityCheckRequest) -> QualityReport:
    try:
        return STATE.quality_check()
    except RuntimeError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/drift/score", response_model=DriftArtifact)
def drift_score(body: DriftScoreRequest) -> DriftArtifact:
    try:
        return STATE.drift_score(body.exclusion_list or None)
    except RuntimeError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/diagnosis/ranking/{event_id}", response_model=RankingArtifact)
def ranking(event_id: str) -> RankingArtifact:
    try:
        return STATE.ranking(event_id)
    except KeyError as exc:
        raise HTTPException(404, "unknown event") from exc


@app.get("/events")
def events() -> dict:
    items = []
    for ev in reversed(list(STATE.events.values())):
        items.append(
            {
                **ev.model_dump(),
                "confirmed": ev.event_id in STATE.confirmed,
                "override": STATE.overrides.get(ev.event_id),
                "ranking": STATE.rankings[ev.event_id].model_dump()
                if ev.event_id in STATE.rankings
                else None,
            }
        )
    return {"events": items[:20], "evidence": "flagged T2 events vs frozen baseline"}


@app.get("/monitor/snapshot", response_model=MonitorSnapshot)
def monitor() -> MonitorSnapshot:
    return STATE.monitor()


@app.post("/decision-log/append")
def log_append(body: DecisionAppend):
    return STATE.log(body)


@app.get("/decision-log", response_model=DecisionLogPage)
def log_get(
    type: str | None = Query(default=None),
    human_overridden: bool = False,
) -> DecisionLogPage:
    entries, total = STATE.store.page(type, human_overridden)
    return DecisionLogPage(entries=entries, total=total)


@app.get("/chats", response_model=list[ChatSummary])
def chats_list() -> list[ChatSummary]:
    return [ChatSummary(**row) for row in STATE.store.list_chats()]


@app.post("/chats", response_model=ChatDetail)
def chats_create(body: ChatCreateRequest | None = None) -> ChatDetail:
    row = STATE.store.create_chat((body.title if body else "New chat"))
    return ChatDetail(**row)


@app.get("/chats/{chat_id}", response_model=ChatDetail)
def chats_get(chat_id: str) -> ChatDetail:
    row = STATE.store.get_chat(chat_id)
    if row is None:
        raise HTTPException(404, "unknown chat")
    return ChatDetail(**row)


@app.put("/chats/{chat_id}/messages", response_model=ChatSummary)
def chats_save(chat_id: str, body: ChatSaveRequest) -> ChatSummary:
    row = STATE.store.save_chat_messages(
        chat_id,
        [m.model_dump() for m in body.messages],
    )
    if row is None:
        raise HTTPException(404, "unknown chat")
    return ChatSummary(**row)


@app.delete("/chats/{chat_id}")
def chats_delete(chat_id: str) -> dict:
    if not STATE.store.delete_chat(chat_id):
        raise HTTPException(404, "unknown chat")
    return {"ok": True}
