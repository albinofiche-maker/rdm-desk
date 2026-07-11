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

const POLL_MS = 5000;

export default function LWChart({
  symbol = "MNQ",
  timeframe = "5",
}: {
  symbol?: string;
  timeframe?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lastTimeRef = useRef<number | undefined>(undefined);
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

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
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
        } else if (!cancelled && lastTimeRef.current === undefined) {
          setStatus("empty");
        }
      } catch {
        if (!cancelled) setStatus("error");
      } finally {
        if (!cancelled) timer = setTimeout(poll, POLL_MS);
      }
    }

    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      chart.remove();
    };
  }, [symbol, timeframe]);

  return (
    <div className="tvchart-wrap">
      <div ref={containerRef} className="tvchart-inner" style={{ position: "relative" }} />
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
