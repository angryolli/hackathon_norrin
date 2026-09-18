from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from app.config import PCA_MAX_COMPONENTS
from app.ingestion.loader import DetectedSchema


@dataclass
class DriftModel:
    columns: list[str]
    mean: np.ndarray
    std: np.ndarray
    loadings: np.ndarray
    eig: np.ndarray
    t2_limit: float
    spe_limit: float
    cusum_mu: float
    cusum_sigma: float


def fit_drift_model(df: pd.DataFrame, schema: DetectedSchema) -> DriftModel:
    cols = schema.numeric_cols
    x = df[cols].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=float)
    mean = np.nanmean(x, axis=0)
    std = np.nanstd(x, axis=0)
    std = np.where(std < 1e-9, 1.0, std)
    z = (x - mean) / std
    z = np.nan_to_num(z)
    u, s, vt = np.linalg.svd(z, full_matrices=False)
    k = max(1, min(PCA_MAX_COMPONENTS, z.shape[1] - 1, z.shape[0] - 1))
    loadings = vt[:k].T
    eig = (s[:k] ** 2) / max(z.shape[0] - 1, 1)
    eig = np.where(eig < 1e-9, 1e-9, eig)
    t2, spe = _scores(z, loadings, eig)
    return DriftModel(
        columns=cols,
        mean=mean,
        std=std,
        loadings=loadings,
        eig=eig,
        t2_limit=float(np.quantile(t2, 0.95)),
        spe_limit=float(np.quantile(spe, 0.95)),
        cusum_mu=float(t2.mean()),
        cusum_sigma=float(t2.std() + 1e-9),
    )


def _scores(z: np.ndarray, loadings: np.ndarray, eig: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    scores = z @ loadings
    t2 = np.sum((scores ** 2) / eig, axis=1)
    recon = scores @ loadings.T
    spe = np.sum((z - recon) ** 2, axis=1)
    return t2, spe


def contributions(z_row: np.ndarray, loadings: np.ndarray, eig: np.ndarray) -> np.ndarray:
    scores = z_row @ loadings
    recon = scores @ loadings.T
    return np.abs(z_row - recon) + np.abs(z_row) * 0.25
