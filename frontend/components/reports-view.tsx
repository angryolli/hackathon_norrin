"use client";

import { Activity, ArrowLeftRight, ScrollText, ShieldQuestion } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuditView } from "@/components/audit-view";
import {
  DriftPane,
  FlowPane,
  IDLE_AGENT,
  NavButton,
  ReviewPane,
  type SystemAgentStatus,
} from "@/components/monitor-panes";
import { browserPost, eventsStreamUrl } from "@/lib/browser-api";
import type { DiagnosisSignal, DiagnosisSnapshot } from "@/lib/pipeline";

type Panel = "drift" | "review" | "log" | "flow";

export function ReportsView() {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>("drift");
  const [signals, setSignals] = useState<DiagnosisSignal[]>([]);
  const [current, setCurrent] = useState<DiagnosisSnapshot["current"] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [systemAgent, setSystemAgent] = useState<SystemAgentStatus>(IDLE_AGENT);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewMsg, setReviewMsg] = useState<string | null>(null);

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
    async function pull() {
      try {
        const res = await fetch("/api/system-agent");
        const data = (await res.json()) as SystemAgentStatus;
        if (on) setSystemAgent(data);
      } catch {
        /* ignore */
      }
    }
    void pull();
    return () => {
      on = false;
    };
  }, []);

  async function review(action: "accept" | "question" | "override") {
    setReviewBusy(true);
    setReviewMsg(null);
    try {
      await browserPost("/decision-log/append", {
        type: action === "accept" ? "diagnosis" : action,
        payload: {
          action,
          note: reviewNote,
          event_id: systemAgent.eventId,
        },
        evidence_ref: systemAgent.eventId ?? "system:diagnosis",
        human_overridden: action === "override",
      });
      setReviewNote("");
      setReviewMsg(
        action === "accept"
          ? "Accepted and logged."
          : action === "question"
            ? "Question logged. Ask the operator agent for the why."
            : "Override logged.",
      );
      if (action === "question") router.push("/agent");
    } catch (err) {
      setReviewMsg(err instanceof Error ? err.message : "review failed");
    } finally {
      setReviewBusy(false);
    }
  }

  const nav: { id: Panel; label: string; icon: typeof Activity; hint?: string }[] = [
    { id: "drift", label: "Drift", icon: Activity, hint: String(signals.length) },
    { id: "review", label: "Review", icon: ShieldQuestion },
    { id: "log", label: "Decision log", icon: ScrollText },
    { id: "flow", label: "Data flow", icon: ArrowLeftRight },
  ];

  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
        {panel === "drift" && (
          <DriftPane
            current={current}
            signals={signals}
            open={open}
            setOpen={setOpen}
            onAsk={(id) => router.push(`/agent?context=signal_id=${id}`)}
          />
        )}
        {panel === "review" && (
          <ReviewPane
            eventId={systemAgent.eventId}
            lastCycleAt={systemAgent.lastCycleAt}
            note={reviewNote}
            onNote={setReviewNote}
            busy={reviewBusy}
            msg={reviewMsg}
            onReview={(action) => void review(action)}
          />
        )}
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
          {nav.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={panel === item.id}
              onClick={() => setPanel(item.id)}
            />
          ))}
        </nav>
      </aside>
    </div>
  );
}
