import { createHash } from "node:crypto";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

type Backend = "anthropic" | "local";

type Runtime = {
  noEgress: boolean;
  backend: Backend;
  modelId: string;
};

const runtime: Runtime = {
  noEgress: process.env.NO_EGRESS === "true",
  backend: (process.env.LLM_BACKEND as Backend) || "local",
  modelId: process.env.LLM_MODEL || "gpt-4o-mini",
};

function assertLocal(url: string) {
  try {
    const parsed = new URL(url);
    if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
      throw new Error(`no-egress refuses non-local LLM host: ${parsed.hostname}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("no-egress")) throw err;
    throw new Error("no-egress: OPENAI_BASE_URL must be a localhost URL");
  }
}

export function getRuntime() {
  return { ...runtime };
}

export function setRuntime(patch: Partial<Runtime>) {
  if (patch.noEgress !== undefined) runtime.noEgress = patch.noEgress;
  if (patch.backend) runtime.backend = patch.backend;
  if (patch.modelId) runtime.modelId = patch.modelId;
  if (runtime.noEgress) runtime.backend = "local";
}

export class LLMProvider {
  readonly backend: Backend;
  readonly modelId: string;
  readonly model: LanguageModel;

  constructor() {
    const cfg = getRuntime();
    this.backend = cfg.noEgress ? "local" : cfg.backend;
    this.modelId = cfg.modelId;
    if (cfg.noEgress) {
      const url = process.env.OPENAI_BASE_URL || "http://127.0.0.1:11434/v1";
      assertLocal(url);
    }
    if (this.backend === "anthropic") {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("ANTHROPIC_API_KEY missing");
      this.model = createAnthropic({ apiKey: key })(
        process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      );
      this.modelId = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
      return;
    }
    const url = process.env.OPENAI_BASE_URL || "http://127.0.0.1:11434/v1";
    if (cfg.noEgress) assertLocal(url);
    this.model = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY || "local",
      baseURL: url,
    })(this.modelId);
  }
}

export function payloadHash(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
}
