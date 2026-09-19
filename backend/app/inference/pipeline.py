from __future__ import annotations

import math
from dataclasses import dataclass, field

from app.inference.zscore import (
    LEVEL_NAMES,
    ChannelZ,
    TickVerdict,
    ZScoreDetector,
)

TOP_CONTRIBUTORS = 5
SNAPSHOT_FIELDS = 20


@dataclass
class FieldMoment:
    """One channel as the API exposes it. `score` is this tick's |z|."""

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
    """Live v6 z-score pipeline: k consecutive hot ticks open an alert.

    Wraps `ZScoreDetector` in the shape the API and the reasoning plane expect.
    Holds expanding moments per channel, never a raw CSV row.
    """

    detector: ZScoreDetector = field(default_factory=ZScoreDetector)
    last_tick: int = 0
    latest_moments: list[FieldMoment] = field(default_factory=list)
    latest_z: float = 0.0
    latest_score: float = 0.0
    latest_hot: int = 0

    def reset(self) -> None:
        self.detector.reset()
        self.last_tick = 0
        self.latest_moments = []
        self.latest_z = 0.0
        self.latest_score = 0.0
        self.latest_hot = 0

    @property
    def calibrated(self) -> bool:
        return self.detector.calibrated

    def field_ids(self) -> list[str]:
        return self.detector.field_ids()

    def current_level(self) -> str:
        return LEVEL_NAMES[self.detector.level]

    def drop_fields(self, field_ids: list[str]) -> None:
        self.detector.drop(field_ids)

    def hot_field_ids(self, limit: int = TOP_CONTRIBUTORS) -> set[str]:
        """Channels that carried this tick's alert. `latest_moments` is hottest first."""
        gate = self.detector.yellow_z
        hot = [row.field_id for row in self.latest_moments if row.score >= gate]
        if not hot and self.latest_moments:
            hot = [self.latest_moments[0].field_id]
        return set(hot[:limit])

    def update(self, values: dict[str, float], tick: int) -> DiagnosisSignal | None:
        if not values:
            return None
        self.last_tick = tick
        verdict = self.detector.step(values)
        self.latest_moments = [_as_moment(row) for row in verdict.channels]
        self.latest_z = _finite_or_zero(verdict.z_max)
        self.latest_score = float(verdict.streak_yellow)
        self.latest_hot = verdict.n_hot
        if not verdict.rising:
            return None
        return self._signal(verdict, tick)

    def _signal(self, verdict: TickVerdict, tick: int) -> DiagnosisSignal:
        gate = self.detector.red_z if verdict.level == 2 else self.detector.yellow_z
        streak = verdict.streak_red if verdict.level == 2 else verdict.streak_yellow
        hot = verdict.hot_channels(gate)[:TOP_CONTRIBUTORS]
        if not hot:
            hot = verdict.channels[:TOP_CONTRIBUTORS]
        top_fields = [
            {
                "field_id": row.field_id,
                "score": _round(row.abs_z),
                "mean": _round(row.mean),
                "sd": _round(row.sd),
                "skew": _round(row.skew),
                "kurt": _round(row.kurt),
                "n": row.n,
            }
            for row in hot
        ]
        names = ", ".join(row["field_id"] for row in top_fields[:3]) or "none"
        evidence = (
            f"{verdict.label} at tick {tick}: {streak} consecutive samples with some channel at "
            f"|z| >= {gate:g} (k={self.detector.k}); this sample max |z|={verdict.z_max:.2f} "
            f"across {len(verdict.channels)} channels, {verdict.n_hot} over "
            f"{self.detector.yellow_z:g}; top channels {names}"
        )
        return DiagnosisSignal(
            tick=tick,
            level=verdict.label,
            score=float(streak),
            z=round(_finite_or_zero(verdict.z_max), 3),
            top_fields=top_fields,
            evidence=evidence,
        )

    def current_snapshot(self) -> dict:
        detector = self.detector
        return {
            "tick": self.last_tick,
            "n": detector.n,
            "score": self.latest_score,
            "z": round(self.latest_z, 3),
            "calibrated": detector.calibrated,
            "level": LEVEL_NAMES[detector.level],
            "k": detector.k,
            "z_yellow": detector.yellow_z,
            "z_red": detector.red_z,
            "burn_in": detector.burn_in,
            "streak_yellow": detector.streak_yellow,
            "streak_red": detector.streak_red,
            "n_hot": self.latest_hot,
            "fields": [
                {
                    "field_id": row.field_id,
                    "n": row.n,
                    "mean": _round(row.mean),
                    "sd": _round(row.sd),
                    "skew": _round(row.skew),
                    "kurt": _round(row.kurt),
                    "score": _round(row.score),
                }
                for row in self.latest_moments[:SNAPSHOT_FIELDS]
            ],
        }


def _as_moment(row: ChannelZ) -> FieldMoment:
    return FieldMoment(
        field_id=row.field_id,
        n=row.n,
        mean=row.mean,
        sd=row.sd,
        skew=row.skew,
        kurt=row.kurt,
        score=_finite_or_zero(row.abs_z),
    )


def _finite_or_zero(value: float) -> float:
    return float(value) if math.isfinite(value) else 0.0


def _round(value: float) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(float(value), 4)
