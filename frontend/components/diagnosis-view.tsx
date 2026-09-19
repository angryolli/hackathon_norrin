"use client";

import {
  Activity,
  ArrowLeftRight,
  Bot,
  Check,
  FileSearch,
  GitBranch,
  HelpCircle,
  Pause,
  ScrollText,
  Shield,
  ShieldAlert,
  ShieldQuestion,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { AuditView } from "@/components/audit-view";
import { ChatMarkdown } from "@/components/chat-markdown";
import { browserPost, eventsStreamUrl } from "@/lib/browser-api";
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

type Panel = "understanding" | "quality" | "drift" | "cause" | "review" | "log" | "flow";

type SystemReport = {
  text: string;
  generatedAt: string;
  model: string;
  hash: string;
  bytes: number;
};

type DataFlowRecord = {
  model: string;
  host: string;
  noEgress: boolean;
  leaves: string;
  why: string;
  swap: string;
};

type SystemAgentStatus = {
  running: boolean;
  loop: "manual" | "continuous";
  step: "idle" | "understanding" | "quality" | "diagnosis" | "error";
  startedAt: string | null;
  lastCycleAt: string | null;
  lastBeatAt: string | null;
  error: string | null;
  eventId: string | null;
  dataTrusted: boolean | null;
  understanding: SystemReport | null;
  quality: SystemReport | null;
  diagnosis: SystemReport | null;
  critique: SystemReport | null;
  dataFlow: DataFlowRecord;
};

const IDLE_AGENT: SystemAgentStatus = {
  running: false,
  loop: "manual",
  step: "idle",
  startedAt: null,
  lastCycleAt: null,
  lastBeatAt: null,
  error: null,
  eventId: null,
  dataTrusted: null,
  understanding: null,
  quality: null,
  diagnosis: null,
  critique: null,
  dataFlow: {
    model: "—",
    host: "—",
    noEgress: false,
    leaves: "",
    why: "",
    swap: "",
  },
};

function stepLabel(step: SystemAgentStatus["step"]) {
  if (step === "understanding") return "Understanding…";
  if (step === "quality") return "Quality…";
  if (step === "diagnosis") return "Root cause…";
  if (step === "error") return "Cycle failed";
  return "Idle";
}

export function DiagnosisView() {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>("drift");
  const [signals, setSignals] = useState<DiagnosisSignal[]>([]);
  const [current, setCurrent] = useState<DiagnosisSnapshot["current"] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [systemAgent, setSystemAgent] = useState<SystemAgentStatus>(IDLE_AGENT);
  const [systemAgentBusy, setSystemAgentBusy] = useState(false);
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

  useEffect(() => {
    if (!systemAgent.running) return;
    let on = true;
    const id = window.setInterval(() => {
      fetch("/api/system-agent")
        .then((r) => r.json())
        .then((data: SystemAgentStatus) => {
          if (on) setSystemAgent(data);
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
      setSystemAgent((await res.json()) as SystemAgentStatus);
    } catch {
      /* ignore */
    } finally {
      setSystemAgentBusy(false);
    }
  }

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
    { id: "understanding", label: "Understanding", icon: FileSearch },
    { id: "quality", label: "Quality", icon: Shield },
    { id: "drift", label: "Drift", icon: Activity, hint: String(signals.length) },
    { id: "cause", label: "Root cause", icon: GitBranch },
    { id: "review", label: "Review", icon: ShieldQuestion },
    { id: "log", label: "Decision log", icon: ScrollText },
    { id: "flow", label: "Data flow", icon: ArrowLeftRight },
  ];

  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
        {panel === "understanding" && (
          <ReportPane
            title="Sensor understanding"
            blurb="Inferred identity and role for unlabeled fields, grounded in moment evidence. Launch the system agent to generate this."
            report={systemAgent.understanding}
            running={systemAgent.running && systemAgent.step === "understanding"}
          />
        )}
        {panel === "quality" && (
          <ReportPane
            title="Data quality"
            blurb="Baseline trust in the incoming stream, kept separate from process drift. Launch the system agent to generate this."
            report={systemAgent.quality}
            running={systemAgent.running && systemAgent.step === "quality"}
            badge={
              systemAgent.dataTrusted == null
                ? null
                : systemAgent.dataTrusted
                  ? "data trusted"
                  : "data not trusted"
            }
            badgeTone={systemAgent.dataTrusted === false ? "bad" : "ok"}
          />
        )}
        {panel === "drift" && (
          <DriftPane
            current={current}
            signals={signals}
            open={open}
            setOpen={setOpen}
            onAsk={(id) => router.push(`/agent?context=signal_id=${id}`)}
          />
        )}
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
        {panel === "review" && (
          <div className="mx-auto max-w-3xl space-y-4">
            <div>
              <h2 className="text-sm font-medium">Human review</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Accept, question, or override the latest system conclusion. Questions open the
                operator chat. Every action is written to the decision log.
              </p>
            </div>
            <p className="font-mono text-xs text-muted-foreground">
              target {systemAgent.eventId ?? "system:diagnosis"}
              {systemAgent.lastCycleAt
                ? ` · last cycle ${new Date(systemAgent.lastCycleAt).toLocaleTimeString()}`
                : " · no cycle yet"}
            </p>
            <Textarea
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              placeholder="Optional note for the log"
              rows={4}
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={reviewBusy} onClick={() => void review("accept")}>
                <Check />
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={reviewBusy}
                onClick={() => void review("question")}
              >
                <HelpCircle />
                Question
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={reviewBusy}
                onClick={() => void review("override")}
              >
                <ShieldAlert />
                Override
              </Button>
            </div>
            {reviewMsg && <p className="text-sm text-muted-foreground">{reviewMsg}</p>}
          </div>
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
          <p className="px-2 pt-1 pb-1 text-[10px] tracking-wide text-muted-foreground uppercase">
            Outputs
          </p>
          {nav.slice(0, 4).map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={panel === item.id}
              onClick={() => setPanel(item.id)}
              warn={item.id === "quality" && systemAgent.dataTrusted === false}
            />
          ))}
          <p className="px-2 pt-3 pb-1 text-[10px] tracking-wide text-muted-foreground uppercase">
            Oversight
          </p>
          {nav.slice(4).map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={panel === item.id}
              onClick={() => setPanel(item.id)}
            />
          ))}
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

function NavButton({
  item,
  active,
  onClick,
  warn,
}: {
  item: { id: Panel; label: string; icon: typeof Activity; hint?: string };
  active: boolean;
  onClick: () => void;
  warn?: boolean;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-9 items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors",
        active
          ? "bg-secondary text-secondary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.hint ? (
        <span className="font-mono text-[10px] text-muted-foreground">{item.hint}</span>
      ) : warn ? (
        <span className="font-mono text-[10px] text-red-300">no</span>
      ) : null}
    </button>
  );
}

function ReportPane({
  title,
  blurb,
  report,
  running,
  badge,
  badgeTone,
}: {
  title: string;
  blurb: string;
  report: SystemReport | null;
  running: boolean;
  badge?: string | null;
  badgeTone?: "ok" | "bad";
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{blurb}</p>
        </div>
        {badge && (
          <Badge variant={badgeTone === "bad" ? "destructive" : "secondary"}>{badge}</Badge>
        )}
      </div>
      {running && <p className="font-mono text-xs text-muted-foreground">Writing this report…</p>}
      {report ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-3 font-mono text-[10px] text-muted-foreground">
            {report.model} · {new Date(report.generatedAt).toLocaleString()} · hash {report.hash} ·{" "}
            {report.bytes} B in
          </p>
          <ChatMarkdown text={report.text} />
        </div>
      ) : (
        !running && (
          <p className="text-sm text-muted-foreground">
            Nothing yet. Launch system agent in the right sidebar for one cycle.
          </p>
        )
      )}
    </div>
  );
}

