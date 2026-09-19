from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from starlette.middleware.gzip import GZipMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

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
    DataSource,
    DataSourceCreate,
    DataSourceFileCreate,
    DataSourceUpdate,
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
        for queue in list(_subscribers):
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                queue.put_nowait(None)
            except asyncio.QueueFull:
                pass
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


_subscribers: set[asyncio.Queue[MonitorSnapshot | None]] = set()


async def _stream() -> None:
    while True:
        STATE.tick_live()
        snap = STATE.monitor()
        for queue in list(_subscribers):
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                queue.put_nowait(snap)
            except asyncio.QueueFull:
                pass
        await asyncio.sleep(TICK_SECONDS)


def _sse_snapshot(snap: MonitorSnapshot) -> str:
    return f"event: snapshot\ndata: {snap.model_dump_json()}\n\n"


class _SkipStreamGZip:
    """Gzip JSON, but never event streams (gzip buffers and breaks SSE)."""

    def __init__(self, app: ASGIApp, minimum_size: int = 500) -> None:
        self.app = app
        self.gzip = GZipMiddleware(app, minimum_size=minimum_size)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope.get("path") == "/monitor/stream":
            await self.app(scope, receive, send)
            return
        await self.gzip(scope, receive, send)


app = FastAPI(title="Trustworthy process monitor — compute plane", lifespan=lifespan)
app.add_middleware(_SkipStreamGZip, minimum_size=500)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    tick = STATE.source.tick if STATE.source is not None else 0
    return HealthResponse(
        status="ok",
        stream_tick=tick,
        live_rows=tick,
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


@app.get("/data-sources", response_model=list[DataSource])
def data_sources_list() -> list[DataSource]:
    return STATE.list_data_sources()


@app.post("/data-sources", response_model=DataSource)
def data_sources_create(body: DataSourceCreate) -> DataSource:
    try:
        return STATE.add_data_source(body)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/data-sources/api", response_model=DataSource)
def data_sources_api(body: DataSourceCreate) -> DataSource:
    try:
        return STATE.add_api_source(body.api_url)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/data-sources/file", response_model=DataSource)
def data_sources_file(body: DataSourceFileCreate) -> DataSource:
    if not body.path.strip():
        raise HTTPException(400, "file path is required")
    try:
        return STATE.add_file_source(body.path)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.put("/data-sources/{source_id}", response_model=DataSource)
def data_sources_update(source_id: str, body: DataSourceUpdate) -> DataSource:
    try:
        return STATE.patch_data_source(source_id, body)
    except KeyError as exc:
        raise HTTPException(404, "unknown data source") from exc


@app.delete("/data-sources/{source_id}")
def data_sources_delete(source_id: str) -> dict:
    try:
        STATE.remove_data_source(source_id)
    except KeyError as exc:
        raise HTTPException(404, "unknown data source") from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True}


@app.post("/calibrate", response_model=CalibrateResponse)
def calibrate(body: CalibrateRequest | None = None) -> CalibrateResponse:
    if body and body.dataset_id:
        STATE.update_config(ConfigUpdate(dataset_id=body.dataset_id))
        return CalibrateResponse(
            calibration_id=STATE.calibration_id or "",
            dataset_id=STATE.dataset_id,
            n_fields=len(STATE.schema.numeric_cols) if STATE.schema else 0,
            n_rows_used=0,
            baseline_established=STATE.model is not None,
            evidence="recalibrated after data source switch",
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


@app.get("/monitor/stream")
async def monitor_stream() -> StreamingResponse:
    async def events():
        queue: asyncio.Queue[MonitorSnapshot | None] = asyncio.Queue(maxsize=1)
        _subscribers.add(queue)
        try:
            yield _sse_snapshot(STATE.monitor())
            while True:
                try:
                    snap = await asyncio.wait_for(queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                if snap is None:
                    break
                yield _sse_snapshot(snap)
        finally:
            _subscribers.discard(queue)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


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
