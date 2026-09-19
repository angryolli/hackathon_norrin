from __future__ import annotations

from dataclasses import dataclass, field
import math

import numpy as np

from app.inference.moments import (
    CALIB_END,
    CALIB_START,
    MAX_HISTORY,
    RED_Z,
    SCORE_PERCENTILE,
    YELLOW_Z,
    last_moments,
    median_mad,
    rms_score,
    robust_z,
    studentize,
    surprises,
)


@dataclass
class FieldMoment:
    field_id: str
    n: int
    mean: float
    sd: float
    skew: float
    kurt: float
    score: float


@dataclass
class DiagnosisSignal:
    tick: int
    level: str
    score: float
    z: float
    top_fields: list[dict]
    evidence: str


@dataclass
class StatisticalEngine:
    """Live expanding-moment pipeline. Never stores raw CSV files."""

    history: dict[str, list[float]] = field(default_factory=dict)
    calib_scores: list[float] = field(default_factory=list)
    calib_median: float | None = None
    calib_mad: float | None = None
    last_level: int = 0
    last_tick: int = 0
    n_updates: int = 0
    latest_moments: list[FieldMoment] = field(default_factory=list)
    latest_score: float = 0.0
    latest_z: float = 0.0

    def reset(self) -> None:
        self.history.clear()
        self.calib_scores.clear()
        self.calib_median = None
        self.calib_mad = None
        self.last_level = 0
        self.last_tick = 0
        self.n_updates = 0
        self.latest_moments = []
        self.latest_score = 0.0
        self.latest_z = 0.0

    def current_level(self) -> str:
        if self.last_level >= 2:
            return "red"
        if self.last_level >= 1:
            return "yellow"
        return "normal"

    def drop_fields(self, field_ids: list[str]) -> None:
        for field_id in field_ids:
            self.history.pop(field_id, None)

    def update(self, values: dict[str, float], tick: int) -> DiagnosisSignal | None:
        if not values:
            return None
        self.last_tick = tick
        self.n_updates += 1
        n = self.n_updates
        for field_id, raw in values.items():
            series = self.history.setdefault(field_id, [])
            series.append(float(raw))
            if len(series) > MAX_HISTORY:
                del series[: len(series) - MAX_HISTORY]

        moments: list[FieldMoment] = []
        scores: list[float] = []
        for field_id in sorted(values):
            series = self.history[field_id]
            mean, sd, skew, kurt = last_moments(series)
            score = float("nan")
            if len(series) >= 2:
                prev_mean, prev_sd, _, _ = last_moments(series[:-1])
                z = studentize(series[-1], prev_mean, prev_sd)
                score = rms_score(surprises(z))
            moments.append(
                FieldMoment(
                    field_id=field_id,
                    n=len(series),
                    mean=mean,
                    sd=sd,
                    skew=skew,
                    kurt=kurt,
                    score=score if score == score else 0.0,
                )
            )
            scores.append(score)
        self.latest_moments = moments

        finite = [s for s in scores if s == s]
        if not finite:
            return None
        sample_score = float(np.nanpercentile(np.asarray(scores, dtype=np.float64), SCORE_PERCENTILE))
        self.latest_score = sample_score

        if CALIB_START <= n <= CALIB_END:
            self.calib_scores.append(sample_score)
        if n == CALIB_END and self.calib_median is None:
            med, mad = median_mad(self.calib_scores)
            if math.isfinite(med) and math.isfinite(mad):
                self.calib_median, self.calib_mad = med, mad

        if (
            self.calib_median is None
            or self.calib_mad is None
            or not math.isfinite(self.calib_median)
            or not math.isfinite(self.calib_mad)
            or n < CALIB_END
        ):
            self.latest_z = 0.0
            return None

        z_run = robust_z(sample_score, self.calib_median, self.calib_mad)
        self.latest_z = z_run
        if z_run >= RED_Z:
            level = 2
            label = "red"
        elif z_run >= YELLOW_Z:
            level = 1
            label = "yellow"
        else:
            level = 0
            label = "normal"

        rising = level > self.last_level and level > 0
        self.last_level = level
        if not rising:
            return None

        ranked = sorted(moments, key=lambda row: row.score, reverse=True)[:5]
        top_fields = [
            {
                "field_id": row.field_id,
                "score": round(row.score, 4),
                "mean": _finite(row.mean),
                "sd": _finite(row.sd),
                "skew": _finite(row.skew),
                "kurt": _finite(row.kurt),
                "n": row.n,
            }
            for row in ranked
        ]
        names = ", ".join(row["field_id"] for row in top_fields[:3]) or "none"
        evidence = (
            f"{label} expanding-moment jump at tick {tick}: "
            f"S={sample_score:.3f} z={z_run:.2f} (yellow {YELLOW_Z}, red {RED_Z}); "
            f"top fields {names}"
        )
        return DiagnosisSignal(
            tick=tick,
            level=label,
            score=round(sample_score, 4),
            z=round(z_run, 3),
            top_fields=top_fields,
            evidence=evidence,
        )

    def current_snapshot(self) -> dict:
        ranked = sorted(self.latest_moments, key=lambda row: row.score, reverse=True)[:20]
        return {
            "tick": self.last_tick,
            "n": self.n_updates,
            "score": round(self.latest_score, 4),
            "z": round(self.latest_z, 3),
            "calibrated": self.calib_median is not None,
            "fields": [
                {
                    "field_id": row.field_id,
                    "n": row.n,
                    "mean": _finite(row.mean),
                    "sd": _finite(row.sd),
                    "skew": _finite(row.skew),
                    "kurt": _finite(row.kurt),
                    "score": round(row.score, 4),
                }
                for row in ranked
            ],
        }


def _finite(value: float) -> float | None:
    if value != value or value in (float("inf"), float("-inf")):
        return None
    return round(float(value), 4)
