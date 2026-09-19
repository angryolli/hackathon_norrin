from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field

import pandas as pd

from app.config import DATA_DIR, SPARKLINE_POINTS, default_dataset, demo_data_path
from app.correlation.correlation_engine import correlate
from app.diagnosis.contribution_ranking import rank_event
from app.drift.calibration import DriftModel, fit_drift_model
from app.drift.detector import score_batch
from app.ingestion.disk_replay import DiskReplaySource
from app.ingestion.fake_stream import RollingSource
from app.ingestion.files import (
    dataframe_from_api,
    dataframe_from_bytes,
    write_csv,
)
from app.ingestion.labels import fault_free_segment
from app.ingestion.loader import DetectedSchema, load_csv, process_frame
from app.models.schemas import (
    CalibrateResponse,
    Chip,
    CompileRuleResponse,
    ConfigUpdate,
    CorrelationArtifact,
    DataSource,
    DataSourceCreate,
    DataSourceUpdate,
    DecisionAppend,
    DecisionEntry,
    DriftArtifact,
    DriftEvent,
    FieldCard,
    MonitorSnapshot,
    ProfileArtifact,
    QualityReport,
    RankingArtifact,
    RolesArtifact,
    RuleSchema,
    RuntimeConfig,
)
from app.profiling.statistical_profiler import profile_frame
from app.profiling.structural_classifier import classify_roles
from app.quality.baseline_checks import run_quality
from app.quality.rule_compiler import compile_rule
from app.storage.artifact_store import ArtifactStore


