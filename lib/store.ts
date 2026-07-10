import { Redis } from "@upstash/redis";

// Gates que podem ser preenchidos automaticamente por um webhook do TradingView.
// Os restantes (bias, headspace, SMT se não scriptado, etc.) continuam manuais no cliente.
export type GateId =
  | "zoneTouched"
  | "sweepLow"
  | "sweepHigh"
  | "smtBullish"
  | "smtBearish"
  | "fvgBearishActive"
  | "fvgBullishActive"
  | "closeAboveFvg"
  | "closeBelowFvg"
  | "londonSweptBothAsia"
  | "nyPremarketClearedBothLondon";

export interface GateEvent {
  value: boolean;
  ts: number;
  price?: number;
  symbol?: string;
  note?: string;
}

export type LiveState = Partial<Record<GateId, GateEvent>>;

const STATE_KEY = "rdm:live-gates";

const hasUpstash =
  !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = hasUpstash
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;

// Fallback em memória — funciona em dev e em cada instância serverless individual.
// Para produção a sério, define UPSTASH_REDIS_REST_URL / TOKEN (tier grátis chega bem).
const g = globalThis as unknown as { __rdmMemState?: LiveState };
if (!g.__rdmMemState) g.__rdmMemState = {};

export async function getLiveState(): Promise<LiveState> {
  if (redis) {
    const s = await redis.get<LiveState>(STATE_KEY);
    return s || {};
  }
  return g.__rdmMemState!;
}

export async function setGate(id: GateId, event: GateEvent): Promise<LiveState> {
  const current = await getLiveState();
  const next = { ...current, [id]: event };
  if (redis) {
    await redis.set(STATE_KEY, next);
  } else {
    g.__rdmMemState = next;
  }
  return next;
}

export async function resetLiveState(): Promise<void> {
  if (redis) {
    await redis.set(STATE_KEY, {});
  } else {
    g.__rdmMemState = {};
  }
}
