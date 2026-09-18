from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    role: str = "data-processing"


class SensorProfile(BaseModel):
    column_id: str
    n: int
    mean: float | None = None
    std: float | None = None
    min: float | None = None
    max: float | None = None
    missing_rate: float = 0.0
    frozen_rate: float = 0.0
    lag1_autocorr: float | None = None
    likely_kind_hint: str | None = Field(
        default=None,
        description="Structural hint only (measured vs manipulated), not a label.",
    )


class QualityCheck(BaseModel):
    check_id: str
    category: str
    name: str
    status: str
    evidence: str
    originating_rule: str | None = None


class CorrelationEdge(BaseModel):
    a: str
    b: str
    corr: float
    lag: int = 0
    lagged_corr: float | None = None


class DriftFinding(BaseModel):
    signal_id: str
    kind: str
    score: float
    evidence: str


class RankedSensor(BaseModel):
    signal_id: str
    contribution: float
    evidence: str


class PipelineArtifacts(BaseModel):
    domain: str = "unlabeled_tabular"
    profiles: list[SensorProfile] = []
    quality: list[QualityCheck] = []
    correlations: list[CorrelationEdge] = []
    drift: list[DriftFinding] = []
    ranked_sensors: list[RankedSensor] = []
    data_trusted: bool = True
    notes: list[str] = []
