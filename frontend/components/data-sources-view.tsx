"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/status-chip";
import { StreamChart } from "@/components/stream-chart";
import {
  browserPost,
  browserGet,
  type FieldCard,
  type MonitorSnapshot,
} from "@/lib/browser-api";
import { cn } from "@/lib/utils";

type OriginChoice = "api" | "file" | null;

export function DataSourcesView() {
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState<OriginChoice>(null);
  const [name, setName] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snap, setSnap] = useState<MonitorSnapshot | null>(null);
  const ticksRef = useRef({ tick: -1, demo: -1, dataset: "" });

  useEffect(() => {
    let on = true;
    async function poll() {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const data = await browserGet<MonitorSnapshot>("/monitor/snapshot");
        if (!on) return;
        const demoTick = data.demo_tick ?? 0;
        if (
          data.tick === ticksRef.current.tick &&
          demoTick === ticksRef.current.demo &&
          data.dataset_id === ticksRef.current.dataset
        ) {
          return;
        }
        ticksRef.current = {
          tick: data.tick,
          demo: demoTick,
          dataset: data.dataset_id,
        };
        setSnap(data);
      } catch {
        if (on) setSnap(null);
      }
    }
    void poll();
    const id = setInterval(() => void poll(), 1000);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!adding) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeModal();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adding]);

  function closeModal() {
    setAdding(false);
    setChoice(null);
    setName("");
    setApiUrl("");
    setFile(null);
    setError(null);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (choice === "api") {
        if (!apiUrl.trim()) {
          setError("API URL is required");
          return;
        }
        await browserPost("/data-sources/api", {
          name: name.trim() || "API source",
          origin: "api",
          api_url: apiUrl.trim(),
        });
      } else if (choice === "file") {
        if (!file) {
          setError("Choose a CSV or Excel file");
          return;
        }
        const content_b64 = await fileToBase64(file);
        await browserPost("/data-sources/file", {
          name: name.trim() || file.name.replace(/\.[^.]+$/, ""),
          filename: file.name,
          content_b64,
        });
      } else {
        return;
      }
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "add failed");
    } finally {
      setBusy(false);
    }
  }

  const streams = useMemo(() => {
    const fakeStreams = [...(snap?.fields ?? [])].sort((a, b) => {
      const an = Number.parseInt(a.field_id.replace(/\D/g, ""), 10);
      const bn = Number.parseInt(b.field_id.replace(/\D/g, ""), 10);
      const av = Number.isFinite(an) ? an : Number.POSITIVE_INFINITY;
      const bv = Number.isFinite(bn) ? bn : Number.POSITIVE_INFINITY;
      return av !== bv ? av - bv : a.field_id.localeCompare(b.field_id);
    });
    const demoStreams = snap?.demo_fields ?? [];
    const demoIds = new Set(demoStreams.map((d) => d.field_id));
    return { items: [...fakeStreams, ...demoStreams], demoIds };
  }, [snap]);

  return (
    <div className="h-full min-h-0 overflow-y-auto p-4">
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={cn(
            STREAM_CARD,
            "flex appearance-none flex-col border-dashed text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground",
          )}
          aria-label="Add data source"
        >
          <div className="h-7" />
          <div className="mt-1 flex h-28 items-center justify-center">
            <Plus className="size-8" strokeWidth={1.5} />
          </div>
        </button>
        {streams.items.map((stream) => (
          <StreamTile
            key={`${snap?.dataset_id ?? "src"}:${stream.field_id}`}
            stream={stream}
            tick={
              streams.demoIds.has(stream.field_id) ? snap?.demo_tick : snap?.tick
            }
          />
        ))}
      </div>

      {adding && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
          onClick={closeModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-source-title"
            className="w-full max-w-md rounded-xl border border-border bg-card p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id="add-source-title" className="text-sm font-medium">
                Add data source
              </h2>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={closeModal}
                aria-label="Close"
              >
                <X />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setChoice("api")}
                className={cn(
                  "rounded-xl border px-3 py-6 text-sm transition-colors",
                  choice === "api"
                    ? "border-foreground/40 bg-secondary"
                    : "border-border hover:border-foreground/30",
                )}
              >
                API
              </button>
              <button
                type="button"
                onClick={() => setChoice("file")}
                className={cn(
                  "rounded-xl border px-3 py-6 text-sm transition-colors",
                  choice === "file"
                    ? "border-foreground/40 bg-secondary"
                    : "border-border hover:border-foreground/30",
                )}
              >
                CSV / Excel
              </button>
            </div>
            {choice && (
              <div className="mt-4 space-y-3">
                <label className="block space-y-1 text-xs text-muted-foreground">
                  <span>Name</span>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={choice === "file" ? "From file name if empty" : "API source"}
                  />
                </label>
                {choice === "api" ? (
                  <label className="block space-y-1 text-xs text-muted-foreground">
                    <span>API URL</span>
                    <Input
                      value={apiUrl}
                      onChange={(e) => setApiUrl(e.target.value)}
                      placeholder="https://…"
                    />
                  </label>
                ) : (
                  <label className="block space-y-1 text-xs text-muted-foreground">
                    <span>File</span>
                    <Input
                      type="file"
                      accept=".csv,.txt,.xlsx,.xls,.xlsm,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button className="w-full" disabled={busy} onClick={() => void submit()}>
                  Add
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const STREAM_CARD = "box-border h-40 min-w-0 rounded-xl border bg-card p-2";

const StreamTile = memo(function StreamTile({
  stream,
  tick,
}: {
  stream: FieldCard;
  tick?: number;
}) {
  return (
    <div
      className={STREAM_CARD}
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 10rem" }}
    >
      <div className="flex h-7 items-center justify-between gap-2">
        <span className="font-mono text-sm">{stream.field_id}</span>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            contrib {stream.contribution.toFixed(2)}
          </span>
          <StatusChip status={stream.status} />
        </div>
      </div>
      <div className="mt-1 h-28">
        <StreamChart
          values={stream.sparkline}
          tick={tick}
          className="h-28"
          accent="rgb(82, 82, 91)"
        />
      </div>
    </div>
  );
});

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const comma = text.indexOf(",");
      resolve(comma >= 0 ? text.slice(comma + 1) : text);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}
