import { ToolLoopAgent, isStepCount, tool } from "ai";
import { z } from "zod";
import { LLMProvider, payloadHash } from "@/lib/llm/provider";
import { getDecisionLog, getDiagnosis, postDecisionLog } from "@/lib/pipeline";

async function logCall(agent: string, tools: string[]) {
  const provider = new LLMProvider();
  await postDecisionLog({
    type: "model_call",
    payload: {
      agent,
      model: provider.modelId,
      tools,
      hash: payloadHash({ agent, tools }),
    },
    evidence_ref: "derived artifacts only",
  });
}

const getDiagnosisTool = tool({
  description:
    "Read the diagnosis table: yellow/red expanding-moment signals (mean, sd, skew, kurtosis) plus the current moment snapshot. Never raw rows.",
  inputSchema: z.object({
    reason: z.string().optional().describe("Why you need the diagnosis table"),
  }),
  execute: async () => {
    try {
      return await getDiagnosis();
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "diagnosis table unavailable",
        signals: [],
        current: {},
        evidence: "Diagnosis lookup failed. Tell the operator you could not read the table.",
      };
    }
  },
});

const getDecisionLogTool = tool({
  description: "Audit log of inferences, flags, diagnoses, overrides.",
  inputSchema: z.object({
    type: z.string().optional().describe("Optional log type filter"),
  }),
  execute: async ({ type }) => {
    try {
      return await getDecisionLog(type ? { type } : undefined);
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "decision log unavailable",
        entries: [],
      };
    }
  },
});

const INSTRUCTIONS = `Operator chat for a live process monitor.

Call getDiagnosis before answering questions about the process, flags, yellow/red signals, or fields.
You may also call getDecisionLog when asked about overrides or past operator actions.
Answer from those tool results. You never see raw sensor rows and must never ask for them.

If the diagnosis table is empty, the lookup failed, or the run is not yet calibrated (first 20 samples), say so clearly.
Every substantive answer must mention sources as artifact_type:id (for example diagnosis:sig_abc).
After a tool result arrives, write a plain-language answer for the operator.`;

export function createChatAgent() {
  const provider = new LLMProvider();
  return new ToolLoopAgent({
    model: provider.model,
    stopWhen: isStepCount(8),
    instructions: INSTRUCTIONS,
    tools: {
      getDiagnosis: getDiagnosisTool,
      getDecisionLog: getDecisionLogTool,
    },
    onStart: async () => {
      await logCall("chat", ["getDiagnosis", "getDecisionLog"]);
    },
  });
}

export function createRoleInferenceAgent() {
  return createChatAgent();
}

export function createRootCauseAgent() {
  const provider = new LLMProvider();
  return new ToolLoopAgent({
    model: provider.model,
    stopWhen: isStepCount(8),
    instructions: `You narrate diagnosis-table signals that have already been computed.
Do not invent fields. Cite signal id, tick, level, run z, and the top contributing fields' moment scores.
Write a numbered, plain-language explanation for a non-technical operator.`,
    tools: { getDiagnosis: getDiagnosisTool },
    onStart: async () => {
      await logCall("root-cause", ["getDiagnosis"]);
    },
  });
}

export function createCritiqueAgent() {
  const provider = new LLMProvider();
  return new ToolLoopAgent({
    model: provider.model,
    stopWhen: isStepCount(8),
    instructions: `You challenge a diagnosis using the diagnosis table. Do not overwrite it.
Argue alternative explanations or weak links in the moment scores.
End with agreement: agree|partial|disagree and counterpoints.`,
    tools: { getDiagnosis: getDiagnosisTool },
    onStart: async () => {
      await logCall("critique", ["getDiagnosis"]);
    },
  });
}

export function createRuleAgent() {
  return createChatAgent();
}
