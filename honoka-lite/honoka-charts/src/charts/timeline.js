/**
 * charts/timeline.js — Daily document save activity timeline
 * X axis: date, Y axis: number of docs saved that day
 * Color grouped by source (notion / clip / telegram)
 */

import * as echarts from "echarts";
import { store } from "../store.js";

export function initTimeline(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const chart = echarts.init(el, "dark");
  window.addEventListener("resize", () => chart.resize());
  store.subscribe(docs => render(chart, docs));
}

function render(chart, docs) {
  // Group by date + source
  const byDate = {};
  const sources = new Set();

  docs.forEach(d => {
    if (!d.savedAt) return;
    const day = d.savedAt.slice(0, 10);
    const src = d.source || "unknown";
    sources.add(src);
    if (!byDate[day]) byDate[day] = {};
    byDate[day][src] = (byDate[day][src] || 0) + 1;
  });

  const days = Object.keys(byDate).sort();
  const srcList = [...sources];

  const series = srcList.map(src => ({
    name: src,
    type: "bar",
    stack: "total",
    data: days.map(d => byDate[d]?.[src] || 0),
    emphasis: { focus: "series" },
  }));

  chart.setOption({
    backgroundColor: "transparent",
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { data: srcList, top: 4 },
    dataZoom: [{ type: "slider", bottom: 4, height: 20 }],
    xAxis: { type: "category", data: days, axisLabel: { rotate: 30, fontSize: 10 } },
    yAxis: { type: "value", minInterval: 1 },
    series,
  }, true);
}
