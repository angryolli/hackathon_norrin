"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  browserGet,
  browserPost,
  type MonitorSnapshot,
  type RuntimeConfig,
} from "@/lib/browser-api";

const DEFAULT_TPS = 2.22;
export const MIN_TICKS_PER_SECOND = 0.5;
export const MAX_TICKS_PER_SECOND = 20;

type SimulationContextValue = {
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  togglePlay: () => Promise<void>;
  ticksPerSecond: number;
  setTicksPerSecond: (rate: number) => Promise<void>;
  applySnapshot: (snap: {
    playing?: boolean | null;
    ticks_per_second?: number | null;
  }) => void;
};

const SimulationContext = createContext<SimulationContextValue>({
  playing: false,
  setPlaying: () => undefined,
  togglePlay: async () => undefined,
  ticksPerSecond: DEFAULT_TPS,
  setTicksPerSecond: async () => undefined,
  applySnapshot: () => undefined,
});

function clampRate(rate: number) {
  if (!Number.isFinite(rate)) return DEFAULT_TPS;
  return Math.min(MAX_TICKS_PER_SECOND, Math.max(MIN_TICKS_PER_SECOND, rate));
}

export function SimulationProvider({ children }: { children: React.ReactNode }) {
  const [playing, setPlaying] = useState(false);
  const [ticksPerSecond, setTicksPerSecondState] = useState(DEFAULT_TPS);

  useEffect(() => {
    void browserGet<RuntimeConfig>("/config")
      .then((data) => {
        setPlaying(Boolean(data.playing));
        if (data.ticks_per_second != null) {
          setTicksPerSecondState(clampRate(data.ticks_per_second));
        }
      })
      .catch(() => undefined);
  }, []);

  const togglePlay = useCallback(async () => {
    const snap = await browserPost<MonitorSnapshot>("/stream/control", {
      playing: !playing,
    });
    setPlaying(Boolean(snap.playing));
    if (snap.ticks_per_second != null) {
      setTicksPerSecondState(clampRate(snap.ticks_per_second));
    }
  }, [playing]);

  const setTicksPerSecond = useCallback(async (rate: number) => {
    const next = clampRate(rate);
    setTicksPerSecondState(next);
    const snap = await browserPost<MonitorSnapshot>("/stream/control", {
      ticks_per_second: next,
    });
    if (snap.ticks_per_second != null) {
      setTicksPerSecondState(clampRate(snap.ticks_per_second));
    }
    if (snap.playing != null) setPlaying(Boolean(snap.playing));
  }, []);

  const applySnapshot = useCallback(
    (snap: { playing?: boolean | null; ticks_per_second?: number | null }) => {
      if (snap.playing != null) setPlaying(Boolean(snap.playing));
      if (snap.ticks_per_second != null) {
        setTicksPerSecondState(clampRate(snap.ticks_per_second));
      }
    },
    [],
  );

  const value = useMemo<SimulationContextValue>(
    () => ({
      playing,
      setPlaying,
      togglePlay,
      ticksPerSecond,
      setTicksPerSecond,
      applySnapshot,
    }),
    [playing, togglePlay, ticksPerSecond, setTicksPerSecond, applySnapshot],
  );

  return (
    <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>
  );
}

export function useSimulation() {
  return useContext(SimulationContext);
}
