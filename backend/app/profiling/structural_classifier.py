from __future__ import annotations

from app.models.schemas import (
    CorrelationArtifact,
    ProfileArtifact,
    RolesArtifact,
    StructuralRole,
)


def classify_roles(
    profile: ProfileArtifact, corr: CorrelationArtifact
) -> RolesArtifact:
    degree: dict[str, float] = {p.sensor_id: 0.0 for p in profile.sensors}
    for pair in corr.pairs:
        w = abs(pair.pearson)
        degree[pair.a] = degree.get(pair.a, 0) + w
        degree[pair.b] = degree.get(pair.b, 0) + w
    max_deg = max(degree.values()) if degree else 1.0

    roles: list[StructuralRole] = []
    for p in profile.sensors:
        quant = max(0.0, 1.0 - p.unique_ratio)
        if p.std and p.std > 0 and p.min is not None and p.max is not None:
            span = p.max - p.min
            bounded = float(min(1.0, (abs(p.mean - p.min) + abs(p.max - p.mean)) and 0 or 0))
            edge_mass = 0.0
            if span > 0:
                edge_mass = min(1.0, (p.std / span) * 2)
            bounded = max(0.0, 1.0 - edge_mass)
        else:
            bounded = 0.0
        centrality = degree.get(p.sensor_id, 0) / max(max_deg, 1e-9)
        if quant > 0.55 and bounded > 0.45:
            role = "actuator"
        elif quant < 0.25:
            role = "measured"
        else:
            role = "ambiguous"
        roles.append(
            StructuralRole(
                sensor_id=p.sensor_id,
                role=role,
                quantization_score=round(quant, 4),
                bounded_range_score=round(bounded, 4),
                lag_centrality_score=round(centrality, 4),
                evidence=(
                    f"unique_ratio={p.unique_ratio:.3f} frozen={p.frozen_rate:.3f} "
                    f"lag1={p.lag1_autocorr} centrality={centrality:.3f}"
                ),
            )
        )
    return RolesArtifact(calibration_id=profile.calibration_id, roles=roles)