function DriftPane({
  current,
  signals,
  open,
  setOpen,
  onAsk,
}: {
  current: DiagnosisSnapshot["current"] | null;
  signals: DiagnosisSignal[];
  open: string | null;
  setOpen: (id: string | null) => void;
  onAsk: (id: string) => void;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div>
        <h2 className="text-sm font-medium">Drift and anomalies</h2>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {current
            ? `tick ${current.tick} · S=${fmt(current.score)} · z=${fmt(current.z)} · ${
                current.calibrated ? "calibrated" : "warming up (first 20 samples)"
              }`
            : "Waiting for the stream."}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Expanding-moment flags from the compute plane. Attribution is per field, not an aggregate
          score alone.
        </p>
      </div>
      {signals.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No yellow or red signals yet. Play the stream; alarms use expanding mean, sd, skew, and
          kurtosis after the first 20 samples.
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
                <Button size="sm" variant="outline" onClick={() => onAsk(row.id)}>
                  Ask operator
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function FlowPane({ flow }: { flow: DataFlowRecord }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="text-sm font-medium">Data flow</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          What leaves this environment, to which model, and why. The LLM layer is swapped by config,
          not a rewrite.
        </p>
      </div>
      <dl className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Model</dt>
          <dd className="font-mono text-xs">
            {flow.model} @ {flow.host}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">No-egress</dt>
          <dd className="font-mono text-xs">{flow.noEgress ? "on — local host required" : "off"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">What leaves</dt>
          <dd>{flow.leaves || "Launch or refresh to read the live record."}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Why</dt>
          <dd>{flow.why}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Swap the model</dt>
          <dd>{flow.swap}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Adaptability</dt>
          <dd>
            Sources are unlabeled columns with a kind of process, business, or other. The moment
            detector and these reports never require TEP names. A second CSV on the Data page is the
            same pipeline.
          </dd>
        </div>
      </dl>
    </div>
  );
}
