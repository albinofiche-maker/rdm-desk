import { NextRequest, NextResponse } from "next/server";
import { setGate, resetLiveState, GateId } from "@/lib/store";

const VALID_GATES: GateId[] = [
  "zoneTouched",
  "sweepLow",
  "sweepHigh",
  "smtBullish",
  "smtBearish",
  "fvgBearishActive",
  "fvgBullishActive",
  "closeAboveFvg",
  "closeBelowFvg",
  "londonSweptBothAsia",
  "nyPremarketClearedBothLondon",
];

// TradingView Pine Script alert -> webhook. Configura o "Message" do alerta como JSON, ex:
// {"secret":"{{TEU_SEGREDO}}","gate":"zoneTouched","value":true,"price":"{{close}}","symbol":"{{ticker}}"}
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const secret = process.env.WEBHOOK_SECRET;
  if (secret && body.secret !== secret) {
    return NextResponse.json({ error: "Segredo inválido" }, { status: 401 });
  }

  if (body.reset) {
    await resetLiveState();
    return NextResponse.json({ ok: true, reset: true });
  }

  const gate = body.gate as GateId;
  if (!VALID_GATES.includes(gate)) {
    return NextResponse.json(
      { error: "Gate desconhecido", valid: VALID_GATES },
      { status: 400 }
    );
  }

  const next = await setGate(gate, {
    value: body.value !== false,
    ts: Date.now(),
    price: body.price ? Number(body.price) : undefined,
    symbol: body.symbol,
    note: body.note,
  });

  return NextResponse.json({ ok: true, state: next });
}

export async function GET() {
  return NextResponse.json({
    info: "Endpoint de webhook do TradingView. Usa POST com JSON.",
    validGates: VALID_GATES,
  });
}
