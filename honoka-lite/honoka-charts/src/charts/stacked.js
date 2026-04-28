/**
 * charts/stacked.js — Cumulative document count by any property over time
 * The property to group by is selectable via a dropdown (category, source, baseDir…)
 */

import * as echarts from "echarts";
import { store } from "../store.js";

const GROUPABLE = [
  { key: "category", label: "Category" },
  { key: "source",   label: "Source" },
  { key: "baseDir",  label: "Storage (docs/inbox)" },
];

let _currentProp = "category";

export function initStacked(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const chart = echarts.init(el, "dark");
  window.addEventListener("resize", () => chart.resize());

  // Populate property selector
  const select = document.getElementById("stacked-prop-select");
  if (select) {
    GROUPABLE.forEach(opt => {
      const o = document.createElement("option");
      o.value = opt.key;
      o.textContent = opt.label;
      select.appendChild(o);
    });
    select.addEventListener("change", () => {
      _currentProp = select.value;
      render(chart, store.filtered);
    });
  }

  store.subscribe(docs => render(chart, docs));
}

function render(chart, docs) {
  // Build sorted date list
  const allDays = [...new Set(docs.map(d => d.savedAt?.slice(0, 10)).filter(Boolean))].sort();
  if (allDays.length === 0) { chart.clear(); return; }

  // Accumulate counts per group per day
  const groups = new Set();
  const countMap = {}; // { day: { group: count } }

  docs.forEach(d => {
    const day = d.savedAt?.slice(0, 10);
    if (!day) return;
    const group = d[_currentProp] || "unknown";
    groups.add(group);
    if (!countMap[day]) countMap[day] = {};
    countMap[day][group] = (countMap[day][group] || 0) + 1;
  });

  // Build cumulative series
  const groupList = [...groups];
  const cumulative = {};
  groupList.forEach(g => cumulative[g] = 0);

  const series = groupList.map(group => {
    let cum = 0;
    return {
      name: group,
      type: "line",
      stack: "total",
      areaStyle: {},
      smooth: true,
      emphasis: { focus: "series" },
      data: allDays.map(day => {
        cum += countMap[day]?.[group] || 0;
        return cum;
      }),
    };
  });

  chart.setOption({
    backgroundColor: "transparent",
    tooltip: { trigger: "axis" },
    legend: { data: groupList },
    xAxis: { type: "category", data: allDays, axisLabel: { rotate: 30, fontSize: 10 } },
    yAxis: { type: "value", minInterval: 1 },
    series,
  }, true);
}
