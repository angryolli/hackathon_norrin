from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.config import MAX_ARTIFACT_BYTES, SPARKLINE_POINTS, TOP_CORR_PAIRS, TOP_RANK

Status = Literal["pass", "fail", "warn"]
RoleKind = Literal["measured", "actuator", "ambiguous"]
Chip = Literal["normal", "drifting", "stuck", "out_of_range", "excluded"]
LogType = Literal["inference", "flag", "diagnosis", "override", "question", "model_call"]


class SizedArtifact(BaseModel):
    @model_validator(mode="after")
    def enforce_byte_ceiling(self):
        n = len(self.model_dump_json().encode("utf-8"))
        if n > MAX_ARTIFACT_BYTES:
            raise ValueError(
                f"{type(self).__name__} is {n} bytes (ceiling {MAX_ARTIFACT_BYTES})"
            )
        return self


class HealthResponse(BaseModel):
    status: str
    role: str = "compute-plane"
    stream_tick: int = 0
    live_rows: int = 0


class RuntimeConfig(BaseModel):
    dataset_id: str
    datasets: list[str]
    calibration_id: str | None = None
    baseline_established: bool = False
    no_egress: bool = False


class ConfigUpdate(BaseModel):
    dataset_id: str | None = None
    no_egress: bool | None = None


class CalibrateRequest(BaseModel):
    dataset_id: str | None = None


class CalibrateResponse(BaseModel):
    calibration_id: str
    dataset_id: str
    n_sensors: int
    n_rows_used: int
    baseline_established: bool
    evidence: str


class SensorProfile(BaseModel):
    sensor_id: str
    n: int
    mean: float | None = None
    std: float | None = None
    min: float | None = None
    max: float | None = None
    skew: float | None = None
    kurtosis: float | None = None
    missing_rate: float = 0.0
    unique_ratio: float = 0.0
    frozen_rate: float = 0.0
    lag1_autocorr: float | None = None
    stationary: bool = True
    stationarity_evidence: str = ""
    dominant_fft: float | None = None
    evidence: str = ""


class ProfileArtifact(SizedArtifact):
    calibration_id: str
    sensors: list[SensorProfile] = Field(default_factory=list, max_length=80)


class CorrelationPair(BaseModel):
    a: str
    b: str
    pearson: float
    spearman: float
    best_lag: int = 0
    lagged_corr: float | None = None
    evidence: str = ""


class Cluster(BaseModel):
    cluster_id: str
    members: list[str] = Field(max_length=40)
    evidence: str = ""


class CorrelationArtifact(SizedArtifact):
    calibration_id: str
    pairs: list[CorrelationPair] = Field(default_factory=list, max_length=TOP_CORR_PAIRS)
    clusters: list[Cluster] = Field(default_factory=list, max_length=12)


class StructuralRole(BaseModel):
    sensor_id: str
    role: RoleKind
    quantization_score: float
    bounded_range_score: float
    lag_centrality_score: float
    evidence: str


class RolesArtifact(SizedArtifact):
    calibration_id: str
    roles: list[StructuralRole] = Field(default_factory=list, max_length=80)


class RuleSchema(BaseModel):
    column: str
    condition: Literal["gt", "lt", "abs_gt", "stuck", "missing_rate"]
    threshold: float
    window: int = 20
    severity: Literal["info", "warn", "fail"] = "warn"
    rule_text: str = ""


class CompileRuleRequest(BaseModel):
    calibration_id: str
    rule: RuleSchema


class CompileRuleResponse(BaseModel):
    rule_id: str
    compiled: bool
    dry_run_result: Status
    evidence: str


class QualityCheckRequest(BaseModel):
    calibration_id: str
    batch_range: str = "latest"


class QualityItem(BaseModel):
    name: str
    status: Status
    evidence: str
    affected_sensors: list[str] = Field(default_factory=list, max_length=20)
    originating_rule_id: str = "baseline"
    sensor_fault: bool = False


class QualityReport(SizedArtifact):
    calibration_id: str
    batch_id: str
    checks: list[QualityItem] = Field(default_factory=list, max_length=40)
    exclusion_list: list[str] = Field(default_factory=list, max_length=40)
    data_trusted: bool = True


class DriftScoreRequest(BaseModel):
    calibration_id: str
    batch_range: str = "latest"
    exclusion_list: list[str] = Field(default_factory=list)


class Contribution(BaseModel):
    sensor_id: str
    contribution_score: float
    evidence: str


class DriftEvent(BaseModel):
    event_id: str
    t_start: int
    t_end: int
    t2: float
    spe: float
    control_limit: float
    flagged: bool
    contributions: list[Contribution] = Field(default_factory=list, max_length=TOP_RANK)
    evidence: str


class DriftArtifact(SizedArtifact):
    calibration_id: str
    batch_id: str
    composite_t2: float
    composite_spe: float
    control_limit: float
    cusum: float
    series: list[float] = Field(default_factory=list, max_length=60)
    events: list[DriftEvent] = Field(default_factory=list, max_length=8)
    latest_event_id: str | None = None


class RankingArtifact(SizedArtifact):
    event_id: str
    calibration_id: str
    ranked: list[dict] = Field(default_factory=list, max_length=TOP_RANK)
    evidence: str
    confidence: float = 0.0


class DecisionAppend(BaseModel):
    type: LogType
    payload: dict = Field(default_factory=dict)
    evidence_ref: str = ""
    human_overridden: bool = False


class DecisionEntry(BaseModel):
    ts: str
    type: LogType
    payload: dict
    evidence_ref: str = ""
    human_overridden: bool = False


class DecisionLogPage(BaseModel):
    entries: list[DecisionEntry] = Field(default_factory=list, max_length=100)
    total: int = 0


class SensorCard(BaseModel):
    sensor_id: str
    sparkline: list[float] = Field(default_factory=list, max_length=SPARKLINE_POINTS)
    status: Chip
    contribution: float = 0.0
    evidence: str = ""


class MonitorSnapshot(BaseModel):
    calibration_id: str | None = None
    dataset_id: str
    tick: int
    t2_series: list[float] = Field(default_factory=list, max_length=60)
    control_limit: float = 0.0
    live_boundary: int = 0
    sensors: list[SensorCard] = Field(default_factory=list, max_length=40)
    exclusion_list: list[str] = Field(default_factory=list, max_length=20)
    latest_event_id: str | None = None
    evidence: str = "Monitor snapshot is aggregated windows, not raw row dumps."
