from __future__ import annotations

import numpy as np
import pandas as pd

from app.drift.calibration import DriftModel, _scores, contributions
from app.models.schemas import Contribution, DriftArtifact, DriftEvent


def score_batch(
    batch: pd.DataFrame,
    model: DriftModel,
    calibration_id: str,
    batch_id: str,
    tick: int,
    exclusion: list[str],
    next_event_index: int,
) -> DriftArtifact:
    cols = model.columns
    x = batch.reindex(columns=cols).apply(pd.to_numeric, errors="coerce").to_numpy(dtype=float)
    z = (x - model.mean) / model.std
    z = np.nan_to_num(z)
    for i, col in enumerate(cols):
        if col in exclusion:
            z[:, i] = 0.0
    t2, spe = _scores(z, model.loadings, model.eig)
    composite_t2 = float(np.nanmean(t2)) if t2.size else 0.0
    composite_spe = float(np.nanmean(spe)) if spe.size else 0.0
    limit = model.t2_limit
    flags = t2 > limit if t2.size else np.array([])
    series = [float(v) for v in t2[-60:]]
    events: list[DriftEvent] = []
    latest = None
    if flags.any():
        idx = int(np.argmax(t2))
        z_row = z[idx]
        contrib = contributions(z_row, model.loadings, model.eig)
        ranked = np.argsort(contrib)[::-1]
        contribs = []
        for j in ranked[:10]:
            if cols[j] in exclusion:
                continue
            contribs.append(
                Contribution(
                    sensor_id=cols[j],
                    contribution_score=float(contrib[j]),
                    evidence=f"|recon-error|+0.25|z|={float(contrib[j]):.3f} T2={float(t2[idx]):.3f} vs limit {limit:.3f}",
                )
            )
        latest = f"evt_{next_event_index}"
        events.append(
            DriftEvent(
                event_id=latest,
                t_start=max(tick - len(t2) + idx, 0),
                t_end=tick,
                t2=float(t2[idx]),
                spe=float(spe[idx]),
                control_limit=limit,
                flagged=True,
                contributions=contribs,
                evidence=f"T2={float(t2[idx]):.3f} exceeded frozen 99% limit {limit:.3f}; SPE={float(spe[idx]):.3f}",
            )
        )
    cusum = float(np.clip((composite_t2 - model.cusum_mu) / model.cusum_sigma, 0, 20))
    return DriftArtifact(
        calibration_id=calibration_id,
        batch_id=batch_id,
        composite_t2=composite_t2,
        composite_spe=composite_spe,
        control_limit=limit,
        cusum=cusum,
        series=series,
        events=events,
        latest_event_id=latest,
    )
