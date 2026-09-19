"use client";

import { Bot, Database, GitBranch, Pause } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChatMarkdown } from "@/components/chat-markdown";
import { DataSourcesView } from "@/components/data-sources-view";
import {
  fmt,
  IDLE_AGENT,
  NavButton,
  ReportPane,
  stepLabel,
  type SystemAgentStatus,
} from "@/components/monitor-panes";
import { eventsStreamUrl } from "@/lib/browser-api";
import type { DiagnosisSnapshot } from "@/lib/pipeline";

type Panel = "sources" | "cause";

export function DiagnosisView() {
  const [panel, setPanel] = useState<Panel>("sources");
  const [current, setCurrent] = useState<DiagnosisSnapshot["current"] | null>(null);
  const [systemAgent, setSystemAgent] = useState<SystemAgentStatus>(IDLE_AGENT);
  const [systemAgentBusy, setSystemAgentBusy] = useState(false);

  useEffect(() => {
    let on = true;
    let source: EventSource | null = null;
    const sig = { current: "" };

    function apply(data: DiagnosisSnapshot) {
      if (!on) return;
      const nextSig = `${data.current?.tick}#${data.current?.z}`;
      if (nextSig === sig.current) return;
      sig.current = nextSig;
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
  }, []);

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

  return (
    <div className="flex h-full min-h-0">
      <div
        className={
          panel === "sources"
            ? "min-h-0 min-w-0 flex-1 overflow-hidden"
            : "min-h-0 min-w-0 flex-1 overflow-y-auto p-4"
        }
      >
        {panel === "sources" && <DataSourcesView />}
        {panel === "cause" && (
          <div className="mx-auto max-w-3xl space-y-6">
            <ReportPane
              title="Root-cause diagnosis"
              blurb="Fault type, ranked fields, and a plain-language walkthrough. A critique runs before this is treated as final."
              report={systemAgent.diagnosis}
              running={systemAgent.running && systemAgent.step === "diagnosis"}
            />
            {systemAgent.critique && (
              <div>
                <h3 className="mb-2 text-sm font-medium">Critique</h3>
                <div className="rounded-xl border border-border bg-card p-4">
                  <ChatMarkdown text={systemAgent.critique.text} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <aside className="flex w-60 shrink-0 flex-col border-l border-border bg-background">
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
                : "Manual cycle · not 24/7"}
          </p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
          <NavButton
            item={{ id: "sources", label: "Sources", icon: Database }}
            active={panel === "sources"}
            onClick={() => setPanel("sources")}
          />
          <NavButton
            item={{ id: "cause", label: "Root cause", icon: GitBranch }}
            active={panel === "cause"}
            onClick={() => setPanel("cause")}
          />
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
