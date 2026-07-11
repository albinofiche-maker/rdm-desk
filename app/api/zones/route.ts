import { NextRequest, NextResponse } from "next/server";
import { upsertZone, getActiveZones, Session, Zone } from "@/lib/zones";

const DEFAULT_SYMBOL = "MNQ";
const VALID_SESSIONS: Session[] = ["tokyo", "london", "ny"];

// TradingView Pine Script alert (FODA v4, uma zona = um POST) -> guarda no Upstash.
// Configura o alerta como "Once Per Bar Close" e o "Message" como JSON, ex:
// {
//   "secret": "{{TEU_SEGREDO}}",
//   "symbol": "MNQ",
//   "session": "tokyo" | "london" | "ny",
//   "high": 21850.5,
//   "low": 21800.25,
//   "time": 1783728000,
//   "daysShow": 15
// }
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

  const session = body.session as Session;
  if (!VALID_SESSIONS.includes(session)) {
    return NextResponse.json(
      { error: "Sessão desconhecida", valid: VALID_SESSIONS },
      { status: 400 }
    );
  }

  const high = Number(body.high);
  const low = Number(body.low);
  const time = Number(body.time);
  const daysShow = Number(body.daysShow);

  if (![high, low, time, daysShow].every((n) => Number.isFinite(n))) {
    return NextResponse.json(
      { error: "Campos em falta ou inválidos (high/low/time/daysShow)" },
      { status: 400 }
    );
  }

  const symbol = (body.symbol || DEFAULT_SYMBOL).toString();

  // {{time}} do TradingView vem em milissegundos — normaliza para segundos.
  const timeSeconds = time > 1e12 ? Math.floor(time / 1000) : Math.floor(time);

  const zone: Zone = { session, high, low, time: timeSeconds, daysShow };
  await upsertZone(symbol, zone);

  return NextResponse.json({ ok: true, zone });
}

// GET /api/zones?symbol=MNQ
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") || DEFAULT_SYMBOL;

  const zones = await getActiveZones(symbol);
  return NextResponse.json({ symbol, zones });
}
