import { Redis } from "@upstash/redis";

export interface Bar {
  time: number; // unix seconds (UTC), tempo de fecho da vela vindo do Pine {{time}}
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

const MAX_BARS = 5000; // ~ suficiente para vários dias em M1/M5 sem rebentar o free tier do Upstash

const hasUpstash =
  !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = hasUpstash
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;

// Fallback em memória (dev local / instância serverless isolada)
const g = globalThis as unknown as { __rdmMemBars?: Record<string, Bar[]> };
if (!g.__rdmMemBars) g.__rdmMemBars = {};

function seriesKey(symbol: string, timeframe: string) {
  return `rdm:bars:${symbol}:${timeframe}`;
}

// Guarda/atualiza uma barra. Se já existir uma barra com o mesmo "time" (mesmo
// candle, ex.: em formação), substitui-a em vez de duplicar.
export async function upsertBar(
  symbol: string,
  timeframe: string,
  bar: Bar
): Promise<void> {
  const key = seriesKey(symbol, timeframe);

  if (redis) {
    // Sorted set: score = time. Remove qualquer entrada antiga com o mesmo score
    // antes de inserir a nova (upsert), depois apara para MAX_BARS.
    const existing = await redis.zrange<string[]>(key, bar.time, bar.time, {
      byScore: true,
    });
    if (existing && existing.length > 0) {
      await redis.zrem(key, ...existing);
    }
    await redis.zadd(key, { score: bar.time, member: JSON.stringify(bar) });

    const count = await redis.zcard(key);
    if (count > MAX_BARS) {
      await redis.zremrangebyrank(key, 0, count - MAX_BARS - 1);
    }
  } else {
    const list = g.__rdmMemBars![key] || [];
    const idx = list.findIndex((b) => b.time === bar.time);
    if (idx >= 0) list[idx] = bar;
    else list.push(bar);
    list.sort((a, b) => a.time - b.time);
    if (list.length > MAX_BARS) list.splice(0, list.length - MAX_BARS);
    g.__rdmMemBars![key] = list;
  }
}

// Devolve as barras ordenadas por tempo crescente. `since` (unix seconds)
// opcional para o cliente só pedir o que falta desde a última barra que já tem.
export async function getBars(
  symbol: string,
  timeframe: string,
  since?: number
): Promise<Bar[]> {
  const key = seriesKey(symbol, timeframe);

  if (redis) {
    const min = since !== undefined ? since : "-inf";
    const raw = await redis.zrange<string[]>(key, min as any, "+inf", {
      byScore: true,
    });
    return raw.map((r) => (typeof r === "string" ? JSON.parse(r) : r));
  }

  const list = g.__rdmMemBars![key] || [];
  return since !== undefined ? list.filter((b) => b.time >= since) : list;
}
