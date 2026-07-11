import { NextRequest, NextResponse } from "next/server";
import { upsertBar, getBars, Bar } from "@/lib/bars";

const DEFAULT_SYMBOL = "MNQ";
const DEFAULT_TIMEFRAME = "5";

// TradingView Pine Script alert (uma vela = um POST) -> guarda no Upstash.
// Configura o alerta como "Once Per Bar Close" e o "Message" como JSON, ex:
// {
//   "secret": "{{TEU_SEGREDO}}",
//   "symbol": "MNQ",
//   "timeframe": "5",
//   "time": {{time}},
//   "open": {{open}},
//   "high": {{high}},
//   "low": {{low}},
//   "close": {{close}},
//   "volume": {{volume}}
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

  const time = Number(body.time);
  const open = Number(body.open);
  const high = Number(body.high);
  const low = Number(body.low);
  const close = Number(body.close);

  if (![time, open, high, low, close].every((n) => Number.isFinite(n))) {
    return NextResponse.json(
      { error: "Campos em falta ou inválidos (time/open/high/low/close)" },
      { status: 400 }
    );
  }

  const symbol = (body.symbol || DEFAULT_SYMBOL).toString();
  const timeframe = (body.timeframe || DEFAULT_TIMEFRAME).toString();

  // {{time}} do TradingView vem em milissegundos — normaliza para segundos (lightweight-charts usa segundos).
  const timeSeconds = time > 1e12 ? Math.floor(time / 1000) : Math.floor(time);

  const bar: Bar = {
    time: timeSeconds,
    open,
    high,
    low,
    close,
    volume: body.volume !== undefined ? Number(body.volume) : undefined,
  };

  await upsertBar(symbol, timeframe, bar);

  return NextResponse.json({ ok: true, bar });
}

// GET /api/bars?symbol=MNQ&timeframe=5&since=1720000000
// O cliente (lightweight-charts) usa isto no load inicial e depois em polling
// passando "since" com o tempo da última barra que já tem, para trazer só o novo.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") || DEFAULT_SYMBOL;
  const timeframe = searchParams.get("timeframe") || DEFAULT_TIMEFRAME;
  const sinceParam = searchParams.get("since");
  const since = sinceParam ? Number(sinceParam) : undefined;

  const bars = await getBars(symbol, timeframe, since);
  return NextResponse.json({ symbol, timeframe, bars });
}
