export type SystemStep =
  | "idle"
  | "understanding"
  | "quality"
  | "diagnosis"
  | "error";

export type SystemReport = {
  text: string;
  generatedAt: string;
  model: string;
  hash: string;
  bytes: number;
};

export type DataFlowRecord = {
  model: string;
  host: string;
  noEgress: boolean;
  leaves: string;
  why: string;
  swap: string;
};

export type SystemAgentStatus = {
  running: boolean;
  loop: "manual" | "continuous";
  step: SystemStep;
  startedAt: string | null;
  lastCycleAt: string | null;
  lastBeatAt: string | null;
  error: string | null;
  eventId: string | null;
  dataTrusted: boolean | null;
  understanding: SystemReport | null;
  quality: SystemReport | null;
  diagnosis: SystemReport | null;
  critique: SystemReport | null;
  dataFlow: DataFlowRecord;
};
