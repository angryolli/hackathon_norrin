import { NextResponse } from "next/server";
import { createRoleInferenceAgent } from "@/lib/agents";

export async function POST() {
  try {
    const agent = createRoleInferenceAgent();
    const result = await agent.generate({
      prompt:
        "Infer a functional identity hypothesis for each unlabeled field using tools. Submit via submitRoles.",
    });
    return NextResponse.json({ text: result.text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "role inference failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
