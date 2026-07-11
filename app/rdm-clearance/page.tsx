"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import "./rdm.css";
import { GateId } from "@/lib/store";
import { computeDay, defaultWeeklyState, WeeklyState } from "@/lib/weekly";

// O "dia de trading" começa às 18:00 NY (abertura da sessão de Asia) e vai até
// às 18:00 NY seguinte. Um evento pertence ao mesmo dia de trading que "agora"
// se caírem na mesma janela — assim os sweeps de Asia/London resetam sozinhos
// quando a sessão seguinte começa, em vez de uma janela rolante de 24h.
function tradingDayKey(ms: number): string {
  const nyStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(nyStr.find((p) => p.type === t)?.value);
  const y = get("year"), mo = get("month"), d = get("day"), h = get("hour");
  // se já passou das 18h, este momento pertence ao dia de trading de amanhã
  const day = h >= 18 ? d + 1 : d;
  return `${y}-${mo}-${day}`;
}

type Dir = "long" | "short";

interface GateDef {
  id: string;
  label: string;
  hint: string;
  phase: 1 | 2 | 3 | 4;
  dir?: Dir;
  optional?: boolean;
  tag?: string;
  liveKey?: GateId;
}

const GATES: GateDef[] = [
  { id: "powerhours", label: "Within Powerhours", hint: "A hora atual cai dentro da tua janela definida — senão, morto.", phase: 1 },
  { id: "sweepLow", label: "Sellside swept FIRST (Asia/London/NY low)", hint: "O draw tem de ser tirado antes do SMT — nunca entres antes do sweep.", phase: 1, dir: "long", liveKey: "sweepLow" },
  { id: "sweepHigh", label: "Buyside swept FIRST (Asia/London/NY high)", hint: "O draw tem de ser tirado antes do SMT — nunca entres antes do sweep.", phase: 1, dir: "short", liveKey: "sweepHigh" },
  { id: "sunriseZone", label: "Session zone reached (NY/London/Tokyo only)", hint: "Só contam zonas destas 3 sessões — Dubai, Rio etc. não têm base, ignora.", phase: 1, liveKey: "zoneTouched" },

  { id: "rsmt", label: "RSMT present", hint: "Válido se: só um ativo tapa a zona · OU os dois tapam mas em zonas diferentes · OU a mesma zona em dias diferentes. Só invalida se fechar através da zona.", phase: 2 },
  { id: "smt1m", label: "SMT valid on 1min", hint: "Mínimo exigido — mas sozinho não chega, tem de validar nos maiores.", phase: 2, liveKey: "smtBullish" },
  { id: "smt5m", label: "SMT valid on 5min", hint: "Confirma o 1min. Longs: NQ tira a low, ES falha = alta qualidade.", phase: 2 },
  { id: "smt15m", label: "SMT valid on 15min", hint: "Os 3 juntos (1m+5m+15m) = setup A+. Shorts: NQ tira a high, ES falha = alta qualidade.", phase: 2, tag: "A+" },

  { id: "fvgBearishAbove", label: "Active bearish FVG above price", hint: "FVG bearish por preencher, formado na descida até à zona.", phase: 3, dir: "long", liveKey: "fvgBearishActive" },
  { id: "closeAboveFvg", label: "1min inversion CLOSES above the FVG top", hint: "Fecho de 1min (ou 30s) acima da borda superior = confirmação de entrada.", phase: 3, dir: "long", liveKey: "closeAboveFvg" },
  { id: "fvgBullishBelow", label: "Active bullish FVG below price", hint: "FVG bullish por preencher, formado na subida até à zona.", phase: 3, dir: "short", liveKey: "fvgBullishActive" },
  { id: "closeBelowFvg", label: "1min inversion CLOSES below the FVG bottom", hint: "Fecho de 1min (ou 30s) abaixo da borda inferior = confirmação de entrada.", phase: 3, dir: "short", liveKey: "closeBelowFvg" },

  { id: "calm", label: "Calm — this is not revenge", hint: "Não zangado, não a perseguir o prejuízo. Senão: ecrã desligado.", phase: 4 },
  { id: "notForced", label: "Not forced / not front-run", hint: "O setup veio até mim, ES não foi contrariado. Não inventei nada que não estava lá.", phase: 4 },
];

