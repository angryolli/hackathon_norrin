"use client";

import { ArrowLeftRight, ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { AuditView } from "@/components/audit-view";
import {
  FlowPane,
  IDLE_AGENT,
  NavButton,
  type SystemAgentStatus,
} from "@/components/monitor-panes";

type Panel = "log" | "flow";

export function ReportsView() {
  const [panel, setPanel] = useState<Panel>("log");
  const [systemAgent, setSystemAgent] = useState<SystemAgentStatus>(IDLE_AGENT);

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

  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
        {panel === "log" && (
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-3 text-sm font-medium">Decision log</h2>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <AuditView />
            </div>
          </div>
        )}
        {panel === "flow" && <FlowPane flow={systemAgent.dataFlow} />}
      </div>

      <aside className="flex w-60 shrink-0 flex-col border-l border-border bg-background">
        <div className="border-b border-border px-3 py-3">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">Reports & Logs</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
          <NavButton
            item={{ id: "log", label: "Decision log", icon: ScrollText }}
            active={panel === "log"}
            onClick={() => setPanel("log")}
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
