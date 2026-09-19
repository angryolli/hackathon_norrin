from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

import pandas as pd

from app.config import CALIBRATE_ROWS, DATA_DIR, default_dataset, demo_data_path
from app.correlation.correlation_engine import correlate
from app.diagnosis.contribution_ranking import rank_event
from app.drift.calibration import DriftModel, fit_drift_model
from app.drift.detector import score_batch
from app.ingestion.disk_replay import DiskReplaySource, preview_headers
from app.ingestion.files import dataframe_from_api, materialize_csv, write_csv
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
    replays: list[DiskReplaySource] = field(default_factory=list)
    playing: bool = False
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

    @property
    def source(self) -> DiskReplaySource | None:
        return self.replays[0] if self.replays else None

    def boot(self) -> None:
        self.store.seed_data_sources()
        self._purge_generator_sources()
        path = demo_data_path()
        if path is not None:
            try:
                self.dataset_id = self._ensure_disk_source(path)
            except Exception:
                self.dataset_id = "demo_csv"
        else:
            ids = self._source_ids()
            self.dataset_id = ids[0] if ids else ""
        self.playing = False

    def preview_source(self, raw_path: str) -> dict:
        path = Path(raw_path.strip()).expanduser()
        csv_path = materialize_csv(path, DATA_DIR / "sources" / f"_preview_{path.stem}.csv")
        return preview_headers(csv_path)

    def _close_replays(self) -> None:
        for replay in self.replays:
            try:
                replay.close()
            except Exception:
                pass
        self.replays = []

    def _configured_specs(self) -> list[dict]:
        out: list[dict] = []
        for row in self.store.list_data_sources():
            origin = row.get("origin") or "file"
            if origin not in ("api", "file"):
                continue
            x_column = str(row.get("x_column") or "").strip()
            y_columns = row.get("y_columns") or []
            if not x_column and not y_columns:
                continue
            try:
                self._csv_path(row)
            except ValueError:
                continue
            out.append(row)
        return out

    def _open_replays(self) -> None:
        specs = self._configured_specs()
        self._close_replays()
        opened: list[DiskReplaySource] = []
        for spec in specs:
            try:
                path = materialize_csv(
                    self._csv_path(spec),
                    DATA_DIR / "sources" / f"{spec['id']}.csv",
                )
                replay = DiskReplaySource(path, source_id=spec["id"])
                y_cols = spec.get("y_columns") or []
                replay.open(
                    y_cols=list(y_cols) if y_cols else None,
                    x_column=str(spec.get("x_column") or ""),
                )
                opened.append(replay)
            except Exception:
                continue
        self.replays = opened
        if opened:
            self.dataset_id = opened[0].source_id or self.dataset_id

    def set_playing(self, playing: bool) -> MonitorSnapshot:
        self.playing = playing
        if playing:
            self._open_replays()
            if self.model is None and self.replays:
                try:
                    self.calibrate()
                except Exception:
                    pass
        self._monitor_key = None
        return self.monitor()

    def _ensure_disk_source(self, path: Path) -> str:
        resolved = str(path.expanduser().resolve())
        want = path.expanduser().resolve()
        for row in self.store.list_data_sources():
            file_path = row.get("file_path") or row.get("live_path") or ""
            if not file_path:
                continue
            try:
                if Path(file_path).expanduser().resolve() == want:
                    return row["id"]
            except OSError:
                if file_path == resolved:
                    return row["id"]
        source_id = "demo_csv" if "demo_csv" not in set(self._source_ids()) else self._unique_source_id(path.stem)
        self.store.create_data_source(
            {
                "id": source_id,
                "name": path.stem or source_id,
                "kind": "process",
                "description": f"Disk replay {resolved}",
                "generator": "",
                "origin": "file",
                "file_path": resolved,
                "train_path": resolved,
                "live_path": resolved,
            }
        )
        return source_id

    def _purge_generator_sources(self) -> None:
        for row in self.store.list_data_sources():
            origin = row.get("origin") or "generator"
            if origin == "generator":
                self.store.delete_data_source(row["id"])

    def _source_ids(self) -> list[str]:
        return [s["id"] for s in self.store.list_data_sources()]

    def _as_data_source(self, row: dict) -> DataSource:
        payload = dict(row)
        origin = payload.get("origin") or "file"
        payload["origin"] = origin if origin in ("api", "file") else "file"
        payload["generator"] = payload.get("generator") or ""
        payload["x_column"] = payload.get("x_column") or ""
        payload["y_columns"] = list(payload.get("y_columns") or [])
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

    def _csv_path(self, spec: dict) -> Path:
        raw = spec.get("file_path") or spec.get("live_path") or spec.get("train_path") or ""
        path = Path(str(raw)).expanduser()
        if not path.is_file():
            raise ValueError(f"file not found: {path}")
        return path

    def _switch_stream(self, source_id: str) -> None:
        spec = self.store.get_data_source(source_id)
        if spec is None:
            raise ValueError(f"unknown data source {source_id}")
        self.dataset_id = source_id
        if self.playing:
            self._open_replays()

    def _persist_table(self, source_id: str, frame: pd.DataFrame) -> str:
        dest = DATA_DIR / "sources" / f"{source_id}.csv"
        write_csv(frame, dest)
        return str(dest)

    def add_file_source(
        self,
        raw_path: str,
        x_column: str = "",
        y_columns: list[str] | None = None,
    ) -> DataSource:
        path = Path(raw_path.strip()).expanduser()
        csv_path = materialize_csv(path, DATA_DIR / "sources" / f"{path.stem}.csv")
        source_id = self._unique_source_id(path.stem or "file")
        resolved = str(csv_path)
        row = self.store.create_data_source(
            {
                "id": source_id,
                "name": path.stem or source_id,
                "kind": "other",
                "description": f"Disk replay {resolved}",
                "generator": "",
                "origin": "file",
                "api_url": "",
                "file_path": resolved,
                "train_path": resolved,
                "live_path": resolved,
                "x_column": x_column.strip(),
                "y_columns": list(y_columns or []),
            }
        )
        if self.playing:
            self._open_replays()
        return self._as_data_source(row)

    def add_api_source(self, api_url: str) -> DataSource:
        url = api_url.strip()
        if not url:
            raise ValueError("API URL is required")
        host = urlparse(url).hostname or "api"
        source_id = self._unique_source_id(host)
        frame = dataframe_from_api(url)
        path = self._persist_table(source_id, frame)
        row = self.store.create_data_source(
            {
                "id": source_id,
                "name": host,
                "kind": "other",
                "description": f"API {url}",
                "generator": "",
                "origin": "api",
                "api_url": url,
                "file_path": path,
                "train_path": path,
                "live_path": path,
            }
        )
        if self.playing:
            self._open_replays()
        return self._as_data_source(row)

    def _recalibrate_after_switch(self) -> None:
        self.events.clear()
        self.rankings.clear()
        self.rules.clear()
        self.t2_history.clear()
        self.confirmed.clear()
        self.overrides.clear()
        self.calibrate()

    def add_data_source(self, body: DataSourceCreate) -> DataSource:
        if body.origin == "api" or body.api_url.strip():
            return self.add_api_source(body.api_url)
        return self.add_file_source(body.file_path, body.x_column, body.y_columns)

    def patch_data_source(self, source_id: str, body: DataSourceUpdate) -> DataSource:
        current = self.store.get_data_source(source_id)
        if current is None:
            raise KeyError(source_id)
        payload = body.model_dump(exclude_unset=True)
        row = self.store.update_data_source(source_id, payload)
        if row is None:
            raise KeyError(source_id)
        return self._as_data_source(row)

    def remove_data_source(self, source_id: str) -> None:
        if self.store.get_data_source(source_id) is None:
            raise KeyError(source_id)
        if not self.store.delete_data_source(source_id):
            raise KeyError(source_id)
        self.replays = [replay for replay in self.replays if replay.source_id != source_id]
        ids = self._source_ids()
        if self.dataset_id == source_id:
            self.dataset_id = ids[0] if ids else ""

    def runtime_config(self) -> RuntimeConfig:
        return RuntimeConfig(
            dataset_id=self.dataset_id,
            datasets=self._source_ids(),
            calibration_id=self.calibration_id,
            baseline_established=self.model is not None,
            no_egress=self.no_egress,
            demo_data_uri=str(demo_data_path() or ""),
            playing=self.playing,
        )

    def update_config(self, body: ConfigUpdate) -> RuntimeConfig:
        if body.no_egress is not None:
            self.no_egress = body.no_egress
        if body.dataset_id and body.dataset_id != self.dataset_id:
            if body.dataset_id not in self._source_ids():
                raise ValueError(f"unknown data source {body.dataset_id}")
            self._switch_stream(body.dataset_id)
            self._recalibrate_after_switch()
        return self.runtime_config()

    def calibrate(self) -> CalibrateResponse:
        spec = self.store.get_data_source(self.dataset_id)
        if spec is None:
            raise ValueError(f"unknown data source {self.dataset_id}")
        csv_path = materialize_csv(self._csv_path(spec), DATA_DIR / "sources" / f"{self.dataset_id}.csv")
        raw = load_csv(str(csv_path), nrows=CALIBRATE_ROWS)
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
        if self.source is None:
            raise RuntimeError("no live source")
        batch = self.source.latest_batch(48)
        if batch.empty:
            raise RuntimeError("live window empty")
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
        if self.model is None or self.corr is None or self.source is None:
            raise RuntimeError("drift model missing")
        excl = exclusion if exclusion is not None else (self.quality.exclusion_list if self.quality else [])
        batch = self.source.latest_batch(48)
        if batch.empty:
            raise RuntimeError("live window empty")
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
        if not self.playing or not self.replays:
            return
        for replay in self.replays:
            replay.emit()
        head = self.source
        if head is None or self.model is None:
            return
        if head.tick % 2 != 0:
            return
        try:
            self.quality_check()
            self.drift_score()
        except Exception:
            return

    def monitor(self) -> MonitorSnapshot:
        tick = self.replays[0].tick if self.replays else 0
        latest = self.drift.latest_event_id if self.drift else None
        quality_id = id(self.quality)
        key = (
            self.dataset_id,
            self.calibration_id,
            tick,
            latest,
            quality_id,
            self.playing,
            tuple(replay.source_id for replay in self.replays),
        )
        if self._monitor_snap is not None and self._monitor_key == key:
            return self._monitor_snap
        snap = self._build_monitor(tick)
        self._monitor_key = key
        self._monitor_snap = snap
        return snap

    def _build_monitor(self, tick: int) -> MonitorSnapshot:
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
        cards: list[FieldCard] = []
        traces: list[tuple[str, list[float], str, str]] = []
        for replay in self.replays:
            traces.extend(replay.cards())
        for col, spark, file_name, source_id in traces:
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
                    source_file=file_name,
                    source_id=source_id,
                )
            )
        cards.sort(
            key=lambda c: (
                c.source_file,
                int("".join(ch for ch in c.field_id if ch.isdigit()) or "999999"),
                c.field_id,
            )
        )
        return MonitorSnapshot(
            calibration_id=cal,
            dataset_id=self.dataset_id,
            tick=tick,
            t2_series=[round(v, 4) for v in self.t2_history[-60:]],
            control_limit=round(self.model.t2_limit, 4) if self.model else 0.0,
            live_boundary=0,
            fields=cards[:80],
            demo_fields=[],
            demo_tick=0,
            exclusion_list=list(excl)[:20],
            latest_event_id=self.drift.latest_event_id if self.drift else None,
            demo_data_uri=str(demo_data_path() or ""),
            playing=self.playing,
        )

    def add_rule(self, rule: RuleSchema) -> CompileRuleResponse:
        cols = self.schema.numeric_cols if self.schema else []
        if self.source is None:
            batch = pd.DataFrame(columns=cols)
        else:
            batch = self.source.latest_batch(40)
        result = compile_rule(rule, cols, batch if not batch.empty else pd.DataFrame(columns=cols))
        if result.compiled:
            self.rules.append((result.rule_id, rule))
            self.store.put("rule", result.rule_id, rule.model_dump())
        return result

    def events_snapshot(self) -> dict:
        items = []
        for ev in reversed(list(self.events.values())):
            items.append(
                {
                    **ev.model_dump(),
                    "confirmed": ev.event_id in self.confirmed,
                    "override": self.overrides.get(ev.event_id),
                    "ranking": self.rankings[ev.event_id].model_dump()
                    if ev.event_id in self.rankings
                    else None,
                }
            )
        return {
            "events": items[:20],
            "evidence": "flagged T2 events vs frozen baseline",
        }

    def events_key(self) -> tuple:
        return (
            tuple(self.events),
            frozenset(self.confirmed),
            tuple(sorted(self.overrides)),
            self.drift.latest_event_id if self.drift else None,
        )

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
