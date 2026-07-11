"use client";
import { useEffect, useRef } from "react";

const CONTAINER_ID = "tv_chart_rdm";

export default function TVChart({ symbol = "OANDA:NAS100USD" }: { symbol?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = "";

    const widgetDiv = document.createElement("div");
    widgetDiv.id = CONTAINER_ID;
    widgetDiv.style.height = "100%";
    widgetDiv.style.width = "100%";
    ref.current.appendChild(widgetDiv);

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = () => {
      // @ts-ignore — TradingView é injetado no window pelo script acima
      if (window.TradingView && ref.current) {
        // @ts-ignore
        new window.TradingView.widget({
          autosize: true,
          symbol,
          interval: "5",
          timezone: "America/New_York",
          theme: "dark",
          style: "1",
          locale: "pt",
          toolbar_bg: "#0A0D13",
          enable_publishing: false,
          hide_top_toolbar: false,
          hide_legend: false,
          save_image: false,
          container_id: CONTAINER_ID,
          backgroundColor: "#0A0D13",
          gridColor: "rgba(38,48,74,0.35)",
        });
      }
    };
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, [symbol]);

  return (
    <div className="tvchart-wrap">
      <div ref={ref} className="tvchart-inner" />
    </div>
  );
}
