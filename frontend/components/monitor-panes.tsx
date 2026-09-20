"use client";

import { Activity, Check, HelpCircle, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChatMarkdown } from "@/components/chat-markdown";
import { cn } from "@/lib/utils";
import type { DiagnosisSignal, DiagnosisSnapshot } from "@/lib/pipeline";

export function fieldLabel(id: string) {
  const sep = id.indexOf("::");
  return sep >= 0 ? id.slice(sep + 2) : id;
}

export function telemetryHref(fieldId: string) {
  const sep = fieldId.indexOf("::");
  const source = sep >= 0 ? fieldId.slice(0, sep) : "";
  const field = sep >= 0 ? fieldId.slice(sep + 2) : fieldId;
  const q = new URLSearchParams();
  if (source) q.set("source", source);
  q.set("field", field);
  return `/telemetry?${q.toString()}`;
}

export function fmt(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(3);
}

/** Metric chips for an alarm — avoid showing z-score `score/k` on v5-only rows. */
export function alarmMetricLabels(row: DiagnosisSignal, k: number): string[] {
  const origins = row.origins ?? [];
  const reason = (row.reason ?? "").toLowerCase();
  const hasZ =
    origins.includes("zscore") || reason.includes("z-score") || reason.includes("zscore");
  const hasV5 =
    origins.some((o) => o !== "zscore") || reason.includes("v5") || reason.includes("moment")
    || reason.includes("freeze") || reason.includes("amp");

  if (hasZ && !hasV5) {
    return [`|z| ${fmt(row.z)}`, `score ${fmt(row.score)}/${k}`];
  }
  if (!hasZ && hasV5) {
    if (reason.includes("freeze") || origins.includes("freeze")) {
      return [`freeze +${fmt(row.score)}`];
    }
    if (reason.includes("amp") || origins.includes("amp")) {
      return [`amp q90 ${fmt(row.score)}`];
    }
    return [`moment z ${fmt(row.z)}`];
  }
  if (hasZ && hasV5) {
    return [`|z| ${fmt(row.z)}`, `score ${fmt(row.score)}/${k}`];
  }
  return [`|z| ${fmt(row.z)}`, `score ${fmt(row.score)}/${k}`];
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

export type SensorNote = {
  understanding?: {
    field_id: string;
    role: string;
    hypothesis: string;
    evidence: string;
    confidence: number;
    inferred: string;
    assumed: string;
    uncertain: string;
  };
  quality?: {
    field_id: string;
    faulty: boolean;
    issue: string;
    adjective: string;
    confidence: number;
    summary: string;
  };
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
  understanding: SystemReport | null;
  quality: SystemReport | null;
  diagnosis: SystemReport | null;
  critique: SystemReport | null;
  alarmDiagnoses: Record<string, SystemReport>;
  rootCauseSignalId: string | null;
  sensors: Record<string, SensorNote>;
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
  understanding: null,
  quality: null,
  diagnosis: null,
  critique: null,
  alarmDiagnoses: {},
  rootCauseSignalId: null,
  sensors: {},
  dataFlow: {
    model: "—",
    host: "—",
    noEgress: false,
    leaves: "",
    why: "",
    swap: "",
  },
};

export function stepLabel(step: SystemAgentStatus["step"], rootCauseSignalId?: string | null) {
  if (step === "understanding") return "Understanding…";
  if (step === "quality") return "Quality…";
  if (step === "diagnosis") {
    return rootCauseSignalId ? `Root cause for ${rootCauseSignalId}…` : "Root cause…";
  }
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
  hideTitle = false,
}: {
  title: string;
  blurb: string;
  report: SystemReport | null;
  running: boolean;
  badge?: string | null;
  badgeTone?: "ok" | "bad";
  hideTitle?: boolean;
}) {
  return (
    <div className="space-y-3">
      {!hideTitle && (
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{blurb}</p>
          </div>
          {badge && (
            <Badge variant={badgeTone === "bad" ? "destructive" : "secondary"}>{badge}</Badge>
          )}
        </div>
      )}
      {hideTitle && badge && (
        <div className="flex justify-end">
          <Badge variant={badgeTone === "bad" ? "destructive" : "secondary"}>{badge}</Badge>
        </div>
      )}
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
            Nothing yet. Launch the system agent on System Dashboard for one cycle.
          </p>
        )
      )}
    </div>
  );
}

function sourceLabel(fieldId: string) {
  const sep = fieldId.indexOf("::");
  return sep >= 0 ? fieldId.slice(0, sep) : "";
}

function alarmTelemetryHref(row: DiagnosisSignal) {
  const top = row.top_fields[0];
  return top ? telemetryHref(top.field_id) : "/telemetry";
}

