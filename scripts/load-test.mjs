const baseUrl = String(process.env.APP_URL || "http://127.0.0.1:4182").replace(/\/$/, "");
const concurrency = Math.max(1, Math.min(Number(process.env.LOAD_CONCURRENCY || 10), 100));
const requestsPerWorker = Math.max(1, Math.min(Number(process.env.LOAD_REQUESTS_PER_WORKER || 10), 200));
const maxP95Ms = Math.max(100, Number(process.env.LOAD_MAX_P95_MS || 2500));
const paths = [
  "/api/dashboard",
  "/api/finance-summary",
  "/api/services-summary",
  "/api/review-summary?page=1&pageSize=15",
  "/api/contracts?page=1&pageSize=25&compact=1",
  "/api/vendors?q=medical&light=1&limit=25",
  "/api/ocr-jobs?page=1&pageSize=25&lean=1"
];

const durations = [];
const failures = [];

async function worker(workerId) {
  for (let index = 0; index < requestsPerWorker; index += 1) {
    const path = paths[(workerId + index) % paths.length];
    const startedAt = performance.now();
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10000)
      });
      const elapsed = Math.round(performance.now() - startedAt);
      durations.push(elapsed);
      if (!response.ok) failures.push({ path, status: response.status });
      await response.arrayBuffer();
    } catch (error) {
      failures.push({ path, error: error.message });
    }
  }
}

const startedAt = performance.now();
await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index)));
const totalMs = Math.round(performance.now() - startedAt);
durations.sort((a, b) => a - b);
const percentile = value => durations[Math.min(durations.length - 1, Math.floor(durations.length * value))] || 0;
const summary = {
  baseUrl,
  concurrency,
  requests: concurrency * requestsPerWorker,
  failures: failures.length,
  totalMs,
  requestsPerSecond: totalMs ? Number(((durations.length / totalMs) * 1000).toFixed(1)) : 0,
  medianMs: percentile(0.5),
  p95Ms: percentile(0.95),
  maxMs: durations.at(-1) || 0
};

console.log(JSON.stringify(summary, null, 2));
if (failures.length) console.log(JSON.stringify(failures.slice(0, 20), null, 2));
if (failures.length || summary.p95Ms > maxP95Ms) process.exitCode = 1;
