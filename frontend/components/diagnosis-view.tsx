"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AuditView } from "@/components/audit-view";
import { eventsStreamUrl } from "@/lib/browser-api";
import type { DiagnosisSignal, DiagnosisSnapshot } from "@/lib/pipeline";

function fieldLabel(id: string) {
  const sep = id.indexOf("::");
  return sep >= 0 ? id.slice(sep + 2) : id;
}

function fmt(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(3);
}

export function DiagnosisView() {
  const router = useRouter();
  const [signals, setSignals] = useState<DiagnosisSignal[]>([]);
  const [current, setCurrent] = useState<DiagnosisSnapshot["current"] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    let source: EventSource | null = null;
    const sig = { current: "" };

    function apply(data: DiagnosisSnapshot) {
      if (!on) return;
      const next = data.signals ?? data.events ?? [];
      const nextSig = [
        next.map((row) => `${row.id}:${row.level}:${row.tick}:${row.z}`).join("|"),
        data.current?.tick,
        data.current?.z,
      ].join("#");
      if (nextSig === sig.current) return;
      sig.current = nextSig;
      setSignals(next);
      setCurrent(data.current ?? null);
    }

    function connect() {
      source?.close();
      source = new EventSource(eventsStreamUrl());
      source.addEventListener("events", (event) => {
        try {
          apply(JSON.parse((event as MessageEvent<string>).data) as DiagnosisSnapshot);
        } catch {
          /* ignore malformed frames */
        }
      });
    }

    function onVis() {
      if (document.hidden) {
        source?.close();
        source = null;
        return;
      }
      connect();
    }

    connect();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      on = false;
      document.removeEventListener("visibilitychange", onVis);
      source?.close();
    };
  }, []);

  return (
    <div className="grid h-full min-h-0 gap-4 overflow-hidden p-4 lg:grid-cols-2">
      <div className="min-h-0 space-y-3 overflow-y-auto">
        <div>
          <h2 className="text-sm font-medium">Diagnosis signals</h2>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {current
              ? `tick ${current.tick} · S=${fmt(current.score)} · z=${fmt(current.z)} · ${
                  current.calibrated ? "calibrated" : "warming up (first 20 samples)"
                }`
              : "Waiting for the stream."}
          </p>
        </div>
        {signals.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No yellow or red signals yet. Play the stream; alarms use expanding mean, sd, skew,
            and kurtosis after the first 20 samples.
          </p>
        )}
        {signals.map((row) => (
          <Card key={row.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between font-mono text-sm">
                <span>{row.id}</span>
                <span className={row.level === "red" ? "text-red-300" : "text-amber-300"}>
                  {row.level} · tick {row.tick} · z {fmt(row.z)}
                </span>
              </CardTitle>
              <CardDescription className="font-mono text-xs">{row.evidence}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setOpen(open === row.id ? null : row.id)}
              >
                {open === row.id ? "Collapse" : "Expand"}
              </Button>
              {open === row.id && (
                <div className="space-y-3">
                  <ol className="list-decimal space-y-1 pl-4 font-mono text-xs">
                    {row.top_fields.map((field) => (
                      <li key={field.field_id}>
                        {fieldLabel(field.field_id)} · score {fmt(field.score)} · mean{" "}
                        {fmt(field.mean)} · sd {fmt(field.sd)} · skew {fmt(field.skew)} · kurt{" "}
                        {fmt(field.kurt)}
                      </li>
                    ))}
                  </ol>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push(`/agent?context=signal_id=${row.id}`)}
                  >
                    Ask agent
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="min-h-0 overflow-y-auto rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium">Decision log</h2>
        </div>
        <AuditView />
      </div>
    </div>
  );
}
