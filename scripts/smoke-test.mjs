const baseUrl = String(process.env.APP_URL || "http://127.0.0.1:4182").replace(/\/$/, "");
const maxResponseMs = Number(process.env.SMOKE_MAX_MS || 5000);

const checks = [
  ["Health", "/api/health"],
  ["Dashboard", "/api/dashboard"],
  ["Finance", "/api/finance-summary"],
  ["Services", "/api/services-summary"],
  ["Admin summary", "/api/admin-summary"],
  ["Review page", "/api/review-summary?page=1&pageSize=15"],
  ["Contracts page", "/api/contracts?page=1&pageSize=25&compact=1"],
  ["Vendor search", "/api/vendors?q=medical&light=1&limit=25"],
  ["OCR page", "/api/ocr-jobs?page=1&pageSize=25&lean=1"]
];

let failed = false;
for (const [name, path] of checks) {
  const startedAt = performance.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(maxResponseMs + 1000)
    });
    const elapsed = Math.round(performance.now() - startedAt);
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    const validJson = payload !== null;
    const fastEnough = elapsed <= maxResponseMs;
    const ok = response.ok && validJson && fastEnough;
    failed ||= !ok;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${response.status}, ${elapsed}ms, ${Buffer.byteLength(text)} bytes`);
    if (!response.ok) console.log(`  ${payload?.error || text.slice(0, 300) || "Request failed"}`);
    if (!validJson) console.log("  Response was not valid JSON.");
    if (!fastEnough) console.log(`  Response exceeded ${maxResponseMs}ms.`);
  } catch (error) {
    failed = true;
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

if (failed) process.exitCode = 1;
