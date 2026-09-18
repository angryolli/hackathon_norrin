import { createAgentUIStreamResponse } from "ai";
import { NextResponse } from "next/server";
import { createChatAgent } from "@/lib/agents";

export const maxDuration = 60;

export async function POST(request: Request) {
  const { messages } = await request.json();
  try {
    return createAgentUIStreamResponse({
      agent: createChatAgent(),
      uiMessages: messages,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "agent failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
