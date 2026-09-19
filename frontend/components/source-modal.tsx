"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StreamChart, type ChartMark } from "@/components/stream-chart";
import { cn } from "@/lib/utils";
import type { FieldCard } from "@/lib/browser-api";
import type { SensorNote } from "@/components/monitor-panes";

type Origin = { left: number; top: number; width: number; height: number };

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

export function noteForStream(
  sensors: Record<string, SensorNote> | undefined,
  stream: FieldCard,
): SensorNote | null {
  if (!sensors) return null;
  const key = `${stream.source_id ?? ""}::${stream.field_id}`;
  if (sensors[key]) return sensors[key];
  if (sensors[stream.field_id]) return sensors[stream.field_id];
  const hit = Object.entries(sensors).find(([id]) => id.endsWith(`::${stream.field_id}`));
  return hit?.[1] ?? null;
}

export function SourceModal({
  stream,
  origin,
  tick,
  marks,
  note,
  onClose,
}: {
  stream: FieldCard;
  origin: Origin;
  tick?: number;
  marks?: ChartMark[];
  note: SensorNote | null;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const desktop = vw >= 768;
  const targetW = Math.min(desktop ? origin.width * 2 : vw - 32, vw - 32);
  const targetLeft = Math.max(16, (vw - targetW) / 2);
  const targetTop = Math.max(16, vh * 0.08);

  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setExpanded(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function close() {
    if (closing) return;
    setClosing(true);
    setExpanded(false);
    window.setTimeout(onClose, 280);
  }

  const open = expanded && !closing;
  const box = open
    ? { left: targetLeft, top: targetTop, width: targetW }
    : { left: origin.left, top: origin.top, width: origin.width };
  const understanding = note?.understanding;
  const quality = note?.quality;
  const adj = quality?.adjective ?? "Fair";
  const adjI = adjectiveIndex(adj);

  return (
    <div className="fixed inset-0 z-[210]">
      <button
        type="button"
        aria-label="Close source"
        className={cn(
          "absolute inset-0 bg-black/40 transition-all duration-300",
          open ? "opacity-100 backdrop-blur-md" : "opacity-0 backdrop-blur-none",
        )}
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-modal-title"
        className={cn(
          "absolute overflow-hidden rounded-xl border border-border bg-card shadow-lg transition-[left,top,width,max-height] duration-300 ease-out",
          open ? "overflow-y-auto" : "overflow-hidden",
        )}
        style={{
          left: box.left,
          top: box.top,
          width: box.width,
          maxHeight: open ? vh - 32 : origin.height,
        }}
      >
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="source-modal-title" className="truncate font-mono text-sm">
                {stream.field_id}
              </h2>
              <p className="truncate text-[11px] text-muted-foreground">
                {stream.source_file || "—"}
              </p>
            </div>
            <Button size="icon-sm" variant="ghost" onClick={close} aria-label="Close">
              <X />
            </Button>
          </div>
          <div className="mt-3 h-36">
            <StreamChart
              values={stream.sparkline}
              tick={tick}
              marks={marks}
              className="h-36"
              accent="rgb(82, 82, 91)"
            />
          </div>
          <div
            className={cn(
              "mt-4 space-y-4 transition-opacity duration-300 delay-100",
              open ? "opacity-100" : "opacity-0",
            )}
          >
            <section className="space-y-1">
              <h3 className="text-xs tracking-wide text-muted-foreground uppercase">
                Understanding
              </h3>
              {understanding ? (
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">Role </span>
                    {understanding.role}
                    {understanding.hypothesis ? ` · ${understanding.hypothesis}` : ""}
                  </p>
                  {understanding.evidence && (
                    <p className="font-mono text-xs text-muted-foreground">
                      {understanding.evidence}
                    </p>
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
            <section className="space-y-2">
              <h3 className="text-xs tracking-wide text-muted-foreground uppercase">Quality</h3>
              {quality ? (
                <div className="space-y-2 text-sm">
                  <p>
                    {quality.faulty ? "This sensor looks faulty." : "This sensor does not look faulty."}
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
                    <p className="mt-1 flex flex-wrap font-mono text-[10px]">
                      {SCALE.map((label, index) => (
                        <span key={label}>
                          <span className={SCALE_COLOR[label].text}>{label}</span>
                          {index < SCALE.length - 1 ? (
                            <span className="text-muted-foreground"> · </span>
                          ) : null}
                        </span>
                      ))}
                    </p>
                  </div>
                  {quality.summary && (
                    <p className="text-muted-foreground">{quality.summary}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Launch the system agent to judge this sensor&apos;s quality. This is not a process
                  alarm.
                </p>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
