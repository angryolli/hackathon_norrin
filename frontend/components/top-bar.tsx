"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RuntimeConfig } from "@/lib/browser-api";

const NAV = [
  { href: "/", label: "Monitor" },
  { href: "/diagnosis", label: "Diagnosis" },
  { href: "/chat", label: "Chat" },
  { href: "/audit", label: "Audit" },
];

export function TopBar() {
  const pathname = usePathname();
  const [cfg, setCfg] = useState<RuntimeConfig | null>(null);

  async function refresh() {
    try {
      const data = await fetch("/api/config").then((r) => r.json());
      setCfg({
        dataset_id: data.dataset_id,
        datasets: data.datasets ?? [],
        calibration_id: data.calibration_id,
        baseline_established: data.baseline_established,
        no_egress: data.node?.noEgress ?? data.no_egress,
        llm_backend: data.node?.backend ?? data.llm_backend,
        llm_model: data.node?.modelId ?? data.llm_model,
      });
    } catch {
      setCfg(null);
    }
  }

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 2500);
    return () => clearInterval(id);
  }, []);

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

  return (
    <header className="border-b border-border bg-background">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2">
        <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
          TPM
        </p>
        <nav className="flex gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                buttonVariants({
                  size: "sm",
                  variant: pathname === item.href ? "secondary" : "ghost",
                }),
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          <select
            className="h-7 rounded-md border border-input bg-background px-2 font-mono"
            value={cfg?.dataset_id ?? "industrial_stream"}
            onChange={(e) => void setDataset(e.target.value)}
          >
            {(cfg?.datasets ?? ["industrial_stream", "expenses"]).map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <span className="font-mono text-muted-foreground">
            cal {cfg?.baseline_established ? "frozen" : "none"}
          </span>
          <span className="font-mono">
            LLM {cfg?.no_egress ? "local" : cfg?.llm_backend ?? "—"}
          </span>
          <Button size="sm" variant={cfg?.no_egress ? "default" : "outline"} onClick={() => void toggleEgress()}>
            No-egress {cfg?.no_egress ? "on" : "off"}
          </Button>
        </div>
      </div>
    </header>
  );
}
