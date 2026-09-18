"use client";

import { useEffect, useState } from "react";
import { Sparkline } from "@/components/sparkline";
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

  async function inferRoles() {
    const res = await fetch("/api/agents/roles", { method: "POST" });
    const data = await res.json();
    setRolesText(data.text || data.error || "");
  }

  const maxT2 = Math.max(
    snap?.control_limit ?? 1,
    ...(snap?.t2_series ?? [1]),
  );

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-sm">Composite T²</CardTitle>
            <CardDescription>
              Frozen baseline limit {snap?.control_limit.toFixed(2) ?? "—"} · tick{" "}
              {snap?.tick ?? 0}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative h-24 font-mono text-emerald-300">
              <Sparkline values={snap?.t2_series ?? []} className="h-24" />
              {snap && (
                <div
                  className="absolute inset-x-0 border-t border-dashed border-amber-400/70"
                  style={{
                    top: `${100 - (snap.control_limit / maxT2) * 100}%`,
                  }}
                />
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {(snap?.sensors ?? []).map((sensor) => (
            <button
              key={sensor.sensor_id}
              type="button"
              onClick={() => setSelected(sensor)}
              className="rounded-xl border border-border bg-card p-3 text-left hover:bg-muted/40"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm">{sensor.sensor_id}</span>
                <StatusChip status={sensor.status} />
              </div>
              <div className="mt-2 text-muted-foreground">
                <Sparkline values={sensor.sparkline} />
              </div>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                contrib {sensor.contribution.toFixed(2)}
              </p>
            </button>
          ))}
        </div>
      </div>

      <aside className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Sensor detail</CardTitle>
            <CardDescription>
              {selected?.sensor_id ?? "Click a card"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {selected ? (
              <>
                <StatusChip status={selected.status} />
                <p className="font-mono text-xs leading-relaxed">
                  {selected.evidence}
                </p>
                <Sparkline values={selected.sparkline} />
              </>
            ) : (
              <p className="text-muted-foreground">No sensor selected.</p>
            )}
            <Button size="sm" className="mt-2" onClick={() => void inferRoles()}>
              Run role inference
            </Button>
            <RuleBox />
            {rolesText && (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                {rolesText}
              </pre>
            )}
          </CardContent>
        </Card>
      </aside>
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
