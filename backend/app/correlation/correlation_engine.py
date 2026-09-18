from __future__ import annotations

import numpy as np
import pandas as pd

from app.config import TOP_CORR_PAIRS
from app.ingestion.loader import DetectedSchema
from app.models.schemas import Cluster, CorrelationArtifact, CorrelationPair


def _lagged(a: np.ndarray, b: np.ndarray, max_lag: int = 8) -> tuple[int, float]:
    best_lag, best = 0, -2.0
    n = min(len(a), len(b))
    if n < 12:
        return 0, 0.0
    for lag in range(-max_lag, max_lag + 1):
        if lag < 0:
            x, y = a[-lag:n], b[: n + lag]
        elif lag > 0:
            x, y = a[: n - lag], b[lag:n]
        else:
            x, y = a[:n], b[:n]
        if len(x) < 8 or x.std() < 1e-12 or y.std() < 1e-12:
            continue
        r = float(np.corrcoef(x, y)[0, 1])
        if abs(r) > abs(best):
            best, best_lag = r, lag
    return best_lag, best if best > -2 else 0.0


def _components(pairs: list[CorrelationPair], thresh: float = 0.55) -> list[Cluster]:
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        if parent[x] != x:
            parent[x] = find(parent[x])
        return parent[x]

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for p in pairs:
        if abs(p.pearson) >= thresh:
            union(p.a, p.b)
    groups: dict[str, list[str]] = {}
    for node in parent:
        groups.setdefault(find(node), []).append(node)
    clusters = []
    for i, members in enumerate(groups.values()):
        if len(members) < 2:
            continue
        clusters.append(
            Cluster(
                cluster_id=f"cluster_{i}",
                members=sorted(members)[:40],
                evidence=f"{len(members)} sensors linked at |r|>={thresh}",
            )
        )
    return clusters[:12]


def correlate(df: pd.DataFrame, schema: DetectedSchema, calibration_id: str) -> CorrelationArtifact:
    cols = schema.numeric_cols
    if len(cols) < 2:
        return CorrelationArtifact(calibration_id=calibration_id, pairs=[], clusters=[])
    mat = df[cols].apply(pd.to_numeric, errors="coerce")
    pearson = mat.corr(method="pearson")
    spearman = mat.corr(method="spearman")
    scored: list[tuple[float, CorrelationPair]] = []
    for i, a in enumerate(cols):
        xa = mat[a].to_numpy(dtype=float)
        for b in cols[i + 1 :]:
            pr = pearson.loc[a, b]
            sp = spearman.loc[a, b]
            if pd.isna(pr):
                continue
            lag, lagged = _lagged(xa, mat[b].to_numpy(dtype=float))
            pair = CorrelationPair(
                a=a,
                b=b,
                pearson=float(pr),
                spearman=float(sp) if not pd.isna(sp) else float(pr),
                best_lag=int(lag),
                lagged_corr=float(lagged),
                evidence=f"pearson={float(pr):.3f} spearman={float(sp) if not pd.isna(sp) else 0:.3f} best_lag={lag} lagged={lagged:.3f}",
            )
            scored.append((abs(float(pr)), pair))
    scored.sort(key=lambda t: t[0], reverse=True)
    pairs = [p for _, p in scored[:TOP_CORR_PAIRS]]
    return CorrelationArtifact(
        calibration_id=calibration_id,
        pairs=pairs,
        clusters=_components(pairs),
    )
