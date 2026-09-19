from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
ARTIFACT_DIR = ROOT / "artifacts"

DEFAULT_DATA_SOURCES = [
    {
        "id": "industrial_stream",
        "name": "Industrial stream",
        "kind": "process",
        "description": "Unlabeled process variables from a continuous plant stream.",
        "generator": "industrial",
        "train_path": str(DATA_DIR / "train.csv"),
        "live_path": str(DATA_DIR / "test.csv"),
    },
    {
        "id": "expenses",
        "name": "Expenses",
        "kind": "business",
        "description": "Business expense records for a second domain.",
        "generator": "expenses",
        "train_path": str(DATA_DIR / "second_domain.csv"),
        "live_path": str(DATA_DIR / "second_domain_live.csv"),
    },
]
DATASETS = {s["id"]: s for s in DEFAULT_DATA_SOURCES}

TICK_SECONDS = float(os.getenv("STREAM_TICK_SECONDS", "0.45"))
LIVE_BUFFER = int(os.getenv("LIVE_BUFFER", "400"))
SPARKLINE_POINTS = 100
MAX_ARTIFACT_BYTES = 20_000
TOP_CORR_PAIRS = 20
TOP_RANK = 10
PCA_MAX_COMPONENTS = 5


def default_dataset() -> str:
    return os.getenv("DATASET_ID", "industrial_stream")
