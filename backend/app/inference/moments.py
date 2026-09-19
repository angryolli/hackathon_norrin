"""v5 expanding-moment detector (mean / sd / skew / kurtosis).

Matches data_processing/v5_only_statistical.ipynb: studentize each new sample
against yesterday's expanding mean and sd, turn the four Gaussian influence
functions into per-field surprises, RMS them, then take the 90th percentile
across fields. Yellow/red use that run's own MAD of scores on ticks 8–20.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

MOMENT_NAMES = ("mean", "sd", "skew", "kurt")
YELLOW_Z = 3.5
RED_Z = 6.0
CALIB_START = 8
CALIB_END = 20
SCORE_PERCENTILE = 90.0
MAD_SCALE = 1.4826
Z_CLIP = 20.0
MAX_HISTORY = 2000


def last_moments(values: list[float] | np.ndarray) -> tuple[float, float, float, float]:
    series = pd.Series(np.asarray(values, dtype=np.float64))
    n = int(series.shape[0])
    mean = float(series.mean()) if n else float("nan")
    sd = float(series.std(ddof=1)) if n >= 2 else float("nan")
    skew = float(series.skew()) if n >= 3 else float("nan")
    kurt = float(series.kurt()) if n >= 4 else float("nan")
    return mean, sd, skew, kurt


def studentize(value: float, prev_mean: float, prev_sd: float) -> float:
    floor = max(1e-6 * abs(prev_mean), 1e-8)
    denom = max(prev_sd, floor) if math.isfinite(prev_sd) else floor
    z = (value - prev_mean) / denom
    return float(np.clip(z, -Z_CLIP, Z_CLIP))


def surprises(z: float) -> dict[str, float]:
    return {
        "mean": abs(z),
        "sd": abs(z * z - 1.0) / math.sqrt(2.0),
        "skew": abs(z**3) / math.sqrt(15.0),
        "kurt": abs(z**4 - 3.0) / math.sqrt(96.0),
    }


def rms_score(parts: dict[str, float]) -> float:
    vals = [parts[name] ** 2 for name in MOMENT_NAMES if math.isfinite(parts.get(name, float("nan")))]
    if not vals:
        return float("nan")
    return float(math.sqrt(sum(vals) / len(vals)))


def robust_z(score: float, median: float, mad: float) -> float:
    scale = max(MAD_SCALE * mad, 1e-9)
    return (score - median) / scale


def median_mad(values: list[float]) -> tuple[float, float]:
    arr = np.asarray([v for v in values if math.isfinite(v)], dtype=np.float64)
    if arr.size == 0:
        return float("nan"), float("nan")
    med = float(np.median(arr))
    mad = float(np.median(np.abs(arr - med)))
    return med, mad
