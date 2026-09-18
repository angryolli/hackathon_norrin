"use client";

import { useEffect, useState } from "react";
import { SensorChart } from "@/components/sensor-chart";
import { StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  browserGet,
  type MonitorSnapshot,
  type SensorCard,
} from "@/lib/browser-api";

export function MonitorView() {
  const [snap, setSnap] = useState<MonitorSnapshot | null>(null);
  const [selected, setSelected] = useState<SensorCard | null>(null);
  const [rolesText, setRolesText] = useState<string>("");

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

  useEffect(() => {
    setSelected((cur) => {
      if (!cur || !snap) return cur;
      return snap.sensors.find((s) => s.sensor_id === cur.sensor_id) ?? cur;
    });
  }, [snap]);

  async function inferRoles() {
    const res = await fetch("/api/agents/roles", { method: "POST" });
    const data = await res.json();
    setRolesText(data.text || data.error || "");
  }

  const sensors = [...(snap?.sensors ?? [])].sort((a, b) => {
    const an = Number.parseInt(a.sensor_id.replace(/\D/g, ""), 10);
    const bn = Number.parseInt(b.sensor_id.replace(/\D/g, ""), 10);
    const av = Number.isFinite(an) ? an : Number.POSITIVE_INFINITY;
    const bv = Number.isFinite(bn) ? bn : Number.POSITIVE_INFINITY;
    return av !== bv ? av - bv : a.sensor_id.localeCompare(b.sensor_id);
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <Card className="shrink-0">
        <CardHeader>
          <CardTitle className="font-mono text-sm">Composite T²</CardTitle>
          <CardDescription>
            Frozen baseline limit {snap?.control_limit.toFixed(2) ?? "—"} · tick{" "}
            {snap?.tick ?? 0}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-40">
            <SensorChart
              values={snap?.t2_series ?? []}
              tick={snap?.tick}
              className="h-40"
              limit={snap?.control_limit}
              accent="rgb(52, 211, 153)"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="shrink-0">
        <CardHeader>
          <CardTitle className="text-sm">Sensor detail</CardTitle>
          <CardDescription>
            {selected?.sensor_id ?? "Click a stream"}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm lg:grid-cols-[1fr_18rem]">
          <div className="space-y-2">
            {selected ? (
              <>
                <StatusChip status={selected.status} />
                <p className="font-mono text-xs leading-relaxed">
                  {selected.evidence}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">No sensor selected.</p>
            )}
          </div>
          <div>
            <Button size="sm" onClick={() => void inferRoles()}>
              Run role inference
            </Button>
            <RuleBox />
            {rolesText && (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                {rolesText}
              </pre>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {sensors.map((sensor) => (
          <button
            key={sensor.sensor_id}
            type="button"
            onClick={() => setSelected(sensor)}
            className={`w-full rounded-xl border bg-card p-3 text-left hover:bg-muted/40 ${
              selected?.sensor_id === sensor.sensor_id
                ? "border-primary/60"
                : "border-border"
            }`}
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
                accent="rgb(125, 211, 252)"
              />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function RuleBox() {
  const [text, setText] = useState("");
  const [out, setOut] = useState("");
  async function run() {
    const res = await fetch("/api/rules/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rule_text: text }),
    });
    setOut(JSON.stringify(await res.json(), null, 2));
  }
  return (
    <div className="space-y-2 pt-2">
      <p className="text-xs text-muted-foreground">Plain-language rule</p>
      <textarea
        className="min-h-16 w-full rounded-lg border border-input bg-transparent p-2 font-mono text-xs"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Flag c00 if it stays stuck for 20 samples"
      />
      <Button size="sm" variant="outline" onClick={() => void run()}>
        Compile rule
      </Button>
      {out && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
          {out}
        </pre>
      )}
    </div>
  );
}
