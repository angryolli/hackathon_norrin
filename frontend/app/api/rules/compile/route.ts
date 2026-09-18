import { NextResponse } from "next/server";
import { createRuleAgent } from "@/lib/agents";
import { compileRule, getConfig } from "@/lib/pipeline";
import { ruleSchema } from "@/types/artifacts";

export async function POST(request: Request) {
  const { rule_text } = (await request.json()) as { rule_text: string };
  try {
    const agent = createRuleAgent();
    const result = await agent.generate({
      prompt: `Convert this operating rule to the strict schema. Rule: ${rule_text}`,
    });
    const match = result.text.match(/\{[\s\S]*\}/);
    if (!match) {
      return NextResponse.json({ error: "no schema in model output" }, { status: 400 });
    }
    const parsed = ruleSchema.parse({
      ...JSON.parse(match[0]),
      rule_text,
    });
    const cfg = await getConfig();
    if (!cfg.calibration_id) {
      return NextResponse.json({ error: "not calibrated" }, { status: 400 });
    }
    const compiled = await compileRule(cfg.calibration_id, parsed);
    return NextResponse.json({ parsed, compiled });
  } catch (err) {
    const message = err instanceof Error ? err.message : "rule compile failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
