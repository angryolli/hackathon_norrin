"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { telemetryHref, type SensorNote } from "@/components/monitor-panes";

const SCALE = ["Untrusted", "Poor", "Fair", "Good", "Excellent"] as const;

const SCALE_COLOR = {
  Untrusted: { bar: "bg-red-400", dim: "bg-red-400/20", text: "text-red-300" },
  Poor: { bar: "bg-orange-400", dim: "bg-orange-400/20", text: "text-orange-300" },
  Fair: { bar: "bg-amber-400", dim: "bg-amber-400/20", text: "text-amber-300" },
  Good: { bar: "bg-lime-400", dim: "bg-lime-400/20", text: "text-lime-300" },
  Excellent: { bar: "bg-emerald-400", dim: "bg-emerald-400/20", text: "text-emerald-300" },
} as const;

function adjectiveIndex(value: string) {
  const i = SCALE.findIndex((row) => row.toLowerCase() === value.toLowerCase());
  return i >= 0 ? i : 2;
}

export function noteForField(
  sensors: Record<string, SensorNote> | undefined,
  sourceId: string,
  fieldId: string,
): SensorNote | null {
  if (!sensors) return null;
  const key = `${sourceId}::${fieldId}`;
  if (sensors[key]) return sensors[key];
  if (sensors[fieldId]) return sensors[fieldId];
  const hit = Object.entries(sensors).find(([id]) => id.endsWith(`::${fieldId}`));
  return hit?.[1] ?? null;
}

export function SensorIntelCard({
  sourceId,
  fieldId,
  sourceFile,
  note,
  compact = false,
  embedded = false,
  showQuality = true,
  showUnderstanding = true,
}: {
  sourceId: string;
  fieldId: string;
  sourceFile?: string;
  note: SensorNote | null;
  compact?: boolean;
  embedded?: boolean;
  showQuality?: boolean;
  showUnderstanding?: boolean;
}) {
  const understanding = note?.understanding;
  const quality = note?.quality;
  const adj = quality?.adjective ?? "Fair";
  const adjI = adjectiveIndex(adj);
  const href = telemetryHref(`${sourceId}::${fieldId}`);

  return (
    <article
      className={cn(
        !embedded && "rounded-xl border border-border bg-card",
        compact ? "p-3" : embedded ? "p-0" : "p-4",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={href}
            className="truncate font-mono text-sm underline-offset-2 hover:underline"
          >
            {fieldId}
          </Link>
          <p className="truncate text-[11px] text-muted-foreground">
            {sourceFile || sourceId || "—"}
          </p>
        </div>
        {quality && showQuality && (
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px]",
              SCALE_COLOR[SCALE[adjI]].text,
              SCALE_COLOR[SCALE[adjI]].dim,
            )}
          >
            {quality.adjective}
          </span>
        )}
      </div>

      {showUnderstanding && (
        <section className="mt-3 space-y-1">
          <h4 className="text-[10px] tracking-wide text-muted-foreground uppercase">
            Understanding
          </h4>
          {understanding ? (
            <div className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">Role </span>
                {understanding.role}
                {understanding.hypothesis ? ` · ${understanding.hypothesis}` : ""}
              </p>
              {understanding.evidence && (
                <p className="font-mono text-xs text-muted-foreground">{understanding.evidence}</p>
              )}
              <p className="font-mono text-[11px] text-muted-foreground">
                confidence {(understanding.confidence * 100).toFixed(0)}%
              </p>
              {understanding.inferred && (
                <p>
                  <span className="text-muted-foreground">Inferred </span>
                  {understanding.inferred}
                </p>
              )}
              {understanding.assumed && (
                <p>
                  <span className="text-muted-foreground">Assumed </span>
                  {understanding.assumed}
                </p>
              )}
              {understanding.uncertain && (
                <p>
                  <span className="text-muted-foreground">Uncertain </span>
                  {understanding.uncertain}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Launch the system agent to classify this source.
            </p>
          )}
        </section>
      )}

      {showQuality && (
        <section className={cn("space-y-2", showUnderstanding && "mt-3")}>
          <h4 className="text-[10px] tracking-wide text-muted-foreground uppercase">Quality</h4>
          {quality ? (
            <div className="space-y-2 text-sm">
              <p>
                {quality.faulty ? "Sensor looks faulty." : "Sensor does not look faulty."}
                {quality.issue && quality.issue !== "none" ? ` ${quality.issue}.` : ""}
              </p>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className={SCALE_COLOR[SCALE[adjI]].text}>{quality.adjective}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {(quality.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="mt-1 flex gap-1">
                  {SCALE.map((label, index) => (
                    <span
                      key={label}
                      title={label}
                      className={cn(
                        "h-1.5 flex-1 rounded-full",
                        index <= adjI ? SCALE_COLOR[label].bar : SCALE_COLOR[label].dim,
                      )}
                    />
                  ))}
                </div>
              </div>
              {quality.summary && <p className="text-muted-foreground">{quality.summary}</p>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Launch the system agent to judge sensor quality. This is not a process alarm.
            </p>
          )}
        </section>
      )}
    </article>
  );
}

export function SensorIntelGrid({
  fields,
  sensors,
  mode = "both",
}: {
  fields: Array<{ source_id?: string; field_id: string; source_file?: string }>;
  sensors: Record<string, SensorNote>;
  mode?: "understanding" | "quality" | "both";
}) {
  if (fields.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
        Add sources on Telemetry, then play the stream.
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((field) => {
        const sourceId = field.source_id ?? "";
        const key = `${sourceId}::${field.field_id}`;
        return (
          <SensorIntelCard
            key={key}
            sourceId={sourceId}
            fieldId={field.field_id}
            sourceFile={field.source_file}
            note={noteForField(sensors, sourceId, field.field_id)}
            showUnderstanding={mode === "understanding" || mode === "both"}
            showQuality={mode === "quality" || mode === "both"}
          />
        );
      })}
    </div>
  );
}
