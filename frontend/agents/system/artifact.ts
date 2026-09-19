import type { DiagnosisSnapshot } from "@/lib/pipeline";

const CEILING = 20_000;

export function clipDiagnosis(snap: DiagnosisSnapshot) {
  const fields = (snap.current?.fields ?? []).slice(0, 24).map((field) => ({
    field_id: field.field_id,
    n: field.n,
    mean: field.mean,
    sd: field.sd,
    skew: field.skew,
    kurt: field.kurt,
    score: field.score,
  }));
  const signals = (snap.signals ?? snap.events ?? []).slice(0, 8).map((row) => ({
    id: row.id,
    tick: row.tick,
    level: row.level,
    score: row.score,
    z: row.z,
    evidence: row.evidence,
    top_fields: row.top_fields.slice(0, 5),
  }));
  const artifact = {
    evidence: snap.evidence,
    current: {
      tick: snap.current?.tick ?? 0,
      n: snap.current?.n ?? 0,
      score: snap.current?.score ?? 0,
      z: snap.current?.z ?? 0,
      calibrated: Boolean(snap.current?.calibrated),
      fields,
    },
    signals,
  };
  let json = JSON.stringify(artifact);
  if (json.length > CEILING) {
    artifact.current.fields = artifact.current.fields.slice(0, 10);
    artifact.signals = artifact.signals.slice(0, 3);
    json = JSON.stringify(artifact);
  }
  return { artifact, json, bytes: json.length };
}
