import { ToolLoopAgent, isStepCount, tool } from "ai";
import { z } from "zod";
import { appendLog } from "./decision-log";
import { getModel, modelMeta } from "./model";
import {
  fetchAttribution,
  fetchCorrelations,
  fetchDrift,
  fetchPipeline,
  fetchProfiles,
  fetchQuality,
} from "./pipeline";

export function createProcessMonitorAgent() {
  return new ToolLoopAgent({
    model: getModel(),
    stopWhen: isStepCount(12),
    instructions: `You are a trustworthy process-monitoring agent.

You interpret statistical artifacts from a local data pipeline. You never see raw records and must never ask for them.

Workflow:
1. Run data quality checks first. If data is untrusted (stuck fields, missingness, bad timestamps), say so before any process-fault claim.
2. Then use profiles, correlations, drift, and attribution.
3. Separate every conclusion into: inferred (with evidence), assumed, and uncertain.
4. Ground field-role hypotheses in distribution shape, frozen/stuck rates, lag-1 autocorrelation, and lagged cross-correlation — not in asserted labels.
5. Rank contributing signals and explain why in plain language an operator can act on.
6. If the operator asks "why", point back to the specific artifact (check id, correlation edge, drift score).

Keep answers concise. Do not invent columns that were not in the artifacts.`,
    tools: {
      getPipelineSnapshot: tool({
        description:
          "Fetch the full derived pipeline snapshot (profiles, quality, correlations, drift). Summaries only, no raw rows.",
        inputSchema: z.object({}),
        execute: async () => fetchPipeline(),
      }),
      getFieldProfiles: tool({
        description:
          "Statistical fingerprints per unlabeled column: mean, std, range, missing/frozen rates, lag-1 autocorrelation.",
        inputSchema: z.object({}),
        execute: async () => fetchProfiles(),
      }),
      getDataQuality: tool({
        description:
          "Baseline data-quality checks: completeness, validity, consistency, timeliness. Use this before drift/fault reasoning.",
        inputSchema: z.object({}),
        execute: async () => fetchQuality(),
      }),
      getCorrelations: tool({
        description:
          "Correlation and lagged cross-correlation edges between columns.",
        inputSchema: z.object({}),
        execute: async () => fetchCorrelations(),
      }),
      getDrift: tool({
        description:
          "Drift and anomaly findings with the specific signal(s) responsible.",
        inputSchema: z.object({}),
        execute: async () => fetchDrift(),
      }),
      getAttribution: tool({
        description:
          "Ranked contributing signals for the current flagged event, with evidence strings.",
        inputSchema: z.object({}),
        execute: async () => fetchAttribution(),
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
