import { NextRequest, NextResponse } from "next/server";
import { getWeeklyState, setWeeklyState } from "@/lib/weekly";

export async function GET() {
  const state = await getWeeklyState();
  return NextResponse.json(state);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const saved = await setWeeklyState(body);
  return NextResponse.json(saved);
}
