import http from "node:http";
import { preferredFacilityFolder } from "./sharesync-folder-map.mjs";
import { reminderSettings, reminderItems, reminderText, recipientItems, reminderHtml } from "./renewal-email.mjs";
import { execFile } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import net from "node:net";
import tls from "node:tls";
import { inflateRawSync } from "node:zlib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "data");
const uploadsDir = path.join(__dirname, "uploads");
const backupsDir = path.join(dataDir, "backups");
await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(uploadsDir, { recursive: true });
await fs.mkdir(backupsDir, { recursive: true });

async function loadLocalEnv() {
  const envPath = path.join(__dirname, ".env");
  const text = await fs.readFile(envPath, "utf8").catch(() => "");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

await loadLocalEnv();

const dbPath = path.join(dataDir, "contracts.sqlite");
const db = new DatabaseSync(dbPath);
try {
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
} catch (error) {
  console.warn("[server] SQLite performance pragmas skipped:", error.message);
}

const port = Number(process.env.PORT || 4180);
const host = process.env.HOST || "127.0.0.1";
const execFileAsync = promisify(execFile);
const sessions = new Map();
const activePresence = new Map();
const presenceMaxAgeMs = 5 * 60 * 1000;
const sessionMaxAgeSeconds = 60 * 60 * 10;
const adminUser = process.env.ADMIN_USER || "";
const adminPassword = process.env.ADMIN_PASSWORD || "";
const loginRequired = String(process.env.REQUIRE_LOGIN || "false").toLowerCase() === "true";
const secureCookies = String(process.env.COOKIE_SECURE || (process.env.NODE_ENV === "production" ? "true" : "false")).toLowerCase() === "true";
const serverStartedAt = Date.now();
const serverMetrics = { requests: 0, errors: 0, slowRequests: 0, totalDurationMs: 0, maxDurationMs: 0 };

function localNetworkUrls(port) {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(item => item && item.family === "IPv4" && !item.internal)
    .map(item => `http://${item.address}:${port}/`);
}

process.on("unhandledRejection", error => {
  console.error("[server] Unhandled async error:", error);
});

process.on("uncaughtException", error => {
  console.error("[server] Uncaught server error:", error);
});

function windowsShellQuote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function friendlySpawnError(error, toolPath) {
  if (error?.code !== "EPERM") return error;
  const message = [
    `Windows blocked the OCR helper from starting: ${toolPath}`,
    "Close the app and restart it from start-windows-server.bat.",
    "If this keeps happening, allow Tesseract/Poppler/Python in Windows Security or Controlled Folder Access."
  ].join(" ");
  const wrapped = new Error(message);
  wrapped.code = error.code;
  wrapped.cause = error;
  return wrapped;
}

async function execTool(toolPath, args = [], options = {}) {
  try {
    return await execFileAsync(toolPath, args, options);
  } catch (error) {
    if (process.platform === "win32" && error?.code === "EPERM") {
      const command = [windowsShellQuote(toolPath), ...args.map(windowsShellQuote)].join(" ");
      try {
        return await execFileAsync(process.env.ComSpec || "cmd.exe", ["/d", "/c", command], options);
      } catch (retryError) {
        throw friendlySpawnError(retryError.code === "EPERM" ? retryError : error, toolPath);
      }
    }
    throw friendlySpawnError(error, toolPath);
  }
}

const tesseractCandidates = [
  process.env.TESSERACT_PATH,
  "/opt/homebrew/bin/tesseract",
  "/usr/local/bin/tesseract",
  path.join(os.homedir(), "AppData", "Local", "Programs", "Tesseract-OCR", "tesseract.exe")
].filter(Boolean);
const windowsPopplerBin = path.join(os.homedir(), "AppData", "Local", "Microsoft", "WinGet", "Packages", "oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe", "poppler-25.07.0", "Library", "bin");
const pdftoppmCandidates = [
  process.env.PDFTOPPM_PATH,
  "/opt/homebrew/bin/pdftoppm",
  "/usr/local/bin/pdftoppm",
  path.join(windowsPopplerBin, "pdftoppm.exe")
].filter(Boolean);
const pdfinfoCandidates = [
  process.env.PDFINFO_PATH,
  "/opt/homebrew/bin/pdfinfo",
  "/usr/local/bin/pdfinfo",
  path.join(windowsPopplerBin, "pdfinfo.exe")
].filter(Boolean);
const pdftotextCandidates = [
  process.env.PDFTOTEXT_PATH,
  "/opt/homebrew/bin/pdftotext",
  "/usr/local/bin/pdftotext",
  path.join(windowsPopplerBin, "pdftotext.exe")
].filter(Boolean);
const pythonCandidates = [
  process.env.PYTHON_PATH,
  "/Library/Frameworks/Python.framework/Versions/3.14/bin/python3",
  "/opt/homebrew/bin/python3",
  "/usr/bin/python3",
  path.join(os.homedir(), "AppData", "Local", "Microsoft", "WindowsApps", "py.exe"),
  path.join(os.homedir(), "AppData", "Local", "Microsoft", "WindowsApps", "python.exe")
].filter(Boolean);
const configuredMaxPdfPages = Number(process.env.OCR_MAX_PDF_PAGES ?? 25);
const maxPdfPages = configuredMaxPdfPages <= 0 ? 0 : Math.max(1, configuredMaxPdfPages || 25);
const maxUploadBytes = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 50)) * 1024 * 1024;
const maxJsonBytes = Math.max(1, Number(process.env.MAX_JSON_MB || 5)) * 1024 * 1024;
const maxMultipartFields = Math.max(10, Number(process.env.MAX_MULTIPART_FIELDS || 80));
const maxFileNameLength = Math.max(80, Number(process.env.MAX_UPLOAD_FILENAME_LENGTH || 180));
const rateLimitWindowMs = Math.max(10000, Number(process.env.RATE_LIMIT_WINDOW_MS || 60000));
const rateLimitRequests = Math.max(30, Number(process.env.RATE_LIMIT_REQUESTS || 300));
const uploadRateLimitRequests = Math.max(3, Number(process.env.UPLOAD_RATE_LIMIT_REQUESTS || 45));
const requestBuckets = new Map();
const activeOcrJobs = new Set();
const queuedOcrJobs = [];
const queuedOcrJobIds = new Set();
const internalWorkerToken = crypto.randomBytes(32).toString("hex");
const ocrWorkerConcurrency = Math.max(1, Math.min(Number(process.env.OCR_WORKER_CONCURRENCY || 1), 4));
const ocrResumeOnStart = String(process.env.OCR_RESUME_ON_START || "true").toLowerCase() !== "false";
let runningQueuedOcrJobs = 0;

function enqueueServerOcrJob(jobId, { preserveStatus = false } = {}) {
  const job = getOcrJob(jobId);
  if (!job || queuedOcrJobIds.has(jobId) || activeOcrJobs.has(jobId)) return job;
  if (!preserveStatus) {
    job.status = "Queued";
    job.progress = { stage: "queued", message: "Waiting for the server OCR worker.", updatedAt: new Date().toISOString() };
    job.updatedAt = new Date().toISOString();
    delete job.error;
    saveOcrJob(job);
  }
  queuedOcrJobIds.add(jobId);
  queuedOcrJobs.push(jobId);
  queueMicrotask(drainServerOcrQueue);
  return job;
}

async function drainServerOcrQueue() {
  while (runningQueuedOcrJobs < ocrWorkerConcurrency && queuedOcrJobs.length) {
    const jobId = queuedOcrJobs.shift();
    queuedOcrJobIds.delete(jobId);
    runningQueuedOcrJobs += 1;
    fetch(`http://127.0.0.1:${port}/api/ocr-jobs/${encodeURIComponent(jobId)}/run`, {
      method: "POST",
      headers: { "x-contract-internal-worker": internalWorkerToken }
    }).catch(error => {
      const job = getOcrJob(jobId);
      if (job) {
        job.status = "Queued";
        job.error = `OCR worker will retry after restart: ${error.message}`;
        job.updatedAt = new Date().toISOString();
        saveOcrJob(job);
      }
    }).finally(() => {
      runningQueuedOcrJobs = Math.max(0, runningQueuedOcrJobs - 1);
      drainServerOcrQueue();
    });
  }
}

function resumePendingOcrJobs() {
  const rows = db.prepare(`
    SELECT id FROM ocr_jobs
    WHERE lower(trim(coalesce(status, ''))) IN ('queued', 'processing')
    ORDER BY created_at ASC
  `).all();
  rows.forEach(row => enqueueServerOcrJob(row.id, { preserveStatus: true }));
  return rows.length;
}
const pdfRenderScript = path.join(__dirname, "scripts", "render_pdf_pages.py");
const docxToTextScript = path.join(__dirname, "scripts", "docx_to_text.py");
const excelToJsonScript = path.join(__dirname, "scripts", "excel_to_json.py");
const openAiModel = process.env.OPENAI_MODEL || "gpt-5.2";
const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const ollamaModel = process.env.OLLAMA_MODEL || "qwen2.5:3b";
const ocrWorkerUrl = process.env.OCR_WORKER_URL || "http://127.0.0.1:4311";
const alertWebhookUrl = process.env.ALERT_WEBHOOK_URL || "";
const alertEmailTo = process.env.ALERT_EMAIL_TO || "";
const smtpHost = process.env.SMTP_HOST || "";
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD || "";
const smtpFrom = process.env.SMTP_FROM || process.env.ALERT_EMAIL_FROM || "contracts@localhost";
const appBaseUrl = String(process.env.APP_BASE_URL || "").replace(/\/$/, "");
const aiTimeoutMs = Math.max(5000, Number(process.env.AI_TIMEOUT_MS || 30000));
const aiExtractionEnabled = String(process.env.AI_EXTRACTION_ENABLED || "true").toLowerCase() !== "false";
const aiFallbackOnly = String(process.env.AI_FALLBACK_ONLY || "true").toLowerCase() !== "false";
const aiAgentAutoSave = String(process.env.AI_AGENT_AUTO_SAVE || "false").toLowerCase() === "true";
const aiAgentAutoReviewThreshold = Math.max(70, Number(process.env.AI_AGENT_AUTO_REVIEW_THRESHOLD || 88));
const aiAgentDraftThreshold = Math.max(50, Number(process.env.AI_AGENT_DRAFT_THRESHOLD || 72));
const tesseractArgs = ["stdout", "-l", "eng", "--oem", "1", "--psm", process.env.OCR_TESSERACT_PSM || "1", "-c", "preserve_interword_spaces=1", "-c", "user_defined_dpi=300"];

async function readJson(name, fallback = []) {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, name), "utf8"));
  } catch {
    try {
      return JSON.parse(await fs.readFile(path.join(__dirname, name), "utf8"));
    } catch {
      return fallback;
    }
  }
}

async function writeJson(name, value) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, name), JSON.stringify(value, null, 2));
}

function invoiceFilesFromZip(buffer, maxUncompressedBytes) {
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const localSignature = 0x04034b50;
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("The ZIP archive is invalid or incomplete.");
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const maxZipEntries = Math.max(40, Number(process.env.MAX_ZIP_ENTRIES || 500));
  if (entryCount > maxZipEntries) throw new Error(`ZIP contains more than ${maxZipEntries} files. Use multiple archives so each upload can be audited safely.`);
  let offset = buffer.readUInt32LE(eocd + 16);
  let totalSize = 0;
  const allowed = new Set([".pdf", ".docx", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".txt", ".text", ".md", ".csv", ".xlsx"]);
  const files = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== centralSignature) throw new Error("The ZIP directory is invalid.");
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString(flags & 0x800 ? "utf8" : "latin1");
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/") || !allowed.has(path.extname(name).toLowerCase())) continue;
    if (flags & 1) throw new Error(`Encrypted ZIP entries are not supported: ${path.basename(name)}`);
    totalSize += uncompressedSize;
    if (totalSize > maxUncompressedBytes) throw new Error("The uncompressed ZIP is too large.");
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== localSignature) throw new Error("A ZIP file entry is invalid.");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const contents = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
    if (!contents) throw new Error(`Unsupported ZIP compression method for ${path.basename(name)}.`);
    if (contents.length !== uncompressedSize) throw new Error(`ZIP size check failed for ${path.basename(name)}.`);
    files.push({ name: path.basename(name), buffer: contents });
  }
  return files;
}

function postLocalInvoiceFile(item, facility, sourceRequest) {
  const boundary = `----utility-bulk-${crypto.randomUUID()}`;
  const safeName = String(item.name || "bill.pdf").replace(/["\r\n]/g, "_");
  const chunks = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="facility"\r\n\r\n${facility || ""}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    item.buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ];
  const body = Buffer.concat(chunks);
  return new Promise((resolve, reject) => {
    const headers = {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(body.length)
    };
    if (sourceRequest.headers.cookie) headers.cookie = sourceRequest.headers.cookie;
    if (sourceRequest.headers.authorization) headers.authorization = sourceRequest.headers.authorization;
    const request = http.request({ host: "127.0.0.1", port, path: "/api/upload-invoice", method: "POST", headers }, response => {
      const responseChunks = [];
      response.on("data", chunk => responseChunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(responseChunks).toString("utf8");
        try {
          resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, result: JSON.parse(text) });
        } catch {
          resolve({ ok: false, status: response.statusCode, result: { error: text || `Upload failed with status ${response.statusCode}.` } });
        }
      });
    });
    request.on("error", reject);
    request.end(body);
  });
}

const facilityProfileSeed = await readJson("served-facilities.json", []);

function initDatabase() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY,
      name TEXT,
      facility TEXT,
      vendor TEXT,
      category TEXT,
      status TEXT,
      review_status TEXT,
      risk TEXT,
      owner TEXT,
      share_sync_url TEXT,
      local_file_path TEXT,
      ocr_text_preview TEXT,
      created_at TEXT,
      updated_at TEXT,
      compact_data TEXT,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ocr_jobs (
      id TEXT PRIMARY KEY,
      contract_id TEXT,
      source TEXT,
      share_sync_url TEXT,
      local_file_path TEXT,
      status TEXT,
      error TEXT,
      extracted_text_preview TEXT,
      created_at TEXT,
      updated_at TEXT,
      completed_at TEXT,
      data TEXT NOT NULL,
      FOREIGN KEY (contract_id) REFERENCES contracts(id)
    );
    CREATE TABLE IF NOT EXISTS utility_accounts (
      id TEXT PRIMARY KEY,
      facility TEXT,
      vendor TEXT,
      utility_type TEXT,
      account_number TEXT,
      meter_number TEXT,
      service_address TEXT,
      status TEXT,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vendor_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mailing_address TEXT,
      phone TEXT,
      email TEXT,
      status TEXT,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      name TEXT,
      facility TEXT,
      vendor TEXT,
      invoice_date TEXT,
      total TEXT,
      status TEXT,
      local_file_path TEXT,
      uploaded_file_name TEXT,
      created_at TEXT,
      updated_at TEXT,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      action TEXT,
      entity_type TEXT,
      entity_id TEXT,
      created_at TEXT,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contract_versions (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      action TEXT,
      actor TEXT,
      file_path TEXT,
      share_sync_path TEXT,
      created_at TEXT,
      data TEXT NOT NULL,
      FOREIGN KEY (contract_id) REFERENCES contracts(id)
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      full_name TEXT,
      role TEXT,
      facility TEXT,
      status TEXT,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_name TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT,
      updated_at TEXT,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      task TEXT,
      contract TEXT,
      facility TEXT,
      owner TEXT,
      due TEXT,
      status TEXT,
      priority TEXT,
      created_at TEXT,
      updated_at TEXT,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learning_rules (
      id TEXT PRIMARY KEY,
      label TEXT,
      value TEXT,
      tokens TEXT,
      created_at TEXT,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_contracts_search ON contracts(name, facility, vendor, category, status);
    CREATE INDEX IF NOT EXISTS idx_contracts_created ON contracts(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_contracts_name_sort ON contracts(lower(name), created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_contracts_status_updated ON contracts(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_contracts_review_status ON contracts(review_status, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ocr_jobs_contract ON ocr_jobs(contract_id);
    CREATE INDEX IF NOT EXISTS idx_utility_accounts_match ON utility_accounts(account_number, meter_number, facility, vendor);
    CREATE INDEX IF NOT EXISTS idx_vendor_profiles_name ON vendor_profiles(name);
    CREATE INDEX IF NOT EXISTS idx_invoices_match ON invoices(vendor, facility, invoice_date, status);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_contract_versions_contract ON contract_versions(contract_id, version_number);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username, status, role);
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, due, owner);
    CREATE INDEX IF NOT EXISTS idx_learning_rules_label ON learning_rules(label, value);
    CREATE VIRTUAL TABLE IF NOT EXISTS contracts_fts USING fts5(contract_id UNINDEXED, search_text);
  `);
}

function initializeCompactContractIndex() {
  const columns = new Set(db.prepare("PRAGMA table_info(contracts)").all().map(column => column.name));
  if (!columns.has("compact_data")) db.exec("ALTER TABLE contracts ADD COLUMN compact_data TEXT");
  const pending = db.prepare("SELECT id, data FROM contracts WHERE compact_data IS NULL OR compact_data = ''").all();
  if (!pending.length) return;
  const update = db.prepare("UPDATE contracts SET compact_data = ? WHERE id = ?");
  db.exec("BEGIN");
  try {
    for (const row of pending) {
      try {
        update.run(JSON.stringify(contractCompactSummary(rowToRecord(row))), row.id);
      } catch {
        update.run("{}", row.id);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function contractColumns(contract) {
  return [
    contract.id,
    contract.name || "",
    contract.facility || "",
    contract.vendor || "",
    contract.category || "",
    contract.status || "",
    contract.reviewStatus || "",
    contract.risk || "",
    contract.owner || "",
    contract.shareSyncUrl || "",
    contract.localFilePath || "",
    contract.ocrTextPreview || "",
    contract.createdAt || "",
    contract.updatedAt || "",
    JSON.stringify(contractCompactSummary(contract)),
    JSON.stringify(contract)
  ];
}

function jobColumns(job) {
  return [
    job.id,
    job.contractId || "",
    job.source || "",
    job.shareSyncUrl || "",
    job.localFilePath || "",
    job.status || "",
    job.error || "",
    job.extractedTextPreview || "",
    job.createdAt || "",
    job.updatedAt || "",
    job.completedAt || "",
    JSON.stringify(job)
  ];
}

function utilityAccountColumns(account) {
  return [
    account.id,
    account.facility || "",
    account.vendor || "",
    account.utilityType || "",
    account.accountNumber || "",
    account.meterNumber || "",
    account.serviceAddress || "",
    account.status || "",
    JSON.stringify(account)
  ];
}

function vendorProfileId(name) {
  return `VP-${normalizeMatchValue(name || "vendor") || Date.now()}`;
}

function invoiceColumns(invoice) {
  return [
    invoice.id,
    invoice.name || "",
    invoice.facility || "",
    invoice.vendor || "",
    invoice.invoiceDate || "",
    invoice.total || "",
    invoice.status || "",
    invoice.localFilePath || "",
    invoice.uploadedFileName || "",
    invoice.createdAt || "",
    invoice.updatedAt || "",
    JSON.stringify(invoice)
  ];
}

function auditColumns(entry) {
  return [
    entry.id,
    entry.action || "",
    entry.entityType || "",
    entry.entityId || "",
    entry.createdAt || "",
    JSON.stringify(entry)
  ];
}

function taskColumns(task) {
  return [
    task.id,
    task.task || "",
    task.contract || "",
    task.facility || "",
    task.owner || "",
    task.due || "",
    task.status || "Open",
    task.priority || "Normal",
    task.createdAt || "",
    task.updatedAt || "",
    JSON.stringify(task)
  ];
}

function vendorProfileColumns(profile) {
  return [
    profile.id,
    profile.name || "",
    profile.mailingAddress || "",
    profile.phone || "",
    profile.email || "",
    profile.status || "",
    JSON.stringify(profile)
  ];
}

function userColumns(user) {
  return [
    user.id,
    user.username || "",
    user.fullName || "",
    user.role || "Read Only",
    user.facility || "",
    user.status || "Active",
    user.passwordHash || "",
    user.passwordSalt || "",
    user.createdAt || "",
    user.updatedAt || "",
    JSON.stringify(user)
  ];
}

function rowToRecord(row) {
  return JSON.parse(row.data);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password || ""), salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.passwordSalt) return false;
  const { hash } = hashPassword(password, user.passwordSalt);
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.passwordHash, "hex"));
  } catch {
    return false;
  }
}

function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, passwordSalt, ...safe } = user;
  return safe;
}

function listUsers() {
  return db.prepare("SELECT data FROM users ORDER BY username").all().map(rowToRecord).map(sanitizeUser);
}

function getUserByUsername(username) {
  const row = db.prepare("SELECT data FROM users WHERE lower(username) = lower(?)").get(String(username || "").trim());
  return row ? rowToRecord(row) : null;
}

function saveUser(user) {
  db.prepare(`
    INSERT INTO users (
      id, username, full_name, role, facility, status, password_hash, password_salt, created_at, updated_at, data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      full_name = excluded.full_name,
      role = excluded.role,
      facility = excluded.facility,
      status = excluded.status,
      password_hash = excluded.password_hash,
      password_salt = excluded.password_salt,
      updated_at = excluded.updated_at,
      data = excluded.data
  `).run(...userColumns(user));
  return sanitizeUser(user);
}

function seedAdminUser() {
  if (!authConfigured()) return;
  const existingCount = db.prepare("SELECT COUNT(*) AS count FROM users").get()?.count || 0;
  if (existingCount > 0) return;
  const { salt, hash } = hashPassword(adminPassword);
  const now = new Date().toISOString();
  saveUser({
    id: `USR-${Date.now()}`,
    username: adminUser,
    fullName: "System Admin",
    role: "Admin",
    facility: "All",
    status: "Active",
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: now,
    updatedAt: now
  });
}

function upsertUser(body = {}, actor = "system") {
  const username = String(body.username || "").trim().toLowerCase();
  if (!username) throw new Error("Username is required.");
  const existing = getUserByUsername(username);
  const now = new Date().toISOString();
  let passwordHash = existing?.passwordHash || "";
  let passwordSalt = existing?.passwordSalt || "";
  if (body.password) {
    const hashed = hashPassword(body.password);
    passwordHash = hashed.hash;
    passwordSalt = hashed.salt;
  }
  const hasManualPassword = Boolean(body.password);
  if (!passwordHash || !passwordSalt) {
    const temporary = hashPassword(crypto.randomBytes(24).toString("hex"));
    passwordHash = temporary.hash;
    passwordSalt = temporary.salt;
  }
  const requestedStatus = String(body.status || existing?.status || "Active").trim();
  const user = {
    ...(existing || {}),
    id: existing?.id || `USR-${Date.now()}`,
    username,
    fullName: String(body.fullName || existing?.fullName || "").trim(),
    role: String(body.role || existing?.role || "Read Only").trim(),
    facility: String(body.facility || existing?.facility || "All").trim(),
    responsibilities: Array.isArray(body.responsibilities)
      ? body.responsibilities.map(item => String(item || "").trim()).filter(Boolean)
      : Array.isArray(existing?.responsibilities) ? existing.responsibilities : [],
    status: !existing && !hasManualPassword && requestedStatus === "Active" ? "Invite Pending" : requestedStatus,
    passwordHash,
    passwordSalt,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  const saved = saveUser(user);
  logAudit(existing ? "user_updated" : "user_created", "user", user.username, { username: user.username, role: user.role, facility: user.facility, status: user.status, actor });
  return saved;
}

function deleteUser(username, actor = "system") {
  const user = getUserByUsername(username);
  if (!user) return null;
  db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
  logAudit("user_deleted", "user", user.username, { username: user.username, actor });
  return sanitizeUser(user);
}

function inviteTokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function publicAppOrigin(req) {
  if (appBaseUrl) return appBaseUrl;
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim() || "http";
  const host = req.headers.host || `127.0.0.1:${port}`;
  return `${proto}://${host}`;
}

async function createUserInvite(username, actor = "admin", req = null, options = {}) {
  const user = getUserByUsername(username);
  if (!user) throw new Error("User not found.");
  if (String(user.status || "Active") === "Disabled") throw new Error("Enable this user before sending an invite.");
  const mode = options.mode === "reset" ? "reset" : "invite";
  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 3);
  const next = {
    ...user,
    status: user.status === "Active" ? "Active" : "Invite Pending",
    inviteTokenHash: inviteTokenHash(token),
    inviteCreatedAt: now.toISOString(),
    inviteExpiresAt: expires.toISOString(),
    inviteAcceptedAt: "",
    invitePurpose: mode,
    updatedAt: now.toISOString()
  };
  saveUser(next);
  const inviteUrl = `${publicAppOrigin(req)}?invite=${encodeURIComponent(token)}`;
  logAudit(mode === "reset" ? "password_reset_sent" : "user_invited", "user", user.username, { username: user.username, actor, expiresAt: next.inviteExpiresAt });
  const subject = mode === "reset" ? "Contract Operations password reset" : "Contract Operations access setup";
  const actionText = mode === "reset" ? "password reset" : "access setup";
  const leadText = mode === "reset" ? "A password reset was requested for your Contract Operations account." : "You have been invited to Contract Operations.";
  const emailText = [
    `Hello ${user.fullName || ""}`.trim() + ",",
    "",
    leadText,
    "",
    `Open this secure ${actionText} link while on the company network or VPN:`,
    inviteUrl,
    "",
    "This link expires in 3 days.",
    "",
    "Thank you."
  ].join("\n");
  let email = { configured: false, sent: false, provider: "smtp" };
  try {
    email = await sendSmtpMail({ to: user.username, subject, text: emailText });
  } catch (error) {
    email = { configured: true, sent: false, provider: "smtp", error: error.message };
  }
  return {
    user: sanitizeUser(next),
    inviteUrl,
    expiresAt: next.inviteExpiresAt,
    email,
    mailto: `mailto:${encodeURIComponent(user.username)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailText)}`
  };
}

function findUserByInviteToken(token) {
  const hash = inviteTokenHash(token);
  const users = db.prepare("SELECT data FROM users").all().map(rowToRecord);
  return users.find(user => user.inviteTokenHash && user.inviteTokenHash === hash) || null;
}

function validateUserInvite(token) {
  const user = findUserByInviteToken(token);
  if (!user) throw new Error("Invite link is invalid or already used.");
  if (user.inviteAcceptedAt) throw new Error("Invite link was already used.");
  if (!user.inviteExpiresAt || new Date(user.inviteExpiresAt).getTime() < Date.now()) throw new Error("Invite link expired. Ask an admin to send a new invite.");
  if (String(user.status || "") === "Disabled") throw new Error("This user is disabled.");
  return sanitizeUser(user);
}

async function requestPasswordReset(username, req = null) {
  const user = getUserByUsername(username);
  if (!user || String(user.status || "") === "Disabled") {
    logAudit("password_reset_requested_unknown", "auth", String(username || "unknown"), { username: String(username || "") });
    return { ok: true, message: "If that account exists, a reset link can be sent." };
  }
  const reset = await createUserInvite(user.username, "password-reset", req, { mode: "reset" });
  return {
    ok: true,
    username: user.username,
    email: reset.email,
    mailto: reset.mailto,
    resetUrl: reset.inviteUrl,
    expiresAt: reset.expiresAt
  };
}

function acceptUserInvite(token, password, actor = "invite") {
  const user = findUserByInviteToken(token);
  validateUserInvite(token);
  const cleanPassword = String(password || "");
  if (cleanPassword.length < 8) throw new Error("Password must be at least 8 characters.");
  const hashed = hashPassword(cleanPassword);
  const now = new Date().toISOString();
  const next = {
    ...user,
    status: "Active",
    passwordHash: hashed.hash,
    passwordSalt: hashed.salt,
    inviteTokenHash: "",
    inviteAcceptedAt: now,
    updatedAt: now
  };
  saveUser(next);
  logAudit("user_invite_accepted", "user", next.username, { username: next.username, actor });
  return sanitizeUser(next);
}

function listTasks() {
  return db.prepare("SELECT data FROM tasks ORDER BY due ASC, updated_at DESC").all().map(rowToRecord);
}

function saveTask(task) {
  db.prepare(`
    INSERT INTO tasks (
      id, task, contract, facility, owner, due, status, priority, created_at, updated_at, data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      task = excluded.task,
      contract = excluded.contract,
      facility = excluded.facility,
      owner = excluded.owner,
      due = excluded.due,
      status = excluded.status,
      priority = excluded.priority,
      updated_at = excluded.updated_at,
      data = excluded.data
  `).run(...taskColumns(task));
  return task;
}

function upsertTask(body = {}, actor = "local-user") {
  const now = new Date().toISOString();
  const id = body.id || `TASK-${Date.now()}`;
  const existingRow = db.prepare("SELECT data FROM tasks WHERE id = ?").get(id);
  const existing = existingRow ? rowToRecord(existingRow) : {};
  const task = {
    ...existing,
    id,
    task: String(body.task || existing.task || "").trim(),
    contract: String(body.contract || existing.contract || "").trim(),
    facility: String(body.facility || existing.facility || "").trim(),
    owner: String(body.owner || existing.owner || actor).trim(),
    due: String(body.due || existing.due || "").trim(),
    status: String(body.status || existing.status || "Open").trim(),
    priority: String(body.priority || existing.priority || "Normal").trim(),
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
  if (!task.task) throw new Error("Task name is required.");
  saveTask(task);
  logAudit(existing.id ? "task_updated" : "task_created", "task", task.id, { task: task.task, owner: task.owner, status: task.status });
  return task;
}

function deleteTask(id) {
  const row = db.prepare("SELECT data FROM tasks WHERE id = ?").get(id);
  if (!row) return null;
  const task = rowToRecord(row);
  db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  logAudit("task_deleted", "task", id, { task: task.task });
  return task;
}

function defaultAdminSettings() {
  return {
    shareSyncRoot: "/Contracts/",
    alertSchedule: "90, 60, 30 days",
    emailSender: "contracts@company.com",
    networkAccess: "Company network/VPN only",
    publicInternetAccess: "Blocked",
    categories: [
      "Dialysis / Patient Transfer", "Dental Services", "Medical Director", "Physician Services", "Psychological Services", "Healthcare Services", "Lab / Diagnostics",
      "Electric", "Gas", "Water/Sewer", "Oxygen", "Medical Gas", "Waste Removal", "Grease Trap / Interceptor",
      "Laundry", "Pest Control", "Maintenance", "Elevator", "HVAC", "IT/Software",
      "Internet/Telecom", "Insurance", "Staffing", "Therapy", "Pharmacy",
      "Transportation", "Food/Dietary", "Medical Supplies", "Legal/Compliance", "Other"
    ],
    facilityProfiles: seedFacilityProfiles(),
    hiddenFacilities: [],
    weatherCoordinates: {},
    roles: defaultRoleDefinitions()
  };
}

function defaultRoleDefinitions() {
  return [
    { role: "Admin", canView: "All", canEdit: "All", canApprove: "Yes", admin: "Yes", scope: "All facilities, vendors, finance, reports, users, settings, deletes" },
    { role: "Contract Team", canView: "All contracts", canEdit: "Upload, OCR review, contract fields, builder, tasks", canApprove: "Yes", admin: "No", scope: "Contract intake and approval workflow" },
    { role: "Facility User", canView: "Assigned facility contracts", canEdit: "Notes/tasks for assigned facilities", canApprove: "No", admin: "No", scope: "Facility-specific visibility" },
    { role: "Vendor/Profile User", canView: "Vendors and linked contracts", canEdit: "Vendor cards, contacts, aliases, vendor cleanup", canApprove: "No", admin: "No", scope: "Vendor master data" },
    { role: "Finance User", canView: "Finance, invoices, reports, contract costs", canEdit: "Costs, payment terms, invoice review, finance cleanup", canApprove: "No", admin: "No", scope: "Spend, PPD, cost, invoice matching" },
    { role: "Read Only", canView: "Allowed approved records", canEdit: "No", canApprove: "No", admin: "No", scope: "Search and view only" },
    { role: "Field Reviewer", canView: "Assigned contracts or facilities", canEdit: "Assigned review fields only", canApprove: "No", admin: "No", scope: "Vendor, facility, cost, renewal, insurance, payment fields" }
  ];
}

function seedFacilityProfiles() {
  return (Array.isArray(facilityProfileSeed) ? facilityProfileSeed : [])
    .filter(profile => profile?.name && /[a-z]/i.test(profile.name))
    .map(profile => ({
      ...profile,
      name: String(profile.name || "").trim(),
      beds: Number(profile.beds || 0),
      aliases: mergeTextList(profile.aliases, profile.commonName, profile.legalName, profile.dba, profile.approvedDba, profile.address, profile.cityStateZip, profile.county)
        .filter(alias => /[a-z]/i.test(alias) && canonicalNameKey(alias) !== canonicalNameKey(profile.name))
    }));
}

function mergeFacilityProfilesWithSeed(profiles = []) {
  const byName = new Map();
  for (const profile of seedFacilityProfiles()) {
    byName.set(canonicalNameKey(profile.name), profile);
  }
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    if (!profile?.name || !/[a-z]/i.test(profile.name)) continue;
    const key = canonicalNameKey(profile.name);
    const seed = byName.get(key) || {};
    byName.set(key, {
      ...seed,
      ...profile,
      beds: Number(profile.beds || seed.beds || 0),
      dba: firstUsefulValue(profile.dba, profile.approvedDba, seed.dba, seed.approvedDba),
      legalName: firstUsefulValue(profile.legalName, seed.legalName),
      address: firstUsefulValue(profile.address, seed.address),
      aliases: mergeTextList(seed.aliases, profile.aliases, profile.commonName, profile.legalName, profile.dba, profile.approvedDba, profile.address, seed.commonName, seed.legalName, seed.dba, seed.approvedDba, seed.address)
        .filter(alias => /[a-z]/i.test(alias) && canonicalNameKey(alias) !== key)
    });
  }
  return [...byName.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function getAdminSettings() {
  const row = db.prepare("SELECT data FROM app_settings WHERE key = ?").get("admin");
  const defaults = defaultAdminSettings();
  const settings = { ...defaults, ...(row ? rowToRecord(row) : {}) };
  settings.categories = mergeTextListCanonical(defaults.categories, settings.categories);
  const rolesByKey = new Map();
  for (const role of [...defaultRoleDefinitions(), ...(Array.isArray(settings.roles) ? settings.roles : [])]) {
    if (role?.role) rolesByKey.set(canonicalNameKey(role.role), role);
  }
  settings.roles = [...rolesByKey.values()];
  const profiles = Array.isArray(settings.facilityProfiles) ? settings.facilityProfiles : [];
  const seeded = seedFacilityProfiles();
  const withBeds = profiles.filter(profile => Number(profile?.beds || 0) > 0).length;
  if (seeded.length && withBeds < Math.min(10, seeded.length)) {
    settings.facilityProfiles = mergeFacilityProfilesWithSeed(profiles);
  }
  return settings;
}

function saveAdminSettings(settings = {}) {
  reminderSettings({ ...getAdminSettings(), ...settings });
  const current = getAdminSettings();
  const next = {
    ...current,
    ...settings,
    categories: Array.isArray(settings.categories) ? settings.categories.filter(Boolean) : current.categories,
    facilityProfiles: Array.isArray(settings.facilityProfiles) ? mergeFacilityProfilesWithSeed(settings.facilityProfiles) : current.facilityProfiles,
    hiddenFacilities: Array.isArray(settings.hiddenFacilities) ? settings.hiddenFacilities.filter(Boolean) : current.hiddenFacilities,
    roles: Array.isArray(settings.roles) ? settings.roles.filter(item => item?.role) : current.roles,
    weatherCoordinates: settings.weatherCoordinates && typeof settings.weatherCoordinates === "object" ? settings.weatherCoordinates : current.weatherCoordinates,
    updatedAt: new Date().toISOString()
  };
  db.prepare(`
    INSERT INTO app_settings (key, data, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run("admin", JSON.stringify(next), next.updatedAt);
  invalidateSummaryCache();
  logAudit("admin_settings_saved", "settings", "admin", { updatedAt: next.updatedAt });
  return next;
}

function saveContract(contract) {
  db.prepare(`
    INSERT INTO contracts (
      id, name, facility, vendor, category, status, review_status, risk, owner,
      share_sync_url, local_file_path, ocr_text_preview, created_at, updated_at, compact_data, data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      facility = excluded.facility,
      vendor = excluded.vendor,
      category = excluded.category,
      status = excluded.status,
      review_status = excluded.review_status,
      risk = excluded.risk,
      owner = excluded.owner,
      share_sync_url = excluded.share_sync_url,
      local_file_path = excluded.local_file_path,
      ocr_text_preview = excluded.ocr_text_preview,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      compact_data = excluded.compact_data,
      data = excluded.data
  `).run(...contractColumns(contract));
  indexContractForSearch(contract);
  invalidateSummaryCache();
}

function contractSearchText(contract = {}) {
  return [
    contract.name,
    contract.facility,
    contract.vendor,
    contract.category,
    contract.status,
    contract.reviewStatus,
    contract.contractType,
    contract.agreementType,
    contract.services,
    contract.paymentTerms,
    contract.fee,
    contract.rate,
    contract.terminationClause,
    contract.autoRenewal,
    contract.ocrText,
    contract.ocrTextPreview,
    JSON.stringify(contract.extractedFields || []),
    JSON.stringify(contract.extractedClauses || []),
    JSON.stringify(contract.extractedFeeLines || [])
  ].filter(Boolean).join("\n").slice(0, 200000);
}

function indexContractForSearch(contract = {}) {
  if (!contract.id) return;
  try {
    db.prepare("DELETE FROM contracts_fts WHERE contract_id = ?").run(contract.id);
    db.prepare("INSERT INTO contracts_fts (contract_id, search_text) VALUES (?, ?)").run(contract.id, contractSearchText(contract));
  } catch (error) {
    logAudit("contract_search_index_failed", "contract", contract.id, { name: contract.name, error: error.message });
  }
}

function rebuildContractSearchIndex() {
  db.prepare("DELETE FROM contracts_fts").run();
  for (const contract of allContracts()) indexContractForSearch(contract);
  return db.prepare("SELECT COUNT(*) AS count FROM contracts_fts").get()?.count || 0;
}

function nextContractVersionNumber(contractId) {
  const row = db.prepare("SELECT max(version_number) AS version FROM contract_versions WHERE contract_id = ?").get(contractId);
  return Number(row?.version || 0) + 1;
}

function saveContractVersion(contract = {}, { action = "contract_saved", actor = "local-user", previous = null, note = "" } = {}) {
  if (!contract?.id) return null;
  // Version history tracks structured changes. The original source and full OCR
  // already live on the contract/job, so repeating them on every field save
  // makes the database grow rapidly without adding useful revision history.
  const {
    ocrText: _ocrText,
    fullText: _fullText,
    sourceText: _sourceText,
    documentText: _documentText,
    ...versionSnapshot
  } = contract;
  versionSnapshot.ocrTextPreview = String(contract.ocrTextPreview || contract.ocrText || "").slice(0, 1200);
  const version = {
    id: `VER-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    contractId: contract.id,
    versionNumber: nextContractVersionNumber(contract.id),
    action,
    actor,
    filePath: contract.localFilePath || "",
    shareSyncPath: contract.shareSyncLocalPath || contract.shareSyncFolderPath || "",
    note,
    previous: previous ? {
      name: previous.name,
      facility: previous.facility,
      vendor: previous.vendor,
      category: previous.category,
      status: previous.status,
      updatedAt: previous.updatedAt,
      shareSyncLocalPath: previous.shareSyncLocalPath
    } : null,
    snapshot: versionSnapshot,
    createdAt: new Date().toISOString()
  };
  db.prepare(`
    INSERT INTO contract_versions (id, contract_id, version_number, action, actor, file_path, share_sync_path, created_at, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    version.id,
    version.contractId,
    version.versionNumber,
    version.action,
    version.actor,
    version.filePath,
    version.shareSyncPath,
    version.createdAt,
    JSON.stringify(version)
  );
  return version;
}

function listContractVersions(contractId) {
  return db.prepare("SELECT data FROM contract_versions WHERE contract_id = ? ORDER BY version_number DESC").all(contractId).map(rowToRecord);
}

function uploadedContractFingerprint(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function duplicateContractMatches({ fileHash = "", uploadedFileName = "", shareSyncUrl = "", shareSyncLocalPath = "", localFilePath = "", facility = "", vendor = "", category = "", name = "" } = {}) {
  const cleanFile = normalizeMatchValue(uploadedFileName);
  const cleanShareSync = normalizeMatchValue(shareSyncUrl);
  const cleanShareSyncLocal = normalizeMatchValue(shareSyncLocalPath);
  const cleanLocal = normalizeMatchValue(localFilePath);
  const cleanName = normalizeMatchValue(name);
  return listContracts({ pageSize: 100000 }).records
    .filter(contract => {
      if (fileHash && contract.fileHash === fileHash) return true;
      if (cleanShareSync && normalizeMatchValue(contract.shareSyncUrl) === cleanShareSync) return true;
      if (cleanShareSyncLocal && normalizeMatchValue(contract.shareSyncLocalPath || contract.localFilePath) === cleanShareSyncLocal) return true;
      if (cleanLocal && normalizeMatchValue(contract.localFilePath || contract.shareSyncLocalPath) === cleanLocal) return true;
      if (cleanFile && normalizeMatchValue(contract.uploadedFileName) === cleanFile) return true;
      if (cleanName && normalizeMatchValue(contract.name) === cleanName) {
        const sameBusinessRecord = normalizeMatchValue(contract.facility) === normalizeMatchValue(facility)
          && normalizeMatchValue(contract.vendor) === normalizeMatchValue(vendor)
          && normalizeMatchValue(contract.category) === normalizeMatchValue(category);
        if (sameBusinessRecord) return true;
      }
      return false;
    })
    .slice(0, 5);
}

function learningRuleTokens(...values) {
  const stop = new Set(["agreement", "contract", "service", "services", "shall", "will", "with", "from", "this", "that", "the", "and", "for", "per", "fee", "rate", "term", "payment"]);
  return [...new Set(values.join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(token => (token.length >= 3 || /^\d{2,3}$/.test(token)) && !stop.has(token))
  )].slice(0, 12);
}

function saveLearningRule(rule) {
  const now = new Date().toISOString();
  const next = {
    id: rule.id || `LR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label: String(rule.label || "").trim(),
    value: String(rule.value || "").trim(),
    tokens: Array.isArray(rule.tokens) ? rule.tokens : learningRuleTokens(rule.value, rule.snippet, rule.sourceText),
    snippet: String(rule.snippet || "").trim().slice(0, 1000),
    originalValue: String(rule.originalValue || "").trim().slice(0, 500),
    contractType: String(rule.contractType || "").trim().slice(0, 200),
    vendor: String(rule.vendor || "").trim().slice(0, 200),
    facility: String(rule.facility || "").trim().slice(0, 200),
    category: String(rule.category || "").trim().slice(0, 200),
    learnedFrom: String(rule.learnedFrom || "review").trim().slice(0, 80),
    contractId: rule.contractId || "",
    contractName: rule.contractName || "",
    createdAt: rule.createdAt || now,
    updatedAt: now
  };
  if (!next.label || !next.value || !next.tokens.length) return null;
  db.prepare(`
    INSERT INTO learning_rules (id, label, value, tokens, created_at, data)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET label = excluded.label, value = excluded.value, tokens = excluded.tokens, data = excluded.data
  `).run(next.id, next.label, next.value, next.tokens.join(" "), next.createdAt, JSON.stringify(next));
  return next;
}

function listLearningRules() {
  return db.prepare("SELECT data FROM learning_rules ORDER BY created_at DESC").all().map(rowToRecord);
}

function learningRuleExists(label, value, contractId = "") {
  const cleanLabel = String(label || "").trim().toLowerCase();
  const cleanValue = String(value || "").trim().toLowerCase();
  if (!cleanLabel || !cleanValue) return true;
  return listLearningRules().some(rule =>
    String(rule.label || "").trim().toLowerCase() === cleanLabel
    && String(rule.value || "").trim().toLowerCase() === cleanValue
    && (!contractId || !rule.contractId || rule.contractId === contractId)
  );
}

function saveLearningRuleIfNew(rule) {
  if (learningRuleExists(rule.label, rule.value, rule.contractId)) return null;
  return saveLearningRule(rule);
}

function saveAutomaticLearningFromReview(contract, fields = [], feeLines = []) {
  const sourceText = contract?.ocrText || "";
  const saved = [];
  for (const field of fields || []) {
    const label = String(field?.label || "").trim();
    const value = String(field?.value || "").trim();
    if (!label || !value) continue;
    if (/^(source|confidence|status)$/i.test(label)) continue;
    const rule = saveLearningRuleIfNew({
      label,
      value,
      originalValue: field.originalValue || field.ocrValue || "",
      snippet: field.snippet || field.source || "",
      sourceText,
      contractId: contract?.id || "",
      contractName: contract?.name || "",
      contractType: fieldValue(contract?.approvedFields || contract?.extractedFields || [], "Contract Type") || contract?.agreementType || contract?.category || "",
      vendor: contract?.vendor || "",
      facility: contract?.facility || "",
      category: contract?.category || "",
      learnedFrom: field.approvedBy || "review-field-save"
    });
    if (rule) saved.push(rule);
  }
  for (const line of feeLines || []) {
    const rate = String(line?.rate || "").trim();
    if (!rate) continue;
    const value = [line.service || "Fee", rate, line.unit, line.frequency].filter(Boolean).join(" | ");
    const rule = saveLearningRuleIfNew({
      label: "Fee Line",
      value,
      snippet: line.source || "",
      sourceText,
      contractId: contract?.id || "",
      contractName: contract?.name || ""
    });
    if (rule) saved.push(rule);
  }
  return saved;
}

const contractKeyFieldAliases = [
  { label: "Facility", aliases: ["facility"] },
  { label: "Category", aliases: ["category", "contract type", "agreement type", "service type", "services"] },
  { label: "Vendor", aliases: ["vendor", "vendor name", "provider", "contractor", "supplier"] },
  { label: "Contract Status", aliases: ["contract status", "status"] },
  { label: "Start of Services", aliases: ["start of services", "start date", "effective date", "service start date", "commencement date"] },
  { label: "Initial Contract Length", aliases: ["initial contract length", "contract length", "contract term", "term"] },
  { label: "End Date", aliases: ["end date", "expiration date", "expires"] },
  { label: "Termination", aliases: ["termination", "termination rights", "how to terminate"] },
  { label: "Notice Period", aliases: ["notice period", "termination notice", "required notice days"] },
  { label: "Auto Renewal", aliases: ["auto renewal", "auto-renewal", "automatic renewal", "auto renew"] },
  { label: "Payment Terms", aliases: ["payment terms"] },
  { label: "Days Payable", aliases: ["days payable"] },
  { label: "Fee", aliases: ["fee", "fees", "cost", "rate / fee", "contract value", "contract amount", "contract price", "amount", "charge", "charges", "rate", "rates", "price", "pricing", "service charge", "service charges", "service fee", "service fees", "annual cost", "annual charge"] },
  { label: "Monthly Cost", aliases: ["monthly cost", "monthly charge", "mrc"] },
  { label: "Annual Spend", aliases: ["annual spend", "annual cost", "annual charge", "annualized spend", "total annual spend"] },
  { label: "Quantity of Services", aliases: ["quantity of services", "service quantity", "quantity", "units", "square feet", "sq ft", "miles", "trips", "pickups", "boxes", "containers", "tests", "meals", "sessions"] },
  { label: "Billing Frequency", aliases: ["billing frequency", "billing cycle", "frequency", "recurring"] },
  { label: "Vendor Contact", aliases: ["vendor contact", "account manager", "billing contact"] },
  { label: "Vendor Email", aliases: ["vendor email"] },
  { label: "Vendor Phone", aliases: ["vendor phone"] },
  { label: "Insurance Requirement", aliases: ["insurance requirement"] }
];

function canonicalContractKeyLabel(label = "") {
  const normalized = String(label || "").trim().toLowerCase();
  const match = contractKeyFieldAliases.find(item => item.aliases.includes(normalized));
  return match ? match.label : String(label || "").trim();
}

function isContractKeyLabel(label = "") {
  return contractKeyFieldAliases.some(item => item.label.toLowerCase() === canonicalContractKeyLabel(label).toLowerCase());
}

function findContractKeyField(fields, label) {
  const canonical = canonicalContractKeyLabel(label).toLowerCase();
  return (fields || []).find(field => canonicalContractKeyLabel(field.label).toLowerCase() === canonical);
}

function isBadKeyFieldValue(label, value, source = "") {
  const canonical = canonicalContractKeyLabel(label).toLowerCase();
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const combined = `${text} ${source || ""}`.toLowerCase();
  if (!text || /^(needs review|needs classification|unknown|not found|tbd|n\/a|na)$/i.test(text)) return true;
  if (text.length > 35 && /^[a-z]\.?\s+/i.test(text)) return true;
  if (text.length > 80 && /\b(in the event|whereas|provided that|subject to|pursuant to|notwithstanding|confidential|financial information|agreements|billing|requires|determines)\b/i.test(text)) return true;
  if ((canonical === "fee" || canonical === "monthly cost") && /\b(insurance|liability|claim|occurrence|aggregate|additional insured|for example|sample|hypothetical)\b/i.test(combined)) return true;
  if (canonical === "category" && !categorySupportedByContractText(text, source || "")) return true;
  if (canonical === "payment terms" && !cleanPaymentTermsValue(text)) return true;
  if (canonical === "days payable") {
    const days = Number((text.match(/\d{1,3}/) || [])[0] || 0);
    if (!days || days > 120 || days === 106) return true;
  }
  if (canonical === "vendor" && !isLikelyVendorCandidate(text)) return true;
  if (["category", "initial contract length", "quantity of services"].includes(canonical) && text.length > 120) return true;
  if (canonical === "vendor contact" && /^(billing contact|primary contact|technical contact|contracts?)$/i.test(text)) return true;
  return false;
}

function reviewCostValueIsUsable(value, source = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const combined = `${text} ${source || ""}`;
  if (!text || /^(needs review|needs classification|unknown|not found|tbd|n\/a|na|none|\.)$/i.test(text)) return false;
  if (/\b(insurance|liability|claim|occurrence|aggregate|additional insured|policy|coverage|deductible)\b/i.test(combined)) return false;
  if (/\b(no charge|no cost|zero charge|included at no additional cost|included free|free of charge|not charged)\b/i.test(combined)) return true;
  return /(\$\s*\d|\b\d+(?:\.\d+)?\s*%|\b(?:percent|fee schedule|rate schedule|pricing schedule|price list|fee|rate|charge|cost|price|pricing|monthly|annual|annually|minimum|surcharge|flat fee|hourly|daily|weekly|quarterly|per month|per day|per mile|per visit|per square foot|per sq ft|per linear foot|per pickup|per trip|per load|per test|per box|per container|per meal|per session|per service call|per unit|per delivery|per gallon|per hour|per bed|per resident day|per patient day|per diem|ppd)\b)/i.test(combined);
}

function needsManualReviewMessage(label = "") {
  const canonical = canonicalContractKeyLabel(label);
  return `${canonical || "Field"} was not confidently found. Type the correct value, save it, and the app will learn for next time.`;
}

function normalizeMainContractKeys(fields, text) {
  const next = [];
  for (const field of fields || []) {
    const canonical = canonicalContractKeyLabel(field.label);
    const normalized = { ...field, label: canonical };
    if (isContractKeyLabel(canonical) && isBadKeyFieldValue(canonical, normalized.value, normalized.snippet || normalized.source)) {
      normalized.value = "";
      normalized.confidence = 0;
      normalized.source = needsManualReviewMessage(canonical);
      normalized.snippet = "";
    }
    const existing = findContractKeyField(next, canonical);
    if (!existing) {
      next.push(normalized);
    } else if (Number(normalized.confidence || 0) >= Number(existing.confidence || 0)) {
      Object.assign(existing, normalized);
    }
  }
  const clean = cleanOcrText(text);
  for (const definition of contractKeyFieldAliases) {
    if (findContractKeyField(next, definition.label)) continue;
    next.push(extractedField(
      definition.label,
      "",
      0,
      "Not found in OCR. Review and fill manually if this contract has it.",
      snippetAround(clean, 0, 120)
    ));
  }
  return next;
}

function applyLearningRules(fields, text) {
  const rules = listLearningRules();
  if (!rules.length) return normalizeMainContractKeys(fields, text);
  const cleanText = normalizeNameForMatch(text);
  const sourceText = cleanOcrText(text);
  const next = [...fields];
  const candidates = new Map();
  const containsWords = (haystack, needle) => {
    const words = normalizeNameForMatch(needle).trim();
    return Boolean(words) && ` ${haystack} `.includes(` ${words} `);
  };
  const supportCounts = new Map();
  for (const rule of rules) {
    const key = `${canonicalContractKeyLabel(rule.label).toLowerCase()}|${normalizeNameForMatch(rule.value)}`;
    if (!key.endsWith("|")) {
      const examples = supportCounts.get(key) || new Set();
      if (rule.contractId) examples.add(rule.contractId);
      supportCounts.set(key, examples);
    }
  }
  for (const rule of rules) {
    const tokens = [...new Set((Array.isArray(rule.tokens) ? rule.tokens : [])
      .filter(token => typeof token === "string")
      .map(token => normalizeNameForMatch(token).trim()).filter(Boolean))];
    const hits = tokens.filter(token => containsWords(cleanText, token)).length;
    const enough = tokens.length <= 2 ? hits === tokens.length : hits >= Math.min(3, tokens.length);
    if (!tokens.length || !enough) continue;
    if (!isContractKeyLabel(rule.label)) continue;
    if (isBadKeyFieldValue(rule.label, rule.value, rule.snippet)) continue;
    const canonical = canonicalContractKeyLabel(rule.label).toLowerCase();
    const exactValueInThisContract = containsWords(cleanText, rule.value);
    const exactSourceInThisContract = rule.snippet && containsWords(cleanText, rule.snippet);
    if (!exactValueInThisContract) continue;
    const existing = findContractKeyField(next, rule.label);
    if (existing?.value || existing?.approved) continue;
    // Status is time-sensitive; never inherit it from another contract.
    const safeAutoLabels = new Set(["vendor", "facility", "category"]);
    if (!safeAutoLabels.has(canonical)) continue;
    const values = candidates.get(canonical) || new Map();
    values.set(normalizeNameForMatch(rule.value), { rule, tokens, exactSourceInThisContract });
    candidates.set(canonical, values);
  }
  for (const [canonical, values] of candidates) {
    // Multiple supported values need a person to resolve, not rule-order precedence.
    if (values.size !== 1) continue;
    const { rule, tokens, exactSourceInThisContract } = values.values().next().value;
    const supportKey = `${canonical}|${normalizeNameForMatch(rule.value)}`;
    const supportCount = supportCounts.get(supportKey)?.size || 1;
    const provenSnippet = exactSourceInThisContract
      ? rule.snippet
      : snippetAround(sourceText, sourceText.toLowerCase().indexOf(String(rule.value || "").toLowerCase()), 260);
    const confidence = supportCount >= 3 ? 88 : 62;
    const source = supportCount >= 3
      ? `Suggested from ${supportCount} prior contracts and found in this contract. Verify source before approval.`
      : "Suggested from prior correction and found in this contract. Verify source before approval.";
    addOrUpgradeField(next, rule.label, rule.value, confidence, source, provenSnippet || rule.snippet || tokens.join(", "));
  }
  return normalizeMainContractKeys(next, text);
}

function saveOcrJob(job) {
  db.prepare(`
    INSERT INTO ocr_jobs (
      id, contract_id, source, share_sync_url, local_file_path, status, error,
      extracted_text_preview, created_at, updated_at, completed_at, data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      contract_id = excluded.contract_id,
      source = excluded.source,
      share_sync_url = excluded.share_sync_url,
      local_file_path = excluded.local_file_path,
      status = excluded.status,
      error = excluded.error,
      extracted_text_preview = excluded.extracted_text_preview,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      completed_at = excluded.completed_at,
      data = excluded.data
  `).run(...jobColumns(job));
}

function saveUtilityAccount(account) {
  db.prepare(`
    INSERT INTO utility_accounts (
      id, facility, vendor, utility_type, account_number, meter_number,
      service_address, status, data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      facility = excluded.facility,
      vendor = excluded.vendor,
      utility_type = excluded.utility_type,
      account_number = excluded.account_number,
      meter_number = excluded.meter_number,
      service_address = excluded.service_address,
      status = excluded.status,
      data = excluded.data
  `).run(...utilityAccountColumns(account));
}

function saveVendorProfile(profile) {
  db.prepare(`
    INSERT INTO vendor_profiles (
      id, name, mailing_address, phone, email, status, data
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      mailing_address = excluded.mailing_address,
      phone = excluded.phone,
      email = excluded.email,
      status = excluded.status,
      data = excluded.data
  `).run(...vendorProfileColumns(profile));
}

function saveInvoice(invoice) {
  db.prepare(`
    INSERT INTO invoices (
      id, name, facility, vendor, invoice_date, total, status,
      local_file_path, uploaded_file_name, created_at, updated_at, data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      facility = excluded.facility,
      vendor = excluded.vendor,
      invoice_date = excluded.invoice_date,
      total = excluded.total,
      status = excluded.status,
      local_file_path = excluded.local_file_path,
      uploaded_file_name = excluded.uploaded_file_name,
      updated_at = excluded.updated_at,
      data = excluded.data
  `).run(...invoiceColumns(invoice));
}

function saveAuditLog(entry) {
  db.prepare(`
    INSERT INTO audit_logs (
      id, action, entity_type, entity_id, created_at, data
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(...auditColumns(entry));
}

function logAudit(action, entityType, entityId, details = {}) {
  const entry = {
    id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    entityType,
    entityId,
    details,
    actor: "local-user",
    createdAt: new Date().toISOString()
  };
  saveAuditLog(entry);
  return entry;
}

function getContract(id) {
  const row = db.prepare("SELECT data FROM contracts WHERE id = ?").get(id);
  return row ? rowToRecord(row) : null;
}

function getOcrJobsForContract(contractId) {
  return db.prepare("SELECT data FROM ocr_jobs WHERE contract_id = ?").all(contractId).map(rowToRecord);
}

function getOcrJob(id) {
  const row = db.prepare("SELECT data FROM ocr_jobs WHERE id = ?").get(id);
  return row ? rowToRecord(row) : null;
}

function ocrJobListSummary(job = {}, contract = null, { lean = false } = {}) {
  const textPreview = lean ? "" : String(job.extractedTextPreview || job.extractedText || "").slice(0, 1200);
  const fields = lean ? [] : (Array.isArray(job.extractedFields) ? job.extractedFields : []).slice(0, 40).map(field => ({
    label: field?.label || "",
    value: field?.value || "",
    confidence: field?.confidence || 0,
    approved: Boolean(field?.approved),
    source: String(field?.source || "").slice(0, 180),
    snippet: String(field?.snippet || field?.context || "").slice(0, 220)
  }));
  const clauses = lean ? [] : (Array.isArray(job.extractedClauses) ? job.extractedClauses : []).slice(0, 5).map(clause => ({
    type: clause?.type || "",
    risk: clause?.risk || "",
    snippet: String(clause?.snippet || "").slice(0, 220)
  }));
  const feeLines = lean ? [] : (Array.isArray(job.extractedFeeLines) ? job.extractedFeeLines : []).slice(0, 10).map(line => ({
    service: line?.service || "",
    unit: line?.unit || "",
    rate: line?.rate || "",
    frequency: line?.frequency || "",
    approved: Boolean(line?.approved),
    source: String(line?.source || line?.snippet || "").slice(0, 220)
  }));
  return {
    id: job.id,
    contractId: job.contractId || "",
    name: job.name || contract?.name || "",
    fileName: job.fileName || "",
    uploadedFileName: job.uploadedFileName || "",
    source: job.source || "",
    shareSyncUrl: job.shareSyncUrl || "",
    localFilePath: job.localFilePath || "",
    documentType: job.documentType || contract?.documentType || "Contract",
    status: job.status || "",
    reviewStatus: job.reviewStatus || contract?.reviewStatus || "",
    error: job.error || "",
    progress: job.progress || null,
    createdAt: job.createdAt || "",
    updatedAt: job.updatedAt || "",
    completedAt: job.completedAt || "",
    aiAgentReview: job.aiAgentReview ? {
      status: job.aiAgentReview.status || "",
      score: job.aiAgentReview.score || 0,
      message: job.aiAgentReview.message || "",
      missing: Array.isArray(job.aiAgentReview.missing) ? job.aiAgentReview.missing.slice(0, 12) : []
    } : null,
    relatedDocument: job.relatedDocument ? {
      detected: Boolean(job.relatedDocument.detected),
      type: job.relatedDocument.type || "",
      parentContractId: job.relatedDocument.parentContractId || "",
      parentContractName: job.relatedDocument.parentContractName || "",
      matchConfidence: job.relatedDocument.matchConfidence || 0
    } : null,
    extractedText: "",
    extractedTextPreview: textPreview,
    extractedFields: fields,
    extractedClauses: clauses.slice(0, 10),
    extractedFeeLines: feeLines.slice(0, 25),
    fullTextAvailable: Boolean(job.extractedText || contract?.ocrText),
    extractedTextLength: String(job.extractedText || contract?.ocrText || "").length
  };
}

function listOcrJobs({ full = false, limit = 0, page = 0, pageSize = 0, lean = false } = {}) {
  const safeLimit = Math.max(0, Math.min(Number(limit) || 0, 500));
  const safePageSize = Math.max(0, Math.min(Number(pageSize) || 0, 100));
  const safePage = Math.max(1, Number(page) || 1);
  const rows = safePageSize
    ? db.prepare("SELECT data FROM ocr_jobs ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?").all(safePageSize, (safePage - 1) * safePageSize)
    : safeLimit
      ? db.prepare("SELECT data FROM ocr_jobs ORDER BY created_at DESC, id DESC LIMIT ?").all(safeLimit)
      : db.prepare("SELECT data FROM ocr_jobs ORDER BY created_at DESC, id DESC").all();
  const records = rows.map(row => {
    const job = rowToRecord(row);
    const contract = job.contractId ? getContract(job.contractId) : null;
    const fileName = job.uploadedFileName
      || contract?.uploadedFileName
      || (job.localFilePath ? path.basename(job.localFilePath).replace(/^UP-\d+-/, "") : "");
    const record = {
      ...job,
      name: contract?.name || job.name || fileName || job.id,
      fileName: job.fileName || fileName,
      uploadedFileName: job.uploadedFileName || fileName
    };
    return full ? record : ocrJobListSummary(record, contract, { lean });
  });
  if (safePageSize) {
    const total = db.prepare("SELECT COUNT(*) AS count FROM ocr_jobs").get()?.count || 0;
    return { total, page: safePage, pageSize: safePageSize, records };
  }
  return records;
}

function listUtilityAccounts() {
  return db.prepare("SELECT data FROM utility_accounts ORDER BY facility, vendor, account_number").all().map(rowToRecord);
}

function listVendorProfiles() {
  const merged = new Map();
  for (const profile of db.prepare("SELECT data FROM vendor_profiles ORDER BY name").all().map(rowToRecord)) {
    const key = canonicalNameKey(profile.name || profile.legalName || profile.dba);
    if (!key) continue;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...profile,
        aliases: mergeTextList(profile.aliases, profile.dba, profile.legalName).filter(alias => canonicalNameKey(alias) !== key)
      });
      continue;
    }
    merged.set(key, {
      ...existing,
      legalName: firstUsefulValue(existing.legalName, profile.legalName, profile.name),
      dba: firstUsefulValue(existing.dba, profile.dba),
      category: firstUsefulValue(existing.category, profile.category),
      mailingAddress: firstUsefulValue(existing.mailingAddress, profile.mailingAddress),
      remitAddress: firstUsefulValue(existing.remitAddress, profile.remitAddress),
      primaryContact: firstUsefulValue(existing.primaryContact, profile.primaryContact),
      phone: firstUsefulValue(existing.phone, profile.phone),
      email: firstUsefulValue(existing.email, profile.email),
      website: firstUsefulValue(existing.website, profile.website),
      taxId: firstUsefulValue(existing.taxId, profile.taxId),
      paymentTerms: firstUsefulValue(existing.paymentTerms, profile.paymentTerms),
      insuranceStatus: firstUsefulValue(existing.insuranceStatus, profile.insuranceStatus),
      status: firstUsefulValue(existing.status, profile.status),
      aliases: mergeTextList(existing.aliases, profile.aliases, profile.name, profile.legalName, profile.dba).filter(alias => canonicalNameKey(alias) !== key)
    });
  }
  return [...merged.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function deleteVendorProfile(idOrName) {
  const target = decodeURIComponent(String(idOrName || ""));
  const profile = listVendorProfiles().find(item => item.id === target || normalizeMatchValue(item.name) === normalizeMatchValue(target));
  if (!profile) return null;
  db.prepare("DELETE FROM vendor_profiles WHERE id = ?").run(profile.id);
  return profile;
}

function deleteUtilityAccount(id) {
  const account = listUtilityAccounts().find(item => item.id === id);
  if (!account) return null;
  db.prepare("DELETE FROM utility_accounts WHERE id = ?").run(id);
  return account;
}

function listInvoices() {
  return db.prepare("SELECT data FROM invoices ORDER BY created_at DESC, id DESC").all().map(rowToRecord);
}

function listAuditLogs() {
  return db.prepare("SELECT data FROM audit_logs ORDER BY created_at DESC LIMIT 250").all().map(rowToRecord);
}

function contractListSummary(contract = {}) {
  const fieldValue = label => {
    const field = Array.isArray(contract.extractedFields)
      ? contract.extractedFields.find(item => normalizeMatchValue(item.label) === normalizeMatchValue(label))
      : null;
    return field?.value || "";
  };
  const firstFieldValue = labels => {
    for (const label of labels) {
      const value = fieldValue(label);
      if (hasUsefulContractValue(value)) return value;
    }
    return "";
  };
  const savedCost = firstFieldValue([
    "Cost",
    "Fee",
    "Fees",
    "Rate / Fee",
    "Rate",
    "Rates",
    "Service Charge",
    "Service Charges",
    "Service Fee",
    "Service Fees",
    "Contract Value",
    "Contract Amount",
    "Monthly Cost",
    "Monthly Charge",
    "Monthly Recurring Charge",
    "Annual Cost",
    "Annual Spend",
    "Pricing",
    "Service Pricing Detail"
  ]);
  return {
    id: contract.id,
    name: contract.name || contract.uploadedFileName || "Untitled contract",
    facility: contract.facility || fieldValue("Facility") || "Needs Classification",
    vendor: contract.vendor || fieldValue("Vendor") || "Needs Classification",
    vendorHintFromFileName: contract.vendorHintFromFileName || "",
    category: contract.category || contract.services || fieldValue("Category") || "Needs Classification",
    services: contract.services || contract.category || fieldValue("Service Type") || "",
    documentType: contract.documentType || "Contract",
    status: contract.status || "Needs Review",
    contractStatus: contract.contractStatus || contract.status || "Needs Review",
    reviewStatus: contract.reviewStatus || "Pending",
    owner: contract.owner || "Contract Dept",
    createdAt: contract.createdAt || "",
    updatedAt: contract.updatedAt || "",
    localFilePath: contract.localFilePath || "",
    uploadedFileName: contract.uploadedFileName || "",
    shareSyncUrl: contract.shareSyncUrl || "",
    shareSyncLocalPath: contract.shareSyncLocalPath || "",
    shareSyncFolderPath: contract.shareSyncFolderPath || "",
    shareSyncCopies: Array.isArray(contract.shareSyncCopies) ? contract.shareSyncCopies : [],
    fileHash: contract.fileHash || "",
    duplicateWarning: contract.duplicateWarning || null,
    start: contract.start || "",
    startOfServices: contract.startOfServices || fieldValue("Start of Services") || "",
    signatureDate: contract.signatureDate || fieldValue("Signature Date") || "",
    signedDate: contract.signedDate || "",
    end: contract.end || fieldValue("End Date") || "",
    renewal: contract.renewal || "",
    autoRenewal: contract.autoRenewal || fieldValue("Auto Renewal") || "Unknown",
    initialContractLength: contract.initialContractLength || fieldValue("Initial Contract Length") || "",
    termination: contract.termination || fieldValue("Termination") || "",
    terminationClause: contract.terminationClause || contract.noticePeriod || "",
    noticePeriod: contract.noticePeriod || fieldValue("Notice Period") || "",
    paymentTerms: contract.paymentTerms || fieldValue("Payment Terms") || "",
    daysPayable: contract.daysPayable || fieldValue("Days Payable") || "",
    fee: contract.fee || savedCost || "",
    rate: contract.rate || firstFieldValue(["Rate", "Rate / Fee", "Unit Rate", "Service Rate"]) || "",
    spend: contract.spend || "",
    monthlyCost: contract.monthlyCost || firstFieldValue(["Monthly Cost", "Monthly Charge", "Monthly Recurring Charge"]) || "",
    annualCost: contract.annualCost || firstFieldValue(["Annual Cost", "Annual Spend", "Annual Charge", "Annualized Spend"]) || "",
    costBedMonth: contract.costBedMonth || fieldValue("Cost Bed/Month") || "",
    quantityOfServices: contract.quantityOfServices || fieldValue("Quantity of Services") || "",
    insuranceRequirement: contract.insuranceRequirement || fieldValue("Insurance Requirement") || "",
    risk: contract.risk || "Medium",
    agreementType: contract.agreementType || contract.contractType || "",
    vendorMailingAddress: contract.vendorMailingAddress || contract.vendorAddress || "",
    vendorPhone: contract.vendorPhone || "",
    vendorEmail: contract.vendorEmail || "",
    relatedDocuments: Array.isArray(contract.relatedDocuments) ? contract.relatedDocuments.map(item => ({
      id: item.id,
      name: item.name,
      type: item.type,
      status: item.status,
      matchConfidence: item.matchConfidence
    })) : [],
    extractedFieldsCount: Array.isArray(contract.extractedFields) ? contract.extractedFields.length : 0,
    extractedFeeLinesCount: Array.isArray(contract.extractedFeeLines) ? contract.extractedFeeLines.length : 0,
    extractedClausesCount: Array.isArray(contract.extractedClauses) ? contract.extractedClauses.length : 0,
    ocrTextPreview: String(contract.ocrTextPreview || contract.ocrText || "").slice(0, 1200)
  };
}

function contractCompactSummary(contract = {}) {
  const summary = contractListSummary(contract);
  delete summary.relatedDocuments;
  delete summary.ocrTextPreview;
  delete summary.shareSyncCopies;
  return summary;
}

function reviewQueueSummary(contract = {}) {
  const summary = contractCompactSummary(contract);
  return {
    id: summary.id,
    name: summary.name,
    facility: summary.facility,
    vendor: summary.vendor,
    vendorHintFromFileName: summary.vendorHintFromFileName,
    category: summary.category,
    services: summary.services,
    documentType: summary.documentType,
    status: summary.status,
    contractStatus: summary.contractStatus,
    reviewStatus: summary.reviewStatus,
    owner: summary.owner,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    start: summary.start,
    startOfServices: summary.startOfServices,
    end: summary.end,
    autoRenewal: summary.autoRenewal,
    initialContractLength: summary.initialContractLength,
    termination: summary.termination,
    terminationClause: summary.terminationClause,
    noticePeriod: summary.noticePeriod,
    paymentTerms: summary.paymentTerms,
    daysPayable: summary.daysPayable,
    fee: summary.fee,
    rate: summary.rate,
    monthlyCost: summary.monthlyCost,
    annualCost: summary.annualCost,
    risk: summary.risk,
    extractedFieldsCount: summary.extractedFieldsCount,
    extractedFeeLinesCount: summary.extractedFeeLinesCount,
    extractedClausesCount: summary.extractedClausesCount
  };
}

function listContracts({ q = "", page = 1, pageSize = 25, full = false, compact = false, sort = "newest" } = {}) {
  const rawQuery = String(q || "").trim();
  const hasQuery = Boolean(rawQuery);
  const offset = (page - 1) * pageSize;
  const sortMode = String(sort || "").toLowerCase();
  const orderBy = sortMode === "name"
    ? "lower(coalesce(name, '')) ASC, created_at DESC, id DESC"
    : "created_at DESC, id DESC";
  const ftsOrderBy = sortMode === "name"
    ? "lower(coalesce(c.name, '')) ASC, c.created_at DESC, c.id DESC"
    : "c.updated_at DESC, c.created_at DESC, c.id DESC";
  if (hasQuery) {
    const terms = rawQuery
      .replace(/["']/g, " ")
      .split(/\s+/)
      .map(term => term.replace(/[^a-zA-Z0-9_-]/g, ""))
      .filter(term => term.length >= 2)
      .slice(0, 12);
    const ftsQuery = terms.length ? terms.map(term => `${term}*`).join(" ") : "";
    if (ftsQuery) {
      try {
        const total = db.prepare(`
          SELECT COUNT(DISTINCT c.id) AS total
          FROM contracts c
          JOIN (SELECT contract_id FROM contracts_fts WHERE contracts_fts MATCH ?) f ON f.contract_id = c.id
        `).get(ftsQuery).total;
        const rows = db.prepare(`
          SELECT ${compact && !full ? "coalesce(c.compact_data, c.data) AS data" : "c.data"}
          FROM contracts c
          JOIN (SELECT contract_id FROM contracts_fts WHERE contracts_fts MATCH ?) f ON f.contract_id = c.id
          GROUP BY c.id
          ORDER BY ${ftsOrderBy}
          LIMIT ? OFFSET ?
        `).all(ftsQuery, pageSize, offset);
        const records = rows.map(rowToRecord);
        return { total, page, pageSize, records: full ? records : records.map(compact ? contractCompactSummary : contractListSummary), searchEngine: "sqlite-fts5" };
      } catch {
        // Fall through to LIKE search if the query cannot be parsed by FTS.
      }
    }
  }
  const query = `%${rawQuery.toLowerCase()}%`;
  const where = hasQuery
    ? `WHERE lower(coalesce(name, '') || ' ' || coalesce(facility, '') || ' ' || coalesce(vendor, '') || ' ' || coalesce(category, '') || ' ' || coalesce(status, '')) LIKE ?`
    : "";
  const total = hasQuery
    ? db.prepare(`SELECT COUNT(*) AS total FROM contracts ${where}`).get(query).total
    : db.prepare("SELECT COUNT(*) AS total FROM contracts").get().total;
  const rows = hasQuery
    ? db.prepare(`SELECT ${compact && !full ? "coalesce(compact_data, data) AS data" : "data"} FROM contracts ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(query, pageSize, offset)
    : db.prepare(`SELECT ${compact && !full ? "coalesce(compact_data, data) AS data" : "data"} FROM contracts ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(pageSize, offset);
  const records = rows.map(rowToRecord);
  return { total, page, pageSize, records: full ? records : records.map(compact ? contractCompactSummary : contractListSummary) };
}

async function deleteContract(id) {
  const contract = getContract(id);
  if (!contract) return null;
  const jobs = getOcrJobsForContract(id);
  db.prepare("DELETE FROM ocr_jobs WHERE contract_id = ?").run(id);
  db.prepare("DELETE FROM contracts WHERE id = ?").run(id);
  invalidateSummaryCache();
  logAudit("contract_record_deleted", "contract", id, {
    name: contract.name || "",
    deletedJobs: jobs.length,
    filePreserved: true,
    localFilePath: contract.localFilePath || "",
    shareSyncLocalPath: contract.shareSyncLocalPath || ""
  });
  return { contract, deletedJobs: jobs.length, deletedFiles: 0, filePreserved: true };
}

function allContracts() {
  return db.prepare("SELECT data FROM contracts ORDER BY created_at DESC, id DESC").all().map(rowToRecord);
}

function allContractSummaries() {
  return db.prepare("SELECT coalesce(compact_data, data) AS data FROM contracts ORDER BY created_at DESC, id DESC").all().map(rowToRecord);
}

function facilityProfileRecordType(profile = {}) {
  const value = String(profile.recordType || profile.facilityStatus || profile.status || "Active Facility");
  if (/historical|record.?only|inactive|closed/i.test(value)) return "Historical / Record Only";
  if (/external|other company|not a facility/i.test(value)) return "External Company / Not a Facility";
  return "Active Facility";
}

function contractUsesActiveFacilityProfile(contract = {}, profiles = getAdminSettings().facilityProfiles || []) {
  const names = [contract.facility, contract.facilities, contract.facilityName, contract.facilityLegalName, contract.facilityDba]
    .flatMap(value => String(value || "").split(/[;,|]/))
    .map(value => value.trim())
    .filter(Boolean);
  const matches = profiles.filter(profile => {
    const keys = [profile.name, profile.dba, profile.legalName, profile.shortName, profile.commonName, ...(Array.isArray(profile.aliases) ? profile.aliases : [])]
      .map(canonicalNameKey)
      .filter(Boolean);
    return names.some(name => keys.includes(canonicalNameKey(name)));
  });
  return !matches.length || matches.some(profile => facilityProfileRecordType(profile) === "Active Facility");
}

function isClearlySupplementalFinanceDocument(contract = {}) {
  if (contract.parentContractId) return true;
  const documentType = String(contract.documentType || "").trim().toLowerCase();
  if (!["amendment", "addendum", "rider", "supplement", "extension", "change order", "related document"].includes(documentType)) return false;
  const title = [contract.name, contract.uploadedFileName, contract.sourceDocumentName]
    .filter(Boolean)
    .join(" ");
  return /\b(amendment|addendum|rider|supplement|extension|change\s+order)\b/i.test(title);
}

function financeContractIdentityKey(contract = {}) {
  const fileHash = String(contract.fileHash || "").trim().toLowerCase();
  if (fileHash) return `hash:${fileHash}`;
  const title = canonicalNameKey(String(contract.name || contract.uploadedFileName || "").replace(/\.(?:pdf|docx?|xlsx?)$/i, ""));
  const facility = canonicalNameKey(contract.facility || contract.facilities || "");
  const vendor = canonicalNameKey(contract.vendor || "");
  return title ? `record:${title}|${facility}|${vendor}` : `id:${contract.id || ""}`;
}

function activeFinanceContracts() {
  const profiles = getAdminSettings().facilityProfiles || [];
  const seen = new Set();
  return db.prepare(`
    SELECT coalesce(compact_data, data) AS data
    FROM contracts
    WHERE lower(trim(coalesce(status, ''))) = 'active'
    ORDER BY updated_at DESC, created_at DESC, id DESC
  `).all().map(rowToRecord).filter(contract => {
    if (!contractUsesActiveFacilityProfile(contract, profiles)) return false;
    if (isClearlySupplementalFinanceDocument(contract)) return false;
    const identity = financeContractIdentityKey(contract);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

const reviewContractWhere = `
  lower(trim(coalesce(status, ''))) LIKE '%review%'
  OR lower(trim(coalesce(status, ''))) LIKE 'needs%'
  OR lower(trim(coalesce(review_status, ''))) LIKE 'pending%'
`;

function reviewContractCount() {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM contracts WHERE ${reviewContractWhere}`).get()?.count || 0);
}

function reviewContracts(limit = 60, offset = 0) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 60, 100));
  const safeOffset = Math.max(0, Number(offset) || 0);
  return db.prepare(`
    SELECT coalesce(compact_data, data) AS data
    FROM contracts
    WHERE ${reviewContractWhere}
    ORDER BY coalesce(nullif(created_at, ''), updated_at) DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(safeLimit, safeOffset).map(rowToRecord);
}

const summaryCache = new Map();

function invalidateSummaryCache() {
  summaryCache.clear();
}

function cachedSummary(key, ttlMs, build, fresh = false) {
  const now = Date.now();
  if (!fresh) {
    const cached = summaryCache.get(key);
    if (cached && now - cached.at < ttlMs) return cached.value;
  }
  const value = build();
  summaryCache.set(key, { at: now, value });
  return value;
}

function hasUsefulContractValue(value) {
  const text = String(value || "").trim();
  return Boolean(text && !/^(needs review|needs classification|unknown|not found|tbd|n\/a|na|none|missing)$/i.test(text));
}

function moneyToNumber(value) {
  const raw = String(value || "");
  const match = raw.match(/\$?\s*(\d[\d,]*(?:\.\d{1,2})?)(?:\s*([MK])\b)?/i);
  if (!match) return 0;
  const multiplier = String(match[2] || "").toUpperCase() === "M" ? 1000000 : String(match[2] || "").toUpperCase() === "K" ? 1000 : 1;
  return Number(String(match[1] || "").replace(/,/g, "")) * multiplier || 0;
}

function annualizedMoneyValue(value = "", defaultFrequency = "") {
  const amount = moneyToNumber(value);
  if (!amount) return 0;
  const text = `${value || ""} ${defaultFrequency || ""}`.toLowerCase();
  if (/\b\d+(?:\.\d+)?\s*%|\bpercent\b/.test(text)) return 0;
  if (/\b(?:per|\/)\s*(?:mile|gallon|visit|pickup|trip|load|test|box|container|meal|session|service\s*call|hour|resident|patient|bed|resident\s*day|patient\s*day|diem|trap|unit|service|delivery|square\s*(?:foot|feet|ft)|sq\.?\s*ft|linear\s*(?:foot|feet|ft)|lf|yard|ton)\b/.test(text)) return 0;
  if (/\b(one[-\s]?time|once|non[-\s]?recurring|nrc)\b/.test(text)) return amount;
  if (/\b(semi[-\s]?annual|twice\s+(?:a\s+)?year|2\s*(?:x|times)\s+(?:a\s+)?year)\b/.test(text)) return amount * 2;
  if (/\b(per\s+)?(year|yr|annual|annually|yearly)\b|\/\s*(year|yr)\b/.test(text)) return amount;
  if (/\b(per\s+)?(quarter|qtr|quarterly)\b|\/\s*qtr\b/.test(text)) return amount * 4;
  if (/\b(per\s+)?(month|monthly|mo)\b|\/\s*(month|mo)\b/.test(text)) return amount * 12;
  if (/\b(per\s+)?(week|weekly|wk)\b|\/\s*(week|wk)\b/.test(text)) return amount * 52;
  if (/\b(per\s+)?(day|daily)\b|\/\s*day\b/.test(text)) return amount * 365;
  return defaultFrequency ? amount : 0;
}

function annualizedMoneyBasis(value = "", defaultFrequency = "") {
  const text = `${value || ""} ${defaultFrequency || ""}`.toLowerCase();
  if (/\b(one[-\s]?time|once|non[-\s]?recurring|nrc)\b/.test(text)) return "One-time cost";
  if (/\b(semi[-\s]?annual|twice\s+(?:a\s+)?year|2\s*(?:x|times)\s+(?:a\s+)?year)\b/.test(text)) return "Semi-annual cost x 2";
  if (/\b(per\s+)?(year|yr|annual|annually|yearly)\b|\/\s*(year|yr)\b/.test(text)) return "Annual spend saved";
  if (/\b(per\s+)?(quarter|qtr|quarterly)\b|\/\s*qtr\b/.test(text)) return "Quarterly cost x 4";
  if (/\b(per\s+)?(month|monthly|mo)\b|\/\s*(month|mo)\b/.test(text)) return "Monthly cost x 12";
  if (/\b(per\s+)?(week|weekly|wk)\b|\/\s*(week|wk)\b/.test(text)) return "Weekly cost x 52";
  if (/\b(per\s+)?(day|daily)\b|\/\s*day\b/.test(text)) return "Daily cost x 365";
  return defaultFrequency === "year" ? "Annual spend saved" : defaultFrequency === "month" ? "Monthly cost x 12" : "Saved cost";
}

function provenMonthlyCostValue(contract = {}) {
  const value = contract.monthlyCost || contract.monthlySpend || "";
  if (!value) return "";
  const proof = [
    value,
    contract.billingFrequency,
    contract.serviceFrequency,
    contract.paymentFrequency
  ].filter(Boolean).join(" ");
  return /\b(?:per\s+)?(?:month|monthly|mo)\b|\/\s*(?:month|mo)\b/i.test(proof) ? value : "";
}

function contractHasNoFinancialImpact(contract = {}) {
  const typeText = [
    contract.contractType,
    contract.agreementType,
    contract.documentType,
    contract.category,
    contract.services,
    contract.serviceType
  ].filter(Boolean).join(" ");
  const moneyText = [
    contract.fee,
    contract.rate,
    contract.cost,
    contract.price,
    contract.paymentTerms,
    contract.servicePricingDetail,
    contract.feeDetails
  ].filter(Boolean).join(" ");
  const explicitNoMoney = /\b(no\s+(?:cost|charge|fee|payment|financial\s+impact|money)|without\s+(?:cost|charge|payment)|not\s+applicable)\b/i.test(moneyText);
  const nonFinancialType = /\b(business\s+associate\s+agreement|baa|data\s+privacy|confidentiality|non[-\s]?disclosure|nda)\b/i.test(typeText);
  return explicitNoMoney || (nonFinancialType && !moneyToNumber(contractFinanceAnnualText(contract)));
}

function contractFinanceCostText(contract = {}) {
  const savedFields = Array.isArray(contract.extractedFields) ? contract.extractedFields : [];
  const financeLabels = [
    "cost",
    "fee",
    "fees",
    "rate",
    "rate / fee",
    "service charge",
    "service charges",
    "service fee",
    "service fees",
    "monthly cost",
    "monthly charge",
    "monthly recurring charge",
    "annual cost",
    "annual spend",
    "annual charge",
    "contract value",
    "contract amount",
    "contract price",
    "pricing",
    "service pricing detail",
    "fee schedule",
    "rate schedule",
    "unit rate"
  ];
  const extractedFinance = savedFields
    .filter(field => {
      const label = canonicalContractKeyLabel(field?.label || "").toLowerCase();
      return financeLabels.some(financeLabel => label === financeLabel || label.includes(financeLabel));
    })
    .map(field => [field.value, field.source, field.snippet].filter(Boolean).join(" "))
    .join(" ");
  const feeLineText = (Array.isArray(contract.extractedFeeLines) ? contract.extractedFeeLines : [])
    .map(line => [
      line.service,
      line.unit,
      line.rate,
      line.amount,
      line.fee,
      line.frequency,
      line.source,
      line.snippet
    ].filter(Boolean).join(" "))
    .join(" ");
  return [
    contract.annualCost,
    contract.annualSpend,
    contract.spend,
    contract.contractValue,
    contract.totalAnnualSpend,
    contract.monthlyCost,
    contract.monthlySpend,
    contract.fee,
    contract.rate,
    contract.cost,
    contract.price,
    contract.servicePricingDetail,
    contract.feeDetails,
    contract.pricingDetail,
    contract.unitRate,
    extractedFinance,
    feeLineText
  ].filter(Boolean).join(" ");
}

function contractFinanceAnnualText(contract = {}) {
  const savedFields = Array.isArray(contract.extractedFields) ? contract.extractedFields : [];
  const financeLabels = [
    "cost",
    "fee",
    "fees",
    "rate",
    "rate / fee",
    "service charge",
    "service charges",
    "service fee",
    "service fees",
    "monthly cost",
    "monthly charge",
    "monthly recurring charge",
    "annual cost",
    "annual spend",
    "annual charge",
    "contract value",
    "contract amount",
    "contract price",
    "pricing",
    "service pricing detail",
    "fee schedule",
    "rate schedule",
    "unit rate"
  ];
  const extractedValues = savedFields
    .filter(field => {
      const label = canonicalContractKeyLabel(field?.label || "").toLowerCase();
      return financeLabels.some(financeLabel => label === financeLabel || label.includes(financeLabel));
    })
    .map(field => field.value)
    .filter(Boolean)
    .join(" ");
  const feeLineValues = (Array.isArray(contract.extractedFeeLines) ? contract.extractedFeeLines : [])
    .map(line => [line.rate, line.amount, line.fee, line.frequency, line.unit].filter(Boolean).join(" "))
    .join(" ");
  return [
    contract.annualCost,
    contract.annualSpend,
    contract.spend,
    contract.contractValue,
    contract.totalAnnualSpend,
    contract.monthlyCost,
    contract.monthlySpend,
    contract.fee,
    contract.rate,
    contract.cost,
    contract.price,
    contract.servicePricingDetail,
    contract.feeDetails,
    contract.pricingDetail,
    contract.unitRate,
    extractedValues,
    feeLineValues
  ].filter(Boolean).join(" ");
}

function financeFrequencyMultiplier(value = "") {
  const text = String(value || "").toLowerCase();
  if (/\b(one[-\s]?time|once|non[-\s]?recurring|nrc)\b/.test(text)) return { multiplier: 1, label: "one-time" };
  if (/\b(semi[-\s]?annual|twice\s+(?:a\s+)?year|2\s*(?:x|times)\s+(?:a\s+)?year)\b/.test(text)) return { multiplier: 2, label: "semi-annual" };
  if (/\b(per\s+)?(year|yr|annual|annually|yearly)\b|\/\s*(year|yr)\b/.test(text)) return { multiplier: 1, label: "annual" };
  if (/\b(per\s+)?(quarter|qtr|quarterly)\b|\/\s*qtr\b/.test(text)) return { multiplier: 4, label: "quarterly" };
  if (/\b(bi[-\s]?weekly|every\s+two\s+weeks)\b/.test(text)) return { multiplier: 26, label: "bi-weekly" };
  if (/\b(per\s+)?(month|monthly|mo)\b|\/\s*(month|mo)\b/.test(text)) return { multiplier: 12, label: "monthly" };
  if (/\b(per\s+)?(week|weekly|wk)\b|\/\s*(week|wk)\b/.test(text)) return { multiplier: 52, label: "weekly" };
  if (/\b(per\s+)?(day|daily|per diem|ppd)\b|\/\s*day\b/.test(text)) return { multiplier: 365, label: "daily" };
  return { multiplier: 0, label: "" };
}

function quantityNumber(value = "") {
  const text = String(value || "").replace(/,/g, "").toLowerCase();
  if (/\b(?:weekly|monthly|quarterly|annually|bi[-\s]?weekly|daily)\b/.test(text) && !/\b\d+(?:\.\d+)?\b/.test(text)) return 1;
  const match = text.match(/\b(\d+(?:\.\d+)?)\b/);
  return match ? Number(match[1]) || 0 : 0;
}

function isUnitRateText(value = "") {
  return /\b(?:per|\/)\s*(?:mile|gallon|visit|pickup|trip|load|test|box|container|meal|session|service\s*call|hour|resident|patient|bed|resident\s*day|patient\s*day|diem|trap|unit|service|delivery|square\s*(?:foot|feet|ft)|sq\.?\s*ft|linear\s*(?:foot|feet|ft)|lf|yard|ton)\b/i.test(String(value || ""));
}

function annualizedFromRateQuantity(contract = {}) {
  const rateText = [
    contract.fee,
    contract.rate,
    contract.cost,
    contract.price,
    contract.servicePricingDetail,
    contract.feeDetails,
    contract.pricingDetail,
    contract.unitRate
  ].filter(Boolean).join(" ");
  const amount = moneyToNumber(rateText);
  if (!amount || /\b\d+(?:\.\d+)?\s*%|\bpercent\b/i.test(rateText)) return 0;
  const unitRate = isUnitRateText(rateText);
  const frequencyText = [
    rateText,
    contract.billingFrequency,
    contract.serviceFrequency,
    contract.pickupFrequency,
    unitRate ? contract.quantityOfServices : ""
  ].filter(Boolean).join(" ");
  const frequency = financeFrequencyMultiplier(frequencyText);
  if (!frequency.multiplier) return 0;
  const quantity = quantityNumber(contract.quantityOfServices || contract.serviceQuantity || contract.units || "");
  if (unitRate && !quantity) return 0;
  return amount * (unitRate ? quantity : 1) * frequency.multiplier;
}

function financeAnnualizationStatus(contract = {}) {
  if (contractHasNoFinancialImpact(contract)) return { status: "no-financial-impact", detail: "No payment under this agreement" };
  const annualValue = contract.annualCost || contract.annualSpend || contract.spend || contract.contractValue || contract.totalAnnualSpend;
  const annual = annualizedMoneyValue(annualValue, "year");
  if (annual) return { status: "annualized", detail: annualizedMoneyBasis(annualValue, "year") };
  const monthlyValue = provenMonthlyCostValue(contract);
  const monthly = annualizedMoneyValue(monthlyValue, "month");
  if (monthly) return { status: "annualized", detail: annualizedMoneyBasis(monthlyValue, "month") };
  const rateText = [
    contract.fee,
    contract.rate,
    contract.cost,
    contract.price,
    contract.servicePricingDetail,
    contract.feeDetails,
    contract.pricingDetail,
    contract.unitRate
  ].filter(Boolean).join(" ");
  const amount = moneyToNumber(rateText);
  if (!amount && !contractHasFinanceCost(contract)) return { status: "needs-cost", detail: "Needs cost/rate" };
  if (/\b\d+(?:\.\d+)?\s*%|\bpercent\b/i.test(rateText)) return { status: "percent-rate", detail: "Percent/fee schedule needs volume" };
  const unitRate = isUnitRateText(rateText);
  const frequencyText = [rateText, contract.billingFrequency, contract.serviceFrequency, contract.pickupFrequency, unitRate ? contract.quantityOfServices : ""].filter(Boolean).join(" ");
  const frequency = financeFrequencyMultiplier(frequencyText);
  if (!frequency.multiplier) return { status: "needs-frequency", detail: "Needs billing frequency" };
  if (unitRate && !quantityNumber(contract.quantityOfServices || contract.serviceQuantity || contract.units || "")) {
    return { status: "needs-quantity", detail: "Needs quantity/volume" };
  }
  return { status: "annualized", detail: "Rate x frequency" };
}

function annualizedContractSpend(contract = {}) {
  if (contractHasNoFinancialImpact(contract)) return 0;
  const annual = annualizedMoneyValue(contract.annualCost || contract.annualSpend || contract.totalAnnualSpend, "year");
  if (annual) return annual;
  const legacyAnnual = annualizedMoneyValue(contract.spend || contract.contractValue, "");
  if (legacyAnnual) return legacyAnnual;
  const monthly = annualizedMoneyValue(provenMonthlyCostValue(contract), "month");
  if (monthly) return monthly;
  const calculated = annualizedFromRateQuantity(contract);
  if (calculated) return calculated;
  return 0;
}

function contractHasFinanceCost(contract = {}) {
  const financeText = contractFinanceCostText(contract);
  return reviewCostValueIsUsable(financeText, financeText);
}

function splitContractNames(value = "") {
  return String(value || "")
    .split(/\s*(?:;|\||,|\band\b|&)\s*/i)
    .map(item => item.trim())
    .filter(Boolean);
}

function contractFacilityNames(contract = {}) {
  return [
    ...splitContractNames(contract.facilities),
    ...splitContractNames(contract.facility),
    contract.facilityName,
    contract.facilityLegalName,
    contract.facilityDba,
    contract.serviceAddress
  ].filter(Boolean);
}

function facilityProfileMatchesName(profile = {}, name = "") {
  const target = canonicalNameKey(name);
  if (!target) return false;
  const values = [
    profile.name,
    profile.legalName,
    profile.dba,
    profile.commonName,
    profile.approvedDba,
    ...(Array.isArray(profile.aliases) ? profile.aliases : splitContractNames(profile.aliases))
  ];
  return values.some(value => {
    const key = canonicalNameKey(value);
    return Boolean(key && (key === target || key.includes(target) || target.includes(key)));
  });
}

function resolveFacilityProfileForFinanceName(profiles = [], name = "") {
  const target = canonicalNameKey(name);
  if (!target) return null;
  const exactName = profiles.find(profile => canonicalNameKey(profile.name) === target);
  if (exactName) return exactName;
  const exactIdentity = profiles.filter(profile => [profile.legalName, profile.dba, profile.commonName, profile.approvedDba, profile.shortName]
    .some(value => canonicalNameKey(value) === target));
  if (exactIdentity.length === 1) return exactIdentity[0];
  const exactAliases = profiles.filter(profile => (Array.isArray(profile.aliases) ? profile.aliases : splitContractNames(profile.aliases))
    .some(value => canonicalNameKey(value) === target));
  if (exactAliases.length === 1) return exactAliases[0];
  if (target.length < 6) return null;
  const partial = profiles.filter(profile => facilityProfileMatchesName(profile, name));
  return partial.length === 1 ? partial[0] : null;
}

function facilityBedsForContract(contract = {}, profiles = getAdminSettings().facilityProfiles || []) {
  const directBeds = Number(contract.beds || contract.bedCount || contract.quantityOfBeds || 0);
  if (directBeds) return directBeds;
  const seen = new Set();
  const beds = [];
  for (const name of contractFacilityNames(contract)) {
    const profile = resolveFacilityProfileForFinanceName(profiles, name);
    const key = canonicalNameKey(profile?.name || "");
    if (!profile || !key || seen.has(key)) continue;
    seen.add(key);
    const count = Number(profile.beds || profile.bedCount || 0);
    if (count) beds.push(count);
  }
  return beds.reduce((sum, count) => sum + count, 0);
}

function facilityCensusForContract(contract = {}, profiles = getAdminSettings().facilityProfiles || []) {
  const directCensus = Number(contract.averageDailyCensus || contract.currentCensus || 0);
  const directBeds = facilityBedsForContract(contract, profiles);
  if (directCensus) return directBeds && directCensus > directBeds ? 0 : directCensus;
  const seen = new Set();
  const census = [];
  for (const name of contractFacilityNames(contract)) {
    const profile = resolveFacilityProfileForFinanceName(profiles, name);
    const key = canonicalNameKey(profile?.name || "");
    if (!profile || !key || seen.has(key)) continue;
    seen.add(key);
    const count = Number(profile.averageDailyCensus || profile.currentCensus || 0);
    if (count) census.push(count);
  }
  const totalCensus = census.reduce((sum, count) => sum + count, 0);
  const totalBeds = facilityBedsForContract(contract, profiles);
  return totalBeds && totalCensus > totalBeds ? 0 : totalCensus;
}

function formatMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "$0";
  const hasCents = Math.abs(amount % 1) > 0.0001;
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2
  });
}

function daysUntil(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.ceil((date.getTime() - today.getTime()) / 86400000);
}

function dateObjectValue(value) {
  const text = String(value || "").trim();
  if (!text || /^(needs review|needs classification|unknown|not found|tbd|n\/a|na)$/i.test(text)) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDateValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function isAutoRenewingValue(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || ["unknown", "needs review", "not found"].includes(text)) return false;
  if (/\b(no|none|not applicable|does not|will not)\b/.test(text)) return false;
  return /\b(yes|auto|automatic|renews|renewal)\b/.test(text);
}

function termIntervalValue(value = "") {
  const text = String(value || "").toLowerCase();
  if (!text || /^(needs review|unknown|not found|tbd|n\/a|na)$/i.test(text)) return null;
  const numberWords = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10
  };
  const wordAmount = Object.entries(numberWords).find(([word]) => new RegExp(`\\b${word}\\b`, "i").test(text))?.[1] || 0;
  const amount = Number(text.match(/\b(\d{1,2})\b/)?.[1] || wordAmount || 0);
  if (!amount) return null;
  if (/\b(year|years|yr|yrs|annual|annually)\b/.test(text)) return { unit: "year", amount };
  if (/\b(month|months|mo|mos)\b/.test(text)) return { unit: "month", amount };
  if (/\b(day|days)\b/.test(text)) return { unit: "day", amount };
  return null;
}

function addTermInterval(dateValue, interval) {
  const date = new Date(dateValue);
  if (!(date instanceof Date) || Number.isNaN(date.getTime()) || !interval) return null;
  if (interval.unit === "year") date.setFullYear(date.getFullYear() + interval.amount);
  else if (interval.unit === "month") date.setMonth(date.getMonth() + interval.amount);
  else if (interval.unit === "day") date.setDate(date.getDate() + interval.amount);
  else return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function initialTermEndDateValue(startDate, termLength) {
  const start = dateObjectValue(startDate);
  const interval = termIntervalValue(termLength);
  return start && interval ? addTermInterval(start, interval) : null;
}

function currentRenewalBaseDate(contract = {}, baseDate, noticeDays = 0) {
  if (!isAutoRenewingValue(contract.autoRenewal) || !baseDate) return { date: baseDate, rolled: false };
  const interval = termIntervalValue(contract.renewalTerm || contract.renewalLength || contract.initialContractLength || contract.contractLength || contract.term)
    || { unit: "year", amount: 1 };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let date = new Date(baseDate);
  date.setHours(0, 0, 0, 0);
  let rolled = false;
  for (let i = 0; i < 120; i += 1) {
    const target = new Date(date);
    if (noticeDays) target.setDate(target.getDate() - noticeDays);
    if (target >= today) return { date, rolled };
    const next = addTermInterval(date, interval);
    if (!next || next <= date) break;
    date = next;
    rolled = true;
  }
  return { date, rolled };
}

function noticeDaysValue(contract = {}) {
  const text = [
    contract.noticePeriod,
    contract.requiredNoticeDays,
    contract.terminationNotice,
    contract.terminationClause,
    contract.termination
  ].filter(Boolean).join(" ");
  const explicit = Number(String(contract.requiredNoticeDays || contract.noticeDays || "").match(/\d{1,3}/)?.[0] || 0);
  if (explicit) return explicit;
  const numeric = String(text || "").match(/\b(\d{1,3})\s*(?:calendar\s*)?(?:day|days)\b/i);
  if (numeric) return Number(numeric[1]);
  const words = [
    ["one hundred twenty", 120],
    ["ninety", 90],
    ["sixty", 60],
    ["forty five", 45],
    ["forty-five", 45],
    ["thirty", 30],
    ["fifteen", 15],
    ["ten", 10]
  ];
  const lower = String(text || "").toLowerCase();
  const match = words.find(([word]) => lower.includes(word));
  return match ? match[1] : 0;
}

function contractAlertDate(contract = {}) {
  const explicitDeadline = dateObjectValue(contract.terminationDeadline || contract.noticeDeadline);
  if (explicitDeadline) {
    return { targetDate: formatDateValue(explicitDeadline), days: daysUntil(explicitDeadline), basis: "Notice deadline", noticeDays: 0 };
  }
  const calculatedInitialEnd = initialTermEndDateValue(
    contract.effectiveDate || contract.startOfServices || contract.start || contract.signatureDate || contract.signedDate,
    contract.initialContractLength || contract.contractLength || contract.term
  );
  const savedBaseDate = dateObjectValue(contract.renewalDate || contract.renewal || contract.end || contract.expirationDate || contract.endDate);
  const noticeDays = noticeDaysValue(contract);
  const { date: baseDate, rolled } = currentRenewalBaseDate(contract, savedBaseDate || calculatedInitialEnd, noticeDays);
  if (!baseDate) return null;
  const target = new Date(baseDate);
  const autoRenewing = isAutoRenewingValue(contract.autoRenewal);
  if (autoRenewing && noticeDays) target.setDate(target.getDate() - noticeDays);
  return {
    targetDate: formatDateValue(target),
    days: daysUntil(target),
    basis: autoRenewing && noticeDays ? (rolled ? "Next renewal notice deadline" : "Calculated notice deadline") : calculatedInitialEnd && !savedBaseDate ? "Initial term end" : "End / renewal date",
    noticeDays,
    baseDate: formatDateValue(baseDate)
  };
}

function lifecycleAlerts(records = allContracts(), windows = [90, 60, 30]) {
  const alerts = [];
  for (const contract of records) {
    if (/^(archived|expired|terminated|superseded|cancelled|canceled|inactive)$/i.test(String(contract.status || '').trim())) continue;
    const alertDate = contractAlertDate(contract);
    if (!alertDate) continue;
    const { targetDate, days } = alertDate;
    if (days === null || days < 0) continue;
    const window = [...windows].sort((a,b) => a-b).find(item => days <= item);
    if (window === undefined) continue;
    alerts.push({
      id: `ALERT-${contract.id}-${window}`,
      contractId: contract.id,
      contractName: contract.name || "Unnamed contract",
      vendor: contract.vendor || "Vendor not confirmed",
      facility: contract.facility || "Facility not confirmed",
      category: contract.category || contract.services || "Service not confirmed",
      targetDate,
      alertBasis: alertDate.basis,
      noticeDays: alertDate.noticeDays || "",
      renewalEndDate: alertDate.baseDate || "",
      days,
      window,
      paymentTerms: contract.paymentTerms || "",
      fee: contract.fee || contract.rate || contract.spend || "",
      notice: contract.terminationClause || contract.noticePeriod || "",
      autoRenewal: contract.autoRenewal || "Unknown",
      requiredAction: days <= 30 ? "Immediate review" : "Review renewal/termination options",
      status: "Pending"
    });
  }
  return alerts.sort((a, b) => a.days - b.days);
}

async function sendWebhookAlert(payload) {
  if (!alertWebhookUrl) return { configured: false, sent: false, provider: "webhook" };
  const response = await fetch(alertWebhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Webhook failed with ${response.status}`);
  return { configured: true, sent: true, provider: "webhook", status: response.status };
}

function smtpRead(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => { onError(new Error('SMTP response timed out.')); socket.destroy(); }, 15000);
    const onData = chunk => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || "";
      if (/^\d{3} /.test(last)) {
        clearTimeout(timer);
        socket.off("data", onData);
        socket.off("error", onError);
        resolve(buffer);
      }
    };
    const onError = error => {
      clearTimeout(timer);
      socket.off("data", onData);
      reject(error);
    };
    socket.on("data", onData);
    socket.once("error", onError);
  });
}

async function smtpCommand(socket, command, expected = /^[23]/) {
  const pendingResponse = smtpRead(socket);
  if (command) socket.write(`${command}\r\n`);
  const response = await pendingResponse;
  if (!expected.test(response)) throw new Error(`SMTP command failed: ${response.trim()}`);
  return response;
}

async function sendSmtpMail({ to, subject, text, html }) {
  if (!smtpHost || !to) return { configured: false, sent: false, provider: "smtp" };
  const envelopeFrom = (String(smtpFrom).match(/<([^>]+)>/)?.[1] || smtpFrom).trim();
  let socket = smtpPort === 465
    ? tls.connect({ host: smtpHost, port: smtpPort, servername: smtpHost })
    : net.connect({ host: smtpHost, port: smtpPort });
  await smtpCommand(socket, "", /^220/);
  await smtpCommand(socket, `EHLO ${os.hostname() || "contract-operations"}`);
  if (smtpPort !== 465) {
    await smtpCommand(socket, "STARTTLS", /^220/);
    socket = tls.connect({ socket, servername: smtpHost });
    await smtpCommand(socket, `EHLO ${os.hostname() || "contract-operations"}`);
  }
  if (smtpUser && smtpPass) {
    await smtpCommand(socket, "AUTH LOGIN", /^334/);
    await smtpCommand(socket, Buffer.from(smtpUser).toString("base64"), /^334/);
    await smtpCommand(socket, Buffer.from(smtpPass).toString("base64"), /^235/);
  }
  await smtpCommand(socket, `MAIL FROM:<${envelopeFrom}>`);
  for (const recipient of String(to).split(/[;,]/).map(item => item.trim()).filter(Boolean)) {
    await smtpCommand(socket, `RCPT TO:<${recipient}>`);
  }
  await smtpCommand(socket, "DATA", /^354/);
  const message = [
    `From: ${smtpFrom}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    html ? "Content-Type: text/html; charset=utf-8" : "Content-Type: text/plain; charset=utf-8",
    "",
    (html || text).replace(/\r?\n\./g, "\n.."),
    "."
  ].join("\r\n");
  await smtpCommand(socket, message);
  await smtpCommand(socket, "QUIT", /^[23]/).catch(() => null);
  socket.end();
  return { configured: true, sent: true, provider: "smtp", to };
}

function smtpConfigurationStatus() {
  const missing = [];
  if (!smtpHost) missing.push("SMTP_HOST");
  if (!smtpPort) missing.push("SMTP_PORT");
  if (!smtpUser) missing.push("SMTP_USER");
  if (!smtpPass) missing.push("SMTP_PASS");
  if (!smtpFrom || smtpFrom === "contracts@localhost") missing.push("SMTP_FROM");
  return {
    configured: missing.length === 0,
    host: smtpHost || "",
    port: smtpPort,
    user: smtpUser || "",
    from: smtpFrom || "",
    appBaseUrl: appBaseUrl || "Auto-detected from the browser request",
    missing
  };
}

async function sendLifecycleAlerts({ dryRun = false } = {}) {
  const alerts = lifecycleAlerts();
  const payload = {
    generatedAt: new Date().toISOString(),
    count: alerts.length,
    alerts
  };
  if (dryRun) return { dryRun: true, ...payload, sendResults: [] };
  const subject = `Contract alerts: ${alerts.length} item${alerts.length === 1 ? "" : "s"} need review`;
  const text = alerts.map(alert => [
    `${alert.contractName}`,
    `Facility: ${alert.facility}`,
    `Vendor: ${alert.vendor}`,
    `Service: ${alert.category}`,
    `Due: ${alert.targetDate} (${alert.days} days)`,
    `Notice: ${alert.notice || "Needs Review"}`,
    `Payment: ${alert.paymentTerms || "Needs Review"}`,
    `Fee: ${alert.fee || "Needs Review"}`,
    `Action: ${alert.requiredAction}`
  ].join("\n")).join("\n\n---\n\n") || "No lifecycle alerts are due right now.";
  const sendResults = [];
  try { sendResults.push(await sendWebhookAlert(payload)); } catch (error) { sendResults.push({ provider: "webhook", sent: false, error: error.message }); }
  try { sendResults.push(await sendSmtpMail({ to: alertEmailTo || getAdminSettings().contractDepartmentEmail || "", subject, text })); } catch (error) { sendResults.push({ provider: "smtp", sent: false, error: error.message }); }
  logAudit("lifecycle_alerts_sent", "alerts", "lifecycle", { count: alerts.length, sendResults });
  return { ...payload, sendResults };
}

function dashboardSummary(records = allContractSummaries()) {
  const active = records.filter(contract => contract.status === "Active").length;
  const renewalItems = records
    .map(contract => {
      const alert = contractAlertDate(contract);
      if (!alert || alert.days === null || alert.days < 0 || alert.days > 90) return null;
      const window = alert.days <= 30 ? "30 days" : alert.days <= 60 ? "60 days" : "90 days";
      return {
        contractId: contract.id,
        contract: contract.name || contract.fileName || "Unnamed contract",
        vendor: contract.vendor || "Needs Review",
        facility: contract.facility || "Needs Review",
        category: contract.category || contract.services || "Needs Review",
        value: contract.spend || contract.annualCost || contract.monthlyCost || contract.fee || contract.rate || "Needs Review",
        targetDate: alert.targetDate,
        days: alert.days,
        window,
        basis: alert.basis
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.days - b.days);
  const expiring90 = renewalItems.length;
  const missingInsurance = records.filter(contract => {
    const text = `${contract.category || ""} ${contract.insurance || ""} ${contract.insuranceStatus || ""}`.toLowerCase();
    return text.includes("missing") || text.includes("expired");
  }).length;
  const annualSpend = records
    .filter(contract => String(contract.status || "").trim().toLowerCase() === "active")
    .reduce((sum, contract) => sum + annualizedContractSpend(contract), 0);
  const hasValue = value => {
    const text = String(value || "").trim();
    return text && !/^(needs review|needs classification|unknown|not found|tbd|n\/a|na|none)$/i.test(text);
  };
  const missingCoreFields = contract => {
    const missing = [];
    if (!hasValue(contract.category || contract.contractType || contract.agreementType || contract.services)) missing.push("Contract type");
    if (!hasValue(contract.vendor)) missing.push("Vendor");
    if (!hasValue(contract.facility)) missing.push("Facility");
    if (!hasValue(contract.effectiveDate || contract.startOfServices || contract.start || contract.signatureDate || contract.signedDate)) missing.push("Effective date");
    if (!contractHasFinanceCost(contract)) missing.push("Cost");
    if (!hasValue(contract.autoRenewal || contract.renewal)) missing.push("Auto renew");
    if (!hasValue(contract.terminationClause || contract.noticePeriod || contract.termination)) missing.push("How to terminate");
    return missing;
  };
  const attentionRows = records.map(contract => {
    const needsTerminationProof = isAutoRenewingValue(contract.autoRenewal) && !hasValue(contract.terminationClause || contract.noticePeriod);
    const isHighRisk = ["Critical", "High", "High Risk"].includes(contract.risk) || contract.status === "High Risk";
    const isReview = String(contract.status || "").includes("Review") || String(contract.reviewStatus || "").includes("Pending");
    const missing = isReview ? missingCoreFields(contract) : [];
    if (!needsTerminationProof && !isHighRisk && !missing.length && !isReview) return null;
    return {
      contractId: contract.id,
      contract: contract.name || contract.fileName || "Uploaded contract",
      facility: contract.facility || "Needs review",
      issue: needsTerminationProof
        ? "Auto-renewal needs termination proof"
        : isHighRisk
          ? "High-risk contract needs review"
          : missing.length
            ? `Missing: ${missing.join(", ")}`
            : "Review required fields",
      due: needsTerminationProof ? "Before renewal" : missing.length ? "Before approval" : "Today",
      owner: contract.owner || "Contract Dept",
      severity: needsTerminationProof || isHighRisk ? "red" : "amber"
    };
  }).filter(Boolean).sort((a, b) => (a.severity === "red" ? -1 : 0) - (b.severity === "red" ? -1 : 0));
  const criticalAttention = attentionRows.filter(row => row.severity === "red").length;
  return {
    activeContracts: active,
    totalContracts: records.length,
    expiring90,
    missingInsurance,
    annualSpend,
    annualSpendLabel: formatMoney(annualSpend),
    criticalActions: attentionRows.length,
    criticalAttention,
    reviewWaiting: reviewContractCount(),
    potentialSavings: 0,
    potentialSavingsLabel: "$0",
    sourceProofPercent: records.length ? Math.round(records.filter(contract => contract.ocrTextPreview || contract.ocrText || contract.localFilePath).length / records.length * 100) : 0,
    attentionRows: attentionRows.slice(0, 8),
    renewalRows: renewalItems.slice(0, 8)
  };
}

function financeSummary(records = activeFinanceContracts()) {
  const profiles = getAdminSettings().facilityProfiles || [];
  const rows = records.map(contract => {
    const annual = annualizedContractSpend(contract);
    const monthly = annual ? annual / 12 : 0;
    const beds = facilityBedsForContract(contract, profiles);
    const census = facilityCensusForContract(contract, profiles);
    const category = contract.category || contract.services || contract.serviceType || contract.contractType || "Uncategorized";
    const annualization = financeAnnualizationStatus(contract);
    return {
      contractId: contract.id,
      contract: contract.name || contract.fileName || "Untitled",
      vendor: contract.vendor || "Needs vendor",
      facility: contract.facility || "Needs facility",
      category,
      annual,
      monthly,
      beds,
      census,
      costBedMonth: beds && monthly ? monthly / beds : 0,
      ppd: census && annual ? annual / census / 365 : 0,
      hasCost: contractHasFinanceCost(contract),
      noFinancialImpact: contractHasNoFinancialImpact(contract),
      annualizationStatus: annualization.status,
      annualizationDetail: annualization.detail
    };
  });
  const moneyRows = rows.filter(row => row.annual || row.monthly || row.costBedMonth);
  const bedRows = moneyRows.filter(row => row.costBedMonth);
  const ppdRows = moneyRows.filter(row => row.ppd);
  const noFinancialImpactRows = rows.filter(row => row.noFinancialImpact);
  const costRows = rows.filter(row => row.hasCost && !row.noFinancialImpact);
  const needsAnnualBasisRows = rows.filter(row => row.hasCost && !row.annual && !row.monthly && !row.costBedMonth);
  const totalAnnual = moneyRows.reduce((sum, row) => sum + row.annual, 0);
  const avgBedMonth = bedRows.length ? bedRows.reduce((sum, row) => sum + row.costBedMonth, 0) / bedRows.length : 0;
  const avgPpd = ppdRows.length ? ppdRows.reduce((sum, row) => sum + row.ppd, 0) / ppdRows.length : 0;
  const byCategory = new Map();
  for (const row of bedRows) {
    if (!hasUsefulContractValue(row.category) || /^needs classification$/i.test(String(row.category || "").trim())) continue;
    const key = canonicalNameKey(row.category) || "uncategorized";
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(row);
  }
  const overMarket = [];
  for (const group of byCategory.values()) {
    if (group.length < 2) continue;
    const average = group.reduce((sum, row) => sum + row.costBedMonth, 0) / group.length;
    group.forEach(row => {
      if (average && row.costBedMonth > average * 1.15) {
        overMarket.push({ ...row, categoryAverage: average, percentOver: ((row.costBedMonth - average) / average) * 100 });
      }
    });
  }
  const facilities = new Set(rows.map(row => row.facility).filter(hasUsefulContractValue).map(canonicalNameKey));
  const topRows = [...moneyRows].sort((a, b) => b.annual - a.annual).slice(0, 25).map(row => ({
    ...row,
    annualLabel: row.annual ? formatMoney(row.annual) : row.annualizationDetail,
    monthlyLabel: row.monthly ? formatMoney(row.monthly) : row.annualizationDetail,
    costBedMonthLabel: row.costBedMonth ? formatMoney(row.costBedMonth) : (row.beds ? row.annualizationDetail : "Needs bed match"),
    ppdLabel: row.ppd ? `$${row.ppd.toFixed(2)}` : (row.census ? row.annualizationDetail : "Needs census match")
  }));
  return {
    generatedAt: new Date().toISOString(),
    scope: "active-contracts",
    scopeLabel: "Current primary contracts only",
    totalContracts: records.length,
    facilities: facilities.size,
    pricedContracts: costRows.length,
    moneyRows: moneyRows.length,
    bedRows: bedRows.length,
    ppdRows: ppdRows.length,
    financiallyRelevantContracts: rows.length - noFinancialImpactRows.length,
    noFinancialImpact: noFinancialImpactRows.length,
    missingMoney: rows.filter(row => !row.hasCost && !row.noFinancialImpact).length,
    needsAnnualBasis: needsAnnualBasisRows.length,
    missingBeds: rows.filter(row => row.annual && !row.beds).length,
    missingCensus: rows.filter(row => row.annual && !row.census).length,
    totalAnnual,
    totalAnnualLabel: formatMoney(totalAnnual),
    avgBedMonth,
    avgBedMonthLabel: avgBedMonth ? formatMoney(avgBedMonth) : "Needs cost",
    avgPpd,
    avgPpdLabel: avgPpd ? `$${avgPpd.toFixed(2)}` : "Needs cost",
    overpayCount: overMarket.length,
    highestBed: [...bedRows].sort((a, b) => b.costBedMonth - a.costBedMonth)[0] || null,
    overMarket: overMarket.slice(0, 10),
    topRows
  };
}

function servicesSummary(records = allContractSummaries()) {
  const settings = getAdminSettings();
  const serviceNames = new Set([...(settings.categories || [])].map(categoryCanonicalName).filter(Boolean));
  records.forEach(contract => {
    const service = contract.category || contract.services || contract.serviceType || contract.contractType;
    const canonical = categoryCanonicalName(service);
    if (hasUsefulContractValue(canonical)) serviceNames.add(canonical);
  });
  const rows = [...serviceNames].map(rawCategory => {
    const category = categoryCanonicalName(rawCategory);
    const categoryKey = canonicalNameKey(category);
    const matches = records.filter(contract => canonicalNameKey(categoryCanonicalName(contract.category || contract.services || contract.serviceType || contract.contractType)) === categoryKey);
    const spendValue = matches.reduce((sum, contract) => sum + annualizedContractSpend(contract), 0);
    const facilities = new Set(matches.map(contract => contract.facility).filter(hasUsefulContractValue).map(canonicalNameKey));
    const vendors = [...new Set(matches.map(contract => contract.vendor).filter(hasUsefulContractValue))].slice(0, 4);
    const expiring90 = matches.filter(contract => {
      const alert = contractAlertDate(contract);
      return alert?.days !== null && alert?.days >= 0 && alert?.days <= 90;
    }).length;
    const missing = matches.filter(contract =>
      !hasUsefulContractValue(contract.vendor)
      || !hasUsefulContractValue(contract.facility)
      || !contractHasFinanceCost(contract)
    ).length;
    return {
      category,
      contracts: matches.length,
      facilities: facilities.size,
      spendValue,
      spend: spendValue ? formatMoney(spendValue) : "",
      expiring90,
      missing,
      topVendors: vendors
    };
  }).filter(row => row.contracts > 0 || (settings.categories || []).includes(row.category))
    .sort((a, b) => (b.contracts - a.contracts) || a.category.localeCompare(b.category));
  const activeRows = rows.filter(row => row.contracts > 0);
  return {
    generatedAt: new Date().toISOString(),
    activeCount: activeRows.length,
    contractCount: activeRows.reduce((sum, row) => sum + row.contracts, 0),
    spendValue: activeRows.reduce((sum, row) => sum + row.spendValue, 0),
    spend: formatMoney(activeRows.reduce((sum, row) => sum + row.spendValue, 0)),
    missingCount: activeRows.reduce((sum, row) => sum + row.missing, 0),
    rows: rows.slice(0, 120)
  };
}

function adminSummary(records = allContractSummaries()) {
  const users = listUsers();
  const jobs = listOcrJobs({ limit: 100, lean: true });
  const tasks = listTasks();
  const reviewWaiting = records.filter(contract => String(contract.status || "").includes("Review") || String(contract.reviewStatus || "").includes("Pending")).length;
  const ocrIssues = jobs.filter(job => /fail|error|blocked/i.test(String(job.status || job.stage || ""))).length;
  return {
    generatedAt: new Date().toISOString(),
    connected: true,
    users: users.length,
    activeUsers: users.filter(user => String(user.status || "").toLowerCase() !== "inactive").length,
    reviewWaiting,
    ocrIssues,
    openTasks: tasks.filter(task => !/done|closed|complete/i.test(String(task.status || ""))).length,
    learningRules: listLearningRules().length,
    contracts: records.length
  };
}

function reviewSummary(records = reviewContracts(15), totalWaiting = reviewContractCount(), page = 1, pageSize = 15) {
  const waitingCandidates = records
    .filter(contract => String(contract.status || "").includes("Review") || String(contract.reviewStatus || "").includes("Pending") || String(contract.status || "").includes("Needs"))
  const waiting = waitingCandidates
    .slice(0, pageSize)
    .map(contract => {
      const summary = reviewQueueSummary(contract);
      if (!hasUsefulContractValue(summary.category) || /^needs classification$/i.test(String(summary.category || ""))) {
        const clueText = [
          contract.name,
          contract.uploadedFileName,
          contract.vendor,
          contract.vendorHintFromFileName
        ].filter(Boolean).join("\n").slice(0, 6000);
        const understanding = inferContractUnderstanding(clueText);
        if (understanding.category) {
          summary.suggestedCategory = understanding.category;
          summary.suggestedCategoryReason = understanding.categoryReason || "Matched contract wording";
        }
      }
      const parentMatch = /(?:amendment|addendum|rider|extension|change order|supplement|parent match)/i.test(`${summary.documentType || ""} ${summary.reviewStatus || ""}`)
        ? findParentContractForRelatedDocument(contract, `${contract.name || ""}\n${contract.vendor || ""}\n${contract.facility || ""}`)
        : null;
      if (parentMatch?.parent?.id) {
        summary.suggestedParentContractId = parentMatch.parent.id;
        summary.suggestedParentContractName = parentMatch.parent.name || parentMatch.parent.documentTitle || "";
        summary.suggestedParentConfidence = parentMatch.score;
        summary.suggestedParentReasons = parentMatch.reasons || [];
      }
      return summary;
    });
  const jobs = listOcrJobs({ limit: 40, lean: true });
  return {
    generatedAt: new Date().toISOString(),
    totalWaiting,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalWaiting / pageSize)),
    queuedOcr: jobs.filter(job => /queued|waiting|reading|running/i.test(String(job.status || job.stage || ""))).length,
    failedOcr: jobs.filter(job => /fail|error|blocked/i.test(String(job.status || job.stage || ""))).length,
    records: waiting
  };
}

function facilitySummaries(records = allContracts()) {
  const byFacility = new Map();
  for (const profile of getAdminSettings().facilityProfiles || []) {
    const name = profile.name || "Needs Classification";
    const key = canonicalNameKey(name) || name;
    byFacility.set(key, {
      ...profile,
      name,
      region: profile.region || "",
      beds: Number(profile.beds || 0),
      contracts: 0,
      spendValue: 0,
      risk: 0,
      compliance: 0,
      renewals: 0,
      missing: profile.missing || []
    });
  }
  for (const contract of records) {
    const name = contract.facility || "Needs Classification";
    const key = canonicalNameKey(name) || name;
    if (!byFacility.has(key)) {
      byFacility.set(key, { name, region: contract.region || "", beds: Number(contract.beds || 0), contracts: 0, spendValue: 0, risk: 0, compliance: 0, renewals: 0, missing: [] });
    }
    const row = byFacility.get(key);
    row.contracts += 1;
    row.name = firstUsefulValue(row.name, name);
    row.region = firstUsefulValue(row.region, contract.region);
    row.beds = Number(row.beds || contract.beds || 0);
    row.spendValue += annualizedContractSpend(contract);
    const days = daysUntil(contract.end || contract.renewal);
    if (days !== null && days >= 0 && days <= 90) row.renewals += 1;
  }
  return [...byFacility.values()].map(row => ({
    ...row,
    spend: formatMoney(row.spendValue),
    risk: row.contracts ? 75 : 0,
    compliance: row.contracts ? 75 : 0,
    missing: row.missing || []
  }));
}

function vendorSummaries(records = allContracts()) {
  const byVendor = new Map();
  const vendorProfiles = listVendorProfiles();
  const vendorAliasMap = new Map();
  for (const profile of vendorProfiles) {
    const canonicalName = profile.name || "Needs Classification";
    for (const alias of profileAliases(profile)) {
      const aliasKey = canonicalNameKey(alias);
      if (aliasKey) vendorAliasMap.set(aliasKey, canonicalName);
    }
  }
  const canonicalVendorName = value => vendorAliasMap.get(canonicalNameKey(value)) || value || "Needs Classification";
  for (const profile of vendorProfiles) {
    const name = profile.name || "Needs Classification";
    const key = canonicalNameKey(name) || name;
    byVendor.set(key, {
      ...profile,
      name,
      facilitiesSet: new Set(),
      contracts: 0,
      spendValue: 0,
      insurance: profile.insuranceStatus || profile.insurance || "Unknown",
      issues: profile.openIssues || profile.issues || "None",
      category: profile.category || "",
      mailingAddress: profile.mailingAddress || "",
      serviceAddresses: new Set(profile.serviceAddresses || []),
      phone: profile.phone || "",
      email: profile.email || ""
    });
  }
  const utilityAccounts = listUtilityAccounts();
  for (const account of utilityAccounts) {
    const name = canonicalVendorName(account.vendor);
    const key = canonicalNameKey(name) || name;
    if (!byVendor.has(key)) {
      byVendor.set(key, { name, facilitiesSet: new Set(), contracts: 0, spendValue: 0, insurance: "Unknown", issues: "None", category: account.utilityType || "", mailingAddress: "", serviceAddresses: new Set(), phone: "", email: "" });
    }
    const row = byVendor.get(key);
    row.name = firstUsefulValue(row.name, name);
    if (account.facility) row.facilitiesSet.add(account.facility);
    if (!row.category && account.utilityType) row.category = account.utilityType;
    if (!row.mailingAddress) row.mailingAddress = account.vendorMailingAddress || account.vendorAddress || account.mailingAddress || "";
    if (!row.phone) row.phone = account.vendorPhone || account.phone || "";
    if (!row.email) row.email = account.vendorEmail || account.email || "";
    if (account.serviceAddress) row.serviceAddresses.add(account.serviceAddress);
  }
  for (const contract of records) {
    const name = canonicalVendorName(contract.vendor);
    const key = canonicalNameKey(name) || name;
    if (!byVendor.has(key)) {
      byVendor.set(key, { name, facilitiesSet: new Set(), contracts: 0, spendValue: 0, insurance: "Unknown", issues: "None", category: contract.category || "", mailingAddress: "", serviceAddresses: new Set(), phone: "", email: "" });
    }
    const row = byVendor.get(key);
    row.contracts += 1;
    row.name = firstUsefulValue(row.name, name);
    row.facilitiesSet.add(contract.facility || "Needs Classification");
    row.spendValue += annualizedContractSpend(contract);
    if (!row.category && contract.category) row.category = contract.category;
    if (!row.mailingAddress) row.mailingAddress = contract.vendorMailingAddress || contract.vendorAddress || contract.mailingAddress || "";
    if (!row.phone) row.phone = contract.vendorPhone || contract.phone || "";
    if (!row.email) row.email = contract.vendorEmail || contract.email || "";
    if (contract.serviceAddress) row.serviceAddresses.add(contract.serviceAddress);
  }
  return [...byVendor.values()].map(row => ({
    id: row.id || vendorProfileId(row.name),
    name: row.name,
    legalName: row.legalName || row.name,
    dba: row.dba || "",
    facilities: row.facilitiesSet.size,
    contracts: row.contracts,
    spend: formatMoney(row.spendValue),
    insurance: row.insurance,
    insuranceStatus: row.insuranceStatus || row.insurance,
    issues: row.issues,
    category: row.category || "Needs Classification",
    status: row.status || "Needs Review",
    mailingAddress: row.mailingAddress || "Needs Vendor Address",
    remitAddress: row.remitAddress || "",
    primaryContact: row.primaryContact || "",
    phone: row.phone || "",
    email: row.email || "",
    website: row.website || "",
    taxId: row.taxId || "",
    paymentTerms: row.paymentTerms || "",
    notes: row.notes || "",
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    serviceAddresses: [...row.serviceAddresses]
  }));
}

function vendorLightSummaries(records = allContracts(), limit = 0) {
  const byVendor = new Map();
  const vendorProfiles = listVendorProfiles();
  const vendorAliasKeys = new Map();
  for (const profile of vendorProfiles) {
    const name = profile.name || profile.legalName || "";
    const key = canonicalNameKey(name);
    if (!key) continue;
    for (const alias of profileAliases(profile)) {
      const aliasKey = canonicalNameKey(alias);
      if (aliasKey) vendorAliasKeys.set(aliasKey, key);
    }
    byVendor.set(key, {
      id: profile.id || vendorProfileId(name),
      name,
      legalName: profile.legalName || name,
      dba: profile.dba || "",
      category: profile.category || "",
      status: profile.status || "Active",
      mailingAddress: profile.mailingAddress || "",
      phone: profile.phone || "",
      email: profile.email || "",
      aliases: Array.isArray(profile.aliases) ? profile.aliases : [],
      facilities: 0,
      contracts: 0,
      spend: "$0",
      insurance: profile.insuranceStatus || profile.insurance || "Unknown",
      issues: profile.issues || "None"
    });
  }
  for (const contract of records) {
    const name = contract.vendor || "";
    const rawKey = canonicalNameKey(name);
    const key = vendorAliasKeys.get(rawKey) || rawKey;
    if (!key) continue;
    const row = byVendor.get(key) || {
      id: vendorProfileId(name),
      name,
      legalName: name,
      dba: "",
      category: "",
      status: "Active",
      mailingAddress: "",
      phone: "",
      email: "",
      facilities: 0,
      contracts: 0,
      spend: "$0",
      insurance: "Unknown",
      issues: "None"
    };
    row.contracts = Number(row.contracts || 0) + 1;
    row.category = row.category || contract.category || "";
    row.spendValue = Number(row.spendValue || 0) + annualizedContractSpend(contract);
    row.spend = formatMoney(row.spendValue);
    byVendor.set(key, row);
  }
  return [...byVendor.values()]
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
    .slice(0, limit > 0 ? limit : undefined)
    .map(({ spendValue, ...row }) => row);
}

function categorySummaries(records = allContracts()) {
  const byCategory = new Map();
  for (const category of getAdminSettings().categories || []) {
    byCategory.set(category, { category, contracts: 0, spendValue: 0, expiring90: 0, highRisk: 0, missing: 0 });
  }
  for (const contract of records) {
    const name = contract.category || "Needs Classification";
    if (!byCategory.has(name)) {
      byCategory.set(name, { category: name, contracts: 0, spendValue: 0, expiring90: 0, highRisk: 0, missing: 0 });
    }
    const row = byCategory.get(name);
    row.contracts += 1;
    row.spendValue += annualizedContractSpend(contract);
    const alert = contractAlertDate(contract);
    if (alert?.days !== null && alert?.days >= 0 && alert?.days <= 90) row.expiring90 += 1;
    if (["Critical", "High", "High Risk"].includes(contract.risk) || contract.status === "High Risk") row.highRisk += 1;
  }
  return [...byCategory.values()].map(row => ({ ...row, spend: formatMoney(row.spendValue) }));
}

function costReportRows(records = allContracts()) {
  return categorySummaries(records)
    .filter(row => row.contracts)
    .map(row => [row.category, "All facilities", `${row.contracts} contracts`, "Pending benchmark", "Pending", row.spend, "$0", "$0"]);
}

function cleanOcrText(text) {
  return String(text || "")
    .replace(/^--- Embedded PDF Text ---$/gm, "")
    .replace(/^--- Page \d+ ---$/gm, "")
    .replace(/\[PDF rendered with [^\]]+\]\.?/g, "")
    .replace(/\[OCR limited to[^\]]+\]\.?/g, "")
    .replace(/fliARMAcy/gi, "Pharmacy")
    .replace(/\bAssocates\b/gi, "Associates")
    .replace(/\bDent\s*serve\b/gi, "DentServe")
    .replace(/\bper\s*mile\b/gi, "per mile")
    .replace(/\bpermile\b/gi, "per mile")
    .replace(/\bper\s*(?:sq\.?\s*ft|square\s*(?:foot|feet|ft))\b/gi, "per square foot")
    .replace(/\bper\s*(?:linear\s*(?:foot|feet|ft)|lf)\b/gi, "per linear foot")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function snippetAround(text, index, length = 180) {
  if (index < 0) return "";
  const start = Math.max(0, index - 70);
  return text.slice(start, start + length).replace(/\s+/g, " ").trim();
}

function cleanExtractedFieldValue(label, value) {
  const canonical = String(label || "").toLowerCase().trim();
  let text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  if (["initial contract length", "contract length", "term", "renewal term"].includes(canonical)) {
    const compact = cleanTermValue(text);
    const exact = compact.match(/\b(?:initial\s+)?(?:term|period)\s+of\s+((?:(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)(?:\s*\(\s*\d+\s*\))?\s+)?(?:year|years|month|months|day|days))\b/i)
      || compact.match(/\bfor\s+(?:an?\s+)?(?:initial\s+)?(?:term|period)?\s*(?:of\s+)?((?:(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)(?:\s*\(\s*\d+\s*\))?\s+)?(?:year|years|month|months|day|days))\b/i)
      || compact.match(/\b((?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)(?:\s*\(\s*\d+\s*\))?\s+(?:year|years|month|months|day|days))\b/i);
    return (exact?.[1] || compact)
      .replace(/\(\s*(\d+)\s*\)/g, "($1)")
      .replace(/\bone\s*\(1\)\s+/i, "one (1) ")
      .replace(/\s+and\s+shall.*$/i, "")
      .replace(/\s+thereafter.*$/i, "")
      .replace(/\s+unless.*$/i, "")
      .trim();
  }

  if (["notice period", "termination", "termination notice", "how to terminate"].includes(canonical)) {
    if (isInsuranceNoticeContext(text)) return "";
    const exact = text.match(/\b((?:thirty|sixty|ninety|one hundred twenty|\d{1,3})(?:\s*\(\s*\d{1,3}\s*\))?\s+days?(?:'\s*)?(?:\s+(?:prior|advance|written))?(?:\s+(?:written\s+)?notice)?)\b/i)
      || text.match(/\b((?:\d{1,3})\s+days?\s+(?:prior\s+to|before|advance|written\s+notice))\b/i);
    return (exact?.[1] || text)
      .replace(/\s+will\s+be\s+sent.*$/i, "")
      .replace(/\s+to\s+additional\s+insured.*$/i, "")
      .replace(/\s+of\s+its\s+giving\s+of\s+/i, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (canonical === "payment terms") {
    const payment = cleanPaymentTermsValue(text);
    return payment || "";
  }

  if (["rate / fee", "fee", "cost", "contract value", "monthly cost", "per-day / unit rate"].includes(canonical)) {
    if (/\b(?:insurance|liability|claim|occurrence|aggregate|deductible|additional insured|policy|coverage)\b/i.test(text)) return "";
    if (!/(\$|\b\d+(?:\.\d+)?\s*%|\b(?:percent|fee schedule|rate|fee|charge|cost|monthly|annual|annually|minimum|surcharge|flat fee|hourly|per month|per day|per mile|per visit|per square foot|per sq ft|per linear foot|per pickup|per trip|per load|per test|per box|per container|per meal|per session|per service call|per diem|ppd)\b)/i.test(text)) return "";
    const exact = text.match(/(\$[\d,]+(?:\.\d{2})?(?:\s*(?:\/|per)\s*(?:mile|gallon|visit|pickup|trip|load|test|box|container|meal|session|service\s*call|month|year|hour|day|resident|patient|bed|resident\s*day|patient\s*day|diem|trap|unit|service|delivery|square\s*(?:foot|feet|ft)|sq\.?\s*ft|linear\s*(?:foot|feet|ft)|lf|yard|ton))?)/i);
    return (exact?.[1] || text)
      .replace(/\s*(?:confidential|financial information|agreements|billing).*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (["service pricing detail", "fee details", "pricing detail"].includes(canonical)) {
    if (/\b(confidential|financial information|agreements|billing|indemnification|liability|insurance)\b/i.test(text)) return "";
    if (!/(\$|\b\d+(?:\.\d+)?\s*%|\b(?:fee schedule|rate|fee|price|pricing|charge|cost|minimum|surcharge|flat fee|per month|per day|per mile|per visit|per square foot|per sq ft|per linear foot|per pickup|per trip|per load|per test|per box|per container|per meal|per session|per service call|per diem|ppd)\b)/i.test(text)) return "";
    return text.replace(/\s+/g, " ").trim();
  }

  if (["vendor", "facility", "vendor contact"].includes(canonical)) {
    return cleanPartyName(text)
      .replace(/\b(?:between|whereas|with|to company|to client|attn|attention)\b[:\s-]*/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  if (["auto renewal", "auto-renewal", "auto renew", "automatic renewal"].includes(canonical)) {
    if (/\b(no automatic renewal|does not automatically renew|will not automatically renew|shall not automatically renew|will not renew|shall not renew)\b/i.test(text)) return "No";
    if (/\b(ongoing|continues? until terminated|remains? in effect until terminated|no fixed term)\b/i.test(text)) return "Ongoing";
    if (/\b(automatically renew|auto-renew|renews automatically|successive|additional renewal|renewal term|unless terminated|unless either party)\b/i.test(text)) return "Yes";
    if (/^(yes|no|ongoing|unknown)$/i.test(text)) return text.replace(/^./, match => match.toUpperCase());
    return "";
  }

  return text;
}

function extractedField(label, value, confidence, source, snippet = "") {
  return { label, value: cleanExtractedFieldValue(label, value), confidence, source, snippet, approved: false };
}

function reviewFieldSaveProblem(field = {}) {
  const label = reviewFieldCanonicalLabel(field.label || "");
  const display = reviewDisplayFieldLabel(label, field.label || "Field");
  const value = String(field.value || "").trim();
  const examples = {
    "payment terms": "Use a payment term such as Net 30, 30 days, due within 45 days, payable within 60 days, Unknown, or Not stated.",
    cost: "Use a cost answer such as $500/month, $2.00 per mile, $25 per square foot, fee schedule attached, or No charge.",
    "auto renew": "Use Yes, No, Ongoing, Unknown, or Not stated. Ongoing means the agreement continues until terminated without a renewal event.",
    "how to terminate": "Use the notice wording, such as 30 days written notice, immediate for cause, Unknown, or Not stated.",
    vendor: "Enter the vendor/company name only, not a sentence from the contract.",
    facility: "Choose or type the facility name.",
    "contract type": "Choose or type the service/category, such as HVAC, Medical Director, Transportation, Pharmacy, or Other.",
    "effective date": "Use a date from the contract, such as 01/01/2026, July 1, 2026, Unknown, or Not stated."
  };
  return {
    error: `${display} needs an answer.`,
    detail: value
      ? `"${value}" could not be saved for ${display}. ${examples[label] || "Enter the value exactly as it should appear on the contract record."}`
      : `${display} is blank. ${examples[label] || "Enter the value from the contract, then save again."}`,
    fields: [{ label: display, value, reason: "Not saved" }],
    nextStep: examples[label] || "Enter a clear value from the contract, then click Save Field again."
  };
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return { match, value: (match[1] || match[0]).trim(), index: match.index || 0 };
  }
  return null;
}

function firstContextMatch(text, patterns, predicate) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = (match[1] || match[0]).trim();
    const index = match.index || 0;
    const snippet = snippetAround(text, index, 300);
    if (!predicate || predicate(snippet, value)) return { match, value, index };
  }
  return null;
}

function cleanPartyName(value) {
  return String(value || "")
    .replace(/\bWeliness\b/gi, "Wellness")
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*$/, "")
    .trim();
}

function isBadExtractedPartyName(value) {
  const clean = cleanPartyName(value).toLowerCase();
  if (!clean || clean.length < 3 || clean.length > 120) return true;
  if (/[\\{}[\]|<>]/.test(clean)) return true;
  if ((clean.match(/[^a-z0-9\s&.,'()-]/g) || []).length >= 2) return true;
  if (/\b(waiving party|written and signed|unless it is in writing|herein|hereto|patient requires|institution determines|covered entity as a result)\b/.test(clean)) return true;
  if (/^(the\s+)?(parties|party|company|vendor|provider|supplier|customer|client|facility|contractor|owner|operator)(\s+hereto)?$/.test(clean)) return true;
  if (/\b(herein|hereto|foregoing|whereas|agreement|contract|terms|conditions|obligations|provisions)\b/.test(clean) && clean.split(/\s+/).length <= 5) return true;
  return false;
}

function normalizeNameForMatch(value, options = {}) {
  const normalized = cleanPartyName(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bl\.?\s*l\.?\s*c\.?\b/g, " llc ")
    .replace(/\bc\.?\s*o\.?\b/g, " company ")
    .replace(/\bcorp\.?\b/g, " corporation ")
    .replace(/\binc\.?\b/g, " incorporated ")
    .replace(/\bctr\b/g, " center ")
    .replace(/\bcentre\b/g, " center ")
    .replace(/\brehab\b/g, " rehabilitation ")
    .replace(/\bhc\b/g, " healthcare ")
    .replace(/\bhealth\s+care\b/g, " healthcare ")
    .replace(/\bnsg\b/g, " nursing ")
    .replace(/\bsnf\b/g, " nursing ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an|incorporated|inc|llc|corp|corporation|co|company|ltd|limited|pllc|llp|lp|pc|dba|doing|business|as)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return options.compact ? normalized.replace(/\s+/g, "") : normalized;
}

function canonicalNameKey(value) {
  return normalizeNameForMatch(value, { compact: true });
}

function vendorLooseKey(value) {
  return normalizeNameForMatch(value)
    .split(/\s+/)
    .filter(word => word && word !== "and")
    .join("");
}

function firstUsefulValue(...values) {
  return values.find(value => String(value || "").trim()) || "";
}

function mergeTextList(...values) {
  return [...new Set(values.flatMap(value => Array.isArray(value) ? value : String(value || "").split(/[;|,]/)).map(item => String(item || "").trim()).filter(Boolean))];
}

function mergeTextListCanonical(...values) {
  const merged = new Map();
  for (const value of mergeTextList(...values)) {
    const canonical = categoryCanonicalName(value);
    const key = canonicalNameKey(canonical || value);
    if (key && !merged.has(key)) merged.set(key, canonical || value);
  }
  return [...merged.values()];
}

function categoryCanonicalName(value) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const key = canonicalNameKey(clean);
  const aliases = {
    electricprovider: "Electric",
    electricity: "Electric",
    power: "Electric",
    naturalgas: "Gas",
    fueloil: "Oil",
    watersewer: "Water / Sewer",
    waterandsewer: "Water / Sewer",
    internettelecom: "Internet / Telecom",
    internetservice: "Internet / Telecom",
    telecom: "Internet / Telecom",
    itsoftware: "IT / Software",
    softwareit: "IT / Software",
    healthcare: "Healthcare Services",
    healthcareservices: "Healthcare Services",
    medicalpractitioner: "Medical Practitioner",
    medicalpractitionervascular: "Medical Practitioner / Vascular",
    therapy: "Rehab / Therapy",
    rehabtherapy: "Rehab / Therapy",
    radiology: "Radiology",
    labdiagnostics: "Lab / Diagnostics",
    dental: "Dental Services",
    dentserv: "Dental Services",
    dentserve: "Dental Services",
    oxygen: "Oxygen",
    medicalgas: "Medical Gas",
    wastemanagement: "Waste Removal",
    trash: "Waste Removal",
    medicalwaste: "Medical Waste",
    grease: "Grease Trap / Interceptor",
    greasetrap: "Grease Trap / Interceptor",
    interceptor: "Grease Trap / Interceptor",
    landscaping: "Landscape / Lawn Care",
    landscape: "Landscape / Lawn Care",
    lawn: "Landscape / Lawn Care",
    lawncare: "Landscape / Lawn Care",
    snowplow: "Snow Removal",
    snowplowing: "Snow Removal",
    snowremoval: "Snow Removal",
    launderylien: "Laundry / Linen",
    laundrylinen: "Laundry / Linen",
    fooddietary: "Food / Dietary",
    foodservice: "Food / Dietary",
    dietary: "Food / Dietary",
    firesafetysprinkler: "Fire Safety / Sprinkler",
    firealarmcentralmonitoring: "Fire / Alarm / Central Monitoring",
    centralmonitoring: "Fire / Alarm / Central Monitoring",
    firesuppression: "Fire / Suppression",
    pest: "Pest Control",
    pestcontrol: "Pest Control",
    medicaldirector: "Medical Director",
    physicianservices: "Physician Services",
    psychologicalservices: "Psychological Services",
    legalcompliance: "Legal / Compliance",
    equipmentlease: "Equipment Lease",
    consultingmanagement: "Consulting / Management"
  };
  return aliases[key] || clean
    .replace(/\bIT\/Software\b/i, "IT / Software")
    .replace(/\bInternet\/Telecom\b/i, "Internet / Telecom")
    .replace(/\bWater\/Sewer\b/i, "Water / Sewer")
    .replace(/\bFood\/Dietary\b/i, "Food / Dietary")
    .replace(/\bLegal\/Compliance\b/i, "Legal / Compliance");
}

function cleanAddress(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*$/, "")
    .trim();
}

function firstMeaningfulLine(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line =>
      line.length >= 6
      && line.length <= 140
      && !/^page\s+\d+/i.test(line)
      && !/^---/.test(line)
      && !/embedded pdf text/i.test(line)
      && !/pdf rendered with/i.test(line)
      && !/ocr limited to/i.test(line)
      && !/docusign envelope id/i.test(line)
      && !/entire agreement/i.test(line)
      && !/^[\W_]+$/.test(line)
      && (line.match(/[A-Za-z]/g) || []).length >= 4
      && (line.match(/[\x00-\x1f\x7f-\x9f]/g) || []).length < 2
    ) || "";
}

function isBadContractTitle(value = "") {
  const clean = cleanContractDisplayName(value);
  const lower = clean.toLowerCase();
  if (!clean || clean.length < 4 || clean.length > 90) return true;
  if (/^(agreement|contract|service agreement|master agreement|this agreement)$/i.test(clean)) return true;
  if (/\b(this agreement|entire agreement|paragraph|subcontract|herein|hereto|shall be|contained in|subject matter|supersedes|provisions|terms and conditions|governing law)\b/i.test(clean)) return true;
  if ((clean.match(/\b(of|the|this|shall|be|in|and|or|to|for|any)\b/gi) || []).length > 5) return true;
  if (!/\b(agreement|contract|service|services|lease|schedule|proposal|statement|addendum|amendment|order|license)\b/i.test(lower) && clean.split(/\s+/).length > 7) return true;
  return false;
}

function isLikelyAccountValue(value) {
  const clean = String(value || "").trim();
  if (clean.length < 4 || clean.length > 40) return false;
  if (/\b(herein|referred|called|terms|agreement|services)\b/i.test(clean)) return false;
  return /\d/.test(clean) || /^[A-Z]{2,}[-\s]?[A-Z0-9]{3,}$/i.test(clean);
}

function parseOcrDate(value) {
  const clean = String(value || "").trim();
  if (!clean) return null;
  const date = new Date(clean);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function derivedContractLength(startValue, endValue) {
  const start = parseOcrDate(startValue);
  const end = parseOcrDate(endValue);
  if (!start || !end || end <= start) return "";
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const months = Math.round(days / 30.4375);
  const years = months / 12;
  if (months >= 12 && Math.abs(Math.round(years) - years) < 0.15) {
    const roundedYears = Math.round(years);
    return `${roundedYears} year${roundedYears === 1 ? "" : "s"} (${startValue} to ${endValue})`;
  }
  if (months >= 1) return `${months} month${months === 1 ? "" : "s"} (${startValue} to ${endValue})`;
  return `${days} day${days === 1 ? "" : "s"} (${startValue} to ${endValue})`;
}

function numberWordToNumber(value) {
  const clean = String(value || "").toLowerCase().trim();
  const words = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12
  };
  return Number(clean) || words[clean] || 0;
}

function formatOcrDate(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function addMonthsToOcrDate(value, months) {
  const date = parseOcrDate(value);
  if (!date || !months) return "";
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  next.setUTCMonth(next.getUTCMonth() + months);
  return formatOcrDate(next);
}

function cleanTermValue(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\bone\s+(?:qd\)|q\)|\(\s*\)|[o0]\))\s+year\b/i, "one year")
    .replace(/\bone\s*\(\s*1\s*\)\s+year\b/i, "one year")
    .replace(/^of\s+(this\s+)?agreement\s+shall\s+be\s+for\s+a\s+(period|term)\s+of\s+/i, "")
    .replace(/^shall\s+be\s+for\s+a\s+(period|term)\s+of\s+/i, "")
    .replace(/^for\s+a\s+(period|term)\s+of\s+/i, "")
    .replace(/\b(\d{2,3}|\([2-9]\d*\))\s+(month|year|day)\b/gi, "$1 $2s")
    .replace(/\s+commencing\s+on\s+.*$/i, "")
    .replace(/\s+beginning\s+on\s+.*$/i, "")
    .replace(/\s+starting\s+on\s+.*$/i, "")
    .replace(/\s+unless\s+.*$/i, "")
    .replace(/\s*,?\s*provided\s+that.*$/i, "")
    .replace(/\s*,?\s*subject\s+to.*$/i, "")
    .trim();
}

function cleanPaymentTermsValue(value) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const dayWords = "(?:ten|fifteen|thirty|forty five|forty-five|sixty|ninety|one hundred twenty)";
  const paymentDaysAreReasonable = days => Number.isFinite(days) && days >= 1 && days <= 120 && days !== 106;
  const bareDays = clean.match(new RegExp(`^(?:${dayWords}|\\d{1,3})\\s+days?$`, "i"));
  if (!new RegExp(`(net\\s*\\d{1,3}|within\\s+(?:\\d{1,3}|${dayWords})\\s+days?|due\\s+(?:within|in)\\s+(?:\\d{1,3}|${dayWords})\\s+days?|payable\\s+(?:within|in)\\s+(?:\\d{1,3}|${dayWords})\\s+days?|paid\\s+(?:within|in)\\s+(?:\\d{1,3}|${dayWords})\\s+days?)`, "i").test(clean) && !bareDays) return "";
  const net = clean.match(/\bnet\s*(\d{1,3})\b/i);
  if (net) {
    const days = Number(net[1]);
    if (!paymentDaysAreReasonable(days)) return "";
  }
  if (bareDays) {
    const wordDays = { ten: 10, fifteen: 15, thirty: 30, "forty five": 45, "forty-five": 45, sixty: 60, ninety: 90, "one hundred twenty": 120 };
    const raw = bareDays[0].replace(/\s+days?$/i, "").toLowerCase();
    const days = Number(raw) || wordDays[raw] || 0;
    if (!paymentDaysAreReasonable(days)) return "";
    return clean;
  }
  const short = clean.match(/\bnet\s*\d{1,3}\b/i)
    || clean.match(new RegExp(`\\b(?:due|payable|paid)\\s+(?:within|in)\\s+(?:\\d{1,3}|${dayWords})\\s+days?(?:\\s+(?:after|from|following)\\s+(?:receipt\\s+of\\s+)?(?:invoice|invoicing|statement))?`, "i"))
    || clean.match(new RegExp(`\\b(?:\\d{1,3}|${dayWords})\\s+days?\\s+(?:after|from|following)\\s+(?:receipt\\s+of\\s+)?(?:invoice|invoicing|statement)`, "i"));
  return (short?.[0] || clean).replace(/\s+/g, " ").trim();
}

function extractDaysPayable(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const net = text.match(/\bnet\s*(\d{1,3})\b/i);
  if (net) return `${net[1]} days`;
  const numeric = text.match(/\b(?:within|in|due\s+in|payable\s+within|paid\s+within)\s+(\d{1,3})\s*(?:calendar\s+)?days?\b/i)
    || text.match(/\bdue\s+(\d{1,3})\s*(?:calendar\s+)?days?\s+(?:after|from|following)\b/i);
  if (numeric) return `${numeric[1]} days`;
  const written = [
    ["forty five", 45],
    ["forty-five", 45],
    ["thirty", 30],
    ["sixty", 60],
    ["ninety", 90],
    ["fifteen", 15],
    ["ten", 10]
  ].find(([word]) => new RegExp(`\\b${word}\\b\\s*(?:calendar\\s+)?days?`, "i").test(text));
  return written ? `${written[1]} days` : "";
}

function isRelatedContractDocument(name = "", text = "") {
  const combined = `${name || ""} ${String(text || "").slice(0, 5000)}`;
  return /\b(addendum|amendment|amended|modification|rider|supplement|extension|change\s+order)\b/i.test(combined);
}

function relatedDocumentType(name = "", text = "") {
  const combined = `${name || ""} ${text || ""}`;
  if (/\bamend/i.test(combined)) return "Amendment";
  if (/\baddendum\b/i.test(combined)) return "Addendum";
  if (/\brider\b/i.test(combined)) return "Rider";
  if (/\bextension\b/i.test(combined)) return "Extension";
  if (/\bchange\s+order\b/i.test(combined)) return "Change Order";
  if (/\bsupplement\b/i.test(combined)) return "Supplement";
  return "Related Document";
}

function contractMatchScoreForDocument(parent, child, text) {
  if (!parent || !child || parent.id === child.id) return { score: 0, reasons: [] };
  const clean = cleanOcrText(text).toLowerCase();
  let score = 0;
  const reasons = [];
  const parentName = parent.documentTitle || parent.name || "";
  const vendor = child.vendor && child.vendor !== "Needs Classification" ? child.vendor : "";
  const facility = child.facility && child.facility !== "Needs Classification" ? child.facility : "";
  const category = child.category && child.category !== "Needs Classification" ? child.category : "";

  if (vendor && normalizeNameForMatch(vendor, { compact: true }) === normalizeNameForMatch(parent.vendor, { compact: true })) {
    score += 35;
    reasons.push("same vendor");
  } else if (parent.vendor && textContainsValue(clean, parent.vendor)) {
    score += 24;
    reasons.push("vendor appears in addendum text");
  }

  if (facility && normalizeNameForMatch(facility, { compact: true }) === normalizeNameForMatch(parent.facility, { compact: true })) {
    score += 30;
    reasons.push("same facility");
  } else if (parent.facility && textContainsValue(clean, parent.facility)) {
    score += 24;
    reasons.push("facility appears in addendum text");
  }

  if (category && normalizeNameForMatch(category, { compact: true }) === normalizeNameForMatch(parent.category, { compact: true })) {
    score += 12;
    reasons.push("same service type");
  }
  if (parentName && textContainsValue(clean, parentName)) {
    score += 28;
    reasons.push("parent contract name appears in text");
  }
  if (parent.id && clean.includes(String(parent.id).toLowerCase())) {
    score += 20;
    reasons.push("parent contract id appears in text");
  }
  return { score, reasons };
}

function parentCandidatesForRelatedDocument(child = {}, limit = 250) {
  const vendor = hasUsefulContractValue(child.vendor) ? String(child.vendor).trim() : "";
  const facility = hasUsefulContractValue(child.facility) ? String(child.facility).trim() : "";
  const clauses = [];
  const values = [child.id || ""];
  if (vendor) {
    clauses.push("lower(trim(coalesce(vendor, ''))) = lower(trim(?))");
    values.push(vendor);
  }
  if (facility) {
    clauses.push("lower(trim(coalesce(facility, ''))) = lower(trim(?))");
    values.push(facility);
  }
  values.push(Math.max(1, Math.min(Number(limit) || 250, 500)));
  const matchWhere = clauses.length ? `AND (${clauses.join(" OR ")})` : "";
  return db.prepare(`
    SELECT data
    FROM contracts
    WHERE id <> ? ${matchWhere}
    ORDER BY updated_at DESC, created_at DESC, id DESC
    LIMIT ?
  `).all(...values).map(rowToRecord);
}

function findParentContractForRelatedDocument(child, text, records = null) {
  const candidates = (Array.isArray(records) ? records : parentCandidatesForRelatedDocument(child)).filter(parent =>
    parent.id !== child.id
    && !parent.parentContractId
    && !/^(addendum|amendment|rider|extension|change order|supplement|related document)$/i.test(parent.documentType || "")
  );
  const scored = candidates
    .map(parent => ({ parent, ...contractMatchScoreForDocument(parent, child, text) }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score >= 45 ? scored[0] : null;
}

function attachRelatedDocument(parent, child, job, text, match) {
  const now = new Date().toISOString();
  const docType = relatedDocumentType(child.name || child.uploadedFileName, text);
  const relatedDoc = {
    id: child.id,
    type: docType,
    name: child.name || child.uploadedFileName || docType,
    uploadedFileName: child.uploadedFileName || "",
    localFilePath: child.localFilePath || "",
    shareSyncUrl: child.shareSyncUrl || "",
    date: child.signatureDate || child.signedDate || child.start || now.slice(0, 10),
    status: "Needs Review",
    ocrJobId: job?.id || "",
    matchConfidence: match?.score || 0,
    matchReasons: match?.reasons || [],
    createdAt: now
  };
  const existing = Array.isArray(parent.relatedDocuments) ? parent.relatedDocuments : [];
  const keyFor = doc => doc.id || doc.localFilePath || doc.shareSyncUrl || doc.name;
  const key = keyFor(relatedDoc);
  parent.relatedDocuments = existing.some(doc => keyFor(doc) === key) ? existing : [relatedDoc, ...existing];
  parent.updatedAt = now;
  saveContract(parent);
  return relatedDoc;
}

function cleanFeeContext(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:;,-]+|[\s:;,-]+$/g, "")
    .trim();
}

function hasUnreadableOcrText(value) {
  const text = String(value || "");
  if (!text) return false;
  const bad = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uE000-\uF8FF\uFFFD]/g) || []).length;
  const readable = (text.match(/[a-z0-9$%.,:/()\-\s]/gi) || []).length;
  return bad >= 2 || (bad > 0 && bad / Math.max(text.length, 1) > 0.025) || (text.length > 12 && readable / text.length < 0.55);
}

function embeddedPdfTextIsCorrupt(value) {
  const text = String(value || "");
  if (!text.trim()) return true;
  const bad = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uE000-\uF8FF\uFFFD]/g) || []).length;
  const strange = (text.match(/[^\x09\x0A\x0D\x20-\x7E\u00A0\u2010-\u201F\u2022\u2026]/gu) || []).length;
  const oddRuns = (text.match(/[^\x09\x0A\x0D\x20-\x7E]{3,}/gu) || []).length;
  const readable = (text.match(/[a-z0-9$%.,:/()\-\s]/gi) || []).length;
  const letters = (text.match(/[a-z]/gi) || []).length;
  const length = Math.max(text.length, 1);
  const wordHits = (text.match(/\b(?:agreement|contract|vendor|facility|service|term|payment|invoice|notice|effective|terminate|fee|rate|charge|client|customer|provider)\b/gi) || []).length;
  return bad >= 2
    || bad / length > 0.025
    || strange / length > 0.035
    || oddRuns >= 3
    || (text.length > 250 && readable / length < 0.55)
    || (text.length > 250 && letters < 25)
    || (text.length > 750 && wordHits < 2 && strange / length > 0.015);
}

function cleanFeeServiceText(value) {
  const clean = cleanFeeContext(value);
  if (!clean || hasUnreadableOcrText(clean)) return "Unclear fee line - review source";
  return clean.slice(0, 90);
}

function inferFeeUnit(text) {
  const clean = String(text || "");
  const unit = clean.match(/\bper\s+(mile|gallon|visit|pickup|pick[-\s]?up|trip|load|test|box|container|meal|session|service\s*call|pump(?:-?out)?|month|year|hour|day|resident|patient|bed|room|trap|unit|service|delivery|square\s*(?:foot|feet|ft)|sq\.?\s*ft|linear\s*(?:foot|feet|ft)|lf|yard|ton)\b/i)
    || clean.match(/\/\s*(mile|gallon|visit|pickup|trip|load|test|box|container|meal|session|month|year|hour|day|resident|patient|bed|room|unit|sq\.?\s*ft|sf|lf|yard|ton)\b/i);
  if (!unit) return "";
  return unit[1]
    .replace(/pump-?out/i, "pump-out")
    .replace(/pick[-\s]?up/i, "pickup")
    .replace(/square\s*(?:foot|feet|ft)|sq\.?\s*ft|sf/i, "square foot")
    .replace(/linear\s*(?:foot|feet|ft)|lf/i, "linear foot")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function inferFeeFrequency(text) {
  const match = String(text || "").match(/\b(monthly|annually|annual|yearly|weekly|daily|quarterly|per visit|per pickup|per service|one-time|one time)\b/i);
  return match ? match[1].replace(/^annual$/i, "annually").toLowerCase() : "";
}

function cleanFeeRate(value) {
  const text = String(value || "");
  const money = text.match(/[\$¢]\s*\d(?:[\d,]*\d)?(?:\.\d{1,2})?/);
  if (money) return money[0].replace(/^¢/, "$").replace(/\s+/g, "").replace(/,+$/g, "");
  const percent = text.match(/\b\d+(?:\.\d+)?\s*%/);
  if (percent && /\b(?:fee schedule|rate schedule|medicare|medicaid|allowable|allowed|discount|off|of charges|charge|rate|fee)\b/i.test(text)) {
    return percent[0].replace(/\s+/g, "");
  }
  if (/\b(?:medicare|medicaid|applicable|published|current|then-current|standard)\b[^.\n\r]{0,120}\b(?:fee schedule|rate schedule|allowable|allowed amount)\b/i.test(text)
    || /\b(?:fee schedule|rate schedule)\b[^.\n\r]{0,120}\b(?:medicare|medicaid|allowable|allowed amount)\b/i.test(text)) {
    return "Fee schedule";
  }
  if (/\bno\s+(?:charge|fee|cost|compensation)\b|\bwithout\s+charge\b|\bat\s+no\s+cost\b/i.test(text)) return "No charge";
  return "";
}

function feeFrequencyLabel(value = "") {
  const text = String(value || "");
  if (/\b(?:m(?:ont)?hly|hly)\s+recurring\b/i.test(text) || /\bmonthly\b/i.test(text)) return "Monthly";
  if (/\bnon[-\s]?recurring\b/i.test(text) || /\bone[-\s]?time\b/i.test(text)) return "One-time";
  if (/\bannual|annually|yearly\b/i.test(text)) return "Annual";
  if (/\bweekly\b/i.test(text)) return "Weekly";
  if (/\bquarterly\b/i.test(text)) return "Quarterly";
  return inferFeeFrequency(text);
}

function cleanFeeServiceName(value = "", rate = "") {
  const text = cleanFeeContext(value)
    .replace(/\|/g, " ")
    .replace(/\bservice order total\b/ig, " ")
    .replace(/[\$¢]\s*\d(?:[\d,]*\d)?(?:\.\d{2})?/g, " ")
    .replace(/\b(?:shall|will|be|paid|payable|charged|for|the|a|an|rate|fee|charge|cost|price|amount|is|of|total)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const raw = `${value || ""}`;
  if (rate === "$0.00" && /\bnon[-\s]?recurring\b/i.test(raw)) return "No non-recurring charge";
  if (/\b(?:m(?:ont)?hly|hly)\s+recurring\b/i.test(raw) || /\bmonthly recurring\b/i.test(raw)) return "Monthly recurring charge";
  if (/\bnon[-\s]?recurring\b/i.test(raw)) return "Non-recurring charge";
  if (/minimum/i.test(raw)) return "Minimum charge";
  return cleanFeeServiceText(text) || "Fee / charge";
}

function feeLineKey(line = {}) {
  return [
    normalizeMatchValue(line.service || ""),
    normalizeMatchValue(line.rate || ""),
    normalizeMatchValue(line.frequency || ""),
    normalizeMatchValue(line.unit || "")
  ].join("|");
}

function pushFeeLine(lines, seen, line) {
  const rate = cleanFeeRate(line.rate);
  if (!rate) return false;
  const source = cleanFeeContext(line.source || "");
  const service = cleanFeeServiceName(line.service || source, rate);
  const normalized = {
    service,
    unit: line.unit || inferFeeUnit(source),
    rate,
    frequency: line.frequency || feeFrequencyLabel(`${line.service || ""} ${source}`),
    chargeType: line.chargeType || "",
    quantity: line.quantity || "",
    calculatedAmount: line.calculatedAmount || "",
    includedInRecurringTotal: Boolean(line.includedInRecurringTotal),
    source,
    sourceNeedsReview: Boolean(line.sourceNeedsReview || hasUnreadableOcrText(source)),
    approved: false
  };
  if (!normalized.service || hasUnreadableOcrText(normalized.service)) normalized.service = "Unclear fee line - review source";
  const key = feeLineKey(normalized);
  if (seen.has(key)) return false;
  seen.add(key);
  lines.push(normalized);
  return true;
}

function extractPricingSummaryLines(text, lines, seen) {
  const clean = cleanOcrText(text);
  const money = value => String(value || "").replace(/\s+/g, "");
  const add = line => pushFeeLine(lines, seen, line);

  // Telecom and other service orders frequently show a unit subtotal, quantity,
  // and calculated monthly total in separate OCR lines. Preserve all three as
  // one auditable cost row instead of treating each number as an unrelated fee.
  for (const match of clean.matchAll(/unit\s+price\s+subtotal\s*:?\s*(\$\s*[\d,]+(?:\.\d{1,2})?)[\s\S]{0,180}?number\s+of\s+units\s*:?\s*(\d{1,6})[\s\S]{0,180}?(?:monthly\s+unit\s+price\s+total|monthly\s+subtotal|monthly\s+grand\s+total)\s*:?\s*(\$\s*[\d,]+(?:\.\d{1,2})?)/gi)) {
    add({
      service: "Unit-based recurring service",
      rate: money(match[1]),
      unit: "unit",
      quantity: match[2],
      calculatedAmount: money(match[3]),
      frequency: "Monthly",
      chargeType: "Recurring",
      source: cleanFeeContext(match[0])
    });
  }

  const labeledPatterns = [
    { service: "Monthly recurring total", chargeType: "Recurring", frequency: "Monthly", regex: /(?:total\s+monthly\s+recurring|monthly\s+(?:grand\s+)?total|total\s+mrc|service\s+order\s+total\s+monthly\s+recurring)\s*(?:charge)?\s*:?\s*(\$\s*[\d,]+(?:\.\d{1,2})?)/gi },
    { service: "One-time charge", chargeType: "One-time", frequency: "One-time", regex: /(?:total\s+non[-\s]?recurring|total\s+nrc|installation\s+fee|one[-\s]?time\s+(?:fee|charge))\s*:?\s*(\$\s*[\d,]+(?:\.\d{1,2})?)/gi },
    { service: "Estimated taxes", chargeType: "Tax", frequency: "Monthly", regex: /estimated\s+tax(?:es)?\s*:?\s*(\$\s*[\d,]+(?:\.\d{1,2})?)/gi },
    { service: "Equipment financing payment", chargeType: "Financing", frequency: "Monthly", regex: /(?:number\s+of\s+payments\s*:?\s*(\d{1,4})[\s\S]{0,100}?)?(?:payment\s+amount|monthly\s+payment)\s*:?\s*(\$\s*[\d,]+(?:\.\d{1,2})?)/gi },
    { service: "Equipment financing payment", chargeType: "Financing", frequency: "Monthly", regex: /(\d{1,4})\s+payments?\s*(?:of|x|at)?\s*(\$\s*[\d,]+(?:\.\d{1,2})?)/gi },
    { service: "Subsidy / credit", chargeType: "Credit", frequency: "One-time", regex: /(?:subsidy|credit|allowance)\s+(?:amount|total)?\s*:?\s*(\$\s*[\d,]+(?:\.\d{1,2})?)/gi },
    { service: "Cancellation exposure", chargeType: "Contingent", frequency: "", regex: /(?:cancellation|early\s+termination|termination)\s+(?:fee|charge|amount)\s*:?\s*(\$\s*[\d,]+(?:\.\d{1,2})?)/gi }
  ];
  for (const pattern of labeledPatterns) {
    for (const match of clean.matchAll(pattern.regex)) {
      const value = money(match[2] || match[1]);
      if (pattern.chargeType === "Recurring" && lines.some(line => money(line.calculatedAmount) === value)) continue;
      add({
        service: pattern.service,
        rate: value,
        quantity: pattern.chargeType === "Financing" ? (match[1] || "") : "",
        frequency: pattern.frequency,
        chargeType: pattern.chargeType,
        source: cleanFeeContext(match[0])
      });
    }
  }
}

function extractStructuredFeeLines(chunk) {
  const lines = [];
  const patterns = [
    {
      service: "Monthly recurring charge",
      frequency: "Monthly",
      regex: /(?:service\s+order\s+total\s+)?(?:m(?:ont)?hly|hly)\s+recurring\s+charge?\s*:?\s*([\$¢]\s*\d(?:[\d,]*\d)?(?:\.\d{2})?)/ig
    },
    {
      service: "Non-recurring charge",
      frequency: "One-time",
      regex: /(?:service\s+order\s+total\s+)?non[-\s]?recurring\s+charge?\s*:?\s*([\$¢]\s*\d(?:[\d,]*\d)?(?:\.\d{2})?)/ig
    },
    {
      service: "Minimum charge",
      frequency: "",
      regex: /([\$¢]\s*\d(?:[\d,]*\d)?(?:\.\d{2})?)\s+minimum\b/ig
    },
    {
      service: "Base fee",
      frequency: "",
      regex: /(?:base|standard|minimum|monthly)\s+(?:fee|charge|rate|cost)\s*(?:is|:|\-)?\s*([\$¢]\s*\d(?:[\d,]*\d)?(?:\.\d{2})?)(?:\s*(?:per|\/)\s*(month|year|week|day))?/ig,
      unitFromMatch: 2
    },
    {
      service: "Additional unit charge",
      frequency: "",
      regex: /(?:additional|extra|overage|excess|each\s+additional|per\s+additional)\s+(?:room|bed|mile|trip|pickup|visit|unit|box|container|hour|service|delivery|square\s*(?:foot|feet|ft)|sq\.?\s*ft|linear\s*(?:foot|feet|ft)|lf|yard|ton)s?\s*(?:is|:|\-)?\s*([\$¢]\s*\d(?:[\d,]*\d)?(?:\.\d{1,2})?)(?:\s*(?:per|\/)\s*([a-z0-9 .-]{2,40}))?/ig,
      unitFromMatch: 2
    },
    {
      service: "Per-unit rate",
      frequency: "",
      regex: /(?:rate\s+of\s*)?([\$¢]\s*\d(?:[\d,]*\d)?(?:\.\d{1,2})?)\s*(?:per|\/)\s+?((?:square\s*)?(?:foot|feet|ft)|sq\.?\s*ft|sf|linear\s*(?:foot|feet|ft)|lf|mile|gallon|visit|pickup|trip|load|test|box|container|meal|session|service\s*call|month|year|hour|day|resident|patient|bed|room|trap|unit|service|delivery|yard|ton)\b/ig,
      unitFromMatch: 2
    },
    {
      service: "Unit rate",
      frequency: "",
      regex: /(?:per|\/)\s*((?:square\s*)?(?:foot|feet|ft)|sq\.?\s*ft|sf|linear\s*(?:foot|feet|ft)|lf|mile|gallon|visit|pickup|trip|load|test|box|container|meal|session|service\s*call|month|year|hour|day|resident|patient|bed|room|trap|unit|service|delivery|yard|ton)\s*(?:rate|fee|charge|cost|price)?\s*(?:is|:|\-)?\s*([\$¢]\s*\d(?:[\d,]*\d)?(?:\.\d{1,2})?)/ig,
      rateFromMatch: 2,
      unitFromMatch: 1
    },
    {
      service: "Fee schedule",
      frequency: "",
      regex: /(\b\d+(?:\.\d+)?\s*%)[^.\n\r]{0,120}\b(?:medicare|medicaid|fee schedule|rate schedule|allowable|allowed amount|charges?)\b/ig
    },
    {
      service: "Fee schedule",
      frequency: "",
      regex: /\b(?:medicare|medicaid|applicable|published|current|then-current|standard)[^.\n\r]{0,120}\b(fee schedule|rate schedule|allowable|allowed amount)\b/ig
    }
  ];
  for (const pattern of patterns) {
    for (const match of chunk.matchAll(pattern.regex)) {
      const unit = pattern.unitFromMatch ? cleanFeeContext(match[pattern.unitFromMatch]).replace(/[.)]+$/g, "") : "";
      const frequencyFromUnit = /^(month|year|week|day)$/i.test(unit) ? feeFrequencyLabel(unit) : "";
      const rateValue = pattern.rateFromMatch ? match[pattern.rateFromMatch] : match[1];
      lines.push({
        service: pattern.service,
        rate: pattern.service === "Fee schedule" && !/\d+(?:\.\d+)?\s*%|\$\s*\d/.test(rateValue || "") ? chunk : rateValue,
        unit: frequencyFromUnit ? "" : unit,
        frequency: pattern.frequency || frequencyFromUnit,
        source: chunk
      });
    }
  }
  return lines;
}

function isPricingContext(text) {
  const clean = String(text || "");
  if (/\b(for example|example only|sample|illustration|hypothetical)\b/i.test(clean)) return false;
  if (/\b(?:insurance|liability|coverage|bond|deductible|additional insured|policy|claim|occurrence|aggregate|umbrella|workers?\s+compensation|automobile liability)\b/i.test(clean)) return false;
  return /\b(?:fee|fees|rate|rates|charge|charges|cost|price|pricing|amount|contract amount|sum of|payment|monthly|annual|annually|base|standard|additional|extra|overage|excess|per\s+(?:mile|gallon|visit|pickup|trip|load|test|box|container|meal|session|service call|month|hour|day|bed|room|unit|service|delivery|square foot|sq ft|linear foot)|labor|material|surcharge|minimum|trip|delivery|service call|service charge)\b/i.test(clean);
}

function isPrimaryFeeContext(text) {
  const clean = String(text || "");
  if (/\b(?:damages?|indemnif|penalt(?:y|ies)|attorneys?'? fees?|court costs?|liability|insurance|subsidy repayment|cancellation|early termination)\b/i.test(clean)) return false;
  return /\b(?:monthly recurring|monthly (?:fee|charge|cost|rate|payment)|mrc|non[-\s]?recurring|nrc|invoice total|service order total|monthly total|grand total|unit price|payment amount|base (?:fee|charge)|installation fee|fee schedule|rate schedule|price schedule|pricing schedule|per\s+(?:mile|gallon|visit|pickup|trip|load|test|box|container|meal|session|service call|month|hour|day|bed|room|unit|service|delivery|square foot|sq ft|linear foot))\b/i.test(clean);
}

function isInsuranceNoticeContext(text) {
  return /\b(?:insurance|liability|certificate|additional insured|policy|coverage|claim|occurrence|aggregate|commercial general liability|workers?\s+compensation|automobile liability|employee dishonesty|bond)\b/i.test(String(text || ""));
}

function isTerminationNoticeContext(text) {
  const clean = String(text || "");
  if (isInsuranceNoticeContext(clean)) return false;
  return /\b(?:terminate|termination|non[-\s]?renewal|cancel|cancellation|either party|this agreement|this contract|written notice|prior notice|advance notice|without cause|for cause)\b/i.test(clean);
}

function extractFeeLines(text) {
  const maxFeeLines = 16;
  const clean = cleanOcrText(text);
  const chunks = clean
    .split(/\n|(?<=\.)\s+|;|(?=\bService Order Total\b)|(?=\b(?:Monthly|Mthly|Hly)\s+Recurring\b)|(?=\bNon[-\s]?Recurring\b)/i)
    .map(cleanFeeContext)
    .filter(chunk => chunk.length >= 8 && chunk.length <= 420 && /([\$¢]\s*\d|\b\d+(?:\.\d+)?\s*%|\bfee schedule\b|\brate schedule\b|\bno\s+(?:charge|fee|cost|compensation)\b|\bat\s+no\s+cost\b)/i.test(chunk));
  const feeWords = /\b(fee|fees|rate|rates|charge|charges|cost|price|pricing|amount|monthly|annual|base|standard|additional|extra|overage|excess|per|percent|medicare|medicaid|fee schedule|rate schedule|allowable|allowed|gallon|mile|visit|pickup|trip|load|test|box|container|meal|session|room|bed|square\s*(?:foot|feet|ft)|sq\.?\s*ft|sf|linear\s*(?:foot|feet|ft)|lf|yard|ton|pump|pumping|disposal|service|cleaning|emergency|surcharge|minimum|delivery|labor|material|trap|interceptor)\b/i;
  const seen = new Set();
  const lines = [];
  extractPricingSummaryLines(clean, lines, seen);
  const hasPricingSummary = lines.length >= 2;
  for (const chunk of chunks) {
    const sourceUnclear = hasUnreadableOcrText(chunk);
    if (!feeWords.test(chunk)) continue;
    if (!isPricingContext(chunk)) continue;
    if (/\bno\s+(?:charge|fee|cost|compensation)\b|\bwithout\s+charge\b|\bat\s+no\s+cost\b/i.test(chunk)) {
      pushFeeLine(lines, seen, {
        service: /\bno\s+compensation\b/i.test(chunk) ? "No compensation" : "No charge",
        rate: "No charge",
        frequency: "",
        source: chunk,
        sourceNeedsReview: sourceUnclear
      });
      if (lines.length >= maxFeeLines) return lines.slice(0, maxFeeLines);
      continue;
    }
    for (const structured of extractStructuredFeeLines(chunk)) {
      pushFeeLine(lines, seen, { ...structured, sourceNeedsReview: sourceUnclear });
      if (lines.length >= maxFeeLines) return lines.slice(0, maxFeeLines);
    }
    if (hasPricingSummary) continue;
    if (!isPrimaryFeeContext(chunk)) continue;
    const moneyMatches = [...chunk.matchAll(/[\$¢]\s*\d(?:[\d,]*\d)?(?:\.\d{1,2})?|\b\d+(?:\.\d+)?\s*%/g)];
    for (const money of moneyMatches) {
      const rate = money[0].replace(/\s+/g, "");
      const before = cleanFeeContext(chunk.slice(0, money.index));
      const after = cleanFeeContext(chunk.slice((money.index || 0) + money[0].length));
      const context = cleanFeeContext(`${before} ${after}`) || "Fee";
      pushFeeLine(lines, seen, {
        service: context,
        unit: inferFeeUnit(chunk),
        rate,
        frequency: feeFrequencyLabel(chunk),
        source: chunk,
        sourceNeedsReview: sourceUnclear
      });
      if (lines.length >= maxFeeLines) return lines.slice(0, maxFeeLines);
    }
  }
  const amountMatches = [...clean.matchAll(/[\$¢]\s*\d(?:[\d,]*\d)?(?:\.\d{1,2})?|\b\d+(?:\.\d+)?\s*%/g)];
  for (const match of amountMatches) {
    if (hasPricingSummary) break;
    const start = Math.max(0, (match.index || 0) - 220);
    const end = Math.min(clean.length, (match.index || 0) + match[0].length + 220);
    const source = cleanFeeContext(clean.slice(start, end));
    const sourceUnclear = hasUnreadableOcrText(source);
    if (!isPricingContext(source)) continue;
    if (!isPrimaryFeeContext(source)) continue;
    pushFeeLine(lines, seen, {
      service: source,
      unit: inferFeeUnit(source),
      rate: match[0],
      frequency: feeFrequencyLabel(source),
      source,
      sourceNeedsReview: sourceUnclear
    });
    if (lines.length >= maxFeeLines) return lines.slice(0, maxFeeLines);
  }
  return lines.slice(0, maxFeeLines);
}

function aliasVariants(value) {
  const clean = String(value || "").trim();
  const normalized = normalizeNameForMatch(clean);
  const variants = [
    clean,
    normalized,
    normalized.replace(/\bhealthcare\b/g, "health care"),
    normalized.replace(/\brehabilitation\b/g, "rehab"),
    normalized.replace(/\bcenter\b/g, "ctr")
  ];
  return variants.map(item => String(item || "").trim()).filter(Boolean);
}

function profileAliases(profile = {}) {
  const rawAliases = Array.isArray(profile.aliases)
    ? profile.aliases
    : String(profile.aliases || "").split(/[;|,]/);
  const values = [
    profile.name,
    profile.legalName,
    profile.dba,
    profile.shortName,
    profile.approvedDba,
    profile.approvedDBA,
    profile.address,
    profile.facilityAddress,
    profile.mailingAddress,
    profile.serviceAddress,
    profile.cityStateZip,
    profile.city,
    ...rawAliases
  ];
  const seen = new Set();
  return values
    .flatMap(aliasVariants)
    .map(item => String(item || "").trim())
    .filter(item => {
      if (item.length < 3) return false;
      const key = normalizeNameForMatch(item, { compact: true });
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const genericNameTokens = new Set([
  "center", "rehabilitation", "healthcare", "health", "care", "nursing", "home",
  "facility", "services", "service", "operations", "associates", "holding",
  "holdings", "group", "medical", "senior", "living", "the", "and"
]);

function meaningfulNameTokens(value) {
  return normalizeNameForMatch(value)
    .split(/\s+/)
    .filter(token => token.length >= 3 && !genericNameTokens.has(token));
}

function editDistanceAtMost(a, b, limit = 1) {
  if (!a || !b) return false;
  if (Math.abs(a.length - b.length) > limit) return false;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let left = i;
    let best = left;
    for (let j = 1; j <= b.length; j += 1) {
      const next = Math.min(
        previous[j] + 1,
        left + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      previous[j - 1] = left;
      left = next;
      best = Math.min(best, next);
    }
    previous[b.length] = left;
    if (best > limit) return false;
  }
  return previous[b.length] <= limit;
}

function textHasToken(textTokens, compactText, token) {
  if (textTokens.has(token) || compactText.includes(token)) return true;
  if (token.length < 5) return false;
  for (const textToken of textTokens) {
    if (Math.abs(textToken.length - token.length) <= 1 && editDistanceAtMost(token, textToken, 1)) return true;
  }
  return false;
}

function scoreAliasMatch(alias, compactText, textTokens) {
  const compactAlias = normalizeNameForMatch(alias, { compact: true });
  if (compactAlias.length >= 8 && compactText.includes(compactAlias)) return 100;
  const tokens = meaningfulNameTokens(alias);
  if (!tokens.length) return 0;
  const hits = tokens.filter(token => textHasToken(textTokens, compactText, token)).length;
  if (!hits) return 0;
  const ratio = hits / tokens.length;
  if (tokens.length === 1) return hits && tokens[0].length >= 5 ? 72 : 0;
  if (ratio >= 1) return 92;
  if (tokens.length >= 3 && ratio >= 0.67) return 82;
  if (tokens.length === 2 && ratio >= 0.5 && tokens.some(token => token.length >= 6)) return 74;
  return 0;
}

function findKnownProfileInText(text, profiles = []) {
  const lower = String(text || "").toLowerCase();
  const cleanLower = normalizeNameForMatch(text, { compact: true });
  const textTokens = new Set(normalizeNameForMatch(text).split(/\s+/).filter(Boolean));
  let best = null;
  for (const profile of profiles || []) {
    for (const alias of profileAliases(profile)) {
      const aliasKey = canonicalNameKey(alias);
      if (aliasKey !== canonicalNameKey(profile.name) && /^(newyork|brooklyn|bronx|queens|statenisland|manhattan|syracuse|buffalo|rochester|county|kings|onondaga|steuben|suffolk|richmond|warren|washington|rockland|nj|ny|ri|ks)$/.test(aliasKey)) continue;
      const index = lower.indexOf(alias.toLowerCase());
      const cleanAlias = normalizeNameForMatch(alias, { compact: true });
      const cleanIndex = cleanAlias.length >= 8 ? cleanLower.indexOf(cleanAlias) : -1;
      const fuzzyScore = index >= 0 || cleanIndex >= 0 ? 100 : scoreAliasMatch(alias, cleanLower, textTokens);
      if (!fuzzyScore) continue;
      if (!best || fuzzyScore > best.score || (fuzzyScore === best.score && alias.length > best.alias.length)) {
        best = {
          profile,
          alias,
          value: profile.name || alias,
          index: index >= 0 ? index : 0,
          score: fuzzyScore,
          matchType: fuzzyScore >= 100 ? "exact" : "smart-name-match"
        };
      }
    }
  }
  return best;
}

function findFacilityProfileFromNameText(text, profiles = []) {
  const raw = String(text || "");
  if (!raw.trim()) return null;
  const cleanText = normalizeNameForMatch(raw, { compact: true });
  const tokenText = normalizeNameForMatch(raw);
  let best = null;
  for (const profile of profiles || []) {
    if (/needs classification/i.test(profile.name || "")) continue;
    const aliases = profileAliases(profile)
      .concat(profile.shortName || "", profile.commonName || "", profile.dba || "", profile.legalName || "")
      .filter(Boolean);
    for (const alias of aliases) {
      if (/needs classification/i.test(alias || "")) continue;
      const aliasKey = canonicalNameKey(alias);
      if (!aliasKey || aliasKey.length < 4) continue;
      const profileKey = canonicalNameKey(profile.name || "");
      if (aliasKey !== profileKey && /^(newyork|brooklyn|bronx|queens|statenisland|manhattan|syracuse|buffalo|rochester|county|kings|onondaga|steuben|suffolk|richmond|warren|washington|rockland|nj|ny|ri|ks)$/.test(aliasKey)) continue;
      const aliasWords = normalizeNameForMatch(alias).split(/\s+/).filter(Boolean);
      const exact = cleanText.includes(aliasKey);
      const shortExact = aliasKey.length >= 5 && new RegExp(`\\b${escapeRegExp(normalizeNameForMatch(alias))}\\b`, "i").test(tokenText);
      const wordHits = aliasWords.filter(word => word.length >= 4 && tokenText.split(/\s+/).includes(word)).length;
      const score = (exact ? 100 : shortExact ? 92 : (aliasWords.length && wordHits === aliasWords.length ? 86 : 0))
        + (aliasKey === profileKey ? 40 : 0);
      if (!score) continue;
      if (!best || score > best.score || (score === best.score && alias.length > best.alias.length)) {
        best = { profile, alias, value: profile.name || alias, index: 0, score, matchType: "file-name-facility-match" };
      }
    }
  }
  return best;
}

function findVendorProfileByName(name) {
  const target = normalizeMatchValue(name);
  const looseTarget = vendorLooseKey(name);
  if (!target) return null;
  return listVendorProfiles().find(profile =>
    profileAliases(profile).some(alias => normalizeMatchValue(alias) === target || vendorLooseKey(alias) === looseTarget)
  ) || null;
}

function findVendorProfileFromNameText(text, profiles = listVendorProfiles()) {
  const compactText = normalizeNameForMatch(text, { compact: true });
  if (!compactText) return null;
  let best = null;
  let tied = false;
  for (const profile of profiles) {
    for (const alias of profileAliases(profile)) {
      const aliasKey = normalizeNameForMatch(alias, { compact: true });
      if (!aliasKey || aliasKey.length < 5 || !compactText.includes(aliasKey)) continue;
      const score = 1000 + aliasKey.length;
      if (!best || score > best.score) {
        best = { profile, alias, value: profile.name || alias, score, matchType: "saved-vendor-name-match" };
        tied = false;
      } else if (score === best.score && canonicalNameKey(profile.name) !== canonicalNameKey(best.profile.name)) {
        tied = true;
      }
    }
  }
  return tied ? null : best;
}

function knownVendorOverride(text) {
  const clean = cleanOcrText(text);
  const rules = [
    ["Li Script North LLC", /\b(li\s*script(?:\s+north)?|l\.i\.\s*script)\b/i],
    ["SeniorRide Transportation, LLC", /\b(senior\s*ride|seniorride transportation|seniorride)\b/i],
    ["Dentserv Dental Services", /\b(dentserv|dentserve|dent\s*serv|dental services?|mobile dental|on-site dental)\b/i],
    ["Advowaste Medical Services, LLC", /\b(advo\s*waste|advowaste|advowastemedical\.com|medical waste disposal service agreement)\b/i],
    ["Primary Vascular Care", /\b(primary vascular|vascular services agreement)\b/i],
    ["Aeris Consulting & Management, LLC", /\b(aeris consulting|respiratory therapist|therapist onsite)\b/i],
    ["SigmaCare", /\b(sigmacare|sigma care)\b/i],
    ["Airgas USA LLC", /\b(airgas|airgas healthcare|airgas usa|product supply agreement).{0,120}\b(medical gas|compressed gas|oxygen)\b/i],
    ["Constellation", /\b(constellation|customercare@constellation\.com|electricity supply|kilowatt-hour|kwh)\b/i],
    ["TD Synnex Capital LLC", /\b(td synnex|synnex capital)\b/i],
    ["Hoagland Property Management", /\b(hoagland property management|hoaglandproperties@gmail\.com|518-222-0018)\b/i],
    ["Scenic View Hardscapes, Inc.", /\bscenic view hardscapes\b/i],
    ["FirstLight Fiber", /\b(firstlight|first light|firstlight\.net|fiber internet|internet service order)\b/i],
    ["Citi Security", /\b(citi security|security services agreement|uniformed security guards?)\b/i],
    ["HK Parking", /\b(hk parking|parking agreement|parking space|space number)\b/i],
    ["Atlantic Tomorrow's Office", /\b(atlantic tomorrow|tomorrow.?s office|de lage landen|equipment lease|lease agreement)\b/i],
    ["PCA Pharmacy", /\b(pca pharmacy|pharmacy services agreement)\b/i],
    ["MBS", /\b(mbs|medical billing services)\b/i]
  ];
  for (const [value, pattern] of rules) {
    const match = clean.match(pattern);
    if (match) return { value, index: match.index || 0 };
  }
  return null;
}

function knownCategoryOverride(text) {
  const clean = cleanOcrText(text);
  const lead = clean.slice(0, 4500);
  const rules = [
    ["Pharmacy", /\b(li[\s.>_-]*script|pharmacy services?|pharmacy agreement|medication dispensing)\b/i],
    ["Medical Director", /\b(medical director(?:\s+services?)?\s+agreement|medical director duties|medical director services?)\b/i],
    ["Physician Services", /\b(physician services? agreement|professional medical services?|licensed physician|attending physician|physician provider)\b/i],
    ["Psychological Services", /\b(psychological services?|psychology services?|psychologist|psychiatric services?|behavioral health|mental health services?)\b/i],
    ["Security", /\b(citi security|security services agreement|uniformed security guards?)\b/i],
    ["Dental Services", /\b(dentserv|dentserve|dental services?|dental provider|dentist|dentistry|oral care|oral health|dentures?|dental hygienist)\b/i],
    ["Medical Waste", /\b(advowaste|medical waste disposal|regulated medical waste|red bags|sharps)\b/i],
    ["Medical Practitioner / Vascular", /\b(primary vascular|vascular services agreement|vascular care)\b/i],
    ["Respiratory Therapist", /\b(aeris consulting|respiratory therapist|bipap|cpap)\b/i],
    ["Software", /\b(sigmacare|sigma care|license agreement addendum)\b/i],
    ["Medical Gas", /\b(airgas|medical gas|compressed gas|oxygen cylinders?)\b/i],
    ["Electric Provider", /\b(constellation|electricity supply|kilowatt-hour|kwh)\b/i],
    ["Equipment Lease", /\b(de lage landen|tomorrow.?s office|equipment lease|finance charge)\b/i],
    ["Rental / Parking", /\b(hk parking|parking agreement|parking space|space number)\b/i],
    ["Internet Service", /\b(firstlight|fiber internet|internet service order|broadband internet)\b/i],
    ["Portable X-Ray", /\b(portable imaging|portable x-ray|portable xray|diagnostic testing services)\b/i],
    ["Enteral Supplies", /\b(enteral supplies|enteral nutrition|feeding pump|pump rental)\b/i],
    ["Snow Removal", /\b(scenic view hardscapes|snow plowing|snow removal|winter services)\b/i]
  ];
  for (const [value, pattern] of rules) {
    const match = lead.match(pattern);
    if (match) return { value, reason: `recognized business wording: ${match[0]}` };
  }
  return null;
}

function cleanVendorCandidate(value = "") {
  return cleanPartyName(value)
    .replace(/\b(?:agreement|contract|service agreement|services agreement|master agreement|terms and conditions|between|by and between)\b.*$/i, "")
    .replace(/\b(?:as|called|known as|herein called|referred to as)\s+(?:company|vendor|provider|supplier|contractor|service provider)\b/gi, "")
    .replace(/\s*\([^)]*(?:company|vendor|provider|supplier|contractor|service provider)[^)]*\)\s*/gi, " ")
    .replace(/\s+located\s+at.*$/i, "")
    .replace(/\s+with\s+offices?.*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[,.\-:\s]+|[,.\-:\s]+$/g, "")
    .trim();
}

function isLikelyVendorCandidate(value = "", knownFacilityName = "") {
  const clean = cleanVendorCandidate(value);
  const lower = clean.toLowerCase();
  if (isBadExtractedPartyName(clean)) return false;
  if (knownFacilityName && normalizeNameForMatch(clean) === normalizeNameForMatch(knownFacilityName)) return false;
  if (/\b(facility|center for rehabilitation|nursing home|rehab(?:ilitation)?|healthcare center|resident|patient|client|customer|institution)\b/i.test(clean)) return false;
  if (/\b(in the event|determines?|requires?|shall|whereas|witnesseth|preferred provider|duties|obligations|provision|quality|confidential|financial information|agreements|billing)\b/i.test(clean)) return false;
  if (/^[a-z]\.?\s+/i.test(clean)) return false;
  if (clean.split(/\s+/).length > 8) return false;
  if (!/[A-Z]/.test(clean[0] || "")) return false;
  if (/^(agreement|contract|services?|provider|vendor|company|contractor)$/i.test(clean)) return false;
  return /\b(llc|l\.l\.c\.?|inc|corp|corporation|company|co\.|pllc|pc|lp|llp|services?|solutions?|systems?|group|associates?|dental|pharmacy|transportation|security|landscaping|fiber|medical|waste|laboratories|diagnostics?)\b/i.test(clean)
    || (clean.split(/\s+/).length >= 2 && clean.length <= 80 && /^[A-Z0-9][A-Za-z0-9 &.,'-]+$/.test(clean));
}

function inferVendorFromLead(text, knownFacilityName = "") {
  const clean = cleanOcrText(text);
  const lead = clean.slice(0, 3500);
  const patterns = [
    /by\s+and\.?\s+between\s+([\s\S]{3,140}?)\s*\(\s*["“”']?(?:Transportation|Company|Vendor|Provider|Supplier|Contractor|Service Provider)["“”']?\s*\)\s*,?\s+and\s+([\s\S]{3,180}?)(?:\s*\(|\n|\r|$)/i,
    /(?:vendor|supplier|contractor|provider|service provider|company)\s*[:\-]\s*([^\n\r]{3,140})/i,
    /(?:by\s+and\s+between|between)\s+([\s\S]{3,180}?)\s+(?:,?\s+and\s+|\s+&\s+)([\s\S]{3,180}?)(?:\s*,?\s+(?:a|an)\s+|\s+located\s+at|\s*\(|\n|\r|$)/i,
    /(?:agreement|contract)\s+(?:between|with)\s+([\s\S]{3,160}?)(?:\s+and\s+|\n|\r)/i,
    /([A-Z][A-Za-z0-9 &.,'-]{3,120}?)\s*\(\s*(?:Company|Vendor|Provider|Supplier|Contractor|Service Provider)\s*\)/i
  ];
  for (const pattern of patterns) {
    const match = lead.match(pattern);
    if (!match) continue;
    const candidates = [match[1], match[2]].map(cleanVendorCandidate).filter(Boolean);
    const winner = candidates.find(candidate => isLikelyVendorCandidate(candidate, knownFacilityName));
    if (winner) return { value: winner, index: match.index || 0, source: "Vendor read from first page contract wording" };
  }
  return null;
}

function inferPurpose(text) {
  const clean = cleanOcrText(text);
  const purpose = firstMatch(clean, [
    /WHEREAS,\s*(.{80,520}?)(?:IT IS|NOW THEREFORE|AGREED|1\.)/is,
    /(?:purpose|scope)\s*[:\-.]\s*(.{40,420}?)(?:\n[A-Z][A-Z ]{3,}|\. \d+\.|$)/is,
    /(?:the parties|both parties)[^.]{20,420}\./i
  ]);
  return purpose?.value?.replace(/\s+/g, " ").trim() || "";
}

function inferContractUnderstanding(text) {
  const clean = cleanOcrText(text);
  const firstLine = firstMeaningfulLine(clean);
  const agreementBetweenTitle = clean.match(/([A-Z][A-Z /&,'().-]{3,100}?\bAGREEMENT)\s+BETWEEN\s+([^\n\r]{3,140})/i);
  const agreementBetweenType = agreementBetweenTitle ? cleanPartyName(agreementBetweenTitle[1]) : "";
  const agreementBetweenParty = agreementBetweenTitle ? cleanPartyName(agreementBetweenTitle[2]) : "";
  const title = agreementBetweenType && agreementBetweenParty
    ? `${agreementBetweenParty} ${agreementBetweenType}`
    : firstLine;
  const lower = text.toLowerCase();
  const titleLower = title.toLowerCase();
  const leadLower = clean.slice(0, 3000).toLowerCase();
  const purpose = inferPurpose(clean);
  const purposeLower = purpose.toLowerCase();
  const categoryOverride = knownCategoryOverride(clean);
  const categories = [
    { name: "Dialysis / Patient Transfer", terms: ["dialysis transfer agreement", "dialysis center", "patient transfer", "transfer of a patient", "nursing facility", "continuity of the care"], titleBoost: 60 },
    { name: "Dental Services", terms: ["dentserv", "dentserve", "dental", "dentist", "dentistry", "oral care", "oral health", "dental services", "dental provider", "dental hygienist", "denture", "dentures", "periodontal", "prosthodontic", "teeth cleaning", "tooth extraction", "mobile dental", "on-site dental"], titleBoost: 80 },
    { name: "Medical Director", terms: ["medical director agreement", "medical director services", "medical director duties", "medical director"], titleBoost: 95, titleOrLeadOnly: true },
    { name: "Physician Services", terms: ["physician services agreement", "physician services", "professional medical services", "licensed physician", "attending physician", "physician provider"], titleBoost: 90 },
    { name: "Psychological Services", terms: ["psychological services", "psychology services", "psychologist", "psychiatric services", "behavioral health", "mental health services"], titleBoost: 90 },
    { name: "Healthcare Services", terms: ["health care services", "healthcare services", "clinical services"], titleBoost: 65 },
    { name: "Lab / Diagnostics", terms: ["laboratory", "lab services", "diagnostic", "diagnostics", "specimen", "phlebotomy", "blood draw", "clinical lab", "ppd", "per patient day"], titleBoost: 55 },
    { name: "Medical Practitioner / Vascular", terms: ["vascular services", "vascular care", "vascular provider", "primary vascular", "vascular consultation"], titleBoost: 75 },
    { name: "Respiratory Therapist", terms: ["respiratory therapist", "respiratory therapy", "bipap", "cpap", "ventilator", "respiratory services"], titleBoost: 70 },
    { name: "Oxygen", terms: ["oxygen", "medical gas"], titleBoost: 50 },
    { name: "Medical Gas", terms: ["medical gas", "bulk oxygen", "liquid oxygen", "compressed gas", "gas cylinders", "oxygen concentrator", "respiratory equipment"], titleBoost: 55 },
    { name: "Electric", terms: ["electric", "kwh", "power supply", "utility account"], titleBoost: 50 },
    { name: "Gas", terms: ["natural gas", "therm"], titleBoost: 50 },
    { name: "Water / Sewer", terms: ["water service", "sewer", "wastewater", "water utility", "metered water"], titleBoost: 50 },
    { name: "Laundry / Linen", terms: ["laundry", "linen", "linens", "bed sheets", "towels", "resident laundry"], titleBoost: 50 },
    { name: "Medical Supplies", terms: ["medical supplies", "medical supply", "supplies service"], titleBoost: 45 },
    { name: "Grease Trap / Interceptor", terms: ["grease trap", "grease traps", "grease interceptor", "grease interceptors", "fog", "fats oils grease", "fats, oils and grease", "kitchen grease", "grease pumping", "grease removal", "trap cleaning", "interceptor cleaning", "grease disposal", "used cooking oil"], titleBoost: 80 },
    { name: "Medical Waste", terms: ["medical waste", "regulated medical waste", "medical waste disposal", "red bags", "sharps", "biohazard waste"], titleBoost: 75 },
    { name: "Waste Removal", terms: ["waste", "trash", "refuse"], titleBoost: 45 },
    { name: "Pharmacy", terms: ["pharmacy", "medication"], titleBoost: 45 },
    { name: "Portable X-Ray", terms: ["portable x-ray", "portable xray", "mobile x-ray", "mobile xray", "radiology services", "diagnostic imaging", "ultrasound", "ekg"], titleBoost: 60 },
    { name: "Rehab / Therapy", terms: ["rehabilitation services", "therapy services", "physical therapy", "occupational therapy", "speech therapy", "pt ot st", "rehab therapy"], titleBoost: 55 },
    { name: "Insurance", terms: ["insurance policy", "insurance agreement", "insurance services agreement", "policy declarations", "policy declaration"], titleBoost: 45, titleOrLeadOnly: true },
    { name: "Pest Control", terms: ["pest control", "exterminator", "extermination", "rodent", "insect", "bed bug"], titleBoost: 55 },
    { name: "Landscape / Lawn Care", terms: ["lawn care", "landscape", "landscaping", "mowing", "grass cutting", "mulch", "grounds maintenance"], titleBoost: 55 },
    { name: "Snow Removal", terms: ["snow removal", "snow plowing", "plow", "salting", "ice management", "deicing", "snow and ice"], titleBoost: 55 },
    { name: "Food / Dietary", terms: ["food service", "dietary", "meal service", "nutrition services", "kitchen", "dietitian"], titleBoost: 50 },
    { name: "Security", terms: ["security guard", "security services", "guard services", "patrol", "surveillance"], titleBoost: 50 },
    { name: "Security Cameras", terms: ["security cameras", "camera system", "cctv", "video surveillance", "access control"], titleBoost: 55 },
    { name: "Fire Safety / Sprinkler", terms: ["fire alarm", "fire safety", "sprinkler", "fire suppression", "backflow", "fire inspection"], titleBoost: 55 },
    { name: "Elevator", terms: ["elevator", "lift maintenance", "vertical transportation"], titleBoost: 55 },
    { name: "HVAC", terms: ["hvac", "heating", "cooling", "air conditioning", "boiler", "chiller", "ventilation"], titleBoost: 50 },
    { name: "Maintenance", terms: ["maintenance", "repair", "preventive maintenance", "facility maintenance", "handyman"], titleBoost: 40 },
    { name: "IT Managed Services", terms: ["managed it", "information technology", "network support", "help desk", "cybersecurity", "server support"], titleBoost: 50 },
    { name: "Equipment Lease", terms: ["equipment lease", "lease agreement", "finance charge", "monthly payment", "de lage landen", "tomorrow's office", "tomorrows office"], titleBoost: 75 },
    { name: "Rental / Parking", terms: ["parking agreement", "parking space", "space number", "monthly parking", "parking lot"], titleBoost: 75 },
    { name: "Electric Provider", terms: ["electricity supply", "electric supplier", "kilowatt-hour", "kwh", "energy charge", "constellation"], titleBoost: 70 },
    { name: "Enteral Supplies", terms: ["enteral supplies", "enteral nutrition", "feeding pump", "pump rental", "tube feeding"], titleBoost: 70 },
    { name: "Software", terms: ["software license", "software subscription", "saas", "license agreement", "user licenses", "sigmacare"], titleBoost: 50 },
    { name: "Internet Service", terms: ["internet service", "fiber internet", "broadband internet", "firstlight"], titleBoost: 65 },
    { name: "Internet / Telecom", terms: ["telecom", "telephone", "phone system", "fiber", "broadband", "voip"], titleBoost: 50 },
    { name: "Staffing", terms: ["staffing", "temporary staffing", "agency staff", "nursing staff", "temporary labor"], titleBoost: 50 },
    { name: "Transportation", terms: ["transportation", "ambulette", "medical transportation", "non-emergency transportation", "wheelchair van"], titleBoost: 50 }
  ];
  const scored = categories.map(category => {
    const matches = category.terms.filter(term => lower.includes(term));
    const leadMatches = category.terms.filter(term => leadLower.includes(term));
    const titleMatches = category.terms.filter(term => titleLower.includes(term));
    const purposeMatches = category.terms.filter(term => purposeLower.includes(term));
    const fullContractScore = category.titleOrLeadOnly ? 0 : matches.length * 8;
    const hasDirectSupport = titleMatches.length || leadMatches.length || purposeMatches.length;
    const hasRepeatedFullSupport = !category.titleOrLeadOnly && matches.length >= 3;
    let score = hasDirectSupport || hasRepeatedFullSupport
      ? fullContractScore + leadMatches.length * 28 + titleMatches.length * category.titleBoost + purposeMatches.length * 35
      : 0;
    if (category.titleOrLeadOnly && !leadMatches.length && !titleMatches.length) score = 0;
    return { ...category, matches, leadMatches, titleMatches, purposeMatches, score };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0]?.score >= 28 ? scored[0] : null;
  const agreementType = agreementBetweenType || (/agreement/i.test(firstLine) ? firstLine : firstLine ? `${firstLine} Agreement` : "");
  const reason = categoryOverride ? categoryOverride.reason : best
    ? `${best.titleMatches.length ? "title" : best.leadMatches.length ? "first page" : best.purposeMatches.length ? "scope/purpose" : "repeated contract wording"} matched: ${(best.titleMatches.length ? best.titleMatches : best.leadMatches.length ? best.leadMatches : best.purposeMatches.length ? best.purposeMatches : best.matches).join(", ")}`
    : "";
  return {
    title,
    agreementType,
    purpose,
    category: categoryOverride?.value || best?.name || "",
    categoryReason: reason
  };
}

function categorySupportedByContractText(category = "", text = "") {
  const value = String(category || "").trim();
  if (!value) return false;
  const clean = cleanOcrText(text);
  const proofText = `${firstMeaningfulLine(clean)}\n${clean.slice(0, 3500)}\n${inferPurpose(clean)}`.toLowerCase();
  if (/^insurance$/i.test(value)) {
    return /\b(?:insurance policy|insurance agreement|insurance services agreement|policy declarations?)\b/i.test(proofText);
  }
  const key = normalizeMatchValue(value);
  const evidence = {
    dialysispatienttransfer: ["dialysis", "patient transfer", "continuity of care"],
    dentalservices: ["dental", "dentist", "dentures", "oral care", "dental hygienist"],
    medicaldirector: ["medical director agreement", "medical director services", "medical director duties", "medical director"],
    physicianservices: ["physician services agreement", "physician services", "professional medical services", "licensed physician", "attending physician"],
    psychologicalservices: ["psychological services", "psychology services", "psychologist", "psychiatric services", "behavioral health", "mental health services"],
    healthcareservices: ["health care services", "healthcare services", "clinical services"],
    labdiagnostics: ["laboratory", "lab services", "diagnostic", "specimen", "phlebotomy"],
    medicalpractitionervascular: ["vascular services", "vascular care", "primary vascular"],
    respiratorytherapist: ["respiratory therapist", "respiratory therapy", "bipap", "cpap"],
    oxygen: ["oxygen"],
    medicalgas: ["medical gas", "bulk oxygen", "compressed gas", "gas cylinders"],
    electric: ["electric", "kwh", "power supply", "utility account"],
    electricprovider: ["electricity supply", "electric supplier", "kilowatt-hour", "kwh"],
    gas: ["natural gas", "therm"],
    watersewer: ["water service", "sewer", "wastewater", "water utility"],
    laundrylinen: ["laundry", "linen", "linens"],
    medicalsupplies: ["medical supplies", "medical supply"],
    greasetrapinterceptor: ["grease trap", "grease interceptor", "fats oils grease", "trap cleaning", "used cooking oil"],
    medicalwaste: ["medical waste", "regulated medical waste", "red bags", "sharps", "biohazard"],
    wasteremoval: ["waste removal", "trash", "refuse", "solid waste"],
    pharmacy: ["pharmacy", "medication"],
    portablexray: ["portable x-ray", "portable xray", "mobile x-ray", "diagnostic imaging", "ultrasound", "ekg"],
    rehabtherapy: ["rehabilitation services", "therapy services", "physical therapy", "occupational therapy", "speech therapy"],
    pestcontrol: ["pest control", "exterminator", "extermination", "rodent", "bed bug"],
    landscapelawncare: ["lawn care", "landscape", "landscaping", "mowing", "grass cutting", "grounds maintenance"],
    snowremoval: ["snow removal", "snow plowing", "winter services", "salting"],
    fooddietary: ["food service", "dietary", "meal service", "nutrition services"],
    security: ["security guard", "security services", "guard services", "patrol"],
    securitycameras: ["security cameras", "camera system", "cctv", "video surveillance"],
    firesafetysprinkler: ["fire alarm", "fire safety", "sprinkler", "fire suppression", "fire inspection"],
    elevator: ["elevator", "lift maintenance"],
    hvac: ["hvac", "heating", "cooling", "air conditioning", "boiler", "ventilation"],
    maintenance: ["maintenance", "repair", "preventive maintenance", "facility maintenance"],
    itmanagedservices: ["managed it", "information technology", "network support", "help desk", "cybersecurity"],
    equipmentlease: ["equipment lease", "lease agreement", "finance charge", "monthly payment"],
    rentalparking: ["parking agreement", "parking space", "monthly parking"],
    enteralsupplies: ["enteral supplies", "enteral nutrition", "feeding pump"],
    software: ["software license", "software subscription", "saas", "license agreement"],
    internetservice: ["internet service", "fiber internet", "broadband internet"],
    internettelecom: ["telecom", "telephone", "phone system", "fiber", "broadband", "voip"],
    staffing: ["staffing", "temporary staffing", "agency staff", "nursing staff", "temporary labor"],
    transportation: ["transportation", "ambulette", "medical transportation", "wheelchair van"]
  };
  const terms = evidence[key] || [];
  if (terms.length) return terms.some(term => proofText.includes(term));
  return textContainsValue(proofText, value);
}

function inferCategory(text) {
  return inferContractUnderstanding(text).category;
}

function extractionValueLooksLikeClause(value = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  return text.length > 80 && /\b(in the event|whereas|provided that|subject to|pursuant to|notwithstanding|shall|will|must|requires|determines|agrees?|confidential|financial information|billing|invoice|insurance|liability)\b/i.test(text);
}

function isWeakExtractionField(field = {}, cleanText = "") {
  const label = canonicalContractKeyLabel(field.label).toLowerCase();
  const value = String(field.value || "").replace(/\s+/g, " ").trim();
  const source = String(field.source || "");
  const snippet = String(field.snippet || "");
  const proofText = `${snippet}\n${cleanText}`;
  if (!value || /^(needs review|needs classification|unknown|not found|tbd|n\/a|na|none|\.)$/i.test(value)) return true;
  if (isBadKeyFieldValue(field.label, value, `${source} ${snippet}`)) return true;
  if (extractionValueLooksLikeClause(value) && ["vendor", "facility", "category", "contract type", "initial contract length", "payment terms", "fee", "rate / fee"].includes(label)) return true;
  if (label === "vendor") {
    const trusted = /matched saved vendor master|recognized trusted vendor|upload hint|file name matched trusted vendor/i.test(source);
    if (!trusted && Number(field.confidence || 0) < 82) return true;
    if (!isLikelyVendorCandidate(value)) return true;
    if (!trusted && !textContainsValue(proofText, value)) return true;
  }
  if (label === "facility") {
    const trusted = /matched saved facility master|upload hint/i.test(source);
    if (!trusted && Number(field.confidence || 0) < 78) return true;
  }
  if (label === "category" || label === "contract type") {
    if (!categorySupportedByContractText(value, proofText)) return true;
    if (/^insurance$/i.test(value) && !/\b(insurance policy|insurance agreement|policy declarations?|broker services?)\b/i.test(proofText)) return true;
  }
  if (["fee", "rate / fee", "monthly cost", "annual spend"].includes(label)) {
    if (!reviewCostValueIsUsable(value, `${source} ${snippet}`)) return true;
    if (!isPricingContext(`${snippet} ${value}`)) return true;
  }
  if (["start date", "start of services", "effective date", "end date", "signature date", "signed date"].includes(label)) {
    if (!/\b(?:effective|start|commence|commencement|service|dated|entered|signed|signature|expire|expiration|end|terminate)\b/i.test(proofText)) return true;
  }
  if (label === "payment terms" && !/\b(payment|invoice|payable|paid|due|net|billing|statement)\b/i.test(proofText)) return true;
  if (label === "initial contract length" && !/\b(term|period|year|month|day|commence|effective|continue)\b/i.test(proofText)) return true;
  return false;
}

function safeExtractedFields(fields = [], cleanText = "") {
  const critical = new Set([
    "vendor",
    "facility",
    "category",
    "contract type",
    "start date",
    "start of services",
    "effective date",
    "end date",
    "signature date",
    "signed date",
    "initial contract length",
    "payment terms",
    "days payable",
    "fee",
    "rate / fee",
    "monthly cost",
    "annual spend"
  ]);
  return (fields || []).filter(field => {
    const label = canonicalContractKeyLabel(field.label).toLowerCase();
    if (!critical.has(label)) return true;
    return !isWeakExtractionField(field, cleanText);
  });
}

function extractContractFields(text, hints = {}) {
  const clean = cleanOcrText(text);
  const fields = [];
  const clauses = [];
  const feeLines = extractFeeLines(clean);
  const understanding = inferContractUnderstanding(clean);
  const facilityProfiles = getAdminSettings().facilityProfiles || [];
  const nameText = [
    hints.name,
    hints.uploadedFileName,
    hints.fileName,
    hints.localFilePath,
    hints.shareSyncLocalPath,
    hints.shareSyncUrl
  ].filter(Boolean).join(" ");
  const knownFacility = findKnownProfileInText(clean, facilityProfiles)
    || findFacilityProfileFromNameText(nameText, facilityProfiles);
  const vendorProfiles = listVendorProfiles();
  const knownVendor = findKnownProfileInText(clean, vendorProfiles);
  const vendorOverride = knownVendorOverride(clean);
  const hintedFacility = hints.facility && hints.facility !== "Needs Classification" ? hints.facility : "";
  const hintedVendor = hints.vendor && hints.vendor !== "Needs Classification" ? hints.vendor : "";
  const filenameVendorHint = hints.vendorHintFromFileName && hints.vendorHintFromFileName !== "Needs Classification" ? hints.vendorHintFromFileName : "";
  const fileVendorMatch = findVendorProfileFromNameText(nameText, vendorProfiles);
  const headerVendorMatch = findVendorProfileFromNameText(clean.slice(0, 2500), vendorProfiles);
  const vendorNameConflict = fileVendorMatch && headerVendorMatch
    && canonicalNameKey(fileVendorMatch.value) !== canonicalNameKey(headerVendorMatch.value);
  const trustedNameVendor = vendorNameConflict ? null : (headerVendorMatch || fileVendorMatch);
  const hintedCategory = hints.category && hints.category !== "Needs Classification" ? hints.category : "";
  const vendor = firstMatch(clean, [
    /and\s+([A-Z][A-Za-z0-9 &.,'-]{3,160}?)\s*\(\s*(?:Service Provider|Company|Vendor|Provider|Supplier)\s*\)/i,
    /and\s+([A-Z][A-Za-z0-9 &.,'-]{3,120}?)\s*\(\s*(?:Company|Vendor|Provider|Supplier)\s*\)/i,
    /by\s+and\s+between\s+([\s\S]{2,160}?)\s*,?\s+located\s+at\s+[\s\S]{8,220}?\([^)]*(?:Pharmacy|Vendor|Provider|Supplier)[^)]*\)\s*,?\s+and\s+[\s\S]{2,220}?\s*,?\s+located\s+at/i,
    /between\s+([\s\S]{2,160}?)\s*,?\s+located\s+at\s+[\s\S]{2,220}?\(herein\s+called\s+Dialysis Center\)/i,
    /vendor\s*[:\-.]\s*([^\n\r]+)/i,
    /supplier\s*[:\-.]\s*([^\n\r]+)/i,
    /provider\s*[:\-.]\s*([^\n\r]+)/i
  ]);
  const facility = firstMatch(clean, [
    /between\s+([A-Z][A-Za-z0-9 &.,'-]{3,180}?)\s*\(\s*["“”']?Facility["“”']?\s*\)\s+located/i,
    /by\s+and\s+between\s+[\s\S]{2,260}?\([^)]*(?:Pharmacy|Vendor|Provider|Supplier)[^)]*\)\s*,?\s+and\s+([\s\S]{2,160}?)\s*,?\s+located\s+at\s+[\s\S]{8,220}?\([^)]*(?:Facility|Customer|Client)[^)]*\)/i,
    /([A-Z][A-Za-z0-9 &.'-]+?)\s+located\s+at\s+[^()\n\r]+\(herein\s+called\s+Nursing Facility\)/i,
    /facility\s*[:\-\.]\s*([^\n\r]+)/i,
    /customer\s*[:\-]\s*([^\n\r]+)/i,
    /client\s*[:\-]\s*([^\n\r]+)/i
  ]);
  const inferredVendor = inferVendorFromLead(clean, knownFacility?.value || hintedFacility || facility?.value || "");
  const vendorAddress = firstMatch(clean, [
    /by\s+and\s+between\s+[\s\S]{2,160}?\s*,?\s+located\s+at\s+([\s\S]{8,180}?)(?:\s*\([^)]*(?:Pharmacy|Vendor|Provider|Supplier)[^)]*\)|\s+and\s+[A-Z]|\n|\r)/i,
    /between\s+[\s\S]{2,160}?\s*,?\s+located\s+at\s+([\s\S]{8,180}?)(?:\s*\(herein\s+called\s+Dialysis Center\)|\s+and\s+[A-Z]|\n|\r)/i,
    /vendor\s+(?:mailing\s+)?address\s*[:\-\.]\s*([^\n\r]{8,180})/i,
    /(?:contractor|provider|supplier)\s+(?:mailing\s+)?address\s*[:\-\.]\s*([^\n\r]{8,180})/i,
    /remit(?:tance)?\s+(?:to\s+)?address\s*[:\-\.]\s*([^\n\r]{8,180})/i,
    /notice(?:s)?\s+(?:to\s+vendor|address)\s*[:\-\.]\s*([^\n\r]{8,180})/i,
    /(?:for\s+notices\s+to|notices\s+to)\s+(?:vendor|contractor|provider|supplier)[\s\S]{0,80}?address\s*[:\-\.]?\s*([^\n\r]{8,180})/i
  ]);
  const remitAddress = firstMatch(clean, [
    /(?:remit|remittance|payment)\s+(?:to\s+)?(?:address)?\s*[:\-\.]\s*([^\n\r]{8,180})/i,
    /(?:send|mail)\s+payments?\s+to\s*[:\-\.]?\s*([^\n\r]{8,180})/i,
    /(?:checks?\s+should\s+be\s+made\s+payable\s+to|payable\s+to)[\s\S]{0,120}?(?:at|address)\s*[:\-\.]?\s*([^\n\r]{8,180})/i
  ]);
  const vendorContact = firstMatch(clean, [
    /(?:vendor|contractor|provider|supplier)\s+(?:contact|representative|account\s+manager)\s*[:\-\.]\s*([A-Z][A-Za-z.'-]+(?:[ \t]+[A-Z][A-Za-z.'-]+){0,4})/i,
    /(?:contact\s+person|primary\s+contact|account\s+manager)\s*[:\-\.]\s*([A-Z][A-Za-z.'-]+(?:[ \t]+[A-Z][A-Za-z.'-]+){0,4})/i,
    /attention\s*[:\-\.]\s*([A-Z][A-Za-z.'-]+(?:[ \t]+[A-Z][A-Za-z.'-]+){0,4})/i,
    /attn\s*[:\-\.]\s*([A-Z][A-Za-z.'-]+(?:[ \t]+[A-Z][A-Za-z.'-]+){0,4})/i
  ]);
  const vendorEmail = firstMatch(clean, [
    /(?:vendor|contractor|provider|supplier|billing|accounts?\s+payable|contact|notice)\s+(?:email|e-mail)\s*[:\-\.]\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i,
    /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i
  ]);
  const vendorPhone = firstMatch(clean, [
    /(?:vendor|contractor|provider|supplier|billing|contact|notice)?\s*(?:phone|telephone|tel\.?|contact)\s*[:\-\.]\s*(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/i,
    /(?:phone|telephone|tel\.?)\s*[:\-\.]\s*(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/i,
    /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/
  ]);
  const accountNumber = firstMatch(clean, [
    /(?:utility\s+)?(?:account|acct|customer|client|member|vendor|provider|supplier|policy|contract|reference|ref|site|location)\s*(?:number|no\.?|#|id)?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9 \-]{4,32})/i,
    /(?:pseg|coned|national grid|water|sewer|electric|gas)[^.\n\r]{0,80}?(?:account|acct)\s*(?:number|no\.?|#)?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9 \-]{4,32})/i
  ]);
  const meterNumber = firstMatch(clean, [
    /(?:meter)\s*(?:number|no\.?|#)?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9 \-]{3,32})/i
  ]);
  const serviceAddress = firstMatch(clean, [
    /service\s+address\s*[:\-\.]\s*([^\n\r]{8,180})/i,
    /service\s+location\s*[:\-\.]\s*([^\n\r]{8,180})/i
  ]);
  const startDate = firstMatch(clean, [
    /(?:effective\s+date|start\s+date|contract\s+start\s+date|commencement\s+date|date\s+of\s+commencement)\s*[:\-]?\s*(?:\n|\r|\s){0,20}([A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)?,? \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i,
    /(?:effective date|start date|begins?|commence(?:s|ment)?|commencing|starting)\s*(?:is|on|:)?\s*([A-Z][a-z]+ \d{1,2}, \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i,
    /(?:made|entered into|entered in|dated|as of|effective)\s+(?:as\s+of\s+|on\s+)?([A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)?,? \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i,
    /(?:this\s+agreement|this\s+contract)[^.\n\r]{0,80}?(?:made|entered into|effective)\s+(?:as\s+of\s+|on\s+)?([A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)?,? \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i
  ]);
  const serviceStartExplicit = firstMatch(clean, [
    /(?:start\s+of\s+services|start\s+of\s+service|service\s+start\s+date|services?\s+start\s+date|service\s+date|service\s+commencement\s+date)\s*[:\-]?\s*(?:\n|\r|\s){0,20}([A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)?,? \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i,
    /(?:start\s+of\s+services|service\s+start\s+date|services?\s+(?:shall\s+)?(?:begin|commence|start)|work\s+(?:shall\s+)?(?:begin|commence|start)|service\s+commencement\s+date)\s*(?:is|on|:)?\s*([A-Z][a-z]+ \d{1,2}, \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i,
    /(?:services?|work)\s+(?:will|shall)\s+(?:begin|commence|start)\s+on\s+([A-Z][a-z]+ \d{1,2}, \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i
  ]);
  const signedDateForServiceStart = firstMatch(clean, [
    /(?:signed date|date signed|signature date|date)\s*[:\-]?\s*([A-Z][a-z]+ \d{1,2}, \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i,
    /(?:made|entered into|entered in|dated|as of|effective)\s+(?:as\s+of\s+|on\s+)?([A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)?,? \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i
  ]);
  const relativeServiceStart = firstMatch(clean, [
    /(?:services?|work)\s+(?:shall\s+|will\s+)?(?:begin|commence|start)[^.\n\r]{0,120}?\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})\s+months?\s+after\s+(?:the\s+)?(?:execution|signing|signature|signed|effective)\s+date/i,
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})\s+months?\s+after\s+(?:the\s+)?(?:execution|signing|signature|signed|effective)\s+date[^.\n\r]{0,80}?(?:services?|work)\s+(?:shall\s+|will\s+)?(?:begin|commence|start)/i
  ]);
  const endDate = firstMatch(clean, [
    /(?:end date|expiration date)\s*(?:is|on|:)?\s*([A-Z][a-z]+ \d{1,2}, \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i,
    /(?:agreement|contract|term)\s+(?:expires?|ends?|terminates?)\s*(?:on)?\s*([A-Z][a-z]+ \d{1,2}, \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i,
    /(?:shall\s+(?:expire|end|terminate)|will\s+(?:expire|end|terminate))\s*(?:on)?\s*([A-Z][a-z]+ \d{1,2}, \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i
  ]);
  const notice = firstContextMatch(clean, [
    /((?:either\s+party|company|client|customer|facility|vendor|provider|contractor)[^.\n\r]{0,120}?(?:may\s+)?(?:terminate|cancel|not\s+renew|non[-\s]?renew)[^.\n\r]{0,180}?(?:upon|with|by\s+giving|after|provided)[^.\n\r]{0,140}?(?:written\s+notice|prior\s+notice|advance\s+notice|days?\s+notice)[^.\n\r]{0,100})/i,
    /((?:unless|until)[^.\n\r]{0,140}?(?:either\s+party|party|company|client|customer|facility|vendor|provider|contractor)[^.\n\r]{0,160}?(?:gives|provides|delivers|serves)[^.\n\r]{0,140}?(?:notice\s+of\s+)?(?:termination|non[-\s]?renewal|cancellation|intent\s+not\s+to\s+renew)[^.\n\r]{0,120})/i,
    /((?:automatic(?:ally)?\s+renew|auto[-\s]?renew|renewal\s+term|successive\s+term)[^.\n\r]{0,220}?(?:unless|until)[^.\n\r]{0,180}?(?:written\s+notice|prior\s+notice|non[-\s]?renewal|termination)[^.\n\r]{0,120})/i,
    /((?:termination\s+for\s+convenience|without\s+cause|for\s+cause)[^.\n\r]{0,220}?(?:written\s+notice|notice|cure\s+period|breach|default)[^.\n\r]{0,120})/i,
    /(?:either\s+party\s+may\s+terminate\s+this\s+agreement|terminate\s+this\s+agreement)[^.\n\r]{0,140}?(upon\s+(?:thirty|sixty|ninety|\d{1,3})\s*\(?\d{0,3}\)?\s+days?\s+written\s+notice[^.\n\r]{0,80})/i,
    /(?:either\s+party|company|client|customer|facility|vendor|provider|contractor)[^.\n\r]{0,120}?(?:terminate|cancel|non[-\s]?renew)[^.\n\r]{0,140}?((?:thirty|sixty|ninety|one hundred twenty|\d{1,3})\s*\(?\d{0,3}\)?\s+days?[^.\n\r]{0,80}?(?:notice|prior written notice|written notice))/i,
    /((?:\d{1,3}|ninety|sixty|thirty|one hundred twenty)\s*\(?\d{0,3}\)?\s*days?[^.\n\r]{0,100}(?:written\s+notice|prior\s+written\s+notice|advance\s+notice|notice)[^.\n\r]{0,80})/i
  ], isTerminationNoticeContext);
  const payment = firstContextMatch(clean, [
    /(net\s*\d{1,3})/i,
    /(?:invoice|invoices)[^.\n\r]{0,120}(?:payable|paid|due)\s+(?:within|in)\s+(?:\d{1,3}|thirty|forty[-\s]five|sixty|ninety)\s+days?[^.\n\r]{0,80}/i,
    /((?:shall\s+)?remit\s+payment[^.\n\r]{0,160}?(?:within|net)\s+[^.\n\r]{0,80})/i,
    /payment terms?\s*[:\-]?\s*([^\n\r.]+)/i,
    /(?:invoice|invoices)[^.\n\r]{0,100}(?:paid|payable|due)[^.\n\r]{0,120}/i,
    /(?:payment\s+shall\s+be\s+made|amounts?\s+due)[^.\n\r]{0,160}/i
  ], snippet => /\b(?:payment|invoice|invoices|payable|paid|due|net|statement|billing)\b/i.test(snippet) && !isInsuranceNoticeContext(snippet));
  const insurance = firstMatch(clean, [
    /(?:insurance|liability)[^$]{0,120}(\$[\d,]+(?:\.\d+)?(?:\s*(?:million|m))?)/i,
    /(\$[\d,]+(?:\.\d+)?(?:\s*(?:million|m))?[^.\n\r]{0,80}(?:liability|insurance))/i,
    /(?:commercial\s+general\s+liability|general\s+liability|professional\s+liability|workers?\s+compensation|automobile\s+liability)[^.\n\r]{0,180}/i,
    /(?:certificate\s+of\s+insurance|COI)[^.\n\r]{0,180}/i
  ]);
  const insuranceCertificate = firstMatch(clean, [
    /(?:certificate\s+of\s+insurance|COI)[^.\n\r]{0,220}/i,
    /(?:additional\s+insured|certificate\s+holder)[^.\n\r]{0,220}/i
  ]);
  const insuranceExpiration = firstMatch(clean, [
    /(?:insurance|certificate|COI)[^.\n\r]{0,80}(?:expires?|expiration)\s*(?:date)?\s*[:\-]?\s*([A-Z][a-z]+ \d{1,2}, \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i
  ]);
  const indemnification = firstMatch(clean, [
    /(?:mutual\s+indemnification|each\s+party\s+(?:shall\s+)?(?:defend,\s*)?(?:indemnify|defend|hold\s+harmless)[^.\n\r]{0,320})/i,
    /(?:indemnification|indemnify|indemnified|indemnitor|defend,\s*indemnify|defend\s+and\s+indemnify|hold\s+harmless|harmless\s+from\s+and\s+against)[^.\n\r]{0,320}/i
  ]);
  const rate = firstMatch(clean, [
    /(?:service\s+rate|unit\s+rate|contract\s+rate|rate|fee|price|charge)\s*(?:is|:|\-)?\s*([\$¢]\s*\d(?:[\d,]*\d)?(?:\.\d+)?(?:\s*(?:per|\/)\s*\w+)?)/i,
    /([\$¢]\s*\d(?:[\d,]*\d)?(?:\.\d+)?\s*(?:per|\/)\s*[A-Za-z]+)/i,
    /(\b\d+(?:\.\d+)?\s*%[^.\n\r]{0,120}\b(?:medicare|medicaid|fee schedule|rate schedule|allowable|allowed amount|charges?)\b)/i,
    /(\b(?:medicare|medicaid|applicable|published|current|then-current|standard)[^.\n\r]{0,120}\b(?:fee schedule|rate schedule|allowable|allowed amount)\b)/i
  ]);
  const services = firstMatch(clean, [
    /(?:vendor|contractor|provider|supplier)\s+shall\s+(?:provide|perform|furnish)\s+([^\n\r.]{8,220})/i,
    /(?:scope of services?|work to be performed|service description)\s*[:\-]?\s*([^\n\r]{8,240})/i
  ]);
  const contractStatus = firstMatch(clean, [
    /(?:contract\s+status|status)\s*[:\-]\s*(active|terminated|expired|pending|executed|cancelled|canceled)/i,
    /\b(executed)\s+(?:agreement|contract)\b/i
  ]);
  const initialContractLength = firstMatch(clean, [
    /(?:initial\s+(?:contract\s+)?term|agreement\s+term|contract\s+term)(?:\s+of\s+(?:this\s+)?agreement)?\s+shall\s+be\s+for\s+a\s+(?:period|term)\s+of\s+((?:[a-z-]+\s*){1,4}\(?\d{0,3}\)?\s*(?:months|month|years|year|days|day))/i,
    /(?:initial\s+(?:contract\s+)?term|agreement\s+term|contract\s+term)(?:\s+of\s+(?:this\s+)?agreement)?\s+shall\s+(?:continue|remain\s+in\s+effect)\s+for\s+((?:[a-z-]+\s*){1,4}\(?\d{0,3}\)?\s*(?:months|month|years|year|days|day))/i,
    /(?:initial\s+(?:contract\s+)?term|initial\s+contract\s+length|agreement\s+term|contract\s+term)\s*(?:is|shall be|shall continue for|will be|:|\-)?\s*([^.\n\r]{3,160})/i,
    /(?:for\s+an?\s+initial\s+(?:period|term)\s+of)\s*([^.\n\r]{3,160})/i,
    /(?:shall|will)\s+(?:remain\s+in\s+effect|continue|be\s+effective)\s+(?:for|during)\s+([^.\n\r]{3,160})/i,
    /(?:term\s+of\s+this\s+agreement\s+shall\s+(?:commence|begin)[^.\n\r]{0,160}?\s+and\s+(?:shall\s+)?(?:continue|remain\s+in\s+effect)\s+(?:for|until|through)\s+([^.\n\r]{3,160}))/i,
    /(?:commencing|beginning|starting)\s+(?:on\s+)?(?:[A-Z][a-z]+ \d{1,2}, \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})[^.\n\r]{0,120}?(?:for\s+a\s+period\s+of|for|through|until)\s+([^.\n\r]{3,160})/i,
    /(?:for\s+a\s+(?:period|term)\s+of)\s*((?:one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+(?:years|year|months|month|days|day)[^.\n\r]{0,80})/i,
    /(\b\d{1,3}\s*(?:months|month|years|year|days|day)\b[^.\n\r]{0,80}(?:term|period)?)/i
  ]);
  const renewalTerm = firstMatch(clean, [
    /(?:automatically\s+renew|renews\s+automatically)[^.\n\r]{0,120}?(?:for|in)\s+(?:successive\s+)?((?:one|two|three|four|five|\d{1,2})\s*(?:\(?\d{0,2}\)?\s*)?(?:years|year|months|month))/i,
    /(?:renewal\s+term|successive\s+term|additional\s+term)\s*(?:is|shall be|:|\-)?\s*([^.\n\r]{3,140})/i,
    /(?:automatically\s+renew|renews\s+automatically)[^.\n\r]{0,120}?(?:for|in)\s+([^.\n\r]{3,140})/i,
    /(?:successive|additional)\s+((?:one|two|three|four|five|\d{1,2})\s+(?:year|years|month|months))\s+(?:term|period)s?/i
  ]);
  const monthlyCost = firstMatch(clean, [
    /(?:monthly\s+(?:cost|fee|charge|rate)|per\s+month)\s*(?:is|:|\-)?\s*(\$[\d,]+(?:\.\d+)?)/i,
    /(\$[\d,]+(?:\.\d+)?)\s*(?:per\s+month|monthly)/i
  ]);
  const annualSpend = firstMatch(clean, [
    /(?:annual\s+(?:cost|fee|charge|rate|spend)|per\s+year|annually)\s*(?:is|:|\-)?\s*(\$[\d,]+(?:\.\d+)?)/i,
    /(\$[\d,]+(?:\.\d+)?)\s*(?:per\s+year|annually|annual)/i
  ]);
  const billingFrequency = firstMatch(clean, [
    /\b(monthly|annually|annual|quarterly|weekly|daily|one[-\s]?time|non[-\s]?recurring)\b.{0,80}\b(?:fee|charge|billing|invoice|payment|rate)\b/i,
    /\b(?:billing|invoice|payment)\s+(?:frequency|cycle|schedule)\s*[:\-]?\s*(monthly|annually|annual|quarterly|weekly|daily|one[-\s]?time|non[-\s]?recurring)/i
  ]);
  const costBedMonth = firstMatch(clean, [
    /(?:cost\s*(?:per\s*)?bed\s*(?:\/|per)?\s*month|per\s+bed\s+per\s+month)\s*(?:is|:|\-)?\s*(\$[\d,]+(?:\.\d+)?)/i,
    /(\$[\d,]+(?:\.\d+)?)\s*(?:per\s+bed\s+per\s+month|\/bed\/month|per\s+bed\/month)/i
  ]);
  const quantityOfServices = firstMatch(clean, [
    /(?:quantity\s+of\s+services?|service\s+quantity|number\s+of\s+services?|frequency|service\s+frequency)\s*[:\-]?\s*([^\n\r.]{2,160})/i,
    /(?:daily|weekly|monthly|quarterly|annually)\s+[^.\n\r]{0,120}(?:service|pickup|visit|delivery|inspection|maintenance)/i
  ]);
  const unitDayRate = firstMatch(clean, [
    /(?:ppd|per\s+patient\s+day)\s*(?:rate|price|fee|charge)?\s*(?:is|:|\-)?\s*(\$[\d,]+(?:\.\d+)?)/i,
    /(\$[\d,]+(?:\.\d+)?)\s*(?:\/|\s+per\s+)?(?:ppd|patient\s+day|per\s+patient\s+day)/i,
    /(?:per\s+(?:bed|day|unit|visit|pickup|delivery|service|month|hour))\s*(?:rate|price|fee|charge)?\s*(?:is|:|\-)?\s*(\$[\d,]+(?:\.\d+)?)/i,
    /(\$[\d,]+(?:\.\d+)?)\s*(?:\/|\s+per\s+)(?:bed|day|unit|visit|pickup|delivery|service|month|hour)/i
  ]);
  const servicePricing = firstMatch(clean, [
    /(?:lab(?:oratory)?\s+test(?:ing)?|diagnostic\s+test(?:ing)?|test\s+pricing|fee\s+schedule)\s*[:\-]?\s*([^\n\r]{8,220})/i,
    /(?:cbc|bmp|cmp|pt\/inr|urinalysis|culture|x-ray|diagnostic)[^.\n\r]{0,120}(\$[\d,]+(?:\.\d+)?)/i,
    /(?:fee\s+schedule|pricing\s+schedule|rate\s+schedule|price\s+list|service\s+fees?)\s*[:\-]?\s*([^\n\r]{8,220})/i,
    /(?:mowing|snow|pickup|delivery|cleaning|service|maintenance|repair|removal)[^.\n\r]{0,140}(\$[\d,]+(?:\.\d+)?)/i
  ]);
  const pickupServiceDetail = firstMatch(clean, [
    /(?:specimen|sample)\s+(?:pickup|pick-up|collection)[^.\n\r]{0,180}/i,
    /(?:courier|phlebotomy|blood\s+draw)[^.\n\r]{0,180}/i,
    /(?:pickup|pick-up|delivery|collection|service\s+schedule|service\s+frequency|frequency)[^.\n\r]{0,180}/i
  ]);
  const signer = firstMatch(clean, [
    /(?:authorized\s+)?(?:signature|signed|signatory)\s*(?:by|of)?\s*[:\-]\s*([A-Z][A-Za-z.'-]+(?:[ \t]+[A-Z][A-Za-z.'-]+){1,4})/i,
    /signed\s+by\s+([A-Z][A-Za-z.'-]+(?:[ \t]+[A-Z][A-Za-z.'-]+){1,4})/i,
    /(?:name|printed name)\s*[:\-]\s*([A-Z][A-Za-z.'-]+(?:[ \t]+[A-Z][A-Za-z.'-]+){1,4})/i,
    /by\s*[:\-]\s*([A-Z][A-Za-z.'-]+(?:[ \t]+[A-Z][A-Za-z.'-]+){1,4})\s*(?:title|date|authorized|signature)/i
  ]);
  const signerTitle = firstMatch(clean, [
    /title\s*[:\-]\s*([^\n\r]{2,80})/i,
    /by\s*[:\-]\s*[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4}\s*,\s*([^,\n\r]{2,80})/i
  ]);
  const signedDate = firstMatch(clean, [
    /(?:signed date|date signed|signature date|date)\s*[:\-]?\s*([A-Z][a-z]+ \d{1,2}, \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i
  ]);
  const noAutoRenewalIndex = clean.search(/\b(?:no automatic renewal|does not automatically renew|will not automatically renew|shall not automatically renew|does not renew|will not renew|shall not renew)\b/i);
  const autoRenewalIndex = noAutoRenewalIndex >= 0 ? -1 : clean.search(/auto(?:matic(?:ally)?)?[-\s]?renew|renews?\s+automatically|renew(?:s|ed)?\s+for\s+(?:successive|additional|renewal)\s+terms?|successive\s+(?:one|two|three|four|five|\d+)?\s*(?:year|month)?\s*terms?|shall\s+(?:thereafter\s+)?renew|shall\s+continue\s+from\s+(?:year|month|term)\s+to\s+(?:year|month|term)|unless\s+(?:either\s+party\s+)?(?:gives|provides)\s+[^.\n\r]{0,80}(?:notice\s+of\s+)?(?:non[-\s]?renewal|termination)/i);
  const category = understanding.category || hintedCategory || "";

  if (understanding.title && !isBadContractTitle(understanding.title)) fields.push(extractedField("Contract Name", understanding.title, 90, "Title found at top of contract", snippetAround(clean, 0, 220)));
  if (understanding.agreementType) fields.push(extractedField("Contract Type", understanding.agreementType, 88, "Type found from contract title", snippetAround(clean, 0, 220)));
  const vendorExplicit = vendor?.value && !isBadExtractedPartyName(vendor.value) ? cleanPartyName(vendor.value) : "";
  const knownVendorStrong = knownVendor && (
    knownVendor.score >= 92 ||
    knownVendor.matchType === "exact" ||
    canonicalNameKey(knownVendor.alias) === canonicalNameKey(knownVendor.profile?.name || knownVendor.value)
  );
  const fileHintInText = filenameVendorHint && textContainsValue(clean, filenameVendorHint);
  const trustedVendorOverride = vendorOverride?.value && findVendorProfileByName(vendorOverride.value) ? vendorOverride : null;
  const trustedExplicitVendor = vendorExplicit && findVendorProfileByName(vendorExplicit) ? vendorExplicit : "";
  const trustedInferredVendor = inferredVendor?.value && findVendorProfileByName(inferredVendor.value) ? inferredVendor : null;
  const trustedFileVendor = fileHintInText && findVendorProfileByName(filenameVendorHint) ? filenameVendorHint : "";
  const safeExplicitVendor = vendorExplicit && isLikelyVendorCandidate(vendorExplicit, knownFacility?.value || hintedFacility || facility?.value || "") ? vendorExplicit : "";
  const safeInferredVendor = inferredVendor?.value && isLikelyVendorCandidate(inferredVendor.value, knownFacility?.value || hintedFacility || facility?.value || "") ? inferredVendor : null;
  const vendorValue = cleanPartyName(vendorNameConflict && !hintedVendor
    ? ""
    : hintedVendor || trustedNameVendor?.value || trustedVendorOverride?.value || trustedExplicitVendor || (knownVendorStrong ? knownVendor.value : "") || trustedInferredVendor?.value || trustedFileVendor || safeExplicitVendor || safeInferredVendor?.value || "");
  if ((hintedVendor || trustedNameVendor?.value || trustedVendorOverride?.value || trustedExplicitVendor || knownVendorStrong || trustedInferredVendor?.value || trustedFileVendor || safeExplicitVendor || safeInferredVendor?.value) && !isBadExtractedPartyName(vendorValue)) fields.push(extractedField(
    "Vendor",
    vendorValue,
    trustedNameVendor?.value ? (headerVendorMatch ? 94 : 88) : trustedVendorOverride?.value ? 92 : knownVendorStrong && !vendorExplicit ? 90 : hintedVendor ? 82 : trustedInferredVendor?.value ? 78 : safeExplicitVendor ? 76 : safeInferredVendor?.value ? 74 : trustedFileVendor ? 70 : 74,
    trustedNameVendor?.value ? `${headerVendorMatch ? "Header" : "File name"} matched saved vendor alias: ${trustedNameVendor.alias}` : trustedVendorOverride?.value ? "Recognized trusted vendor keyword" : knownVendorStrong && !vendorExplicit ? `Matched saved vendor master: ${knownVendor.alias}` : hintedVendor ? "Upload hint" : trustedInferredVendor?.source || (safeExplicitVendor ? "Explicit party label found on first page; verify before approval" : safeInferredVendor?.source || (trustedFileVendor ? "File name matched trusted vendor master and OCR text" : "OCR text")),
    trustedNameVendor?.value && headerVendorMatch ? snippetAround(clean, Math.max(0, normalizeNameForMatch(clean, { compact: true }).indexOf(normalizeNameForMatch(trustedNameVendor.alias, { compact: true })))) : trustedVendorOverride?.value ? snippetAround(clean, trustedVendorOverride.index) : trustedExplicitVendor && vendor ? snippetAround(clean, vendor.index) : knownVendor ? snippetAround(clean, knownVendor.index) : trustedInferredVendor ? snippetAround(clean, trustedInferredVendor.index) : safeExplicitVendor && vendor ? snippetAround(clean, vendor.index) : safeInferredVendor ? snippetAround(clean, safeInferredVendor.index) : trustedFileVendor ? snippetAround(clean, clean.toLowerCase().indexOf(filenameVendorHint.toLowerCase())) : ""
  ));
  if (vendorAddress?.value) fields.push(extractedField("Vendor Mailing Address", cleanAddress(vendorAddress.value), 74, "OCR text", snippetAround(clean, vendorAddress.index)));
  if (remitAddress?.value) fields.push(extractedField("Vendor Remit Address", cleanAddress(remitAddress.value), 74, "OCR text", snippetAround(clean, remitAddress.index)));
  if (vendorContact?.value) fields.push(extractedField("Vendor Contact", cleanPartyName(vendorContact.value), 72, "OCR text", snippetAround(clean, vendorContact.index)));
  if (vendorPhone?.value) fields.push(extractedField("Vendor Phone", vendorPhone.value.replace(/\s+/g, " ").trim(), 72, "OCR text", snippetAround(clean, vendorPhone.index)));
  if (vendorEmail?.value) fields.push(extractedField("Vendor Email", vendorEmail.value.trim(), 82, "OCR text", snippetAround(clean, vendorEmail.index)));
  const facilityValue = cleanPartyName(knownFacility?.value || hintedFacility || facility?.value || "");
  if ((knownFacility?.value || hintedFacility || facility?.value) && !isBadExtractedPartyName(facilityValue)) fields.push(extractedField("Facility", facilityValue, knownFacility ? 88 : hintedFacility ? 82 : 68, knownFacility ? `Matched saved facility master: ${knownFacility.alias}` : hintedFacility ? "Upload hint" : "OCR text", knownFacility || facility ? snippetAround(clean, knownFacility?.index ?? facility.index) : ""));
  if (accountNumber?.value && isLikelyAccountValue(accountNumber.value)) fields.push(extractedField("Account Number", accountNumber.value.replace(/\s+/g, " ").trim(), 78, "OCR text", snippetAround(clean, accountNumber.index)));
  if (meterNumber?.value) fields.push(extractedField("Meter Number", meterNumber.value.replace(/\s+/g, " ").trim(), 76, "OCR text", snippetAround(clean, meterNumber.index)));
  if (serviceAddress?.value) fields.push(extractedField("Service Address", cleanAddress(serviceAddress.value), 72, "OCR text", snippetAround(clean, serviceAddress.index)));
  if (category) fields.push(extractedField("Category", category, understanding.category ? 88 : 72, understanding.categoryReason ? `Why: ${understanding.categoryReason}` : "Keyword inference", ""));
  if (services?.value) fields.push(extractedField("Services", services.value.replace(/\s+/g, " ").trim(), 76, "OCR text", snippetAround(clean, services.index)));
  if (contractStatus?.value) {
    fields.push(extractedField("Contract Status", contractStatus.value.replace(/^./, match => match.toUpperCase()), 70, "OCR text", snippetAround(clean, contractStatus.index)));
  }
  if (startDate?.value) fields.push(extractedField("Start Date", startDate.value, 76, "OCR text", snippetAround(clean, startDate.index)));
  const relativeServiceMonths = numberWordToNumber(relativeServiceStart?.value);
  const relativeServiceBase = signedDateForServiceStart?.value || startDate?.value || "";
  const relativeServiceDate = relativeServiceMonths && relativeServiceBase ? addMonthsToOcrDate(relativeServiceBase, relativeServiceMonths) : "";
  if (serviceStartExplicit?.value) {
    fields.push(extractedField("Start of Services", serviceStartExplicit.value, 82, "Separate service-start clause found", snippetAround(clean, serviceStartExplicit.index)));
  } else if (relativeServiceStart?.value) {
    fields.push(extractedField(
      "Start of Services",
      relativeServiceDate || `${relativeServiceStart.value} months after signing/effective date`,
      relativeServiceDate ? 78 : 68,
      relativeServiceDate ? "Calculated from service-start clause" : "Relative service-start clause found",
      snippetAround(clean, relativeServiceStart.index)
    ));
  }
  if (endDate?.value) fields.push(extractedField("End Date", endDate.value, 76, "OCR text", snippetAround(clean, endDate.index)));
  const derivedLength = derivedContractLength(startDate?.value, endDate?.value);
  if (initialContractLength?.value || derivedLength) fields.push(extractedField(
    "Initial Contract Length",
    cleanTermValue(initialContractLength?.value) || derivedLength,
    initialContractLength?.value ? 80 : 70,
    initialContractLength?.value ? "OCR text" : "Calculated from start and end dates",
    initialContractLength?.value ? snippetAround(clean, initialContractLength.index) : `${startDate?.value || ""} to ${endDate?.value || ""}`
  ));
  if (renewalTerm?.value) fields.push(extractedField("Renewal Term", cleanTermValue(renewalTerm.value), 76, "OCR text", snippetAround(clean, renewalTerm.index)));
  if (notice?.value) fields.push(extractedField("How to terminate", notice.value, 82, "Termination/notice language found in current contract OCR", snippetAround(clean, notice.index)));
  if (payment?.value) {
    const paymentTerms = cleanPaymentTermsValue(payment.value);
    if (paymentTerms) {
      fields.push(extractedField("Payment Terms", paymentTerms, 82, "OCR text", snippetAround(clean, payment.index)));
      const daysPayable = extractDaysPayable(paymentTerms);
      if (daysPayable) fields.push(extractedField("Days Payable", daysPayable, 84, "OCR payment terms", snippetAround(clean, payment.index)));
    }
  }
  if (insurance?.value) fields.push(extractedField("Insurance Requirement", insurance.value, 70, "OCR text", snippetAround(clean, insurance.index)));
  if (insuranceCertificate?.value) fields.push(extractedField("Insurance Certificate", insuranceCertificate.value.replace(/\s+/g, " ").trim(), 68, "OCR text", snippetAround(clean, insuranceCertificate.index)));
  if (insuranceExpiration?.value) fields.push(extractedField("Insurance Expiration", insuranceExpiration.value, 68, "OCR text", snippetAround(clean, insuranceExpiration.index)));
  if (indemnification?.value) {
    const indemnificationText = snippetAround(clean, indemnification.index, 520) || indemnification.value;
    const lowerIndemnification = indemnificationText.toLowerCase();
    const vendorWords = "(?:vendor|contractor|provider|supplier|company|consultant|service provider|business associate)";
    const facilityWords = "(?:facility|client|customer|center|owner|covered entity)";
    const vendorToFacility = new RegExp(`${vendorWords}[^.\\n\\r]{0,180}(?:indemnif|defend|hold harmless)[^.\\n\\r]{0,220}${facilityWords}`, "i").test(indemnificationText)
      || new RegExp(`${vendorWords}[^.\\n\\r]{0,260}${facilityWords}[^.\\n\\r]{0,100}(?:from and against|against all|for any)`, "i").test(indemnificationText);
    const facilityToVendor = new RegExp(`${facilityWords}[^.\\n\\r]{0,180}(?:indemnif|defend|hold harmless)[^.\\n\\r]{0,220}${vendorWords}`, "i").test(indemnificationText);
    const indemnificationType = /mutual|each party|both parties|respective parties|each of the parties/.test(lowerIndemnification)
      ? "Mutual"
      : vendorToFacility
        ? "Vendor indemnifies facility"
        : facilityToVendor
          ? "Facility indemnifies vendor"
          : "Needs Review";
    fields.push(extractedField("Indemnification", indemnificationType, indemnificationType === "Needs Review" ? 68 : 84, "Indemnification language found", indemnificationText));
    clauses.push({ type: "Indemnification", snippet: indemnificationText, risk: indemnificationType === "Mutual" ? "Review" : "High", source: "OCR text" });
  }
  const rateSnippet = rate?.value ? snippetAround(clean, rate.index, 260) : "";
  if (rate?.value && isPricingContext(rateSnippet)) {
    fields.push(extractedField("Rate / Fee", rate.value, 68, "OCR text", rateSnippet));
    fields.push(extractedField("Fee", rate.value, 68, "OCR text", rateSnippet));
  }
  if (!rate?.value && feeLines.length) {
    const firstFeeLine = feeLines.find(line => line.rate && !line.sourceNeedsReview);
    if (firstFeeLine) {
      const feeValue = [firstFeeLine.rate, firstFeeLine.unit ? `per ${firstFeeLine.unit}` : "", firstFeeLine.frequency].filter(Boolean).join(" ");
      fields.push(extractedField("Rate / Fee", feeValue, 70, "Extracted fee line", firstFeeLine.source || feeValue));
      fields.push(extractedField("Fee", feeValue, 70, "Extracted fee line", firstFeeLine.source || feeValue));
    }
  }
  if (monthlyCost?.value && isPricingContext(snippetAround(clean, monthlyCost.index, 260))) fields.push(extractedField("Monthly Cost", monthlyCost.value, 76, "OCR text", snippetAround(clean, monthlyCost.index)));
  if (annualSpend?.value && isPricingContext(snippetAround(clean, annualSpend.index, 260))) fields.push(extractedField("Annual Spend", annualSpend.value, 78, "OCR text", snippetAround(clean, annualSpend.index)));
  if (billingFrequency?.value) fields.push(extractedField("Billing Frequency", billingFrequency.value.replace(/\s+/g, " ").trim(), 70, "OCR text", snippetAround(clean, billingFrequency.index)));
  if (quantityOfServices?.value) fields.push(extractedField("Quantity of Services", quantityOfServices.value.replace(/\s+/g, " ").trim(), 70, "OCR text", snippetAround(clean, quantityOfServices.index)));
  if (unitDayRate?.value && isPricingContext(snippetAround(clean, unitDayRate.index, 260))) fields.push(extractedField("Per-Day / Unit Rate", unitDayRate.value, 84, "Pricing OCR", snippetAround(clean, unitDayRate.index)));
  if (servicePricing?.value) fields.push(extractedField("Service Pricing Detail", servicePricing.value.replace(/\s+/g, " ").trim(), 72, "Pricing OCR", snippetAround(clean, servicePricing.index)));
  if (pickupServiceDetail?.value) fields.push(extractedField("Pickup / Service Detail", pickupServiceDetail.value.replace(/\s+/g, " ").trim(), 70, "Operations OCR", snippetAround(clean, pickupServiceDetail.index)));
  if (signer?.value && !isBadExtractedPartyName(signer.value)) fields.push(extractedField("Signer", cleanPartyName(signer.value), 66, "OCR text", snippetAround(clean, signer.index)));
  if (signerTitle?.value && !/[^A-Za-z0-9 .,'&()/-]{2,}/.test(signerTitle.value)) fields.push(extractedField("Signer Title", signerTitle.value.replace(/\s+/g, " ").trim(), 62, "OCR text", snippetAround(clean, signerTitle.index)));
  if (noAutoRenewalIndex >= 0) {
    fields.push(extractedField("Auto Renewal", "No", 84, "No automatic renewal language found in current contract OCR", snippetAround(clean, noAutoRenewalIndex)));
  } else if (autoRenewalIndex >= 0) {
    fields.push(extractedField("Auto Renewal", "Yes", 84, "Auto-renewal language found", snippetAround(clean, autoRenewalIndex)));
    clauses.push({ type: "Auto-renewal", snippet: snippetAround(clean, autoRenewalIndex, 260), risk: "Review", source: "OCR text" });
  }
  if (notice?.value) clauses.push({ type: "Termination notice", snippet: snippetAround(clean, notice.index, 260), risk: "Review", source: "OCR text" });
  if (insurance?.value) clauses.push({ type: "Insurance", snippet: snippetAround(clean, insurance.index, 260), risk: "Review", source: "OCR text" });

  return { fields: safeExtractedFields(fields, clean), clauses, feeLines, text: clean };
}

function fieldValue(fields, label) {
  const normalizedLabel = String(label || "").toLowerCase().trim();
  const canonical = canonicalContractKeyLabel(label).toLowerCase();
  const reviewCanonical = reviewFieldCanonicalLabel(label);
  const allowReviewMeaningMatch = ![
    "monthly cost",
    "monthly charge",
    "annual cost",
    "annual charge",
    "cost bed/month",
    "cost per bed month",
    "per-day / unit rate",
    "ppd rate",
    "days payable"
  ].includes(normalizedLabel);
  return fields.find(field =>
    String(field.label || "") === label
    || canonicalContractKeyLabel(field.label).toLowerCase() === canonical
    || (allowReviewMeaningMatch && reviewFieldCanonicalLabel(field.label) === reviewCanonical)
  )?.value || "";
}

function usableVendorValue(current, next) {
  const value = String(current || "").trim();
  const incoming = String(next || "").trim();
  const placeholders = [
    "needs vendor address",
    "needs vendor phone",
    "needs vendor email",
    "needs review",
    "unknown",
    "not found",
    "not saved yet"
  ];
  if (!value || placeholders.includes(value.toLowerCase())) return incoming || "";
  return value;
}

function cleanMasterLearningValue(label, value) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length < 2 || clean.length > 120) return "";
  if (/^(needs review|needs classification|unknown|not found|tbd|n\/a|na|none)$/i.test(clean)) return "";
  if (/^[\d\s\-_/.,]+$/.test(clean)) return "";
  if (isBadKeyFieldValue(label, clean)) return "";
  return clean;
}

function learnFacilityProfileFromContract(contract, fields = []) {
  const facilityName = cleanMasterLearningValue("Facility", fieldValue(fields, "Facility") || contract.facility);
  if (!facilityName || isBadExtractedPartyName(facilityName)) return null;
  const settings = getAdminSettings();
  const profiles = Array.isArray(settings.facilityProfiles) ? [...settings.facilityProfiles] : [];
  const now = new Date().toISOString();
  const key = canonicalNameKey(facilityName);
  const existingIndex = profiles.findIndex(profile =>
    canonicalNameKey(profile.name) === key
    || canonicalNameKey(profile.dba) === key
    || canonicalNameKey(profile.legalName) === key
    || (profile.aliases || []).some(alias => canonicalNameKey(alias) === key)
  );
  if (existingIndex >= 0) {
    const existing = profiles[existingIndex];
    const aliases = mergeTextListCanonical(existing.aliases, existing.commonName, existing.legalName, existing.dba, facilityName)
      .filter(alias => /[a-z]/i.test(alias) && canonicalNameKey(alias) !== canonicalNameKey(existing.name || facilityName));
    const changed = aliases.join("|") !== mergeTextListCanonical(existing.aliases).join("|");
    if (!changed) return null;
    profiles[existingIndex] = { ...existing, aliases, updatedAt: now };
    saveAdminSettings({ ...settings, facilityProfiles: profiles });
    return { type: "Facility", value: existing.name || facilityName, action: "updated aliases" };
  }
  profiles.push({
    name: facilityName,
    aliases: [],
    status: "Active",
    source: "Approved contract review",
    createdAt: now,
    updatedAt: now
  });
  saveAdminSettings({ ...settings, facilityProfiles: profiles });
  return { type: "Facility", value: facilityName, action: "added" };
}

function learnCategoryFromContract(contract, fields = []) {
  const category = cleanMasterLearningValue("Category", fieldValue(fields, "Category") || contract.category);
  if (!category) return null;
  const settings = getAdminSettings();
  const categories = mergeTextListCanonical(settings.categories, category);
  if (categories.length === (settings.categories || []).length) return null;
  saveAdminSettings({ ...settings, categories });
  return { type: "Service type", value: category, action: "added" };
}

function learnMasterDataFromApprovedContract(contract, fields = []) {
  return [
    learnFacilityProfileFromContract(contract, fields),
    learnCategoryFromContract(contract, fields)
  ].filter(Boolean);
}

function safeVendorAliasCandidate(value = "") {
  const clean = cleanPartyName(value)
    .replace(/\b(?:vendor|provider|supplier|contractor|company)\s*[:\-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean || clean.length < 3 || clean.length > 90) return "";
  if (isBadExtractedPartyName(clean)) return "";
  if (/\b(in the event|whereas|shall|hereunder|agreement|contract|patient requires|institution determines|confidential|financial information|payment may be made)\b/i.test(clean)) return "";
  if (clean.split(/\s+/).length > 8 && !/\b(llc|inc|corp|company|co\.|services|service|systems|solutions|medical|dental|transport|waste|security|pharmacy|laboratories|lab|diagnostics)\b/i.test(clean)) return "";
  return clean;
}

function vendorAliasesFromApprovedFields(fields = [], vendorName = "") {
  const aliases = [];
  for (const field of fields || []) {
    if (canonicalContractKeyLabel(field?.label).toLowerCase() !== "vendor") continue;
    const candidates = [
      field.originalValue,
      field.ocrValue,
      field.value,
      field.snippet && field.snippet.length <= 90 ? field.snippet : "",
      field.source && field.source.length <= 90 ? field.source : ""
    ];
    for (const candidate of candidates) {
      const alias = safeVendorAliasCandidate(candidate);
      if (alias && canonicalNameKey(alias) !== canonicalNameKey(vendorName)) aliases.push(alias);
    }
  }
  return aliases;
}

function updateVendorProfileFromContract(contract, fields = []) {
  const vendorName = contract.vendor && contract.vendor !== "Needs Classification" ? contract.vendor : fieldValue(fields, "Vendor");
  if (!vendorName || vendorName === "Needs Classification" || isBadExtractedPartyName(vendorName)) return;
  const existing = findVendorProfileByName(vendorName);
  const now = new Date().toISOString();
  const mailingAddress = fieldValue(fields, "Vendor Mailing Address") || contract.vendorMailingAddress || contract.vendorAddress || contract.mailingAddress || "";
  const remitAddress = fieldValue(fields, "Vendor Remit Address") || contract.vendorRemitAddress || contract.remitAddress || "";
  const primaryContact = fieldValue(fields, "Vendor Contact") || contract.vendorContact || contract.primaryContact || "";
  const phone = fieldValue(fields, "Vendor Phone") || contract.vendorPhone || contract.phone || "";
  const email = fieldValue(fields, "Vendor Email") || contract.vendorEmail || contract.email || "";
  const paymentTerms = fieldValue(fields, "Payment Terms") || contract.paymentTerms || "";
  const insuranceStatus = fieldValue(fields, "Insurance Requirement") || contract.insuranceRequirement || contract.insuranceStatus || "";
  const insuranceCertificate = fieldValue(fields, "Insurance Certificate") || contract.insuranceCertificate || "";
  const insuranceExpiration = fieldValue(fields, "Insurance Expiration") || contract.insuranceExpiration || "";
  const learnedAliases = vendorAliasesFromApprovedFields(fields, vendorName);
  const profile = {
    ...(existing || {}),
    id: existing?.id || vendorProfileId(vendorName),
    name: existing?.name || vendorName,
    legalName: existing?.legalName || vendorName,
    category: usableVendorValue(existing?.category, contract.category),
    services: mergeTextListCanonical(existing?.services, contract.category, contract.services).filter(Boolean),
    facilitiesServed: mergeTextListCanonical(existing?.facilitiesServed, splitFacilityNames(contract.facility)).filter(Boolean),
    aliases: mergeTextListCanonical(existing?.aliases, learnedAliases, existing?.name, existing?.legalName, existing?.dba, vendorName)
      .filter(alias => /[a-z]/i.test(alias) && canonicalNameKey(alias) !== canonicalNameKey(existing?.name || vendorName)),
    learnedVendorAliases: mergeTextListCanonical(existing?.learnedVendorAliases, learnedAliases),
    mailingAddress: usableVendorValue(existing?.mailingAddress, mailingAddress),
    remitAddress: usableVendorValue(existing?.remitAddress, remitAddress),
    primaryContact: usableVendorValue(existing?.primaryContact, primaryContact),
    phone: usableVendorValue(existing?.phone, phone),
    email: usableVendorValue(existing?.email, email),
    paymentTerms: usableVendorValue(existing?.paymentTerms, paymentTerms),
    insuranceStatus: usableVendorValue(existing?.insuranceStatus, insuranceStatus),
    insuranceCertificate: usableVendorValue(existing?.insuranceCertificate, insuranceCertificate),
    insuranceExpiration: usableVendorValue(existing?.insuranceExpiration, insuranceExpiration),
    status: existing?.status || "Needs Review",
    notes: existing?.notes || "Vendor info was started from OCR. Review before using for payments or legal notices.",
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  saveVendorProfile(profile);
}

function applyApprovedFields(contract, fields) {
  const approved = (fields || []).map(field => ({
    ...field,
    approved: true,
    approvedAt: new Date().toISOString()
  }));
  contract.approvedFields = approved;
  contract.extractedFields = approved;
  const approvedContractName = fieldValue(approved, "Contract Name") || fieldValue(approved, "Title");
  if (shouldReplaceIntakeName(contract.name, approvedContractName) || approvedContractName) {
    const cleanName = cleanContractDisplayName(approvedContractName);
    if (cleanName) contract.name = cleanName;
  }
  contract.vendor = fieldValue(approved, "Vendor Name") || fieldValue(approved, "Vendor") || contract.vendor;
  contract.facility = fieldValue(approved, "Facility") || contract.facility;
  contract.category = fieldValue(approved, "Contract Type") || fieldValue(approved, "Contract type") || fieldValue(approved, "Service Type") || fieldValue(approved, "Category") || contract.category;
  contract.vendorMailingAddress = fieldValue(approved, "Vendor Mailing Address") || contract.vendorMailingAddress;
  contract.vendorAddress = contract.vendorMailingAddress || contract.vendorAddress;
  contract.vendorRemitAddress = fieldValue(approved, "Vendor Remit Address") || contract.vendorRemitAddress;
  contract.vendorContact = fieldValue(approved, "Vendor Contact") || contract.vendorContact;
  contract.vendorPhone = fieldValue(approved, "Vendor Phone") || contract.vendorPhone;
  contract.vendorEmail = fieldValue(approved, "Vendor Email") || contract.vendorEmail;
  contract.documentTitle = fieldValue(approved, "Contract Name") || fieldValue(approved, "Document Title") || contract.documentTitle;
  contract.agreementType = fieldValue(approved, "Contract Type") || fieldValue(approved, "Contract type") || fieldValue(approved, "Agreement Type") || contract.agreementType;
  contract.purposeScope = fieldValue(approved, "Purpose / Scope") || contract.purposeScope;
  contract.categoryReason = fieldValue(approved, "Category Reason") || approved.find(field => field.label === "Category")?.source?.replace(/^Why:\s*/i, "") || contract.categoryReason;
  contract.services = fieldValue(approved, "Service Type") || fieldValue(approved, "Services") || contract.services;
  contract.contractStatus = fieldValue(approved, "Contract Status") || contract.contractStatus || contract.status;
  const effectiveDate = fieldValue(approved, "Effective Date") || fieldValue(approved, "Effective date");
  contract.start = effectiveDate || fieldValue(approved, "Start Date") || contract.start;
  contract.startOfServices = effectiveDate || fieldValue(approved, "Start of Services") || contract.startOfServices || contract.start;
  contract.end = fieldValue(approved, "End Date") || contract.end;
  contract.initialContractLength = fieldValue(approved, "Initial Contract Length") || contract.initialContractLength;
  contract.renewalTerm = fieldValue(approved, "Renewal Term") || contract.renewalTerm;
  contract.renewal = fieldValue(approved, "Renewal Date") || contract.renewal;
  contract.paymentTerms = fieldValue(approved, "Payment Terms") || contract.paymentTerms;
  contract.daysPayable = fieldValue(approved, "Days Payable") || extractDaysPayable(contract.paymentTerms) || contract.daysPayable;
  contract.insuranceRequirement = fieldValue(approved, "Insurance Requirement") || contract.insuranceRequirement;
  contract.insuranceCertificate = fieldValue(approved, "Insurance Certificate") || contract.insuranceCertificate;
  contract.insuranceExpiration = fieldValue(approved, "Insurance Expiration") || contract.insuranceExpiration;
  contract.indemnification = fieldValue(approved, "Indemnification") || contract.indemnification;
  const approvedCost = fieldValue(approved, "Cost");
  contract.rate = approvedCost || fieldValue(approved, "Rate / Fee") || contract.rate;
  contract.fee = approvedCost || fieldValue(approved, "Fee") || contract.rate || contract.fee;
  contract.monthlyCost = fieldValue(approved, "Monthly Cost") || contract.monthlyCost;
  contract.annualCost = fieldValue(approved, "Annual Spend") || fieldValue(approved, "Annual Cost") || contract.annualCost;
  contract.annualSpend = contract.annualCost || contract.annualSpend;
  contract.billingFrequency = fieldValue(approved, "Billing Frequency") || contract.billingFrequency;
  contract.costBedMonth = fieldValue(approved, "Cost Bed/Month") || contract.costBedMonth;
  contract.quantityOfServices = fieldValue(approved, "Quantity of Services") || contract.quantityOfServices;
  contract.ppdRate = fieldValue(approved, "Per-Day / Unit Rate") || fieldValue(approved, "PPD Rate") || contract.ppdRate;
  contract.labTestPricing = fieldValue(approved, "Service Pricing Detail") || fieldValue(approved, "Lab Test Pricing") || contract.labTestPricing;
  contract.specimenPickup = fieldValue(approved, "Pickup / Service Detail") || fieldValue(approved, "Specimen Pickup / Phlebotomy") || contract.specimenPickup;
  contract.autoRenewal = fieldValue(approved, "Auto Renew") || fieldValue(approved, "Auto renew") || fieldValue(approved, "Auto Renewal") || contract.autoRenewal;
  const terminationValue = fieldValue(approved, "How to Terminate") || fieldValue(approved, "How to terminate") || fieldValue(approved, "Termination") || fieldValue(approved, "Notice Period");
  contract.termination = terminationValue || contract.termination;
  contract.terminationClause = terminationValue || contract.terminationClause;
  contract.utilityAccountNumber = fieldValue(approved, "Account Number") || fieldValue(approved, "Utility Account Number") || contract.utilityAccountNumber;
  contract.meterNumber = fieldValue(approved, "Meter Number") || contract.meterNumber;
  contract.serviceAddress = fieldValue(approved, "Service Address") || contract.serviceAddress;
  contract.signer = fieldValue(approved, "Signer") || contract.signer;
  contract.signerTitle = fieldValue(approved, "Signer Title") || contract.signerTitle;
  contract.signatureDate = fieldValue(approved, "Signature Date") || fieldValue(approved, "Signed Date") || contract.signatureDate;
  contract.signedDate = fieldValue(approved, "Signed Date") || fieldValue(approved, "Signature Date") || contract.signedDate;
  updateContractDisplayName(contract);
  contract.reviewStatus = "Approved";
  if (!contract.status || ["Needs Review", "OCR Complete", "Pending OCR", "Approved"].includes(contract.status)) {
    contract.status = contract.contractStatus || "Active";
  }
  contract.approvedAt = new Date().toISOString();
  contract.updatedAt = new Date().toISOString();
  try {
    updateVendorProfileFromContract(contract, approved);
  } catch (error) {
    contract.vendorProfileUpdateError = error.message;
    logAudit("vendor_profile_update_failed", "contract", contract.id, { name: contract.name, error: error.message });
  }
  return contract;
}

function applySingleReviewField(contract, field) {
  const label = reviewFieldCanonicalLabel(field?.label);
  const value = cleanExtractedFieldValue(field?.label, field?.value);
  if (!value) return contract;
  const savedField = {
    ...field,
    label: reviewDisplayFieldLabel(label, field?.label),
    value,
    approved: true,
    approvedAt: new Date().toISOString()
  };
  const upsertField = list => {
    const next = Array.isArray(list) ? [...list] : [];
    const index = next.findIndex(item => reviewFieldCanonicalLabel(item.label) === label);
    if (index >= 0) next[index] = { ...next[index], ...savedField };
    else next.push(savedField);
    return next;
  };
  contract.extractedFields = upsertField(contract.extractedFields);
  contract.approvedFields = upsertField(contract.approvedFields);
  if (label === "vendor") contract.vendor = value;
  if (label === "facility") contract.facility = value;
      if (label === "contract type") {
        contract.category = value;
        contract.services = value;
        contract.agreementType = value;
      }
  if (label === "contract status") contract.contractStatus = value;
  if (label === "effective date") {
    contract.start = value;
    contract.startOfServices = value;
  }
  if (label === "end date") contract.end = value;
  if (label === "initial contract length" || label === "contract length" || label === "term") contract.initialContractLength = value;
  if (label === "renewal term") contract.renewalTerm = value;
  if (label === "renewal date") contract.renewal = value;
  if (label === "payment terms") {
    contract.paymentTerms = value;
    contract.daysPayable = extractDaysPayable(value) || contract.daysPayable;
  }
  if (label === "days payable") contract.daysPayable = value;
  if (label === "insurance requirement") contract.insuranceRequirement = value;
  if (label === "indemnification") contract.indemnification = value;
  if (label === "cost") {
    contract.rate = value;
    contract.fee = value;
  }
  if (label === "auto renew") contract.autoRenewal = value;
  if (label === "how to terminate") {
    contract.termination = value;
    contract.terminationClause = value;
  }
  if (label === "signature date" || label === "signed date") {
    contract.signatureDate = value;
    contract.signedDate = value;
  }
  if (label === "vendor mailing address") contract.vendorMailingAddress = value;
  if (label === "vendor contact") contract.vendorContact = value;
  if (label === "vendor phone") contract.vendorPhone = value;
      if (label === "vendor email") contract.vendorEmail = value;
      contract.reviewStatus = contract.reviewStatus || "Needs Review";
      contract.updatedAt = new Date().toISOString();
      updateVendorProfileFromContract(contract, contract.approvedFields || []);
      return contract;
}

function syncOcrJobsForSavedReviewField(contractId, savedField) {
  if (!contractId || !savedField?.label) return 0;
  const rows = db.prepare("SELECT data FROM ocr_jobs WHERE contract_id = ?").all(contractId);
  let updated = 0;
  for (const row of rows) {
    const job = rowToRecord(row);
    const next = Array.isArray(job.extractedFields) ? [...job.extractedFields] : [];
    const wanted = reviewFieldCanonicalLabel(savedField.label);
    const index = next.findIndex(field => reviewFieldCanonicalLabel(field?.label) === wanted);
    const fieldForJob = {
      ...savedField,
      label: reviewDisplayFieldLabel(wanted, savedField.label),
      approved: true
    };
    if (index >= 0) next[index] = { ...next[index], ...fieldForJob };
    else next.push(fieldForJob);
    job.extractedFields = next;
    job.updatedAt = new Date().toISOString();
    saveOcrJob(job);
    updated += 1;
  }
  return updated;
}

function reviewFieldCanonicalLabel(label) {
  const normalized = String(label || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (["contract type", "agreement type", "service type", "category", "services", "service/category"].includes(normalized)) return "contract type";
  if (["vendor name", "vendor", "provider", "contractor", "supplier"].includes(normalized)) return "vendor";
  if (normalized === "signed date" || normalized === "signature date") return "signature date";
  if (["annual cost", "annual charge", "annual spend", "annualized spend", "total annual spend"].includes(normalized)) return "annual spend";
  if (["billing frequency", "billing cycle", "frequency", "recurring"].includes(normalized)) return "billing frequency";
  if (["quantity of services", "service quantity", "quantity", "units", "square feet", "sq ft", "miles", "trips", "pickups", "boxes", "containers", "tests", "meals", "sessions"].includes(normalized)) return "quantity of services";
  if (["fee", "fees", "cost", "rate / fee", "service pricing detail", "fee details", "pricing detail", "contract value", "contract amount", "contract price", "amount", "charge", "charges", "service charge", "service charges", "service fee", "service fees", "price", "pricing", "rate", "rates", "monthly cost", "monthly charge", "monthly recurring charge", "mrc", "service order total", "recurring charge", "non-recurring charge", "nrc"].includes(normalized)) return "cost";
  if (["payment terms", "days payable", "payable days", "invoice due", "due within", "paid within", "payable within", "net terms"].includes(normalized)) return "payment terms";
  if (["start date", "effective date", "start of services", "service start date", "service date", "commencement date", "commencement", "effective"].includes(normalized)) return "effective date";
  if (normalized === "auto-renewal" || normalized === "auto renewal" || normalized === "automatic renewal" || normalized === "auto renew" || normalized === "automatically renew" || normalized === "renews" || normalized === "renewal") return "auto renew";
  if (["termination", "termination notice", "termination rights", "notice period", "required notice days", "how to terminate", "cancellation", "cancel", "non-renewal", "notice to terminate", "written notice"].includes(normalized)) return "how to terminate";
  return normalized;
}

function reviewDisplayFieldLabel(canonical, fallback = "") {
  const labels = {
    "contract type": "Contract type",
    vendor: "Vendor Name",
    "effective date": "Effective date",
    cost: "Cost",
    "payment terms": "Payment terms",
    "auto renew": "Auto renew",
    "how to terminate": "How to terminate",
    "quantity of services": "Quantity of Services",
    "billing frequency": "Billing Frequency",
    "annual spend": "Annual Spend"
  };
  return labels[canonical] || String(fallback || canonical || "").trim();
}

function deleteSingleReviewField(contract, label) {
  const wanted = reviewFieldCanonicalLabel(label);
  if (!wanted) return contract;
  const sameLabel = field => reviewFieldCanonicalLabel(field?.label) === wanted;
  const markHidden = list => (Array.isArray(list) ? list.map(field => sameLabel(field)
    ? { ...field, value: "", approved: false, hidden: true, source: "Deleted from Review Queue by reviewer." }
    : field) : []);
  contract.extractedFields = markHidden(contract.extractedFields);
  contract.approvedFields = markHidden(contract.approvedFields);
  contract.updatedAt = new Date().toISOString();
  return contract;
}

function autoSaveAiReviewedContract(contract, fields = [], feeLines = [], aiAgentReview = {}) {
  const approvedFields = fields.map(field => ({
    ...field,
    source: field.source || "AI agent review",
    approvedBy: "AI Agent",
    agentApproved: true
  }));
  applyApprovedFields(contract, approvedFields);
  contract.reviewStatus = "AI Reviewed";
  contract.status = contract.contractStatus && !/needs|ocr|pending/i.test(contract.contractStatus)
    ? contract.contractStatus
    : "Active";
  contract.aiAgentReview = aiAgentReview;
  contract.aiAgentAutoSaved = true;
  contract.aiAgentAutoSavedAt = new Date().toISOString();
  contract.extractedFeeLines = (feeLines || []).map(line => ({
    ...line,
    approved: true,
    approvedBy: "AI Agent",
    agentApproved: true
  }));
  const masterLearned = learnMasterDataFromApprovedContract(contract, contract.approvedFields || approvedFields);
  const learned = saveAutomaticLearningFromReview(contract, contract.approvedFields || approvedFields, contract.extractedFeeLines || []);
  contract.learningSummary = {
    lastLearnedAt: new Date().toISOString(),
    rulesAdded: learned.length,
    masterDataAdded: masterLearned.length,
    masterData: masterLearned,
    totalRules: listLearningRules().length,
    source: "AI Agent auto-save"
  };
  logAudit("contract_ai_agent_auto_saved", "contract", contract.id, {
    name: contract.name,
    score: aiAgentReview.score,
    approvedFields: approvedFields.length,
    learningRulesAdded: learned.length,
    masterDataLearned: masterLearned.length
  });
  return contract;
}

function normalizeAiField(field, source = "AI extraction") {
  return {
    label: String(field.label || "").trim(),
    value: String(field.value || "").trim(),
    confidence: Math.max(0, Math.min(100, Number(field.confidence || 70))),
    source,
    snippet: String(field.source_snippet || field.snippet || "").trim(),
    approved: false
  };
}

function mergeExtractedFields(ruleFields, aiFields, sourceText = "") {
  const byLabel = new Map();
  const cleanText = cleanOcrText(sourceText);
  for (const field of ruleFields || []) {
    if (field.label) byLabel.set(field.label.toLowerCase(), field);
  }
  for (const field of aiFields || []) {
    const normalized = normalizeAiField(field);
    if (!normalized.label || !normalized.value) continue;
    const key = normalized.label.toLowerCase();
    const existing = byLabel.get(key);
    if (isContractKeyLabel(normalized.label) && !fieldHasSourceProof(normalized, cleanText)) continue;
    if (!existing || normalized.confidence >= (existing.confidence || 0)) {
      byLabel.set(key, normalized);
    }
  }
  return [...byLabel.values()];
}

function aiFallbackAssessment(fields = [], text = "") {
  const clean = cleanOcrText(text);
  const groups = [
    { label: "Vendor", labels: ["Vendor"] },
    { label: "Facility", labels: ["Facility"] },
    { label: "Contract type", labels: ["Category", "Contract Type"] },
    { label: "Effective date", labels: ["Effective Date", "Start Date", "Start of Services"] },
    { label: "Cost", labels: ["Cost", "Fee", "Rate / Fee", "Contract Value"], onlyIf: /\b(fee|rate|price|charge|cost|\$|per month|monthly|annual|invoice)\b/i },
    { label: "Payment terms", labels: ["Payment Terms", "Days Payable"], onlyIf: /\b(payment|invoice|payable|paid|net\s*\d+|due)\b/i },
    { label: "Auto renew", labels: ["Auto Renewal"], onlyIf: /\b(renew|renewal|automatically|successive|term)\b/i },
    { label: "Termination / Notice", labels: ["Termination", "Notice Period", "Termination Notice"], onlyIf: /\b(terminate|termination|cancel|notice|non[-\s]?renew|without cause|for cause)\b/i }
  ];
  const missing = [];
  for (const group of groups) {
    if (group.onlyIf && !group.onlyIf.test(clean)) continue;
    const found = group.labels
      .map(label => supportedField(fields, label))
      .find(Boolean);
    if (!found || Number(found.confidence || 0) < 65 || isBadKeyFieldValue(found.label, found.value, found.source || found.snippet || "")) {
      missing.push(group.label);
    }
  }
  return {
    needed: missing.length > 0 && clean.length > 200,
    missing,
    mode: aiFallbackOnly ? "fallback_only" : "always"
  };
}

function normalizeMatchValue(value) {
  return normalizeNameForMatch(value, { compact: true });
}

function textContainsValue(text, value) {
  const needle = normalizeMatchValue(value);
  if (needle.length < 4) return false;
  return normalizeMatchValue(text).includes(needle);
}

function contractCanMatchInvoice(contract = {}) {
  const status = String(contract.status || contract.contractStatus || "").toLowerCase();
  return !/(terminated|replaced|do not use|expired)/.test(status);
}

function invoiceContractExceptions(invoice = {}, match = null) {
  if (!match) return [{ issue: "No confident contract match", status: "Review" }];
  const exceptions = [];
  const invoiceTotal = moneyToNumber(invoice.total);
  const contractRate = moneyToNumber(match.contractRate);
  if (!invoiceTotal) {
    exceptions.push({ issue: "Invoice total was not found", status: "Review" });
  }
  if (!contractRate) {
    exceptions.push({ issue: "Matched contract is missing a saved fee/rate", status: "Review" });
  }
  if (invoiceTotal && contractRate && invoiceTotal > contractRate * 1.05) {
    exceptions.push({
      issue: `Invoice total ${invoice.total} is higher than saved contract rate ${match.contractRate}`,
      status: "Review"
    });
  }
  if (match.confidence < 75) {
    exceptions.push({ issue: `Low match confidence (${match.confidence}%)`, status: "Review" });
  }
  if (!match.paymentTerms) {
    exceptions.push({ issue: "Matched contract is missing payment terms", status: "Review" });
  }
  if (invoice.paymentTerms && match.paymentTerms && normalizeMatchValue(invoice.paymentTerms) !== normalizeMatchValue(match.paymentTerms)) {
    exceptions.push({ issue: `Invoice payment terms (${invoice.paymentTerms}) do not match contract terms (${match.paymentTerms})`, status: "Review" });
  }
  return exceptions;
}

function extractInvoiceDetails(text, invoice = {}) {
  const clean = cleanOcrText(text);
  const invoiceNumber = firstMatch(clean, [
    /invoice\s*(?:number|no\.?|#)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-]{2,40})/i,
    /\binv\s*(?:no\.?|#)?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-]{2,40})/i
  ]);
  const invoiceDate = firstMatch(clean, [
    /invoice\s*date\s*[:\-]?\s*([A-Z][a-z]+ \d{1,2}, \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i,
    /date\s*[:\-]?\s*([A-Z][a-z]+ \d{1,2}, \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i
  ]);
  const total = firstMatch(clean, [
    /(?:amount\s*due|balance\s*due|total\s*due|invoice\s*total|grand\s*total|total)\s*[:\-]?\s*(\$?\s*\d[\d,]*(?:\.\d{2})?)/i,
    /(?:remainder\s+upon\s+completion|quote\s+to\s+be\s+paid|invoice\s+amount)[^.\n\r$]{0,160}(\$\s*\d[\d,]*(?:\.\d{2})?)/i,
    /(\$\s*\d[\d,]*(?:\.\d{2})?)\s*(?:total|amount due|balance due|due)$/im
  ]);
  const paymentTerms = firstMatch(clean, [
    /(net\s*\d{1,3})/i,
    /(?:payment\s+terms?|terms)\s*[:\-]?\s*([^\n\r.]{3,80})/i,
    /(?:invoice|amount|balance)[^.\n\r]{0,120}(?:due|payable|paid)\s+(?:within|in)\s+\d{1,3}\s+days?[^.\n\r]{0,80}/i
  ]);
  const vendor = firstMatch(clean, [
    /(?:from|vendor|remit\s*to)\s*[:\-]\s*([^\n\r]{3,100})/i
  ]);
  const fields = [
    invoiceNumber?.value && !/^(oicing|invoice|date|total|payment)$/i.test(invoiceNumber.value) ? extractedField("Invoice Number", invoiceNumber.value, 76, "Invoice OCR", snippetAround(clean, invoiceNumber.index)) : null,
    (invoice.invoiceDate || invoiceDate?.value) ? extractedField("Invoice Date", invoice.invoiceDate || invoiceDate.value, 72, "Invoice OCR", invoiceDate ? snippetAround(clean, invoiceDate.index) : "") : null,
    (invoice.total || total?.value) ? extractedField("Invoice Total", invoice.total || total.value.replace(/\s+/g, ""), 78, "Invoice OCR", total ? snippetAround(clean, total.index) : "") : null,
    paymentTerms?.value ? extractedField("Invoice Payment Terms", paymentTerms.value, 72, "Invoice OCR", snippetAround(clean, paymentTerms.index)) : null,
    (invoice.vendor || vendor?.value) ? extractedField("Vendor", invoice.vendor || vendor.value, 58, "Invoice OCR", vendor ? snippetAround(clean, vendor.index) : "") : null,
    invoice.facility ? extractedField("Facility", invoice.facility, 55, "Invoice hint", "") : null
  ].filter(Boolean);
  const cleanInvoiceNumber = invoiceNumber?.value && !/^(oicing|invoice|date|total|payment)$/i.test(invoiceNumber.value) ? invoiceNumber.value : "";
  return { clean, fields, invoiceNumber: cleanInvoiceNumber, invoiceDate: invoice.invoiceDate || invoiceDate?.value || "", total: invoice.total || total?.value?.replace(/\s+/g, "") || "", vendor: invoice.vendor || vendor?.value || "", paymentTerms: paymentTerms?.value || "", serviceLines: extractInvoiceServiceLines(clean) };
}

function extractBillNumericFacts(clean = "") {
  const categoryFor = line => /\b(tax|sales tax|gross receipt|franchise)\b/i.test(line) ? "Tax"
    : /\b(rate|per kwh|per therm|per ccf|per gallon|\/kwh|\/therm)\b/i.test(line) ? "Rate"
      : /\b(usage|consumption|kwh|therm|ccf|mcf|hcf|gallon|demand|kw)\b/i.test(line) ? "Usage"
        : /\b(balance|payment|credit|adjustment|amount due)\b/i.test(line) ? "Balance"
          : /\b(charge|fee|delivery|supply|commodity|distribution|sewer|water|fuel)\b/i.test(line) ? "Charge" : "Other";
  return String(clean || "").split(/\r?\n/)
    .map((source, index) => {
      const line = source.replace(/\s+/g, " ").trim();
      const amounts = line.match(/(?:\(?-?\$?\s*\d[\d,]*\.\d{2}\)?)/g)?.map(value => value.replace(/\s+/g, "")) || [];
      const measurements = line.match(/\b\d[\d,.]*\s*(?:kwh|kw|therms?|ccf|mcf|dth|hcf|gallons?|gal|days?)\b/gi) || [];
      const rates = line.match(/\$?\s*\d+(?:\.\d{3,})\s*(?:\/|per)\s*(?:kwh|kw|therm|ccf|mcf|dth|hcf|gallon|gal)/gi) || [];
      const numbers = line.match(/(?<![A-Za-z])[-+]?\d[\d,.]*(?![A-Za-z])/g) || [];
      return { lineNumber: index + 1, category: categoryFor(line), line, amounts, measurements, rates, numbers };
    })
    .filter(item => item.line && (item.amounts.length || item.measurements.length || item.rates.length))
    .slice(0, 400);
}

function extractUtilityBillDetails(text, invoice = {}) {
  const clean = cleanOcrText(text);
  const value = patterns => firstMatch(clean, patterns)?.value?.trim() || "";
  const money = patterns => value(patterns).replace(/\s+/g, "");
  const accountNumber = value([
    /(?:account|acct)\s*(?:number|no\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9 -]{3,30})/i
  ]);
  const meterNumber = value([
    /meter\s*(?:number|no\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{2,30})/i
  ]);
  const servicePeriod = value([
    /(?:service|billing)\s*period\s*[:\-]?\s*([A-Z0-9, /-]{8,60})/i,
    /(?:from|service from)\s+(\d{1,2}\/\d{1,2}\/\d{2,4}\s+(?:to|-)\s+\d{1,2}\/\d{1,2}\/\d{2,4})/i
  ]);
  const billingDays = value([/(?:number of )?billing days?\s*[:\-]?\s*(\d{1,3})/i]);
  const previousReading = value([/(?:previous|prior)\s+(?:meter\s+)?reading\s*[:\-]?\s*([\d,.]+)/i]);
  const currentReading = value([/(?:current|present)\s+(?:meter\s+)?reading\s*[:\-]?\s*([\d,.]+)/i]);
  const usageMatch = firstMatch(clean, [
    /(?:total\s+)?(?:usage|consumption)\s*[:\-]?\s*([\d,.]+\s*(?:kwh|kw|therms?|ccf|mcf|dth|hcf|gallons?|gal))/i,
    /([\d,.]+\s*(?:kwh|therms?|ccf|mcf|dth|hcf|gallons?|gal))\s+(?:used|usage|consumption)/i
  ]);
  const demand = value([/(?:peak\s+)?demand\s*[:\-]?\s*([\d,.]+\s*kw)/i]);
  const rate = value([
    /(?:effective|supply|commodity|unit)\s+rate\s*[:\-]?\s*(\$?\s*\d+(?:\.\d+)?\s*(?:\/|per)\s*(?:kwh|therm|ccf|mcf|dth|hcf|gallon|gal))/i,
    /(?:rate)\s*[:\-]?\s*(\$?\s*\d+(?:\.\d+)?)/i
  ]);
  const previousBalance = money([/(?:previous|prior)\s+balance\s*[:\-]?\s*(\$?\s*-?\d[\d,]*(?:\.\d{2})?)/i]);
  const paymentsReceived = money([/(?:payment(?:s)? received|payments?|amount paid)\s*[:\-]?\s*(\$?\s*-?\d[\d,]*(?:\.\d{2})?)/i]);
  const credits = money([/(?:total\s+)?credits?\s*[:\-]?\s*(\$?\s*-?\d[\d,]*(?:\.\d{2})?)/i]);
  const adjustments = money([/(?:total\s+)?adjustments?\s*[:\-]?\s*(\$?\s*-?\d[\d,]*(?:\.\d{2})?)/i]);
  const taxes = money([/(?:total\s+)?(?:sales\s+tax|gross\s+receipts?\s+tax|franchise\s+tax|tax(?:es)?)\s*[:\-]?\s*(\$?\s*\d[\d,]*(?:\.\d{2})?)/i]);
  const lateFees = money([/(?:late|finance)\s+(?:fee|charge)s?\s*[:\-]?\s*(\$?\s*\d[\d,]*(?:\.\d{2})?)/i]);
  const supplyCharges = money([/(?:supply|commodity)\s+charges?\s*[:\-]?\s*(\$?\s*\d[\d,]*(?:\.\d{2})?)/i]);
  const deliveryCharges = money([/(?:delivery|distribution)\s+charges?\s*[:\-]?\s*(\$?\s*\d[\d,]*(?:\.\d{2})?)/i]);
  const demandCharges = money([/(?:demand)\s+charges?\s*[:\-]?\s*(\$?\s*\d[\d,]*(?:\.\d{2})?)/i]);
  const sewerCharges = money([/(?:sewer)\s+charges?\s*[:\-]?\s*(\$?\s*\d[\d,]*(?:\.\d{2})?)/i]);
  const waterCharges = money([/(?:water)\s+charges?\s*[:\-]?\s*(\$?\s*\d[\d,]*(?:\.\d{2})?)/i]);
  const fees = money([/(?:total\s+)?fees?\s*[:\-]?\s*(\$?\s*\d[\d,]*(?:\.\d{2})?)/i]);
  const customerCharges = money([/(?:customer|basic|service|fixed)\s+charges?\s*[:\-]?\s*(\$?\s*\d[\d,]*(?:\.\d{2})?)/i]);
  const fuelCharges = money([/(?:fuel|purchased\s+gas|energy)\s+(?:adjustment|cost|charges?)\s*[:\-]?\s*(\$?\s*-?\d[\d,]*(?:\.\d{2})?)/i]);
  const surcharges = money([/(?:total\s+)?(?:surcharge|assessment)s?\s*[:\-]?\s*(\$?\s*\d[\d,]*(?:\.\d{2})?)/i]);
  const currentCharges = money([
    /(?:current|new|this\s+period)\s+(?:utility\s+)?charges?\s*[:\-]?\s*(\$?\s*\d[\d,]*(?:\.\d{2})?)/i,
    /(?:charges?\s+for\s+this\s+period)\s*[:\-]?\s*(\$?\s*\d[\d,]*(?:\.\d{2})?)/i
  ]);
  const estimatedReading = /\bestimated(?:\s+meter)?\s+read(?:ing)?\b|\bread(?:ing)?\s*type\s*[:\-]?\s*estimated/i.test(clean);
  const utilityType = /\bkwh\b|\belectric(?:ity)?\b/i.test(clean) ? "Electric"
    : /\btherms?\b|\bccf\b|\bnatural gas\b/i.test(clean) ? "Gas"
      : /\bsewer\b/i.test(clean) && /\bwater\b/i.test(clean) ? "Water & Sewer"
        : /\bhcf\b|\bgallons?\b|\bwater\b/i.test(clean) ? "Water"
          : /\bfuel oil\b|\bheating oil\b/i.test(clean) ? "Oil" : "";
  const fields = [
    ["Account Number", accountNumber], ["Meter Number", meterNumber], ["Service Period", servicePeriod],
    ["Billing Days", billingDays], ["Previous Meter Reading", previousReading], ["Current Meter Reading", currentReading],
    ["Usage", usageMatch?.value || ""], ["Peak Demand", demand], ["Unit Rate", rate],
    ["Previous Balance", previousBalance], ["Payments Received", paymentsReceived], ["Credits", credits],
    ["Adjustments", adjustments], ["Taxes", taxes], ["Late Fees", lateFees],
    ["Supply Charges", supplyCharges], ["Delivery Charges", deliveryCharges], ["Demand Charges", demandCharges],
    ["Water Charges", waterCharges], ["Sewer Charges", sewerCharges], ["Customer Charges", customerCharges],
    ["Fuel Adjustments", fuelCharges], ["Surcharges", surcharges], ["Fees", fees],
    ["Current Charges", currentCharges]
  ].filter(([, fieldValue]) => fieldValue).map(([label, fieldValue]) =>
    extractedField(label, fieldValue, 72, "Utility bill OCR", snippetAround(clean, clean.toLowerCase().indexOf(String(fieldValue).toLowerCase())))
  );
  return {
    utilityType, accountNumber, meterNumber, servicePeriod, billingDays,
    previousReading, currentReading, usage: usageMatch?.value || "", demand, rate,
    readingType: estimatedReading ? "Estimated" : "Actual or not stated",
    charges: { supply: supplyCharges, delivery: deliveryCharges, demand: demandCharges, water: waterCharges, sewer: sewerCharges, customer: customerCharges, fuel: fuelCharges, surcharges, taxes, fees, lateFees, current: currentCharges },
    balances: { previousBalance, paymentsReceived, credits, adjustments },
    fields
  };
}

function utilityMoney(value) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const negative = /^\s*\(|-\s*\$?/.test(text);
  const amount = Number(text.replace(/[^\d.]/g, "")) || 0;
  return negative ? -amount : amount;
}

function currentUtilityCharges(utilityDetails = {}) {
  const charges = utilityDetails.charges || {};
  const explicit = utilityMoney(charges.current);
  if (explicit) return { value: explicit, source: "explicit-current-charges" };
  const components = ["supply", "delivery", "demand", "water", "sewer", "taxes", "fees"]
    .map(key => utilityMoney(charges[key]));
  const componentTotal = components.reduce((sum, value) => sum + value, 0);
  return componentTotal
    ? { value: Math.round(componentTotal * 100) / 100, source: "verified-charge-components" }
    : { value: "", source: "needs-review" };
}

function findInvoiceParserMemory(invoice = {}) {
  const account = normalizeMatchValue(invoice.accountNumber || "");
  const meter = normalizeMatchValue(invoice.meterNumber || "");
  const vendor = normalizeMatchValue(invoice.vendor || "");
  const candidates = listInvoices().filter(item => item.id !== invoice.id);
  const matches = candidates.filter(item => {
    const sameAccount = account && normalizeMatchValue(item.accountNumber || "") === account;
    const sameMeter = meter && normalizeMatchValue(item.meterNumber || "") === meter;
    const sameVendor = vendor && normalizeMatchValue(item.vendor || "") === vendor;
    return sameAccount || sameMeter || (sameVendor && (account || meter));
  });
  if (!matches.length) return null;
  const preferred = matches.find(item => /verified|matched/i.test(String(item.status || ""))) || matches[0];
  return {
    sourceInvoiceId: preferred.id,
    timesSeen: matches.length,
    matchedOn: account ? "account" : meter ? "meter" : "vendor",
    facility: preferred.facility || "",
    vendor: preferred.vendor || "",
    utilityType: preferred.utilityType || "",
    accountNumber: preferred.accountNumber || "",
    meterNumber: preferred.meterNumber || "",
    usageUnit: preferred.usageUnit || ""
  };
}

function applyInvoiceParserMemory(invoice = {}) {
  const memory = findInvoiceParserMemory(invoice);
  if (!memory) return invoice;
  for (const key of ["facility", "vendor", "utilityType", "accountNumber", "meterNumber", "usageUnit"]) {
    if (!invoice[key] && memory[key]) invoice[key] = memory[key];
  }
  invoice.parserMemory = {
    sourceInvoiceId: memory.sourceInvoiceId,
    matchedOn: memory.matchedOn,
    timesSeen: memory.timesSeen,
    appliedStaticFieldsOnly: true
  };
  return invoice;
}

function extractInvoiceServiceLines(clean = "") {
  const lines = String(clean || "").split(/\r?\n/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const seen = new Set();
  const serviceLines = [];
  const serviceWords = /\b(cleanup|mowing|weed|removal|remove|haul|service|labor|maintenance|repair|delivery|pickup|monthly|inspection|rental|transport|landscap|snow|plow|waste|security|therapy|pharmacy|oxygen|gas|electric|water|internet|parking)\b/i;
  for (const line of lines) {
    if (serviceLines.length >= 25) break;
    if (!/\$\s*\d[\d,]*(?:\.\d{2})?/.test(line)) continue;
    if (/\b(total|subtotal|balance due|amount due|tax|previous balance|payment received)\b/i.test(line)) continue;
    if (/\b(email|phone|tel|fax|date|bill to|remit|address|street|avenue|road|suite|floor|bronx|ny\s+\d{5})\b/i.test(line) && !serviceWords.test(line)) continue;
    if (/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(line)) continue;
    if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(line) || /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i.test(line)) continue;
    if (line.length < 8 || line.length > 220) continue;
    const amount = line.match(/\$?\s*\d[\d,]*(?:\.\d{2})?/g)?.at(-1) || "";
    const description = line.replace(amount, "").replace(/\s+[-:]\s*$/, "").trim();
    if (!serviceWords.test(description) && !/\bquote|fee|charge|rate|price\b/i.test(description)) continue;
    const key = normalizeMatchValue(`${description} ${amount}`);
    if (!description || seen.has(key)) continue;
    seen.add(key);
    serviceLines.push({ description, amount: amount.replace(/\s+/g, ""), source: line });
  }
  return serviceLines;
}

function invoiceDateWithinContract(invoiceDate = "", contract = {}) {
  const invoiceTime = Date.parse(invoiceDate);
  if (!Number.isFinite(invoiceTime)) return null;
  const startTime = Date.parse(contract.start || contract.startOfServices || contract.startDate || "");
  const endTime = Date.parse(contract.end || contract.endDate || "");
  if (Number.isFinite(startTime) && invoiceTime < startTime) return false;
  if (Number.isFinite(endTime) && invoiceTime > endTime && !/yes|auto|renew/i.test(String(contract.autoRenewal || ""))) return false;
  return Number.isFinite(startTime) || Number.isFinite(endTime) ? true : null;
}

function rankInvoiceContractCandidates(invoice, text = "") {
  const candidates = allContracts();
  const clean = cleanOcrText(text);
  const vendorProfiles = listVendorProfiles();
  const vendorProfileLookup = new Map();
  for (const profile of vendorProfiles) {
    for (const alias of profileAliases(profile)) {
      const exactKey = normalizeMatchValue(alias);
      const looseKey = vendorLooseKey(alias);
      if (exactKey) vendorProfileLookup.set(`exact:${exactKey}`, profile);
      if (looseKey) vendorProfileLookup.set(`loose:${looseKey}`, profile);
    }
  }
  const vendorProfileByName = name => {
    const target = normalizeMatchValue(name);
    const looseTarget = vendorLooseKey(name);
    if (!target) return null;
    return vendorProfileLookup.get(`exact:${target}`) || vendorProfileLookup.get(`loose:${looseTarget}`) || null;
  };
  const vendorProfile = vendorProfileByName(invoice.vendor) || findVendorProfileFromNameText(clean, vendorProfiles)?.profile || null;
  const vendorNames = vendorProfile ? profileAliases(vendorProfile) : [];
  const facilityProfiles = getAdminSettings().facilityProfiles || [];
  const facilityProfileLookup = new Map();
  for (const profile of facilityProfiles) {
    for (const alias of profileAliases(profile).concat(profile.dba || "", profile.legalName || "", profile.commonName || "", profile.shortName || "").filter(Boolean)) {
      const key = canonicalNameKey(alias);
      if (key && !facilityProfileLookup.has(key)) facilityProfileLookup.set(key, profile);
    }
  }
  const facilityProfileByName = name => facilityProfileLookup.get(canonicalNameKey(name)) || null;
  const invoiceFacilityProfile = facilityProfileByName(invoice.facility)
    || findFacilityProfileFromNameText(clean, facilityProfiles)?.profile
    || null;
  const invoiceFacilityNames = invoiceFacilityProfile ? profileAliases(invoiceFacilityProfile) : [];
  const serviceText = [clean, ...(invoice.serviceLines || []).map(line => line.description || "")].join(" ");
  const scored = candidates.map(contract => {
    let score = 0;
    const reasons = [];
    if (!contractCanMatchInvoice(contract)) {
      score -= 40;
      reasons.push(`contract status is ${contract.status || contract.contractStatus}`);
    }
    const contractVendorProfile = vendorProfileByName(contract.vendor);
    const contractVendorNames = [contract.vendor, ...(contractVendorProfile ? profileAliases(contractVendorProfile) : [])].filter(Boolean);
    const vendorAliasMatch = vendorNames.length && contractVendorNames.some(name => vendorNames.some(alias => normalizeMatchValue(alias) === normalizeMatchValue(name)));
    if (invoice.vendor && normalizeMatchValue(invoice.vendor) === normalizeMatchValue(contract.vendor)) {
      score += 45;
      reasons.push("selected vendor");
    } else if (vendorAliasMatch) {
      score += 42;
      reasons.push("vendor alias matched");
    } else if (textContainsValue(clean, contract.vendor)) {
      score += 35;
      reasons.push("vendor found in invoice text");
    } else if (contractVendorNames.some(name => textContainsValue(clean, name))) {
      score += 32;
      reasons.push("saved vendor alias found");
    }
    const contractFacilities = splitFacilityNames(contract.facility);
    const contractFacilityProfiles = contractFacilities.map(facilityProfileByName).filter(Boolean);
    const contractFacilityNames = [...contractFacilities, ...contractFacilityProfiles.flatMap(profile => profileAliases(profile))];
    const facilityAliasMatch = invoiceFacilityNames.length && contractFacilityNames.some(name => invoiceFacilityNames.some(alias => normalizeMatchValue(alias) === normalizeMatchValue(name)));
    if (invoice.facility && contractFacilities.some(item => normalizeMatchValue(invoice.facility) === normalizeMatchValue(item))) {
      score += 35;
      reasons.push("selected facility");
    } else if (facilityAliasMatch) {
      score += 32;
      reasons.push("facility alias matched");
    } else if (contractFacilityNames.some(item => textContainsValue(clean, item)) || textContainsValue(clean, contract.facility)) {
      score += 25;
      reasons.push("facility found in invoice text");
    }
    if (contract.category && textContainsValue(serviceText, contract.category)) {
      score += 10;
      reasons.push("service matched");
    }
    if (contract.utilityAccountNumber && textContainsValue(clean, contract.utilityAccountNumber)) {
      score += 45;
      reasons.push("account number matched");
    }
    if (contract.meterNumber && textContainsValue(clean, contract.meterNumber)) {
      score += 35;
      reasons.push("meter number matched");
    }
    if (contract.serviceAddress && textContainsValue(clean, contract.serviceAddress)) {
      score += 25;
      reasons.push("service address matched");
    }
    if (contract.paymentTerms && textContainsValue(clean, contract.paymentTerms)) {
      score += 10;
      reasons.push("payment terms found");
    }
    const activeForInvoice = invoiceDateWithinContract(invoice.invoiceDate, contract);
    if (activeForInvoice === true) {
      score += 12;
      reasons.push("active on invoice date");
    } else if (activeForInvoice === false) {
      score -= 25;
      reasons.push("outside contract dates");
    }
    const invoiceTotal = moneyToNumber(invoice.total);
    const contractRate = moneyToNumber(contract.rate || contract.fee || contract.spend || contract.contractValue || contract.monthlyCost || contract.annualCost);
    if (invoiceTotal && contractRate && Math.abs(invoiceTotal - contractRate) <= Math.max(1, contractRate * 0.05)) {
      score += 15;
      reasons.push("amount matches saved rate");
    }
    return { contract, score, reasons };
  }).sort((a, b) => b.score - a.score);
  return scored;
}

function invoiceContractCandidates(invoice, text = "", limit = 5) {
  return rankInvoiceContractCandidates(invoice, text)
    .filter(item => item.score > 0)
    .slice(0, limit)
    .map(item => ({
      contractId: item.contract.id,
      contractName: item.contract.name,
      vendor: item.contract.vendor || "",
      facility: item.contract.facility || "",
      category: item.contract.category || "",
      contractRate: item.contract.rate || item.contract.fee || item.contract.spend || "",
      score: item.score,
      confidence: Math.max(1, Math.min(95, item.score)),
      reasons: item.reasons
    }));
}

function matchInvoiceToContract(invoice, text = "") {
  const scored = rankInvoiceContractCandidates(invoice, text);
  const best = scored[0];
  if (!best || best.score < 70) return null;
  return {
    contractId: best.contract.id,
    contractName: best.contract.name,
    facility: best.contract.facility || "",
    vendor: best.contract.vendor || "",
    category: best.contract.category || "",
    contractRate: best.contract.rate || best.contract.fee || best.contract.spend || "",
    paymentTerms: best.contract.paymentTerms || "",
    start: best.contract.start || best.contract.startOfServices || "",
    end: best.contract.end || "",
    autoRenewal: best.contract.autoRenewal || "",
    termination: best.contract.termination || best.contract.terminationClause || "",
    serviceAddress: best.contract.serviceAddress || "",
    confidence: Math.min(95, best.score),
    reasons: best.reasons
  };
}

function invoiceContractComparison(invoice = {}, match = null) {
  const row = (label, invoiceValue, contractValue, status, note = "") => ({
    label,
    invoiceValue: invoiceValue || "Not found",
    contractValue: contractValue || "Not saved",
    status,
    note
  });
  if (!match) {
    return [
      row("Contract match", invoice.vendor || invoice.name || "Invoice uploaded", "", "Review", "No approved contract matched confidently.")
    ];
  }
  const same = (a, b) => a && b && normalizeMatchValue(a) === normalizeMatchValue(b);
  const invoiceTotal = moneyToNumber(invoice.total);
  const contractRate = moneyToNumber(match.contractRate);
  const rows = [
    row("Matched contract", invoice.name || invoice.uploadedFileName, match.contractName, match.confidence >= 75 ? "OK" : "Review", `${match.confidence || 0}% confidence: ${(match.reasons || []).join(", ") || "matched by saved data"}`),
    row("Vendor", invoice.vendor, match.vendor, same(invoice.vendor, match.vendor) || textContainsValue(invoice.ocrText || "", match.vendor) ? "OK" : "Review"),
    row("Facility", invoice.facility, match.facility, same(invoice.facility, match.facility) || textContainsValue(invoice.ocrText || "", match.facility) ? "OK" : "Review"),
    row("Service / Category", invoice.category || invoice.matchedCategory, match.category, invoice.matchedCategory ? "OK" : "Review"),
    row("Invoice total vs contract fee", invoice.total, match.contractRate, invoiceTotal && contractRate ? invoiceTotal <= contractRate * 1.05 ? "OK" : "Review" : "Missing", invoiceTotal && contractRate ? "Allows 5% tolerance before flagging." : "Need invoice total and contract fee/rate."),
    row("Payment terms", invoice.paymentTerms, match.paymentTerms, invoice.paymentTerms && match.paymentTerms ? same(invoice.paymentTerms, match.paymentTerms) ? "OK" : "Review" : "Missing"),
    row("Contract dates", invoice.invoiceDate, [match.start, match.end].filter(Boolean).join(" to "), match.start || match.end ? "Review" : "Missing", "Use this to confirm the invoice falls inside the contract term."),
    row("Renewal / termination", "", [match.autoRenewal, match.termination].filter(Boolean).join(" | "), match.autoRenewal || match.termination ? "Review" : "Missing")
  ];
  return rows;
}

function invoiceServiceLineChecks(invoice = {}, match = null) {
  const lines = Array.isArray(invoice.serviceLines) ? invoice.serviceLines : [];
  if (!lines.length) return [{ description: "No invoice service lines found", amount: "", status: "Review", proof: "Invoice OCR found a total but no clear service line items." }];
  if (!match?.contractId) return lines.map(line => ({ ...line, status: "Review", proof: "No matched contract to compare against." }));
  const contract = getContract(match.contractId);
  const contractText = cleanOcrText([
    contract?.ocrText,
    contract?.ocrTextPreview,
    contract?.services,
    contract?.category,
    contract?.labTestPricing,
    contract?.specimenPickup,
    ...(contract?.extractedFeeLines || []).map(line => `${line.service || ""} ${line.rate || ""} ${line.source || ""}`)
  ].filter(Boolean).join("\n"));
  return lines.map(line => {
    const description = String(line.description || "").trim();
    const words = description.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 4 && !/^(service|charge|amount|invoice|date|unit|price|total)$/.test(word));
    const matchedWords = words.filter(word => contractText.toLowerCase().includes(word));
    const amountFound = line.amount && contractText.includes(line.amount.replace("$", ""));
    const strong = matchedWords.length >= Math.min(2, Math.max(1, words.length)) || amountFound || textContainsValue(contractText, description);
    return {
      ...line,
      status: strong ? "Allowed / Found" : "Review",
      proof: strong
        ? `Found in contract: ${matchedWords.slice(0, 6).join(", ") || line.amount || "service wording"}`
        : "Could not find this service/charge in the matched contract text."
    };
  });
}

function facilityProfileForName(name = "") {
  const key = canonicalNameKey(name);
  if (!key) return null;
  return (getAdminSettings().facilityProfiles || []).find(profile =>
    canonicalNameKey(profile.name) === key
    || canonicalNameKey(profile.dba) === key
    || canonicalNameKey(profile.legalName) === key
    || (profile.aliases || []).some(alias => canonicalNameKey(alias) === key)
  ) || null;
}

function invoiceCostPerBed(invoice, match = null) {
  const facilityName = invoice.facility || match?.facility || "";
  const profile = facilityProfileForName(facilityName);
  const beds = Number(profile?.beds || invoice.beds || 0);
  const amount = moneyToNumber(invoice.total);
  if (!amount || !beds) {
    return {
      facility: facilityName,
      beds,
      invoiceTotal: invoice.total || "",
      costPerBed: "",
      costPerBedLabel: beds ? "Missing invoice total" : "Missing bed count",
      source: beds ? "Invoice total missing" : "Facility bed count missing"
    };
  }
  const perBed = amount / beds;
  return {
    facility: facilityName,
    beds,
    invoiceTotal: invoice.total || "",
    costPerBed: Number(perBed.toFixed(2)),
    costPerBedLabel: `$${perBed.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
    source: `Invoice total divided by ${beds} beds`
  };
}

function addOrUpgradeField(fields, label, value, confidence, source, snippet = "") {
  if (!value) return;
  const key = label.toLowerCase();
  const existing = fields.find(field => String(field.label || "").toLowerCase() === key);
  const next = extractedField(label, value, confidence, source, snippet);
  if (!existing) {
    fields.push(next);
    return;
  }
  if (confidence >= (existing.confidence || 0)) {
    Object.assign(existing, next);
  }
}

function matchUtilityAccount(text) {
  const accounts = listUtilityAccounts();
  const clean = cleanOcrText(text);
  let best = null;
  for (const account of accounts) {
    let score = 0;
    const reasons = [];
    if (textContainsValue(clean, account.accountNumber)) {
      score += 100;
      reasons.push("account number");
    }
    if (textContainsValue(clean, account.meterNumber)) {
      score += 85;
      reasons.push("meter number");
    }
    if (textContainsValue(clean, account.serviceAddress)) {
      score += 70;
      reasons.push("service address");
    }
    if (textContainsValue(clean, account.facility)) {
      score += 55;
      reasons.push("facility name");
    }
    if (textContainsValue(clean, account.vendor)) {
      score += 35;
      reasons.push("vendor name");
    }
    for (const alias of account.aliases || []) {
      if (textContainsValue(clean, alias)) {
        score += 30;
        reasons.push(`alias: ${alias}`);
      }
    }
    if (score && (!best || score > best.score)) best = { account, score: Math.min(score, 100), reasons };
  }
  return best;
}

function enrichFieldsWithUtilityAccount(fields, text) {
  const match = matchUtilityAccount(text);
  if (!match || match.score < 70) return { fields, match: null };
  const { account, score, reasons } = match;
  const source = `Utility account match: ${reasons.join(", ")}`;
  addOrUpgradeField(fields, "Facility", account.facility, score, source, account.serviceAddress);
  addOrUpgradeField(fields, "Vendor", account.vendor, score, source, account.accountNumber);
  addOrUpgradeField(fields, "Category", account.utilityType, Math.max(72, score - 10), source, "");
  addOrUpgradeField(fields, "Account Number", account.accountNumber, score, source, account.accountNumber);
  addOrUpgradeField(fields, "Meter Number", account.meterNumber, Math.max(70, score - 5), source, account.meterNumber);
  addOrUpgradeField(fields, "Service Address", account.serviceAddress, Math.max(70, score - 8), source, account.serviceAddress);
  return { fields, match };
}

function contractExtractionSchema() {
  const fieldSchema = {
    type: "object",
    additionalProperties: false,
    required: ["label", "value", "confidence", "source_snippet"],
    properties: {
      label: { type: "string" },
      value: { type: "string" },
      confidence: { type: "number" },
      source_snippet: { type: "string" }
    }
  };
  return {
    type: "object",
    additionalProperties: false,
    required: ["contract_type", "fields", "category_fields", "clauses", "confidence_notes"],
    properties: {
      contract_type: { type: "string" },
      fields: { type: "array", items: fieldSchema },
      category_fields: { type: "array", items: fieldSchema },
      clauses: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["type", "snippet", "risk", "source"],
          properties: {
            type: { type: "string" },
            snippet: { type: "string" },
            risk: { type: "string" },
            source: { type: "string" }
          }
        }
      },
      confidence_notes: { type: "array", items: { type: "string" } }
    }
  };
}

function responseOutputText(response) {
  if (response.output_text) return response.output_text;
  return (response.output || [])
    .flatMap(item => item.content || [])
    .map(content => content.text || "")
    .join("")
    .trim();
}

function parseAiJson(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI did not return JSON.");
    return JSON.parse(match[0]);
  }
}

function normalizeAiResult(result = {}) {
  return {
    contract_type: result.contract_type || result.contractType || "",
    fields: Array.isArray(result.fields) ? result.fields.map(field => ({
      label: String(field.label || field.name || "Field"),
      value: String(field.value || ""),
      confidence: Number(field.confidence || 65),
      source_snippet: String(field.source_snippet || field.source || field.snippet || "")
    })) : [],
    category_fields: Array.isArray(result.category_fields) ? result.category_fields.map(field => ({
      label: String(field.label || field.name || "Field"),
      value: String(field.value || ""),
      confidence: Number(field.confidence || 65),
      source_snippet: String(field.source_snippet || field.source || field.snippet || "")
    })) : [],
    clauses: Array.isArray(result.clauses) ? result.clauses.map(clause => ({
      type: String(clause.type || "Clause"),
      snippet: String(clause.snippet || ""),
      risk: String(clause.risk || "Review"),
      source: String(clause.source || "AI")
    })) : [],
    confidence_notes: Array.isArray(result.confidence_notes) ? result.confidence_notes : []
  };
}

async function ollamaStatus() {
  try {
    const response = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { available: false, models: [] };
    const data = await response.json();
    const models = (data.models || []).map(model => model.name);
    return { available: true, models, hasModel: models.some(name => name === ollamaModel || name.startsWith(`${ollamaModel}:`)) };
  } catch {
    return { available: false, models: [] };
  }
}

async function runOllamaExtraction(text, hints = {}, ruleExtraction = {}) {
  const status = await ollamaStatus();
  if (!status.available) {
    return {
      enabled: false,
      status: "not_configured",
      provider: "ollama",
      model: ollamaModel,
      message: "Install Ollama, start it, and pull a model to enable free local AI."
    };
  }
  if (!status.hasModel) {
    return {
      enabled: false,
      status: "model_missing",
      provider: "ollama",
      model: ollamaModel,
      message: `Run: ollama pull ${ollamaModel}`
    };
  }
  const prompt = [
    "You are a contract extraction fallback after OCR/rules. Fill ONLY missing or weak fields supported by the OCR text. Return ONLY valid JSON.",
    "Use this shape: {\"contract_type\":\"\",\"fields\":[{\"label\":\"Vendor\",\"value\":\"\",\"confidence\":70,\"source_snippet\":\"\"}],\"category_fields\":[],\"clauses\":[{\"type\":\"\",\"snippet\":\"\",\"risk\":\"Review\",\"source\":\"Ollama\"}],\"confidence_notes\":[]}.",
    "Never guess. If the exact answer is not supported by wording in OCR text, omit that field. Use short source_snippet text copied from the OCR. Focus on missing_fields first.",
    "For Contract Type/Category, use the service being purchased from the contract title, vendor, scope, or first-page wording. Do NOT classify a contract as Insurance just because insurance requirements, liability coverage, or certificates appear in boilerplate.",
    "Common labels: Vendor, Facility, Contract Type, Effective Date, Cost, Payment Terms, Auto Renewal, Termination, Notice Period. Also include account/customer/member/policy/site numbers, per-unit pricing, insurance, and service address only when clearly present.",
    JSON.stringify({ hints, rule_extraction: ruleExtraction.fields || [], ocr_text: cleanOcrText(text).slice(0, 9000) })
  ].join("\n\n");
  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: ollamaModel, prompt, stream: false, format: "json" }),
    signal: AbortSignal.timeout(aiTimeoutMs)
  });
  if (!response.ok) throw new Error(`Ollama extraction failed: ${await response.text()}`);
  const data = await response.json();
  return {
    enabled: true,
    status: "complete",
    provider: "ollama",
    model: ollamaModel,
    result: normalizeAiResult(parseAiJson(data.response))
  };
}

function contractReviewAiExcerpts(text = "") {
  const clean = cleanOcrText(text);
  const excerpts = [clean.slice(0, 1500)];
  const seen = new Set();
  const pricingTerms = /\b(?:fee schedule|rate schedule|pricing|unit price|number of units|monthly subtotal|monthly grand total|monthly recurring|mrc|non[-\s]?recurring|nrc|payment amount|number of payments|per month|per unit|per mile|per hour|per square foot|estimated taxes|subsidy|credit|surcharge|installation fee|termination fee|cancellation fee)\b/gi;
  for (const match of clean.matchAll(pricingTerms)) {
    const excerpt = snippetAround(clean, match.index || 0, 440);
    const key = normalizeMatchValue(excerpt).slice(0, 160);
    if (!excerpt || seen.has(key)) continue;
    seen.add(key);
    excerpts.push(excerpt);
    if (excerpts.length >= 9) break;
  }
  return excerpts.join("\n\n--- Relevant contract section ---\n\n").slice(0, 5200);
}

function validAiReviewFieldSuggestion(field = {}) {
  const label = reviewFieldCanonicalLabel(field.label || "");
  const value = String(field.value || "").replace(/\s+/g, " ").trim();
  if (!label || !value) return false;
  if (label === "quantity of services") {
    // A billing unit such as "per visit" is frequency, not a service quantity.
    return /\d/.test(value) && !/^per\s+[a-z -]+$/i.test(value);
  }
  if (label === "billing frequency") {
    return /\b(?:one[- ]?time|daily|weekly|biweekly|monthly|quarterly|annual(?:ly)?|yearly|per\s+(?:visit|service|mow|trip|mile|hour|day|pickup|delivery|unit|inch))\b/i.test(value);
  }
  return true;
}

function normalizeAiReviewFeeLine(line = {}, source = "") {
  const combined = `${line.service || ""} ${line.rate || ""} ${line.unit || ""} ${line.frequency || ""} ${source}`.replace(/\s+/g, " ").trim();
  const moneyMatch = combined.match(/\$\s*[\d,]+(?:\.\d{1,2})?/);
  const perUnitMatch = combined.match(/\bper\s+(square\s+foot|sq\.?\s*ft|linear\s+foot|visit|service|mow|trip|mile|hour|day|pickup|delivery|unit|inch|room|bed)\b/i);
  const frequencyMatch = combined.match(/\b(daily|weekly|biweekly|monthly|quarterly|annual(?:ly)?|yearly|per\s+(?:visit|service|mow|trip|day|pickup|delivery))\b/i);
  let service = String(line.service || "Fee").replace(/\s+/g, " ").trim();
  if (/after\s+10\s+inches/i.test(combined)) service = "Snow removal over 10 inches";
  if (service.length > 80) service = service.slice(0, 77).trimEnd() + "...";
  const unit = String(line.unit || perUnitMatch?.[1] || "").replace(/^sq\.?\s*ft$/i, "square foot").trim();
  const frequency = String(line.frequency || frequencyMatch?.[1] || "").replace(/^per\s+/i, "Per ").trim();
  return {
    ...line,
    service,
    rate: moneyMatch ? moneyMatch[0].replace(/\s+/g, "") : String(line.rate || "").trim(),
    unit,
    frequency,
    chargeType: perUnitMatch ? "Variable" : line.chargeType,
    source_snippet: source
  };
}

async function runOllamaContractReview(contract = {}, pastedFeeText = "") {
  const status = await ollamaStatus();
  if (!status.available || !status.hasModel) {
    return {
      enabled: false,
      status: status.available ? "model_missing" : "not_configured",
      provider: "ollama",
      model: ollamaModel,
      message: status.available ? `Run: ollama pull ${ollamaModel}` : "Start Ollama, then try again."
    };
  }
  const ocrText = cleanOcrText(contract.ocrText || contract.extractedText || contract.fullText || "");
  if (!ocrText) return { enabled: false, status: "no_ocr", message: "Run OCR first so AI has contract text to review." };
  const pastedPricing = cleanOcrText(pastedFeeText).slice(0, 8000);
  const reviewSourceText = pastedPricing || ocrText;
  const reviewText = pastedPricing || contractReviewAiExcerpts(ocrText);
  const currentFields = (contract.extractedFields || []).slice(0, 30).map(field => ({
    label: field.label || "",
    value: field.value || "",
    source: String(field.source || field.snippet || "").slice(0, 180)
  }));
  const currentFees = (contract.extractedFeeLines || []).slice(0, 20).map(line => ({
    service: line.service || "",
    chargeType: line.chargeType || "",
    unit: line.unit || "",
    rate: line.rate || "",
    quantity: line.quantity || "",
    calculatedAmount: line.calculatedAmount || "",
    frequency: line.frequency || "",
    source: String(line.source || "").slice(0, 180)
  }));
  const prompt = [
    pastedPricing
      ? "You are a cautious fee-schedule extraction assistant. Read only the pasted pricing wording and return clean fee rows. Return ONLY valid JSON."
      : "You are a cautious contract-review assistant. Review OCR text against the current saved fields and fee rows. Return ONLY valid JSON.",
    "Never guess and never approve. Suggest a correction only when exact supporting words appear in OCR text. Keep source_snippet short and copied from OCR.",
    "Separate recurring, one-time, per-unit, tax, financing, credit, and contingent termination charges. Do not treat insurance limits, damages, penalties, or legal examples as normal spend.",
    "Understand fee schedules as calculations. When a document says unit rate x quantity = total, save the unit rate, unit, quantity, calculated total, and billing frequency in ONE fee row. Do not also save the same calculated total as a duplicate fee row.",
    "Billing Frequency describes when a charge occurs, such as monthly or per visit. Quantity of Services must be a numeric count or measured amount. Never put per visit, per mile, or per service into Quantity of Services.",
    "For every fee row, keep service as a short name, rate as one monetary value, unit as the measurement such as inch or mile, and frequency as when it is billed. Do not combine these parts into one field.",
    "A base monthly charge plus an additional per-unit charge are TWO linked fee rows. Taxes and surcharges are separate. Discounts and credits reduce cost. Financing payments stay separate from service pricing. Cancellation exposure is contingent and must not be included in annual spend.",
    "Only annualize a fixed monthly or annual amount. Do not annualize per-mile, per-service, per-hour, per-unit, or usage pricing unless the contract supplies the quantity and frequency needed for the calculation.",
    "Return: {\"summary\":\"\",\"issues\":[{\"severity\":\"High|Medium|Low\",\"field\":\"\",\"message\":\"\"}],\"suggested_fields\":[{\"label\":\"\",\"value\":\"\",\"confidence\":0,\"source_snippet\":\"\"}],\"suggested_fee_lines\":[{\"service\":\"\",\"chargeType\":\"Recurring|Variable|One-time|Tax|Financing|Credit|Contingent\",\"unit\":\"\",\"rate\":\"\",\"quantity\":\"\",\"calculatedAmount\":\"\",\"frequency\":\"\",\"source_snippet\":\"\"}]}",
    JSON.stringify({ contract_name: contract.name || "", current_fields: currentFields, current_fee_lines: currentFees, pasted_fee_wording: pastedPricing, relevant_ocr_sections: reviewText })
  ].join("\n\n");
  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      prompt,
      stream: false,
      format: "json",
      keep_alive: "10m",
      options: { temperature: 0.1, num_ctx: 8192, num_predict: 900 }
    }),
    signal: AbortSignal.timeout(Math.max(aiTimeoutMs, 150000))
  });
  if (!response.ok) throw new Error(`Ollama review failed: ${await response.text()}`);
  const data = parseAiJson((await response.json()).response);
  const supportedFields = (Array.isArray(data.suggested_fields) ? data.suggested_fields : [])
    .filter(field => field?.label && field?.value && validAiReviewFieldSuggestion(field) && textContainsValue(reviewSourceText, String(field.value)))
    .slice(0, 20)
    .map(field => {
      const index = reviewSourceText.toLowerCase().indexOf(String(field.value).toLowerCase());
      return { ...field, source_snippet: index >= 0 ? snippetAround(reviewSourceText, index, 260) : String(field.source_snippet || "") };
    });
  const supportedFees = (Array.isArray(data.suggested_fee_lines) ? data.suggested_fee_lines : [])
    .filter(line => line?.service && line?.rate && textContainsValue(reviewSourceText, String(line.rate)))
    .slice(0, 16)
    .map(line => {
      const index = reviewSourceText.toLowerCase().indexOf(String(line.rate).toLowerCase());
      const source = index >= 0 ? snippetAround(reviewSourceText, index, 260) : String(line.source_snippet || "");
      const perUnit = String(line.rate || source).match(/\bper\s+(mow|visit|service|trip|mile|hour|day|pickup|delivery|unit)\b/i)?.[1] || "";
      const explicitlyMonthly = /\b(?:monthly|per month|each month|\/month|mrc)\b/i.test(source);
      return normalizeAiReviewFeeLine({
        ...line,
        chargeType: perUnit && !explicitlyMonthly ? "Variable" : line.chargeType,
        frequency: perUnit && !explicitlyMonthly ? `Per ${perUnit.toLowerCase()}` : line.frequency
      }, source);
    });
  return {
    enabled: true,
    status: "complete",
    provider: "ollama",
    model: ollamaModel,
    summary: String(data.summary || "AI review complete."),
    issues: Array.isArray(data.issues) ? data.issues.slice(0, 20) : [],
    suggestedFields: supportedFields,
    suggestedFeeLines: supportedFees
  };
}

async function runOllamaUtilityBillExtraction(text, hints = {}) {
  const status = await ollamaStatus();
  if (!aiExtractionEnabled || !status.available || !status.hasModel) {
    return { enabled: false, status: status.available ? "model_missing" : "not_configured", provider: "ollama", model: ollamaModel };
  }
  const prompt = [
    "You are a utility-bill extraction fallback after OCR and deterministic rules. Return ONLY valid JSON and never guess.",
    "Only fill a value when exact supporting wording appears in OCR text. Use null for unsupported values.",
    "Current charges means new charges for this service period only. Never use amount due, prior/previous balance, past due, payments, or carried balance as current charges.",
    "Keep supply and delivery separate. Supplier usage may duplicate delivery-meter usage, so identify provider_role. Preserve the printed usage unit.",
    "Return this shape: {\"utility_type\":null,\"provider\":null,\"provider_role\":null,\"account_number\":null,\"meter_number\":null,\"service_start\":null,\"service_end\":null,\"usage\":null,\"usage_unit\":null,\"peak_demand_kw\":null,\"rate_class\":null,\"current_charges\":null,\"supply_charges\":null,\"delivery_charges\":null,\"demand_charges\":null,\"taxes\":null,\"fees\":null,\"credits\":null,\"adjustments\":null,\"prior_balance\":null,\"total_amount_due\":null,\"source_snippets\":[]}",
    JSON.stringify({ hints, ocr_text: cleanOcrText(text).slice(0, 12000) })
  ].join("\n\n");
  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: ollamaModel, prompt, stream: false, format: "json" }),
    signal: AbortSignal.timeout(aiTimeoutMs)
  });
  if (!response.ok) throw new Error(`Ollama utility-bill extraction failed: ${await response.text()}`);
  const data = await response.json();
  return { enabled: true, status: "complete", provider: "ollama", model: ollamaModel, result: parseAiJson(data.response) };
}

async function runAiExtraction(text, hints = {}, ruleExtraction = {}) {
  if (!aiExtractionEnabled) {
    return {
      enabled: false,
      status: "disabled",
      provider: "rules-only",
      model: "",
      message: "AI extraction is turned off. OCR and rule extraction are running."
    };
  }
  if (!process.env.OPENAI_API_KEY) {
    return runOllamaExtraction(text, hints, ruleExtraction);
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: openAiModel,
      input: [
        {
          role: "developer",
          content: "Extract contract data from OCR text. Return only fields supported by the text. Use short source snippets. Include common fields and contract-type-specific fields such as account number, customer number, member number, vendor number, policy number, contract/reference number, meter number, service address, payment terms, days payable such as Net 30 or paid within 45 days, per-day/per-unit/per-service rate, fee schedule, pickup or service frequency, kWh price, therm price, mowing frequency, price per pound, delivery fee, insurance limits, or other service-specific pricing terms when present."
        },
        {
          role: "user",
          content: JSON.stringify({
            hints,
            rule_extraction: ruleExtraction.fields || [],
            ocr_text: cleanOcrText(text).slice(0, 60000)
          })
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "contract_extraction",
          strict: true,
          schema: contractExtractionSchema()
        }
      }
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI extraction failed: ${errorText}`);
  }
  const data = await response.json();
  return {
    enabled: true,
    status: "complete",
    model: openAiModel,
    result: JSON.parse(responseOutputText(data))
  };
}

function supportedField(fields, label) {
  const value = String(fieldValue(fields, label) || "").trim();
  if (!value || /^(needs review|needs classification|unknown|not found|tbd|n\/a|na)$/i.test(value)) return null;
  const canonical = canonicalContractKeyLabel(label).toLowerCase();
  return fields.find(field =>
    String(field.label || "") === label
    || canonicalContractKeyLabel(field.label).toLowerCase() === canonical
  ) || { label, value, confidence: 65 };
}

function hasAnySupportedField(fields, labels) {
  return labels.some(label => supportedField(fields, label));
}

function fieldHasSourceProof(field = {}, cleanText = "") {
  const value = String(field.value || "").replace(/\s+/g, " ").trim();
  if (!value || /^(needs review|needs classification|unknown|not found|tbd|n\/a|na|none)$/i.test(value)) return false;
  const label = canonicalContractKeyLabel(field.label).toLowerCase();
  const source = String(field.source || "");
  const snippet = String(field.snippet || field.sourceText || "");
  const proofText = `${snippet} ${cleanText}`;
  if (/pdf verified|source verified|verified against source|verified against actual|verified by reviewer/i.test(source)) return true;
  if (field.approved && field.approvedAt && /reviewer|review queue|manual reviewer|manual correction/i.test(source)) return true;
  if (field.approved && /^reviewer$/i.test(String(field.approvedBy || ""))) return true;
  if (label === "auto renewal") {
    if (/^yes$/i.test(value)) return /\b(auto(?:matic)?[-\s]?renew|renew(?:s|al)?\s+automatically|successive|additional\s+(?:one\s*)?\(?\d+\)?\s+year\s+renewal)\b/i.test(proofText);
    if (/^no$/i.test(value)) return /\b(no\s+auto(?:matic)?[-\s]?renew|shall\s+not\s+renew\s+automatically|does\s+not\s+automatically\s+renew)\b/i.test(proofText);
  }
  if (label === "indemnification") {
    return /\b(indemnification|indemnify|hold harmless|defend)\b/i.test(proofText);
  }
  if (label === "insurance requirement") {
    return /\b(insurance|liability|coverage|certificate of insurance|additional insured|commercial general liability|professional liability|workers?\s+compensation)\b/i.test(proofText);
  }
  if (label === "category" || label === "contract type") {
    return categorySupportedByContractText(value, `${snippet}\n${cleanText}`);
  }
  if (snippet && textContainsValue(snippet, value)) return true;
  if (value.length <= 80 && textContainsValue(cleanText, value)) return true;
  if (snippet && /ocr text|source|indemnification language found|service-start clause|pricing ocr|operations ocr/i.test(source)) return true;
  return false;
}

function fieldIsReviewerVerified(field = {}) {
  const source = String(field.source || "");
  if (/pdf verified|source verified|verified against source|verified against actual|verified by reviewer/i.test(source)) return true;
  if (field.approved && /^reviewer$/i.test(String(field.approvedBy || ""))) return true;
  if (field.approved && field.approvedAt && /reviewer|review queue|manual reviewer|manual correction/i.test(source)) return true;
  return false;
}

function unsafeAutoReviewFields(fields = [], cleanText = "") {
  const criticalLabels = new Set([
    "contract type",
    "vendor",
    "facility",
    "effective date",
    "cost",
    "auto renewal",
    "auto renew",
    "how to terminate"
  ]);
  const reviewerCanConfirmNotStated = new Set([
    "effective date",
    "auto renew",
    "how to terminate"
  ]);
  return (fields || []).filter(field => {
    const label = reviewFieldCanonicalLabel(field.label);
    if (!criticalLabels.has(label)) return false;
    const value = String(field.value || "").trim();
    const notStatedValue = /^(needs review|unknown|not found|not stated|not in contract|no fixed term|no fixed end date|n\/a|na|none)$/i.test(value);
    if (!value || /^needs classification$/i.test(value) || /^tbd$/i.test(value)) return true;
    if (notStatedValue) {
      return !(fieldIsReviewerVerified(field) && reviewerCanConfirmNotStated.has(label));
    }
    if (label === "contract type" && fieldIsReviewerVerified(field)) return false;
    if (isBadKeyFieldValue(field.label, value) || value.length > 180) return true;
    if (fieldIsReviewerVerified(field)) return false;
    if (Number(field.confidence || 0) < 82) return true;
    return !fieldHasSourceProof(field, cleanText);
  }).map(field => field.label || "Unknown field");
}

function extractionAgentReview(fields = [], aiExtraction = {}, feeLines = [], text = "") {
  const cleanText = cleanOcrText(text);
  const requiredGroups = [
    { label: "Vendor", labels: ["Vendor"] },
    { label: "Facility", labels: ["Facility"] },
    { label: "Service / Category", labels: ["Category", "Contract Type"] }
  ];
  const importantGroups = [
    { label: "Start or signature date", labels: ["Start of Services", "Start Date", "Effective Date", "Signature Date", "Signed Date"] },
    { label: "Contract length or term", labels: ["Initial Contract Length", "Contract Length", "Term", "Renewal Term"] },
    { label: "Payment terms", labels: ["Payment Terms", "Days Payable"] },
    { label: "Auto-renewal", labels: ["Auto Renewal"] },
    { label: "Termination / notice", labels: ["Termination", "Notice Period", "Termination Notice"] }
  ];
  const scoredFields = [...requiredGroups, ...importantGroups]
    .flatMap(group => group.labels.map(label => supportedField(fields, label)).filter(Boolean));
  const averageConfidence = scoredFields.length
    ? Math.round(scoredFields.reduce((sum, field) => sum + Number(field.confidence || 65), 0) / scoredFields.length)
    : 0;
  const missingRequired = requiredGroups
    .filter(group => !hasAnySupportedField(fields, group.labels))
    .map(group => group.label);
  const missingImportant = importantGroups
    .filter(group => !hasAnySupportedField(fields, group.labels))
    .map(group => group.label);
  const hasFee = hasAnySupportedField(fields, ["Fee", "Rate / Fee", "Contract Value", "Monthly Cost", "Per-Day / Unit Rate"]) || feeLines.length > 0;
  const feeMissing = !hasFee && /\b(fee|rate|price|charge|cost|payment|invoice|per month|monthly|annually|annual)\b/i.test(cleanText);
  const lowConfidenceFields = scoredFields.filter(field => Number(field.confidence || 0) < 70).map(field => field.label);
  const unsafeFields = unsafeAutoReviewFields(scoredFields, cleanText);
  const aiComplete = aiExtraction.status === "complete";
  const provider = aiExtraction.provider || (aiComplete ? "ai" : "rules");
  const score = Math.max(0, Math.min(100,
    Math.round((averageConfidence || 55)
      + (aiComplete ? 6 : 0)
      - missingRequired.length * 14
      - missingImportant.length * 5
      - lowConfidenceFields.length * 3
      - (feeMissing ? 8 : 0))
  ));
  const missing = [...missingRequired, ...missingImportant];
  if (feeMissing) missing.push("Fee / rate");
  const status = score >= aiAgentAutoReviewThreshold && !missingRequired.length && !feeMissing && !unsafeFields.length
    ? "AI Reviewed"
    : score >= aiAgentDraftThreshold
      ? "AI Drafted"
      : "Needs Human Review";
  return {
    status,
    score,
    averageConfidence,
    provider,
    missing,
    lowConfidenceFields,
    unsafeFields,
    failSafe: unsafeFields.length
      ? "Auto-save blocked because one or more important fields were low-confidence or lacked source proof."
      : "Important fields passed source-proof checks.",
    message: status === "AI Reviewed"
      ? "AI agent saved only fields with strong source proof."
      : status === "AI Drafted"
        ? "AI agent filled a draft. Review missing, low-confidence, or unproven fields before saving."
        : "AI agent needs human help. Key fields are missing or unclear.",
    autoReviewThreshold: aiAgentAutoReviewThreshold,
    draftThreshold: aiAgentDraftThreshold,
    reviewedAt: new Date().toISOString()
  };
}

async function migrateJsonToSqlite() {
  const contractCount = db.prepare("SELECT COUNT(*) AS total FROM contracts").get().total;
  const jobCount = db.prepare("SELECT COUNT(*) AS total FROM ocr_jobs").get().total;
  if (contractCount === 0) {
    for (const contract of await readJson("contracts.json")) saveContract(contract);
  }
  if (jobCount === 0) {
    for (const job of await readJson("ocr-jobs.json")) saveOcrJob(job);
  }
}

async function findExistingPath(paths) {
  for (const item of paths) {
    try {
      await fs.access(item);
      return item;
    } catch {
      // Try the next configured path.
    }
  }
  return "";
}

function pageNumberFromImage(fileName) {
  const match = fileName.match(/-(\d+)\.png$/i);
  return match ? Number(match[1]) : 0;
}

async function getPdfPageCount(sourcePath) {
  const pdfinfoPath = await findExistingPath(pdfinfoCandidates);
  if (!pdfinfoPath) return null;
  const { stdout } = await execTool(pdfinfoPath, [sourcePath], {
    maxBuffer: 1024 * 1024
  });
  const match = stdout.match(/^Pages:\s+(\d+)/m);
  return match ? Number(match[1]) : null;
}

async function extractPdfEmbeddedText(sourcePath) {
  const pdftotextPath = await findExistingPath(pdftotextCandidates);
  if (!pdftotextPath) return "";
  try {
    const { stdout } = await execTool(pdftotextPath, ["-layout", "-enc", "UTF-8", sourcePath, "-"], {
      maxBuffer: 30 * 1024 * 1024
    });
    const text = cleanOcrText(stdout);
    if (embeddedPdfTextIsCorrupt(text)) return "";
    return text.length >= 250 ? `--- Embedded PDF Text ---\n${text}` : "";
  } catch {
    return "";
  }
}

async function renderPdfWithPython(sourcePath, outputDir, progressCallback = null) {
  const pythonPath = await findExistingPath(pythonCandidates);
  if (!pythonPath) return null;
  try {
    await progressCallback?.({
      stage: "rendering",
      message: "Preparing PDF pages for OCR..."
    });
    const { stdout } = await execTool(pythonPath, [pdfRenderScript, sourcePath, outputDir, String(maxPdfPages)], {
      maxBuffer: 1024 * 1024
    });
    const match = stdout.trim().match(/^(\d+)\/(\d+)$/);
    return {
      renderedPages: match ? Number(match[1]) : null,
      pageCount: match ? Number(match[2]) : null,
      renderer: "pypdfium2"
    };
  } catch {
    return null;
  }
}

async function renderPdfWithPoppler(sourcePath, outputDir, progressCallback = null) {
  const pdftoppmPath = await findExistingPath(pdftoppmCandidates);
  if (!pdftoppmPath) return null;
  const pageCount = maxPdfPages > 0 ? await getPdfPageCount(sourcePath).catch(() => null) : null;
  const lastPage = maxPdfPages > 0 ? Math.min(pageCount || maxPdfPages, maxPdfPages) : null;
  await progressCallback?.({
    stage: "rendering",
    pageCount,
    renderedPages: lastPage,
    message: lastPage ? `Preparing ${lastPage} PDF page${lastPage === 1 ? "" : "s"} for OCR...` : "Preparing all PDF pages for OCR..."
  });
  const outputPrefix = path.join(outputDir, "page");
  const args = maxPdfPages > 0
    ? ["-png", "-r", "200", "-f", "1", "-l", String(lastPage), sourcePath, outputPrefix]
    : ["-png", "-r", "200", sourcePath, outputPrefix];
  await execTool(pdftoppmPath, args, {
    maxBuffer: 20 * 1024 * 1024
  });
  return {
    renderedPages: lastPage,
    pageCount,
    renderer: "poppler"
  };
}

async function extractPdfText(sourcePath, progressCallback = null) {
  await progressCallback?.({
    stage: "embedded-text",
    message: "Checking PDF text before OCR..."
  });
  const embeddedText = await extractPdfEmbeddedText(sourcePath);

  const tesseractPath = await findExistingPath(tesseractCandidates);
  if (!tesseractPath) {
    if (embeddedText) return `${embeddedText}\n\n[PDF text extracted without image OCR because Tesseract is not available.]`;
    throw new Error("Tesseract was not found. Install Tesseract on the server or set TESSERACT_PATH.");
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "contract-ocr-"));
  try {
    let renderResult = null;
    try {
      renderResult = await renderPdfWithPython(sourcePath, tempDir, progressCallback)
        || await renderPdfWithPoppler(sourcePath, tempDir, progressCallback);
      if (!renderResult) {
        throw new Error("PDF renderer not available. Install pypdfium2 for Python or Poppler.");
      }
    } catch (error) {
      if (embeddedText) {
        return `${embeddedText}\n\n[PDF image OCR skipped because the page renderer could not start: ${error.message}]`;
      }
      throw error;
    }
    const files = (await fs.readdir(tempDir))
      .filter(file => file.endsWith(".png"))
      .sort((a, b) => pageNumberFromImage(a) - pageNumberFromImage(b));
    if (!files.length) {
      throw new Error("No PDF pages were rendered for OCR.");
    }
    await progressCallback?.({
      stage: "ocr-started",
      pageCount: renderResult.pageCount || files.length,
      renderedPages: files.length,
      message: `OCR started for ${files.length} page${files.length === 1 ? "" : "s"}...`
    });
    const pages = [];
    for (const [index, file] of files.entries()) {
      const pageNumber = pageNumberFromImage(file) || pages.length + 1;
      const imagePath = path.join(tempDir, file);
      await progressCallback?.({
        stage: "ocr-page",
        page: index + 1,
        pageNumber,
        pageCount: files.length,
        message: `Reading page ${index + 1} of ${files.length}...`
      });
      const { stdout } = await execTool(tesseractPath, [imagePath, ...tesseractArgs], {
        maxBuffer: 20 * 1024 * 1024
      });
      pages.push(`--- Page ${pageNumber} ---\n${stdout.trim()}`);
      await progressCallback?.({
        stage: "ocr-page-complete",
        page: index + 1,
        pageNumber,
        pageCount: files.length,
        message: `Finished page ${index + 1} of ${files.length}.`
      });
    }
    await progressCallback?.({
      stage: "extracting-fields",
      pageCount: files.length,
      message: "OCR complete. Extracting contract fields..."
    });
    const limitedNotice = maxPdfPages > 0 && renderResult.pageCount && renderResult.pageCount > maxPdfPages
      ? `\n\n[OCR limited to first ${maxPdfPages} of ${renderResult.pageCount} pages. Set OCR_MAX_PDF_PAGES to raise this limit.]`
      : "";
    return `${embeddedText ? `${embeddedText}\n\n` : ""}${pages.join("\n\n")}\n\n[PDF rendered with ${renderResult.renderer}.]${limitedNotice}`.trim();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function extractTextWithWorker(sourcePath, progressCallback = null) {
  await progressCallback?.({
    stage: "ocr-worker",
    message: "Sending file to Python OCR worker..."
  });
  const response = await fetch(`${ocrWorkerUrl}/ocr`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: sourcePath, maxPages: maxPdfPages }),
    signal: AbortSignal.timeout(Math.max(120000, Number(process.env.OCR_WORKER_TIMEOUT_MS || 600000)))
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.text) {
    throw new Error(result.error || `OCR worker failed with status ${response.status}`);
  }
  await progressCallback?.({
    stage: "extracting-fields",
    message: "OCR worker complete. Extracting contract fields..."
  });
  return result.text;
}

async function isPdfFile(sourcePath) {
  const cleanPath = String(sourcePath || "").trim().replace(/^["']|["']$/g, "");
  if (path.extname(cleanPath).toLowerCase() === ".pdf") return true;
  let handle;
  try {
    handle = await fs.open(cleanPath, "r");
    const buffer = Buffer.alloc(5);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    return result.bytesRead >= 4 && buffer.toString("utf8", 0, 4) === "%PDF";
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function extractText(sourcePath, progressCallback = null) {
  sourcePath = String(sourcePath || "").trim().replace(/^["']|["']$/g, "");
  const ext = path.extname(sourcePath).toLowerCase();
  if ([".txt", ".text", ".md", ".csv", ".eml"].includes(ext)) {
    await progressCallback?.({
      stage: "text-file",
      message: "Reading text file..."
    });
    return fs.readFile(sourcePath, "utf8");
  }
  if (ext === ".doc") {
    throw new Error("Old .doc files cannot be read directly. Open it in Microsoft Word, save as .docx or PDF, then upload again.");
  }
  if (ext === ".docx") {
    const pythonPath = await findExistingPath(pythonCandidates);
    if (!pythonPath) throw new Error("Python is required to read Word .docx files. Save the document as PDF or install Python.");
    await progressCallback?.({
      stage: "word-text",
      message: "Reading Word document text..."
    });
    const { stdout } = await execTool(pythonPath, [docxToTextScript, sourcePath], {
      maxBuffer: 20 * 1024 * 1024
    });
    return stdout.trim();
  }
  if (ext === ".pdf") {
    try {
      return await extractTextWithWorker(sourcePath, progressCallback);
    } catch (error) {
      await progressCallback?.({
        stage: "ocr-worker-fallback",
        message: `Python OCR worker unavailable; trying built-in OCR path. ${error.message}`
      });
      return extractPdfText(sourcePath, progressCallback);
    }
  }
  if (await isPdfFile(sourcePath)) {
    try {
      return await extractTextWithWorker(sourcePath, progressCallback);
    } catch (error) {
      await progressCallback?.({
        stage: "ocr-worker-fallback",
        message: `PDF detected; using built-in PDF renderer. ${error.message}`
      });
      return extractPdfText(sourcePath, progressCallback);
    }
  }
  try {
    return await extractTextWithWorker(sourcePath, progressCallback);
  } catch {
    // Fall back to direct Tesseract for images when the Python worker is not running.
  }
  const tesseractPath = await findExistingPath(tesseractCandidates);
  if (!tesseractPath) {
    throw new Error("Tesseract was not found. Install Tesseract on the server or set TESSERACT_PATH.");
  }
  await progressCallback?.({
    stage: "ocr-image",
    message: "Reading image with OCR..."
  });
  const { stdout } = await execTool(tesseractPath, [sourcePath, ...tesseractArgs], {
    maxBuffer: 20 * 1024 * 1024
  });
  return stdout.trim();
}

class AppHttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function contentLength(req) {
  const raw = Number(req.headers["content-length"] || 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function assertRequestSize(req, limitBytes) {
  const length = contentLength(req);
  if (length && length > limitBytes) {
    throw new AppHttpError(`Request is too large. Limit is ${Math.round(limitBytes / 1024 / 1024)}MB.`, 413);
  }
}

async function readBody(req, limitBytes = maxJsonBytes) {
  assertRequestSize(req, limitBytes);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new AppHttpError(`Request is too large. Limit is ${Math.round(limitBytes / 1024 / 1024)}MB.`, 413);
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new AppHttpError("Request body is not valid JSON.", 400);
  }
}

async function readRawBody(req, limitBytes = maxUploadBytes) {
  assertRequestSize(req, limitBytes);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new AppHttpError(`Upload is too large. Limit is ${Math.round(limitBytes / 1024 / 1024)}MB.`, 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sanitizeFileName(name) {
  const base = path.basename(String(name || "upload.pdf"));
  const clean = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "upload.pdf";
  if (clean.length <= maxFileNameLength) return clean;
  const ext = path.extname(clean).slice(0, 16);
  const stem = clean.slice(0, Math.max(1, maxFileNameLength - ext.length));
  return `${stem}${ext}`;
}

function sanitizeFolderSegment(value, fallback = "Unclassified") {
  const clean = String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (clean || fallback).slice(0, 120);
}

function splitFacilityNames(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap(splitFacilityNames).filter(Boolean))];
  }
  const raw = String(value || "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/[;\n|]+|,\s*(?=[A-Z0-9])/)
    .map(item => item.replace(/\s+/g, " ").trim())
    .filter(item => item && !/^(needs classification|needs review|unknown|not found)$/i.test(item));
  const seen = new Set();
  return parts.filter(item => {
    const key = canonicalNameKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shareSyncTargetDir(root, facility, category, vendor) {
  return path.join(
    root,
    sanitizeFolderSegment(facility, "Needs Classification"),
    sanitizeFolderSegment(category, "Needs Classification"),
    sanitizeFolderSegment(vendor, "Needs Classification")
  );
}

function facilityProfileForFiling(name = "") {
  const targetKey = canonicalNameKey(name);
  if (!targetKey) return null;
  const profiles = getAdminSettings().facilityProfiles || [];

  // A saved facility name always wins. This prevents a city alias such as
  // "Bronx" from matching another facility whose address is in the Bronx.
  const primary = profiles.find(profile => canonicalNameKey(profile.name) === targetKey);
  if (primary) return primary;

  let best = null;
  let tied = false;
  for (const profile of profiles) {
    const values = [
      profile.dba,
      profile.legalName,
      profile.commonName,
      profile.shortName,
      profile.approvedDba,
      ...(Array.isArray(profile.aliases) ? profile.aliases : splitContractNames(profile.aliases))
    ].filter(Boolean);
    let profileScore = 0;
    for (const value of values) {
      const key = canonicalNameKey(value);
      if (!key || key.length < 5) continue;
      if (key === targetKey) profileScore = Math.max(profileScore, 2000 + key.length);
      else if (key.includes(targetKey) || targetKey.includes(key)) {
        profileScore = Math.max(profileScore, 1000 + Math.min(key.length, targetKey.length));
      }
    }
    if (!profileScore) continue;
    if (!best || profileScore > best.score) {
      best = { profile, score: profileScore };
      tied = false;
    } else if (profileScore === best.score && canonicalNameKey(profile.name) !== canonicalNameKey(best.profile.name)) {
      tied = true;
    }
  }
  return tied ? null : best?.profile || null;
}

function canonicalFacilityForFiling(name = "") {
  const clean = String(name || "").trim();
  return facilityProfileForFiling(clean)?.name || clean;
}

async function existingShareSyncFacilityFolder(root, facility) {
  const profile = facilityProfileForFiling(facility);
  const canonicalFacility = profile?.name || facility;
  const preferred = preferredFacilityFolder(canonicalFacility) || preferredFacilityFolder(facility);
  if (preferred) {
    const stat = await fs.stat(path.join(root, preferred));
    if (!stat.isDirectory()) throw new Error('Configured facility archive is not a folder.');
    return preferred;
  }
  const cleanFacility = sanitizeFolderSegment(canonicalFacility, "Needs Classification");
  const facilityKey = canonicalNameKey(cleanFacility);
  if (!root || !facilityKey) return cleanFacility;
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const directories = entries.filter(entry => entry.isDirectory());
    const exact = directories.find(entry => canonicalNameKey(entry.name) === facilityKey);
    if (exact) return exact.name;

    // Reuse an existing folder whose name is a saved DBA/legal/alias for this
    // facility. Never create a second folder solely because OCR used an alias.
    if (profile) {
      const aliasKeys = new Set([
        profile.dba,
        profile.legalName,
        profile.commonName,
        profile.shortName,
        profile.approvedDba,
        ...(Array.isArray(profile.aliases) ? profile.aliases : splitContractNames(profile.aliases))
      ].map(canonicalNameKey).filter(key => key && key.length >= 5));
      const aliasFolder = directories.find(entry => aliasKeys.has(canonicalNameKey(entry.name)));
      if (aliasFolder) return aliasFolder.name;
    }
  } catch {
    return cleanFacility;
  }
  return cleanFacility;
}

async function shareSyncTargetDirResolved(root, facility, category, vendor) {
  const facilityFolder = await existingShareSyncFacilityFolder(root, facility);
  return path.join(
    root,
    facilityFolder,
    sanitizeFolderSegment(category, "Needs Classification"),
    sanitizeFolderSegment(vendor, "Needs Classification")
  );
}

function configuredShareSyncRoot() {
  const root = String(getAdminSettings().shareSyncRoot || "").trim();
  if (root && root !== "/Contracts/" && path.isAbsolute(root)) return path.resolve(root);
  const fallbackRoot = process.env.SHARESYNC_ROOT || path.join(os.homedir(), "My ShareSync", "Signed Contracts");
  return path.resolve(fallbackRoot);
}

async function copyUploadToShareSync({ filePath, originalName, facility, category, vendor }) {
  const root = configuredShareSyncRoot();
  if (!root || !filePath) return null;
  const facilities = splitFacilityNames(facility).map(canonicalFacilityForFiling);
  const targetFacilities = facilities.length ? facilities : ["Needs Classification"];
  const cleanName = sanitizeFileName(originalName || path.basename(filePath));
  const copies = [];
  for (const targetFacility of targetFacilities) {
    const targetDir = await shareSyncTargetDirResolved(root, targetFacility, category, vendor);
    await fs.mkdir(targetDir, { recursive: true });
    const { targetPath, copyNeeded, reusedExisting } = await shareSyncCopyTarget(targetDir, cleanName, filePath);
    if (copyNeeded) await fs.copyFile(filePath, targetPath);
    copies.push({ facility: targetFacility, shareSyncLocalPath: targetPath, shareSyncFolderPath: targetDir, reusedExisting });
  }
  const primary = copies[0];
  return {
    shareSyncLocalPath: primary?.shareSyncLocalPath || "",
    shareSyncFolderPath: primary?.shareSyncFolderPath || "",
    shareSyncCopies: copies
  };
}

async function uniquePathForDirectory(targetDir, fileName) {
  const cleanName = sanitizeFileName(fileName || "contract.pdf");
  const ext = path.extname(cleanName);
  const stem = cleanName.slice(0, cleanName.length - ext.length) || "contract";
  let targetPath = path.join(targetDir, cleanName);
  for (let copy = 2; copy < 1000; copy += 1) {
    try {
      await fs.access(targetPath);
      targetPath = path.join(targetDir, `${stem}-${copy}${ext}`);
    } catch {
      break;
    }
  }
  return targetPath;
}

async function fileContentsMatch(leftPath, rightPath) {
  try {
    const [leftStat, rightStat] = await Promise.all([fs.stat(leftPath), fs.stat(rightPath)]);
    if (!leftStat.isFile() || !rightStat.isFile() || leftStat.size !== rightStat.size) return false;
    const [leftBuffer, rightBuffer] = await Promise.all([fs.readFile(leftPath), fs.readFile(rightPath)]);
    return uploadedContractFingerprint(leftBuffer) === uploadedContractFingerprint(rightBuffer);
  } catch {
    return false;
  }
}

async function shareSyncCopyTarget(targetDir, fileName, sourcePath = "") {
  const cleanName = sanitizeFileName(fileName || "contract.pdf");
  const ext = path.extname(cleanName);
  const stem = cleanName.slice(0, cleanName.length - ext.length) || "contract";
  for (let copy = 1; copy < 1000; copy += 1) {
    const suffix = copy === 1 ? "" : `-${copy}`;
    const targetPath = path.join(targetDir, `${stem}${suffix}${ext}`);
    try {
      await fs.access(targetPath);
      if (sourcePath && await fileContentsMatch(sourcePath, targetPath)) {
        return { targetPath, copyNeeded: false, reusedExisting: true };
      }
    } catch {
      return { targetPath, copyNeeded: true, reusedExisting: false };
    }
  }
  return { targetPath: await uniquePathForDirectory(targetDir, cleanName), copyNeeded: true, reusedExisting: false };
}

async function refileContractInShareSync(contract) {
  const root = configuredShareSyncRoot();
  if (!root) return null;
  const facility = contract.facility || fieldValue(contract.approvedFields || contract.extractedFields || [], "Facility");
  const category = contract.category || fieldValue(contract.approvedFields || contract.extractedFields || [], "Category") || fieldValue(contract.approvedFields || contract.extractedFields || [], "Contract Type");
  const vendor = contract.vendor || fieldValue(contract.approvedFields || contract.extractedFields || [], "Vendor");
  if (!facility || !category || !vendor) return null;
  const facilities = splitFacilityNames(facility).map(canonicalFacilityForFiling);
  const targetFacilities = facilities.length ? facilities : [facility];

  const existingShareSyncPath = String(contract.shareSyncLocalPath || "").trim().replace(/^["']|["']$/g, "");
  const uploadPath = String(contract.localFilePath || "").trim().replace(/^["']|["']$/g, "");
  const sourcePath = existingShareSyncPath && await fileExists(existingShareSyncPath)
    ? existingShareSyncPath
    : uploadPath && await fileExists(uploadPath)
      ? uploadPath
      : existingShareSyncPath || uploadPath;
  if (!sourcePath) return null;

  const fileName = contract.uploadedFileName || path.basename(existingShareSyncPath || uploadPath);
  const targetDirs = [];
  for (const targetFacility of targetFacilities) {
    targetDirs.push({
      facility: targetFacility,
      targetDir: await shareSyncTargetDirResolved(root, targetFacility, category, vendor)
    });
  }
  for (const target of targetDirs) await fs.mkdir(target.targetDir, { recursive: true });
  if (targetDirs.length === 1 && existingShareSyncPath) {
    const targetDir = targetDirs[0].targetDir;
    const resolvedTargetDir = path.resolve(targetDir);
    const resolvedExisting = path.resolve(existingShareSyncPath);
    if (path.dirname(resolvedExisting).toLowerCase() === resolvedTargetDir.toLowerCase()) {
      contract.shareSyncFolderPath = targetDir;
      contract.shareSyncLocalPath = existingShareSyncPath;
      return { shareSyncLocalPath: existingShareSyncPath, shareSyncFolderPath: targetDir, moved: false };
    }
  }

  if (targetDirs.length > 1) {
    const copies = [];
    for (const target of targetDirs) {
      const resolvedTargetDir = path.resolve(target.targetDir);
      if (existingShareSyncPath && path.dirname(path.resolve(existingShareSyncPath)).toLowerCase() === resolvedTargetDir.toLowerCase()) {
        copies.push({ facility: target.facility, shareSyncLocalPath: existingShareSyncPath, shareSyncFolderPath: target.targetDir, moved: false });
        continue;
      }
      const { targetPath, copyNeeded, reusedExisting } = await shareSyncCopyTarget(target.targetDir, fileName, sourcePath);
      if (copyNeeded) await fs.copyFile(sourcePath, targetPath);
      copies.push({ facility: target.facility, shareSyncLocalPath: targetPath, shareSyncFolderPath: target.targetDir, moved: copyNeeded, reusedExisting });
    }
    contract.shareSyncCopies = copies;
    contract.shareSyncLocalPath = copies[0]?.shareSyncLocalPath || contract.shareSyncLocalPath;
    contract.shareSyncFolderPath = copies[0]?.shareSyncFolderPath || contract.shareSyncFolderPath;
    contract.shareSyncRefiledAt = new Date().toISOString();
    delete contract.shareSyncMoveError;
    return { shareSyncLocalPath: contract.shareSyncLocalPath, shareSyncFolderPath: contract.shareSyncFolderPath, shareSyncCopies: copies, moved: false, copied: true, filePreserved: true };
  }

  const targetDir = targetDirs[0].targetDir;
  const { targetPath, copyNeeded, reusedExisting } = await shareSyncCopyTarget(targetDir, fileName, sourcePath);
  if (copyNeeded) await fs.copyFile(sourcePath, targetPath);
  contract.shareSyncLocalPath = targetPath;
  contract.shareSyncFolderPath = targetDir;
  contract.shareSyncRefiledAt = new Date().toISOString();
  delete contract.shareSyncMoveError;
  return { shareSyncLocalPath: targetPath, shareSyncFolderPath: targetDir, moved: false, copied: copyNeeded, reusedExisting, filePreserved: true };
}

const shareSyncImportExtensions = new Set([".pdf", ".docx", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".txt", ".text", ".md", ".eml"]);
const shareSyncSkipFolders = new Set(["templates", "templates for intelagree", "proposals", "unsorted"]);

async function scanShareSyncFiles(root, { limit = 100, maxDepth = 6 } = {}) {
  const found = [];
  async function walk(dir, depth = 0) {
    if (found.length >= limit || depth > maxDepth) return;
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= limit) return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const folderKey = entry.name.toLowerCase().trim();
        if (depth === 0 && shareSyncSkipFolders.has(folderKey)) continue;
        await walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!shareSyncImportExtensions.has(ext)) continue;
      found.push(fullPath);
    }
  }
  await walk(root, 0);
  return found;
}

function shareSyncHintsFromPath(filePath, root) {
  const relative = path.relative(root, filePath);
  const parts = relative.split(path.sep).filter(Boolean);
  const fileName = path.basename(filePath);
  const facility = parts.length > 1 ? parts[0] : "";
  const category = parts.length > 2 ? parts[1] : "";
  const vendor = parts.length > 3 ? parts[2] : "";
  return {
    relativePath: relative,
    uploadedFileName: fileName,
    facility: facility || "",
    category: category || "",
    vendor: vendor || ""
  };
}

function filenameFromRemoteResponse(remoteUrl, response) {
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  if (match) return sanitizeFileName(decodeURIComponent(match[1].replace(/"/g, "")));
  const urlPath = new URL(remoteUrl).pathname.split("/").filter(Boolean).pop() || "";
  return sanitizeFileName(urlPath || `sharesync-${Date.now()}.pdf`);
}

function extensionFromContentType(contentType = "") {
  const type = contentType.toLowerCase();
  if (type.includes("pdf")) return ".pdf";
  if (type.includes("png")) return ".png";
  if (type.includes("jpeg") || type.includes("jpg")) return ".jpg";
  if (type.includes("tiff")) return ".tiff";
  if (type.includes("plain")) return ".txt";
  if (type.includes("message/rfc822")) return ".eml";
  return "";
}

async function tryDownloadShareSyncLink(shareSyncUrl) {
  if (!shareSyncUrl) return null;
  let parsed;
  try {
    parsed = new URL(shareSyncUrl);
  } catch {
    throw new AppHttpError("ShareSync link is not a valid URL.", 400);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new AppHttpError("ShareSync link must start with http or https.", 400);
  }
  const response = await fetch(parsed.href, { redirect: "follow" });
  if (!response.ok) throw new AppHttpError(`ShareSync link could not be opened (${response.status}).`, 400);
  const contentType = response.headers.get("content-type") || "";
  if (/text\/html/i.test(contentType)) {
    throw new AppHttpError("ShareSync returned a web page, not the file. Use the synced ShareSync folder or a direct download link.", 400);
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxUploadBytes) {
    throw new AppHttpError(`ShareSync file is too large. Limit is ${Math.round(maxUploadBytes / 1024 / 1024)}MB.`, 413);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length) throw new AppHttpError("ShareSync link returned an empty file.", 400);
  if (buffer.length > maxUploadBytes) {
    throw new AppHttpError(`ShareSync file is too large. Limit is ${Math.round(maxUploadBytes / 1024 / 1024)}MB.`, 413);
  }
  let originalName = filenameFromRemoteResponse(parsed.href, response);
  const ext = path.extname(originalName).toLowerCase() || extensionFromContentType(contentType);
  if (ext && !path.extname(originalName)) originalName = sanitizeFileName(`${originalName}${ext}`);
  const allowed = new Set([".pdf", ".docx", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".txt", ".text", ".md", ".eml"]);
  if (!allowed.has(path.extname(originalName).toLowerCase())) {
    throw new AppHttpError("ShareSync link did not return a supported contract file.", 400);
  }
  const uploadId = `UP-${Date.now()}`;
  const filePath = path.join(uploadsDir, `${uploadId}-${originalName}`);
  await fs.writeFile(filePath, buffer);
  return {
    filePath,
    originalName,
    fileHash: uploadedContractFingerprint(buffer)
  };
}

function parseMultipartForm(buffer, contentType) {
  const boundaryMatch = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new AppHttpError("Missing multipart boundary.", 400);
  const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`;
  const body = buffer.toString("latin1");
  const fields = {};
  let file = null;
  let fieldCount = 0;
  for (const part of body.split(boundary)) {
    if (!part || part === "--\r\n" || part === "--") continue;
    const trimmed = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const separator = trimmed.indexOf("\r\n\r\n");
    if (separator === -1) continue;
    const rawHeaders = trimmed.slice(0, separator);
    const rawValue = trimmed.slice(separator + 4).replace(/\r\n--$/, "");
    const disposition = rawHeaders.match(/content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
    if (!disposition) continue;
    fieldCount += 1;
    if (fieldCount > maxMultipartFields) throw new AppHttpError("Upload contains too many form fields.", 400);
    const name = disposition[1];
    const filename = disposition[2];
    const contentTypeMatch = rawHeaders.match(/content-type:\s*([^\r\n]+)/i);
    if (filename !== undefined) {
      file = {
        fieldName: name,
        originalName: sanitizeFileName(filename),
        contentType: contentTypeMatch ? contentTypeMatch[1].trim() : "application/octet-stream",
        buffer: Buffer.from(rawValue, "latin1")
      };
    } else {
      fields[name] = Buffer.from(rawValue, "latin1").toString("utf8");
    }
  }
  return { fields, file };
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function headerIndexFrom(headers, ...names) {
  const normalized = headers.map(header => String(header || "").toLowerCase().replace(/[^a-z0-9]/g, ""));
  return normalized.findIndex(header => names.includes(header));
}

async function workbookRowsFromFile(filePath, sheetName = "") {
  const pythonPath = await findExistingPath(pythonCandidates);
  if (!pythonPath) throw new Error("Python is required to read Excel files on this server.");
  const { stdout } = await execTool(pythonPath, [excelToJsonScript, filePath, ...(sheetName ? [sheetName] : [])], {
    maxBuffer: 20 * 1024 * 1024
  });
  return JSON.parse(stdout || "[]");
}

function objectsFromRows(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const headers = rows[0].map(value => String(value || "").trim());
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? "").trim()])))
    .filter(item => Object.values(item).some(Boolean));
}

function findFacilityProfileForCensus(name = "", profiles = []) {
  const key = canonicalNameKey(name);
  if (!key) return null;
  const exactName = profiles.filter(profile => canonicalNameKey(profile?.name) === key);
  if (exactName.length === 1) return exactName[0];
  const namePrefix = profiles.filter(profile => {
    const profileKey = canonicalNameKey(profile?.name);
    return key.length >= 4 && profileKey && (profileKey.startsWith(key) || key.startsWith(profileKey));
  });
  if (namePrefix.length === 1) return namePrefix[0];
  const identityMatches = profiles.filter(profile => [
    profile?.shortName,
    profile?.commonName,
    profile?.legalName,
    profile?.dba
  ].some(alias => canonicalNameKey(alias) === key));
  return identityMatches.length === 1 ? identityMatches[0] : null;
}

function censusUpdatesFromRows(rows, profiles = [], sourceName = "") {
  const headers = Array.isArray(rows?.[0]) ? rows[0].map(value => String(value || "").trim()) : [];
  const normalizedHeaders = headers.map(value => normalizeMatchValue(value));
  const averageIndex = normalizedHeaders.lastIndexOf("average");
  const facilityIndexes = normalizedHeaders.map((value, index) => value === "facility" ? index : -1).filter(index => index >= 0);
  const summaryFacilityIndex = facilityIndexes.at(-1) ?? -1;
  const summaryMonthIndex = normalizedHeaders.lastIndexOf("month");
  const hasSummaryTable = averageIndex >= 0 && summaryFacilityIndex >= 0 && summaryMonthIndex >= 0
    && summaryFacilityIndex < averageIndex;
  const records = hasSummaryTable
    ? rows.slice(1).map(values => ({
      Facility: String(values[summaryFacilityIndex] ?? "").trim(),
      Month: String(values[summaryMonthIndex] ?? "").trim(),
      Date: String(values[summaryMonthIndex] ?? "").trim(),
      Census: String(values[averageIndex] ?? "").trim()
    })).filter(record => record.Facility && record.Census)
    : objectsFromRows(rows);
  const groups = new Map();
  const unmatched = new Set();
  for (const record of records) {
    const rawFacility = String(record.Facility || record.facility || "").trim();
    const census = Number(record.Census ?? record.census ?? 0);
    if (!rawFacility || !Number.isFinite(census) || census <= 0) continue;
    const profile = findFacilityProfileForCensus(rawFacility, profiles);
    if (!profile?.name) {
      unmatched.add(rawFacility);
      continue;
    }
    const dateValue = record.Date || record.date || "";
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) continue;
    const month = String(record.Month || record.month || date.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })).trim();
    const key = profile.name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ date, month, census });
  }

  const updates = [];
  for (const [name, values] of groups) {
    values.sort((a, b) => a.date - b.date);
    const monthly = new Map();
    for (const value of values) {
      if (!monthly.has(value.month)) monthly.set(value.month, []);
      monthly.get(value.month).push(value);
    }
    const history = [...monthly.entries()].map(([month, entries]) => ({
      month,
      average: entries.reduce((sum, entry) => sum + entry.census, 0) / entries.length,
      sortDate: entries[entries.length - 1].date
    })).sort((a, b) => a.sortDate - b.sortDate);
    const latest = values[values.length - 1];
    const latestMonth = history[history.length - 1];
    updates.push({
      name,
      currentCensus: latest.census,
      censusAsOf: latest.date.toISOString().slice(0, 10),
      averageDailyCensus: latestMonth.average,
      censusMonth: latestMonth.month,
      censusHistory: history.map(({ month, average }) => ({ month, average })),
      censusSource: sourceName || "Census workbook"
    });
  }
  return { updates, unmatched: [...unmatched].sort() };
}

function utilityAccountsFromTemplateRows(rows) {
  return objectsFromRows(rows).map((item, index) => {
    const facility = item.Facility || "";
    const utilityType = item["Utility Type"] || "";
    const accountNumber = item["Account Number"] || "";
    const meterNumber = item["Meter Number"] || "";
    if (!facility && !accountNumber && !meterNumber) return null;
    return {
      id: `UA-${crypto.createHash("sha1").update([facility, utilityType, accountNumber, meterNumber, index].join("|")).digest("hex").slice(0, 12)}`,
      facility,
      vendor: item.Supplier || "",
      utilityType,
      accountNumber,
      meterNumber,
      serviceAddress: item["Service Address"] || "",
      usageUnit: item["Usage Unit"] || "",
      demandUnit: item["Demand Unit"] || "",
      meterRole: item["Main/Submeter"] || "",
      parentMeter: item["Parent Meter"] || "",
      status: item.Status || "Active",
      source: "Utility intelligence workbook",
      createdAt: new Date().toISOString()
    };
  }).filter(Boolean);
}

function recordsFromRows(rows, mapper) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const headers = rows[0].map(value => String(value || ""));
  const normalizedHeaders = headers.map(header => normalizeMatchValue(header));
  const hasHeader = normalizedHeaders.some(header => /facility|vendor|name|address|legal|dba|beds|region|county|phone|service|services|category|contracttype/.test(header));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const effectiveHeaders = hasHeader ? headers : [];
  return dataRows.map((values, rowIndex) => mapper(effectiveHeaders, values, rowIndex)).filter(Boolean);
}

function facilityProfilesFromRows(rows) {
  return recordsFromRows(rows, (headers, values, rowIndex) => {
    const hasHeaders = Array.isArray(headers) && headers.length > 0;
    const pick = (...names) => {
      const index = headerIndexFrom(headers, ...names);
      return index >= 0 ? String(values[index] || "").trim() : "";
    };
    const fallback = (...indexes) => {
      if (hasHeaders) return "";
      for (const index of indexes) {
        const value = String(values[index] || "").trim();
        if (value) return value;
      }
      return "";
    };
    const shortName = pick("shortname", "facilityshortname", "code", "nickname", "facility") || fallback(0);
    const commonName = pick("commonname", "oldname", "oldfacilityname", "aka", "akaoldname", "previousname", "currentname", "facilityname2") || fallback(1);
    const phone = pick("phone", "telephone", "mainphone") || fallback(2);
    const fax = pick("fax", "alternatephone", "altphone") || fallback(3);
    const name = pick("facility", "facilityname", "name", "building", "site", "operatingname") || fallback(6, 1, 0);
    const cleanName = cleanPartyName(name);
    if (!cleanName || !/[a-z]/i.test(cleanName)) return null;
    const legalName = pick("legalname", "facilitylegalname", "licenseename", "operator", "operatingentity") || fallback(8, 5);
    const dba = pick("dba", "approveddba", "approveddoingbusinessas", "doingbusinessas", "alias", "tradeName", "tradename", "displayname") || fallback(9, 6);
    const street = pick("street", "streetaddress", "address1", "address") || fallback(10, 7);
    const cityStateZip = pick("citystatezip", "citystate", "cityzip", "citystatezipcode", "citystateandzip", "city") || fallback(11, 8);
    const rawAddress = pick("address", "facilityaddress", "location", "serviceaddress", "physicaladdress");
    const address = rawAddress && cityStateZip && !normalizeMatchValue(rawAddress).includes(normalizeMatchValue(cityStateZip))
      ? [rawAddress, cityStateZip].filter(Boolean).join(", ")
      : rawAddress || [street, cityStateZip].filter(Boolean).join(", ") || fallback(3);
    const county = pick("county") || fallback(12, 9);
    const group = pick("group", "region", "market", "area") || fallback(1);
    const state = pick("state") || fallback(3);
    const software = pick("software", "softw", "softwre", "sotfw") || fallback(5);
    const apSoftware = pick("apsoftware", "apsoft", "appayablesoftware") || fallback(6);
    const chart = pick("chart", "emr", "ehr") || fallback(7);
    const beds = pick("beds", "bed", "bedcount", "units", "licensedbeds") || fallback(4, 1);
    const squareFeet = pick("squarefeet", "squarefootage", "buildingsquarefeet", "buildingsquarefootage", "sqft", "sf");
    const squareFeetPerBed = pick("squarefeetperbed", "squarefootageperbed", "sqftperbed", "sfperbed");
    if (Number(beds) > 2000) return null;
    const cleanAliases = mergeTextList(pick("aliases", "alias", "oldnames", "othernames"), shortName, commonName, values[1], legalName, dba, address, street, cityStateZip, county, state)
      .filter(alias => /[a-z]/i.test(alias) && canonicalNameKey(alias) !== canonicalNameKey(cleanName));
    return {
      name: cleanName,
      shortName: cleanPartyName(shortName),
      commonName: cleanPartyName(commonName),
      legalName: cleanPartyName(legalName),
      dba: cleanPartyName(dba),
      phone,
      fax,
      beds,
      region: group || county,
      group,
      state,
      software,
      apSoftware,
      chart,
      squareFeet: Number(String(squareFeet || "").replace(/[^0-9.]/g, "")) || 0,
      squareFeetPerBed: Number(String(squareFeetPerBed || "").replace(/[^0-9.]/g, "")) || 0,
      county,
      address,
      street,
      cityStateZip,
      aliases: cleanAliases,
      latitude: pick("latitude", "lat"),
      longitude: pick("longitude", "lng", "lon"),
      sourceRow: rowIndex + 2
    };
  });
}

function vendorProfilesFromRows(rows) {
  return recordsFromRows(rows, (headers, values, rowIndex) => {
    const hasHeaders = Array.isArray(headers) && headers.length > 0;
    const pick = (...names) => {
      const index = headerIndexFrom(headers, ...names);
      return index >= 0 ? String(values[index] || "").trim() : "";
    };
    const isUtilityMaster = headerIndexFrom(headers, "glaccount", "glaccountnumber") >= 0
      && headerIndexFrom(headers, "actualbillaccount", "account", "accountnumber") >= 0;
    const name = isUtilityMaster
      ? pick("glaccount", "glaccountnumber", "vendor", "vendorname", "company")
      : pick("vendor", "vendors", "vendorname", "company", "supplier", "provider")
      || (!hasHeaders ? String(values[2] || values[0] || "").trim() : "");
    if (!name) return null;
    const cleanName = cleanPartyName(name);
    if (!cleanName || !/[a-z]/i.test(cleanName)) return null;
    if (["facility", "vendor", "vendors", "service", "services"].includes(canonicalNameKey(cleanName))) return null;
    const facility = isUtilityMaster
      ? pick("facility", "facilityname", "building", "site", "vendor")
      : pick("facility", "facilityname", "building", "site") || String(values[0] || "").trim();
    const service = isUtilityMaster
      ? pick("gl", "services", "service", "category", "servicetype", "contracttype")
      : pick("services", "service", "category", "servicetype", "contracttype") || String(values[1] || "").trim();
    return {
      name: cleanName,
      legalName: pick("legalname", "vendorlegalname") || cleanName,
      dba: pick("dba", "alias", "doingbusinessas"),
      primaryContact: pick("contact", "primarycontact", "accountmanager"),
      phone: pick("phone", "telephone", "vendorphone"),
      email: pick("email", "vendoremail"),
      mailingAddress: pick("address", "mailingaddress", "vendoraddress") || String(values[4] || "").trim(),
      aliases: String(pick("aliases", "othernames") || values[5] || "").split(/[;|]/).map(item => item.trim()).filter(Boolean),
      category: service,
      services: service && /[a-z]/i.test(service) ? [cleanPartyName(service)] : [],
      facilitiesServed: facility ? [facility] : [],
      paymentTerms: pick("paymentterms", "terms"),
      insuranceStatus: pick("insurance", "insurancestatus"),
      status: pick("status") || "Active",
      sourceRow: rowIndex + 2
    };
  });
}

function serviceNamesFromRows(rows) {
  return recordsFromRows(rows, (headers, values) => {
    const index = headerIndexFrom(headers, "services", "service", "category", "servicetype", "contracttype", "gl");
    const value = index >= 0 ? values[index] : values[1] || values[0];
    const clean = cleanPartyName(value);
    return clean ? { name: clean } : null;
  }).map(item => item.name);
}

function utilityAccountsFromRows(rows) {
  return recordsFromRows(rows, (headers, values, rowIndex) => {
    const pick = (...names) => {
      const index = headerIndexFrom(headers, ...names);
      return index >= 0 ? String(values[index] || "").trim() : "";
    };
    const isUtilityMaster = headerIndexFrom(headers, "glaccount", "glaccountnumber") >= 0
      && headerIndexFrom(headers, "actualbillaccount", "account", "accountnumber") >= 0;
    if (!isUtilityMaster) return null;
    const facility = pick("facility", "facilityname", "building", "site", "vendor");
    const vendor = pick("glaccount", "glaccountnumber", "vendorname", "company");
    const utilityType = pick("gl", "utilitytype", "type", "category", "service");
    const accountNumber = pick("actualbillaccount", "accountnumber", "account", "acct", "acctnumber");
    if (!facility && !vendor && !accountNumber) return null;
    return {
      id: `UA-${normalizeMatchValue([facility, vendor, utilityType, accountNumber].filter(Boolean).join("-")) || `utility-${rowIndex}`}`,
      facility,
      vendor,
      utilityType,
      accountNumber,
      usageMetric: pick("usagemetric"),
      usageTotal: pick("usagetotal"),
      totalAmount: pick("totalamount"),
      effectiveRate: pick("effectiverate"),
      status: "Active",
      source: "Utility master Excel import",
      createdAt: new Date().toISOString()
    };
  });
}

function utilityHistoryFromRows(rows, sourceName = "Utility data import") {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const headers = rows[0].map(value => String(value || ""));
  const pickFrom = (values, ...names) => {
    const index = headerIndexFrom(headers, ...names);
    return index >= 0 ? String(values[index] ?? "").trim() : "";
  };
  return rows.slice(1).map((values, rowIndex) => {
    const facility = pickFrom(values, "facility", "facilityname", "building", "site", "location");
    const utilityType = pickFrom(values, "utility", "utilitytype", "type", "service", "category");
    const servicePeriod = pickFrom(values, "serviceperiod", "billingperiod", "period", "month");
    const invoiceDate = pickFrom(values, "invoicedate", "billdate", "date") || servicePeriod;
    const total = pickFrom(values, "total", "totalamount", "netcost", "amount", "currentcharges", "cost");
    const usage = pickFrom(values, "usage", "usagetotal", "consumption", "quantity");
    const vendor = pickFrom(values, "vendor", "supplier", "utilityvendor", "company");
    if (!facility && !utilityType && !servicePeriod && !total && !usage) return null;
    const stamp = crypto.createHash("sha1")
      .update([facility, utilityType, servicePeriod, invoiceDate, total, usage, rowIndex].join("|"))
      .digest("hex").slice(0, 12);
    const now = new Date().toISOString();
    return {
      id: `UTIL-${stamp}`,
      name: `${facility || "Unmatched facility"} ${utilityType || "Utility"} ${servicePeriod || invoiceDate || `row ${rowIndex + 2}`}`,
      facility,
      vendor,
      utilityType,
      servicePeriod,
      invoiceDate,
      usage,
      usageUnit: pickFrom(values, "usageunit", "unit", "uom", "measure"),
      unitRate: pickFrom(values, "unitrate", "rate", "effectiverate"),
      demand: pickFrom(values, "demand", "demandkw", "peakdemand"),
      billingDays: pickFrom(values, "billingdays", "days", "servicedays"),
      invoiceNumber: pickFrom(values, "invoicenumber", "invoice", "billnumber"),
      servicePeriodLabel: pickFrom(values, "serviceperiodlabel", "servicedaterange", "daterange"),
      purpose: pickFrom(values, "purpose", "meterpurpose", "accountpurpose"),
      total,
      currentCharges: pickFrom(values, "currentcharges", "charges", "subtotal") || total,
      totalAmountDue: pickFrom(values, "total", "totalamount", "amountdue", "netbill"),
      credits: pickFrom(values, "credits", "credit"),
      adjustments: pickFrom(values, "adjustments", "adjustment"),
      taxes: pickFrom(values, "taxes", "tax"),
      accountNumber: pickFrom(values, "accountnumber", "account", "acct", "acctnumber"),
      meterNumber: pickFrom(values, "meternumber", "meter", "meterid"),
      patientDays: pickFrom(values, "patientdays", "residentdays", "censusdays"),
      readingType: pickFrom(values, "readingtype", "readtype", "actualestimated"),
      status: "Imported",
      source: sourceName,
      sourceFile: pickFrom(values, "sourcefile", "billfile", "filename"),
      uploadedFileName: sourceName,
      createdAt: now,
      updatedAt: now
    };
  }).filter(Boolean);
}

function parseUtilityAccountsCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map(header => header.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const headerIndex = (...names) => headers.findIndex(header => names.includes(header));
  const indexes = {
    facility: headerIndex("facility", "facilityname", "building", "site"),
    vendor: headerIndex("vendor", "utility", "utilityvendor", "company"),
    utilityType: headerIndex("utilitytype", "type", "category", "service"),
    accountNumber: headerIndex("accountnumber", "account", "acct", "acctnumber", "psegaccount"),
    meterNumber: headerIndex("meternumber", "meter", "meterid"),
    serviceAddress: headerIndex("serviceaddress", "address", "serviceaddr", "location"),
    vendorMailingAddress: headerIndex("vendormailingaddress", "vendoraddress", "mailingaddress", "remitto", "remitaddress"),
    vendorPhone: headerIndex("vendorphone", "phone", "telephone"),
    vendorEmail: headerIndex("vendoremail", "email"),
    aliases: headerIndex("aliases", "alias", "othernames"),
    status: headerIndex("status", "active")
  };
  return lines.slice(1).map((line, rowIndex) => {
    const values = splitCsvLine(line);
    const pick = key => indexes[key] >= 0 ? values[indexes[key]]?.trim() || "" : "";
    const accountNumber = pick("accountNumber");
    const meterNumber = pick("meterNumber");
    const facility = pick("facility");
    const vendor = pick("vendor") || "";
    return {
      id: `UA-${normalizeMatchValue(vendor || "utility")}-${normalizeMatchValue(accountNumber || meterNumber || facility || rowIndex) || Date.now()}`,
      facility,
      vendor,
      utilityType: pick("utilityType") || "Utility",
      accountNumber,
      meterNumber,
      serviceAddress: pick("serviceAddress"),
      vendorMailingAddress: pick("vendorMailingAddress"),
      vendorAddress: pick("vendorMailingAddress"),
      vendorPhone: pick("vendorPhone"),
      vendorEmail: pick("vendorEmail"),
      aliases: pick("aliases").split(/[;|]/).map(alias => alias.trim()).filter(Boolean),
      status: pick("status") || "Active",
      createdAt: new Date().toISOString()
    };
  }).filter(account => account.facility || account.accountNumber || account.meterNumber || account.serviceAddress);
}

function cleanContractDisplayName(value = "") {
  return String(value || "")
    .replace(/^UP-\d+-/i, "")
    .replace(/\.(pdf|docx?|png|jpe?g|tiff?|txt|text|md|eml)$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanContractNamePart(value = "") {
  const clean = cleanContractDisplayName(value)
    .replace(/[|]+/g, " ")
    .replace(/\s*[-–—]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean || /^(needs (?:review|classification)|unknown|not found|tbd|n\/a)$/i.test(clean)) return "";
  return clean.slice(0, 70);
}

function contractDisplayYear(contract = {}) {
  const source = [contract.startOfServices, contract.start, contract.effectiveDate, contract.signedDate, contract.signatureDate]
    .map(value => String(value || ""))
    .find(value => /\b(?:19|20)\d{2}\b/.test(value));
  return source?.match(/\b(?:19|20)\d{2}\b/)?.[0] || "";
}

function generatedContractDisplayName(contract = {}) {
  const vendor = cleanContractNamePart(contract.vendor);
  const service = cleanContractNamePart(contract.category || contract.services || contract.agreementType);
  if (!vendor || !service) return "";
  const facility = cleanContractNamePart(splitFacilityNames(contract.facility)[0] || contract.facility);
  const year = contractDisplayYear(contract);
  const documentType = cleanContractNamePart(contract.documentType || "");
  const suffix = /\b(amendment|addendum|renewal)\b/i.test(documentType) ? documentType : "";
  return [vendor, service, facility, year, suffix]
    .filter(Boolean)
    .filter((part, index, parts) => parts.findIndex(item => canonicalNameKey(item) === canonicalNameKey(part)) === index)
    .join(" - ")
    .slice(0, 180);
}

function updateContractDisplayName(contract = {}) {
  const generatedName = generatedContractDisplayName(contract);
  if (!generatedName) return contract;
  if (!contract.sourceDocumentName) {
    contract.sourceDocumentName = contract.uploadedFileName || contract.documentTitle || contract.name || "";
  }
  if (!contract.legalDocumentTitle && contract.documentTitle && canonicalNameKey(contract.documentTitle) !== canonicalNameKey(generatedName)) {
    contract.legalDocumentTitle = contract.documentTitle;
  }
  contract.name = generatedName;
  contract.displayNameGenerated = true;
  contract.displayNameUpdatedAt = new Date().toISOString();
  return contract;
}

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function intakeDisplayName(body = {}) {
  const fromName = cleanContractDisplayName(body.name);
  if (fromName && !/^(new\s+)?contract\s+intake$/i.test(fromName) && !/^sharesync\s+intake\s+contract$/i.test(fromName)) {
    return fromName;
  }
  const fromUploaded = cleanContractDisplayName(body.uploadedFileName);
  if (fromUploaded) return fromUploaded;
  const localPath = String(body.localFilePath || body.shareSyncLocalPath || "").trim().replace(/^["']|["']$/g, "");
  const fromPath = cleanContractDisplayName(localPath ? path.basename(localPath) : "");
  if (fromPath) return fromPath;
  let fromUrl = "";
  try {
    fromUrl = cleanContractDisplayName(body.shareSyncUrl ? path.basename(new URL(body.shareSyncUrl).pathname || "") : "");
  } catch {
    fromUrl = cleanContractDisplayName(body.shareSyncUrl || "");
  }
  return fromUrl || "Needs Contract Name";
}

function vendorHintFromFileName(value = "") {
  let raw = String(value || "").trim().replace(/^["']|["']$/g, "");
  if (/[\\/]/.test(raw)) raw = path.basename(raw);
  let clean = cleanContractDisplayName(raw)
    .replace(/\b(agreement|contract|service|services|master|signed|final|executed|amendment|addendum|proposal|lease|schedule)\b/gi, " ")
    .replace(/\b(20\d{2}|\d{1,2}[.-]\d{1,2}[.-]\d{2,4})\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const knownFacilities = [
    ...((getAdminSettings().facilityProfiles || []).map(item => item.name || item.dba || item.legalName)),
    "Amsterdam", "Bannister", "Beth Abraham", "Bishop", "Boro Park", "Bronx", "Brooklyn", "Buffalo", "Bushwick", "Carthage",
    "Cooperstown", "Corning", "Ellicott", "Essex", "Far Rockaway", "Fulton", "Glens Falls", "Hammonton", "Kingston",
    "Schenectady", "Triboro", "Washington", "Williamsbridge"
  ].filter(Boolean);
  for (const facility of knownFacilities) {
    clean = clean.replace(new RegExp(`\\b${escapeRegExp(facility)}\\b`, "ig"), " ");
  }
  clean = clean.replace(/\s+/g, " ").trim();
  if (!clean || clean.length < 3 || /^(center|rehab|nursing|healthcare)$/i.test(clean)) return "";
  return clean.slice(0, 90);
}

function shouldReplaceIntakeName(currentName = "", nextName = "") {
  const current = cleanContractDisplayName(currentName);
  const next = cleanContractDisplayName(nextName);
  if (isBadContractTitle(next)) return false;
  if (/^(new\s+)?contract\s+intake$|^sharesync\s+intake\s+contract$|^needs\s+contract\s+name$/i.test(current)) return true;
  if (/\.(pdf|docx?)$/i.test(String(currentName || ""))) return true;
  return current.length < 8 && next.length > current.length;
}

async function createIntake(body) {
  const now = new Date().toISOString();
  const intakeId = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const intakeFacilities = splitFacilityNames(body.facility).map(canonicalFacilityForFiling);
  const intakeFacility = intakeFacilities.length
    ? intakeFacilities.join("; ")
    : body.facility || "Needs Classification";
  const documentType = body.documentType || (isRelatedContractDocument(body.name || body.uploadedFileName || body.shareSyncUrl, "") ? relatedDocumentType(body.name || body.uploadedFileName || body.shareSyncUrl, "") : "Contract");
  const duplicateMatches = duplicateContractMatches({
    fileHash: body.fileHash,
    uploadedFileName: body.uploadedFileName,
    shareSyncUrl: body.shareSyncUrl,
    shareSyncLocalPath: body.shareSyncLocalPath,
    localFilePath: body.localFilePath,
    facility: intakeFacility,
    vendor: body.vendor,
    category: body.category,
    name: body.name
  });
  if (duplicateMatches.length && !body.forceDuplicate) {
    const existing = duplicateMatches[0];
    logAudit("duplicate_upload_skipped", "contract", existing.id, {
      uploadedFileName: body.uploadedFileName || "",
      shareSyncUrl: body.shareSyncUrl || "",
      matches: duplicateMatches.map(item => ({ id: item.id, name: item.name }))
    });
    return {
      duplicate: true,
      skipped: true,
      message: "Possible duplicate contract found. Existing contract was not duplicated.",
      existingContract: existing,
      duplicateMatches
    };
  }
  const displayName = intakeDisplayName(body);
  const fileVendorHint = vendorHintFromFileName(body.uploadedFileName || body.localFilePath || body.shareSyncLocalPath || body.name || "");
  const contract = {
    id: body.id || `CTR-${intakeId}`,
    name: displayName,
    shareSyncUrl: body.shareSyncUrl || "",
    shareSyncLocalPath: body.shareSyncLocalPath || "",
    shareSyncFolderPath: body.shareSyncFolderPath || "",
    shareSyncCopies: Array.isArray(body.shareSyncCopies) ? body.shareSyncCopies : [],
    localFilePath: body.localFilePath || "",
    uploadedFileName: body.uploadedFileName || "",
    fileHash: body.fileHash || "",
    duplicateWarning: duplicateMatches.length ? {
      message: "Possible duplicate found. Review before approving this record.",
      matches: duplicateMatches.map(item => ({ id: item.id, name: item.name, facility: item.facility, vendor: item.vendor, category: item.category }))
    } : null,
    facility: intakeFacility,
    vendor: body.vendor || "Needs Classification",
    vendorHintFromFileName: fileVendorHint,
    category: body.category || "Needs Classification",
    owner: body.owner || "Contract Dept",
    documentType,
    status: "Needs Review",
    reviewStatus: documentType === "Contract" ? "Pending OCR" : `${documentType} - Pending OCR`,
    createdAt: now
  };
  const job = {
    id: `OCR-${intakeId}`,
    contractId: contract.id,
    name: contract.name,
    fileName: contract.uploadedFileName || (contract.localFilePath ? path.basename(contract.localFilePath).replace(/^UP-\d+-/, "") : ""),
    uploadedFileName: contract.uploadedFileName || "",
    source: body.localFilePath ? "Uploaded File" : body.shareSyncUrl ? "ShareSync" : "Manual",
    shareSyncUrl: contract.shareSyncUrl,
    localFilePath: contract.localFilePath,
    documentType: contract.documentType,
    vendorHintFromFileName: contract.vendorHintFromFileName || "",
    status: "Queued",
    createdAt: now
  };
  saveContract(contract);
  saveContractVersion(contract, { action: "contract_intake_created", actor: body.actor || "local-user" });
  saveOcrJob(job);
  logAudit("contract_uploaded", "contract", contract.id, { name: contract.name, file: contract.uploadedFileName || contract.localFilePath || contract.shareSyncUrl });
  return { contract, ocrJob: job };
}

async function recoverOcrLocalFilePath(job = {}, contract = null) {
  const candidates = [
    job.localFilePath,
    contract?.localFilePath,
    contract?.shareSyncLocalPath
  ].map(cleanStoredFilePath).filter(Boolean);

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }

  if (shareSyncRoot) {
    const found = await findShareSyncFileByName(shareSyncRoot, [
      job.uploadedFileName,
      job.fileName,
      contract?.uploadedFileName,
      contract?.name
    ].filter(Boolean));
    if (found) return found;
  }

  return "";
}

function securityHeaders(extraHeaders = {}) {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
    ...extraHeaders
  };
}

function clientKey(req) {
  return String(req.socket?.remoteAddress || "local").replace(/^::ffff:/, "");
}

function rateLimitFor(url) {
  const uploadPath = /^\/api\/upload-|^\/api\/ocr-jobs\/.+\/run$/.test(url.pathname);
  return {
    scope: uploadPath ? "heavy" : "normal",
    limit: uploadPath ? uploadRateLimitRequests : rateLimitRequests
  };
}

function checkRateLimit(req, url) {
  if (!url.pathname.startsWith("/api/")) return null;
  const { scope, limit } = rateLimitFor(url);
  const key = `${clientKey(req)}:${scope}`;
  const now = Date.now();
  const bucket = requestBuckets.get(key) || { count: 0, resetAt: now + rateLimitWindowMs };
  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + rateLimitWindowMs;
  }
  bucket.count += 1;
  requestBuckets.set(key, bucket);
  if (requestBuckets.size > 1000) {
    for (const [bucketKey, item] of requestBuckets.entries()) {
      if (item.resetAt <= now) requestBuckets.delete(bucketKey);
    }
  }
  if (bucket.count > limit) {
    return {
      retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      scope
    };
  }
  return null;
}

function sendJson(res, value, status = 200, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
    ...securityHeaders(extraHeaders)
  });
  res.end(JSON.stringify(value, null, 2));
}

function authConfigured() {
  return !loginRequired || Boolean(adminUser && adminPassword);
}

function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function sessionTokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function persistSession(token, session) {
  if (!token || !session) return;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO sessions (token_hash, user_name, expires_at, created_at, updated_at, data)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(token_hash) DO UPDATE SET
      user_name = excluded.user_name,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at,
      data = excluded.data
  `).run(
    sessionTokenHash(token),
    session.user || "",
    Number(session.expiresAt || 0),
    session.createdAt || now,
    now,
    JSON.stringify(session)
  );
  session.lastPersistedAt = Date.now();
}

function persistedSession(token) {
  if (!token) return null;
  const row = db.prepare("SELECT data, expires_at FROM sessions WHERE token_hash = ?").get(sessionTokenHash(token));
  if (!row || Number(row.expires_at || 0) <= Date.now()) return null;
  return rowToRecord(row);
}

function deletePersistedSession(token) {
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sessionTokenHash(token));
}

function clearExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (!session?.expiresAt || session.expiresAt <= now) {
      sessions.delete(token);
      deletePersistedSession(token);
    }
  }
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
}

function currentSession(req) {
  if (!loginRequired) {
    return {
      user: "local-main-account",
      role: "Admin",
      fullName: "Main Account",
      facility: "All",
      publicMode: true
    };
  }
  clearExpiredSessions();
  const token = parseCookies(req).contract_session;
  if (!token) return null;
  const session = sessions.get(token) || persistedSession(token);
  if (!session) return null;
  sessions.set(token, session);
  session.expiresAt = Date.now() + sessionMaxAgeSeconds * 1000;
  if (!session.lastPersistedAt || Date.now() - session.lastPersistedAt > 60000) persistSession(token, session);
  return session;
}

function cleanActivePresence() {
  const cutoff = Date.now() - presenceMaxAgeMs;
  for (const [key, record] of activePresence.entries()) {
    if (!record?.lastSeenMs || record.lastSeenMs < cutoff) activePresence.delete(key);
  }
}

function trimPresenceText(value, fallback = "", max = 180) {
  const text = String(value ?? fallback ?? "").replace(/\s+/g, " ").trim();
  return text.slice(0, max);
}

function updateActivePresence(req, body = {}) {
  const session = currentSession(req);
  const now = Date.now();
  const publicSuffix = session?.publicMode ? `:${clientKey(req)}` : "";
  const key = `${session?.user || "unknown-user"}${publicSuffix}`;
  const record = {
    key,
    user: session?.user || trimPresenceText(body.user, "Unknown user", 120),
    fullName: session?.fullName || trimPresenceText(body.fullName, session?.user || "Unknown user", 120),
    role: session?.role || "",
    facility: session?.facility || "All",
    page: trimPresenceText(body.page || body.section, "Dashboard", 80),
    section: trimPresenceText(body.section, "dashboard", 80),
    itemId: trimPresenceText(body.itemId, "", 140),
    itemName: trimPresenceText(body.itemName, "", 220),
    action: trimPresenceText(body.action, "Viewing", 140),
    lastSeenAt: new Date(now).toISOString(),
    lastSeenMs: now
  };
  activePresence.set(key, record);
  cleanActivePresence();
  return record;
}

function listActivePresence() {
  cleanActivePresence();
  return [...activePresence.values()]
    .sort((a, b) => (b.lastSeenMs || 0) - (a.lastSeenMs || 0))
    .slice(0, 80)
    .map(({ lastSeenMs, ...record }) => record);
}

function sessionIsAdmin(req) {
  if (!loginRequired) return true;
  const session = currentSession(req);
  return session?.role === "Admin";
}

function normalizedRole(session = {}) {
  return String(session?.role || "Read Only").trim().toLowerCase();
}

function sessionCan(session = {}, action = "view") {
  if (!session) return false;
  if (session.publicMode) return true;
  const role = normalizedRole(session);
  if (role === "admin") return true;
  if (role === "contract department" || role === "contract team") return ["view", "edit", "edit-field", "approve", "create", "upload", "task", "report", "builder"].includes(action);
  if (role === "facility user") return ["view", "task", "note", "report"].includes(action);
  if (role === "vendor/profile user" || role === "vendor profile user") return ["view", "vendor", "edit-vendor", "task", "report"].includes(action);
  if (role === "finance user") return ["view", "finance", "invoice", "report", "edit-finance", "task"].includes(action);
  if (role === "read only") return ["view", "report"].includes(action);
  if (role === "field reviewer") return ["view", "edit-field", "task", "report"].includes(action);
  return action === "view";
}

function sessionFacilityNames(session = {}) {
  return splitFacilityNames(session?.facility || "").map(canonicalNameKey).filter(Boolean);
}

function sessionCanAccessContract(session = {}, contract = {}) {
  if (!session) return false;
  if (sessionCan(session, "edit") || sessionCan(session, "approve") || session.publicMode) return true;
  const allowed = sessionFacilityNames(session);
  if (!allowed.length || allowed.includes("all")) return true;
  const contractFacilities = splitFacilityNames(contract.facility || "").map(canonicalNameKey);
  return contractFacilities.some(name => allowed.includes(name));
}

function routeAction(url, method) {
  const pathName = url.pathname;
  if (pathName === "/api/users" || pathName.startsWith("/api/users/") || pathName === "/api/admin-settings" || pathName === "/api/restore") return "admin";
  if (pathName === "/api/backup" || pathName === "/api/backups") return "admin";
  if (pathName === "/api/presence") return method === "GET" ? "admin" : "view";
  if (method === "GET") return "view";
  if (/\/api\/review\/[^/]+$/.test(pathName) && method === "POST") return "approve";
  if (/\/api\/review\/[^/]+\/field$/.test(pathName) && ["POST", "DELETE"].includes(method)) return "edit-field";
  if (pathName === "/api/upload-contract" || pathName === "/api/sharesync-intake" || pathName === "/api/sharesync-scan") return "upload";
  if (pathName === "/api/contracts" && method === "POST") return "create";
  if (pathName === "/api/contracts/bulk-delete" || (pathName.startsWith("/api/contracts/") && method === "DELETE")) return "admin";
  if (pathName.startsWith("/api/contracts/") && method === "PATCH") return "edit";
  if (pathName.startsWith("/api/vendor-profiles") || pathName.startsWith("/api/utility-accounts")) return ["POST", "PATCH", "DELETE"].includes(method) ? "edit-vendor" : "view";
  if (pathName.startsWith("/api/invoices")) return ["POST", "PATCH", "DELETE"].includes(method) ? "invoice" : "view";
  if (pathName.startsWith("/api/tasks")) return ["POST", "PATCH", "DELETE"].includes(method) ? "task" : "view";
  if (pathName === "/api/alerts/send") return "admin";
  if (pathName.startsWith("/api/email/")) return "admin";
  return ["POST", "PATCH", "DELETE"].includes(method) ? "edit" : "view";
}

function enforceRoutePermission(req, res, url) {
  if (!url.pathname.startsWith("/api/") || isPublicApi(url)) return false;
  if (req.headers["x-contract-internal-worker"] === internalWorkerToken) return false;
  const session = currentSession(req);
  if (!session) {
    sendJson(res, { error: "Authentication required." }, 401);
    return true;
  }
  const action = routeAction(url, req.method);
  if (action === "admin" && !sessionCan(session, "admin")) {
    sendJson(res, { error: "Admin access required." }, 403);
    return true;
  }
  if (action !== "admin" && !sessionCan(session, action)) {
    sendJson(res, { error: `${action} permission required.` }, 403);
    return true;
  }
  return false;
}

function enforceContractAccess(req, res, contract) {
  const session = currentSession(req);
  if (!sessionCanAccessContract(session, contract)) {
    sendJson(res, { error: "You do not have access to this contract." }, 403);
    return true;
  }
  return false;
}

function createSession(user) {
  clearExpiredSessions();
  const token = crypto.randomBytes(32).toString("hex");
  const session = {
    user: user.username || user,
    role: user.role || "Read Only",
    fullName: user.fullName || "",
    facility: user.facility || "All",
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + sessionMaxAgeSeconds * 1000
  };
  sessions.set(token, session);
  persistSession(token, session);
  return token;
}

function sessionCookie(token) {
  return `contract_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionMaxAgeSeconds}${secureCookies ? "; Secure" : ""}`;
}

function clearSessionCookie() {
  return `contract_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookies ? "; Secure" : ""}`;
}

function isPublicApi(url) {
  return ["/api/health", "/api/auth/status", "/api/login", "/api/logout", "/api/invite/validate", "/api/invite/accept", "/api/password-reset/request"].includes(url.pathname);
}

async function createDatabaseBackup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupsDir, `contracts-${stamp}.sqlite`);
  db.prepare("VACUUM INTO ?").run(backupPath);
  const stat = await fs.stat(backupPath);
  return {
    ok: true,
    backupPath,
    bytes: stat.size,
    createdAt: new Date().toISOString()
  };
}

async function listDatabaseBackups() {
  const entries = await fs.readdir(backupsDir).catch(() => []);
  const backups = [];
  for (const name of entries) {
    if (!name.endsWith(".sqlite")) continue;
    const backupPath = path.join(backupsDir, name);
    const stat = await fs.stat(backupPath).catch(() => null);
    if (!stat?.isFile()) continue;
    backups.push({
      id: name,
      name,
      backupPath,
      bytes: stat.size,
      createdAt: stat.birthtime?.toISOString?.() || stat.mtime.toISOString(),
      updatedAt: stat.mtime.toISOString()
    });
  }
  return backups.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function restoreDatabaseBackup(id) {
  const name = path.basename(String(id || ""));
  const backupPath = path.join(backupsDir, name);
  const resolved = path.resolve(backupPath);
  if (!isPathInside(backupsDir, resolved) || !name.endsWith(".sqlite")) {
    throw new Error("Invalid backup file.");
  }
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isFile()) throw new Error("Backup not found.");
  const safetyBackup = await createDatabaseBackup();
  db.close();
  await fs.rm(`${dbPath}-wal`, { force: true }).catch(() => {});
  await fs.rm(`${dbPath}-shm`, { force: true }).catch(() => {});
  await fs.copyFile(resolved, dbPath);
  return {
    ok: true,
    restoredFrom: name,
    safetyBackup: safetyBackup.backupPath,
    restartRequired: true
  };
}

function weatherCodeLabel(code) {
  const labels = {
    0: "Clear",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Rain showers",
    81: "Rain showers",
    82: "Heavy rain showers",
    85: "Snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Thunderstorm with heavy hail"
  };
  return labels[Number(code)] || `Weather code ${code}`;
}

async function fetchHistoricalWeather({ latitude, longitude, date, startDate, endDate, facility = "", invoice = "", category = "" }) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Latitude and longitude are required for real weather data.");
  }
  const from = String(startDate || date || "");
  const to = String(endDate || startDate || date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error("Start and end dates must be YYYY-MM-DD.");
  }
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    start_date: from,
    end_date: to,
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,rain_sum,snowfall_sum,precipitation_hours,wind_speed_10m_max",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "auto"
  });
  const apiUrl = `https://archive-api.open-meteo.com/v1/archive?${params.toString()}`;
  const response = await fetch(apiUrl, { headers: { "accept": "application/json" } });
  if (!response.ok) throw new Error(`Weather API returned ${response.status}`);
  const payload = await response.json();
  const daily = payload.daily || {};
  const times = Array.isArray(daily.time) ? daily.time : [from];
  const value = (key, index = 0) => Array.isArray(daily[key]) ? daily[key][index] : null;
  const dailyRows = times.map((day, index) => {
    const snowfall = Number(value("snowfall_sum", index) || 0);
    const precipitation = Number(value("precipitation_sum", index) || 0);
    const rain = Number(value("rain_sum", index) || 0);
    const code = value("weather_code", index);
    return {
      date: day,
      weather: weatherCodeLabel(code),
      weatherCode: code,
      snowfall: `${snowfall.toFixed(2)} in`,
      snowfallInches: snowfall,
      precipitation: `${precipitation.toFixed(2)} in`,
      precipitationInches: precipitation,
      rain: `${rain.toFixed(2)} in`,
      temperatureHigh: value("temperature_2m_max", index),
      temperatureLow: value("temperature_2m_min", index),
      precipitationHours: value("precipitation_hours", index),
      windMaxMph: value("wind_speed_10m_max", index)
    };
  });
  const totalSnowfall = dailyRows.reduce((sum, row) => sum + Number(row.snowfallInches || 0), 0);
  const totalPrecipitation = dailyRows.reduce((sum, row) => sum + Number(row.precipitationInches || 0), 0);
  const totalRain = dailyRows.reduce((sum, row) => sum + Number(row.rain ? parseFloat(row.rain) : 0), 0);
  const maxSnowDay = dailyRows.reduce((best, row) => Number(row.snowfallInches || 0) > Number(best?.snowfallInches || 0) ? row : best, dailyRows[0] || null);
  const result = {
    id: `WX-${Date.now()}`,
    date: from === to ? from : `${from} to ${to}`,
    startDate: from,
    endDate: to,
    facility,
    category,
    invoice,
    latitude: lat,
    longitude: lon,
    weather: maxSnowDay?.weather || "Checked",
    weatherCode: maxSnowDay?.weatherCode,
    snowfall: `${totalSnowfall.toFixed(2)} in`,
    snowfallInches: totalSnowfall,
    precipitation: `${totalPrecipitation.toFixed(2)} in`,
    precipitationInches: totalPrecipitation,
    rain: `${totalRain.toFixed(2)} in`,
    temperatureHigh: maxSnowDay?.temperatureHigh,
    temperatureLow: maxSnowDay?.temperatureLow,
    precipitationHours: dailyRows.reduce((sum, row) => sum + Number(row.precipitationHours || 0), 0),
    windMaxMph: Math.max(...dailyRows.map(row => Number(row.windMaxMph || 0))),
    dailyRows,
    rule: "Open-Meteo historical weather lookup",
    status: totalSnowfall > 0 ? "Snow found" : totalPrecipitation > 0 ? "Precipitation found" : "No precipitation found",
    source: "Open-Meteo Historical Weather API",
    sourceUrl: apiUrl,
    createdAt: new Date().toISOString()
  };
  logAudit("weather_checked", "weather", result.id, result);
  return result;
}

function isPathInside(parentPath, childPath) {
  if (!parentPath || !childPath) return false;
  if (path.resolve(parentPath).toLowerCase() === path.resolve(childPath).toLowerCase()) return true;
  const relative = path.relative(parentPath, childPath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function attachmentName(contract, filePath = "") {
  const ext = path.extname(filePath || "").toLowerCase();
  const baseName = contract.uploadedFileName
    || (filePath ? path.basename(filePath) : "")
    || `${contract.name || "contract"}${ext || ".pdf"}`;
  return path.basename(baseName).replace(/[\r\n"]/g, "_");
}

function fileContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if ([".png"].includes(ext)) return "image/png";
  if ([".jpg", ".jpeg"].includes(ext)) return "image/jpeg";
  if ([".tif", ".tiff"].includes(ext)) return "image/tiff";
  if ([".txt", ".text", ".md"].includes(ext)) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function cleanStoredFilePath(value) {
  return String(value || "").trim().replace(/^["']|["']$/g, "");
}

async function findShareSyncFileByName(root, names = []) {
  if (!root) return "";
  const wanted = new Set(
    names
      .map(name => path.basename(cleanStoredFilePath(name || "")).toLowerCase())
      .filter(name => name && name !== "." && name !== "contract.pdf")
  );
  if (!wanted.size) return "";
  const queue = [root];
  let scanned = 0;
  const maxScan = 15000;
  while (queue.length && scanned < maxScan) {
    const dir = queue.shift();
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      scanned += 1;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (wanted.has(entry.name.toLowerCase())) {
        return fullPath;
      }
      if (scanned >= maxScan) break;
    }
  }
  return "";
}

async function buildShareSyncFileIndex(root) {
  const index = new Map();
  if (!root) return index;
  const queue = [root];
  let scanned = 0;
  const maxScan = 50000;
  while (queue.length && scanned < maxScan) {
    const dir = queue.shift();
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      scanned += 1;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else {
        const key = entry.name.toLowerCase();
        if (!index.has(key)) index.set(key, fullPath);
      }
      if (scanned >= maxScan) break;
    }
  }
  return index;
}

function findIndexedShareSyncFile(index, names = []) {
  for (const name of names) {
    const key = path.basename(cleanStoredFilePath(name || "")).toLowerCase();
    if (key && index.has(key)) return index.get(key);
  }
  return "";
}

async function fileExists(filePath) {
  if (!filePath) return false;
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function repairContractPdfLinks() {
  const shareSyncRoot = configuredShareSyncRoot();
  const contracts = listContracts({ page: 1, pageSize: 100000, full: true }).records;
  const shareSyncIndex = await buildShareSyncFileIndex(shareSyncRoot);
  const results = [];
  let linked = 0;
  let alreadyLinked = 0;
  let missing = 0;
  for (const contract of contracts) {
    const candidates = [
      cleanStoredFilePath(contract.localFilePath),
      cleanStoredFilePath(contract.shareSyncLocalPath)
    ].filter(Boolean);
    let validExisting = "";
    for (const candidate of candidates) {
      const resolved = path.resolve(candidate);
      if ((isPathInside(uploadsDir, resolved) || (shareSyncRoot && isPathInside(shareSyncRoot, resolved))) && await fileExists(resolved)) {
        validExisting = resolved;
        break;
      }
    }
    if (validExisting) {
      alreadyLinked += 1;
      results.push({ id: contract.id, name: contract.name, status: "linked", path: validExisting });
      continue;
    }
    const searchNames = [
      contract.uploadedFileName,
      contract.originalFilename,
      contract.name,
      contract.documentTitle,
      ...candidates
    ];
    const found = findIndexedShareSyncFile(shareSyncIndex, searchNames) || (shareSyncRoot ? await findShareSyncFileByName(shareSyncRoot, searchNames) : "");
    if (found) {
      contract.shareSyncLocalPath = found;
      contract.shareSyncFolderPath = path.dirname(found);
      if (!contract.localFilePath || !await fileExists(cleanStoredFilePath(contract.localFilePath))) {
        contract.localFilePath = found;
      }
      contract.pdfLinkRepairedAt = new Date().toISOString();
      contract.updatedAt = new Date().toISOString();
      saveContract(contract);
      linked += 1;
      results.push({ id: contract.id, name: contract.name, status: "repaired", path: found });
    } else {
      missing += 1;
      results.push({ id: contract.id, name: contract.name, status: "missing", searched: [contract.uploadedFileName, contract.name].filter(Boolean) });
    }
  }
  logAudit("pdf_links_repaired", "contracts", "all", { total: contracts.length, linked, alreadyLinked, missing, shareSyncRoot });
  return { total: contracts.length, linked, alreadyLinked, missing, shareSyncRoot, results };
}

function contractNeedsShareSyncRefile(contract = {}) {
  const fields = contract.approvedFields || contract.extractedFields || [];
  const facility = contract.facility || fieldValue(fields, "Facility");
  const category = contract.category || contract.services || fieldValue(fields, "Category") || fieldValue(fields, "Contract Type");
  const vendor = contract.vendor || fieldValue(fields, "Vendor") || fieldValue(fields, "Vendor Name");
  if (!hasUsefulContractValue(facility) || !hasUsefulContractValue(category) || !hasUsefulContractValue(vendor)) return false;
  const currentPath = [contract.shareSyncLocalPath, contract.shareSyncFolderPath].filter(Boolean).join(" ");
  return /needs\s+classification/i.test(currentPath);
}

async function refileShareSyncCleanup() {
  const shareSyncRoot = configuredShareSyncRoot();
  const contracts = listContracts({ page: 1, pageSize: 100000, full: true }).records;
  const candidates = contracts.filter(contractNeedsShareSyncRefile);
  const results = [];
  let refiled = 0;
  let skipped = 0;
  let failed = 0;
  for (const contract of candidates) {
    try {
      const before = {
        shareSyncLocalPath: contract.shareSyncLocalPath || "",
        shareSyncFolderPath: contract.shareSyncFolderPath || ""
      };
      const refile = await refileContractInShareSync(contract);
      if (refile?.shareSyncLocalPath || refile?.shareSyncFolderPath) {
        contract.updatedAt = new Date().toISOString();
        saveContract(contract);
        saveContractVersion(contract, {
          action: "sharesync_refiled",
          actor: "system",
          previous: before,
          note: "Copied source file into corrected ShareSync facility/category/vendor folder. Original ShareSync file was preserved."
        });
        refiled += 1;
        results.push({ id: contract.id, name: contract.name, status: "refiled", from: before.shareSyncLocalPath || before.shareSyncFolderPath, to: contract.shareSyncLocalPath || contract.shareSyncFolderPath });
      } else {
        skipped += 1;
        results.push({ id: contract.id, name: contract.name, status: "skipped", reason: "No source file available to copy." });
      }
    } catch (error) {
      failed += 1;
      contract.shareSyncMoveError = error.message || "ShareSync refile failed.";
      contract.updatedAt = new Date().toISOString();
      saveContract(contract);
      results.push({ id: contract.id, name: contract.name, status: "failed", error: contract.shareSyncMoveError });
    }
  }
  logAudit("sharesync_refile_cleanup", "contracts", "all", { total: contracts.length, candidates: candidates.length, refiled, skipped, failed, shareSyncRoot });
  return { total: contracts.length, candidates: candidates.length, refiled, skipped, failed, shareSyncRoot, results: results.slice(0, 100) };
}

async function shareSyncProofReport() {
  const shareSyncRoot = configuredShareSyncRoot();
  const allContracts = listContracts({ page: 1, pageSize: 100000, full: true }).records;
  const approvedContracts = allContracts.filter(contract =>
    String(`${contract.status || ""} ${contract.reviewStatus || ""}`).toLowerCase().includes("approved")
    || contract.approvedAt
  );
  const results = [];
  let proven = 0;
  let missing = 0;
  let outsideRoot = 0;
  for (const contract of approvedContracts) {
    const candidates = [
      cleanStoredFilePath(contract.shareSyncLocalPath),
      cleanStoredFilePath(contract.localFilePath)
    ].filter(Boolean);
    const filePath = candidates.find(candidate => shareSyncRoot && isPathInside(shareSyncRoot, candidate)) || candidates[0] || "";
    const exists = await fileExists(filePath);
    const insideShareSync = Boolean(filePath && shareSyncRoot && isPathInside(shareSyncRoot, filePath));
    if (exists && insideShareSync) proven += 1;
    else if (filePath && !insideShareSync) outsideRoot += 1;
    else missing += 1;
    results.push({
      id: contract.id,
      name: contract.name,
      facility: contract.facility,
      vendor: contract.vendor,
      status: exists && insideShareSync ? "proven" : filePath && !insideShareSync ? "outside-sharesync" : "missing",
      shareSyncLocalPath: contract.shareSyncLocalPath || "",
      shareSyncFolderPath: contract.shareSyncFolderPath || "",
      filePath,
      exists,
      insideShareSync
    });
  }
  return {
    shareSyncRoot,
    totalApproved: approvedContracts.length,
    proven,
    missing,
    outsideRoot,
    ready: approvedContracts.length > 0 && proven === approvedContracts.length,
    results: results.slice(0, 100)
  };
}

async function sendContractFile(res, contract) {
  const shareSyncRoot = configuredShareSyncRoot();
  const candidates = [
    cleanStoredFilePath(contract?.localFilePath),
    cleanStoredFilePath(contract?.shareSyncLocalPath)
  ].filter(Boolean);
  if (!candidates.length) return sendJson(res, { error: "No uploaded or ShareSync contract file is saved for this record." }, 404);
  let filePath = candidates
    .map(candidate => path.resolve(candidate))
    .find(candidate => isPathInside(uploadsDir, candidate) || (shareSyncRoot && isPathInside(shareSyncRoot, candidate)));
  if (!filePath && shareSyncRoot) {
    filePath = await findShareSyncFileByName(shareSyncRoot, [
      contract?.uploadedFileName,
      contract?.originalFilename,
      contract?.name,
      ...candidates
    ]);
  }
  if (!filePath) {
    return sendJson(res, { error: "Could not find this contract file inside uploads or the configured ShareSync folder. Check the saved file name or ShareSync folder path." }, 404);
  }
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "content-type": fileContentType(filePath),
      "content-disposition": `inline; filename="${attachmentName(contract, filePath)}"`,
      "content-length": data.length
    });
    res.end(data);
  } catch {
    return sendJson(res, { error: "Saved file was not found on disk." }, 404);
  }
}

let systemReadinessCache = null;
let systemReadinessCacheAt = 0;
let systemReadinessPromise = null;
async function systemReadiness({ fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && systemReadinessCache && now - systemReadinessCacheAt < 60000) return systemReadinessCache;
  if (!fresh && systemReadinessPromise) return systemReadinessPromise;
  systemReadinessPromise = calculateSystemReadiness();
  try {
    systemReadinessCache = await systemReadinessPromise;
    systemReadinessCacheAt = Date.now();
    return systemReadinessCache;
  } finally {
    systemReadinessPromise = null;
  }
}

async function calculateSystemReadiness() {
  const [tesseractPath, pdftoppmPath, pdfinfoPath, pdftotextPath, pythonPath] = await Promise.all([
    findExistingPath(tesseractCandidates),
    findExistingPath(pdftoppmCandidates),
    findExistingPath(pdfinfoCandidates),
    findExistingPath(pdftotextCandidates),
    findExistingPath(pythonCandidates)
  ]);
  let pythonPdfRenderer = false;
  if (pythonPath) {
    try {
      await execTool(pythonPath, ["-c", "import pypdfium2"], { maxBuffer: 1024 * 1024 });
      pythonPdfRenderer = true;
    } catch {
      pythonPdfRenderer = false;
    }
  }
  const localAi = await ollamaStatus();
  const backups = await listDatabaseBackups();
  const latestBackup = backups[0] || null;
  const latestBackupAgeMs = latestBackup?.updatedAt ? Date.now() - new Date(latestBackup.updatedAt).getTime() : Number.POSITIVE_INFINITY;
  const recentBackup = Boolean(latestBackup && Number.isFinite(latestBackupAgeMs) && latestBackupAgeMs <= 7 * 24 * 60 * 60 * 1000);
  const productionAuthReady = Boolean(loginRequired && adminUser && adminPassword);
  const checks = [
    { key: "server", label: "Backend server", ok: true, detail: "Server is responding." },
    { key: "auth", label: "Access mode", ok: productionAuthReady, detail: loginRequired ? authConfigured() ? `Sign-in required as ${adminUser}` : "Set ADMIN_USER and ADMIN_PASSWORD before requiring sign-in." : "Testing mode only. Set REQUIRE_LOGIN=true before daily production use." },
    { key: "database", label: "SQLite database", ok: true, detail: dbPath },
    { key: "uploads", label: "Upload folder", ok: true, detail: uploadsDir },
    { key: "tesseract", label: "Tesseract OCR", ok: Boolean(tesseractPath), detail: tesseractPath || "Missing. Install Tesseract on the server or set TESSERACT_PATH." },
    { key: "pdf-renderer", label: "PDF renderer", ok: Boolean(pythonPdfRenderer || pdftoppmPath), detail: pythonPdfRenderer ? `pypdfium2 through ${pythonPath}` : pdftoppmPath || "Missing. Install pypdfium2 or Poppler." },
    { key: "pdf-text", label: "PDF text extraction", ok: Boolean(pdftotextPath), detail: pdftotextPath || "Optional but recommended. Install Poppler for better readable-PDF extraction." },
    { key: "ai", label: "AI extraction", ok: true, detail: !aiExtractionEnabled ? "Off for now. OCR and rule extraction are active." : process.env.OPENAI_API_KEY ? `OpenAI ${openAiModel}` : localAi.available && localAi.hasModel ? `Ollama ${ollamaModel}` : "Rules-only. Add OpenAI key or install Ollama model for AI." },
    { key: "rbac", label: "Role-based access", ok: true, detail: loginRequired ? "Backend permissions are enforced by role." : "RBAC is built, but sign-in is currently off for testing." },
    { key: "alerts-send", label: "Email/webhook alerts", ok: Boolean(alertWebhookUrl || (smtpHost && (alertEmailTo || getAdminSettings().contractDepartmentEmail))), detail: alertWebhookUrl ? "Webhook configured." : smtpHost ? "SMTP configured." : "Set ALERT_WEBHOOK_URL or SMTP_HOST plus ALERT_EMAIL_TO to send alerts." },
    { key: "full-text-search", label: "Full-text OCR search", ok: true, detail: "SQLite FTS5 index is enabled for OCR and contract text. OpenSearch/Elasticsearch can be added later for cloud scale." },
    { key: "version-history", label: "Version history", ok: true, detail: "Contract version snapshots are stored for created, edited, approved, and archived records." },
    { key: "backup", label: "Recent database backup", ok: recentBackup, detail: latestBackup ? `${latestBackup.name} (${latestBackup.updatedAt})` : "No database backup found. Create one before production use." }
  ];
  const required = checks.filter(check => ["server", "auth", "database", "uploads", "tesseract", "pdf-renderer", "backup"].includes(check.key));
  const productionReady = required.every(check => check.ok);
  return {
    ok: productionReady,
    productionReady,
    mode: productionReady ? "ready-for-live-ocr" : "not-ready",
    checks,
    summary: productionReady ? "Core OCR server pieces and production safeguards are ready." : "The internal pilot works, but one or more production safeguards still need attention.",
    paths: { tesseractPath, pdftoppmPath, pdfinfoPath, pdftotextPath, pythonPath, dbPath, uploadsDir, backupsDir },
    maxPdfPages
  };
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(decodeURIComponent(requestPath)).replace(/^([/\\])+/, "");
  const filePath = path.resolve(__dirname, safePath);
  if (!isPathInside(__dirname, filePath)) {
    res.writeHead(403, securityHeaders({ "content-type": "text/plain; charset=utf-8" }));
    res.end("Forbidden");
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    const contentType = filePath.endsWith(".html")
      ? "text/html; charset=utf-8"
      : filePath.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : filePath.endsWith(".css")
          ? "text/css; charset=utf-8"
          : "application/octet-stream";
    const cacheControl = /\.(?:html|js|css)$/i.test(filePath) ? "no-store" : "public, max-age=60";
    res.writeHead(200, securityHeaders({ "content-type": contentType, "cache-control": cacheControl }));
    res.end(data);
  } catch {
    res.writeHead(404, securityHeaders({ "content-type": "text/plain; charset=utf-8" }));
    res.end("Not found");
  }
}

function searchContracts(contracts, query) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return contracts;
  return contracts.filter(contract => JSON.stringify(contract).toLowerCase().includes(q));
}

initDatabase();
initializeCompactContractIndex();
seedAdminUser();
await migrateJsonToSqlite();
rebuildContractSearchIndex();

const server = http.createServer(async (req, res) => {
  const requestStartedAt = performance.now();
  res.once("finish", () => {
    const duration = Math.round(performance.now() - requestStartedAt);
    serverMetrics.requests += 1;
    serverMetrics.totalDurationMs += duration;
    serverMetrics.maxDurationMs = Math.max(serverMetrics.maxDurationMs, duration);
    if (duration >= 2000) serverMetrics.slowRequests += 1;
    if (res.statusCode >= 500) serverMetrics.errors += 1;
  });
  try {
    if (req.method === "OPTIONS") return sendJson(res, { ok: true });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const rateLimit = checkRateLimit(req, url);
    if (rateLimit) {
      return sendJson(res, {
        error: rateLimit.scope === "heavy"
          ? "Too many upload/OCR requests at once. Wait a moment, then try again."
          : "Too many requests. Wait a moment, then try again.",
        retryAfterSeconds: rateLimit.retryAfter
      }, 429, { "retry-after": String(rateLimit.retryAfter) });
    }

    if (url.pathname === "/api/health") {
      const readiness = await systemReadiness();
      return sendJson(res, {
        ok: true,
        mode: "live-server",
        auth: loginRequired ? authConfigured() ? "required-configured" : "required-setup-needed" : "open-internal-mode",
        storage: "sqlite",
        ocr: readiness.paths.tesseractPath ? "tesseract-installed" : "tesseract-not-found",
        pdfOcr: readiness.checks.find(check => check.key === "pdf-renderer")?.ok ? "pdf-renderer-installed" : "pdf-renderer-not-found",
        email: smtpHost ? "smtp-configured" : "smtp-not-configured",
        maxPdfPages,
        limits: {
          maxUploadMb: Math.round(maxUploadBytes / 1024 / 1024),
          maxJsonMb: Math.round(maxJsonBytes / 1024 / 1024),
          rateLimitRequests,
          uploadRateLimitRequests,
          activeOcrJobs: activeOcrJobs.size,
          queuedOcrJobs: queuedOcrJobs.length,
          ocrWorkerConcurrency
        }
      });
    }

    if (url.pathname === "/api/auth/status" && req.method === "GET") {
      const session = currentSession(req);
      return sendJson(res, {
        authenticated: Boolean(session),
        user: session?.user || "",
        fullName: session?.fullName || "",
        role: session?.role || "",
        facility: session?.facility || "",
        loginRequired,
        setupRequired: !authConfigured(),
        sessionMaxAgeSeconds
      });
    }

    if (url.pathname === "/api/login" && req.method === "POST") {
      if (!authConfigured()) {
        return sendJson(res, {
          error: "Live login is not configured. Set ADMIN_USER and ADMIN_PASSWORD in the server environment or .env file, then restart the server."
        }, 503);
      }
      const body = await readBody(req);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      let user = getUserByUsername(username);
      if (!user && username === adminUser && password === adminPassword) {
        seedAdminUser();
        user = getUserByUsername(username);
      }
      if (!user || user.status !== "Active" || !verifyPassword(password, user)) {
        logAudit("login_failed", "auth", username || "unknown", { username });
        return sendJson(res, { error: "Invalid username or password." }, 401);
      }
      const token = createSession(user);
      logAudit("user_login", "auth", username, { username, role: user.role });
      return sendJson(res, { authenticated: true, ...sanitizeUser(user) }, 200, {
        "set-cookie": sessionCookie(token)
      });
    }

    if (url.pathname === "/api/logout" && req.method === "POST") {
      const session = currentSession(req);
      const token = parseCookies(req).contract_session;
      if (token) {
        sessions.delete(token);
        deletePersistedSession(token);
      }
      if (session) logAudit("user_logout", "auth", session.user, { username: session.user });
      return sendJson(res, { authenticated: false }, 200, {
        "set-cookie": clearSessionCookie()
      });
    }

    if (url.pathname === "/api/invite/validate" && req.method === "POST") {
      const body = await readBody(req);
      const user = validateUserInvite(body.token);
      return sendJson(res, {
        ok: true,
        username: user.username,
        fullName: user.fullName || "",
        role: user.role || "Read Only",
        facility: user.facility || "All",
        expiresAt: user.inviteExpiresAt || ""
      });
    }

    if (url.pathname === "/api/invite/accept" && req.method === "POST") {
      const body = await readBody(req);
      const user = acceptUserInvite(body.token, body.password);
      const token = createSession(user);
      return sendJson(res, { authenticated: true, ...user }, 200, {
        "set-cookie": sessionCookie(token)
      });
    }

    if (url.pathname === "/api/password-reset/request" && req.method === "POST") {
      const body = await readBody(req);
      return sendJson(res, await requestPasswordReset(body.username, req));
    }

    if (enforceRoutePermission(req, res, url)) return;

    if (url.pathname === "/api/metrics" && req.method === "GET") {
      if (!sessionIsAdmin(req)) return sendJson(res, { error: "Admin access required." }, 403);
      const counts = Object.fromEntries([
        "contracts", "ocr_jobs", "vendor_profiles", "invoices", "users", "sessions", "tasks", "audit_logs"
      ].map(table => [table, Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count || 0)]));
      const dbStats = await fs.stat(dbPath).catch(() => ({ size: 0 }));
      const walStats = await fs.stat(`${dbPath}-wal`).catch(() => ({ size: 0 }));
      return sendJson(res, {
        generatedAt: new Date().toISOString(),
        uptimeSeconds: Math.round((Date.now() - serverStartedAt) / 1000),
        requests: serverMetrics.requests,
        errors: serverMetrics.errors,
        slowRequests: serverMetrics.slowRequests,
        averageDurationMs: serverMetrics.requests ? Math.round(serverMetrics.totalDurationMs / serverMetrics.requests) : 0,
        maxDurationMs: serverMetrics.maxDurationMs,
        activeOcrJobs: activeOcrJobs.size,
        queuedOcrJobs: queuedOcrJobs.length,
        ocrWorkerConcurrency,
        databaseBytes: Number(dbStats.size || 0),
        walBytes: Number(walStats.size || 0),
        counts
      });
    }

    if (url.pathname === "/api/users" && req.method === "GET") {
      if (!sessionIsAdmin(req)) return sendJson(res, { error: "Admin access required." }, 403);
      return sendJson(res, listUsers());
    }

    if (url.pathname === "/api/users" && req.method === "POST") {
      if (!sessionIsAdmin(req)) return sendJson(res, { error: "Admin access required." }, 403);
      const session = currentSession(req);
      const body = await readBody(req);
      return sendJson(res, upsertUser(body, session?.user || "admin"), 201);
    }

    const inviteMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/invite$/);
    if (inviteMatch && req.method === "POST") {
      if (!sessionIsAdmin(req)) return sendJson(res, { error: "Admin access required." }, 403);
      const session = currentSession(req);
      const username = decodeURIComponent(inviteMatch[1] || "");
      return sendJson(res, await createUserInvite(username, session?.user || "admin", req), 201);
    }

    if (url.pathname.startsWith("/api/users/") && req.method === "DELETE") {
      if (!sessionIsAdmin(req)) return sendJson(res, { error: "Admin access required." }, 403);
      const session = currentSession(req);
      const username = decodeURIComponent(url.pathname.split("/").pop() || "");
      if (username === session?.user) return sendJson(res, { error: "You cannot delete the account you are signed in with." }, 400);
      const deleted = deleteUser(username, session?.user || "admin");
      if (!deleted) return sendJson(res, { error: "User not found." }, 404);
      return sendJson(res, { deleted: true, user: deleted });
    }

    if (url.pathname === "/api/readiness" && req.method === "GET") {
      return sendJson(res, await systemReadiness());
    }

    if (url.pathname === "/api/ai-status" && req.method === "GET") {
      const localAi = await ollamaStatus();
      return sendJson(res, {
        enabled: aiExtractionEnabled && (Boolean(process.env.OPENAI_API_KEY) || (localAi.available && localAi.hasModel)),
        provider: process.env.OPENAI_API_KEY ? "openai" : "ollama",
        model: process.env.OPENAI_API_KEY ? openAiModel : ollamaModel,
        mode: !aiExtractionEnabled ? "rules-only-ai-off" : process.env.OPENAI_API_KEY ? "ai-extraction-ready" : localAi.available && localAi.hasModel ? "local-ai-ready" : "rules-only",
        autoSave: aiAgentAutoSave,
        reviewMode: aiAgentAutoSave ? "ai-can-auto-save-high-confidence" : "human-approval-required",
        localAi
      });
    }

    if (url.pathname === "/api/sharesync-health" && req.method === "GET") {
      const root = configuredShareSyncRoot();
      const health = {
        configured: Boolean(root),
        root,
        exists: false,
        readable: false,
        writable: false,
        topLevelFolders: [],
        error: ""
      };
      if (!root) return sendJson(res, health);
      try {
        const stat = await fs.stat(root);
        health.exists = stat.isDirectory();
        if (!health.exists) {
          health.error = "ShareSync root is not a folder.";
          return sendJson(res, health);
        }
        const entries = await fs.readdir(root, { withFileTypes: true });
        health.readable = true;
        health.topLevelFolders = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).slice(0, 100);
        await fs.access(root, fsConstants.W_OK);
        health.writable = true;
      } catch (error) {
        health.error = error.message || "ShareSync health check failed.";
      }
      return sendJson(res, health);
    }

    if (url.pathname === "/api/contracts/repair-pdf-links" && req.method === "POST") {
      return sendJson(res, await repairContractPdfLinks());
    }

    if (url.pathname === "/api/contracts/refile-sharesync" && req.method === "POST") {
      return sendJson(res, await refileShareSyncCleanup());
    }

    if (url.pathname === "/api/sharesync-proof" && req.method === "GET") {
      return sendJson(res, await shareSyncProofReport());
    }

    if (url.pathname === "/api/admin-settings" && req.method === "GET") {
      return sendJson(res, getAdminSettings());
    }

    if (url.pathname === "/api/admin-settings" && req.method === "POST") {
      const body = await readBody(req);
      return sendJson(res, saveAdminSettings(body));
    }

    if (url.pathname === "/api/email/status" && req.method === "GET") {
      return sendJson(res, smtpConfigurationStatus());
    }
    if (url.pathname === "/api/email/renewal-preview" && req.method === "POST") {
      const settings = { ...getAdminSettings(), ...await readBody(req) };
      const config = reminderSettings(settings);
      const items = reminderItems(lifecycleAlerts(allContractSummaries(), config.days), settings);
      return sendJson(res, { previews: config.recipients.map(email => { const scoped = recipientItems(items, settings, email); return {email, count:scoped.length, html:reminderHtml(scoped)}; }), configured: smtpConfigurationStatus().configured });
    }

    if (url.pathname === "/api/email/test" && req.method === "POST") {
      const body = await readBody(req);
      const to = String(body.to || "").trim();
      if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return sendJson(res, { error: "Enter a valid test email address." }, 400);
      }
      const status = smtpConfigurationStatus();
      if (!status.configured) {
        return sendJson(res, { error: `SMTP is not ready. Missing: ${status.missing.join(", ")}.`, status }, 400);
      }
      const result = await sendSmtpMail({
        to,
        subject: "Contract Operations email test",
        text: "Contract Operations successfully connected to the company email server. User invitations, password resets, and lifecycle alerts can now be sent."
      });
      logAudit("smtp_test_sent", "email", to, { to });
      return sendJson(res, { ok: true, result });
    }

    if (url.pathname === "/api/backup" && req.method === "POST") {
      return sendJson(res, await createDatabaseBackup());
    }

    if (url.pathname === "/api/backups" && req.method === "GET") {
      return sendJson(res, await listDatabaseBackups());
    }

    if (url.pathname === "/api/restore" && req.method === "POST") {
      const body = await readBody(req);
      const result = await restoreDatabaseBackup(body.id || body.name);
      sendJson(res, result);
      setTimeout(() => process.exit(0), 300);
      return;
    }

    if (url.pathname === "/api/weather-check" && req.method === "POST") {
      const body = await readBody(req);
      try {
        const result = await fetchHistoricalWeather(body);
        return sendJson(res, result);
      } catch (error) {
        return sendJson(res, { error: error.message || "Weather lookup failed." }, 400);
      }
    }

    if (url.pathname === "/api/contracts" && req.method === "GET") {
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const compact = url.searchParams.get("compact") === "1";
      const requestedPageSize = Math.max(1, Number(url.searchParams.get("pageSize") || 25));
      const pageSize = Math.min(compact ? 2000 : 100, requestedPageSize);
      const result = listContracts({
        q: url.searchParams.get("q"),
        page,
        pageSize,
        compact,
        sort: url.searchParams.get("sort") || "newest"
      });
      const session = currentSession(req);
      if (!sessionCan(session, "edit") && !sessionCan(session, "approve") && !session?.publicMode) {
        result.records = result.records.filter(contract => sessionCanAccessContract(session, contract));
        result.total = result.records.length;
      }
      return sendJson(res, result);
    }

    if (url.pathname === "/api/contracts/bulk-delete" && req.method === "POST") {
      const body = await readBody(req);
      const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(id => String(id || "").trim()).filter(Boolean))];
      if (!ids.length) return sendJson(res, { error: "No contracts selected." }, 400);
      if (ids.length > 500) return sendJson(res, { error: "Delete 500 or fewer contracts at a time." }, 400);
      const deleted = [];
      const missing = [];
      for (const id of ids) {
        const result = await deleteContract(id);
        if (result) {
          deleted.push({ id, name: result.contract.name, deletedJobs: result.deletedJobs, deletedFiles: result.deletedFiles });
          logAudit("contract_deleted", "contract", result.contract.id, { name: result.contract.name, deletedJobs: result.deletedJobs, deletedFiles: result.deletedFiles, bulk: true });
        } else {
          missing.push(id);
        }
      }
      return sendJson(res, { ok: true, requested: ids.length, deletedCount: deleted.length, missingCount: missing.length, deleted, missing });
    }

    const contractUpdateMatch = url.pathname.match(/^\/api\/contracts\/([^/]+)$/);
    if (contractUpdateMatch && req.method === "GET") {
      const contract = getContract(decodeURIComponent(contractUpdateMatch[1]));
      if (!contract) return sendJson(res, { error: "Contract not found" }, 404);
      if (enforceContractAccess(req, res, contract)) return;
      return sendJson(res, contract);
    }

    if (contractUpdateMatch && req.method === "PATCH") {
      const contract = getContract(decodeURIComponent(contractUpdateMatch[1]));
      if (!contract) return sendJson(res, { error: "Contract not found" }, 404);
      if (enforceContractAccess(req, res, contract)) return;
      const body = await readBody(req);
      const previous = { ...contract };
      const allowedStatuses = new Set(["Active", "Approved", "Needs Review", "Expiring Soon", "High Risk", "Archived"]);
      const next = {
        ...contract,
        ...body,
        status: allowedStatuses.has(body.status) ? body.status : contract.status,
        updatedAt: new Date().toISOString()
      };
      if (body.status === "Archived") next.archivedAt = next.archivedAt || new Date().toISOString();
      if (body.status && body.status !== "Archived") delete next.archivedAt;
      saveContract(next);
      saveContractVersion(next, { action: body.status === "Archived" ? "contract_archived" : "contract_updated", actor: currentSession(req)?.user || "local-user", previous });
      logAudit(body.status === "Archived" ? "contract_archived" : "contract_updated", "contract", next.id, { status: next.status, name: next.name });
      return sendJson(res, next);
    }

    const contractDeleteMatch = url.pathname.match(/^\/api\/contracts\/([^/]+)$/);
    if (contractDeleteMatch && req.method === "DELETE") {
      const result = await deleteContract(decodeURIComponent(contractDeleteMatch[1]));
      if (!result) return sendJson(res, { error: "Contract not found" }, 404);
      logAudit("contract_deleted", "contract", result.contract.id, { name: result.contract.name, deletedJobs: result.deletedJobs, deletedFiles: result.deletedFiles });
      return sendJson(res, { ok: true, ...result });
    }

    const contractFileMatch = url.pathname.match(/^\/api\/contracts\/([^/]+)\/file$/);
    if (contractFileMatch && req.method === "GET") {
      const contract = getContract(decodeURIComponent(contractFileMatch[1]));
      if (!contract) return sendJson(res, { error: "Contract not found" }, 404);
      if (enforceContractAccess(req, res, contract)) return;
      return sendContractFile(res, contract);
    }

    const contractVersionMatch = url.pathname.match(/^\/api\/contracts\/([^/]+)\/versions$/);
    if (contractVersionMatch && req.method === "GET") {
      const contract = getContract(decodeURIComponent(contractVersionMatch[1]));
      if (!contract) return sendJson(res, { error: "Contract not found" }, 404);
      if (enforceContractAccess(req, res, contract)) return;
      return sendJson(res, listContractVersions(contract.id));
    }

    if (url.pathname === "/api/dashboard" && req.method === "GET") {
      return sendJson(res, cachedSummary("dashboard", 30000, () => dashboardSummary(), url.searchParams.get("fresh") === "1"));
    }

    if (url.pathname === "/api/finance-summary" && req.method === "GET") {
      return sendJson(res, cachedSummary("finance", 30000, () => financeSummary(), url.searchParams.get("fresh") === "1"));
    }

    if (url.pathname === "/api/services-summary" && req.method === "GET") {
      return sendJson(res, cachedSummary("services", 30000, () => servicesSummary(), url.searchParams.get("fresh") === "1"));
    }

    if (url.pathname === "/api/admin-summary" && req.method === "GET") {
      return sendJson(res, cachedSummary("admin", 30000, () => adminSummary(), url.searchParams.get("fresh") === "1"));
    }

    if (url.pathname === "/api/review-summary" && req.method === "GET") {
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const pageSize = Math.max(5, Math.min(30, Number(url.searchParams.get("pageSize") || 15)));
      const offset = (page - 1) * pageSize;
      return sendJson(res, cachedSummary(`review:${page}:${pageSize}`, 30000, () => reviewSummary(reviewContracts(pageSize, offset), reviewContractCount(), page, pageSize), url.searchParams.get("fresh") === "1"));
    }

    if (url.pathname === "/api/facilities" && req.method === "GET") {
      return sendJson(res, facilitySummaries());
    }

    if (url.pathname === "/api/vendors" && req.method === "GET") {
      const requestedLimit = Number(url.searchParams.get("limit") || 0);
      const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(5000, Math.max(1, requestedLimit))
        : 0;
      const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
      const queryKey = canonicalNameKey(query);
      const filterRows = rows => {
        let next = Array.isArray(rows) ? rows : [];
        if (query) {
          next = next.filter(row => {
            const haystack = `${row.name || ""} ${row.legalName || ""} ${row.dba || ""} ${(row.aliases || []).join(" ")} ${row.category || ""} ${row.email || ""} ${row.phone || ""}`;
            return haystack.toLowerCase().includes(query)
              || Boolean(queryKey && canonicalNameKey(haystack).includes(queryKey));
          });
        }
        return limit ? next.slice(0, limit) : next;
      };
      if (url.searchParams.get("light") === "1") {
        return sendJson(res, filterRows(vendorLightSummaries(allContracts())));
      }
      return sendJson(res, filterRows(vendorSummaries()));
    }

    if (url.pathname === "/api/vendor-profiles" && req.method === "GET") {
      return sendJson(res, listVendorProfiles());
    }

    if (url.pathname === "/api/vendor-profiles" && req.method === "POST") {
      const body = await readBody(req);
      const name = String(body.name || body.legalName || "").trim();
      if (!name) return sendJson(res, { error: "Vendor name is required." }, 400);
      const existing = findVendorProfileByName(name);
      const now = new Date().toISOString();
      const profile = {
        ...(existing || {}),
        ...body,
        id: body.id || existing?.id || vendorProfileId(name),
        name,
        legalName: body.legalName || body.name || existing?.legalName || name,
        status: body.status || existing?.status || "Active",
        updatedAt: now,
        createdAt: existing?.createdAt || now
      };
      saveVendorProfile(profile);
      return sendJson(res, profile, existing ? 200 : 201);
    }

    const vendorProfileDeleteMatch = url.pathname.match(/^\/api\/vendor-profiles\/([^/]+)$/);
    if (vendorProfileDeleteMatch && req.method === "DELETE") {
      const profile = deleteVendorProfile(vendorProfileDeleteMatch[1]);
      if (!profile) return sendJson(res, { error: "Vendor profile not found." }, 404);
      logAudit("vendor_profile_deleted", "vendor", profile.id, { name: profile.name });
      return sendJson(res, { deleted: true, profile });
    }

    if (url.pathname === "/api/categories" && req.method === "GET") {
      return sendJson(res, categorySummaries());
    }

    if (url.pathname === "/api/utility-accounts" && req.method === "GET") {
      return sendJson(res, listUtilityAccounts());
    }

    if (url.pathname === "/api/utility-accounts" && req.method === "POST") {
      const body = await readBody(req);
      const account = {
        id: body.id || `UA-${Date.now()}`,
        facility: body.facility || "",
        vendor: body.vendor || "",
        utilityType: body.utilityType || body.category || "Utility",
        accountNumber: body.accountNumber || "",
        meterNumber: body.meterNumber || "",
        serviceAddress: body.serviceAddress || "",
        providerRole: body.providerRole || body.accountType || "Utility / Delivery",
        rateClass: body.rateClass || body.serviceClass || body.tariff || "",
        effectiveStart: body.effectiveStart || "",
        effectiveEnd: body.effectiveEnd || "",
        previousVendor: body.previousVendor || "",
        aliases: Array.isArray(body.aliases) ? body.aliases : [],
        status: body.status || "Active",
        createdAt: body.createdAt || new Date().toISOString()
      };
      saveUtilityAccount(account);
      return sendJson(res, account, 201);
    }

    const utilityAccountDeleteMatch = url.pathname.match(/^\/api\/utility-accounts\/([^/]+)$/);
    if (utilityAccountDeleteMatch && req.method === "DELETE") {
      const account = deleteUtilityAccount(decodeURIComponent(utilityAccountDeleteMatch[1]));
      if (!account) return sendJson(res, { error: "Account not found." }, 404);
      logAudit("utility_account_deleted", "utility_account", account.id, { facility: account.facility, vendor: account.vendor, accountNumber: account.accountNumber });
      return sendJson(res, { deleted: true, account });
    }

    if (url.pathname === "/api/tasks" && req.method === "GET") {
      return sendJson(res, listTasks());
    }

    if (url.pathname === "/api/tasks" && req.method === "POST") {
      const session = currentSession(req);
      const body = await readBody(req);
      return sendJson(res, upsertTask(body, session?.user || "local-user"), 201);
    }

    const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch && req.method === "PATCH") {
      const session = currentSession(req);
      const body = await readBody(req);
      return sendJson(res, upsertTask({ ...body, id: decodeURIComponent(taskMatch[1]) }, session?.user || "local-user"));
    }

    if (taskMatch && req.method === "DELETE") {
      const task = deleteTask(decodeURIComponent(taskMatch[1]));
      if (!task) return sendJson(res, { error: "Task not found." }, 404);
      return sendJson(res, { deleted: true, task });
    }

    if (url.pathname === "/api/exceptions" && req.method === "GET") {
      return sendJson(res, []);
    }

    if (url.pathname === "/api/reports/cost" && req.method === "GET") {
      return sendJson(res, costReportRows());
    }

    if (url.pathname === "/api/audit-logs" && req.method === "GET") {
      return sendJson(res, listAuditLogs());
    }

    if (url.pathname === "/api/presence" && req.method === "POST") {
      const body = await readBody(req).catch(() => ({}));
      return sendJson(res, updateActivePresence(req, body));
    }

    if (url.pathname === "/api/presence" && req.method === "GET") {
      return sendJson(res, listActivePresence());
    }

    const aiReviewMatch = url.pathname.match(/^\/api\/review\/([^/]+)\/ai-review$/);
    if (aiReviewMatch && req.method === "POST") {
      const contractId = decodeURIComponent(aiReviewMatch[1]);
      const contract = getContract(contractId);
      if (!contract) return sendJson(res, { error: "Contract not found" }, 404);
      if (enforceContractAccess(req, res, contract)) return;
      try {
        const body = await readBody(req).catch(() => ({}));
        const pastedFeeText = String(body?.feeText || "").slice(0, 8000);
        const result = await runOllamaContractReview(contract, pastedFeeText);
        logAudit("ai_contract_review", "contract", contract.id, { provider: result.provider || "ollama", status: result.status });
        return sendJson(res, result, result.enabled ? 200 : 400);
      } catch (error) {
        return sendJson(res, { error: "AI review could not finish.", detail: error.message }, 500);
      }
    }

    const reviewMatch = url.pathname.match(/^\/api\/review\/([^/]+)$/);
    if (reviewMatch && req.method === "GET") {
      const contractId = decodeURIComponent(reviewMatch[1]);
      const contract = getContract(contractId);
      if (!contract) return sendJson(res, { error: "Contract not found" }, 404);
      if (enforceContractAccess(req, res, contract)) return;
      const jobs = listOcrJobs().filter(job => job.contractId === contractId);
      return sendJson(res, {
        contract,
        ocrJobs: jobs,
        extractedFields: contract.extractedFields || [],
        clauses: contract.extractedClauses || [],
        feeLines: contract.extractedFeeLines || []
      });
    }

    if (reviewMatch && req.method === "POST") {
      const contractId = decodeURIComponent(reviewMatch[1]);
      const contract = getContract(contractId);
      if (!contract) return sendJson(res, { error: "Contract not found" }, 404);
      if (enforceContractAccess(req, res, contract)) return;
      const previous = { ...contract };
      const body = await readBody(req);
      const fields = Array.isArray(body.fields) ? body.fields : [];
      const reviewedFields = fields.map(field => {
        if (!field || typeof field !== "object") return field;
        if (!field.approved) return field;
        const source = String(field.source || "");
        const hasProofStamp = /pdf verified|source verified|verified against source|verified against actual|verified by reviewer|verified against current contract ocr/i.test(source);
        return {
          ...field,
          approvedAt: field.approvedAt || new Date().toISOString(),
          approvedBy: field.approvedBy || "Reviewer",
          source: hasProofStamp ? source : (source ? `${source} Source Verified by reviewer.` : "Source Verified by reviewer during final submit.")
        };
      });
      const feeLines = Array.isArray(body.feeLines) ? body.feeLines : [];
      const businessStatus = body.businessStatus && typeof body.businessStatus === "object" ? body.businessStatus : {};
      const approvalJustification = String(body.approvalJustification || "").trim();
      const financialBenchmark = body.financialBenchmark && typeof body.financialBenchmark === "object" ? body.financialBenchmark : {};
      const proofText = contract.ocrText || contract.extractedText || (getOcrJobsForContract(contractId).find(job => job.extractedText)?.extractedText || "");
      const unsafeFields = unsafeAutoReviewFields(reviewedFields, proofText);
      if (unsafeFields.length) {
        return sendJson(res, {
          error: "Required fields need proof.",
          detail: `These required fields need a clear answer from this contract and source proof before approval: ${unsafeFields.slice(0, 8).join(", ")}${unsafeFields.length > 8 ? "..." : ""}`,
          fields: unsafeFields.map(label => ({ label, reason: "Needs answer + source proof" })),
          nextStep: "Open each listed field, enter the correct value from the contract, then click Save Field. If OCR cannot find the exact words but you checked the PDF or Word file, click Source Verified."
        }, 400);
      }
      const costField = reviewedFields.find(field => reviewFieldCanonicalLabel(field?.label) === "cost")
        || reviewedFields.find(field => ["fee", "rate / fee", "monthly cost", "contract value", "annual cost", "annual spend"].includes(canonicalContractKeyLabel(field?.label).toLowerCase()));
      const feeLineHasCost = feeLines.some(line => reviewCostValueIsUsable(line?.rate || line?.amount || line?.fee, `${line?.service || ""} ${line?.source || ""}`));
      if (!reviewCostValueIsUsable(costField?.value, costField?.source) && !feeLineHasCost) {
        return sendJson(res, {
          error: "Cost / Rate needs an answer.",
          detail: "The contract cannot be approved until Cost / Rate has a usable answer.",
          fields: [{ label: "Cost / Rate", value: costField?.value || "", reason: "Needs fee, rate, schedule, or no-charge wording" }],
          nextStep: "Enter the fee, rate, monthly cost, annual cost, per-service rate, fee schedule, or type No charge if the contract says there is no charge. Then click Save Field."
        }, 400);
      }
      applyApprovedFields(contract, reviewedFields);
      contract.approvalJustification = approvalJustification;
      contract.financialBenchmark = {
        status: String(financialBenchmark.status || ""),
        tone: String(financialBenchmark.tone || ""),
        requiresJustification: Boolean(financialBenchmark.requiresJustification),
        message: String(financialBenchmark.message || ""),
        metric: String(financialBenchmark.metric || ""),
        peerCount: Number(financialBenchmark.peerCount || 0),
        candidateValue: Number(financialBenchmark.candidateValue || 0),
        average: Number(financialBenchmark.average || 0),
        min: Number(financialBenchmark.min || 0),
        max: Number(financialBenchmark.max || 0),
        percent: Number(financialBenchmark.percent || 0),
        comparedAt: new Date().toISOString()
      };
      const selectedStatus = String(businessStatus.status || "").trim();
      if (selectedStatus) {
        contract.status = selectedStatus;
        contract.contractStatus = selectedStatus;
      }
      contract.replacementContractId = String(businessStatus.replacementContractId || "").trim();
      contract.replacementContractName = String(businessStatus.replacementContractName || "").trim();
      if (contract.status !== "Replaced") {
        contract.replacementContractId = "";
        contract.replacementContractName = "";
      }
      contract.extractedFeeLines = feeLines.map(line => ({ ...line, approved: true }));
      const shareSyncRefile = await refileContractInShareSync(contract).catch(error => {
        contract.shareSyncMoveError = error.message;
        logAudit("sharesync_refile_failed", "contract", contract.id, { name: contract.name, error: error.message });
        return null;
      });
      let masterLearned = [];
      let learned = [];
      let learningError = "";
      try {
        masterLearned = learnMasterDataFromApprovedContract(contract, contract.approvedFields || fields);
        learned = saveAutomaticLearningFromReview(contract, contract.approvedFields || fields, contract.extractedFeeLines || feeLines);
      } catch (error) {
        learningError = error.message;
        logAudit("contract_learning_failed", "contract", contract.id, { name: contract.name, error: error.message });
      }
      contract.learningSummary = {
        lastLearnedAt: new Date().toISOString(),
        rulesAdded: learned.length,
        masterDataAdded: masterLearned.length,
        masterData: masterLearned,
        totalRules: listLearningRules().length,
        error: learningError
      };
      saveContract(contract);
      try {
        saveContractVersion(contract, { action: "contract_review_approved", actor: currentSession(req)?.user || "local-user", previous });
      } catch (error) {
        contract.versionSaveError = error.message;
        logAudit("contract_version_save_failed", "contract", contract.id, { name: contract.name, error: error.message });
      }
      logAudit("contract_review_approved", "contract", contract.id, { name: contract.name, approvedFields: fields.length, learningRulesAdded: learned.length, masterDataLearned: masterLearned.length, learningError, shareSyncRefile, financialBenchmark: contract.financialBenchmark, approvalJustification });
      return sendJson(res, { contract, fields: contract.approvedFields, learnedRules: learned.length, learnedMasterData: masterLearned.length, learnedMasterItems: masterLearned, learningSummary: contract.learningSummary, shareSyncRefile });
    }

    const reviewFieldMatch = url.pathname.match(/^\/api\/review\/([^/]+)\/field$/);
    if (reviewFieldMatch && req.method === "POST") {
      const contractId = decodeURIComponent(reviewFieldMatch[1]);
      const contract = getContract(contractId);
      if (!contract) return sendJson(res, { error: "Contract not found" }, 404);
      if (enforceContractAccess(req, res, contract)) return;
      const previous = { ...contract };
      const body = await readBody(req);
      const field = body.field && typeof body.field === "object" ? body.field : {};
      if (!field.label) return sendJson(res, { error: "Field label is required." }, 400);
      const cleanedValue = cleanExtractedFieldValue(field.label, field.value);
      if (!cleanedValue) return sendJson(res, reviewFieldSaveProblem(field), 400);
      const fieldMeaning = reviewFieldCanonicalLabel(field.label);
      const existingField = (contract.extractedFields || contract.approvedFields || []).find(item =>
        canonicalContractKeyLabel(item?.label).toLowerCase() === canonicalContractKeyLabel(field.label).toLowerCase()
        || reviewFieldCanonicalLabel(item?.label) === fieldMeaning
      );
      const savedField = {
        ...field,
        value: cleanedValue,
        originalValue: field.originalValue || existingField?.value || "",
        confidence: Number(field.confidence || 100),
        source: field.source || "Source Verified by reviewer from Review Queue.",
        approved: true,
        approvedBy: field.approvedBy || "Reviewer"
      };
      applySingleReviewField(contract, savedField);
      const syncedJobs = syncOcrJobsForSavedReviewField(contract.id, savedField);
      let learned = [];
      let learningError = "";
      try {
        learned = saveAutomaticLearningFromReview(contract, [savedField], []);
      } catch (error) {
        learningError = error.message;
        logAudit("review_field_learning_failed", "contract", contract.id, { name: contract.name, label: savedField.label, error: error.message });
      }
      contract.learningSummary = {
        ...(contract.learningSummary || {}),
        lastLearnedAt: learned.length ? new Date().toISOString() : contract.learningSummary?.lastLearnedAt,
        lastFieldLearned: savedField.label,
        totalRules: listLearningRules().length,
        error: learningError || contract.learningSummary?.error || ""
      };
      if (canonicalContractKeyLabel(savedField.label).toLowerCase() === "vendor") {
        try {
          updateVendorProfileFromContract(contract, contract.approvedFields || [savedField]);
        } catch (error) {
          contract.vendorProfileUpdateError = error.message;
          logAudit("vendor_profile_update_failed", "contract", contract.id, { name: contract.name, error: error.message });
        }
      }
      saveContract(contract);
      try {
        saveContractVersion(contract, { action: "contract_review_field_saved", actor: currentSession(req)?.user || "local-user", previous });
      } catch (error) {
        contract.versionSaveError = error.message;
        logAudit("contract_version_save_failed", "contract", contract.id, { name: contract.name, error: error.message });
      }
      logAudit("contract_review_field_saved", "contract", contract.id, { name: contract.name, label: savedField.label, value: savedField.value, originalValue: savedField.originalValue, learningRulesAdded: learned.length, syncedOcrJobs: syncedJobs });
      return sendJson(res, { contract, field: savedField, learnedRules: learned.length, learningSummary: contract.learningSummary, syncedOcrJobs: syncedJobs });
    }

    if (reviewFieldMatch && req.method === "DELETE") {
      const contractId = decodeURIComponent(reviewFieldMatch[1]);
      const contract = getContract(contractId);
      if (!contract) return sendJson(res, { error: "Contract not found" }, 404);
      if (enforceContractAccess(req, res, contract)) return;
      const previous = { ...contract };
      const body = await readBody(req);
      const label = String(body.label || "").trim();
      if (!label) return sendJson(res, { error: "Field label is required." }, 400);
      deleteSingleReviewField(contract, label);
      saveContract(contract);
      saveContractVersion(contract, { action: "contract_review_field_deleted", actor: currentSession(req)?.user || "local-user", previous });
      logAudit("contract_review_field_deleted", "contract", contract.id, { name: contract.name, label });
      return sendJson(res, { contract, deleted: true, label });
    }

    if (url.pathname === "/api/learning-rules" && req.method === "GET") {
      return sendJson(res, listLearningRules());
    }

    if (url.pathname === "/api/learning-rules" && req.method === "POST") {
      const body = await readBody(req);
      const contract = body.contractId ? getContract(body.contractId) : null;
      const fields = Array.isArray(body.fields) ? body.fields : [];
      const feeLines = Array.isArray(body.feeLines) ? body.feeLines : [];
      const sourceText = contract?.ocrText || body.sourceText || "";
      const saved = [];
      for (const field of fields) {
        if (!field?.label || !field?.value) continue;
        const rule = saveLearningRule({
          label: field.label,
          value: field.value,
          originalValue: field.originalValue || field.ocrValue || "",
          snippet: field.snippet || field.source || "",
          sourceText,
          contractId: contract?.id || body.contractId || "",
          contractName: contract?.name || "",
          contractType: fieldValue(contract?.approvedFields || contract?.extractedFields || [], "Contract Type") || contract?.agreementType || contract?.category || "",
          vendor: contract?.vendor || "",
          facility: contract?.facility || "",
          category: contract?.category || "",
          learnedFrom: "manual-teach"
        });
        if (rule) saved.push(rule);
      }
      for (const line of feeLines) {
        if (!line?.rate) continue;
        const rule = saveLearningRule({
          label: "Fee Line",
          value: [line.service || "Fee", line.rate, line.unit, line.frequency].filter(Boolean).join(" | "),
          snippet: line.source || "",
          sourceText,
          contractId: contract?.id || body.contractId || "",
          contractName: contract?.name || "",
          contractType: fieldValue(contract?.approvedFields || contract?.extractedFields || [], "Contract Type") || contract?.agreementType || contract?.category || "",
          vendor: contract?.vendor || "",
          facility: contract?.facility || "",
          category: contract?.category || "",
          learnedFrom: "manual-fee-teach"
        });
        if (rule) saved.push(rule);
      }
      logAudit("learning_rules_saved", "learning", contract?.id || "manual", { count: saved.length });
      return sendJson(res, { saved, count: saved.length }, 201);
    }

    if (url.pathname === "/api/contracts" && req.method === "POST") {
      const body = await readBody(req);
      const contract = {
        id: `CTR-${Date.now()}`,
        status: "Needs Review",
        reviewStatus: "Pending",
        createdAt: new Date().toISOString(),
        ...body
      };
      saveContract(contract);
      saveContractVersion(contract, { action: "contract_created", actor: currentSession(req)?.user || "local-user" });
      logAudit("contract_created", "contract", contract.id, { name: contract.name });
      return sendJson(res, contract, 201);
    }

    if (url.pathname === "/api/sharesync-intake" && req.method === "POST") {
      const body = await readBody(req);
      let downloaded = null;
      if (body.shareSyncUrl && !body.localFilePath) {
        downloaded = await tryDownloadShareSyncLink(body.shareSyncUrl).catch(error => {
          logAudit("sharesync_link_download_failed", "contract", "sharesync", { url: body.shareSyncUrl, error: error.message });
          if (error instanceof AppHttpError) throw error;
          throw new AppHttpError("ShareSync link could not be downloaded. Use the synced ShareSync folder or a direct file link.", 400);
        });
      }
      return sendJson(res, await createIntake({
        ...body,
        name: body.name || downloaded?.originalName || "ShareSync Intake Contract",
        localFilePath: downloaded?.filePath || body.localFilePath || "",
        uploadedFileName: downloaded?.originalName || body.uploadedFileName || "",
        fileHash: downloaded?.fileHash || body.fileHash || ""
      }), 201);
    }

    if (url.pathname === "/api/sharesync-scan" && req.method === "POST") {
      const body = await readBody(req);
      const root = configuredShareSyncRoot();
      if (!root) return sendJson(res, { error: "Set Admin > ShareSync root folder to a real Windows folder first." }, 400);
      const maxFiles = Math.min(Math.max(Number(body.limit || 100), 1), 500);
      const files = await scanShareSyncFiles(root, { limit: maxFiles });
      const imported = [];
      const skipped = [];
      for (const filePath of files) {
        const hints = shareSyncHintsFromPath(filePath, root);
        const duplicateMatches = duplicateContractMatches({
          localFilePath: filePath,
          shareSyncLocalPath: filePath,
          uploadedFileName: hints.uploadedFileName,
          facility: hints.facility,
          category: hints.category,
          vendor: hints.vendor,
          name: hints.uploadedFileName
        });
        if (duplicateMatches.length) {
          skipped.push({ filePath, reason: "Duplicate", existingContract: duplicateMatches[0]?.name || duplicateMatches[0]?.id || "" });
          continue;
        }
        const intake = await createIntake({
          name: hints.uploadedFileName,
          localFilePath: filePath,
          uploadedFileName: hints.uploadedFileName,
          shareSyncLocalPath: filePath,
          shareSyncFolderPath: path.dirname(filePath),
          facility: hints.facility,
          category: hints.category,
          vendor: hints.vendor,
          documentType: "Contract",
          owner: body.owner || "Contract Dept",
          forceDuplicate: false
        });
        if (intake?.duplicate) {
          skipped.push({ filePath, reason: "Duplicate", existingContract: intake.existingContract?.name || "" });
        } else {
          imported.push({ filePath, contractId: intake.contract?.id, ocrJobId: intake.ocrJob?.id, name: intake.contract?.name });
        }
      }
      logAudit("sharesync_folder_scanned", "system", "sharesync", { root, found: files.length, imported: imported.length, skipped: skipped.length });
      return sendJson(res, { root, found: files.length, imported, skipped }, 201);
    }

    if (url.pathname === "/api/upload-contract" && req.method === "POST") {
      const body = await readRawBody(req);
      const { fields, file } = parseMultipartForm(body, req.headers["content-type"]);
      if (!file || !file.buffer.length) return sendJson(res, { error: "Choose a PDF, Word .docx, image, or text file to upload." }, 400);
      if (file.buffer.length > maxUploadBytes) return sendJson(res, { error: `File is too large. Limit is ${Math.round(maxUploadBytes / 1024 / 1024)}MB.` }, 413);
      const ext = path.extname(file.originalName).toLowerCase();
      const allowed = new Set([".pdf", ".docx", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".txt", ".text", ".md", ".eml"]);
      if (ext === ".doc") return sendJson(res, { error: "Old Word .doc files cannot be read directly. Open it in Microsoft Word, save as .docx or PDF, then upload again." }, 400);
      if (!allowed.has(ext)) return sendJson(res, { error: "Unsupported upload type. Use PDF, Word .docx, image, or text files." }, 400);
      const fileHash = uploadedContractFingerprint(file.buffer);
      const duplicateMatches = duplicateContractMatches({
        fileHash,
        uploadedFileName: file.originalName,
        facility: fields.facility,
        vendor: fields.vendor,
        category: fields.category,
        name: fields.name || file.originalName
      });
      if (duplicateMatches.length && fields.forceDuplicate !== "true") {
        return sendJson(res, {
          duplicate: true,
          skipped: true,
          message: "Possible duplicate contract found. Existing contract was not duplicated.",
          existingContract: duplicateMatches[0],
          duplicateMatches
        }, 200);
      }
      const uploadId = `UP-${Date.now()}`;
      const filePath = path.join(uploadsDir, `${uploadId}-${file.originalName}`);
      await fs.writeFile(filePath, file.buffer);
      const shareSyncCopy = await copyUploadToShareSync({
        filePath,
        originalName: file.originalName,
        facility: fields.facility,
        category: fields.category,
        vendor: fields.vendor
      }).catch(error => {
        logAudit("sharesync_copy_failed", "contract", uploadId, { file: file.originalName, error: error.message });
        return null;
      });
      return sendJson(res, await createIntake({
        name: fields.name || file.originalName,
        localFilePath: filePath,
        uploadedFileName: file.originalName,
        fileHash,
        shareSyncLocalPath: shareSyncCopy?.shareSyncLocalPath || "",
        shareSyncFolderPath: shareSyncCopy?.shareSyncFolderPath || "",
        shareSyncCopies: shareSyncCopy?.shareSyncCopies || [],
        facility: fields.facility,
        vendor: fields.vendor,
        category: fields.category,
        documentType: fields.documentType,
        owner: fields.owner
      }), 201);
    }

    if (url.pathname === "/api/invoices" && req.method === "GET") {
      return sendJson(res, listInvoices());
    }

    if (url.pathname === "/api/utility-integrations" && req.method === "GET") {
      return sendJson(res, await readJson("utility-integrations.json", []));
    }

    if (url.pathname === "/api/utility-integrations" && req.method === "POST") {
      const body = await readBody(req);
      const name = String(body.name || "").trim();
      const type = String(body.type || "REST API").trim();
      const baseUrl = String(body.baseUrl || "").trim();
      const credentialEnvVar = String(body.credentialEnvVar || "").trim().replace(/[^A-Z0-9_]/gi, "");
      if (!name) return sendJson(res, { error: "Provider or AMR system name is required." }, 400);
      if (baseUrl) {
        try {
          const parsed = new URL(baseUrl);
          if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
        } catch {
          return sendJson(res, { error: "The connector URL must be a valid HTTP or HTTPS URL." }, 400);
        }
      }
      const integrations = await readJson("utility-integrations.json", []);
      const existing = body.id ? integrations.find(item => item.id === body.id) : null;
      const credentialReady = credentialEnvVar && Boolean(process.env[credentialEnvVar]);
      const integration = {
        id: existing?.id || `UTIL-${crypto.randomUUID()}`,
        name,
        type,
        baseUrl,
        credentialEnvVar,
        schedule: String(body.schedule || "Daily"),
        company: String(body.company || ""),
        facility: String(body.facility || ""),
        status: baseUrl && credentialReady ? "Configured" : credentialEnvVar ? "Ready for credentials" : "Configuration needed",
        lastSyncAt: existing?.lastSyncAt || "",
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const next = existing ? integrations.map(item => item.id === existing.id ? integration : item) : [...integrations, integration];
      await writeJson("utility-integrations.json", next);
      logAudit("utility_integration_saved", "utility-integration", integration.id, { name, type, status: integration.status });
      return sendJson(res, integration, existing ? 200 : 201);
    }

    const integrationMatch = url.pathname.match(/^\/api\/utility-integrations\/([^/]+)$/);
    if (integrationMatch && req.method === "DELETE") {
      const id = decodeURIComponent(integrationMatch[1]);
      const integrations = await readJson("utility-integrations.json", []);
      if (!integrations.some(item => item.id === id)) return sendJson(res, { error: "Connector not found." }, 404);
      await writeJson("utility-integrations.json", integrations.filter(item => item.id !== id));
      logAudit("utility_integration_removed", "utility-integration", id, {});
      return sendJson(res, { ok: true });
    }

    const integrationTestMatch = url.pathname.match(/^\/api\/utility-integrations\/([^/]+)\/test$/);
    if (integrationTestMatch && req.method === "POST") {
      const id = decodeURIComponent(integrationTestMatch[1]);
      const integration = (await readJson("utility-integrations.json", [])).find(item => item.id === id);
      if (!integration) return sendJson(res, { error: "Connector not found." }, 404);
      const credentialReady = integration.credentialEnvVar && Boolean(process.env[integration.credentialEnvVar]);
      return sendJson(res, {
        ok: Boolean(integration.baseUrl && credentialReady),
        status: !integration.baseUrl ? "Provider URL required" : credentialReady ? "Configuration validated" : `Set ${integration.credentialEnvVar || "a credential environment variable"} on the server`,
        networkRequestMade: false
      });
    }

    if (url.pathname === "/api/ocr-learning/status" && req.method === "GET") {
      const invoices = listInvoices();
      const templates = new Map();
      for (const invoice of invoices) {
        const identity = [
          normalizeMatchValue(invoice.vendor || ""),
          normalizeMatchValue(invoice.accountNumber || invoice.meterNumber || ""),
          normalizeMatchValue(invoice.utilityType || "")
        ];
        if (!identity[0] && !identity[1]) continue;
        const key = identity.join("|");
        const row = templates.get(key) || {
          vendor: invoice.vendor || "",
          accountNumber: invoice.accountNumber || "",
          meterNumber: invoice.meterNumber || "",
          utilityType: invoice.utilityType || "",
          facility: invoice.facility || "",
          documentsSeen: 0,
          reviewedDocuments: 0
        };
        row.documentsSeen += 1;
        if (/verified|reviewed/i.test(String(invoice.status || "")) || invoice.reviewedAt) row.reviewedDocuments += 1;
        templates.set(key, row);
      }
      return sendJson(res, {
        documents: invoices.length,
        reusableTemplates: [...templates.values()].filter(item => item.documentsSeen > 1).length,
        reviewedDocuments: invoices.filter(item => item.reviewedAt || /verified|reviewed/i.test(String(item.status || ""))).length,
        templates: [...templates.values()].sort((a, b) => b.documentsSeen - a.documentsSeen).slice(0, 50)
      });
    }

    const invoiceUpdateMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)$/);
    if (invoiceUpdateMatch && req.method === "PATCH") {
      const invoiceId = decodeURIComponent(invoiceUpdateMatch[1]);
      const invoice = listInvoices().find(item => item.id === invoiceId);
      if (!invoice) return sendJson(res, { error: "Invoice not found." }, 404);
      const body = await readBody(req);
      const editable = [
        "facility", "vendor", "utilityType", "accountNumber", "meterNumber", "invoiceNumber",
        "servicePeriod", "servicePeriodLabel", "sourceFile",
        "usage", "usageUnit", "unitRate", "supplyCharges", "deliveryCharges", "demandCharges",
        "waterCharges", "sewerCharges", "customerCharges", "fuelCharges", "surcharges",
        "taxes", "fees", "credits", "adjustments", "currentCharges", "priorBalance",
        "payments", "lateFees", "totalAmountDue", "readingType", "billingDays",
        "previousReading", "currentReading", "demand"
      ];
      const corrections = [];
      for (const key of editable) {
        if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
        const previous = invoice[key] ?? "";
        invoice[key] = body[key];
        if (String(previous) !== String(body[key])) corrections.push({ field: key, previous, value: body[key] });
      }
      invoice.status = body.status || "Verified";
      invoice.reviewedAt = new Date().toISOString();
      invoice.reviewedBy = currentSession(req)?.user || "local-user";
      invoice.reviewCorrections = [...(invoice.reviewCorrections || []), ...corrections].slice(-100);
      invoice.updatedAt = invoice.reviewedAt;
      saveInvoice(invoice);
      logAudit("utility_bill_reviewed", "invoice", invoice.id, { corrections: corrections.length, reviewedBy: invoice.reviewedBy });
      return sendJson(res, invoice);
    }

    if (url.pathname === "/api/upload-invoice-archive" && req.method === "POST") {
      const body = await readRawBody(req);
      const { fields, file } = parseMultipartForm(body, req.headers["content-type"]);
      if (!file || !file.buffer.length) return sendJson(res, { error: "Choose a ZIP archive of bills." }, 400);
      if (path.extname(file.originalName).toLowerCase() !== ".zip") return sendJson(res, { error: "Bulk archives must use the .zip format." }, 400);
      if (file.buffer.length > maxUploadBytes) return sendJson(res, { error: `ZIP is too large. Limit is ${Math.round(maxUploadBytes / 1024 / 1024)}MB.` }, 413);
      try {
        const extracted = invoiceFilesFromZip(file.buffer, maxUploadBytes * 5);
        if (!extracted.length) return sendJson(res, { error: "The ZIP did not contain supported bill files." }, 400);
        const results = [];
        for (const item of extracted) {
          const response = await postLocalInvoiceFile(item, fields.facility || "", req);
          results.push({ fileName: item.name, ok: response.ok, ...response.result });
        }
        const imported = results.filter(item => item.ok && !item.duplicate).length;
        const duplicates = results.filter(item => item.duplicate).length;
        const failed = results.filter(item => !item.ok).length;
        logAudit("utility_bill_archive_uploaded", "invoice", file.originalName, { files: results.length, imported, duplicates, failed });
        return sendJson(res, { files: results.length, imported, duplicates, failed, results }, failed === results.length ? 400 : 201);
      } catch (error) {
        return sendJson(res, { error: error.message || "ZIP processing failed." }, 400);
      }
    }

    if (url.pathname === "/api/upload-invoice" && req.method === "POST") {
      const body = await readRawBody(req);
      const { fields, file } = parseMultipartForm(body, req.headers["content-type"]);
      if (!file || !file.buffer.length) return sendJson(res, { error: "Choose an invoice file to upload." }, 400);
      if (file.buffer.length > maxUploadBytes) return sendJson(res, { error: `File is too large. Limit is ${Math.round(maxUploadBytes / 1024 / 1024)}MB.` }, 413);
      const ext = path.extname(file.originalName).toLowerCase();
      const allowed = new Set([".pdf", ".docx", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".txt", ".text", ".md", ".csv", ".xlsx"]);
      if (!allowed.has(ext)) return sendJson(res, { error: "Unsupported invoice type. Use PDF, Word .docx, image, CSV, Excel, or text files." }, 400);
      const contentHash = crypto.createHash("sha256").update(file.buffer).digest("hex");
      const duplicate = listInvoices().find(item => item.contentHash === contentHash);
      if (duplicate) {
        logAudit("utility_bill_duplicate_detected", "invoice", duplicate.id, { uploadedFileName: file.originalName, contentHash });
        return sendJson(res, { ...duplicate, duplicate: true, duplicateMessage: "This exact file was already imported." });
      }
      const invoiceId = `INV-CHECK-${Date.now()}`;
      const now = new Date().toISOString();
      const invoice = {
        id: invoiceId,
        name: fields.name || file.originalName,
        vendor: fields.vendor || "",
        facility: fields.facility || "",
        invoiceDate: fields.invoiceDate || "",
        total: fields.total || "",
        status: "Checking",
        uploadedFileName: file.originalName,
        contentHash,
        createdAt: now,
        updatedAt: now
      };
      const filePath = path.join(uploadsDir, `${invoiceId}-${sanitizeFileName(file.originalName)}`);
      invoice.localFilePath = filePath;
      try {
        await fs.writeFile(filePath, file.buffer);
        if (ext !== ".xlsx") {
          const text = await extractText(filePath);
          const details = extractInvoiceDetails(text, invoice);
          const utilityDetails = extractUtilityBillDetails(text, invoice);
          const match = matchInvoiceToContract({ ...invoice, vendor: details.vendor || invoice.vendor, invoiceDate: details.invoiceDate || invoice.invoiceDate, total: details.total || invoice.total }, text);
          invoice.ocrText = details.clean;
          invoice.ocrTextPreview = details.clean.slice(0, 1200);
          invoice.billNumericFacts = extractBillNumericFacts(details.clean);
          invoice.extractedFields = [...details.fields, ...utilityDetails.fields];
          invoice.utilityBill = utilityDetails;
          invoice.utilityType = utilityDetails.utilityType;
          invoice.accountNumber = utilityDetails.accountNumber;
          invoice.meterNumber = utilityDetails.meterNumber;
          invoice.servicePeriod = utilityDetails.servicePeriod;
          invoice.usage = utilityDetails.usage;
          invoice.unitRate = utilityDetails.rate;
          invoice.demand = utilityDetails.demand;
          invoice.billingDays = utilityDetails.billingDays;
          invoice.previousReading = utilityDetails.previousReading;
          invoice.currentReading = utilityDetails.currentReading;
          invoice.readingType = utilityDetails.readingType;
          invoice.supplyCharges = utilityMoney(utilityDetails.charges?.supply);
          invoice.deliveryCharges = utilityMoney(utilityDetails.charges?.delivery);
          invoice.demandCharges = utilityMoney(utilityDetails.charges?.demand);
          invoice.waterCharges = utilityMoney(utilityDetails.charges?.water);
          invoice.sewerCharges = utilityMoney(utilityDetails.charges?.sewer);
          invoice.customerCharges = utilityMoney(utilityDetails.charges?.customer);
          invoice.fuelCharges = utilityMoney(utilityDetails.charges?.fuel);
          invoice.surcharges = utilityMoney(utilityDetails.charges?.surcharges);
          invoice.taxes = utilityMoney(utilityDetails.charges?.taxes);
          invoice.fees = utilityMoney(utilityDetails.charges?.fees);
          invoice.lateFees = utilityMoney(utilityDetails.charges?.lateFees);
          invoice.priorBalance = utilityMoney(utilityDetails.balances?.previousBalance);
          invoice.payments = utilityMoney(utilityDetails.balances?.paymentsReceived);
          invoice.credits = utilityMoney(utilityDetails.balances?.credits);
          invoice.adjustments = utilityMoney(utilityDetails.balances?.adjustments);
          const currentChargeResult = currentUtilityCharges(utilityDetails);
          invoice.currentCharges = currentChargeResult.value;
          invoice.currentChargesSource = currentChargeResult.source;
          invoice.invoiceNumber = details.invoiceNumber || invoice.invoiceNumber;
          invoice.invoiceDate = details.invoiceDate || invoice.invoiceDate;
          invoice.total = details.total || invoice.total;
          invoice.totalAmountDue = details.total || invoice.totalAmountDue || "";
          invoice.vendor = details.vendor || invoice.vendor || match?.vendor || "";
          invoice.paymentTerms = details.paymentTerms || invoice.paymentTerms || "";
          invoice.serviceLines = details.serviceLines || [];
          invoice.facility = invoice.facility || match?.facility || "";
          invoice.contractCandidates = invoiceContractCandidates(invoice, text);
          const needsOllamaBillFallback = !invoice.currentCharges || !invoice.usage || !invoice.servicePeriod || !invoice.accountNumber || !invoice.utilityType;
          if (aiExtractionEnabled && needsOllamaBillFallback && !process.env.OPENAI_API_KEY) {
            const ollamaBill = await runOllamaUtilityBillExtraction(details.clean, {
              facility: invoice.facility,
              vendor: invoice.vendor,
              file_name: invoice.uploadedFileName,
              missing: [
                !invoice.utilityType && "utility_type",
                !invoice.accountNumber && "account_number",
                !invoice.servicePeriod && "service_period",
                !invoice.usage && "usage",
                !invoice.currentCharges && "current_charges",
                !invoice.rateClass && "rate_class",
                !invoice.demand && "peak_demand_kw"
              ].filter(Boolean)
            }).catch(error => ({ enabled: false, status: "error", provider: "ollama", model: ollamaModel, message: error.message }));
            invoice.ollamaBillExtraction = ollamaBill;
            if (ollamaBill.status === "complete") {
              const ai = ollamaBill.result || {};
              const fill = (key, value) => { if ((invoice[key] === undefined || invoice[key] === null || invoice[key] === "") && value !== undefined && value !== null && value !== "") invoice[key] = value; };
              fill("utilityType", ai.utility_type);
              fill("vendor", ai.provider);
              fill("accountNumber", ai.account_number);
              fill("meterNumber", ai.meter_number);
              fill("serviceStart", ai.service_start);
              fill("servicePeriod", ai.service_end);
              fill("usage", ai.usage);
              fill("usageUnit", ai.usage_unit);
              fill("demand", ai.peak_demand_kw);
              fill("rateClass", ai.rate_class);
              fill("currentCharges", utilityMoney(ai.current_charges));
              fill("supplyCharges", utilityMoney(ai.supply_charges));
              fill("deliveryCharges", utilityMoney(ai.delivery_charges));
              fill("demandCharges", utilityMoney(ai.demand_charges));
              fill("taxes", utilityMoney(ai.taxes));
              fill("fees", utilityMoney(ai.fees));
              fill("credits", utilityMoney(ai.credits));
              fill("adjustments", utilityMoney(ai.adjustments));
              fill("priorBalance", utilityMoney(ai.prior_balance));
              fill("totalAmountDue", utilityMoney(ai.total_amount_due));
              invoice.ollamaSourceSnippets = Array.isArray(ai.source_snippets) ? ai.source_snippets.slice(0, 30) : [];
            }
          }
          applyInvoiceParserMemory(invoice);
          invoice.status = match ? "Matched" : "Needs Match";
          const isUtilityInvoice = Boolean(invoice.utilityType || invoice.accountNumber || invoice.meterNumber || utilityDetails.utilityType);
          if (isUtilityInvoice && !invoice.currentCharges) invoice.status = "Needs Charge Review";
          if (invoice.ollamaBillExtraction?.status === "complete") invoice.status = "Ollama Assisted - Review";
          invoice.matchedContractId = match?.contractId || "";
          invoice.matchedContractName = match?.contractName || "";
          invoice.matchedCategory = match?.category || "";
          invoice.contractRate = match?.contractRate || "";
          invoice.paymentTerms = match?.paymentTerms || "";
          invoice.matchConfidence = match?.confidence || 0;
          invoice.matchReasons = match?.reasons || [];
          invoice.costPerBed = invoiceCostPerBed(invoice, match);
          invoice.exceptions = invoiceContractExceptions(invoice, match);
          invoice.contractComparison = invoiceContractComparison(invoice, match);
          invoice.serviceLineChecks = invoiceServiceLineChecks(invoice, match);
        } else {
          const match = matchInvoiceToContract(invoice, "");
          invoice.contractCandidates = invoiceContractCandidates(invoice, "");
          invoice.facility = invoice.facility || match?.facility || "";
          invoice.status = match ? "Matched" : "Needs Match";
          invoice.matchedContractId = match?.contractId || "";
          invoice.matchedContractName = match?.contractName || "";
          invoice.matchedCategory = match?.category || "";
          invoice.contractRate = match?.contractRate || "";
          invoice.paymentTerms = match?.paymentTerms || "";
          invoice.matchConfidence = match?.confidence || 0;
          invoice.matchReasons = match?.reasons || [];
          invoice.costPerBed = invoiceCostPerBed(invoice, match);
          invoice.exceptions = invoiceContractExceptions(invoice, match);
          invoice.contractComparison = invoiceContractComparison(invoice, match);
          invoice.serviceLineChecks = invoiceServiceLineChecks(invoice, match);
        }
      } catch (error) {
        invoice.status = "Needs Match";
        invoice.ocrError = error.message || "Invoice OCR did not finish.";
        invoice.costPerBed = invoiceCostPerBed(invoice, null);
        invoice.exceptions = invoiceContractExceptions(invoice, null);
        invoice.contractComparison = invoiceContractComparison(invoice, null);
        invoice.serviceLineChecks = invoiceServiceLineChecks(invoice, null);
      }
      invoice.updatedAt = new Date().toISOString();
      saveInvoice(invoice);
      logAudit("utility_bill_uploaded", "invoice", invoice.id, { name: invoice.name, status: invoice.status, utilityType: invoice.utilityType || "", matchedContractId: invoice.matchedContractId || "" });
      return sendJson(res, invoice, 201);
    }

    if (url.pathname === "/api/upload-utility-accounts" && req.method === "POST") {
      const body = await readRawBody(req);
      const { file } = parseMultipartForm(body, req.headers["content-type"]);
      if (!file || !file.buffer.length) return sendJson(res, { error: "Choose a CSV file with facility/account data." }, 400);
      if (file.buffer.length > maxUploadBytes) return sendJson(res, { error: `File is too large. Limit is ${Math.round(maxUploadBytes / 1024 / 1024)}MB.` }, 413);
      const ext = path.extname(file.originalName).toLowerCase();
      if (ext !== ".csv" && ext !== ".txt") return sendJson(res, { error: "Use a CSV file for utility accounts." }, 400);
      const accounts = parseUtilityAccountsCsv(file.buffer.toString("utf8"));
      for (const account of accounts) saveUtilityAccount(account);
      return sendJson(res, { imported: accounts.length, accounts }, 201);
    }

    if (url.pathname === "/api/upload-utility-data" && req.method === "POST") {
      const body = await readRawBody(req);
      const { file } = parseMultipartForm(body, req.headers["content-type"]);
      if (!file || !file.buffer.length) return sendJson(res, { error: "Choose an Excel or CSV file with utility history." }, 400);
      if (file.buffer.length > maxUploadBytes) return sendJson(res, { error: `File is too large. Limit is ${Math.round(maxUploadBytes / 1024 / 1024)}MB.` }, 413);
      const ext = path.extname(file.originalName).toLowerCase();
      if (![".xlsx", ".csv", ".txt"].includes(ext)) return sendJson(res, { error: "Use .xlsx, .csv, or .txt for utility history." }, 400);
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "utility-history-"));
      const filePath = path.join(tempDir, file.originalName);
      try {
        await fs.writeFile(filePath, file.buffer);
        const rows = ext === ".xlsx"
          ? await workbookRowsFromFile(filePath)
          : file.buffer.toString("utf8").split(/\r?\n/).filter(Boolean).map(splitCsvLine);
        const invoices = utilityHistoryFromRows(rows, file.originalName);
        for (const invoice of invoices) saveInvoice(invoice);
        logAudit("utility_history_imported", "invoice", file.originalName, { imported: invoices.length });
        return sendJson(res, {
          imported: invoices.length,
          skipped: Math.max(0, rows.length - 1 - invoices.length),
          utilities: [...new Set(invoices.map(item => item.utilityType).filter(Boolean))],
          facilities: [...new Set(invoices.map(item => item.facility).filter(Boolean))],
          invoices
        }, 201);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    }

    if (url.pathname === "/api/upload-utility-workbook" && req.method === "POST") {
      const body = await readRawBody(req);
      const { file } = parseMultipartForm(body, req.headers["content-type"]);
      if (!file || !file.buffer.length) return sendJson(res, { error: "Choose the Utility Data Import Template workbook." }, 400);
      if (path.extname(file.originalName).toLowerCase() !== ".xlsx") return sendJson(res, { error: "The comprehensive importer requires an .xlsx workbook." }, 400);
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "utility-workbook-"));
      const filePath = path.join(tempDir, file.originalName);
      try {
        await fs.writeFile(filePath, file.buffer);
        const [facilityRows, accountRows, historyRows, budgetRows, occupancyRows, weatherRows] = await Promise.all([
          workbookRowsFromFile(filePath, "Facility Master"),
          workbookRowsFromFile(filePath, "Accounts Meters"),
          workbookRowsFromFile(filePath, "Monthly History"),
          workbookRowsFromFile(filePath, "Budgets"),
          workbookRowsFromFile(filePath, "Occupancy"),
          workbookRowsFromFile(filePath, "Weather")
        ]);
        const facilities = facilityProfilesFromRows(facilityRows);
        const accounts = utilityAccountsFromTemplateRows(accountRows);
        const invoices = utilityHistoryFromRows(historyRows, file.originalName);
        const budgets = objectsFromRows(budgetRows);
        const occupancy = objectsFromRows(occupancyRows);
        const weather = objectsFromRows(weatherRows);
        for (const facility of facilities) saveFacilityProfile(facility);
        for (const account of accounts) saveUtilityAccount(account);
        for (const invoice of invoices) saveInvoice(invoice);
        await Promise.all([
          writeJson("utility-budgets.json", budgets),
          writeJson("utility-occupancy.json", occupancy),
          writeJson("utility-weather.json", weather)
        ]);
        logAudit("utility_workbook_imported", "invoice", file.originalName, { facilities: facilities.length, accounts: accounts.length, history: invoices.length, budgets: budgets.length, occupancy: occupancy.length, weather: weather.length });
        return sendJson(res, {
          imported: invoices.length,
          facilities: facilities.length,
          accounts: accounts.length,
          history: invoices.length,
          budgets: budgets.length,
          occupancy: occupancy.length,
          weather: weather.length
        }, 201);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    }

    if (url.pathname === "/api/upload-facility-master" && req.method === "POST") {
      const body = await readRawBody(req);
      const { file } = parseMultipartForm(body, req.headers["content-type"]);
      if (!file || !file.buffer.length) return sendJson(res, { error: "Choose an Excel or CSV file with facility data." }, 400);
      if (file.buffer.length > maxUploadBytes) return sendJson(res, { error: `File is too large. Limit is ${Math.round(maxUploadBytes / 1024 / 1024)}MB.` }, 413);
      const ext = path.extname(file.originalName).toLowerCase();
      if (![".xlsx", ".csv", ".txt"].includes(ext)) return sendJson(res, { error: "Use .xlsx, .csv, or .txt for facility master data." }, 400);
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "contract-master-"));
      const filePath = path.join(tempDir, file.originalName);
      try {
        await fs.writeFile(filePath, file.buffer);
        const rows = ext === ".xlsx"
          ? await workbookRowsFromFile(filePath)
          : file.buffer.toString("utf8").split(/\r?\n/).filter(Boolean).map(splitCsvLine);
        const imported = facilityProfilesFromRows(rows);
        const settings = getAdminSettings();
        const existing = new Map((settings.facilityProfiles || [])
          .filter(profile => profile?.name && /[a-z]/i.test(profile.name))
          .map(profile => [canonicalNameKey(profile.name), profile]));
        for (const profile of imported) {
          const key = canonicalNameKey(profile.name);
          existing.set(key, {
            ...(existing.get(key) || {}),
            ...profile,
            legalName: firstUsefulValue(profile.legalName, existing.get(key)?.legalName),
            dba: firstUsefulValue(profile.dba, existing.get(key)?.dba),
            address: firstUsefulValue(profile.address, existing.get(key)?.address),
            aliases: mergeTextList(existing.get(key)?.aliases, profile.aliases, existing.get(key)?.name, profile.name, existing.get(key)?.legalName, profile.legalName, existing.get(key)?.dba, profile.dba, existing.get(key)?.address, profile.address)
              .filter(alias => /[a-z]/i.test(alias) && canonicalNameKey(alias) !== key)
          });
        }
        const weatherCoordinates = { ...(settings.weatherCoordinates || {}) };
        for (const profile of existing.values()) {
          if (profile.latitude && profile.longitude) weatherCoordinates[profile.name] = { latitude: profile.latitude, longitude: profile.longitude };
        }
        const cleanFacilityProfiles = [...existing.values()].map(profile => {
          const cityStateZip = profile.cityStateZip || "";
          const address = profile.address && cityStateZip && !normalizeMatchValue(profile.address).includes(normalizeMatchValue(cityStateZip))
            ? [profile.address, cityStateZip].filter(Boolean).join(", ")
            : profile.address || "";
          return {
            ...profile,
            address,
            aliases: mergeTextList(profile.aliases, profile.commonName, profile.legalName, profile.dba, profile.address, profile.street, profile.cityStateZip, profile.county)
              .filter(alias => /[a-z]/i.test(alias) && canonicalNameKey(alias) !== canonicalNameKey(profile.name))
          };
        });
        const next = saveAdminSettings({ ...settings, facilityProfiles: cleanFacilityProfiles, weatherCoordinates });
        return sendJson(res, { imported: imported.length, facilityProfiles: next.facilityProfiles }, 201);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    }

    if (url.pathname === "/api/upload-census" && req.method === "POST") {
      const body = await readRawBody(req);
      const { file } = parseMultipartForm(body, req.headers["content-type"]);
      if (!file || !file.buffer.length) return sendJson(res, { error: "Choose the weekly census Excel file." }, 400);
      if (file.buffer.length > maxUploadBytes) return sendJson(res, { error: `File is too large. Limit is ${Math.round(maxUploadBytes / 1024 / 1024)}MB.` }, 413);
      const ext = path.extname(file.originalName).toLowerCase();
      if (![".xlsx", ".csv"].includes(ext)) return sendJson(res, { error: "Use .xlsx or .csv for census data." }, 400);
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "contract-census-"));
      const filePath = path.join(tempDir, file.originalName);
      try {
        await fs.writeFile(filePath, file.buffer);
        const rows = ext === ".xlsx"
          ? await workbookRowsFromFile(filePath, "Census - Weekly")
          : file.buffer.toString("utf8").split(/\r?\n/).filter(Boolean).map(splitCsvLine);
        const settings = getAdminSettings();
        const profiles = Array.isArray(settings.facilityProfiles) ? settings.facilityProfiles : [];
        const { updates, unmatched } = censusUpdatesFromRows(rows, profiles, file.originalName);
        if (!updates.length) return sendJson(res, { error: "No census rows matched the facility master. Expected Facility, Month, Date, and Census columns." }, 400);
        const updateMap = new Map(updates.map(update => [canonicalNameKey(update.name), update]));
        const nextProfiles = profiles.map(profile => ({
          ...profile,
          ...(updateMap.get(canonicalNameKey(profile.name)) || {})
        }));
        const next = saveAdminSettings({ ...settings, facilityProfiles: nextProfiles });
        logAudit("census_workbook_imported", "facility", file.originalName, { updated: updates.length, unmatched });
        return sendJson(res, {
          updated: updates.length,
          unmatchedCount: unmatched.length,
          unmatched,
          censusAsOf: updates.map(update => update.censusAsOf).sort().at(-1) || "",
          facilityProfiles: next.facilityProfiles
        }, 201);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    }

    if (url.pathname === "/api/upload-vendor-master" && req.method === "POST") {
      const body = await readRawBody(req);
      const { file } = parseMultipartForm(body, req.headers["content-type"]);
      if (!file || !file.buffer.length) return sendJson(res, { error: "Choose an Excel or CSV file with vendor data." }, 400);
      if (file.buffer.length > maxUploadBytes) return sendJson(res, { error: `File is too large. Limit is ${Math.round(maxUploadBytes / 1024 / 1024)}MB.` }, 413);
      const ext = path.extname(file.originalName).toLowerCase();
      if (![".xlsx", ".csv", ".txt"].includes(ext)) return sendJson(res, { error: "Use .xlsx, .csv, or .txt for vendor master data." }, 400);
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "contract-master-"));
      const filePath = path.join(tempDir, file.originalName);
      try {
        await fs.writeFile(filePath, file.buffer);
        const rows = ext === ".xlsx"
          ? await workbookRowsFromFile(filePath)
          : file.buffer.toString("utf8").split(/\r?\n/).filter(Boolean).map(splitCsvLine);
        const imported = vendorProfilesFromRows(rows);
        for (const profile of imported) {
          const existing = findVendorProfileByName(profile.name);
          saveVendorProfile({
            ...(existing || {}),
            ...profile,
            id: existing?.id || vendorProfileId(profile.name),
            services: mergeTextListCanonical(existing?.services, profile.services, existing?.category, profile.category),
            facilitiesServed: mergeTextListCanonical(existing?.facilitiesServed, profile.facilitiesServed),
            aliases: mergeTextListCanonical(existing?.aliases, profile.aliases, existing?.name, profile.name, existing?.legalName, profile.legalName, existing?.dba, profile.dba)
              .filter(alias => /[a-z]/i.test(alias) && canonicalNameKey(alias) !== canonicalNameKey(profile.name)),
            updatedAt: new Date().toISOString(),
            createdAt: existing?.createdAt || new Date().toISOString()
          });
        }
        const importedServices = serviceNamesFromRows(rows);
        const importedAccounts = utilityAccountsFromRows(rows);
        for (const account of importedAccounts) {
          saveUtilityAccount(account);
        }
        const settings = getAdminSettings();
        const categories = mergeTextListCanonical(settings.categories, importedServices);
        saveAdminSettings({ ...settings, categories });
        return sendJson(res, {
          imported: imported.length,
          vendorsSaved: listVendorProfiles().length,
          utilityAccountsImported: importedAccounts.length,
          servicesImported: importedServices.length,
          categoriesSaved: categories.length,
          sampleVendors: imported.slice(0, 10).map(vendor => vendor.name),
          sampleServices: importedServices.slice(0, 20)
        }, 201);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    }

    if (url.pathname === "/api/ocr-jobs" && req.method === "GET") {
      return sendJson(res, listOcrJobs({
        full: url.searchParams.get("full") === "1",
        limit: url.searchParams.get("limit") || 0,
        page: url.searchParams.get("page") || 0,
        pageSize: url.searchParams.get("pageSize") || 0,
        lean: url.searchParams.get("lean") === "1"
      }));
    }

    const ocrQueueMatch = url.pathname.match(/^\/api\/ocr-jobs\/([^/]+)\/queue$/);
    if (ocrQueueMatch && req.method === "POST") {
      const jobId = decodeURIComponent(ocrQueueMatch[1]);
      const job = getOcrJob(jobId);
      if (!job) return sendJson(res, { error: "OCR job not found" }, 404);
      if (activeOcrJobs.has(jobId)) return sendJson(res, job, 202);
      return sendJson(res, enqueueServerOcrJob(jobId), 202);
    }

    const ocrRunMatch = url.pathname.match(/^\/api\/ocr-jobs\/([^/]+)\/run$/);
    if (ocrRunMatch && req.method === "POST") {
      const jobId = decodeURIComponent(ocrRunMatch[1]);
      if (activeOcrJobs.has(jobId)) {
        const runningJob = getOcrJob(jobId);
        return sendJson(res, runningJob || { id: jobId, status: "Processing", progress: { message: "OCR is already running for this contract." } }, 202);
      }
      const job = getOcrJob(jobId);
      if (!job) return sendJson(res, { error: "OCR job not found" }, 404);
      const contract = getContract(job.contractId);
      const recoveredFilePath = await recoverOcrLocalFilePath(job, contract);
      if (recoveredFilePath && recoveredFilePath !== job.localFilePath) {
        job.localFilePath = recoveredFilePath;
        if (contract && !contract.localFilePath) {
          contract.localFilePath = recoveredFilePath;
          contract.updatedAt = new Date().toISOString();
          saveContract(contract);
        }
        saveOcrJob(job);
      }
      if (!job.localFilePath || !await fileExists(cleanStoredFilePath(job.localFilePath))) {
        job.status = "Waiting for local file";
        job.error = "OCR cannot find the uploaded file. Upload the PDF/Word file again or use a ShareSync file path that exists on this server.";
        job.updatedAt = new Date().toISOString();
        saveOcrJob(job);
        return sendJson(res, { ...job, error: job.error }, 400);
      }
      job.status = "Processing";
      job.progress = {
        stage: "starting",
        message: "Starting OCR..."
      };
      job.updatedAt = new Date().toISOString();
      saveOcrJob(job);
      activeOcrJobs.add(jobId);
      try {
        const updateProgress = async progress => {
          job.status = "Processing";
          job.progress = {
            ...(job.progress || {}),
            ...(progress || {}),
            updatedAt: new Date().toISOString()
          };
          job.updatedAt = new Date().toISOString();
          saveOcrJob(job);
        };
        const text = await extractText(cleanStoredFilePath(job.localFilePath), updateProgress);
        const extraction = extractContractFields(text, contract || {});
        const aiFallback = aiFallbackAssessment(extraction.fields || [], text);
        let aiExtraction = {
          enabled: false,
          status: "skipped",
          provider: "rules-only",
          model: "",
          fallback: aiFallback,
          message: aiFallback.needed
            ? "AI fallback is available but was not run."
            : "OCR/rules found enough key data; local AI fallback skipped to keep the app fast."
        };
        if (aiExtractionEnabled && (!aiFallbackOnly || aiFallback.needed)) {
          await updateProgress({
            stage: "ai-fallback",
            message: aiFallback.needed
              ? `OCR finished. Local AI is checking missing fields: ${aiFallback.missing.join(", ")}.`
              : "OCR finished. Local AI is checking the extraction."
          });
          aiExtraction = await runAiExtraction(text, { ...(contract || {}), missingFields: aiFallback.missing, fallbackMode: aiFallback.mode }, extraction).catch(error => ({
            enabled: true,
            status: "failed",
            provider: process.env.OPENAI_API_KEY ? "openai" : "ollama",
            model: process.env.OPENAI_API_KEY ? openAiModel : ollamaModel,
            fallback: aiFallback,
            message: error.message
          }));
          aiExtraction.fallback = aiFallback;
        }
        const aiResult = aiExtraction.result || {};
        const aiFields = [...(aiResult.fields || []), ...(aiResult.category_fields || [])]
          .filter(field => {
            const label = canonicalContractKeyLabel(field?.label || "").toLowerCase();
            if (!["category", "contract type"].includes(label)) return true;
            return categorySupportedByContractText(field?.value || "", text);
          });
        const mergedFields = mergeExtractedFields(extraction.fields, aiFields, text);
        const learnedFields = applyLearningRules(mergedFields, text);
        const smartMatch = enrichFieldsWithUtilityAccount(learnedFields, text);
        smartMatch.fields = safeExtractedFields(smartMatch.fields, cleanOcrText(text));
        const mergedClauses = [...(extraction.clauses || []), ...(aiResult.clauses || [])];
        const mergedFeeLines = [...(extraction.feeLines || []), ...(aiResult.fee_lines || aiResult.feeLines || [])].map(line => ({
          service: String(line.service || line.description || line.label || "Fee"),
          unit: String(line.unit || ""),
          rate: String(line.rate || line.value || line.amount || ""),
          frequency: String(line.frequency || ""),
          source: String(line.source || line.source_snippet || line.snippet || "OCR/AI"),
          approved: Boolean(line.approved)
        })).filter(line => line.rate && isPricingContext(line.source || `${line.service} ${line.rate}`));
        const aiAgentReview = extractionAgentReview(smartMatch.fields, aiExtraction, mergedFeeLines, text);
        job.status = "Complete";
        job.extractedText = text;
        job.extractedTextPreview = text.slice(0, 1200);
        job.extractedFields = smartMatch.fields;
        job.extractedClauses = mergedClauses;
        job.extractedFeeLines = mergedFeeLines;
        job.utilityAccountMatch = smartMatch.match;
        job.aiExtraction = aiExtraction;
        job.aiAgentReview = aiAgentReview;
        job.reviewStatus = aiAgentReview.status;
        job.completedAt = new Date().toISOString();
        job.progress = {
          stage: "complete",
          message: aiAgentReview.message,
          updatedAt: new Date().toISOString()
        };
        delete job.error;
        if (contract) {
          const extractedContractName = fieldValue(smartMatch.fields, "Contract Name") || fieldValue(smartMatch.fields, "Title");
          const extractedVendor = fieldValue(smartMatch.fields, "Vendor");
          const extractedFacility = fieldValue(smartMatch.fields, "Facility");
          const extractedCategory = fieldValue(smartMatch.fields, "Category") || fieldValue(smartMatch.fields, "Contract Type");
          if (shouldReplaceIntakeName(contract.name, extractedContractName)) {
            contract.name = cleanContractDisplayName(extractedContractName);
            job.name = contract.name;
          }
          const docType = contract.documentType && contract.documentType !== "Contract"
            ? contract.documentType
            : relatedDocumentType(contract.name || contract.uploadedFileName, text);
          const isRelatedDocument = Boolean(contract.documentType && contract.documentType !== "Contract") || isRelatedContractDocument(contract.name || contract.uploadedFileName, text);
          let parentMatch = null;
          if (isRelatedDocument) {
            parentMatch = findParentContractForRelatedDocument({
              ...contract,
              vendor: extractedVendor || contract.vendor,
              facility: extractedFacility || contract.facility,
              category: extractedCategory || contract.category,
              documentType: docType
            }, text);
          }
          contract.documentType = isRelatedDocument ? docType : (contract.documentType || "Contract");
          contract.reviewStatus = isRelatedDocument
            ? parentMatch ? `${docType} - Linked to Parent` : `${docType} - Needs Parent Match`
            : aiAgentReview.status;
          contract.status = isRelatedDocument
            ? "Needs Review"
            : aiAgentReview.status === "AI Reviewed"
              ? "AI Reviewed"
              : "Needs Review";
          contract.ocrTextPreview = job.extractedTextPreview;
          contract.ocrText = extraction.text;
          contract.extractedFields = smartMatch.fields;
          contract.extractedClauses = mergedClauses;
          contract.extractedFeeLines = mergedFeeLines;
          contract.utilityAccountMatch = smartMatch.match;
          contract.aiExtraction = aiExtraction;
          contract.aiAgentReview = aiAgentReview;
          if (!isRelatedDocument && aiAgentAutoSave && aiAgentReview.status === "AI Reviewed") {
            autoSaveAiReviewedContract(contract, smartMatch.fields, mergedFeeLines, aiAgentReview);
            job.reviewStatus = "AI Reviewed";
            job.progress.message = "AI agent reviewed and saved this contract automatically.";
          } else if (!isRelatedDocument && aiAgentReview.status === "AI Reviewed") {
            contract.reviewStatus = "AI Drafted";
            contract.status = "Needs Review";
            job.reviewStatus = "AI Drafted";
            job.progress.message = "AI found strong draft fields. Human review is still required before approval.";
          }
          if (isRelatedDocument && parentMatch) {
            contract.parentContractId = parentMatch.parent.id;
            contract.parentContractName = parentMatch.parent.name;
            contract.relatedMatchConfidence = parentMatch.score;
            contract.relatedMatchReasons = parentMatch.reasons;
            job.relatedDocument = {
              detected: true,
              type: docType,
              parentContractId: parentMatch.parent.id,
              parentContractName: parentMatch.parent.name,
              matchConfidence: parentMatch.score,
              matchReasons: parentMatch.reasons
            };
          } else if (isRelatedDocument) {
            job.relatedDocument = {
              detected: true,
              type: docType,
              parentContractId: "",
              parentContractName: "",
              matchConfidence: 0,
              matchReasons: []
            };
          }
          contract.updatedAt = new Date().toISOString();
          saveContract(contract);
          if (isRelatedDocument && parentMatch) {
            attachRelatedDocument(parentMatch.parent, contract, job, text, parentMatch);
          }
        }
        saveOcrJob(job);
        return sendJson(res, job);
      } catch (error) {
        job.status = "Failed";
        job.error = error.message;
        job.progress = {
          ...(job.progress || {}),
          stage: "failed",
          message: error.message || "OCR failed.",
          updatedAt: new Date().toISOString()
        };
        job.updatedAt = new Date().toISOString();
        saveOcrJob(job);
        return sendJson(res, job, 500);
      } finally {
        activeOcrJobs.delete(jobId);
      }
    }

    if (url.pathname === "/api/alerts" && req.method === "GET") {
      return sendJson(res, lifecycleAlerts());
    }

    if (url.pathname === "/api/alerts/send" && req.method === "POST") {
      const body = await readBody(req).catch(() => ({}));
      return sendJson(res, await sendLifecycleAlerts({ dryRun: Boolean(body.dryRun) }));
    }

    return serveStatic(req, res);
  } catch (error) {
    const status = Number(error?.status || 500);
    return sendJson(res, { error: error.message || "Server error" }, status >= 400 && status < 600 ? status : 500);
  }
});

server.headersTimeout = Math.max(10000, Number(process.env.HEADERS_TIMEOUT_MS || 30000));
server.requestTimeout = Math.max(30000, Number(process.env.REQUEST_TIMEOUT_MS || 180000));
server.keepAliveTimeout = Math.max(1000, Number(process.env.KEEP_ALIVE_TIMEOUT_MS || 5000));
server.maxRequestsPerSocket = Math.max(1, Number(process.env.MAX_REQUESTS_PER_SOCKET || 1000));

server.listen(port, host, () => {
  console.log(`Contract app running at http://127.0.0.1:${port}/`);
  if (host === "0.0.0.0") {
    const urls = localNetworkUrls(port);
    if (urls.length) console.log(`Local network URL: ${urls.join(" or ")}`);
  }
  const resumed = ocrResumeOnStart ? resumePendingOcrJobs() : 0;
  if (resumed) console.log(`Resumed ${resumed} queued OCR job${resumed === 1 ? "" : "s"}.`);
});

db.exec(`CREATE TABLE IF NOT EXISTS renewal_email_deliveries (delivery_key TEXT PRIMARY KEY, sent_at TEXT NOT NULL)`);
let renewalEmailRunning = false;
let lastRenewalCheckDay = '';
async function checkRenewalEmailSchedule() {
  if (renewalEmailRunning) return;
  const today = new Date().toISOString().slice(0,10);
  if (lastRenewalCheckDay === today) return;
  renewalEmailRunning = true;
  try {
    const settings = getAdminSettings();
    const config = reminderSettings(settings);
    if (!config.enabled || !smtpConfigurationStatus().configured) return;
    const items = reminderItems(lifecycleAlerts(allContractSummaries(), config.days), settings);
    for (const recipient of config.recipients) {
      const key = item => JSON.stringify([recipient, item.key]);
      const pending = recipientItems(items, settings, recipient).filter(item => !db.prepare('SELECT 1 FROM renewal_email_deliveries WHERE delivery_key = ?').get(key(item)));
      if (!pending.length) continue;
      const result = await sendSmtpMail({ to: recipient, subject: `Your facilities: ${pending.length} contracts need renewal review`, text: reminderText(pending), html:reminderHtml(pending) });
      if (!result.sent) throw new Error('Email provider did not accept the reminder.');
      const insert = db.prepare('INSERT OR IGNORE INTO renewal_email_deliveries VALUES (?, ?)');
      for (const item of pending) insert.run(key(item), new Date().toISOString());
      logAudit('renewal_email_sent', 'email', recipient, { count: pending.length });
    }
    lastRenewalCheckDay = today;
  } catch (error) {
    logAudit('renewal_email_failed', 'email', 'scheduler', { error: error.message });
  } finally { renewalEmailRunning = false; }
}
setInterval(checkRenewalEmailSchedule, 60000).unref();
