import { ToolLoopAgent, isStepCount, tool } from "ai";
import { z } from "zod";
import { LLMProvider, payloadHash } from "@/lib/llm/provider";
import {
  getConfig,
  getCorrelations,
  getDecisionLog,
  getDiagnosisRanking,
  getProfile,
  getStructuralRoles,
  postDecisionLog,
} from "@/lib/pipeline";
import { rankingArtifactSchema, roleInferenceSchema } from "@/types/artifacts";

async function logCall(agent: string, tools: string[], sent: unknown) {
  const provider = new LLMProvider();
  await postDecisionLog({
    type: "model_call",
    payload: {
      agent,
      backend: provider.backend,
      model: provider.modelId,
      tools,
      bytes: JSON.stringify(sent).length,
      hash: payloadHash(sent),
    },
    evidence_ref: "derived artifacts only",
  });
}

async function calId() {
  const cfg = await getConfig();
  if (!cfg.calibration_id) throw new Error("not calibrated");
  return cfg.calibration_id;
}

const readTools = {
  getProfile: tool({
    description: "Statistical fingerprints. Never raw rows.",
    inputSchema: z.object({}),
    execute: async () => getProfile(await calId()),
  }),
  getCorrelations: tool({
    description: "Top-k correlations and lagged cross-corr. Never raw rows.",
    inputSchema: z.object({}),
    execute: async () => getCorrelations(await calId()),
  }),
  getStructuralRoles: tool({
    description: "Deterministic measured/actuator/ambiguous pre-pass.",
    inputSchema: z.object({}),
    execute: async () => getStructuralRoles(await calId()),
  }),
  getDiagnosisRanking: tool({
    description: "Deterministic contribution ranking for a flagged event.",
    inputSchema: z.object({ event_id: z.string() }),
    execute: async ({ event_id }) => getDiagnosisRanking(event_id),
  }),
  getDecisionLog: tool({
    description: "Audit log of inferences, flags, diagnoses, overrides.",
    inputSchema: z.object({ type: z.string().optional() }),
    execute: async ({ type }) => getDecisionLog(type ? { type } : undefined),
  }),
};

export function createRoleInferenceAgent() {
  const provider = new LLMProvider();
  return new ToolLoopAgent({
    model: provider.model,
    stopWhen: isStepCount(8),
    instructions: `You infer unlabeled sensor roles from artifacts only.
A lower-confidence inference with cited evidence is more valuable than a confident label with no evidence.
Cite the SPECIFIC correlation value, lag, or distribution shape. If evidence is weak, say so and lower confidence.
General domain knowledge (reactors, separators, strippers, instruments) may be used ONLY as hypothesis generation and must be labeled background_knowledge, never as evidence.
Do not invent column names. Call submitRoles when done.`,
    tools: {
      ...pick(readTools, ["getProfile", "getCorrelations", "getStructuralRoles"]),
      submitRoles: tool({
        description: "Store the role-inference report.",
        inputSchema: roleInferenceSchema,
        execute: async (items) => {
          await postDecisionLog({
            type: "inference",
            payload: items,
            evidence_ref: "profile+corr+roles",
          });
          return { stored: true };
        },
      }),
    },
    onStart: async () => {
      await logCall("role-inference", ["getProfile", "getCorrelations", "getStructuralRoles"], {
        why: "role inference",
      });
    },
  });
}

export function createRootCauseAgent() {
  const provider = new LLMProvider();
  return new ToolLoopAgent({
    model: provider.model,
    stopWhen: isStepCount(8),
    instructions: `You narrate a ranking that has already been computed. Do not alter sensor order or invent a different top contributor.
Your confidence statement must match the evidence's stated confidence, not your own assessment of plausibility.
Write a numbered, plain-language explanation for a non-technical operator.`,
    tools: pick(readTools, ["getDiagnosisRanking", "getCorrelations", "getProfile"]),
    onStart: async () => {
      await logCall("root-cause", ["getDiagnosisRanking", "getCorrelations", "getProfile"], {
        why: "root-cause narration",
      });
    },
  });
}

export function createCritiqueAgent() {
  const provider = new LLMProvider();
  return new ToolLoopAgent({
    model: provider.model,
    stopWhen: isStepCount(8),
    instructions: `You challenge a diagnosis using the same evidence pool. Do not overwrite it.
Argue alternative explanations, weak links, or underweighted evidence.
End with agreement: agree|partial|disagree and counterpoints.`,
    tools: pick(readTools, ["getDiagnosisRanking", "getCorrelations", "getProfile"]),
    onStart: async () => {
      await logCall("critique", ["getDiagnosisRanking", "getCorrelations", "getProfile"], {
        why: "critique",
      });
    },
  });
}

export function createChatAgent() {
  const provider = new LLMProvider();
  return new ToolLoopAgent({
    model: provider.model,
    stopWhen: isStepCount(10),
    instructions: `Operator chat. Answer ONLY from artifacts retrieved via tools.
If you cannot find supporting evidence, say you don't have evidence rather than speculating.
Every substantive answer must mention sources as artifact_type:id so the UI can render citations.
Query the decision log when asked if an operator overrode a similar pattern before.`,
    tools: readTools,
    onStart: async () => {
      await logCall(
        "chat",
        Object.keys(readTools),
        { why: "operator chat" },
      );
    },
  });
}

export function createRuleAgent() {
  const provider = new LLMProvider();
  return new ToolLoopAgent({
    model: provider.model,
    stopWhen: isStepCount(4),
    instructions: `Convert a plain-language operating rule into JSON:
{column, condition: gt|lt|abs_gt|stuck|missing_rate, threshold, window, severity: info|warn|fail, rule_text}
column MUST match a real sensor_id from getProfile. Do not emit code.`,
    tools: pick(readTools, ["getProfile"]),
    onStart: async () => {
      await logCall("rule-compiler", ["getProfile"], { why: "rule compile" });
    },
  });
}

function pick<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[],
): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = obj[key];
  return out;
}

export { rankingArtifactSchema };
