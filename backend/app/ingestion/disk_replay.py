from __future__ import annotations

import csv
import re
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock

from app.config import SPARKLINE_POINTS

_SKIP_NAME = re.compile(r"(fault|label|idv|class|target|^source$|^run$|^sample$|^unnamed)", re.I)


@dataclass
class DiskReplaySource:
    """Replay a CSV from disk one row per tick. Never loads the full file."""

    path: Path
    tick: int = 0
    numeric_cols: list[str] = field(default_factory=list)
    sparklines: dict[str, deque[float]] = field(default_factory=dict)
    lock: Lock = field(default_factory=Lock)
    _fh: object | None = None
    _reader: object | None = None
    _header: list[str] = field(default_factory=list)
    _numeric_idx: list[int] = field(default_factory=list)

    def open(self) -> None:
        self.path = Path(self.path)
        if not self.path.is_file():
            raise FileNotFoundError(self.path)
        with self.path.open("r", newline="", encoding="utf-8", errors="replace") as fh:
            reader = csv.reader(fh)
            header = next(reader, None)
            if not header:
                raise ValueError(f"empty CSV: {self.path}")
            self._header = [str(c).strip() for c in header]
            sample = next(reader, None)
        self.numeric_cols = _numeric_columns(self._header, sample)
        index = {name: i for i, name in enumerate(self._header)}
        self._numeric_idx = [index[col] for col in self.numeric_cols]
        self.sparklines = {
            col: deque(maxlen=SPARKLINE_POINTS) for col in self.numeric_cols
        }
        self._rewind()

    def _rewind(self) -> None:
        if self._fh is not None:
            self._fh.close()
        fh = self.path.open("r", newline="", encoding="utf-8", errors="replace")
        reader = csv.reader(fh)
        next(reader, None)
        self._fh = fh
        self._reader = reader

    def emit(self) -> None:
        with self.lock:
            if self._reader is None:
                return
            row = next(self._reader, None)
            if row is None:
                self._rewind()
                row = next(self._reader, None) if self._reader is not None else None
            if row is None:
                return
            for col, idx in zip(self.numeric_cols, self._numeric_idx):
                if idx >= len(row):
                    continue
                raw = row[idx]
                if raw == "":
                    continue
                try:
                    self.sparklines[col].append(round(float(raw), 3))
                except (TypeError, ValueError):
                    continue
            self.tick += 1

    def cards(self) -> list[tuple[str, list[float]]]:
        with self.lock:
            return [
                (col, list(self.sparklines.get(col, ())))
                for col in self.numeric_cols
            ]

    def close(self) -> None:
        with self.lock:
            if self._fh is not None:
                self._fh.close()
            self._fh = None
            self._reader = None


def _numeric_columns(header: list[str], sample: list[str] | None) -> list[str]:
    sample = sample or []
    cols: list[str] = []
    for i, name in enumerate(header):
        if not name or _SKIP_NAME.search(name):
            continue
        if i >= len(sample):
            cols.append(name)
            continue
        raw = sample[i].strip()
        if raw == "":
            continue
        try:
            float(raw)
        except ValueError:
            continue
        cols.append(name)
    return cols[:80]
