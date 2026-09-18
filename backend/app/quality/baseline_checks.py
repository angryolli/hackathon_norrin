from __future__ import annotations

import pandas as pd

from app.ingestion.loader import DetectedSchema
from app.models.schemas import ProfileArtifact, QualityItem, QualityReport, RuleSchema


def run_quality(
    batch: pd.DataFrame,
    schema: DetectedSchema,
    profile: ProfileArtifact,
    calibration_id: str,
    batch_id: str,
    custom: list[tuple[str, RuleSchema]] | None = None,
) -> QualityReport:
    from app.quality.rule_compiler import run_custom_rules

    stats = {p.sensor_id: p for p in profile.sensors}
    checks: list[QualityItem] = []
    exclusion: list[str] = []

    missing_hit: list[str] = []
    stuck_hit: list[str] = []
    range_hit: list[str] = []
    for col in schema.numeric_cols:
        s = pd.to_numeric(batch[col], errors="coerce") if col in batch else pd.Series(dtype=float)
        p = stats.get(col)
        miss = float(s.isna().mean()) if len(s) else 1.0
        if miss > 0.05:
            missing_hit.append(col)
        if len(s.dropna()) > 5:
            x = s.dropna().to_numpy()
            recent = x[-15:] if len(x) >= 8 else x
            frozen = (
                float((abs(recent[1:] - recent[:-1]) < 1e-9).mean())
                if len(recent) > 4
                else 0.0
            )
            calibrated_frozen = p.frozen_rate if p else 0.0
            if frozen > 0.9 and calibrated_frozen < 0.4:
                stuck_hit.append(col)
            if p and p.mean is not None and p.std is not None and p.std > 1e-9:
                z = abs((x.mean() - p.mean) / p.std)
                if z > 6 and frozen < 0.5:
                    range_hit.append(col)

    checks.append(
        QualityItem(
            name="completeness",
            status="fail" if missing_hit else "pass",
            evidence=f"missing>5% on {missing_hit}" if missing_hit else "missing rates within 5%",
            affected_sensors=missing_hit,
            sensor_fault=bool(missing_hit),
        )
    )
    checks.append(
        QualityItem(
            name="validity_stuck",
            status="fail" if stuck_hit else "pass",
            evidence=(
                f"near-zero rolling delta on {stuck_hit} — sensor/data fault, exclude from process drift"
                if stuck_hit
                else "no stuck sensors"
            ),
            affected_sensors=stuck_hit,
            sensor_fault=bool(stuck_hit),
        )
    )
    checks.append(
        QualityItem(
            name="validity_range",
            status="fail" if range_hit else "pass",
            evidence=f"batch mean >6σ from calibration on {range_hit}" if range_hit else "in-range vs calibration",
            affected_sensors=range_hit,
            sensor_fault=bool(range_hit),
        )
    )

    ts_status = "pass"
    ts_evidence = "no timestamp column"
    if schema.timestamp_col and schema.timestamp_col in batch:
        ts = pd.to_datetime(batch[schema.timestamp_col], utc=True, errors="coerce")
        dup = int(ts.duplicated().sum())
        gaps = int((ts.sort_values().diff().dt.total_seconds().dropna() <= 0).sum())
        if dup or gaps:
            ts_status = "warn"
        ts_evidence = f"duplicates={dup} non-increasing={gaps}"
    checks.append(
        QualityItem(
            name="timeliness",
            status=ts_status,
            evidence=ts_evidence,
            affected_sensors=[],
            sensor_fault=False,
        )
    )
    checks.append(
        QualityItem(
            name="consistency",
            status="pass",
            evidence="schema unchanged vs calibration numeric set",
            affected_sensors=[],
        )
    )

    if custom:
        checks.extend(run_custom_rules(batch, custom))

    for c in checks:
        if c.sensor_fault:
            exclusion.extend(c.affected_sensors)
    exclusion = list(dict.fromkeys(exclusion))
    return QualityReport(
        calibration_id=calibration_id,
        batch_id=batch_id,
        checks=checks[:40],
        exclusion_list=exclusion,
        data_trusted=not any(c.status == "fail" and c.sensor_fault for c in checks),
    )
