import "server-only";

export type SystemAgentStatus = {
  running: boolean;
  startedAt: string | null;
  lastBeatAt: string | null;
};

type Handle = {
  status: SystemAgentStatus;
  timer: ReturnType<typeof setInterval> | null;
};

const g = globalThis as typeof globalThis & {
  __norrinSystemAgent?: Handle;
};

function handle(): Handle {
  if (!g.__norrinSystemAgent) {
    g.__norrinSystemAgent = {
      status: { running: false, startedAt: null, lastBeatAt: null },
      timer: null,
    };
  }
  return g.__norrinSystemAgent;
}

function beat() {
  handle().status.lastBeatAt = new Date().toISOString();
}

export function getSystemAgentStatus(): SystemAgentStatus {
  return { ...handle().status };
}

export function startSystemAgent(): SystemAgentStatus {
  const runtime = handle();
  if (runtime.status.running) return getSystemAgentStatus();
  runtime.status.running = true;
  runtime.status.startedAt = new Date().toISOString();
  beat();
  runtime.timer = setInterval(beat, 15_000);
  return getSystemAgentStatus();
}

export function stopSystemAgent(): SystemAgentStatus {
  const runtime = handle();
  if (runtime.timer) {
    clearInterval(runtime.timer);
    runtime.timer = null;
  }
  runtime.status.running = false;
  runtime.status.startedAt = null;
  runtime.status.lastBeatAt = null;
  return getSystemAgentStatus();
}
