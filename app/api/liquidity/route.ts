import { NextResponse } from "next/server";
import { getMarketDataSource } from "@/lib/marketdata";
import { buildLiquidityReport } from "@/lib/sessions";

export async function GET() {
  const now = Date.now();
  const from = now - 2 * 24 * 60 * 60 * 1000;
  try {
    const source = getMarketDataSource();
    const bars = await source.getBars("MNQ", from, now);
    const report = buildLiquidityReport(bars, now);
    return NextResponse.json({ ok: true, report, source: source.constructor.name });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message || "erro desconhecido" },
      { status: 200 }
    );
  }
}
