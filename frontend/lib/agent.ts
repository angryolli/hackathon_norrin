import { ToolLoopAgent, isStepCount, tool } from "ai";
import { z } from "zod";
import { appendLog } from "./decision-log";
import { getModel, modelMeta } from "./model";
import { getDiagnosis } from "./pipeline";

export function createProcessMonitorAgent() {
  return new ToolLoopAgent({
    model: getModel(),
    stopWhen: isStepCount(12),
    instructions: `You are a trustworthy process-monitoring agent.

You interpret diagnosis-table artifacts from a local expanding-moment pipeline (mean, sd, skew, kurtosis). You never see raw records and must never ask for them.

Ground answers in signal id, tick, yellow/red level, run z, and top field moment scores.
Separate every conclusion into: inferred (with evidence), assumed, and uncertain.
If the diagnosis table is empty, say you do not have evidence yet.`,
    tools: {
      getDiagnosis: tool({
        description:
          "Diagnosis table: yellow/red expanding-moment signals and the current moment snapshot. No raw rows.",
        inputSchema: z.object({}),
        execute: async () => getDiagnosis(),
      }),
    },
    onStart: async () => {
      await appendLog({
        kind: "model_call",
        payload: {
          why: "operator chat / diagnosis",
          ...modelMeta(),
          egress: "derived artifacts and operator text only; no raw rows",
        },
      });
    },
    onToolExecutionEnd: async ({ toolCall }) => {
      await appendLog({
        kind: "tool",
        payload: { tool: toolCall.toolName },
      });
    },
  });
}