@dataclass
class AppState:
    source: RollingSource = field(default_factory=RollingSource)
    demo: DiskReplaySource | None = None
    store: ArtifactStore = field(default_factory=ArtifactStore)
    dataset_id: str = field(default_factory=default_dataset)
    no_egress: bool = False
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
    _monitor_key: tuple | None = None
    _monitor_snap: MonitorSnapshot | None = None

    def boot(self) -> None:
        self.store.seed_data_sources()
        sources = self.store.list_data_sources()
        ids = {s["id"] for s in sources}
        if self.dataset_id not in ids and sources:
            self.dataset_id = sources[0]["id"]
        for src in sources:
            origin = src.get("origin") or "generator"
            if origin == "generator":
                self.source.reset(src["id"], src.get("generator"))
                self.source.seed_calibration_csv(src["train_path"], src["live_path"])
        self._switch_stream(self.dataset_id, seed=False)
        self.calibrate()
        path = demo_data_path()
        if path is not None:
            try:
                demo = DiskReplaySource(path)
                demo.open()
                self.demo = demo
            except Exception:
                self.demo = None

    def _source_ids(self) -> list[str]:
        return [s["id"] for s in self.store.list_data_sources()]

    def _as_data_source(self, row: dict) -> DataSource:
        payload = dict(row)
        payload["origin"] = payload.get("origin") or "generator"
        if payload.get("generator") not in ("industrial", "expenses"):
            payload["generator"] = "industrial"
        return DataSource(**payload, active=row["id"] == self.dataset_id)

    def list_data_sources(self) -> list[DataSource]:
        return [self._as_data_source(row) for row in self.store.list_data_sources()]

    def _unique_source_id(self, name: str) -> str:
        base = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:40] or "source"
        ids = set(self._source_ids())
        if base not in ids:
            return base
        i = 2
        while f"{base}_{i}" in ids:
            i += 1
        return f"{base}_{i}"

    def _default_generator(self, kind: str, generator: str | None) -> str:
        if generator:
            return generator
        return "expenses" if kind == "business" else "industrial"

    def _switch_stream(self, source_id: str, *, seed: bool) -> None:
        spec = self.store.get_data_source(source_id)
        if spec is None:
            raise ValueError(f"unknown data source {source_id}")
        self.dataset_id = source_id
        origin = spec.get("origin") or "generator"
        if origin == "generator":
            self.source.reset(source_id, spec.get("generator"))
            if seed:
                self.source.seed_calibration_csv(spec["train_path"], spec["live_path"])
            return
        self.source.reset_from_spec(spec)

    def _persist_table(self, source_id: str, frame: pd.DataFrame) -> str:
        path = str(DATA_DIR / "sources" / f"{source_id}.csv")
        write_csv(frame, DATA_DIR / "sources" / f"{source_id}.csv")
        return path

    def add_file_source(self, name: str, filename: str, data: bytes) -> DataSource:
        source_id = self._unique_source_id(name or filename)
        frame = dataframe_from_bytes(filename, data)
        path = self._persist_table(source_id, frame)
        row = self.store.create_data_source(
            {
                "id": source_id,
                "name": (name or filename).strip() or source_id,
                "kind": "other",
                "description": f"Ingested file {filename}",
                "generator": "industrial",
                "origin": "file",
                "api_url": "",
                "file_path": path,
                "train_path": path,
                "live_path": path,
            }
        )
        self._switch_stream(source_id, seed=False)
        self._recalibrate_after_switch()
        return self._as_data_source(row)

    def add_api_source(self, name: str, api_url: str) -> DataSource:
        url = api_url.strip()
        if not url:
            raise ValueError("API URL is required")
        source_id = self._unique_source_id(name or "api")
        frame = dataframe_from_api(url)
        path = self._persist_table(source_id, frame)
        row = self.store.create_data_source(
            {
                "id": source_id,
                "name": (name or source_id).strip(),
                "kind": "other",
                "description": f"API {url}",
                "generator": "industrial",
                "origin": "api",
                "api_url": url,
                "file_path": path,
                "train_path": path,
                "live_path": path,
            }
        )
        self._switch_stream(source_id, seed=False)
        self._recalibrate_after_switch()
        return self._as_data_source(row)

    def _recalibrate_after_switch(self) -> None:
        self.events.clear()
        self.rankings.clear()
        self.rules.clear()
        self.t2_history.clear()
        self.confirmed.clear()
        self.overrides.clear()
        self.calibrate()

    def _write_source_csv(self, source_id: str, generator: str, train_path: str, live_path: str) -> None:
        scratch = RollingSource()
        scratch.reset(source_id, generator)
        scratch.seed_calibration_csv(train_path, live_path)

    def add_data_source(self, body: DataSourceCreate) -> DataSource:
        source_id = self._unique_source_id(body.name)
        generator = self._default_generator(body.kind, body.generator)
        train_path = str(DATA_DIR / f"{source_id}_train.csv")
        live_path = str(DATA_DIR / f"{source_id}_live.csv")
        row = self.store.create_data_source(
            {
                "id": source_id,
                "name": body.name.strip() or source_id,
                "kind": body.kind,
                "description": body.description,
                "generator": generator,
                "train_path": train_path,
                "live_path": live_path,
            }
        )
        self._write_source_csv(source_id, generator, train_path, live_path)
        return self._as_data_source(row)

    def patch_data_source(self, source_id: str, body: DataSourceUpdate) -> DataSource:
        current = self.store.get_data_source(source_id)
        if current is None:
            raise KeyError(source_id)
        payload = body.model_dump(exclude_unset=True)
        if "generator" in payload and payload["generator"] is None:
            payload.pop("generator")
        row = self.store.update_data_source(source_id, payload)
        if row is None:
            raise KeyError(source_id)
        generator_changed = (
            "generator" in payload and payload["generator"] != current["generator"]
        )
        if generator_changed:
            if source_id == self.dataset_id:
                self._switch_stream(source_id, seed=True)
                self._recalibrate_after_switch()
            else:
                self._write_source_csv(
                    source_id, row["generator"], row["train_path"], row["live_path"]
                )
        return self._as_data_source(row)

    def remove_data_source(self, source_id: str) -> None:
        remaining = [s for s in self.store.list_data_sources() if s["id"] != source_id]
        if not remaining:
            raise ValueError("at least one data source is required")
        if self.store.get_data_source(source_id) is None:
            raise KeyError(source_id)
        switching = source_id == self.dataset_id
        if not self.store.delete_data_source(source_id):
            raise KeyError(source_id)
        if switching:
            self._switch_stream(remaining[0]["id"], seed=True)
            self._recalibrate_after_switch()

    def runtime_config(self) -> RuntimeConfig:
        return RuntimeConfig(
            dataset_id=self.dataset_id,
            datasets=self._source_ids(),
            calibration_id=self.calibration_id,
            baseline_established=self.model is not None,
            no_egress=self.no_egress,
        )

    def update_config(self, body: ConfigUpdate) -> RuntimeConfig:
        if body.no_egress is not None:
            self.no_egress = body.no_egress
        if body.dataset_id and body.dataset_id != self.dataset_id:
            if body.dataset_id not in self._source_ids():
                raise ValueError(f"unknown data source {body.dataset_id}")
            self._switch_stream(body.dataset_id, seed=True)
            self._recalibrate_after_switch()
        return self.runtime_config()

    def calibrate(self) -> CalibrateResponse:
        spec = self.store.get_data_source(self.dataset_id)
        if spec is None:
            raise ValueError(f"unknown data source {self.dataset_id}")
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
                "n_fields": len(schema.numeric_cols),
                "n_rows_used": len(frame),
                "label_cols": schema.label_cols,
            },
        )
        return CalibrateResponse(
            calibration_id=calibration_id,
            dataset_id=self.dataset_id,
            n_fields=len(schema.numeric_cols),
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
        if self.demo is not None:
            self.demo.emit()
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
        demo_tick = self.demo.tick if self.demo is not None else 0
        latest = self.drift.latest_event_id if self.drift else None
        quality_id = id(self.quality)
        key = (self.dataset_id, self.calibration_id, self.source.tick, demo_tick, latest, quality_id)
        if self._monitor_snap is not None and self._monitor_key == key:
            return self._monitor_snap
        snap = self._build_monitor(demo_tick)
        self._monitor_key = key
        self._monitor_snap = snap
        return snap

    def _build_monitor(self, demo_tick: int) -> MonitorSnapshot:
        cal = self.calibration_id
        excl = set(self.quality.exclusion_list if self.quality else [])
        contrib_map: dict[str, float] = {}
        if self.drift and self.drift.events:
            for c in self.drift.events[-1].contributions:
                contrib_map[c.field_id] = round(c.contribution_score, 3)
        peak = max(contrib_map.values()) if contrib_map else 0.0
        cal_frozen = {
            p.field_id: p.frozen_rate for p in (self.profile.fields if self.profile else [])
        }
        cols = self.schema.numeric_cols if self.schema else []
        sparks = self.source.sparkline_map(cols, SPARKLINE_POINTS)
        cards: list[FieldCard] = []
        for col in cols:
            spark = sparks.get(col, [])
            status: Chip = "normal"
            evidence = "within frozen baseline"
            if len(spark) > 5:
                frozen = 0
                for i in range(1, len(spark)):
                    if abs(spark[i] - spark[i - 1]) < 1e-9:
                        frozen += 1
                if frozen / (len(spark) - 1) > 0.85 and cal_frozen.get(col, 0) < 0.4:
                    status = "stuck"
                    evidence = "near-zero rolling delta in live window"
            if col in excl:
                status = "excluded"
                evidence = "excluded — data-source field fault from quality-check"
            elif status != "stuck" and peak > 0 and contrib_map.get(col, 0) > 0.4 * peak:
                status = "drifting"
                evidence = f"contribution={contrib_map[col]:.3f} on latest T2 event"
            cards.append(
                FieldCard(
                    field_id=col,
                    sparkline=spark,
                    status=status,
                    contribution=float(contrib_map.get(col, 0)),
                    evidence=evidence,
                )
            )
        cards.sort(
            key=lambda c: (
                int("".join(ch for ch in c.field_id if ch.isdigit()) or "999999"),
                c.field_id,
            )
        )
        demo_cards: list[FieldCard] = []
        if self.demo is not None:
            for col, spark in self.demo.cards():
                demo_cards.append(
                    FieldCard(
                        field_id=col,
                        sparkline=spark,
                        status="normal",
                        contribution=0.0,
                        evidence="demo replay",
                    )
                )
        return MonitorSnapshot(
            calibration_id=cal,
            dataset_id=self.dataset_id,
            tick=self.source.tick,
            t2_series=[round(v, 4) for v in self.t2_history[-60:]],
            control_limit=round(self.model.t2_limit, 4) if self.model else 0.0,
            live_boundary=0,
            fields=cards[:40],
            demo_fields=demo_cards[:80],
            demo_tick=demo_tick,
            exclusion_list=list(excl)[:20],
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
