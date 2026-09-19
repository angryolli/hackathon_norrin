import { NextResponse } from "next/server";
import {
  getSystemAgentStatus,
  startSystemAgent,
  stopSystemAgent,
} from "@/agents/system";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getSystemAgentStatus());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { running?: boolean };
  const status = body.running ? startSystemAgent() : stopSystemAgent();
  return NextResponse.json(status);
}
