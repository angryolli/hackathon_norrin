from schemas import (
    CorrelationEdge,
    DriftFinding,
    PipelineArtifacts,
    QualityCheck,
    RankedSensor,
    SensorProfile,
)


def demo_artifacts() -> PipelineArtifacts:
    """Derived fingerprints only. Never include raw rows."""
    profiles = [
        SensorProfile(
            column_id="col_00",
            n=10000,
            mean=0.27,
            std=0.04,
            min=0.12,
            max=0.41,
            missing_rate=0.0,
            frozen_rate=0.0,
            lag1_autocorr=0.91,
            likely_kind_hint="measured",
        ),
        SensorProfile(
            column_id="col_01",
            n=10000,
            mean=3664.0,
            std=18.2,
            min=3601.0,
            max=3720.0,
            missing_rate=0.0,
            frozen_rate=0.0,
            lag1_autocorr=0.88,
            likely_kind_hint="measured",
        ),
        SensorProfile(
            column_id="col_07",
            n=10000,
            mean=65.0,
            std=0.0,
            min=65.0,
            max=65.0,
            missing_rate=0.0,
            frozen_rate=1.0,
            lag1_autocorr=1.0,
            likely_kind_hint="measured",
        ),
        SensorProfile(
            column_id="col_12",
            n=10000,
            mean=50.0,
            std=3.1,
            min=42.0,
            max=58.0,
            missing_rate=0.002,
            frozen_rate=0.0,
            lag1_autocorr=0.97,
            likely_kind_hint="manipulated",
        ),
        SensorProfile(
            column_id="col_18",
            n=10000,
            mean=120.4,
            std=22.8,
            min=80.1,
            max=188.0,
            missing_rate=0.0,
            frozen_rate=0.0,
            lag1_autocorr=0.74,
            likely_kind_hint="measured",
        ),
    ]

    quality = [
        QualityCheck(
            check_id="completeness",
            category="completeness",
            name="Missing values",
            status="warn",
            evidence="col_12 missing_rate=0.002; all others 0",
        ),
        QualityCheck(
            check_id="stuck_sensor",
            category="validity",
            name="Frozen / stuck signal",
            status="fail",
            evidence="col_07 std=0 and frozen_rate=1.0 over the full window",
        ),
        QualityCheck(
            check_id="timeliness",
            category="timeliness",
            name="Timestamp gaps",
            status="pass",
            evidence="No duplicate or gapped timestamps in the processed window",
        ),
    ]

    correlations = [
        CorrelationEdge(a="col_00", b="col_01", corr=0.82, lag=2, lagged_corr=0.87),
        CorrelationEdge(a="col_12", b="col_00", corr=-0.61, lag=1, lagged_corr=-0.70),
        CorrelationEdge(a="col_18", b="col_01", corr=0.44, lag=0, lagged_corr=0.44),
        CorrelationEdge(a="col_07", b="col_00", corr=0.01, lag=0, lagged_corr=0.01),
    ]

    drift = [
        DriftFinding(
            signal_id="col_18",
            kind="gradual",
            score=0.78,
            evidence="Mean shifted +1.6σ vs baseline window; variance also rising",
        ),
        DriftFinding(
            signal_id="col_01",
            kind="gradual",
            score=0.41,
            evidence="Slow mean drift +0.7σ, lagged with col_18",
        ),
    ]

    ranked = [
        RankedSensor(
            signal_id="col_18",
            contribution=0.62,
            evidence="Largest baseline deviation among non-frozen signals",
        ),
        RankedSensor(
            signal_id="col_01",
            contribution=0.24,
            evidence="Moves with col_18 at lag 0; smaller magnitude",
        ),
        RankedSensor(
            signal_id="col_00",
            contribution=0.09,
            evidence="Secondary correlated measured variable",
        ),
    ]

    data_trusted = not any(c.status == "fail" for c in quality)

    return PipelineArtifacts(
        profiles=profiles,
        quality=quality,
        correlations=correlations,
        drift=drift,
        ranked_sensors=ranked,
        data_trusted=data_trusted,
        notes=[
            "Demo artifacts for agent wiring. Replace with live pipeline stats.",
            "col_07 failed validity (stuck). Treat as data-quality, not process fault.",
        ],
    )
