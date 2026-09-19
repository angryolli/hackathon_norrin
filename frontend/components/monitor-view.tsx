"use client";

import { useEffect, useState } from "react";
import { SensorChart } from "@/components/sensor-chart";
import { StatusChip } from "@/components/status-chip";
import { browserGet, type MonitorSnapshot } from "@/lib/browser-api";

export function MonitorView() {
  const [snap, setSnap] = useState<MonitorSnapshot | null>(null);

  useEffect(() => {
    let on = true;
    async function poll() {
      try {
        const data = await browserGet<MonitorSnapshot>("/monitor/snapshot");
        if (on) setSnap(data);
      } catch {
        if (on) setSnap(null);
      }
    }
    void poll();
    const id = setInterval(() => void poll(), 900);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, []);

  const sensors = [...(snap?.sensors ?? [])].sort((a, b) => {
    const an = Number.parseInt(a.sensor_id.replace(/\D/g, ""), 10);
    const bn = Number.parseInt(b.sensor_id.replace(/\D/g, ""), 10);
    const av = Number.isFinite(an) ? an : Number.POSITIVE_INFINITY;
    const bv = Number.isFinite(bn) ? bn : Number.POSITIVE_INFINITY;
    return av !== bv ? av - bv : a.sensor_id.localeCompare(b.sensor_id);
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-4">
      {sensors.map((sensor) => (
        <div
          key={sensor.sensor_id}
          className="w-full rounded-xl border border-border bg-card p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-sm">{sensor.sensor_id}</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-muted-foreground">
                contrib {sensor.contribution.toFixed(2)}
              </span>
              <StatusChip status={sensor.status} />
            </div>
          </div>
          <div className="mt-2 h-28">
            <SensorChart
              values={sensor.sparkline}
              tick={snap?.tick}
              className="h-28"
              accent="rgb(82, 82, 91)"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
