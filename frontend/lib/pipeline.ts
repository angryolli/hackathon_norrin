const PIPELINE_URL = process.env.PIPELINE_URL ?? "http://localhost:8000";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${PIPELINE_URL}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Pipeline ${path} failed: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchHealth() {
  return getJson<{ status: string; role?: string }>("/health");
}

export async function fetchPipeline() {
  return getJson<unknown>("/pipeline");
}

export async function fetchProfiles() {
  return getJson<unknown>("/pipeline/profile");
}

export async function fetchQuality() {
  return getJson<unknown>("/pipeline/quality");
}

export async function fetchCorrelations() {
  return getJson<unknown>("/pipeline/correlations");
}

export async function fetchDrift() {
  return getJson<unknown>("/pipeline/drift");
}

export async function fetchAttribution() {
  return getJson<unknown>("/pipeline/attribution");
}
