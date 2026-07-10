import { NextResponse } from "next/server";
import { getLiveState, resetLiveState } from "@/lib/store";

export async function GET() {
  const state = await getLiveState();
  return NextResponse.json({ state, serverTime: Date.now() });
}

export async function DELETE() {
  await resetLiveState();
  return NextResponse.json({ ok: true });
}
