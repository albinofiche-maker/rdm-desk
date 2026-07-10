# RDM Desk

Site único com **Dashboard**, **Weekly Outlook** e **RDM Clearance** para NQ/ES.

## Estrutura

- `/` — dashboard do dia (o que o Weekly Outlook diz sobre hoje)
- `/weekly-outlook` — preenches no início da semana (notícias, horas). Fica guardado
  no servidor a semana toda (chave por semana ISO, reseta sozinho na semana seguinte).
- `/rdm-clearance` — checklist ao vivo. Gates que têm fonte de dados ligada
  auto-preenchem-se (tag "live"); os restantes continuam manuais.
- `/api/webhook` — recebe alertas do TradingView (ver abaixo)
- `/api/liquidity` — calcula sweeps de sessão (Asia/London/NY premarket) a partir de candles
- `/api/calendar` — auto-preenche notícias do Weekly Outlook (precisa de `FMP_API_KEY`)

## Passo a passo — deploy

1. `npm install`
2. Cria conta grátis em upstash.com → Redis → copia `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`
3. Copia `.env.example` para `.env.local` e preenche o que já tiveres
4. `npm run dev` para testar local, ou faz deploy direto na Vercel (importa este repo, cola as env vars no dashboard do projeto)

## Ligar o TradingView (gates ao vivo)

O TradingView Premium não expõe uma API de dados para terceiros, mas os **alertas com
webhook** fazem o trabalho: cria um alerta na condição que queres (ex: preço tocou a
Sunrise Zone) e no campo "Message" do alerta usa este JSON:

```json
{"secret":"O_TEU_WEBHOOK_SECRET","gate":"zoneTouched","value":true,"price":"{{close}}","symbol":"{{ticker}}"}
```

URL do webhook: `https://o-teu-dominio.vercel.app/api/webhook`

Gates válidos (usa exatamente estes nomes em `gate`):
`zoneTouched`, `sweepLow`, `sweepHigh`, `smtBullish`, `smtBearish`,
`fvgBearishActive`, `fvgBullishActive`, `closeAboveFvg`, `closeBelowFvg`

Cada evento fica "vivo" 2 horas no RDM Clearance (depois expira sozinho).

## Ligar o Tradovate (para a análise de liquidez automática)

`lib/marketdata.ts` tem um esqueleto `TradovateSource` pronto a implementar assim que
confirmares o acesso à API na tua conta (Settings -> API Access). Docs oficiais:
https://api.tradovate.com/. Preenche `TRADOVATE_CID` / `TRADOVATE_SECRET` no `.env` e
implementa a chamada real dentro do `getBars()` — o resto do site (sessões, sweeps,
Previous Day Array) já está pronto e não precisa de alterações.

Enquanto isso, `/api/liquidity` usa candles sintéticos (`MockSource`) só para o site
não partir — os números que vês ali agora **não são reais**.

## O que já está automático vs. o que continua manual

| Automático (ligado a dados) | Manual (clique teu) |
|---|---|
| Powerhours (relógio) | 5m+1m SMT local (A+) |
| Sunrise Zone tocada* | London usou o PDA corretamente |
| Sweep de high/low* | Bias claro |
| SMT bullish/bearish* | Headspace limpo |
| FVG ativo + fecho de confirmação* | Trading para/do DOL |
| Sweep de Asia/London/NY premarket (via Tradovate) | Calmo / não forçado |
| No-news Monday (via Weekly Outlook) | |

\* precisa de alertas configurados no TradingView (ver acima)
