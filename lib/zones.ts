import { Redis } from "@upstash/redis";

export type Session = "tokyo" | "london" | "ny";

export interface Zone {
  session: Session;
  high: number;
  low: number;
  time: number; // unix seconds, início da zona (mesmo "time" usado no FODA v4)
  daysShow: number; // valor do input "days_show" no momento em que a zona foi criada
}

const MAX_ZONES_PER_SESSION = 200; // muito acima do que "days_show" alguma vez vai pedir

const hasUpstash =
  !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = hasUpstash
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;

const g = globalThis as unknown as { __rdmMemZones?: Record<string, Zone[]> };
if (!g.__rdmMemZones) g.__rdmMemZones = {};

function seriesKey(symbol: string, session: Session) {
  return `rdm:zones:${symbol}:${session}`;
}

// Guarda/atualiza uma zona. Se já existir uma zona com o mesmo "time" (mesma
// zona sendo re-desenhada bar a bar pelo Pine), substitui-a em vez de duplicar.
export async function upsertZone(symbol: string, zone: Zone): Promise<void> {
  const key = seriesKey(symbol, zone.session);

  if (redis) {
    const existing = await redis.zrange<string[]>(key, zone.time, zone.time, {
      byScore: true,
    });
    if (existing && existing.length > 0) {
      await redis.zrem(key, ...existing);
    }
    await redis.zadd(key, { score: zone.time, member: JSON.stringify(zone) });

    const count = await redis.zcard(key);
    if (count > MAX_ZONES_PER_SESSION) {
      await redis.zremrangebyrank(key, 0, count - MAX_ZONES_PER_SESSION - 1);
    }
  } else {
    const list = g.__rdmMemZones![key] || [];
    const idx = list.findIndex((z) => z.time === zone.time);
    if (idx >= 0) list[idx] = zone;
    else list.push(zone);
    list.sort((a, b) => a.time - b.time);
    if (list.length > MAX_ZONES_PER_SESSION)
      list.splice(0, list.length - MAX_ZONES_PER_SESSION);
    g.__rdmMemZones![key] = list;
  }
}

// Devolve as zonas de TODAS as sessões para um símbolo, já filtradas pela
// janela "daysShow" de cada zona (cada zona sabe o days_show com que nasceu).
export async function getActiveZones(symbol: string): Promise<Zone[]> {
  const now = Date.now();
  const sessions: Session[] = ["tokyo", "london", "ny"];
  const all: Zone[] = [];

  for (const session of sessions) {
    const key = seriesKey(symbol, session);
    let list: Zone[];
    if (redis) {
      const raw = await redis.zrange<string[]>(key, "-inf" as any, "+inf", {
        byScore: true,
      });
      list = raw.map((r) => (typeof r === "string" ? JSON.parse(r) : r));
    } else {
      list = g.__rdmMemZones![key] || [];
    }
    for (const z of list) {
      const cutoffMs = now - z.daysShow * 86400000;
      if (z.time * 1000 >= cutoffMs) all.push(z);
    }
  }

  return all;
}
