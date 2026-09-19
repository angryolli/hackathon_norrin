"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  browserGet,
  browserPost,
  type MonitorSnapshot,
  type RuntimeConfig,
} from "@/lib/browser-api";

type SimulationContextValue = {
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  togglePlay: () => Promise<void>;
};

const SimulationContext = createContext<SimulationContextValue>({
  playing: false,
  setPlaying: () => undefined,
  togglePlay: async () => undefined,
});

export function SimulationProvider({ children }: { children: React.ReactNode }) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    void browserGet<RuntimeConfig>("/config")
      .then((data) => setPlaying(Boolean(data.playing)))
      .catch(() => undefined);
  }, []);

  const value = useMemo<SimulationContextValue>(
    () => ({
      playing,
      setPlaying,
      togglePlay: async () => {
        const snap = await browserPost<MonitorSnapshot>("/stream/control", {
          playing: !playing,
        });
        setPlaying(Boolean(snap.playing));
      },
    }),
    [playing],
  );

  return (
    <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>
  );
}

export function useSimulation() {
  return useContext(SimulationContext);
}
