// Frame-time and load-time measurements for the M8 performance acceptance.
export function createPerf() {
  const samples = [];
  const marks = {};
  return {
    frame(dt) { samples.push(dt * 1000); if (samples.length > 600) samples.shift(); },
    mark(name, ms) { marks[name] = Math.round(ms); },
    report() {
      const sorted = [...samples].sort((a, b) => a - b);
      const pick = (q) => sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] * 10) / 10 : null;
      const mean = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null;
      return {frames: sorted.length, meanMs: mean && Math.round(mean * 10) / 10, p50Ms: pick(0.5), p95Ms: pick(0.95), fps: mean ? Math.round(1000 / mean) : null, marks: {...marks},
        renderer: performance.memory ? {heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576)} : null};
    },
  };
}
