"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function DashboardSection({
  title,
  subtitle,
  children,
  variant = "primary",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
}) {
  const Heading = variant === "primary" ? "h2" : "h3";
  return (
    <section className={cn("space-y-4", variant === "secondary" && "space-y-3")}>
      <div className="min-w-0">
        <Heading
          className={cn(
            "font-medium",
            variant === "primary" ? "text-sm" : "text-sm text-foreground/90",
          )}
        >
          {title}
        </Heading>
        {subtitle ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
