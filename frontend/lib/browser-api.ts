const BASE = process.env.NEXT_PUBLIC_PIPELINE_URL ?? "http://localhost:8000";

export async function browserGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return (await res.json()) as T;
}

export async function browserPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return (await res.json()) as T;
}

export async function browserPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return (await res.json()) as T;
}

export async function browserDelete(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE", cache: "no-store" });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
}

export type Chip = "normal" | "drifting" | "stuck" | "out_of_range" | "excluded";

export type SensorCard = {
  sensor_id: string;
  sparkline: number[];
  status: Chip;
  contribution: number;
  evidence: string;
};

export type MonitorSnapshot = {
  calibration_id: string | null;
  dataset_id: string;
  tick: number;
  t2_series: number[];
  control_limit: number;
  sensors: SensorCard[];
  exclusion_list: string[];
  latest_event_id: string | null;
  evidence: string;
};

export type RuntimeConfig = {
  dataset_id: string;
  datasets: string[];
  calibration_id: string | null;
  baseline_established: boolean;
  no_egress: boolean;
};

export type ChatSummary = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type ChatDetail = ChatSummary & {
  messages: Array<{
    id: string;
    role: string;
    parts: Array<{ type: string; text?: string; [key: string]: unknown }>;
  }>;
};
