/**
 * charts/lifecycle.js — Scatter: saved date vs file size, colored by category
 * Click a dot to open the doc preview.
 */

import * as echarts from "echarts";
import { store } from "../store.js";
import { bridgeUrl } from "../api.js";

const COLORS = {
  reference: "#4db8ff",
  mine:      "#e94560",
  template:  "#f5a623",
  inbox:     "#7ed321",
  unknown:   "#aaa",
};

export function initLifecycle(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const chart = echarts.init(el, "dark");
  window.addEventListener("resize", () => chart.resize());

  chart.on("click", params => {
    if (params.data?.folder) {
      const url = `${bridgeUrl()}/preview?folder=${encodeURIComponent(params.data.folder)}`;
      window.open(url, "_blank");
    }
  });

  store.subscribe(docs => render(chart, docs));
}

function render(chart, docs) {
  const categories = [...new Set(docs.map(d => d.category || "unknown"))];

  const series = categories.map(cat => ({
    name: cat,
    type: "scatter",
    symbolSize: d => Math.max(6, Math.min(30, Math.sqrt(d[2] / 500))),
    itemStyle: { color: COLORS[cat] || "#aaa", opacity: 0.8 },
    data: docs
      .filter(d => (d.category || "unknown") === cat)
      .map(d => ({
        value: [d.savedAt?.slice(0, 10), d.sizeBytes || 0, d.sizeBytes || 0],
        folder: d.folder,
        title: d.title,
      })),
    tooltip: {
      formatter: p => `${p.data.title || p.data.folder}<br>${p.data.value[0]}<br>${(p.data.value[1] / 1024).toFixed(1)}kb`,
    },
  }));

  chart.setOption({
    backgroundColor: "transparent",
    legend: { data: categories },
    tooltip: { trigger: "item" },
    xAxis: { type: "time", name: "Saved At" },
    yAxis: { type: "value", name: "Size (bytes)" },
    series,
  }, true);
}
