from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from threading import Lock

import numpy as np
import pandas as pd

from app.config import DATA_DIR, LIVE_BUFFER


def _industrial_columns() -> list[str]:
    return [f"c{i:02d}" for i in range(14)]


@dataclass
class RollingSource:
    dataset_id: str = "industrial_stream"
    generator: str = "industrial"
    origin: str = "generator"
    api_url: str = ""
    api_poll: bool = False
    playback: list[dict] = field(default_factory=list)
    tick: int = 0
    live: deque[dict] = field(default_factory=lambda: deque(maxlen=LIVE_BUFFER))
    lock: Lock = field(default_factory=Lock)
    rng: np.random.Generator = field(default_factory=lambda: np.random.default_rng(7))
    last_values: dict[str, float] = field(default_factory=dict)
    frozen: dict[str, float] = field(default_factory=dict)

    def reset(self, dataset_id: str, generator: str | None = None) -> None:
        with self.lock:
            self.dataset_id = dataset_id
            self.origin = "generator"
            self.api_url = ""
            self.api_poll = False
            self.playback = []
            if generator:
                self.generator = generator
            elif dataset_id == "expenses":
                self.generator = "expenses"
            else:
                self.generator = "industrial"
            self.tick = 0
            self.live.clear()
            self.last_values.clear()
            self.frozen.clear()
            self.rng = np.random.default_rng(7)

    def reset_from_spec(self, spec: dict) -> None:
        from app.ingestion.files import dataframe_from_api, dataframe_to_rows

        origin = spec.get("origin") or "generator"
        with self.lock:
            self.dataset_id = spec["id"]
            self.origin = origin
            self.generator = spec.get("generator") or "industrial"
            self.api_url = spec.get("api_url") or ""
            self.tick = 0
            self.live.clear()
            self.last_values.clear()
            self.frozen.clear()
            self.rng = np.random.default_rng(7)
            self.playback = []
            self.api_poll = False
            path = spec.get("file_path") or spec.get("live_path") or spec.get("train_path")
            if origin in ("file", "api") and path:
                frame = pd.read_csv(path)
                rows = dataframe_to_rows(frame)
                self.playback = rows
                self.api_poll = origin == "api" and len(rows) <= 1 and bool(self.api_url)
            if origin == "api" and self.api_poll and self.api_url:
                try:
                    fetched = dataframe_to_rows(dataframe_from_api(self.api_url))
                    if fetched:
                        self.playback = fetched
                except Exception:
                    pass

    def _row_industrial(self, t: int, fault: int, *, live: bool) -> dict:
        cols = _industrial_columns()
        actuators = []
        for i in range(4):
            level = 40 + 10 * i + 8 * math.sin(t / (80 + 15 * i))
            actuators.append(round(level * 2) / 2)

        values = []
        for i in range(10):
            ar = 0.86 * self.last_values.get(cols[i], 50 + i)
            couple = 0.18 * actuators[i % 4]
            neighbor = 0.12 * (values[i - 1] if i else 50)
            noise = float(self.rng.normal(0, 0.7 + 0.05 * i))
            drift = 0.0
            if live and t > 90 and i in (0, 1):
                drift = 0.16 * (t - 90) * (1.0 if i == 0 else 0.6)
            values.append(ar * 0.15 + couple + neighbor + noise + (12 + 3 * i) + drift)

        if live and t >= 70:
            self.frozen.setdefault(cols[7], values[7])
            values[7] = self.frozen[cols[7]]

        row: dict = {
            "ts": (
                datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=t)
            ).isoformat()
        }
        for i, col in enumerate(cols[:10]):
            row[col] = values[i]
            self.last_values[col] = values[i]
        for i, col in enumerate(cols[10:]):
            row[col] = actuators[i]
            self.last_values[col] = actuators[i]
        row["fault_id"] = fault
        return row

    def _row_expenses(self, t: int, fault: int, *, live: bool) -> dict:
        vendors = ["acme", "northwind", "contoso"]
        depts = ["ops", "finance", "field"]
        curr = ["EUR", "USD"]
        drift = 18.0 * max(0, t - 100) / 40 if live and t > 100 else 0
        amount = max(8.0, float(self.rng.normal(42 + drift, 6)))
        qty = max(1.0, float(self.rng.integers(1, 8)))
        return {
            "ts": (
                datetime(2024, 6, 1, tzinfo=timezone.utc) + timedelta(hours=t)
            ).isoformat(),
            "amount": amount,
            "quantity": qty,
            "unit_price": amount / qty,
            "vendor": vendors[t % 3],
            "department": depts[(t // 2) % 3],
            "currency": curr[t % 2],
            "fault_id": fault,
        }

    def make_row(self, t: int, *, live: bool = True) -> dict:
        fault = 1 if live and t >= 90 else 0
        if self.generator == "expenses":
            return self._row_expenses(t, fault, live=live)
        return self._row_industrial(t, fault, live=live)

    def generate_frame(self, n: int, start: int = 0, fault_free: bool = False) -> pd.DataFrame:
        rows = []
        saved = dict(self.last_values)
        frozen = dict(self.frozen)
        self.last_values.clear()
        self.frozen.clear()
        rng_state = self.rng.bit_generator.state
        self.rng = np.random.default_rng(11 if fault_free else 19)
        for i in range(n):
            rows.append(self.make_row(start + i, live=not fault_free))
        self.rng.bit_generator.state = rng_state
        self.last_values = saved
        self.frozen = frozen
        return pd.DataFrame(rows)

    def seed_calibration_csv(
        self,
        train_path: str | None = None,
        live_path: str | None = None,
    ) -> None:
        from pathlib import Path

        DATA_DIR.mkdir(parents=True, exist_ok=True)
        train = self.generate_frame(500, start=0, fault_free=True)
        test = self.generate_frame(250, start=0, fault_free=False)
        train_file = Path(train_path) if train_path else DATA_DIR / (
            "second_domain.csv" if self.generator == "expenses" else "train.csv"
        )
        live_file = Path(live_path) if live_path else DATA_DIR / (
            "second_domain_live.csv" if self.generator == "expenses" else "test.csv"
        )
        train_file.parent.mkdir(parents=True, exist_ok=True)
        train.to_csv(train_file, index=False)
        test.to_csv(live_file, index=False)

    def emit(self) -> None:
        with self.lock:
            if self.origin in ("file", "api") and (self.playback or self.api_poll):
                row = self._playback_row()
                if row is not None:
                    self.live.append(row)
                    self.tick += 1
                return
            row = self.make_row(self.tick, live=True)
            self.live.append(row)
            self.tick += 1

    def _playback_row(self) -> dict | None:
        from app.ingestion.files import dataframe_from_api, dataframe_to_rows

        if self.api_poll and self.api_url:
            try:
                fetched = dataframe_to_rows(dataframe_from_api(self.api_url, timeout=2.0))
                if fetched:
                    self.playback = fetched
            except Exception:
                pass
        if not self.playback:
            return None
        return dict(self.playback[self.tick % len(self.playback)])

    def sparkline_map(self, cols: list[str], n: int) -> dict[str, list[float]]:
        with self.lock:
            rows = list(self.live)[-n:]
        out: dict[str, list[float]] = {c: [] for c in cols}
        for row in rows:
            for col in cols:
                value = row.get(col)
                if value is None:
                    continue
                try:
                    out[col].append(round(float(value), 3))
                except (TypeError, ValueError):
                    continue
        return out

    def live_frame(self) -> pd.DataFrame:
        with self.lock:
            return pd.DataFrame(list(self.live))

    def latest_batch(self, n: int = 40) -> pd.DataFrame:
        with self.lock:
            rows = list(self.live)[-n:]
        return pd.DataFrame(rows)
