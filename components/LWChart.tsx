"use client";
import { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";

interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface Zone {
  session: "tokyo" | "london" | "ny";
  high: number;
  low: number;
  time: number;
  daysShow: number;
}

const POLL_MS = 5000;
const ZONES_POLL_MS = 5000;

// Mesmas cores por sessão que o FODA v4 usa por omissão no TradingView.
const ZONE_COLORS: Record<Zone["session"], { fill: string; border: string }> = {
  ny: { fill: "rgba(41,98,255,0.13)", border: "rgba(41,98,255,0.55)" },
  london: { fill: "rgba(242,54,69,0.10)", border: "rgba(242,54,69,0.55)" },
  tokyo: { fill: "rgba(255,235,59,0.11)", border: "rgba(255,235,59,0.55)" },
};

export default function LWChart({
  symbol = "MNQ",
  timeframe = "5",
}: {
  symbol?: string;
  timeframe?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const zonesCanvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lastTimeRef = useRef<number | undefined>(undefined);
  const zonesRef = useRef<Zone[]>([]);
  const [status, setStatus] = useState<"loading" | "live" | "empty" | "error">(
    "loading"
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0A0D13" },
        textColor: "#c8d0e0",
      },
      grid: {
        vertLines: { color: "rgba(38,48,74,0.35)" },
        horzLines: { color: "rgba(38,48,74,0.35)" },
      },
      timeScale: { timeVisible: true, secondsVisible: false },
      autoSize: true,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });

    chartRef.current = chart;
    seriesRef.current = series;
    lastTimeRef.current = undefined;

    // ── Desenho das zonas (canvas por cima do gráfico) ──
    function drawZones() {
      const canvas = zonesCanvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const width = container.clientWidth;
      const height = container.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const timeScale = chart.timeScale();
      const visibleRange = timeScale.getVisibleRange();

      for (const zone of zonesRef.current) {
        const y1 = series.priceToCoordinate(zone.high);
        const y2 = series.priceToCoordinate(zone.low);
        if (y1 === null || y2 === null) continue;

        const x1Coord = timeScale.timeToCoordinate(zone.time as UTCTimestamp);
        // Se a zona começa antes do início do range visível, encosta à borda
        // esquerda (a caixa "extend.right" já estava a decorrer fora de vista).
        let x1: number;
        if (x1Coord === null) {
          if (visibleRange && zone.time < (visibleRange.from as number)) {
            x1 = 0;
          } else {
            continue; // zona no futuro, ainda não visível
          }
        } else {
          x1 = Number(x1Coord);
        }
        const x2 = width; // extend.right — vai até à borda direita do gráfico
        const yTop = Math.min(Number(y1), Number(y2));
        const yHeight = Math.abs(Number(y2) - Number(y1));

        const colors = ZONE_COLORS[zone.session];
        ctx.fillStyle = colors.fill;
        ctx.fillRect(x1, yTop, x2 - x1, yHeight);
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 1;
        ctx.strokeRect(x1, yTop, x2 - x1, yHeight);
      }
    }

    chart.timeScale().subscribeVisibleTimeRangeChange(drawZones);
    chart.timeScale().subscribeVisibleLogicalRangeChange(drawZones);
    const resizeObserver = new ResizeObserver(drawZones);
    if (containerRef.current) resizeObserver.observe(containerRef.current);

    let cancelled = false;
    let barsTimer: ReturnType<typeof setTimeout>;
    let zonesTimer: ReturnType<typeof setTimeout>;

    async function pollBars() {
      try {
        const since =
          lastTimeRef.current !== undefined
            ? `&since=${lastTimeRef.current}`
            : "";
        const res = await fetch(
          `/api/bars?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(
            timeframe
          )}${since}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        const bars: Bar[] = data.bars || [];

        if (!cancelled && bars.length > 0) {
          if (lastTimeRef.current === undefined) {
            series.setData(
              bars.map((b) => ({
                time: b.time as UTCTimestamp,
                open: b.open,
                high: b.high,
                low: b.low,
                close: b.close,
              }))
            );
          } else {
            for (const b of bars) {
              series.update({
                time: b.time as UTCTimestamp,
                open: b.open,
                high: b.high,
                low: b.low,
                close: b.close,
              });
            }
          }
          lastTimeRef.current = bars[bars.length - 1].time;
          setStatus("live");
          drawZones();
        } else if (!cancelled && lastTimeRef.current === undefined) {
          setStatus("empty");
        }
      } catch {
        if (!cancelled) setStatus("error");
      } finally {
        if (!cancelled) barsTimer = setTimeout(pollBars, POLL_MS);
      }
    }

    async function pollZones() {
      try {
        const res = await fetch(
          `/api/zones?symbol=${encodeURIComponent(symbol)}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (!cancelled) {
          zonesRef.current = data.zones || [];
          drawZones();
        }
      } catch {
        // silencioso — zonas são um extra visual, não bloqueia o gráfico principal
      } finally {
        if (!cancelled) zonesTimer = setTimeout(pollZones, ZONES_POLL_MS);
      }
    }

    pollBars();
    pollZones();

    return () => {
      cancelled = true;
      clearTimeout(barsTimer);
      clearTimeout(zonesTimer);
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [symbol, timeframe]);

  return (
    <div className="tvchart-wrap">
      <div ref={containerRef} className="tvchart-inner" style={{ position: "relative" }} />
      <canvas
        ref={zonesCanvasRef}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
        }}
      />
      {status === "empty" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#8a93a8", fontSize: 13 }}>
          À espera da primeira vela do webhook Pine ({symbol} {timeframe}m)…
        </div>
      )}
      {status === "error" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#ef5350", fontSize: 13 }}>
          Erro a carregar dados de /api/bars
        </div>
      )}
    </div>
  );
}
