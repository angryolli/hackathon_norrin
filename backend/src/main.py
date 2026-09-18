from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from processing import demo_artifacts
from schemas import (
    CorrelationEdge,
    DriftFinding,
    HealthResponse,
    PipelineArtifacts,
    QualityCheck,
    RankedSensor,
    SensorProfile,
)

app = FastAPI(title="Process monitor pipeline")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def artifacts() -> PipelineArtifacts:
    return demo_artifacts()


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.get("/pipeline", response_model=PipelineArtifacts)
def pipeline() -> PipelineArtifacts:
    return artifacts()


@app.get("/pipeline/profile", response_model=list[SensorProfile])
def profile() -> list[SensorProfile]:
    return artifacts().profiles


@app.get("/pipeline/quality", response_model=list[QualityCheck])
def quality() -> list[QualityCheck]:
    return artifacts().quality


@app.get("/pipeline/correlations", response_model=list[CorrelationEdge])
def correlations() -> list[CorrelationEdge]:
    return artifacts().correlations


@app.get("/pipeline/drift", response_model=list[DriftFinding])
def drift() -> list[DriftFinding]:
    return artifacts().drift


@app.get("/pipeline/attribution", response_model=list[RankedSensor])
def attribution() -> list[RankedSensor]:
    return artifacts().ranked_sensors
