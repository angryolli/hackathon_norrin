const PIPELINE_URL = process.env.PIPELINE_URL ?? "http://localhost:8000";

export async function pipeline<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${PIPELINE_URL}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pipeline ${path} ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export async function getConfig() {
  return pipeline<{
    dataset_id: string;
    datasets: string[];
    calibration_id: string | null;
    baseline_established: boolean;
    no_egress: boolean;
    playing?: boolean;
  }>("/config");
}

export async function postConfig(body: Record<string, unknown>) {
  return pipeline("/config", { method: "POST", body: JSON.stringify(body) });
}

export type DiagnosisContributor = {
  field_id: string;
  score: number;
  mean: number | null;
  sd: number | null;
  skew: number | null;
  kurt: number | null;
  n: number;
};

export type DiagnosisSignal = {
  id: string;
  tick: number;
  level: "yellow" | "red";
  score: number;
  z: number;
  top_fields: DiagnosisContributor[];
  evidence: string;
  created_at: string;
};

export type DiagnosisSnapshot = {
  signals: DiagnosisSignal[];
  events?: DiagnosisSignal[];
  current: {
    tick: number;
    n?: number;
    score: number;
    z: number;
    calibrated: boolean;
    fields: DiagnosisContributor[];
  };
  evidence: string;
};

export async function getDiagnosis() {
  return pipeline<DiagnosisSnapshot>("/diagnosis");
}

export async function getDecisionLog(params?: { type?: string }) {
  const q = params?.type ? `?type=${params.type}` : "";
  return pipeline(`/decision-log${q}`);
}

export async function postDecisionLog(body: Record<string, unknown>) {
  return pipeline("/decision-log/append", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getEvents() {
  return pipeline<DiagnosisSnapshot>("/events");
}

export async function getMonitor() {
  return pipeline("/monitor/snapshot");
}

export async function getHealth() {
  return pipeline("/health");
}
