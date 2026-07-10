import { Bar } from "./sessions";

export interface MarketDataSource {
  getBars(symbol: string, fromMs: number, toMs: number): Promise<Bar[]>;
}

/**
 * Fonte de demonstração — gera candles sintéticos só para o site funcionar
 * enquanto não ligamos a fonte real (Tradovate/Rithmic/TradingView webhook feed).
 * Troca isto por TradovateSource assim que tiveres as credenciais da API.
 */
class MockSource implements MarketDataSource {
  async getBars(symbol: string, fromMs: number, toMs: number): Promise<Bar[]> {
    const bars: Bar[] = [];
    let price = 21500;
    for (let t = fromMs; t < toMs; t += 5 * 60 * 1000) {
      const drift = (Math.random() - 0.5) * 8;
      const o = price;
      const c = price + drift;
      const h = Math.max(o, c) + Math.random() * 4;
      const l = Math.min(o, c) - Math.random() * 4;
      bars.push({ t, o, h, l, c });
      price = c;
    }
    return bars;
  }
}

/**
 * Esqueleto pronto a preencher assim que tiveres CID/Secret da API do Tradovate.
 * Docs: https://api.tradovate.com/
 *
 * Fluxo: POST /auth/accesstokenrequest -> token
 *        GET  /md/getChart (ou WebSocket md feed) -> candles
 */
class TradovateSource implements MarketDataSource {
  async getBars(symbol: string, fromMs: number, toMs: number): Promise<Bar[]> {
    const cid = process.env.TRADOVATE_CID;
    const secret = process.env.TRADOVATE_SECRET;
    if (!cid || !secret) {
      throw new Error(
        "TRADOVATE_CID / TRADOVATE_SECRET não configurados. Define-os no .env e implementa a chamada real aqui."
      );
    }
    // TODO: autenticar e pedir os candles reais do Tradovate.
    // Deixado como esqueleto para ligarmos assim que confirmares o acesso à API.
    throw new Error("TradovateSource ainda não está implementado — usa MockSource por agora.");
  }
}

export function getMarketDataSource(): MarketDataSource {
  if (process.env.TRADOVATE_CID) return new TradovateSource();
  return new MockSource();
}
