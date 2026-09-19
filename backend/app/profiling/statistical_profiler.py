from __future__ import annotations

import numpy as np
import pandas as pd

from app.ingestion.loader import DetectedSchema
from app.models.schemas import FieldProfile, ProfileArtifact


def _lag1(x: np.ndarray) -> float | None:
    if x.size < 3:
        return None
    a, b = x[:-1], x[1:]
    if a.std() < 1e-12 or b.std() < 1e-12:
        return None
    return float(np.corrcoef(a, b)[0, 1])


def _fft_peak(x: np.ndarray) -> float | None:
    if x.size < 16:
        return None
    y = x - x.mean()
    spec = np.abs(np.fft.rfft(y))
    if spec.size < 3:
        return None
    spec[0] = 0
    idx = int(np.argmax(spec))
    freqs = np.fft.rfftfreq(x.size)
    return float(freqs[idx])


def profile_frame(df: pd.DataFrame, schema: DetectedSchema, calibration_id: str) -> ProfileArtifact:
    fields: list[FieldProfile] = []
    n = len(df)
    for col in schema.numeric_cols:
        s = pd.to_numeric(df[col], errors="coerce")
        x = s.dropna().to_numpy(dtype=float)
        missing = float(s.isna().mean())
        unique_ratio = float(s.nunique(dropna=True) / max(n, 1))
        frozen = 0.0
        if len(x) > 8:
            diffs = np.abs(np.diff(x))
            frozen = float((diffs < 1e-9).mean())
        half = max(len(x) // 2, 1)
        stationary = True
        stationarity_evidence = "single window"
        if len(x) > 20:
            d = abs(float(x[:half].mean()) - float(x[half:].mean()))
            scale = float(x.std()) + 1e-9
            stationary = d < 0.75 * scale
            stationarity_evidence = f"half-mean delta={d:.3f}, std={scale:.3f}"
        mean = float(x.mean()) if x.size else None
        std = float(x.std()) if x.size else None
        fields.append(
            FieldProfile(
                field_id=col,
                n=int(x.size),
                mean=mean,
                std=std,
                min=float(x.min()) if x.size else None,
                max=float(x.max()) if x.size else None,
                skew=float(pd.Series(x).skew()) if x.size > 3 else None,
                kurtosis=float(pd.Series(x).kurtosis()) if x.size > 3 else None,
                missing_rate=missing,
                unique_ratio=unique_ratio,
                frozen_rate=frozen,
                lag1_autocorr=_lag1(x),
                stationary=stationary,
                stationarity_evidence=stationarity_evidence,
                dominant_fft=_fft_peak(x),
                evidence=(
                    f"mean={mean:.3f} std={std:.3f} missing={missing:.3f} "
                    f"frozen={frozen:.3f} unique={unique_ratio:.3f}"
                    if mean is not None and std is not None
                    else f"missing={missing:.3f}"
                ),
            )
        )
    return ProfileArtifact(calibration_id=calibration_id, fields=fields)
