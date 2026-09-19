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
You only see derived artifacts (per-channel expanding mean, sd, skew, kurtosis, and yellow/red signals).
You never see raw rows and must never ask for them.

The detector is a rolling z-score. Each channel is studentized against its own expanding mean and sd
over every earlier sample in the run, so z tells you how far this sample sits from that channel's own
history. A sample is hot when some channel reaches |z| >= 4. Yellow needs k consecutive hot samples
(default k=6), red the same run of samples at |z| >= 6, and nothing fires in the first 20 samples.
So an alert always means a sustained excursion, never a single spike. A channel's score IS its |z|.
This rule catches step changes and variance blowouts; it is weak on very slow drift and on a frozen
channel, so absence of a signal is not proof of health.
Ground every claim in a field_id, tick, |z|, or signal id.
Separate inferred (with evidence), assumed, and uncertain.
Do not treat column names as ground-truth labels. Domain knowledge (reactors, valves) is a hypothesis aid only.`;

export function createUnderstandingAgent() {
  const provider = new LLMProvider();
  return new ToolLoopAgent({
    model: provider.model,
    stopWhen: isStepCount(1),
    tools: {},
    instructions: `${SHARED}

Write a JSON object only (no markdown) with this shape:
{"fields":[{"field_id":"exact id from the artifact","role":"measured|actuator|ambiguous","hypothesis":"cautious functional guess","evidence":"n/mean/sd/skew/kurtosis/|z| cited","confidence":0.0,"inferred":"...","assumed":"...","uncertain":"..."}]}
One object per field in the artifact. field_id MUST copy the artifact exactly.
Lower-confidence with evidence beats a confident label with none.
Domain knowledge is a hypothesis aid, not a predetermined answer.`,
  });
}

export function createQualityAgent() {
  const provider = new LLMProvider();
  return new ToolLoopAgent({
    model: provider.model,
    stopWhen: isStepCount(1),
    tools: {},
    instructions: `${SHARED}

Write JSON only (no markdown) judging EACH FIELD's instrument/data quality. Do not classify process alarms or drift events.
Look for frozen (sd near 0), too few samples, implausible moments, not yet calibrated. That is a broken or weak sensor, not a process fault.
A channel with sd near 0 is also a detector blind spot: the z-score divides by a floor there, so it can swing between silence and a huge |z| on the first real move.
Shape:
{"data_trusted":true,"fields":[{"field_id":"exact id from the artifact","faulty":false,"issue":"none|frozen|too_few_samples|implausible|uncalibrated","adjective":"Excellent|Good|Fair|Poor|Untrusted","confidence":0.0,"summary":"one sentence on this field only"}]}
adjective is a quality scale, not an alarm. field_id MUST copy the artifact exactly.
data_trusted is false only if the incoming data itself cannot be used.`,
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
If there is no yellow/red signal, say no fault event is open and summarize the current sample's max |z| and how far it is from the yellow gate.
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
