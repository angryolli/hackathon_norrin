"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
import { browserPost, eventsStreamUrl } from "@/lib/browser-api";

type EventRow = {
  event_id: string;
  t2: number;
  spe: number;
  control_limit: number;
  flagged: boolean;
  evidence: string;
  confirmed?: boolean;
  override?: { classification?: string; note?: string };
  ranking?: {
    confidence: number;
    ranked: { field: string; contribution_score: number; evidence: string }[];
  };
};

export function DiagnosisView() {
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [narrative, setNarrative] = useState<Record<string, string>>({});
  const [critique, setCritique] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  useEffect(() => {
    let on = true;
    let source: EventSource | null = null;
    const sig = { current: "" };

    function apply(data: { events?: EventRow[] }) {
      if (!on) return;
      const next = data.events ?? [];
      const nextSig = next
        .map(
          (ev) =>
            `${ev.event_id}:${ev.flagged ? 1 : 0}:${ev.confirmed ? 1 : 0}:${ev.override ? 1 : 0}:${ev.t2}`,
        )
        .join("|");
      if (nextSig === sig.current) return;
      sig.current = nextSig;
      setEvents(next);
    }

    function connect() {
      source?.close();
      source = new EventSource(eventsStreamUrl());
      source.addEventListener("events", (event) => {
        try {
          apply(JSON.parse((event as MessageEvent<string>).data) as { events?: EventRow[] });
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

  async function narrate(eventId: string, asCritique = false) {
    const res = await fetch("/api/agents/root-cause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: eventId, critique: asCritique }),
    });
    const data = await res.json();
    if (asCritique) setCritique((m) => ({ ...m, [eventId]: data.text || data.error }));
    else setNarrative((m) => ({ ...m, [eventId]: data.text || data.error }));
  }

  async function accept(eventId: string) {
    await browserPost("/decision-log/append", {
      type: "inference",
      payload: { event_id: eventId, accepted: true },
      evidence_ref: eventId,
    });
  }

  async function override(eventId: string) {
    await browserPost("/decision-log/append", {
      type: "override",
      payload: {
        event_id: eventId,
        classification: note || "dismiss",
      },
      evidence_ref: eventId,
      human_overridden: true,
    });
    setNote("");
  }

  return (
    <div className="grid h-full min-h-0 gap-4 overflow-hidden p-4 lg:grid-cols-2">
      <div className="min-h-0 space-y-3 overflow-y-auto">
        <h2 className="text-sm font-medium">Flagged events</h2>
      {events.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No flagged events yet. Wait for the live stream to drift.
        </p>
      )}
      {events.map((ev) => (
        <Card key={ev.event_id}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between font-mono text-sm">
              <span>{ev.event_id}</span>
              <span>
                T² {ev.t2.toFixed(2)} / {ev.control_limit.toFixed(2)}
                {ev.confirmed ? " · confirmed" : ""}
                {ev.override ? " · overridden" : ""}
              </span>
            </CardTitle>
            <CardDescription className="font-mono text-xs">
              {ev.evidence}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button size="sm" variant="ghost" onClick={() => setOpen(open === ev.event_id ? null : ev.event_id)}>
              {open === ev.event_id ? "Collapse" : "Expand"}
            </Button>
            {open === ev.event_id && (
              <div className="space-y-3">
                <ol className="list-decimal space-y-1 pl-4 font-mono text-xs">
                  {(ev.ranking?.ranked ?? []).map((row) => (
                    <li key={row.field}>
                      {row.field} · {row.contribution_score.toFixed(3)} · {row.evidence}
                    </li>
                  ))}
                </ol>
                <p className="text-xs">
                  Confidence (from ranking, not the LLM): {ev.ranking?.confidence ?? "—"}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void narrate(ev.event_id)}>
                    Narrate
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void narrate(ev.event_id, true)}>
                    Critique
                  </Button>
                  <Button size="sm" onClick={() => void accept(ev.event_id)}>
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      router.push(`/agent?context=event_id=${ev.event_id}`)
                    }
                  >
                    Question
                  </Button>
                </div>
                {narrative[ev.event_id] && (
                  <pre className="whitespace-pre-wrap text-sm">{narrative[ev.event_id]}</pre>
                )}
                {critique[ev.event_id] && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                    <p className="mb-1 text-xs font-medium tracking-wide uppercase">
                      Critique (unresolved)
                    </p>
                    {critique[ev.event_id]}
                  </div>
                )}
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Override classification or dismiss"
                />
                <Button size="sm" variant="destructive" onClick={() => void override(ev.event_id)}>
                  Override
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
      </div>
      <div className="min-h-0 overflow-y-auto rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium">Decision log</h2>
        </div>
        <AuditView />
      </div>
    </div>
  );
}
