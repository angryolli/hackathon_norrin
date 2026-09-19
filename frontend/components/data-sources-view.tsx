"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/status-chip";
import { StreamChart } from "@/components/stream-chart";
import {
  browserPost,
  monitorStreamUrl,
  type DataSourcePreview,
  type FieldCard,
  type MonitorSnapshot,
} from "@/lib/browser-api";
import { cn } from "@/lib/utils";

type OriginChoice = "api" | "file" | null;

const DEMO_URI = (process.env.NEXT_PUBLIC_DEMO_DATA_URI ?? "").trim();
const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export function DataSourcesView() {
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState<OriginChoice>(null);
  const [apiUrl, setApiUrl] = useState("");
  const [filePath, setFilePath] = useState(DEMO_URI);
  const [preview, setPreview] = useState<DataSourcePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [xColumn, setXColumn] = useState("");
  const [yColumns, setYColumns] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snap, setSnap] = useState<MonitorSnapshot | null>(null);
  const ticksRef = useRef({ tick: -1, demo: -1, dataset: "", playing: false });

  useEffect(() => {
    let on = true;
    let source: EventSource | null = null;

    function apply(data: MonitorSnapshot) {
      if (!on) return;
      if (
        data.tick === ticksRef.current.tick &&
        data.dataset_id === ticksRef.current.dataset &&
        Boolean(data.playing) === ticksRef.current.playing
      ) {
        return;
      }
      ticksRef.current = {
        tick: data.tick,
        demo: data.tick,
        dataset: data.dataset_id,
        playing: Boolean(data.playing),
      };
      setSnap(data);
    }

    function connect() {
      source?.close();
      source = new EventSource(monitorStreamUrl());
      source.addEventListener("snapshot", (event) => {
        try {
          apply(JSON.parse((event as MessageEvent<string>).data) as MonitorSnapshot);
        } catch {
          /* ignore malformed frames */
        }
      });
      source.onmessage = (event) => {
        try {
          apply(JSON.parse(event.data) as MonitorSnapshot);
        } catch {
          /* ignore malformed frames */
        }
      };
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
    if (!adding) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeModal();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adding]);

  useEffect(() => {
    if (!adding || choice !== "file") return;
    const path = filePath.trim();
    if (!path) {
      setPreview(null);
      return;
    }
    let on = true;
    const controller = new AbortController();
    const handle = window.setTimeout(() => {
      setPreviewing(true);
      setError(null);
      void browserPost<DataSourcePreview>(
        "/data-sources/preview",
        { path },
        controller.signal,
      )
        .then((data) => {
          if (!on) return;
          setPreview(data);
          setXColumn("");
          setYColumns([]);
        })
        .catch((err) => {
          if (!on) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          setPreview(null);
          setXColumn("");
          setYColumns([]);
          setError(err instanceof Error ? err.message : "could not read headers");
        })
        .finally(() => {
          if (on) setPreviewing(false);
        });
    }, 350);
    return () => {
      on = false;
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [adding, choice, filePath]);

  function closeModal() {
    setAdding(false);
    setChoice(null);
    setApiUrl("");
    setFilePath(DEMO_URI || snap?.demo_data_uri || "");
    setPreview(null);
    setPreviewing(false);
    setXColumn("");
    setYColumns([]);
    setError(null);
  }

  function toggleY(column: string) {
    setYColumns((current) =>
      current.includes(column)
        ? current.filter((item) => item !== column)
        : [...current, column],
    );
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
          origin: "api",
          api_url: apiUrl.trim(),
        });
      } else if (choice === "file") {
        if (!filePath.trim()) {
          setError("File path is required");
          return;
        }
        if (!xColumn) {
          setError("Pick an x-axis column");
          return;
        }
        if (yColumns.length === 0) {
          setError("Pick at least one data column");
          return;
        }
        await browserPost("/data-sources/file", {
          path: filePath.trim(),
          x_column: xColumn,
          y_columns: yColumns,
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

  async function togglePlay() {
    const next = !(snap?.playing ?? false);
    try {
      const updated = await browserPost<MonitorSnapshot>("/stream/control", {
        playing: next,
      });
      ticksRef.current = {
        tick: updated.tick,
        demo: updated.tick,
        dataset: updated.dataset_id,
        playing: Boolean(updated.playing),
      };
      setSnap(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "play control failed");
    }
  }

  const yOptions = useMemo(() => {
    if (!preview) return [];
    const numeric = new Set(preview.numeric);
    return preview.columns
      .filter((column) => column !== xColumn)
      .sort((a, b) => Number(numeric.has(b)) - Number(numeric.has(a)));
  }, [preview, xColumn]);

  const streams = useMemo(() => {
    return [...(snap?.fields ?? [])].sort((a, b) => {
      const file = (a.source_file ?? "").localeCompare(b.source_file ?? "");
      if (file !== 0) return file;
      const an = Number.parseInt(a.field_id.replace(/\D/g, ""), 10);
      const bn = Number.parseInt(b.field_id.replace(/\D/g, ""), 10);
      const av = Number.isFinite(an) ? an : Number.POSITIVE_INFINITY;
      const bv = Number.isFinite(bn) ? bn : Number.POSITIVE_INFINITY;
      return av !== bv ? av - bv : a.field_id.localeCompare(b.field_id);
    });
  }, [snap]);

  const playing = Boolean(snap?.playing);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
        <Button
          size="icon-sm"
          variant={playing ? "secondary" : "default"}
          onClick={() => void togglePlay()}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        <span className="text-sm text-muted-foreground">
          {playing
            ? "Playing all sources"
            : streams.length === 0
              ? "Add sources, then play"
              : "Paused"}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={cn(
              STREAM_CARD,
              "flex appearance-none items-center justify-center border-dashed text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground",
            )}
            aria-label="Add data source"
          >
            <Plus className="size-8" strokeWidth={1.5} />
          </button>
          {streams.map((stream) => (
            <StreamTile
              key={`${stream.source_id ?? snap?.dataset_id ?? "src"}:${stream.field_id}`}
              stream={stream}
              tick={snap?.tick}
            />
          ))}
        </div>
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
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-lg"
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
                onClick={() => {
                  setChoice("file");
                  setFilePath((current) => current.trim() || snap?.demo_data_uri || DEMO_URI);
                }}
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
                {choice === "api" ? (
                  <label className="block space-y-1 text-xs text-muted-foreground">
                    <span>URL</span>
                    <Input
                      value={apiUrl}
                      onChange={(e) => setApiUrl(e.target.value)}
                      placeholder="https://…"
                    />
                  </label>
                ) : (
                  <>
                    <label className="block space-y-1 text-xs text-muted-foreground">
                      <span>File path</span>
                      <Input
                        value={filePath}
                        onChange={(e) => {
                          setFilePath(e.target.value);
                          setPreview(null);
                          setXColumn("");
                          setYColumns([]);
                        }}
                        placeholder="/path/to/data.csv"
                      />
                    </label>
                    {previewing && (
                      <p className="text-xs text-muted-foreground">Reading column names…</p>
                    )}
                    {preview && (
                      <>
                        <label className="block space-y-1 text-xs text-muted-foreground">
                          <span>X-axis</span>
                          <select
                            className={SELECT_CLASS}
                            value={xColumn}
                            onChange={(e) => {
                              const next = e.target.value;
                              setXColumn(next);
                              setYColumns((current) => current.filter((col) => col !== next));
                            }}
                          >
                            <option value="">Select column</option>
                            {preview.columns.map((column) => (
                              <option key={column} value={column}>
                                {column}
                              </option>
                            ))}
                          </select>
                        </label>
                        {xColumn && (
                          <fieldset className="space-y-2">
                            <legend className="text-xs text-muted-foreground">
                              Data columns
                            </legend>
                            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                              {yOptions.map((column) => (
                                <label
                                  key={column}
                                  className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-secondary"
                                >
                                  <input
                                    type="checkbox"
                                    checked={yColumns.includes(column)}
                                    onChange={() => toggleY(column)}
                                  />
                                  <span className="truncate font-mono text-xs">{column}</span>
                                </label>
                              ))}
                            </div>
                          </fieldset>
                        )}
                      </>
                    )}
                  </>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button
                  className="w-full"
                  disabled={
                    busy ||
                    previewing ||
                    (choice === "file" && (!xColumn || yColumns.length === 0))
                  }
                  onClick={() => void submit()}
                >
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

const STREAM_CARD = "box-border h-52 min-w-0 rounded-xl border bg-card p-2";

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
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 13rem" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-sm">{stream.field_id}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {stream.source_file || "—"}
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            contrib {stream.contribution.toFixed(2)}
          </span>
          <StatusChip status={stream.status} />
        </div>
      </div>
      <div className="mt-1 h-36">
        <StreamChart
          values={stream.sparkline}
          tick={tick}
          className="h-36"
          accent="rgb(82, 82, 91)"
        />
      </div>
    </div>
  );
});
