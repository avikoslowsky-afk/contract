import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "data");

const port = 4180;
const tesseractPath = path.join(os.homedir(), "AppData", "Local", "Programs", "Tesseract-OCR", "tesseract.exe");

async function readJson(name, fallback = []) {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, name), "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(name, value) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, name), JSON.stringify(value, null, 2));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(res, value, status = 200) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(value, null, 2));
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(__dirname, safePath);
  try {
    const data = await fs.readFile(filePath);
    const contentType = filePath.endsWith(".html")
      ? "text/html; charset=utf-8"
      : filePath.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : "application/octet-stream";
    res.writeHead(200, { "content-type": contentType });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

function searchContracts(contracts, query) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return contracts;
  return contracts.filter(contract => JSON.stringify(contract).toLowerCase().includes(q));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return sendJson(res, { ok: true });

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/health") {
      let tesseractAvailable = false;
      try {
        await fs.access(tesseractPath);
        tesseractAvailable = true;
      } catch {
        tesseractAvailable = false;
      }
      return sendJson(res, {
        ok: true,
        mode: "free-local-starter",
        storage: "json-files",
        ocr: tesseractAvailable ? "tesseract-installed" : "tesseract-not-found",
        tesseractPath
      });
    }

    if (url.pathname === "/api/contracts" && req.method === "GET") {
      const contracts = await readJson("contracts.json");
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") || 25)));
      const filtered = searchContracts(contracts, url.searchParams.get("q"));
      const start = (page - 1) * pageSize;
      return sendJson(res, {
        total: filtered.length,
        page,
        pageSize,
        records: filtered.slice(start, start + pageSize)
      });
    }

    if (url.pathname === "/api/contracts" && req.method === "POST") {
      const body = await readBody(req);
      const contracts = await readJson("contracts.json");
      const contract = {
        id: `CTR-${Date.now()}`,
        status: "Needs Review",
        reviewStatus: "Pending",
        createdAt: new Date().toISOString(),
        ...body
      };
      contracts.push(contract);
      await writeJson("contracts.json", contracts);
      return sendJson(res, contract, 201);
    }

    if (url.pathname === "/api/sharesync-intake" && req.method === "POST") {
      const body = await readBody(req);
      const contracts = await readJson("contracts.json");
      const jobs = await readJson("ocr-jobs.json");
      const contract = {
        id: `CTR-${Date.now()}`,
        name: body.name || "ShareSync Intake Contract",
        shareSyncUrl: body.shareSyncUrl,
        facility: body.facility || "Needs Classification",
        vendor: body.vendor || "Needs Classification",
        category: body.category || "Needs Classification",
        status: "Needs Review",
        reviewStatus: "Pending OCR",
        createdAt: new Date().toISOString()
      };
      const job = {
        id: `OCR-${Date.now()}`,
        contractId: contract.id,
        source: "ShareSync",
        shareSyncUrl: body.shareSyncUrl,
        status: "Queued",
        createdAt: new Date().toISOString()
      };
      contracts.push(contract);
      jobs.push(job);
      await writeJson("contracts.json", contracts);
      await writeJson("ocr-jobs.json", jobs);
      return sendJson(res, { contract, ocrJob: job }, 201);
    }

    if (url.pathname === "/api/ocr-jobs" && req.method === "GET") {
      return sendJson(res, await readJson("ocr-jobs.json"));
    }

    if (url.pathname === "/api/alerts" && req.method === "GET") {
      return sendJson(res, await readJson("alerts.json"));
    }

    return serveStatic(req, res);
  } catch (error) {
    return sendJson(res, { error: error.message }, 500);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Free starter server running at http://127.0.0.1:${port}/`);
});