const PHASE_LABEL: Record<number, string> = {
  1: "Context · Draw on Liquidity",
  2: "RSMT · Confirmation",
  3: "iFVG · Execution",
  4: "State · Discipline",
};

const CheckSVG = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#0A0D13" strokeWidth={3.5}>
    <path d="M5 13l4 4L19 7" />
  </svg>
);

interface CBConfig {
  maxtrades: number;
  maxloss: number;
  cooldown: number;
  rr: number;
  perr: string;
  ph: string;
}
interface DayLog {
  date: string;
  trades: number;
  r: number;
  lastLoss: number;
}
const CB_KEY = "rdm_clearance_v2";
function todayKey() {
  const d = new Date();
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}
function loadCB(): { cfg: CBConfig; log: DayLog } {
  const defaults = { maxtrades: 3, maxloss: 2, cooldown: 15, rr: 2, perr: "", ph: "" };
  try {
    const raw = JSON.parse(localStorage.getItem(CB_KEY) || "null");
    if (raw && raw.log && raw.log.date === todayKey()) return raw;
    return { cfg: raw?.cfg || defaults, log: { date: todayKey(), trades: 0, r: 0, lastLoss: 0 } };
  } catch {
    return { cfg: defaults, log: { date: todayKey(), trades: 0, r: 0, lastLoss: 0 } };
  }
}

