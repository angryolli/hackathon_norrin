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
    llm_backend: string;
    llm_model: string;
  }>("/config");
}

export async function postConfig(body: Record<string, unknown>) {
  return pipeline("/config", { method: "POST", body: JSON.stringify(body) });
}

export async function getProfile(calibrationId: string) {
  return pipeline(`/profile/${calibrationId}`);
}

export async function getCorrelations(calibrationId: string) {
  return pipeline(`/correlations/${calibrationId}`);
}

export async function getStructuralRoles(calibrationId: string) {
  return pipeline(`/structural-roles/${calibrationId}`);
}

export async function getDiagnosisRanking(eventId: string) {
  return pipeline(`/diagnosis/ranking/${eventId}`);
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

export async function compileRule(calibrationId: string, rule: unknown) {
  return pipeline("/rules/compile", {
    method: "POST",
    body: JSON.stringify({ calibration_id: calibrationId, rule }),
  });
}

export async function qualityCheck(calibrationId: string) {
  return pipeline("/quality-check", {
    method: "POST",
    body: JSON.stringify({ calibration_id: calibrationId, batch_range: "latest" }),
  });
}

export async function driftScore(calibrationId: string) {
  return pipeline("/drift/score", {
    method: "POST",
    body: JSON.stringify({ calibration_id: calibrationId, batch_range: "latest" }),
  });
}

export async function getEvents() {
  return pipeline<{ events: unknown[] }>("/events");
}

export async function getMonitor() {
  return pipeline("/monitor/snapshot");
}

export async function getHealth() {
  return pipeline("/health");
}
