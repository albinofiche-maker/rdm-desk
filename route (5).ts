"use client";
import { useEffect, useMemo, useState } from "react";
import "./weekly.css";
import {
  DAY_NAMES,
  DayInput,
  NEWS_LABELS,
  NewsType,
  WeeklyState,
  computeDay,
  defaultWeeklyState,
} from "@/lib/weekly";

const NEWS_ORDER: NewsType[] = [
  "none",
  "holiday",
  "yellow",
  "orange",
  "red_isolated",
  "cpi",
  "ppi",
  "nfp",
  "red_critical",
  "fomc",
  "fed_speech",
  "post_holiday",
];

export default function WeeklyOutlookPage() {
  const [weekly, setWeekly] = useState<WeeklyState>(defaultWeeklyState());
  const [loaded, setLoaded] = useState(false);
  const [autoNote, setAutoNote] = useState<string | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);

  useEffect(() => {
    fetch("/api/weekly")
      .then((r) => r.json())
      .then((s) => {
        setWeekly(s);
        setLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const id = setTimeout(() => {
      fetch("/api/weekly", { method: "POST", body: JSON.stringify(weekly), headers: { "Content-Type": "application/json" } });
    }, 500);
    return () => clearTimeout(id);
  }, [weekly, loaded]);

  const results = useMemo(() => weekly.days.map(computeDay), [weekly.days]);

  function updateDay(i: number, patch: Partial<DayInput>) {
    setWeekly((w) => ({
      ...w,
      days: w.days.map((d, idx) => (idx === i ? { ...d, ...patch } : d)),
    }));
  }

  function updateHour(i: number, value: string) {
    setWeekly((w) => ({
      ...w,
      tradingHoursNY: w.tradingHoursNY.map((h, idx) => (idx === i ? value : h)),
    }));
  }

  async function autoFill() {
    setAutoBusy(true);
    setAutoNote(null);
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    const from = monday.toISOString().slice(0, 10);
    const to = friday.toISOString().slice(0, 10);
    try {
      const res = await fetch(`/api/calendar?from=${from}&to=${to}`);
      const json = await res.json();
      if (!json.configured) {
        setAutoNote(json.note);
        setAutoBusy(false);
        return;
      }
      const newDays = [...weekly.days];
      for (let i = 0; i < 5; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const key = d.toISOString().slice(0, 10);
        const cls = json.days[key];
        if (cls) newDays[i] = { ...newDays[i], news: cls as NewsType };
      }
      setWeekly((w) => ({ ...w, days: newDays }));
      setAutoNote("Notícias preenchidas a partir do calendário económico.");
    } catch {
      setAutoNote("Falha ao contactar o calendário — preenche manualmente.");
    }
    setAutoBusy(false);
  }

  const counts = { no: 0, half: 0, full: 0 };
  results.forEach((r) => counts[r.state]++);
  const exposurePct = Math.round(((counts.half * 0.5 + counts.full * 1) / 5) * 100);

  let verdict: React.ReactNode;
  if (counts.full >= 3) {
    verdict = (
      <>Semana com <b>{counts.full} dia(s) full size</b> — boa janela pra construir o mês. Mantém a disciplina nos dias de half/no trade.</>
    );
  } else if (counts.no >= 3) {
    verdict = (
      <>Semana pesada em notícias — <b>{counts.no} dia(s) sem trade</b>. Semana de "sit on your hands", não de forçar setups.</>
    );
  } else {
    verdict = (
      <>Semana mista: <b>{counts.full} full</b>, <b>{counts.half} half</b>, <b>{counts.no} no trade</b>. Deixa o contexto de cada dia guiar o size.</>
    );
  }

  return (
    <div className="page wide wk-page">
      <div className="dashboard">
        <div className="dash-title">Semana {weekly.week}</div>
        <div className="strip">
          {DAY_NAMES.map((name, i) => (
            <div key={name} className={"strip-day state-" + results[i].state}>
              <div className="strip-day-name">{name.slice(0, 3).toUpperCase()}</div>
              <div className="strip-day-action">{results[i].shortLabel}</div>
            </div>
          ))}
        </div>
        <div className="stat-row">
          <div className="stat-box no">
            <div className="stat-num">{counts.no}</div>
            <div className="stat-label">No trade</div>
          </div>
          <div className="stat-box half">
            <div className="stat-num">{counts.half}</div>
            <div className="stat-label">Half size</div>
          </div>
          <div className="stat-box full">
            <div className="stat-num">{counts.full}</div>
            <div className="stat-label">Full size</div>
          </div>
          <div className="stat-box risk">
            <div className="stat-num">{exposurePct}%</div>
            <div className="stat-label">Exposição da semana</div>
          </div>
        </div>
        <div className="week-bar">
          {results.map((r, i) => (
            <div
              key={i}
              className="week-bar-seg"
              style={{
                width: "20%",
                background: r.state === "no" ? "var(--ember)" : r.state === "half" ? "var(--dawn)" : "var(--teal)",
              }}
            />
          ))}
        </div>
        <div className="week-verdict">{verdict}</div>

        <div className="hours-row">
          <span style={{ color: "var(--mut)", fontSize: 11 }}>Horas de trade (NY):</span>
          {weekly.tradingHoursNY.map((h, i) => (
            <input key={i} type="time" value={h} onChange={(e) => updateHour(i, e.target.value)} />
          ))}
        </div>
      </div>

      <div className="section-label">
        Configura os dias
        <button className="auto-btn" onClick={autoFill} disabled={autoBusy}>
          {autoBusy ? "a puxar…" : "Auto-preencher notícias"}
        </button>
      </div>
      {autoNote && <div className="auto-note">{autoNote}</div>}

      {DAY_NAMES.map((name, i) => {
        const r = results[i];
        const isLast = i === DAY_NAMES.length - 1;
        return (
          <div key={name} className={"day-card state-" + r.state}>
            <div className="day-top">
              <div className="day-name">{name}</div>
              <select value={weekly.days[i].news} onChange={(e) => updateDay(i, { news: e.target.value as NewsType })}>
                {NEWS_ORDER.map((n) => (
                  <option key={n} value={n}>
                    {NEWS_LABELS[n]}
                  </option>
                ))}
              </select>
            </div>
            <div className="mods">
              {!isLast && (
                <label className="mod-toggle">
                  <input
                    type="checkbox"
                    checked={weekly.days[i].tomorrowCritical}
                    onChange={(e) => updateDay(i, { tomorrowCritical: e.target.checked })}
                  />
                  Amanhã há NFP / CPI / FOMC
                </label>
              )}
              <label className="mod-toggle">
                <input
                  type="checkbox"
                  checked={weekly.days[i].tightRange}
                  onChange={(e) => updateDay(i, { tightRange: e.target.checked })}
                />
                Range da manhã &lt; 100 pontos
              </label>
              <label className="mod-toggle">
                <input
                  type="checkbox"
                  checked={weekly.days[i].choppyDump}
                  onChange={(e) => updateDay(i, { choppyDump: e.target.checked })}
                />
                Muito choppy / dump grande Asia-London
              </label>
              {isLast && (
                <label className="mod-toggle">
                  <input
                    type="checkbox"
                    checked={weekly.days[i].goodWeek}
                    onChange={(e) => updateDay(i, { goodWeek: e.target.checked })}
                  />
                  Semana a correr bem (preservar capital)
                </label>
              )}
            </div>
            <div className="result">
              <div className="result-action">{r.action}</div>
              <div className="result-reason">
                {r.reason} {r.extraNotes.join(" ")}
              </div>
            </div>
          </div>
        );
      })}

      <div className="legend">
        <b>Base das regras:</b> extraído de 25 weekly outlooks do Bonka + notas próprias (CPI tradável, PPI half, NFP fade,
        cautela em Monday sem notícia, choppy/dump = fade). Guardado automaticamente e reposto no início de cada semana.
      </div>
    </div>
  );
}