export function DriftPane({
  current,
  signals,
  open,
  setOpen,
  onAsk,
  onRootCause,
  alarmDiagnoses = {},
  rootCauseSignalId = null,
  hideHeader = false,
}: {
  current: DiagnosisSnapshot["current"] | null;
  signals: DiagnosisSignal[];
  open: string | null;
  setOpen: (id: string | null) => void;
  onAsk: (id: string) => void;
  onRootCause?: (id: string) => void;
  alarmDiagnoses?: Record<string, SystemReport>;
  rootCauseSignalId?: string | null;
  hideHeader?: boolean;
}) {
  const k = current?.k ?? 6;
  const zYellow = current?.z_yellow ?? 4;
  const zRed = current?.z_red ?? 6;

  return (
    <div className="space-y-3">
      {!hideHeader && (
        <div>
          <h2 className="text-sm font-medium">Alarms</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Two detectors share this log. Rolling z-score: yellow after {k} consecutive samples past{" "}
            {fmt(zYellow)}σ, red past {fmt(zRed)}σ — brief spikes do not open one. v5 agnostic:
            expanding-moment RMS, freeze streaks, and amplitude envelope (gates ease after burn-in).
            Plant level is the max of both — either can open an alarm. Score/k is the z-score streak
            when that model fires; v5-only rows show moment/freeze/amp instead.
          </p>
        </div>
      )}
      <p className="font-mono text-xs text-muted-foreground">
        {current
          ? `live · tick ${current.tick} · max|z|=${fmt(current.z)} · score ${fmt(current.score)}/${k} · ${
              current.calibrated
                ? "calibrated"
                : `warming up (first ${current.burn_in ?? 20} samples)`
            }`
          : "Waiting for the stream."}
      </p>

      {signals.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          No alarms yet. Play the stream — a single spike never opens one.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <ul className="divide-y divide-border">
            {signals.map((row) => {
              const top = row.top_fields[0];
              const source = top ? sourceLabel(top.field_id) : "";
              const field = top ? fieldLabel(top.field_id) : null;
              const href = alarmTelemetryHref(row);
              const expanded = open === row.id;
              const diagnosis = alarmDiagnoses[row.id] ?? null;
              const rootCauseBusy = rootCauseSignalId === row.id;
              const metrics = alarmMetricLabels(row, k);
              return (
                <li key={row.id} className="px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                        <span
                          className={
                            row.level === "red" ? "font-medium text-red-300" : "font-medium text-amber-300"
                          }
                        >
                          {row.level.toUpperCase()}
                        </span>
                        <span className="text-muted-foreground">tick {row.tick}</span>
                        {metrics.map((label) => (
                          <span key={label} className="text-muted-foreground">
                            {label}
                          </span>
                        ))}
                        {row.reason ? (
                          <span className="rounded border border-border px-1.5 py-0.5 text-foreground">
                            {row.reason}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {field ? (
                          <>
                            Triggered on{" "}
                            <span className="font-mono text-foreground">{field}</span>
                            {source ? (
                              <>
                                {" "}
                                in source{" "}
                                <span className="font-mono text-foreground">{source}</span>
                              </>
                            ) : null}
                          </>
                        ) : (
                          row.evidence || "Alarm opened from pooled channel z-scores."
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {onRootCause && (
                        <Button
                          size="sm"
                          variant="default"
                          disabled={Boolean(rootCauseSignalId)}
                          onClick={() => onRootCause(row.id)}
                        >
                          {rootCauseBusy ? "Analyzing…" : "Do root cause analysis"}
                        </Button>
                      )}
                      <Link
                        href={href}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        View in Telemetry
                      </Link>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOpen(expanded ? null : row.id)}
                      >
                        {expanded ? "Hide" : "Details"}
                      </Button>
                    </div>
                  </div>
                  {rootCauseBusy && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Running root-cause analysis for this alarm…
                    </p>
                  )}
                  {diagnosis && !rootCauseBusy && (
                    <div className="mt-4 rounded-lg border border-border bg-background/60 p-4">
                      <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        Root-cause analysis
                      </p>
                      <p className="mb-3 font-mono text-[10px] text-muted-foreground">
                        {diagnosis.model} · {new Date(diagnosis.generatedAt).toLocaleString()}
                      </p>
                      <ChatMarkdown text={diagnosis.text} />
                    </div>
                  )}
                  {expanded && (
                    <div className="mt-3 space-y-3 border-t border-border pt-3">
                      {row.reason ? (
                        <p className="text-xs text-muted-foreground">
                          Reason:{" "}
                          <span className="font-mono text-foreground">{row.reason}</span>
                        </p>
                      ) : null}
                      <p className="font-mono text-[11px] text-muted-foreground">{row.evidence}</p>
                      {row.top_fields.length > 0 && (
                        <ol className="list-decimal space-y-1 pl-4 font-mono text-xs">
                          {row.top_fields.map((item) => (
                            <li key={item.field_id}>
                              <Link
                                href={telemetryHref(item.field_id)}
                                className="underline-offset-2 hover:underline"
                              >
                                {fieldLabel(item.field_id)}
                              </Link>
                              {" · |z| "}
                              {fmt(item.score)} · mean {fmt(item.mean)} · sd {fmt(item.sd)} · skew{" "}
                              {fmt(item.skew)} · kurt {fmt(item.kurt)}
                            </li>
                          ))}
                        </ol>
                      )}
                      <Button size="sm" variant="outline" onClick={() => onAsk(row.id)}>
                        Ask operator
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
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
            Sources are unlabeled columns with a kind of process, business, or other. The z-score
            detector and these reports never require TEP names. A second CSV under Telemetry is the
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
  hideHeader = false,
}: {
  eventId: string | null;
  lastCycleAt: string | null;
  note: string;
  onNote: (value: string) => void;
  busy: boolean;
  msg: string | null;
  onReview: (action: "accept" | "question" | "override") => void;
  hideHeader?: boolean;
}) {
  return (
    <div className="space-y-4">
      {!hideHeader && (
        <div>
          <h2 className="text-sm font-medium">Judgment</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Accept, question, or override the latest system conclusion. Everything on this dashboard
            is in front of you. Questions open the operator chat. Every action is written to the
            decision log.
          </p>
        </div>
      )}
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
