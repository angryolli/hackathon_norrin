from __future__ import annotations

import uuid
from dataclasses import dataclass, field

import pandas as pd

from app.config import DATASETS, SPARKLINE_POINTS, default_dataset
from app.correlation.correlation_engine import correlate
from app.diagnosis.contribution_ranking import rank_event
from app.drift.calibration import DriftModel, fit_drift_model
from app.drift.detector import score_batch
from app.ingestion.fake_stream import RollingSource
from app.ingestion.labels import fault_free_segment
from app.ingestion.loader import DetectedSchema, load_csv, process_frame
from app.models.schemas import (
    CalibrateResponse,
    Chip,
    CompileRuleResponse,
    ConfigUpdate,
    CorrelationArtifact,
    DecisionAppend,
    DecisionEntry,
    DriftArtifact,
    DriftEvent,
    MonitorSnapshot,
    ProfileArtifact,
    QualityReport,
    RankingArtifact,
    RolesArtifact,
    RuleSchema,
    RuntimeConfig,
    SensorCard,
)
from app.profiling.statistical_profiler import profile_frame
from app.profiling.structural_classifier import classify_roles
from app.quality.baseline_checks import run_quality
from app.quality.rule_compiler import compile_rule
from app.storage.artifact_store import ArtifactStore


@dataclass
class AppState:
    source: RollingSource = field(default_factory=RollingSource)
    store: ArtifactStore = field(default_factory=ArtifactStore)
    dataset_id: str = field(default_factory=default_dataset)
    no_egress: bool = False
    llm_backend: str = "unknown"
    llm_model: str = "unknown"
    calibration_id: str | None = None
    schema: DetectedSchema | None = None
    profile: ProfileArtifact | None = None
    corr: CorrelationArtifact | None = None
    roles: RolesArtifact | None = None
    model: DriftModel | None = None
    quality: QualityReport | None = None
    drift: DriftArtifact | None = None
    events: dict[str, DriftEvent] = field(default_factory=dict)
    rankings: dict[str, RankingArtifact] = field(default_factory=dict)
    rules: list[tuple[str, RuleSchema]] = field(default_factory=list)
    t2_history: list[float] = field(default_factory=list)
    event_seq: int = 1
    confirmed: set[str] = field(default_factory=set)
    overrides: dict[str, dict] = field(default_factory=dict)

    def boot(self) -> None:
        current = self.dataset_id
        for ds in DATASETS:
            self.source.reset(ds)
            self.source.seed_calibration_csv()
        self.source.reset(current)
        self.calibrate()

    def runtime_config(self) -> RuntimeConfig:
        return RuntimeConfig(
            dataset_id=self.dataset_id,
            datasets=list(DATASETS.keys()),
            calibration_id=self.calibration_id,
            baseline_established=self.model is not None,
            no_egress=self.no_egress,
            llm_backend=self.llm_backend,
            llm_model=self.llm_model,
        )

    def update_config(self, body: ConfigUpdate) -> RuntimeConfig:
        if body.no_egress is not None:
            self.no_egress = body.no_egress
        if body.llm_backend is not None:
            self.llm_backend = body.llm_backend
        if body.llm_model is not None:
            self.llm_model = body.llm_model
        if body.dataset_id and body.dataset_id != self.dataset_id:
            if body.dataset_id not in DATASETS:
                raise ValueError(f"unknown dataset {body.dataset_id}")
            self.dataset_id = body.dataset_id
            self.events.clear()
            self.rankings.clear()
            self.rules.clear()
            self.t2_history.clear()
            self.confirmed.clear()
            self.overrides.clear()
            self.source.reset(self.dataset_id)
            self.source.seed_calibration_csv()
            self.calibrate()
        return self.runtime_config()

    def calibrate(self) -> CalibrateResponse:
        spec = DATASETS[self.dataset_id]
        raw = load_csv(spec["train_path"])
        frame, schema = process_frame(raw)
        frame = fault_free_segment(frame, schema.label_cols)
        live_cols = [c for c in schema.numeric_cols]
        if not live_cols:
            raise ValueError("no numeric columns after schema detection")
        calibration_id = f"cal_{uuid.uuid4().hex[:10]}"
        profile = profile_frame(frame, schema, calibration_id)
        corr = correlate(frame, schema, calibration_id)
        roles = classify_roles(profile, corr)
        model = fit_drift_model(frame, schema)
        self.calibration_id = calibration_id
        self.schema = schema
        self.profile = profile
        self.corr = corr
        self.roles = roles
        self.model = model
        self.store.put("profile", calibration_id, profile)
        self.store.put("corr", calibration_id, corr)
        self.store.put("roles", calibration_id, roles)
        self.store.put(
            "calibration",
            calibration_id,
            {
                "dataset_id": self.dataset_id,
                "n_sensors": len(schema.numeric_cols),
                "n_rows_used": len(frame),
                "label_cols": schema.label_cols,
            },
        )
        return CalibrateResponse(
            calibration_id=calibration_id,
            dataset_id=self.dataset_id,
            n_sensors=len(schema.numeric_cols),
            n_rows_used=len(frame),
            baseline_established=True,
            evidence=f"fault-free rows={len(frame)} labels={schema.label_cols}",
        )

    def require_cal(self) -> str:
        if not self.calibration_id or self.schema is None or self.profile is None:
            raise RuntimeError("not calibrated")
        return self.calibration_id

    def quality_check(self) -> QualityReport:
        cal = self.require_cal()
        batch = self.source.latest_batch(48)
        if batch.empty:
            batch = self.source.generate_frame(40, start=0, fault_free=False)
        assert self.schema and self.profile
        report = run_quality(
            batch,
            self.schema,
            self.profile,
            cal,
            batch_id=f"b_{self.source.tick}",
            custom=self.rules,
        )
        self.quality = report
        self.store.put("quality", cal, report)
        return report

    def drift_score(self, exclusion: list[str] | None = None) -> DriftArtifact:
        cal = self.require_cal()
        if self.model is None or self.corr is None:
            raise RuntimeError("drift model missing")
        excl = exclusion if exclusion is not None else (self.quality.exclusion_list if self.quality else [])
        batch = self.source.latest_batch(48)
        if batch.empty:
            batch = self.source.generate_frame(40, start=0, fault_free=False)
        artifact = score_batch(
            batch,
            self.model,
            cal,
            batch_id=f"b_{self.source.tick}",
            tick=self.source.tick,
            exclusion=excl,
            next_event_index=self.event_seq,
        )
        prev_id = self.drift.latest_event_id if self.drift else None
        prev_flagged = bool(self.drift and self.drift.events)
        self.drift = artifact
        self.t2_history = (self.t2_history + artifact.series)[-60:]
        for ev in artifact.events:
            if prev_flagged and prev_id:
                ev.event_id = prev_id
                artifact.latest_event_id = prev_id
                self.events[prev_id] = ev
                ranking = rank_event(ev, self.corr, cal)
                self.rankings[prev_id] = ranking
                self.store.put("event", prev_id, ev)
                self.store.put("ranking", prev_id, ranking)
            elif ev.event_id not in self.events:
                self.event_seq += 1
                self.events[ev.event_id] = ev
                ranking = rank_event(ev, self.corr, cal)
                self.rankings[ev.event_id] = ranking
                self.store.put("event", ev.event_id, ev)
                self.store.put("ranking", ev.event_id, ranking)
                self.store.append(
                    DecisionAppend(
                        type="flag",
                        payload={"event_id": ev.event_id, "t2": ev.t2},
                        evidence_ref=ev.evidence,
                    )
                )
        self.store.put("drift", cal, artifact)
        return artifact

    def tick_live(self) -> None:
        self.source.emit()
        if self.model is None:
            return
        if self.source.tick % 2 != 0:
            return
        try:
            self.quality_check()
            self.drift_score()
        except Exception:
            return

    def monitor(self) -> MonitorSnapshot:
        cal = self.calibration_id
        live = self.source.live_frame()
        excl = set(self.quality.exclusion_list if self.quality else [])
        contrib_map: dict[str, float] = {}
        if self.drift and self.drift.events:
            for c in self.drift.events[-1].contributions:
                contrib_map[c.sensor_id] = c.contribution_score
        peak = max(contrib_map.values()) if contrib_map else 0.0
        cal_frozen = {
            p.sensor_id: p.frozen_rate for p in (self.profile.sensors if self.profile else [])
        }
        cards: list[SensorCard] = []
        cols = self.schema.numeric_cols if self.schema else []
        for col in cols:
            spark: list[float] = []
            status: Chip = "normal"
            evidence = "within frozen baseline"
            if not live.empty and col in live:
                s = pd.to_numeric(live[col], errors="coerce").dropna()
                spark = [float(v) for v in s.tail(SPARKLINE_POINTS).tolist()]
                if len(spark) > 5:
                    deltas = [abs(spark[i] - spark[i - 1]) for i in range(1, len(spark))]
                    frozen_frac = sum(d < 1e-9 for d in deltas) / len(deltas)
                    if frozen_frac > 0.85 and cal_frozen.get(col, 0) < 0.4:
                        status = "stuck"
                        evidence = "near-zero rolling delta in live window"
            if col in excl:
                status = "excluded"
                evidence = "excluded — sensor/data fault from quality-check"
            elif status != "stuck" and peak > 0 and contrib_map.get(col, 0) > 0.4 * peak:
                status = "drifting"
                evidence = f"contribution={contrib_map[col]:.3f} on latest T2 event"
            cards.append(
                SensorCard(
                    sensor_id=col,
                    sparkline=spark,
                    status=status,
                    contribution=float(contrib_map.get(col, 0)),
                    evidence=evidence,
                )
            )
        cards.sort(
            key=lambda c: (
                int("".join(ch for ch in c.sensor_id if ch.isdigit()) or "999999"),
                c.sensor_id,
            )
        )
        try:
            return MonitorSnapshot(
                calibration_id=cal,
                dataset_id=self.dataset_id,
                tick=self.source.tick,
                t2_series=self.t2_history[-60:],
                control_limit=self.model.t2_limit if self.model else 0.0,
                live_boundary=0,
                sensors=cards[:40],
                exclusion_list=list(excl)[:20],
                latest_event_id=self.drift.latest_event_id if self.drift else None,
            )
        except ValueError:
            slim = [
                SensorCard(
                    sensor_id=c.sensor_id,
                    sparkline=c.sparkline[-12:],
                    status=c.status,
                    contribution=c.contribution,
                    evidence=c.evidence[:80],
                )
                for c in cards[:12]
            ]
            return MonitorSnapshot(
                calibration_id=cal,
                dataset_id=self.dataset_id,
                tick=self.source.tick,
                t2_series=self.t2_history[-30:],
                control_limit=self.model.t2_limit if self.model else 0.0,
                live_boundary=0,
                sensors=slim,
                exclusion_list=list(excl)[:10],
                latest_event_id=self.drift.latest_event_id if self.drift else None,
            )

    def add_rule(self, rule: RuleSchema) -> CompileRuleResponse:
        cols = self.schema.numeric_cols if self.schema else []
        batch = self.source.latest_batch(40)
        result = compile_rule(rule, cols, batch if not batch.empty else pd.DataFrame(columns=cols))
        if result.compiled:
            self.rules.append((result.rule_id, rule))
            self.store.put("rule", result.rule_id, rule.model_dump())
        return result

    def ranking(self, event_id: str) -> RankingArtifact:
        if event_id not in self.rankings:
            raise KeyError(event_id)
        return self.rankings[event_id]

    def log(self, body: DecisionAppend) -> DecisionEntry:
        if body.type == "override":
            eid = str(body.payload.get("event_id", ""))
            if eid:
                self.overrides[eid] = body.payload
                body.human_overridden = True
                self.store.put("override", eid, body.payload)
        if body.type == "inference" and body.payload.get("accepted"):
            eid = str(body.payload.get("event_id", ""))
            if eid:
                self.confirmed.add(eid)
                self.store.put("confirmed", eid, {"accepted": True})
        return self.store.append(body)


STATE = AppState()
