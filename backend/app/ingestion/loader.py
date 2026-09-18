from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from app.ingestion.labels import detect_label_columns


def _looks_like_timestamp(series: pd.Series) -> bool:
    if pd.api.types.is_datetime64_any_dtype(series):
        return True
    sample = series.dropna().astype(str).head(20)
    if sample.empty:
        return False
    parsed = pd.to_datetime(sample, errors="coerce", utc=True)
    return float(parsed.notna().mean()) >= 0.8


@dataclass
class DetectedSchema:
    timestamp_col: str | None
    numeric_cols: list[str]
    categorical_cols: list[str]
    label_cols: list[str]


def detect_schema(df: pd.DataFrame) -> DetectedSchema:
    timestamp_col = None
    for col in df.columns:
        if _looks_like_timestamp(df[col]):
            timestamp_col = str(col)
            break

    label_cols = detect_label_columns(df)
    numeric_cols: list[str] = []
    categorical_cols: list[str] = []
    for col in df.columns:
        name = str(col)
        if name == timestamp_col or name in label_cols:
            continue
        if pd.api.types.is_numeric_dtype(df[col]):
            numeric_cols.append(name)
        else:
            categorical_cols.append(name)
    return DetectedSchema(
        timestamp_col=timestamp_col,
        numeric_cols=numeric_cols,
        categorical_cols=categorical_cols,
        label_cols=label_cols,
    )


def load_csv(path: str) -> pd.DataFrame:
    return pd.read_csv(path)


def process_frame(df: pd.DataFrame) -> tuple[pd.DataFrame, DetectedSchema]:
    schema = detect_schema(df)
    out = df.copy()
    if schema.timestamp_col:
        out[schema.timestamp_col] = pd.to_datetime(
            out[schema.timestamp_col], errors="coerce", utc=True
        )
    return out, schema
