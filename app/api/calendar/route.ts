import { NextResponse } from "next/server";

// Classifica o nome do evento económico no mesmo vocabulário do RULES do Weekly Outlook.
function classify(eventName: string, impact: string): string {
  const n = eventName.toLowerCase();
  if (n.includes("fomc") || n.includes("interest rate decision") || n.includes("fed interest rate"))
    return "fomc";
  if (n.includes("powell") || n.includes("fed chair") || n.includes("speaks"))
    return "fed_speech";
  if (
    n.includes("nonfarm") ||
    n.includes("non-farm") ||
    n.includes("cpi") ||
    n.includes("core cpi") ||
    n.includes("pce") ||
    n.includes("core pce")
  )
    return "red_critical";
  if (impact === "High") return "red_isolated";
  if (impact === "Medium") return "orange";
  if (impact === "Low") return "yellow";
  return "none";
}

export async function GET(req: Request) {
  const apiKey = process.env.FMP_API_KEY;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!apiKey) {
    return NextResponse.json(
      {
        configured: false,
        note:
          "Auto-preenchimento desligado — falta a variável de ambiente FMP_API_KEY (financialmodelingprep.com tem tier grátis). Sem isso, preenche o Weekly Outlook manualmente.",
        days: [],
      },
      { status: 200 }
    );
  }

  try {
    const url = `https://financialmodelingprep.com/api/v3/economic_calendar?from=${from}&to=${to}&apikey=${apiKey}`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    const data = await res.json();

    const usEvents = Array.isArray(data)
      ? data.filter((e: any) => e.country === "US")
      : [];

    const byDay: Record<string, string[]> = {};
    for (const e of usEvents) {
      const day = (e.date as string).slice(0, 10);
      const cls = classify(e.event, e.impact);
      byDay[day] = byDay[day] || [];
      byDay[day].push(cls);
    }

    const rank = ["none", "yellow", "orange", "red_isolated", "red_critical", "fomc", "fed_speech"];
    const worst: Record<string, string> = {};
    for (const day of Object.keys(byDay)) {
      worst[day] = byDay[day].sort((a, b) => rank.indexOf(b) - rank.indexOf(a))[0];
    }

    return NextResponse.json({ configured: true, days: worst });
  } catch (err) {
    return NextResponse.json(
      { configured: true, error: "Falha ao consultar o calendário", days: [] },
      { status: 200 }
    );
  }
}
