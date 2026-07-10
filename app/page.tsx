"use client";
import { useEffect, useState } from "react";
import { DAY_NAMES, WeeklyState, computeDay, defaultWeeklyState } from "@/lib/weekly";

export default function Dashboard() {
  const [weekly, setWeekly] = useState<WeeklyState>(defaultWeeklyState());
  useEffect(() => {
    fetch("/api/weekly").then((r) => r.json()).then(setWeekly);
  }, []);

  const todayIdx = (new Date().getDay() + 6) % 7;
  const isWeekday = todayIdx < 5;
  const today = isWeekday ? computeDay(weekly.days[todayIdx]) : null;

  return (
    <div className="page">
      <div style={{ marginBottom: 24 }}>
        <div className="mono" style={{ color: "var(--mut)", fontSize: 12, textTransform: "uppercase", letterSpacing: ".1em" }}>
          {isWeekday ? DAY_NAMES[todayIdx] : "Fim de semana"} · Semana {weekly.week}
        </div>
        <h1 style={{ fontSize: 22, margin: "6px 0 0", fontWeight: 700 }}>
          {today ? today.action : "Mercado fechado"}
        </h1>
        {today && (
          <p style={{ color: "var(--mut)", fontSize: 13.5, lineHeight: 1.5, marginTop: 8 }}>
            {today.reason} {today.extraNotes.join(" ")}
          </p>
        )}
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        <a
          href="/weekly-outlook"
          style={{
            display: "block",
            padding: "16px 18px",
            background: "var(--panel)",
            border: "1px solid var(--line-soft)",
            borderRadius: 10,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>Weekly Outlook →</div>
          <div style={{ color: "var(--mut)", fontSize: 12.5, marginTop: 4 }}>
            Preenche as notícias e horas da semana, vê o size de cada dia.
          </div>
        </a>
        <a
          href="/rdm-clearance"
          style={{
            display: "block",
            padding: "16px 18px",
            background: "var(--panel)",
            border: "1px solid var(--line-soft)",
            borderRadius: 10,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>RDM Clearance →</div>
          <div style={{ color: "var(--mut)", fontSize: 12.5, marginTop: 4 }}>
            Checklist ao vivo — gates de contexto, SMT, FVG e disciplina.
          </div>
        </a>
      </div>
    </div>
  );
}
