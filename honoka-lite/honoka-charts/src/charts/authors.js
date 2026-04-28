/**
 * charts/authors.js — Document count by source (pie/donut)
 */

import * as echarts from "echarts";
import { store } from "../store.js";

export function initAuthors(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const chart = echarts.init(el, "dark");
  window.addEventListener("resize", () => chart.resize());
  store.subscribe(docs => render(chart, docs));
}

function render(chart, docs) {
  const counts = {};
  docs.forEach(d => {
    const src = d.source || "unknown";
    counts[src] = (counts[src] || 0) + 1;
  });

  const data = Object.entries(counts).map(([name, value]) => ({ name, value }));

  chart.setOption({
    backgroundColor: "transparent",
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    legend: { orient: "vertical", left: "left" },
    series: [{
      type: "pie",
      radius: ["40%", "70%"],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 6, borderColor: "#1a1a2e", borderWidth: 2 },
      label: { show: false, position: "center" },
      emphasis: {
        label: { show: true, fontSize: 14, fontWeight: "bold" },
      },
      data,
    }],
  }, true);
}
