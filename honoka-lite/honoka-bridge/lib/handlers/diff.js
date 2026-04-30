function diffLines(oldLines, newLines) {
  const N = oldLines.length, M = newLines.length, MAX = N + M;
  const V = new Array(2 * MAX + 1); V[MAX + 1] = 0;
  const trace = [];
  for (let d = 0; d <= MAX; d++) {
    const snap = V.slice();
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && V[MAX + k - 1] < V[MAX + k + 1])) ? V[MAX + k + 1] : V[MAX + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && oldLines[x] === newLines[y]) { x++; y++; }
      V[MAX + k] = x;
      if (x >= N && y >= M) { trace.push(snap); return buildEdits(trace, oldLines, newLines, MAX); }
    }
    trace.push(V.slice());
  }
  return [];
}

function buildEdits(trace, oldLines, newLines, MAX) {
  const edits = [];
  let x = oldLines.length, y = newLines.length;
  for (let d = trace.length - 1; d >= 0; d--) {
    const V = trace[d], k = x - y;
    let prevK = (k === -d || (k !== d && V[MAX + k - 1] < V[MAX + k + 1])) ? k + 1 : k - 1;
    let prevX = V[MAX + prevK], prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; edits.unshift({ type: "equal", oldIdx: x, newIdx: y }); }
    if (d > 0) {
      if (x === prevX) { edits.unshift({ type: "insert", newIdx: prevY }); y = prevY; }
      else { edits.unshift({ type: "delete", oldIdx: prevX }); x = prevX; }
    }
  }
  return edits;
}

module.exports = { diffLines };
