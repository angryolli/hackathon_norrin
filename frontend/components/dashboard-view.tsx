"use client";

import { Bot, Pause } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChatMarkdown } from "@/components/chat-markdown";
import { DashboardSection } from "@/components/dashboard-section";
import { DashboardSourcesMap } from "@/components/dashboard-sources-map";
import { SensorIntelGrid } from "@/components/sensor-intel-card";
import { Badge } from "@/components/ui/badge";
import {
  DriftPane,
  fmt,
  IDLE_AGENT,
  ReportPane,
  stepLabel,
  type SystemAgentStatus,
} from "@/components/monitor-panes";
import { eventsStreamUrl, monitorStreamUrl, type MonitorSnapshot } from "@/lib/browser-api";
import type { DiagnosisSignal, DiagnosisSnapshot } from "@/lib/pipeline";
import { useSimulation } from "@/components/simulation-context";

export function DashboardView() {
  const router = useRouter();
  const [snap, setSnap] = useState<MonitorSnapshot | null>(null);
  const [signals, setSignals] = useState<DiagnosisSignal[]>([]);
  const [current, setCurrent] = useState<DiagnosisSnapshot["current"] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [systemAgent, setSystemAgent] = useState<SystemAgentStatus>(IDLE_AGENT);
  const [systemAgentBusy, setSystemAgentBusy] = useState(false);
  const { playing, finished, resetRevision } = useSimulation();
  const monitorKey = useRef("");

  useEffect(() => {
    setSnap(null);
    setSignals([]);
    setCurrent(null);
    setOpen(null);
    setSystemAgent(IDLE_AGENT);
    monitorKey.current = "";
  }, [resetRevision]);

  useEffect(() => {
    let on = true;
    let source: EventSource | null = null;

    function apply(data: MonitorSnapshot) {
      if (!on) return;
      const key = [
        data.tick,
        data.playing,
        data.finished,
        (data.fields ?? []).map((f) => `${f.source_id}:${f.field_id}:${f.sparkline.length}`).join("|"),
      ].join("#");
      if (key === monitorKey.current) return;
      monitorKey.current = key;
      setSnap(data);
    }

    function connect() {
      source?.close();
      source = new EventSource(monitorStreamUrl());
      source.addEventListener("snapshot", (event) => {
        try {
          apply(JSON.parse((event as MessageEvent<string>).data) as MonitorSnapshot);
        } catch {
          /* ignore */
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
          /* ignore */
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
    async function pull() {
      try {
        const res = await fetch("/api/system-agent");
        const data = (await res.json()) as SystemAgentStatus;
        if (on) setSystemAgent({ ...IDLE_AGENT, ...data, sensors: data.sensors ?? {} });
      } catch {
        /* ignore */
      }
    }
    void pull();
    return () => {
      on = false;
    };
  }, [resetRevision]);

  useEffect(() => {
    if (!systemAgent.running) return;
    let on = true;
    const id = window.setInterval(() => {
      fetch("/api/system-agent")
        .then((r) => r.json())
        .then((data: SystemAgentStatus) => {
          if (on) setSystemAgent({ ...IDLE_AGENT, ...data, sensors: data.sensors ?? {} });
        })
        .catch(() => undefined);
    }, 800);
    return () => {
      on = false;
      window.clearInterval(id);
    };
  }, [systemAgent.running]);

  async function toggleSystemAgent() {
    setSystemAgentBusy(true);
    try {
      const res = await fetch("/api/system-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ running: !systemAgent.running }),
      });
      const data = (await res.json()) as SystemAgentStatus;
      setSystemAgent({ ...IDLE_AGENT, ...data, sensors: data.sensors ?? {} });
    } catch {
      /* ignore */
    } finally {
      setSystemAgentBusy(false);
    }
  }

  const fields = snap?.fields ?? [];
  const tick = snap?.tick ?? current?.tick ?? 0;
  const qualityBadge =
    systemAgent.dataTrusted == null
      ? null
      : systemAgent.dataTrusted
        ? "DATA_TRUSTED"
        : "WITHHELD";

  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl space-y-8 pb-8">
          <DashboardSourcesMap
            fields={fields}
            playing={playing}
            finished={finished}
            tick={tick}
            signals={signals}
          />

          <DashboardSection
            title="Sensor understanding"
            subtitle="Inferred identity and role for each channel. Full field records are in Reports & Logs."
          >
            <SensorIntelGrid fields={fields} sensors={systemAgent.sensors} mode="understanding" />
          </DashboardSection>

          <DashboardSection
            title="Quality"
            subtitle="Instrument health for the current run. Pass/fail gate before root cause."
          >
            {qualityBadge && (
              <div className="flex justify-end">
                <Badge variant={systemAgent.dataTrusted === false ? "destructive" : "secondary"}>
                  {qualityBadge}
                </Badge>
              </div>
            )}
            <DashboardSection title="Data quality checks" variant="secondary">
              <SensorIntelGrid fields={fields} sensors={systemAgent.sensors} mode="quality" />
            </DashboardSection>
          </DashboardSection>

          <DashboardSection
            title="Alarms"
            subtitle="Live drift flags and root-cause diagnosis for the current run."
          >
            <DashboardSection
              title="Drift & anomaly detection"
              subtitle="Continuous monitoring output. Alarms reference the channels responsible."
              variant="secondary"
            >
              <DriftPane
                current={current}
                signals={signals}
                open={open}
                setOpen={setOpen}
                onAsk={(id) => router.push(`/agent?context=signal_id=${id}`)}
                hideHeader
              />
            </DashboardSection>

            <DashboardSection
              title="Root-cause diagnosis"
              subtitle="Fault type, ranked contributing sensors, and a plain-language walkthrough."
              variant="secondary"
            >
              <ReportPane
                title="Diagnosis"
                blurb=""
                report={systemAgent.diagnosis}
                running={systemAgent.running && systemAgent.step === "diagnosis"}
                hideTitle
              />
              {systemAgent.critique && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <h3 className="mb-2 text-sm font-medium">Critique</h3>
                  <ChatMarkdown text={systemAgent.critique.text} />
                </div>
              )}
            </DashboardSection>
          </DashboardSection>
        </div>
      </div>

      <aside className="flex w-60 shrink-0 flex-col border-l border-border bg-background">
        <div className="border-b border-border px-3 py-3">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">System Dashboard</p>
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
            {systemAgent.running ? (
              <Pause className="size-4 shrink-0" />
            ) : (
              <Bot className="size-4 shrink-0" />
            )}
            <span className="text-left leading-tight">
              {systemAgent.running ? "Stop system agent" : "Launch system agent"}
            </span>
          </Button>
          <p className="mt-1.5 px-1 font-mono text-[10px] text-muted-foreground">
            {systemAgent.running
              ? stepLabel(systemAgent.step)
              : systemAgent.error
                ? systemAgent.error
                : "Manual cycle · understanding, quality, diagnosis"}
          </p>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 text-[11px] text-muted-foreground">
          <p>
            {signals.filter((row) => row.level === "yellow").length} yellow ·{" "}
            {signals.filter((row) => row.level === "red").length} red
          </p>
          <p>
            {fields.length} source{fields.length === 1 ? "" : "s"} · tick {tick}
          </p>
          <p>
            {systemAgent.lastCycleAt
              ? `last cycle ${new Date(systemAgent.lastCycleAt).toLocaleTimeString()}`
              : "no agent cycle yet"}
          </p>
          <Link href="/reports" className="underline-offset-2 hover:underline">
            Field reports in Reports & Logs
          </Link>
          <Link href="/telemetry" className="underline-offset-2 hover:underline">
            Inspect streams on Telemetry
          </Link>
        </div>
        <div className="border-t border-border px-3 py-3 font-mono text-[10px] text-muted-foreground">
          {current
            ? `max|z|=${fmt(current.z)} · ${
                current.calibrated ? "calibrated" : "warming up"
              }`
            : "Waiting for stream"}
        </div>
      </aside>
    </div>
  );
}
