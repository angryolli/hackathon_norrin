from __future__ import annotations

from sqlmodel import Field, SQLModel


class ArtifactRecord(SQLModel, table=True):
    __tablename__ = "artifacts"

    kind: str = Field(primary_key=True)
    key: str = Field(primary_key=True)
    json: str
    updated_at: str


class DecisionLogRecord(SQLModel, table=True):
    __tablename__ = "decision_log"

    id: int | None = Field(default=None, primary_key=True)
    ts: str
    type: str = Field(index=True)
    payload: str
    evidence_ref: str = ""
    human_overridden: bool = Field(default=False, index=True)
