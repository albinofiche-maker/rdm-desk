// Toda a lógica aqui trabalha em horário de Nova Iorque (America/New_York) e com
// candles OHLC genéricos. A fonte (Tradovate, Rithmic, etc.) só precisa de implementar
// getBars() em lib/marketdata.ts — esta lógica não muda.

export interface Bar {
  t: number; // epoch ms
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface SessionWindow {
  name: "asia" | "london" | "nyPremarket";
  startHourNY: number; // hora local NY, 0-23
  endHourNY: number;
}

// Janelas por defeito — ajusta livremente às tuas regras.
export const SESSIONS: SessionWindow[] = [
  { name: "asia", startHourNY: 18, endHourNY: 24 }, // 18:00 -> 00:00 NY (dia anterior)
  { name: "london", startHourNY: 2, endHourNY: 5 },
  { name: "nyPremarket", startHourNY: 4, endHourNY: 9.5 },
];

function nyHourOf(tsMs: number): number {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(tsMs));
  const [h, m] = s.split(":").map(Number);
  return h + m / 60;
}

export function barsInSession(bars: Bar[], session: SessionWindow): Bar[] {
  return bars.filter((b) => {
    const h = nyHourOf(b.t);
    if (session.startHourNY <= session.endHourNY) {
      return h >= session.startHourNY && h < session.endHourNY;
    }
    // janela que atravessa a meia-noite
    return h >= session.startHourNY || h < session.endHourNY;
  });
}

export function sessionHighLow(bars: Bar[]): { high: number; low: number } | null {
  if (bars.length === 0) return null;
  let high = -Infinity;
  let low = Infinity;
  for (const b of bars) {
    if (b.h > high) high = b.h;
    if (b.l < low) low = b.l;
  }
  return { high, low };
}

/**
 * Regra: "No trade if London swept both the Asian high and low."
 */
export function londonSweptBothAsia(allBars: Bar[]): boolean {
  const asia = sessionHighLow(barsInSession(allBars, SESSIONS[0]));
  const london = barsInSession(allBars, SESSIONS[1]);
  if (!asia || london.length === 0) return false;
  const tookHigh = london.some((b) => b.h > asia.high);
  const tookLow = london.some((b) => b.l < asia.low);
  return tookHigh && tookLow;
}

/**
 * Regra: "No trade if NY premarket clears both London extremes before 9:30."
 */
export function nyPremarketClearedBothLondon(allBars: Bar[]): boolean {
  const london = sessionHighLow(barsInSession(allBars, SESSIONS[1]));
  const nyPre = barsInSession(allBars, SESSIONS[2]);
  if (!london || nyPre.length === 0) return false;
  const tookHigh = nyPre.some((b) => b.h > london.high);
  const tookLow = nyPre.some((b) => b.l < london.low);
  return tookHigh && tookLow;
}

/**
 * Previous Day Array — high/low/close do dia (sessão RTH ou 24h, a decidir) anterior,
 * usado pela regra "London must use the PDA to drive the overnight move".
 */
export function previousDayArray(allBars: Bar[], nowMs: number) {
  const dayMs = 24 * 60 * 60 * 1000;
  const startPrev = nowMs - dayMs * 2;
  const endPrev = nowMs - dayMs;
  const prevDayBars = allBars.filter((b) => b.t >= startPrev && b.t < endPrev);
  const hl = sessionHighLow(prevDayBars);
  if (!hl) return null;
  const close = prevDayBars[prevDayBars.length - 1]?.c;
  return { ...hl, close };
}

export interface LiquidityReport {
  asiaHL: { high: number; low: number } | null;
  londonHL: { high: number; low: number } | null;
  nyPremarketHL: { high: number; low: number } | null;
  londonSweptBothAsia: boolean;
  nyPremarketClearedBothLondon: boolean;
  pda: { high: number; low: number; close: number } | null;
  tradeAllowedByLiquidityRules: boolean;
}

export function buildLiquidityReport(allBars: Bar[], nowMs: number): LiquidityReport {
  const asiaHL = sessionHighLow(barsInSession(allBars, SESSIONS[0]));
  const londonHL = sessionHighLow(barsInSession(allBars, SESSIONS[1]));
  const nyPremarketHL = sessionHighLow(barsInSession(allBars, SESSIONS[2]));
  const sweptAsia = londonSweptBothAsia(allBars);
  const clearedLondon = nyPremarketClearedBothLondon(allBars);
  return {
    asiaHL,
    londonHL,
    nyPremarketHL,
    londonSweptBothAsia: sweptAsia,
    nyPremarketClearedBothLondon: clearedLondon,
    pda: previousDayArray(allBars, nowMs),
    tradeAllowedByLiquidityRules: !sweptAsia && !clearedLondon,
  };
}
