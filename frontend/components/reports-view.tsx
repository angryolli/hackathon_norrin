"use client";

import { ArrowLeftRight, Bell, History, ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { AlarmLogView } from "@/components/alarm-log-view";
import { AuditView } from "@/components/audit-view";
import { PastRunsView } from "@/components/past-runs-view";
import {
  FlowPane,
  IDLE_AGENT,
  NavButton,
  type SystemAgentStatus,
} from "@/components/monitor-panes";
import { useSimulation } from "@/components/simulation-context";

type Panel = "alarms" | "log" | "history" | "flow";

export function ReportsView() {
  const [panel, setPanel] = useState<Panel>("alarms");
  const [systemAgent, setSystemAgent] = useState<SystemAgentStatus>(IDLE_AGENT);
  const { resetRevision } = useSimulation();

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

  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
        {panel === "alarms" && (
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-3 text-sm font-medium">Current alarm log</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Yellow and red flags from the active simulation run.
            </p>
            <div className="overflow-hidden rounded-xl border border-border bg-card p-4">
              <AlarmLogView key={resetRevision} />
            </div>
          </div>
        )}
        {panel === "log" && (
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-3 text-sm font-medium">Current decision log</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Operator actions, model calls, and overrides for the active run.
            </p>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <AuditView key={resetRevision} />
            </div>
          </div>
        )}
        {panel === "history" && <PastRunsView key={resetRevision} />}
        {panel === "flow" && <FlowPane flow={systemAgent.dataFlow} />}
      </div>

      <aside className="flex w-60 shrink-0 flex-col border-l border-border bg-background">
        <div className="border-b border-border px-3 py-3">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">Reports & Logs</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
          <NavButton
            item={{ id: "alarms", label: "Current alarms", icon: Bell }}
            active={panel === "alarms"}
            onClick={() => setPanel("alarms")}
          />
          <NavButton
            item={{ id: "log", label: "Current decision log", icon: ScrollText }}
            active={panel === "log"}
            onClick={() => setPanel("log")}
          />
          <NavButton
            item={{ id: "history", label: "Past simulations", icon: History }}
            active={panel === "history"}
            onClick={() => setPanel("history")}
          />
          <NavButton
            item={{ id: "flow", label: "Data flow", icon: ArrowLeftRight }}
            active={panel === "flow"}
            onClick={() => setPanel("flow")}
          />
        </nav>
      </aside>
    </div>
  );
}
