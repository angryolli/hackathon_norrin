"use client";

import { Activity, Bot, Pause, ScrollText } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { DiagnosisSignal, DiagnosisSnapshot } from "@/lib/pipeline";

function fieldLabel(id: string) {
  const sep = id.indexOf("::");
  return sep >= 0 ? id.slice(sep + 2) : id;
}

function fmt(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(3);
}

type Panel = "signals" | "log";

type SystemAgentStatus = {
  running: boolean;
  startedAt: string | null;
  lastBeatAt: string | null;
};

export function DiagnosisView() {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>("signals");
  const [signals, setSignals] = useState<DiagnosisSignal[]>([]);
  const [current, setCurrent] = useState<DiagnosisSnapshot["current"] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [systemAgent, setSystemAgent] = useState<SystemAgentStatus>({
    running: false,
    startedAt: null,
    lastBeatAt: null,
  });
  const [systemAgentBusy, setSystemAgentBusy] = useState(false);

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

  useEffect(() => {
    let on = true;
    fetch("/api/system-agent")
      .then((r) => r.json())
      .then((data: SystemAgentStatus) => {
        if (on) setSystemAgent(data);
      })
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, []);

  async function toggleSystemAgent() {
    setSystemAgentBusy(true);
    try {
      const res = await fetch("/api/system-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ running: !systemAgent.running }),
      });
      setSystemAgent((await res.json()) as SystemAgentStatus);
    } catch {
      /* ignore */
    } finally {
      setSystemAgentBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
        {panel === "signals" ? (
          <div className="mx-auto max-w-3xl space-y-3">
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
        ) : (
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-3 text-sm font-medium">Decision log</h2>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <AuditView />
            </div>
          </div>
        )}
      </div>

      <aside className="flex w-56 shrink-0 flex-col border-l border-border bg-background">
        <div className="border-b border-border px-3 py-3">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">System Monitor</p>
        </div>
        <div className="border-b border-border px-2 py-2">
          <Button
            size="sm"
            variant={systemAgent.running ? "secondary" : "default"}
            className="h-auto w-full justify-start gap-2 py-2 whitespace-normal"
            onClick={() => void toggleSystemAgent()}
            disabled={systemAgentBusy}
            aria-label={systemAgent.running ? "Stop system agent" : "Launch system agent"}
          >
            {systemAgent.running ? <Pause className="size-4 shrink-0" /> : <Bot className="size-4 shrink-0" />}
            <span className="text-left leading-tight">
              {systemAgent.running ? "Stop system agent" : "Launch system agent"}
            </span>
          </Button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          <button
            type="button"
            onClick={() => setPanel("signals")}
            className={cn(
              "flex h-9 items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors",
              panel === "signals"
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Activity className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Diagnosis signals</span>
            <span className="font-mono text-[10px] text-muted-foreground">{signals.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setPanel("log")}
            className={cn(
              "flex h-9 items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors",
              panel === "log"
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <ScrollText className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Decision log</span>
          </button>
        </nav>
        <div className="border-t border-border px-3 py-3 font-mono text-[10px] text-muted-foreground">
          {current
            ? `tick ${current.tick} · z=${fmt(current.z)} · ${
                current.calibrated ? "calibrated" : "warming up"
              }`
            : "Waiting for stream"}
        </div>
      </aside>
    </div>
  );
}
