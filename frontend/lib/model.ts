import { createOpenAI } from "@ai-sdk/openai";

export function getModel() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing in frontend/.env");
  }

  const openai = createOpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });

  return openai(process.env.LLM_MODEL ?? "gpt-4o-mini");
}

export function modelMeta() {
  return {
    provider: "openai-compatible",
    model: process.env.LLM_MODEL ?? "gpt-4o-mini",
    baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  };
}
