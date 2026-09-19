"use client";

import { Activity, Check, HelpCircle, ShieldAlert } from "lucide-react";
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
import { ChatMarkdown } from "@/components/chat-markdown";
import { cn } from "@/lib/utils";
import type { DiagnosisSignal, DiagnosisSnapshot } from "@/lib/pipeline";

export function fieldLabel(id: string) {
  const sep = id.indexOf("::");
  return sep >= 0 ? id.slice(sep + 2) : id;
}

export function fmt(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(3);
}

export type SystemReport = {
  text: string;
  generatedAt: string;
  model: string;
  hash: string;
  bytes: number;
};

export type DataFlowRecord = {
  model: string;
  host: string;
  noEgress: boolean;
  leaves: string;
  why: string;
  swap: string;
};

export type SystemAgentStatus = {
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

export const IDLE_AGENT: SystemAgentStatus = {
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

export function stepLabel(step: SystemAgentStatus["step"]) {
  if (step === "understanding") return "Understanding…";
  if (step === "quality") return "Quality…";
  if (step === "diagnosis") return "Root cause…";
  if (step === "error") return "Cycle failed";
  return "Idle";
}

export function NavButton<Id extends string>({
  item,
  active,
  onClick,
  warn,
}: {
  item: { id: Id; label: string; icon: typeof Activity; hint?: string };
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

export function ReportPane({
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
            Nothing yet. Launch system agent on System Monitor for one cycle.
          </p>
        )
      )}
    </div>
  );
}

export function DriftPane({
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

export function FlowPane({ flow }: { flow: DataFlowRecord }) {
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
            detector and these reports never require TEP names. A second CSV under Sources is the
            same pipeline.
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function ReviewPane({
  eventId,
  lastCycleAt,
  note,
  onNote,
  busy,
  msg,
  onReview,
}: {
  eventId: string | null;
  lastCycleAt: string | null;
  note: string;
  onNote: (value: string) => void;
  busy: boolean;
  msg: string | null;
  onReview: (action: "accept" | "question" | "override") => void;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="text-sm font-medium">Human review</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Accept, question, or override the latest system conclusion. Questions open the operator
          chat. Every action is written to the decision log.
        </p>
      </div>
      <p className="font-mono text-xs text-muted-foreground">
        target {eventId ?? "system:diagnosis"}
        {lastCycleAt ? ` · last cycle ${new Date(lastCycleAt).toLocaleTimeString()}` : " · no cycle yet"}
      </p>
      <Textarea
        value={note}
        onChange={(event) => onNote(event.target.value)}
        placeholder="Optional note for the log"
        rows={4}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => onReview("accept")}>
          <Check />
          Accept
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onReview("question")}>
          <HelpCircle />
          Question
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={busy}
          onClick={() => onReview("override")}
        >
          <ShieldAlert />
          Override
        </Button>
      </div>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
    </div>
  );
}
