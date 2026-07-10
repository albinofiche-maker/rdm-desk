import { Redis } from "@upstash/redis";

export type NewsType =
  | "none"
  | "holiday"
  | "yellow"
  | "orange"
  | "red_isolated"
  | "cpi"
  | "ppi"
  | "nfp"
  | "red_critical"
  | "fomc"
  | "fed_speech"
  | "post_holiday";

export interface DayInput {
  news: NewsType;
  tomorrowCritical: boolean;
  tightRange: boolean;
  goodWeek: boolean;
  choppyDump: boolean; // "extremamente choppy ou a sair de um dump grande em Asia/London"
}

export interface WeeklyState {
  week: string;
  days: DayInput[]; // 5 dias, Seg-Sex
  tradingHoursNY: string[]; // ex: ["10:00","14:00","20:00"]
}

export const DAY_NAMES = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];

export function defaultDay(): DayInput {
  return { news: "none", tomorrowCritical: false, tightRange: false, goodWeek: false, choppyDump: false };
}

export function isoWeekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function defaultWeeklyState(): WeeklyState {
  return {
    week: isoWeekKey(),
    days: [0, 1, 2, 3, 4].map(defaultDay),
    tradingHoursNY: ["10:00", "14:00", "20:00"],
  };
}

const hasUpstash =
  !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = hasUpstash
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;

const g = globalThis as unknown as { __rdmWeekly?: Record<string, WeeklyState> };
if (!g.__rdmWeekly) g.__rdmWeekly = {};

function keyFor(week: string) {
  return `rdm:weekly:${week}`;
}

export async function getWeeklyState(): Promise<WeeklyState> {
  const week = isoWeekKey();
  if (redis) {
    const s = await redis.get<WeeklyState>(keyFor(week));
    return s || defaultWeeklyState();
  }
  return g.__rdmWeekly![week] || defaultWeeklyState();
}

export async function setWeeklyState(state: WeeklyState): Promise<WeeklyState> {
  const week = isoWeekKey();
  const toSave = { ...state, week };
  if (redis) {
    await redis.set(keyFor(week), toSave);
  } else {
    g.__rdmWeekly![week] = toSave;
  }
  return toSave;
}

// ---- regras (RULES) ----
export interface RuleResult {
  state: "no" | "half" | "full";
  action: string;
  reason: string;
}

export const RULES: Record<NewsType, RuleResult> = {
  none: {
    state: "no",
    action: "NO TRADE",
    reason: 'Sem red folder relevante — sem notícia, não se toca. "Don\'t even touch it."',
  },
  holiday: {
    state: "no",
    action: "NO TRADE — feriado",
    reason: "Feriados são sempre fora do mercado, sem exceção.",
  },
  yellow: {
    state: "half",
    action: "HALF SIZE (escala p/ full se o dia começar bem)",
    reason: "Yellow folder sozinho merece cautela inicial — entra half size, sobe se o dia estiver a correr bem.",
  },
  orange: {
    state: "full",
    action: "FULL SIZE",
    reason: "Orange folder não costuma travar o dia — trade normal desde a abertura.",
  },
  red_isolated: {
    state: "full",
    action: "FULL SIZE (com atenção)",
    reason: "Red folder isolado (ex: Unemployment Claims, Retail Sales) costuma ser bom de tradar.",
  },
  cpi: {
    state: "full",
    action: "FULL SIZE — só depois das 10:00",
    reason: "CPI é sólido pra tradar — o draw fica extremamente claro (highs ou lows do dado). Espera o print e a reação inicial antes de entrar.",
  },
  ppi: {
    state: "half",
    action: "HALF SIZE — só depois das 10:00",
    reason: "PPI pede cautela extra — half size, nunca no open.",
  },
  nfp: {
    state: "half",
    action: "HALF SIZE — modo FADE, só depois das 10:00",
    reason: "NFP é dia de fade — não persegue o primeiro movimento, espera a reação e trada contra o exagero inicial.",
  },
  red_critical: {
    state: "half",
    action: "HALF SIZE — só depois das 10:00",
    reason: "Red folder crítico (ou vários juntos) pede espera pela reação inicial antes de entrar.",
  },
  fomc: {
    state: "no",
    action: "NO TRADE — dia do FOMC",
    reason: "Incerteza demasiado alta com a decisão de juros — fora no dia inteiro.",
  },
  fed_speech: {
    state: "half",
    action: "HALF SIZE — só depois do discurso acabar",
    reason: "Powell/Trump a falar gera chop — espera terminar, entra só depois com size reduzido.",
  },
  post_holiday: {
    state: "full",
    action: "FULL SIZE, mas cauteloso nos primeiros minutos",
    reason: 'Sem "full data" logo a seguir a um feriado — dá os primeiros minutos pra decidir, senão espera até às 10:00.',
  },
};

export const NEWS_LABELS: Record<NewsType, string> = {
  none: "Sem notícias relevantes",
  holiday: "Feriado / Bank holiday",
  yellow: "Yellow folder (baixo impacto)",
  orange: "Orange folder (médio impacto)",
  red_isolated: "Red folder isolado (ex: Unemployment Claims)",
  cpi: "CPI / Core CPI",
  ppi: "PPI",
  nfp: "NFP (Non-Farm Payrolls)",
  red_critical: "Outro red folder crítico / vários juntos",
  fomc: "FOMC Meeting / Decisão de juros",
  fed_speech: "Discurso Fed / Powell / Trump",
  post_holiday: "Dia a seguir a feriado (dados incompletos)",
};

export interface DayComputed extends RuleResult {
  extraNotes: string[];
  shortLabel: string;
}

export function computeDay(d: DayInput): DayComputed {
  const base = RULES[d.news];
  const levelOrder = { no: 0, half: 1, full: 2 } as const;
  const levelName = ["no", "half", "full"] as const;
  let stateLevel: "no" | "half" | "full" = base.state;
  const extraNotes: string[] = [];
  const downgrade = () => {
    if (levelOrder[stateLevel] > 0) stateLevel = levelName[levelOrder[stateLevel] - 1];
  };

  const guarded = d.news !== "fomc" && d.news !== "holiday";
  const guardedNonNone = guarded && d.news !== "none";

  if (d.tomorrowCritical && guarded) {
    downgrade();
    extraNotes.push(
      "Amanhã há evento crítico — prefere Ásia/Londres essa noite em vez da manhã de NY; se tradares de dia, reduz size."
    );
  }
  if (d.tightRange && guardedNonNone) {
    downgrade();
    extraNotes.push("Range da manhã abaixo de 100 pontos — reduz para conservar capital em vez de forçar em chop.");
  }
  if (d.choppyDump && guarded) {
    downgrade();
    extraNotes.push("Muito choppy ou a sair de um dump grande em Asia/London — modo fade, reduz size ou espera confirmação clara.");
  }
  if (d.goodWeek && guardedNonNone) {
    downgrade();
    extraNotes.push("Semana positiva — reduz size à sexta pra preservar o que já ganhaste.");
  }

  const actionLabels = { no: "NO TRADE", half: "HALF SIZE", full: "FULL SIZE" };
  let displayAction = base.action;
  if (levelOrder[stateLevel] < levelOrder[base.state]) {
    displayAction = stateLevel === "no" ? "NO TRADE" : actionLabels[stateLevel];
  }

  return { state: stateLevel, action: displayAction, reason: base.reason, extraNotes, shortLabel: actionLabels[stateLevel] };
}
