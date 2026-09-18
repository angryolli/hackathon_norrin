from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
ARTIFACT_DIR = ROOT / "artifacts"

DATASETS = {
    "industrial_stream": {
        "train_path": str(DATA_DIR / "train.csv"),
        "test_path": str(DATA_DIR / "test.csv"),
    },
    "expenses": {
        "train_path": str(DATA_DIR / "second_domain.csv"),
        "test_path": str(DATA_DIR / "second_domain_live.csv"),
    },
}

TICK_SECONDS = float(os.getenv("STREAM_TICK_SECONDS", "0.45"))
LIVE_BUFFER = int(os.getenv("LIVE_BUFFER", "400"))
SPARKLINE_POINTS = 24
MAX_ARTIFACT_BYTES = 20_000
TOP_CORR_PAIRS = 20
TOP_RANK = 10
PCA_MAX_COMPONENTS = 5


def default_dataset() -> str:
    return os.getenv("DATASET_ID", "industrial_stream")
