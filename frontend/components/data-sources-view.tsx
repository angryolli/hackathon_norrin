"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusChip } from "@/components/status-chip";
import { StreamChart } from "@/components/stream-chart";
import {
  browserDelete,
  browserGet,
  browserPost,
  browserPut,
  type DataSource,
  type MonitorSnapshot,
} from "@/lib/browser-api";
import { cn } from "@/lib/utils";

const KINDS = ["process", "business", "other"] as const;
const GENERATORS = ["industrial", "expenses"] as const;

const KIND_LABEL: Record<(typeof KINDS)[number], string> = {
  process: "Process",
  business: "Business",
  other: "Other",
};

const GENERATOR_LABEL: Record<(typeof GENERATORS)[number], string> = {
  industrial: "Industrial stream",
  expenses: "Expense records",
};

type Draft = {
  name: string;
  kind: DataSource["kind"];
  description: string;
  generator: DataSource["generator"];
};

const emptyDraft = (): Draft => ({
  name: "",
  kind: "process",
  description: "",
  generator: "industrial",
});

function toDraft(source: DataSource): Draft {
  return {
    name: source.name,
    kind: source.kind,
    description: source.description,
    generator: source.generator,
  };
}

export function DataSourcesView() {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [adding, setAdding] = useState(false);
  const [createDraft, setCreateDraft] = useState<Draft>(emptyDraft());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [snap, setSnap] = useState<MonitorSnapshot | null>(null);

  async function refresh() {
    const rows = await browserGet<DataSource[]>("/data-sources");
    setSources(rows);
    setDrafts(Object.fromEntries(rows.map((row) => [row.id, toDraft(row)])));
  }

  useEffect(() => {
    void refresh().catch(() => setSources([]));
  }, []);

  useEffect(() => {
    let on = true;
    async function poll() {
      try {
        const data = await browserGet<MonitorSnapshot>("/monitor/snapshot");
        if (on) setSnap(data);
      } catch {
        if (on) setSnap(null);
      }
    }
    void poll();
    const id = setInterval(() => void poll(), 900);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, []);

  async function save(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    setBusy(id);
    setError(null);
    try {
      await browserPut(`/data-sources/${id}`, draft);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(null);
    }
  }

  async function activate(id: string) {
    setBusy(id);
    setError(null);
    try {
      await browserPost("/config", { dataset_id: id });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "activate failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    try {
      await browserDelete(`/data-sources/${id}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!createDraft.name.trim()) {
      setError("Name is required");
      return;
    }
    setBusy("create");
    setError(null);
    try {
      await browserPost("/data-sources", createDraft);
      setAdding(false);
      setCreateDraft(emptyDraft());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto p-4">
      <div className="mb-4 space-y-1">
        <h1 className="text-sm font-medium">Data sources</h1>
        <p className="text-sm text-muted-foreground">
          Choose what data enters the system and how each source is described.
          Process streams and business records use the same pipeline.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sources.map((source) => {
          const draft = drafts[source.id] ?? toDraft(source);
          return (
            <article
              key={source.id}
              className={cn(
                "flex min-h-72 flex-col gap-3 rounded-xl border bg-card p-4",
                source.active ? "border-foreground/40" : "border-border",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <Input
                  value={draft.name}
                  onChange={(e) =>
                    setDrafts((m) => ({
                      ...m,
                      [source.id]: { ...draft, name: e.target.value },
                    }))
                  }
                  aria-label="Data source name"
                />
                {source.active && (
                  <span className="mt-1 shrink-0 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
                    Active
                  </span>
                )}
              </div>
              <p className="font-mono text-[11px] text-muted-foreground">{source.id}</p>
              <label className="space-y-1 text-xs text-muted-foreground">
                <span>Kind</span>
                <select
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                  value={draft.kind}
                  onChange={(e) =>
                    setDrafts((m) => ({
                      ...m,
                      [source.id]: {
                        ...draft,
                        kind: e.target.value as Draft["kind"],
                      },
                    }))
                  }
                >
                  {KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABEL[kind]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                <span>Stream family</span>
                <select
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                  value={draft.generator}
                  onChange={(e) =>
                    setDrafts((m) => ({
                      ...m,
                      [source.id]: {
                        ...draft,
                        generator: e.target.value as Draft["generator"],
                      },
                    }))
                  }
                >
                  {GENERATORS.map((gen) => (
                    <option key={gen} value={gen}>
                      {GENERATOR_LABEL[gen]}
                    </option>
                  ))}
                </select>
              </label>
              <Textarea
                className="min-h-16 flex-1"
                value={draft.description}
                onChange={(e) =>
                  setDrafts((m) => ({
                    ...m,
                    [source.id]: { ...draft, description: e.target.value },
                  }))
                }
                placeholder="What this data source contains"
              />
              <div className="mt-auto flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy === source.id}
                  onClick={() => void save(source.id)}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={source.active || busy === source.id}
                  onClick={() => void activate(source.id)}
                >
                  Use
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy === source.id || sources.length < 2}
                  onClick={() => void remove(source.id)}
                >
                  Delete
                </Button>
              </div>
            </article>
          );
        })}
        {adding ? (
          <article className="flex min-h-72 flex-col gap-3 rounded-xl border border-dashed border-border bg-card p-4">
            <Input
              value={createDraft.name}
              onChange={(e) => setCreateDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Name"
              aria-label="New data source name"
            />
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>Kind</span>
              <select
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                value={createDraft.kind}
                onChange={(e) =>
                  setCreateDraft((d) => ({
                    ...d,
                    kind: e.target.value as Draft["kind"],
                    generator:
                      e.target.value === "business" ? "expenses" : d.generator,
                  }))
                }
              >
                {KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABEL[kind]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>Stream family</span>
              <select
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                value={createDraft.generator}
                onChange={(e) =>
                  setCreateDraft((d) => ({
                    ...d,
                    generator: e.target.value as Draft["generator"],
                  }))
                }
              >
                {GENERATORS.map((gen) => (
                  <option key={gen} value={gen}>
                    {GENERATOR_LABEL[gen]}
                  </option>
                ))}
              </select>
            </label>
            <Textarea
              className="min-h-16 flex-1"
              value={createDraft.description}
              onChange={(e) =>
                setCreateDraft((d) => ({ ...d, description: e.target.value }))
              }
              placeholder="What this data source contains"
            />
            <div className="mt-auto flex flex-wrap gap-2">
              <Button size="sm" disabled={busy === "create"} onClick={() => void create()}>
                Add
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAdding(false);
                  setCreateDraft(emptyDraft());
                }}
              >
                Cancel
              </Button>
            </div>
          </article>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex min-h-72 items-center justify-center rounded-xl border border-dashed border-border bg-card text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
            aria-label="Add data source"
          >
            <Plus className="size-10" strokeWidth={1.5} />
          </button>
        )}
      </div>

      <SensorGrid snap={snap} />
    </div>
  );
}

function SensorGrid({ snap }: { snap: MonitorSnapshot | null }) {
  const sensors = [...(snap?.fields ?? [])].sort((a, b) => {
    const an = Number.parseInt(a.field_id.replace(/\D/g, ""), 10);
    const bn = Number.parseInt(b.field_id.replace(/\D/g, ""), 10);
    const av = Number.isFinite(an) ? an : Number.POSITIVE_INFINITY;
    const bv = Number.isFinite(bn) ? bn : Number.POSITIVE_INFINITY;
    return av !== bv ? av - bv : a.field_id.localeCompare(b.field_id);
  });

  return (
    <section className="mt-8 space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Sensors</h2>
        <p className="text-sm text-muted-foreground">
          Each numeric column in the active data source is a sensor from the first sample.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {sensors.map((sensor) => (
          <div
            key={`${snap?.dataset_id ?? "src"}:${sensor.field_id}`}
            className="min-w-0 rounded-xl border border-border bg-card p-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm">{sensor.field_id}</span>
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  contrib {sensor.contribution.toFixed(2)}
                </span>
                <StatusChip status={sensor.status} />
              </div>
            </div>
            <div className="mt-1 h-28">
              <StreamChart
                values={sensor.sparkline}
                tick={snap?.tick}
                className="h-28"
                accent="rgb(82, 82, 91)"
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
