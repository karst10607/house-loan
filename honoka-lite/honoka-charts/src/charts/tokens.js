/**
 * charts/tokens.js — File size distribution (proxy for token count)
 * Histogram of sizeBytes, grouped into buckets
 */

import * as echarts from "echarts";
import { store } from "../store.js";

export function initTokens(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const chart = echarts.init(el, "dark");
  window.addEventListener("resize", () => chart.resize());
  store.subscribe(docs => render(chart, docs));
}

function render(chart, docs) {
  // Buckets: 0-5kb, 5-20kb, 20-50kb, 50-100kb, 100kb+
  const buckets = ["<5kb", "5-20kb", "20-50kb", "50-100kb", "100kb+"];
  const counts = [0, 0, 0, 0, 0];

  docs.forEach(d => {
    const kb = (d.sizeBytes || 0) / 1024;
    if (kb < 5) counts[0]++;
    else if (kb < 20) counts[1]++;
    else if (kb < 50) counts[2]++;
    else if (kb < 100) counts[3]++;
    else counts[4]++;
  });

  chart.setOption({
    backgroundColor: "transparent",
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: buckets },
    yAxis: { type: "value", minInterval: 1 },
    series: [{
      type: "bar",
      data: counts,
      itemStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: "#4db8ff" },
          { offset: 1, color: "#0f3460" },
        ]),
      },
      label: { show: true, position: "top" },
    }],
  }, true);
}
