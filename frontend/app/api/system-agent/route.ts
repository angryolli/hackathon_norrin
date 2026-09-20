import { NextResponse } from "next/server";
import {
  getSystemAgentStatus,
  resetSystemAgent,
  startSystemAgent,
  stopSystemAgent,
} from "@/agents/system";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json(getSystemAgentStatus());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    running?: boolean;
    reset?: boolean;
  };
  if (body.reset) {
    return NextResponse.json(resetSystemAgent());
  }
  const status = body.running ? startSystemAgent() : stopSystemAgent();
  return NextResponse.json(status);
}
