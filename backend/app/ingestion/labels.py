from __future__ import annotations

import re

import pandas as pd

LABEL_NAME_RE = re.compile(r"(fault|label|idv|class|target)", re.I)


def detect_label_columns(df: pd.DataFrame) -> list[str]:
    found: list[str] = []
    for col in df.columns:
        if not LABEL_NAME_RE.search(str(col)):
            continue
        series = df[col]
        nunique = int(series.nunique(dropna=True))
        if nunique <= 24:
            found.append(str(col))
    return found


def fault_free_segment(df: pd.DataFrame, label_cols: list[str]) -> pd.DataFrame:
    """Keep the 'normal' slice. Isolated so the filter is auditable."""
    if not label_cols:
        return df
    mask = pd.Series(True, index=df.index)
    for col in label_cols:
        values = df[col]
        if (values == 0).any():
            mask &= values == 0
        else:
            early = values.iloc[: max(1, len(values) // 10)]
            mode = early.mode()
            if len(mode):
                mask &= values == mode.iloc[0]
    return df.loc[mask].copy()