export default function RdmClearancePage() {
  const [dir, setDir] = useState<Dir>("long");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [liveState, setLiveState] = useState<Record<string, { value: boolean; ts: number }>>({});
  const [liquidity, setLiquidity] = useState<any>(null);
  const [weekly, setWeekly] = useState<WeeklyState>(defaultWeeklyState());
  const [clock, setClock] = useState("--:--:--");
  const [cb, setCb] = useState<{ cfg: CBConfig; log: DayLog } | null>(null);
  const autoAppliedRef = useRef<Set<string>>(new Set());

  // clock
  useEffect(() => {
    function tick() {
      const d = new Date();
      setClock(
        String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ":" + String(d.getSeconds()).padStart(2, "0")
      );
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // circuit breaker: load from localStorage on mount
  useEffect(() => {
    setCb(loadCB());
  }, []);
  useEffect(() => {
    if (cb) localStorage.setItem(CB_KEY, JSON.stringify(cb));
  }, [cb]);

  // poll live gate state (from TradingView webhook)
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled) setLiveState(json.state || {});
      } catch {}
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // fetch liquidity report + weekly once, refresh liquidity every 60s
  useEffect(() => {
    fetch("/api/weekly").then((r) => r.json()).then(setWeekly);
    function pollLiquidity() {
      fetch("/api/liquidity").then((r) => r.json()).then((j) => setLiquidity(j));
    }
    pollLiquidity();
    const id = setInterval(pollLiquidity, 60000);
    return () => clearInterval(id);
  }, []);

  // auto-check gates when a live webhook event arrives (fresh, last 2h)
  useEffect(() => {
    const now = Date.now();
    const patch: Record<string, boolean> = {};
    for (const g of GATES) {
      if (!g.liveKey) continue;
      const ev = liveState[g.liveKey];
      if (ev && ev.value && now - ev.ts < 2 * 60 * 60 * 1000 && !autoAppliedRef.current.has(g.id)) {
        patch[g.id] = true;
        autoAppliedRef.current.add(g.id);
      }
    }
    if (Object.keys(patch).length) setChecked((c) => ({ ...c, ...patch }));
  }, [liveState]);

  // auto-check powerhours: 9:30 (ou 10:00 se há notícia hoje), 14:00, 20:00 NY
  useEffect(() => {
    const nyHour = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(new Date())
    );
    const nyMin = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", minute: "2-digit" }).format(new Date())
    );
    const nowH = nyHour + nyMin / 60;
    const todayIdx0 = (new Date().getDay() + 6) % 7;
    const hasNews = todayIdx0 < 5 && weekly.days[todayIdx0].news !== "none";
    const windows = [hasNews ? "10:00" : "09:30", weekly.tradingHoursNY[1] || "14:00", weekly.tradingHoursNY[2] || "20:00"];
    const within = windows.some((h) => {
      const [hh, mm] = h.split(":").map(Number);
      const start = hh + mm / 60;
      return nowH >= start && nowH < start + 1.5;
    });
    setChecked((c) => ({ ...c, powerhours: within }));
  }, [clock, weekly.tradingHoursNY, weekly.days]);

  function toggle(id: string) {
    setChecked((c) => ({ ...c, [id]: !c[id] }));
  }

  const visibleGates = GATES.filter((g) => !g.dir || g.dir === dir);
  const requiredGates = visibleGates.filter((g) => !g.optional);
  const doneCount = requiredGates.filter((g) => checked[g.id]).length;
  const totalCount = requiredGates.length;
  const openCount = totalCount - doneCount;
  const pct = totalCount ? doneCount / totalCount : 0;

  // circuit breaker computation
  const breaker = useMemo(() => {
    if (!cb) return { broken: false, title: "", desc: "", cdRemain: 0 };
    const { cfg, log } = cb;
    let cdRemain = 0;
    if (log.lastLoss) cdRemain = Math.max(0, cfg.cooldown * 60 - (Date.now() - log.lastLoss) / 1000);
    if (log.trades >= cfg.maxtrades)
      return { broken: true, title: "Done for today", desc: `Atingiste o máximo de ${cfg.maxtrades} trades. Dia fechado — volta amanhã.`, cdRemain: 0 };
    if (log.r <= -Math.abs(cfg.maxloss))
      return { broken: true, title: "Daily stop hit", desc: `Estás em ${log.r.toFixed(1)}R. Este é o teu limite. Laptop fechado.`, cdRemain: 0 };
    if (cdRemain > 0)
      return { broken: true, title: "Cooldown — no revenge", desc: "Respira. O setup não vai fugir. Espera o timer chegar a zero.", cdRemain };
    return { broken: false, title: "", desc: "", cdRemain: 0 };
  }, [cb, clock]);

  const allClear = totalCount > 0 && doneCount === totalCount && !breaker.broken;
  const isAplus = !!(checked.smt1m && checked.smt5m && checked.smt15m);

  function fmtClock(s: number) {
    const m = Math.floor(s / 60), ss = Math.floor(s % 60);
    return (m < 10 ? "0" : "") + m + ":" + (ss < 10 ? "0" : "") + ss;
  }
  function log(type: "win" | "be" | "loss") {
    if (!allClear || !cb) return;
    setCb((prev) => {
      if (!prev) return prev;
      const log = { ...prev.log, trades: prev.log.trades + 1 };
      if (type === "win") log.r += Number(prev.cfg.rr) || 2;
      if (type === "loss") { log.r -= 1; log.lastLoss = Date.now(); }
      return { ...prev, log };
    });
    setChecked({});
    autoAppliedRef.current.clear();
  }

  const todayIdx = (new Date().getDay() + 6) % 7; // 0=Mon
  const todayComputed = todayIdx < 5 ? computeDay(weekly.days[todayIdx]) : null;
  const todayHasNews = todayIdx < 5 && weekly.days[todayIdx].news !== "none";
  const firstWindowNY = todayHasNews ? "10:00" : "09:30";

  const nyHourNow = (() => {
    const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(new Date()));
    const m = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", minute: "2-digit" }).format(new Date()));
    return h + m / 60;
  })();
  const inPremarket = nyHourNow >= 4 && nyHourNow < 9.5;

  if (!cb) return null;

  return (
    <div className="page rdm-page">
      <header>
        <h1>RDM <span className="sub">Clearance</span></h1>
        <div className="clock mono">{clock}</div>
      </header>

      <div className="status">
        <div className="stat"><div className="k">Trades today</div><div className="v mono">{cb.log.trades} / {cb.cfg.maxtrades}</div></div>
        <div className="stat"><div className="k">Day R</div><div className={"v mono" + (cb.log.r < 0 ? " warn" : cb.log.r > 0 ? " ok" : "")}>{(cb.log.r > 0 ? "+" : "") + cb.log.r.toFixed(1)}R{cb.cfg.perr ? "  ·  " + (cb.log.r * Number(cb.cfg.perr) > 0 ? "+" : "") + "€" + Math.round(cb.log.r * Number(cb.cfg.perr)) : ""}</div></div>
        <div className="stat"><div className="k">Status</div><div className="v" style={{ fontSize: 14 }}><span className={"dot " + (breaker.broken ? "blocked" : "clear")}></span>{breaker.broken ? "Closed" : "Open"}</div></div>
      </div>

      <div className="dir">
        <button className={"long" + (dir === "long" ? " on" : "")} onClick={() => { setDir("long"); setChecked({}); autoAppliedRef.current.clear(); }}>
          <span className="arrow">▲</span>Long
        </button>
        <button className={"short" + (dir === "short" ? " on" : "")} onClick={() => { setDir("short"); setChecked({}); autoAppliedRef.current.clear(); }}>
          <span className="arrow">▼</span>Short
        </button>
      </div>

      <details className="precond" open>
        <summary><span className="chev">›</span> Day Filter · Notícias &amp; Sessão</summary>
        <div className="precond-list">
          <PreRow
            title="Not a no-news Monday"
            hint="Skip Mondays com news vazia, e 1-2 dias antes de FOMC/Powell."
            status={todayComputed ? (todayComputed.state === "no" ? "blocked" : "clear") : "pending"}
          />
          <div className="info-row">
            <span className={"dot " + (todayComputed ? (todayComputed.state === "no" ? "blocked" : "clear") : "pending")}></span>
            <span className="txtwrap">
              <b>Sessão de hoje: {firstWindowNY}, {weekly.tradingHoursNY[1] || "14:00"}, {weekly.tradingHoursNY[2] || "20:00"} (NY)</b>
              <span className="hint">
                {todayHasNews ? "Há notícia hoje — abertura só depois das 10:00." : "Sem notícia crítica hoje — abertura normal às 9:30."}
              </span>
            </span>
          </div>
        </div>
      </details>

      <details className="precond" open>
        <summary><span className="chev">›</span> Pre-Conditions</summary>
        <div className="precond-list">
          <PreRow
            title="Pre-market open"
            hint="Sem trading antes da abertura oficial — espera volume real."
            status={inPremarket ? "blocked" : "clear"}
          />
          <PreRow title="London used PDA to sponsor overnight move" hint="London tem de usar o Previous Day Array a guiar o overnight." status="pending" />
          <PreRow
            title="London swept Asia high AND low?"
            hint="Se sim → no trade. Se não → verde."
            status={
              liveState.londonSweptBothAsia && tradingDayKey(liveState.londonSweptBothAsia.ts) === tradingDayKey(Date.now())
                ? "blocked"
                : "clear"
            }
          />
          <PreRow
            title="NY premarket swept London H&L before 9:30?"
            hint="Se sim → no trade. Se não → verde."
            status={
              liveState.nyPremarketClearedBothLondon && tradingDayKey(liveState.nyPremarketClearedBothLondon.ts) === tradingDayKey(Date.now())
                ? "blocked"
                : "clear"
            }
          />
        </div>
      </details>

      {[1, 2, 3, 4].map((phaseNum) => (
        <div className="phase" key={phaseNum}>
          <div className="phase-h">
            <span className="n">{String(phaseNum).padStart(2, "0")}</span>
            <span className="t">{PHASE_LABEL[phaseNum]}</span>
          </div>
          {visibleGates.filter((g) => g.phase === phaseNum).map((g) => {
            const isChecked = !!checked[g.id];
            const live = g.liveKey && liveState[g.liveKey] && Date.now() - liveState[g.liveKey].ts < 2 * 60 * 60 * 1000;
            return (
              <label
                key={g.id}
                className={"gate" + (isChecked ? " checked" : "") + (g.optional ? " optional" : "")}
                onClick={(e) => { e.preventDefault(); if (!breaker.broken) toggle(g.id); }}
              >
                <span className="box"><CheckSVG /></span>
                <span className="txt">
                  <b>{g.label}</b>
                  <span className="hint">{g.hint}</span>
                </span>
                {g.tag && <span className="tag">{g.tag}</span>}
                {live && <span className="tag live">live</span>}
              </label>
            );
          })}
        </div>
      ))}

      <div className={"clearance" + (breaker.broken ? " broken" : allClear ? " lit" : " locked")}>
        <div className="sky">
          <div className="glow"></div>
          <div className="sun" style={{ bottom: -50 + pct * 108 + "px" }}></div>
          <div className="horizon"></div>
        </div>
        <div className="verdict">
          <div className="big">
            {breaker.broken ? "Day closed" : allClear ? (isAplus ? "Cleared — A+ setup" : "Cleared — take it") : "No trade"}
          </div>
          <div className="small">
            {breaker.broken ? "Circuit breaker active" : allClear ? `Entry = close · SL = SMT wick · TP = ${cb.cfg.rr}R.` : `${openCount} ${openCount === 1 ? "gate" : "gates"} ainda aberto(s)`}
          </div>
        </div>
        <div className="breaker">
          <div className="bh">{breaker.title}</div>
          <div className="bd">{breaker.desc}</div>
          {breaker.cdRemain > 0 && <div className="cd mono">{fmtClock(breaker.cdRemain)}</div>}
        </div>
      </div>

      <div className="log">
        <button className="win" disabled={!allClear} onClick={() => log("win")}>Win +{cb.cfg.rr}R</button>
        <button disabled={!allClear} onClick={() => log("be")}>Break-even</button>
        <button className="loss" disabled={!allClear} onClick={() => log("loss")}>Loss −1R</button>
      </div>
      <button className="resetbtn" onClick={() => { setChecked({}); autoAppliedRef.current.clear(); }}>
        Clear checklist for next setup
      </button>

      <details className="settingsblock">
        <summary><span className="chev">›</span> Settings &amp; daily circuit breaker</summary>
        <div className="settings">
          <div className="field"><label>Max trades / day</label><input type="number" min={1} value={cb.cfg.maxtrades} onChange={(e) => setCb((p) => p && { ...p, cfg: { ...p.cfg, maxtrades: Number(e.target.value) } })} /></div>
          <div className="field"><label>Daily stop (loss em −R)</label><input type="number" min={1} step={0.5} value={cb.cfg.maxloss} onChange={(e) => setCb((p) => p && { ...p, cfg: { ...p.cfg, maxloss: Number(e.target.value) } })} /></div>
          <div className="field"><label>Cooldown após loss (min)</label><input type="number" min={0} value={cb.cfg.cooldown} onChange={(e) => setCb((p) => p && { ...p, cfg: { ...p.cfg, cooldown: Number(e.target.value) } })} /></div>
          <div className="field"><label>Risk:Reward (R)</label><input type="number" min={0.5} step={0.5} value={cb.cfg.rr} onChange={(e) => setCb((p) => p && { ...p, cfg: { ...p.cfg, rr: Number(e.target.value) } })} /></div>
          <div className="field"><label>€ por R (opcional)</label><input type="number" min={0} step={1} placeholder="ex: 100" value={cb.cfg.perr} onChange={(e) => setCb((p) => p && { ...p, cfg: { ...p.cfg, perr: e.target.value } })} /></div>
          <div className="field"><label>Powerhours</label><input type="text" placeholder="ex: 15:30–18:00" value={cb.cfg.ph} onChange={(e) => setCb((p) => p && { ...p, cfg: { ...p.cfg, ph: e.target.value } })} /></div>
          <p className="note">O circuit breaker fecha o dia ao atingires o máximo de trades ou o stop diário em −R. Depois de cada loss corre um cooldown pra bloquear revenge trades. Guardado neste browser, reseta automaticamente num novo dia.</p>
        </div>
      </details>
    </div>
  );
}

function PreRow({ title, hint, status }: { title: string; hint: string; status: "clear" | "blocked" | "pending" }) {
  return (
    <div className="info-row">
      <span className={"dot " + status}></span>
      <span className="txtwrap">
        <b>{title}</b>
        <span className="hint">{hint}</span>
      </span>
    </div>
  );
}
