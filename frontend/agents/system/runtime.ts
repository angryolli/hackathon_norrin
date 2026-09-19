import "server-only";

import { dataFlowRecord, runSystemCycle } from "./cycle";
import type { SystemAgentStatus, SystemReport, SystemStep } from "./types";

type Handle = {
  status: Omit<SystemAgentStatus, "dataFlow">;
  abort: AbortController | null;
  job: Promise<void> | null;
};

const g = globalThis as typeof globalThis & {
  __norrinSystemAgent?: Handle;
};

function emptyStatus(): Omit<SystemAgentStatus, "dataFlow"> {
  return {
    running: false,
    loop: "manual",
    step: "idle",
    startedAt: null,
    lastCycleAt: null,
    lastBeatAt: null,
    error: null,
    eventId: null,
    dataTrusted: null,
    understanding: null,
    quality: null,
    diagnosis: null,
    critique: null,
    sensors: {},
  };
}

function handle(): Handle {
  if (!g.__norrinSystemAgent) {
    g.__norrinSystemAgent = {
      status: emptyStatus(),
      abort: null,
      job: null,
    };
  }
  return g.__norrinSystemAgent;
}

function snapshot(): SystemAgentStatus {
  const status = handle().status;
  if (!status.sensors) status.sensors = {};
  return { ...status, dataFlow: dataFlowRecord() };
}

export function getSystemAgentStatus(): SystemAgentStatus {
  return snapshot();
}

export function startSystemAgent(): SystemAgentStatus {
  const runtime = handle();
  if (runtime.status.running) return snapshot();
  runtime.abort = new AbortController();
  runtime.status.running = true;
  runtime.status.step = "understanding";
  runtime.status.error = null;
  runtime.status.startedAt = new Date().toISOString();
  runtime.status.lastBeatAt = runtime.status.startedAt;
  const abort = runtime.abort;
  runtime.job = runSystemCycle({
    aborted: () => abort.signal.aborted,
    abortSignal: abort.signal,
    setStep: (step: SystemStep) => {
      runtime.status.step = step;
      runtime.status.lastBeatAt = new Date().toISOString();
    },
    setEventId: (id) => {
      runtime.status.eventId = id;
    },
    setDataTrusted: (value) => {
      runtime.status.dataTrusted = value;
    },
    setReport: (key, report: SystemReport) => {
      runtime.status[key] = report;
      runtime.status.lastBeatAt = new Date().toISOString();
    },
    mergeSensors: (patch) => {
      const next = { ...(runtime.status.sensors ?? {}) };
      for (const [id, note] of Object.entries(patch)) {
        next[id] = { ...next[id], ...note };
      }
      runtime.status.sensors = next;
    },
  })
    .then(() => {
      if (abort.signal.aborted) return;
      runtime.status.lastCycleAt = new Date().toISOString();
      runtime.status.step = "idle";
    })
    .catch((err) => {
      runtime.status.step = "error";
      runtime.status.error = err instanceof Error ? err.message : "system cycle failed";
    })
    .finally(() => {
      runtime.status.running = false;
      runtime.abort = null;
      runtime.job = null;
    });
  return snapshot();
}

export function stopSystemAgent(): SystemAgentStatus {
  const runtime = handle();
  runtime.abort?.abort();
  runtime.abort = null;
  runtime.status.running = false;
  if (runtime.status.step !== "error") runtime.status.step = "idle";
  return snapshot();
}

export type { SystemAgentStatus } from "./types";
