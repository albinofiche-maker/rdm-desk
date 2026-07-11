"use client";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "#chart", label: "Chart" },
  { href: "#checklist", label: "RDM Clearance" },
  { href: "#semana", label: "Weekly Outlook" },
];

export default function NavBar() {
  const [clock, setClock] = useState("--:--:--");
  const [live, setLive] = useState(false);

  useEffect(() => {
    function tick() {
      const d = new Date();
      setClock(
        String(d.getHours()).padStart(2, "0") +
          ":" +
          String(d.getMinutes()).padStart(2, "0") +
          ":" +
          String(d.getSeconds()).padStart(2, "0")
      );
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled) {
          const anyGate = Object.values(json.state || {}) as any[];
          const recent = anyGate.some((g) => Date.now() - g.ts < 5 * 60 * 1000);
          setLive(recent);
        }
      } catch {
        if (!cancelled) setLive(false);
      }
    }
    poll();
    const id = setInterval(poll, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <nav className="topnav">
      <div className="brand">
        RDM <span>Desk</span>
      </div>
      <div className="links">
        {LINKS.map((l) => (
          <a key={l.href} href={l.href}>
            {l.label}
          </a>
        ))}
      </div>
      <div className="live-pill">
        <span className={"live-dot" + (live ? "" : " off")}></span>
        {live ? "TV webhook ativo" : "sem sinal ao vivo"}
      </div>
      <div className="live-pill mono">{clock}</div>
    </nav>
  );
}
