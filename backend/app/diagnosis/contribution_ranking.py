from __future__ import annotations

from app.models.schemas import CorrelationArtifact, DriftEvent, RankingArtifact


def rank_event(
    event: DriftEvent,
    corr: CorrelationArtifact,
    calibration_id: str,
) -> RankingArtifact:
    ranked = []
    for c in event.contributions[:10]:
        partners = [
            p
            for p in corr.pairs
            if c.field_id in (p.a, p.b)
        ]
        top = partners[0] if partners else None
        other = None
        lag = None
        if top:
            other = top.b if top.a == c.field_id else top.a
            lag = top.best_lag
        ranked.append(
            {
                "field": c.field_id,
                "contribution_score": c.contribution_score,
                "correlation_evidence": (
                    f"{c.field_id} vs {other} pearson={top.pearson:.3f}"
                    if top and other
                    else "no strong pair in top-k graph"
                ),
                "lag_evidence": (
                    f"best_lag={lag} lagged_corr={top.lagged_corr:.3f}"
                    if top and top.lagged_corr is not None
                    else "lag not estimated"
                ),
                "evidence": c.evidence,
            }
        )
    peak = ranked[0]["contribution_score"] if ranked else 0.0
    total = sum(r["contribution_score"] for r in ranked) or 1.0
    conf = min(0.95, 0.35 + 0.6 * (peak / total))
    return RankingArtifact(
        event_id=event.event_id,
        calibration_id=calibration_id,
        ranked=ranked,
        evidence=event.evidence,
        confidence=round(conf, 3),
    )
