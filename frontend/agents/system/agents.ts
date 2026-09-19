import { ToolLoopAgent, isStepCount } from "ai";
import { LLMProvider, payloadHash } from "@/lib/llm/provider";
import { postDecisionLog } from "@/lib/pipeline";

async function logCall(step: string, bytes: number, hash: string) {
  const provider = new LLMProvider();
  await postDecisionLog({
    type: "model_call",
    payload: {
      agent: "system",
      step,
      model: provider.modelId,
      tools: [],
      bytes,
      hash,
      leaves: "derived diagnosis fingerprints only; no raw rows",
    },
    evidence_ref: `system:${step}`,
  });
}

const SHARED = `You are the autonomous system agent for a process monitor.
You only see derived artifacts (expanding mean, sd, skew, kurtosis, yellow/red signals).
You never see raw rows and must never ask for them.
Ground every claim in a field_id, tick, moment score, or signal id.
Separate inferred (with evidence), assumed, and uncertain.
Do not treat column names as ground-truth labels. Domain knowledge (reactors, valves) is a hypothesis aid only.`;

export function createUnderstandingAgent() {
  const provider = new LLMProvider();
  return new ToolLoopAgent({
    model: provider.model,
    stopWhen: isStepCount(1),
    tools: {},
    instructions: `${SHARED}

Write the sensor understanding report.
For each field in the artifact, propose a role (measured / actuator / ambiguous or a cautious functional guess).
Cite the statistical evidence (n, mean, sd, skew, kurtosis, surprise score).
State confidence 0–1. Lower-confidence with evidence beats a confident label with none.
End with a short note that the same unlabeled-column logic applies to non-sensor tables.`,
  });
}

export function createQualityAgent() {
  const provider = new LLMProvider();
  return new ToolLoopAgent({
    model: provider.model,
    stopWhen: isStepCount(1),
    tools: {},
    instructions: `${SHARED}

Write the data-quality report from the artifact only.
Cover completeness, validity, consistency, and timeliness as far as these fingerprints allow (n, sd≈0 frozen, extreme skew/kurtosis, not yet calibrated).
Say explicitly what you cannot check because the compute plane did not send it (missing timestamps, unit labels).
Separate "data cannot be trusted" from "process looks drifted".
First line MUST be exactly: DATA_TRUSTED: yes   or   DATA_TRUSTED: no`,
  });
}

export function createRootCauseAgent() {
  const provider = new LLMProvider();
  return new ToolLoopAgent({
    model: provider.model,
    stopWhen: isStepCount(1),
    tools: {},
    instructions: `${SHARED}

Write a root-cause diagnosis for a non-technical operator.
If there is no yellow/red signal, say no fault event is open and summarize the current run z.
Otherwise: likely fault type (hypothesis), ranked contributing fields with why, confidence, and numbered steps.
Do not invent fields. Cite signal id and tick.`,
  });
}

export function createCritiqueAgent() {
  const provider = new LLMProvider();
  return new ToolLoopAgent({
    model: provider.model,
    stopWhen: isStepCount(1),
    tools: {},
    instructions: `${SHARED}

Challenge the diagnosis you are given. Do not overwrite it.
Offer alternative explanations (dead/frozen field vs process, wrong ranking).
End with agreement: agree | partial | disagree and a confidence adjustment.`,
  });
}

export async function runSystemPrompt(
  step: string,
  agent: ToolLoopAgent,
  prompt: string,
  bytes: number,
  abortSignal?: AbortSignal,
) {
  await logCall(step, bytes, payloadHash(prompt));
  const result = await agent.generate({ prompt, abortSignal });
  return result.text;
}

export { payloadHash };
