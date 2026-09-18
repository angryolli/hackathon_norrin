from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from app.config import ARTIFACT_DIR
from app.models.schemas import DecisionAppend, DecisionEntry, SizedArtifact


class ArtifactStore:
    def __init__(self) -> None:
        ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
        self.log_path = ARTIFACT_DIR / "decision-log.jsonl"
        self._log: list[DecisionEntry] = []

    def write_json(self, calibration_id: str, name: str, artifact: SizedArtifact) -> None:
        folder = ARTIFACT_DIR / calibration_id
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{name}.json").write_text(artifact.model_dump_json(indent=2), encoding="utf-8")

    def append(self, body: DecisionAppend) -> DecisionEntry:
        entry = DecisionEntry(
            ts=datetime.now(timezone.utc).isoformat(),
            type=body.type,
            payload=body.payload,
            evidence_ref=body.evidence_ref,
            human_overridden=body.human_overridden,
        )
        self._log.append(entry)
        with self.log_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry.model_dump()) + "\n")
        return entry

    def page(
        self,
        type_filter: str | None = None,
        human_only: bool = False,
        limit: int = 80,
    ) -> tuple[list[DecisionEntry], int]:
        rows = self._log
        if type_filter:
            rows = [r for r in rows if r.type == type_filter]
        if human_only:
            rows = [r for r in rows if r.human_overridden]
        rows = list(reversed(rows))
        return rows[:limit], len(self._log)
