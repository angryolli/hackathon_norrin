"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChevronsLeft,
  Database,
  Gauge,
  MessageSquare,
  PanelLeft,
  Settings,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { browserGet, type DataSource, type RuntimeConfig } from "@/lib/browser-api";

const NAV = [
  { href: "/", label: "System Monitor", icon: Gauge },
  { href: "/agent", label: "Agent", icon: MessageSquare },
  { href: "/data", label: "Data", icon: Database },
];

export function AppSidebar() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cfg, setCfg] = useState<RuntimeConfig | null>(null);
  const [sources, setSources] = useState<DataSource[]>([]);

  useEffect(() => {
    setMounted(true);
    try {
      if (window.localStorage.getItem("tpm-sidebar") === "1") setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  async function refresh() {
    try {
      const data = await fetch("/api/config").then((r) => r.json());
      setCfg({
        dataset_id: data.dataset_id,
        datasets: data.datasets ?? [],
        calibration_id: data.calibration_id,
        baseline_established: data.baseline_established,
        no_egress: data.node?.noEgress ?? data.no_egress,
      });
      try {
        setSources(await browserGet<DataSource[]>("/data-sources"));
      } catch {
        setSources([]);
      }
    } catch {
      setCfg(null);
    }
  }

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 2500);
    return () => clearInterval(id);
  }, []);

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      window.localStorage.setItem("tpm-sidebar", next ? "1" : "0");
      return next;
    });
  }

  async function setDataset(dataset_id: string) {
    await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id }),
    });
    await refresh();
  }

  async function toggleEgress() {
    await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ no_egress: !cfg?.no_egress }),
    });
    await refresh();
  }

  const folded = mounted && collapsed;

  useEffect(() => {
    if (!settingsOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSettingsOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen]);

  return (
    <>
      <aside
        className={cn(
          "gpu-layer sticky top-0 flex h-svh shrink-0 flex-col self-start border-r border-border bg-background transition-[width] duration-200",
          folded ? "w-14" : "w-52",
        )}
        style={{ transform: "translate3d(0,0,0)", willChange: "width, transform" }}
      >
        <div className={cn("flex items-center gap-2 px-3 py-3", folded && "justify-center px-0")}>
          <p
            className={cn(
              "flex-1 font-mono text-xs tracking-widest text-muted-foreground uppercase",
              folded && "hidden",
            )}
          >
            TPM
          </p>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={toggleCollapsed}
            aria-label={folded ? "Expand sidebar" : "Collapse sidebar"}
          >
            {folded ? <PanelLeft /> : <ChevronsLeft />}
          </Button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-2">
          {NAV.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-lg px-2 text-sm transition-colors",
                  folded && "justify-center px-0",
                  active
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className={cn(folded && "hidden")}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-2">
          <Button
            size={folded ? "icon" : "sm"}
            variant={settingsOpen ? "secondary" : "ghost"}
            className={cn("w-full", !folded && "justify-start gap-2")}
            onClick={() => setSettingsOpen((v) => !v)}
            aria-label="Settings"
          >
            <Settings />
            <span className={cn(folded && "hidden")}>Settings</span>
          </Button>
        </div>
      </aside>

      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            className="w-full max-w-md rounded-xl border border-border bg-card p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id="settings-title" className="text-sm font-medium">
                Settings
              </h2>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setSettingsOpen(false)}
                aria-label="Close settings"
              >
                <X />
              </Button>
            </div>
            <div className="space-y-4 text-sm">
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Active data source</span>
                <select
                  className="h-8 w-full rounded-md border border-input bg-background px-2 font-mono text-xs"
                  value={cfg?.dataset_id ?? "industrial_stream"}
                  onChange={(e) => void setDataset(e.target.value)}
                >
                  {(sources.length
                    ? sources
                    : (cfg?.datasets ?? ["industrial_stream", "expenses"]).map((id) => ({
                        id,
                        name: id,
                      }))
                  ).map((src) => (
                    <option key={src.id} value={src.id}>
                      {src.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="font-mono text-xs text-muted-foreground">
                Calibration {cfg?.baseline_established ? "frozen" : "none"}
              </p>
              <p className="font-mono text-xs text-muted-foreground">
                LLM Mistral Large via OpenAI-compatible API
              </p>
              <Button
                size="sm"
                className="w-full"
                variant={cfg?.no_egress ? "default" : "outline"}
                onClick={() => void toggleEgress()}
              >
                No-egress {cfg?.no_egress ? "on" : "off"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
