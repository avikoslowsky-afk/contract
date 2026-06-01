import http from "node:http";
import { execFile } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

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

const port = Number(process.env.PORT || 4180);
const host = process.env.HOST || "127.0.0.1";
const execFileAsync = promisify(execFile);
const sessions = new Map();
const sessionMaxAgeSeconds = 60 * 60 * 10;
const adminUser = process.env.ADMIN_USER || "";
const adminPassword = process.env.ADMIN_PASSWORD || "";
const loginRequired = String(process.env.REQUIRE_LOGIN || "false").toLowerCase() === "true";

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

const tesseractCandidates = [
  process.env.TESSERACT_PATH,
  "/opt/homebrew/bin/tesseract",
  "/usr/local/bin/tesseract",
  path.join(os.homedir(), "AppData", "Local", "Programs", "Tesseract-OCR", "tesseract.exe")
].filter(Boolean);
const pdftoppmCandidates = [
  process.env.PDFTOPPM_PATH,
  "/opt/homebrew/bin/pdftoppm",
  "/usr/local/bin/pdftoppm"
].filter(Boolean);
const pdfinfoCandidates = [
  process.env.PDFINFO_PATH,
  "/opt/homebrew/bin/pdfinfo",
  "/usr/local/bin/pdfinfo"
].filter(Boolean);
const pdftotextCandidates = [
  process.env.PDFTOTEXT_PATH,
  "/opt/homebrew/bin/pdftotext",
  "/usr/local/bin/pdftotext"
].filter(Boolean);
const pythonCandidates = [
  process.env.PYTHON_PATH,
  "/Library/Frameworks/Python.framework/Versions/3.14/bin/python3",
  "/opt/homebrew/bin/python3",
  "/usr/bin/python3"
].filter(Boolean);
const maxPdfPages = Math.max(1, Number(process.env.OCR_MAX_PDF_PAGES || 25));
const maxUploadBytes = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 50)) * 1024 * 1024;
const pdfRenderScript = path.join(__dirname, "scripts", "render_pdf_pages.py");
const openAiModel = process.env.OPENAI_MODEL || "gpt-5.2";
const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const ollamaModel = process.env.OLLAMA_MODEL || "llama3.1";
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
    CREATE INDEX IF NOT EXISTS idx_contracts_search ON contracts(name, facility, vendor, category, status);
    CREATE INDEX IF NOT EXISTS idx_ocr_jobs_contract ON ocr_jobs(contract_id);
    CREATE INDEX IF NOT EXISTS idx_utility_accounts_match ON utility_accounts(account_number, meter_number, facility, vendor);
    CREATE INDEX IF NOT EXISTS idx_vendor_profiles_name ON vendor_profiles(name);
    CREATE INDEX IF NOT EXISTS idx_invoices_match ON invoices(vendor, facility, invoice_date, status);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username, status, role);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, due, owner);
  `);
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
  if (!passwordHash || !passwordSalt) throw new Error("Password is required for a new user.");
  const user = {
    ...(existing || {}),
    id: existing?.id || `USR-${Date.now()}`,
    username,
    fullName: String(body.fullName || existing?.fullName || "").trim(),
    role: String(body.role || existing?.role || "Read Only").trim(),
    facility: String(body.facility || existing?.facility || "All").trim(),
    status: String(body.status || existing?.status || "Active").trim(),
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
      "Dialysis / Patient Transfer", "Healthcare Services", "Lab / Diagnostics",
      "Electric", "Gas", "Water/Sewer", "Oxygen", "Medical Gas", "Waste Removal",
      "Laundry", "Pest Control", "Maintenance", "Elevator", "HVAC", "IT/Software",
      "Internet/Telecom", "Insurance", "Staffing", "Therapy", "Pharmacy",
      "Transportation", "Food/Dietary", "Medical Supplies", "Legal/Compliance", "Other"
    ],
    facilityProfiles: [],
    weatherCoordinates: {},
    roles: [
      { role: "Admin", canView: "All", canEdit: "All", canApprove: "Yes", admin: "Yes" },
      { role: "Contract Department", canView: "All", canEdit: "All metadata", canApprove: "Yes", admin: "No" },
      { role: "Facility User", canView: "Assigned facility", canEdit: "Notes/tasks", canApprove: "No", admin: "No" },
      { role: "Read Only", canView: "Allowed records", canEdit: "No", canApprove: "No", admin: "No" }
    ]
  };
}

function getAdminSettings() {
  const row = db.prepare("SELECT data FROM app_settings WHERE key = ?").get("admin");
  return { ...defaultAdminSettings(), ...(row ? rowToRecord(row) : {}) };
}

function saveAdminSettings(settings = {}) {
  const current = getAdminSettings();
  const next = {
    ...current,
    ...settings,
    categories: Array.isArray(settings.categories) ? settings.categories.filter(Boolean) : current.categories,
    facilityProfiles: Array.isArray(settings.facilityProfiles) ? settings.facilityProfiles.filter(item => item?.name) : current.facilityProfiles,
    roles: Array.isArray(settings.roles) ? settings.roles.filter(item => item?.role) : current.roles,
    weatherCoordinates: settings.weatherCoordinates && typeof settings.weatherCoordinates === "object" ? settings.weatherCoordinates : current.weatherCoordinates,
    updatedAt: new Date().toISOString()
  };
  db.prepare(`
    INSERT INTO app_settings (key, data, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run("admin", JSON.stringify(next), next.updatedAt);
  logAudit("admin_settings_saved", "settings", "admin", { updatedAt: next.updatedAt });
  return next;
}

function saveContract(contract) {
  db.prepare(`
    INSERT INTO contracts (
      id, name, facility, vendor, category, status, review_status, risk, owner,
      share_sync_url, local_file_path, ocr_text_preview, created_at, updated_at, data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      data = excluded.data
  `).run(...contractColumns(contract));
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

function listOcrJobs() {
  return db.prepare("SELECT data FROM ocr_jobs ORDER BY created_at DESC, id DESC").all().map(rowToRecord);
}

function listUtilityAccounts() {
  return db.prepare("SELECT data FROM utility_accounts ORDER BY facility, vendor, account_number").all().map(rowToRecord);
}

function listVendorProfiles() {
  return db.prepare("SELECT data FROM vendor_profiles ORDER BY name").all().map(rowToRecord);
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

function listContracts({ q = "", page = 1, pageSize = 25 } = {}) {
  const query = `%${String(q || "").toLowerCase().trim()}%`;
  const hasQuery = query !== "%%";
  const where = hasQuery
    ? `WHERE lower(name || ' ' || facility || ' ' || vendor || ' ' || category || ' ' || status || ' ' || data) LIKE ?`
    : "";
  const total = hasQuery
    ? db.prepare(`SELECT COUNT(*) AS total FROM contracts ${where}`).get(query).total
    : db.prepare("SELECT COUNT(*) AS total FROM contracts").get().total;
  const offset = (page - 1) * pageSize;
  const rows = hasQuery
    ? db.prepare(`SELECT data FROM contracts ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(query, pageSize, offset)
    : db.prepare("SELECT data FROM contracts ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?").all(pageSize, offset);
  return { total, page, pageSize, records: rows.map(rowToRecord) };
}

async function deleteContract(id) {
  const contract = getContract(id);
  if (!contract) return null;
  const jobs = getOcrJobsForContract(id);
  const files = new Set([contract.localFilePath, ...jobs.map(job => job.localFilePath)].filter(Boolean));
  db.prepare("DELETE FROM ocr_jobs WHERE contract_id = ?").run(id);
  db.prepare("DELETE FROM contracts WHERE id = ?").run(id);
  for (const file of files) {
    const filePath = path.resolve(file);
    if (isPathInside(uploadsDir, filePath)) {
      await fs.unlink(filePath).catch(() => {});
    }
  }
  return { contract, deletedJobs: jobs.length, deletedFiles: files.size };
}

function allContracts() {
  return db.prepare("SELECT data FROM contracts ORDER BY created_at DESC, id DESC").all().map(rowToRecord);
}

function moneyToNumber(value) {
  const text = String(value || "").replace(/[$,\s]/g, "");
  const multiplier = text.includes("M") ? 1000000 : text.includes("K") ? 1000 : 1;
  return Number(text.replace(/[MK]/g, "")) * multiplier || 0;
}

function formatMoney(value) {
  if (!value) return "$0";
  if (value >= 1000000) return `$${(value / 1000000).toFixed(value % 1000000 ? 1 : 0)}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}K`;
  return `$${Math.round(value).toLocaleString()}`;
}

function daysUntil(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

function dashboardSummary(records = allContracts()) {
  const active = records.filter(contract => contract.status === "Active").length;
  const expiring90 = records.filter(contract => {
    const days = daysUntil(contract.end || contract.renewal);
    return days !== null && days >= 0 && days <= 90;
  }).length;
  const missingInsurance = records.filter(contract => {
    const text = `${contract.category || ""} ${contract.insurance || ""} ${contract.insuranceStatus || ""}`.toLowerCase();
    return text.includes("missing") || text.includes("expired");
  }).length;
  const annualSpend = records.reduce((sum, contract) => sum + moneyToNumber(contract.spend), 0);
  const highRisk = records.filter(contract => ["Critical", "High", "High Risk"].includes(contract.risk) || contract.status === "High Risk").length;
  const needsReview = records.filter(contract => String(contract.status || "").includes("Review") || String(contract.reviewStatus || "").includes("Pending")).length;
  return {
    activeContracts: active,
    totalContracts: records.length,
    expiring90,
    missingInsurance,
    annualSpend,
    annualSpendLabel: formatMoney(annualSpend),
    criticalActions: highRisk + needsReview,
    potentialSavings: 0,
    potentialSavingsLabel: "$0",
    sourceProofPercent: records.length ? Math.round(records.filter(contract => contract.ocrTextPreview).length / records.length * 100) : 0
  };
}

function facilitySummaries(records = allContracts()) {
  const byFacility = new Map();
  for (const profile of getAdminSettings().facilityProfiles || []) {
    const name = profile.name || "Needs Classification";
    byFacility.set(name, {
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
    if (!byFacility.has(name)) {
      byFacility.set(name, { name, region: contract.region || "", beds: Number(contract.beds || 0), contracts: 0, spendValue: 0, risk: 0, compliance: 0, renewals: 0, missing: [] });
    }
    const row = byFacility.get(name);
    row.contracts += 1;
    row.spendValue += moneyToNumber(contract.spend);
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
  for (const profile of listVendorProfiles()) {
    const name = profile.name || "Needs Classification";
    byVendor.set(name, {
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
    const name = account.vendor || "Needs Classification";
    if (!byVendor.has(name)) {
      byVendor.set(name, { name, facilitiesSet: new Set(), contracts: 0, spendValue: 0, insurance: "Unknown", issues: "None", category: account.utilityType || "", mailingAddress: "", serviceAddresses: new Set(), phone: "", email: "" });
    }
    const row = byVendor.get(name);
    if (account.facility) row.facilitiesSet.add(account.facility);
    if (!row.category && account.utilityType) row.category = account.utilityType;
    if (!row.mailingAddress) row.mailingAddress = account.vendorMailingAddress || account.vendorAddress || account.mailingAddress || "";
    if (!row.phone) row.phone = account.vendorPhone || account.phone || "";
    if (!row.email) row.email = account.vendorEmail || account.email || "";
    if (account.serviceAddress) row.serviceAddresses.add(account.serviceAddress);
  }
  for (const contract of records) {
    const name = contract.vendor || "Needs Classification";
    if (!byVendor.has(name)) {
      byVendor.set(name, { name, facilitiesSet: new Set(), contracts: 0, spendValue: 0, insurance: "Unknown", issues: "None", category: contract.category || "", mailingAddress: "", serviceAddresses: new Set(), phone: "", email: "" });
    }
    const row = byVendor.get(name);
    row.contracts += 1;
    row.facilitiesSet.add(contract.facility || "Needs Classification");
    row.spendValue += moneyToNumber(contract.spend);
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
    serviceAddresses: [...row.serviceAddresses]
  }));
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
    row.spendValue += moneyToNumber(contract.spend);
    const days = daysUntil(contract.end || contract.renewal);
    if (days !== null && days >= 0 && days <= 90) row.expiring90 += 1;
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
    .replace(/^--- Page \d+ ---$/gm, "")
    .replace(/\[PDF rendered with [^\]]+\]\.?/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function snippetAround(text, index, length = 180) {
  if (index < 0) return "";
  const start = Math.max(0, index - 70);
  return text.slice(start, start + length).replace(/\s+/g, " ").trim();
}

function extractedField(label, value, confidence, source, snippet = "") {
  return { label, value, confidence, source, snippet, approved: false };
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return { match, value: (match[1] || match[0]).trim(), index: match.index || 0 };
  }
  return null;
}

function cleanPartyName(value) {
  return String(value || "")
    .replace(/\bWeliness\b/gi, "Wellness")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*$/, "")
    .trim();
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
    .find(line => line.length >= 6 && !/^page\s+\d+/i.test(line)) || "";
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
  const title = firstMeaningfulLine(clean);
  const lower = text.toLowerCase();
  const titleLower = title.toLowerCase();
  const purpose = inferPurpose(clean);
  const categories = [
    { name: "Dialysis / Patient Transfer", terms: ["dialysis transfer agreement", "dialysis center", "patient transfer", "transfer of a patient", "nursing facility", "continuity of the care"], titleBoost: 60 },
    { name: "Healthcare Services", terms: ["health care", "healthcare", "patient care", "medical director", "clinical services", "treatment of patients"], titleBoost: 50 },
    { name: "Lab / Diagnostics", terms: ["laboratory", "lab services", "diagnostic", "diagnostics", "specimen", "phlebotomy", "blood draw", "clinical lab", "ppd", "per patient day"], titleBoost: 55 },
    { name: "Oxygen", terms: ["oxygen", "medical gas"], titleBoost: 50 },
    { name: "Electric", terms: ["electric", "kwh", "power supply", "utility account"], titleBoost: 50 },
    { name: "Gas", terms: ["natural gas", "therm"], titleBoost: 50 },
    { name: "Laundry", terms: ["laundry", "linen"], titleBoost: 50 },
    { name: "Medical Supplies", terms: ["medical supplies", "medical supply", "supplies service"], titleBoost: 45 },
    { name: "Waste Removal", terms: ["waste", "trash", "refuse"], titleBoost: 45 },
    { name: "Pharmacy", terms: ["pharmacy", "medication"], titleBoost: 45 },
    { name: "Insurance", terms: ["insurance policy", "certificate of insurance", "insurance coverage agreement", "liability coverage"], titleBoost: 45 },
    { name: "Maintenance", terms: ["maintenance", "repair"], titleBoost: 40 },
    { name: "HVAC", terms: ["hvac", "heating", "cooling"], titleBoost: 40 }
  ];
  const scored = categories.map(category => {
    const matches = category.terms.filter(term => lower.includes(term));
    const titleMatches = category.terms.filter(term => titleLower.includes(term));
    const score = matches.length * 20 + titleMatches.length * category.titleBoost;
    return { ...category, matches, titleMatches, score };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ? scored[0] : null;
  const agreementType = /agreement/i.test(title) ? title : title ? `${title} Agreement` : "";
  const reason = best
    ? `${best.titleMatches.length ? "title" : "full contract"} matched: ${(best.titleMatches.length ? best.titleMatches : best.matches).join(", ")}`
    : "";
  return {
    title,
    agreementType,
    purpose,
    category: best?.name || "",
    categoryReason: reason
  };
}

function inferCategory(text) {
  return inferContractUnderstanding(text).category;
}

function extractContractFields(text, hints = {}) {
  const clean = cleanOcrText(text);
  const fields = [];
  const clauses = [];
  const understanding = inferContractUnderstanding(clean);
  const vendor = firstMatch(clean, [
    /between\s+([\s\S]{2,160}?)\s*,?\s+located\s+at\s+[\s\S]{2,220}?\(herein\s+called\s+Dialysis Center\)/i,
    /vendor\s*[:\-.]\s*([^\n\r]+)/i,
    /supplier\s*[:\-.]\s*([^\n\r]+)/i,
    /provider\s*[:\-.]\s*([^\n\r]+)/i,
    /between\s+(.+?)\s+and\s+/i
  ]);
  const facility = firstMatch(clean, [
    /([A-Z][A-Za-z0-9 &.'-]+?)\s+located\s+at\s+[^()\n\r]+\(herein\s+called\s+Nursing Facility\)/i,
    /facility\s*[:\-\.]\s*([^\n\r]+)/i,
    /customer\s*[:\-]\s*([^\n\r]+)/i,
    /client\s*[:\-]\s*([^\n\r]+)/i,
    /and\s+(.+?)(?:\.|\n|\r)/i
  ]);
  const vendorAddress = firstMatch(clean, [
    /between\s+[\s\S]{2,160}?\s*,?\s+located\s+at\s+([\s\S]{8,180}?)(?:\s*\(herein\s+called\s+Dialysis Center\)|\s+and\s+[A-Z]|\n|\r)/i,
    /vendor\s+(?:mailing\s+)?address\s*[:\-\.]\s*([^\n\r]{8,180})/i,
    /remit(?:tance)?\s+(?:to\s+)?address\s*[:\-\.]\s*([^\n\r]{8,180})/i,
    /notice(?:s)?\s+(?:to\s+vendor|address)\s*[:\-\.]\s*([^\n\r]{8,180})/i
  ]);
  const vendorEmail = firstMatch(clean, [
    /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i
  ]);
  const vendorPhone = firstMatch(clean, [
    /(?:vendor\s+)?(?:phone|telephone|tel\.?|contact)\s*[:\-\.]\s*(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/i,
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
    /(?:effective date|start date|begins?|commence(?:s|ment)?)\s*(?:is|on|:)?\s*([A-Z][a-z]+ \d{1,2}, \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i
  ]);
  const endDate = firstMatch(clean, [
    /(?:end date|expiration date|expires?|ends?|through)\s*(?:is|on|:)?\s*([A-Z][a-z]+ \d{1,2}, \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i
  ]);
  const notice = firstMatch(clean, [
    /(\d{1,3}\s*(?:day|days)[^.\n\r]{0,80}(?:notice|prior written notice))/i,
    /((?:ninety|sixty|thirty|one hundred twenty)\s*\(?\d{0,3}\)?\s*days?[^.\n\r]{0,80}(?:notice|prior written notice))/i
  ]);
  const payment = firstMatch(clean, [
    /(net\s*\d{1,3})/i,
    /payment terms?\s*[:\-]?\s*([^\n\r.]+)/i
  ]);
  const insurance = firstMatch(clean, [
    /(?:insurance|liability)[^$]{0,120}(\$[\d,]+(?:\.\d+)?(?:\s*(?:million|m))?)/i,
    /(\$[\d,]+(?:\.\d+)?(?:\s*(?:million|m))?[^.\n\r]{0,80}(?:liability|insurance))/i
  ]);
  const rate = firstMatch(clean, [
    /(?:service\s+rate|unit\s+rate|contract\s+rate|rate|fee|price|charge)\s*(?:is|:|\-)?\s*(\$[\d,]+(?:\.\d+)?(?:\s*(?:per|\/)\s*\w+)?)/i,
    /(\$[\d,]+(?:\.\d+)?\s*(?:per|\/)\s*[A-Za-z]+)/i
  ]);
  const ppdRate = firstMatch(clean, [
    /(?:ppd|per\s+patient\s+day)\s*(?:rate|price|fee|charge)?\s*(?:is|:|\-)?\s*(\$[\d,]+(?:\.\d+)?)/i,
    /(\$[\d,]+(?:\.\d+)?)\s*(?:\/|\s+per\s+)?(?:ppd|patient\s+day|per\s+patient\s+day)/i
  ]);
  const labTestPricing = firstMatch(clean, [
    /(?:lab(?:oratory)?\s+test(?:ing)?|diagnostic\s+test(?:ing)?|test\s+pricing|fee\s+schedule)\s*[:\-]?\s*([^\n\r]{8,220})/i,
    /(?:cbc|bmp|cmp|pt\/inr|urinalysis|culture|x-ray|diagnostic)[^.\n\r]{0,120}(\$[\d,]+(?:\.\d+)?)/i
  ]);
  const specimenPickup = firstMatch(clean, [
    /(?:specimen|sample)\s+(?:pickup|pick-up|collection)[^.\n\r]{0,180}/i,
    /(?:courier|phlebotomy|blood\s+draw)[^.\n\r]{0,180}/i
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
  const autoRenewalIndex = clean.search(/auto(?:matic)?[-\s]?renew|renews automatically|successive .* term/i);
  const category = understanding.category || hints.category || "";

  if (understanding.title) fields.push(extractedField("Contract Name", understanding.title, 90, "Title found at top of contract", snippetAround(clean, 0, 220)));
  if (understanding.agreementType) fields.push(extractedField("Contract Type", understanding.agreementType, 88, "Type found from contract title", snippetAround(clean, 0, 220)));
  if (vendor?.value) fields.push(extractedField("Vendor", cleanPartyName(vendor.value), 78, "OCR text", snippetAround(clean, vendor.index)));
  if (vendorAddress?.value) fields.push(extractedField("Vendor Mailing Address", cleanAddress(vendorAddress.value), 74, "OCR text", snippetAround(clean, vendorAddress.index)));
  if (vendorPhone?.value) fields.push(extractedField("Vendor Phone", vendorPhone.value.replace(/\s+/g, " ").trim(), 72, "OCR text", snippetAround(clean, vendorPhone.index)));
  if (vendorEmail?.value) fields.push(extractedField("Vendor Email", vendorEmail.value.trim(), 82, "OCR text", snippetAround(clean, vendorEmail.index)));
  if (facility?.value) fields.push(extractedField("Facility", cleanPartyName(facility.value), 74, "OCR text", snippetAround(clean, facility.index)));
  if (accountNumber?.value) fields.push(extractedField("Account Number", accountNumber.value.replace(/\s+/g, " ").trim(), 78, "OCR text", snippetAround(clean, accountNumber.index)));
  if (meterNumber?.value) fields.push(extractedField("Meter Number", meterNumber.value.replace(/\s+/g, " ").trim(), 76, "OCR text", snippetAround(clean, meterNumber.index)));
  if (serviceAddress?.value) fields.push(extractedField("Service Address", cleanAddress(serviceAddress.value), 72, "OCR text", snippetAround(clean, serviceAddress.index)));
  if (category) fields.push(extractedField("Category", category, understanding.category ? 88 : 72, understanding.categoryReason ? `Why: ${understanding.categoryReason}` : "Keyword inference", ""));
  if (startDate?.value) fields.push(extractedField("Start Date", startDate.value, 76, "OCR text", snippetAround(clean, startDate.index)));
  if (endDate?.value) fields.push(extractedField("End Date", endDate.value, 76, "OCR text", snippetAround(clean, endDate.index)));
  if (notice?.value) fields.push(extractedField("Notice Period", notice.value, 82, "OCR text", snippetAround(clean, notice.index)));
  if (payment?.value) fields.push(extractedField("Payment Terms", payment.value, 82, "OCR text", snippetAround(clean, payment.index)));
  if (insurance?.value) fields.push(extractedField("Insurance Requirement", insurance.value, 70, "OCR text", snippetAround(clean, insurance.index)));
  if (rate?.value) fields.push(extractedField("Rate / Fee", rate.value, 68, "OCR text", snippetAround(clean, rate.index)));
  if (ppdRate?.value) fields.push(extractedField("PPD Rate", ppdRate.value, 84, "Lab pricing OCR", snippetAround(clean, ppdRate.index)));
  if (labTestPricing?.value) fields.push(extractedField("Lab Test Pricing", labTestPricing.value.replace(/\s+/g, " ").trim(), 72, "Lab pricing OCR", snippetAround(clean, labTestPricing.index)));
  if (specimenPickup?.value) fields.push(extractedField("Specimen Pickup / Phlebotomy", specimenPickup.value.replace(/\s+/g, " ").trim(), 70, "Lab operations OCR", snippetAround(clean, specimenPickup.index)));
  if (signer?.value) fields.push(extractedField("Signer", signer.value, 66, "OCR text", snippetAround(clean, signer.index)));
  if (signerTitle?.value) fields.push(extractedField("Signer Title", signerTitle.value, 62, "OCR text", snippetAround(clean, signerTitle.index)));
  if (signedDate?.value) fields.push(extractedField("Signed Date", signedDate.value, 68, "OCR text", snippetAround(clean, signedDate.index)));
  if (autoRenewalIndex >= 0) {
    fields.push(extractedField("Auto Renewal", "Yes", 76, "OCR text", snippetAround(clean, autoRenewalIndex)));
    clauses.push({ type: "Auto-renewal", snippet: snippetAround(clean, autoRenewalIndex, 260), risk: "Review", source: "OCR text" });
  }
  if (notice?.value) clauses.push({ type: "Termination notice", snippet: snippetAround(clean, notice.index, 260), risk: "Review", source: "OCR text" });
  if (insurance?.value) clauses.push({ type: "Insurance", snippet: snippetAround(clean, insurance.index, 260), risk: "Review", source: "OCR text" });

  return { fields, clauses, text: clean };
}

function fieldValue(fields, label) {
  return fields.find(field => field.label === label)?.value || "";
}

function updateVendorProfileFromContract(contract, fields = []) {
  const vendorName = contract.vendor && contract.vendor !== "Needs Classification" ? contract.vendor : fieldValue(fields, "Vendor");
  if (!vendorName || vendorName === "Needs Classification") return;
  const existing = listVendorProfiles().find(profile => normalizeMatchValue(profile.name) === normalizeMatchValue(vendorName));
  const now = new Date().toISOString();
  const mailingAddress = fieldValue(fields, "Vendor Mailing Address") || contract.vendorMailingAddress || contract.vendorAddress || contract.mailingAddress || "";
  const phone = fieldValue(fields, "Vendor Phone") || contract.vendorPhone || contract.phone || "";
  const email = fieldValue(fields, "Vendor Email") || contract.vendorEmail || contract.email || "";
  if (!mailingAddress && !phone && !email && existing) return;
  const profile = {
    ...(existing || {}),
    id: existing?.id || vendorProfileId(vendorName),
    name: existing?.name || vendorName,
    legalName: existing?.legalName || vendorName,
    category: existing?.category || contract.category || "",
    mailingAddress: existing?.mailingAddress || mailingAddress,
    phone: existing?.phone || phone,
    email: existing?.email || email,
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
  contract.vendor = fieldValue(approved, "Vendor") || contract.vendor;
  contract.facility = fieldValue(approved, "Facility") || contract.facility;
  contract.category = fieldValue(approved, "Category") || contract.category;
  contract.vendorMailingAddress = fieldValue(approved, "Vendor Mailing Address") || contract.vendorMailingAddress;
  contract.vendorAddress = contract.vendorMailingAddress || contract.vendorAddress;
  contract.vendorPhone = fieldValue(approved, "Vendor Phone") || contract.vendorPhone;
  contract.vendorEmail = fieldValue(approved, "Vendor Email") || contract.vendorEmail;
  contract.documentTitle = fieldValue(approved, "Contract Name") || fieldValue(approved, "Document Title") || contract.documentTitle;
  contract.agreementType = fieldValue(approved, "Contract Type") || fieldValue(approved, "Agreement Type") || contract.agreementType;
  contract.purposeScope = fieldValue(approved, "Purpose / Scope") || contract.purposeScope;
  contract.categoryReason = fieldValue(approved, "Category Reason") || approved.find(field => field.label === "Category")?.source?.replace(/^Why:\s*/i, "") || contract.categoryReason;
  contract.start = fieldValue(approved, "Start Date") || contract.start;
  contract.end = fieldValue(approved, "End Date") || contract.end;
  contract.renewal = fieldValue(approved, "Renewal Date") || contract.renewal;
  contract.paymentTerms = fieldValue(approved, "Payment Terms") || contract.paymentTerms;
  contract.insuranceRequirement = fieldValue(approved, "Insurance Requirement") || contract.insuranceRequirement;
  contract.rate = fieldValue(approved, "Rate / Fee") || contract.rate;
  contract.ppdRate = fieldValue(approved, "PPD Rate") || contract.ppdRate;
  contract.labTestPricing = fieldValue(approved, "Lab Test Pricing") || contract.labTestPricing;
  contract.specimenPickup = fieldValue(approved, "Specimen Pickup / Phlebotomy") || contract.specimenPickup;
  contract.autoRenewal = fieldValue(approved, "Auto Renewal") || contract.autoRenewal;
  contract.terminationClause = fieldValue(approved, "Notice Period") || contract.terminationClause;
  contract.utilityAccountNumber = fieldValue(approved, "Account Number") || fieldValue(approved, "Utility Account Number") || contract.utilityAccountNumber;
  contract.meterNumber = fieldValue(approved, "Meter Number") || contract.meterNumber;
  contract.serviceAddress = fieldValue(approved, "Service Address") || contract.serviceAddress;
  contract.signer = fieldValue(approved, "Signer") || contract.signer;
  contract.signerTitle = fieldValue(approved, "Signer Title") || contract.signerTitle;
  contract.signedDate = fieldValue(approved, "Signed Date") || contract.signedDate;
  contract.reviewStatus = "Approved";
  contract.status = "Approved";
  contract.approvedAt = new Date().toISOString();
  contract.updatedAt = new Date().toISOString();
  updateVendorProfileFromContract(contract, approved);
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

function mergeExtractedFields(ruleFields, aiFields) {
  const byLabel = new Map();
  for (const field of ruleFields || []) {
    if (field.label) byLabel.set(field.label.toLowerCase(), field);
  }
  for (const field of aiFields || []) {
    const normalized = normalizeAiField(field);
    if (!normalized.label || !normalized.value) continue;
    const key = normalized.label.toLowerCase();
    const existing = byLabel.get(key);
    if (!existing || normalized.confidence >= (existing.confidence || 0)) {
      byLabel.set(key, normalized);
    }
  }
  return [...byLabel.values()];
}

function normalizeMatchValue(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function textContainsValue(text, value) {
  const needle = normalizeMatchValue(value);
  if (needle.length < 4) return false;
  return normalizeMatchValue(text).includes(needle);
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
    /(?:amount\s*due|balance\s*due|total\s*due|invoice\s*total|total)\s*[:\-]?\s*(\$?\s*\d[\d,]*(?:\.\d{2})?)/i
  ]);
  const vendor = firstMatch(clean, [
    /(?:from|vendor|remit\s*to)\s*[:\-]\s*([^\n\r]{3,100})/i
  ]);
  const fields = [
    invoiceNumber?.value ? extractedField("Invoice Number", invoiceNumber.value, 76, "Invoice OCR", snippetAround(clean, invoiceNumber.index)) : null,
    (invoice.invoiceDate || invoiceDate?.value) ? extractedField("Invoice Date", invoice.invoiceDate || invoiceDate.value, 72, "Invoice OCR", invoiceDate ? snippetAround(clean, invoiceDate.index) : "") : null,
    (invoice.total || total?.value) ? extractedField("Invoice Total", invoice.total || total.value.replace(/\s+/g, ""), 78, "Invoice OCR", total ? snippetAround(clean, total.index) : "") : null,
    (invoice.vendor || vendor?.value) ? extractedField("Vendor", invoice.vendor || vendor.value, 58, "Invoice OCR", vendor ? snippetAround(clean, vendor.index) : "") : null,
    invoice.facility ? extractedField("Facility", invoice.facility, 55, "Invoice hint", "") : null
  ].filter(Boolean);
  return { clean, fields, invoiceNumber: invoiceNumber?.value || "", invoiceDate: invoice.invoiceDate || invoiceDate?.value || "", total: invoice.total || total?.value?.replace(/\s+/g, "") || "", vendor: invoice.vendor || vendor?.value || "" };
}

function matchInvoiceToContract(invoice, text = "") {
  const candidates = allContracts();
  const clean = cleanOcrText(text);
  const scored = candidates.map(contract => {
    let score = 0;
    const reasons = [];
    if (invoice.vendor && normalizeMatchValue(invoice.vendor) === normalizeMatchValue(contract.vendor)) {
      score += 45;
      reasons.push("selected vendor");
    } else if (textContainsValue(clean, contract.vendor)) {
      score += 35;
      reasons.push("vendor found in invoice text");
    }
    if (invoice.facility && normalizeMatchValue(invoice.facility) === normalizeMatchValue(contract.facility)) {
      score += 35;
      reasons.push("selected facility");
    } else if (textContainsValue(clean, contract.facility)) {
      score += 25;
      reasons.push("facility found in invoice text");
    }
    if (contract.category && textContainsValue(clean, contract.category)) {
      score += 10;
      reasons.push("category found in invoice text");
    }
    return { contract, score, reasons };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 35) return null;
  return {
    contractId: best.contract.id,
    contractName: best.contract.name,
    confidence: Math.min(95, best.score),
    reasons: best.reasons
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
    const response = await fetch(`${ollamaUrl}/api/tags`);
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
    "Extract contract data from OCR text. Return ONLY valid JSON.",
    "Use this shape: {\"contract_type\":\"\",\"fields\":[{\"label\":\"Vendor\",\"value\":\"\",\"confidence\":70,\"source_snippet\":\"\"}],\"category_fields\":[],\"clauses\":[{\"type\":\"\",\"snippet\":\"\",\"risk\":\"Review\",\"source\":\"Ollama\"}],\"confidence_notes\":[]}.",
    "Include vendor, facility, category, start date, end date, signer, account/customer/member/policy/site numbers, payment terms, rates, PPD/per patient day, kWh, therm, meter, service address, insurance, renewal, and termination notice when supported by text.",
    JSON.stringify({ hints, rule_extraction: ruleExtraction.fields || [], ocr_text: cleanOcrText(text).slice(0, 24000) })
  ].join("\n\n");
  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: ollamaModel, prompt, stream: false, format: "json" })
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

async function runAiExtraction(text, hints = {}, ruleExtraction = {}) {
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
          content: "Extract contract data from OCR text. Return only fields supported by the text. Use short source snippets. Include common fields and contract-type-specific fields such as account number, customer number, member number, vendor number, policy number, contract/reference number, meter number, service address, PPD/per patient day rate, lab test pricing, specimen pickup, phlebotomy, kWh price, therm price, mowing frequency, price per pound, delivery fee, insurance limits, or other service-specific pricing terms when present."
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
  const { stdout } = await execFileAsync(pdfinfoPath, [sourcePath], {
    maxBuffer: 1024 * 1024
  });
  const match = stdout.match(/^Pages:\s+(\d+)/m);
  return match ? Number(match[1]) : null;
}

async function extractPdfEmbeddedText(sourcePath) {
  const pdftotextPath = await findExistingPath(pdftotextCandidates);
  if (!pdftotextPath) return "";
  try {
    const { stdout } = await execFileAsync(pdftotextPath, ["-layout", "-enc", "UTF-8", sourcePath, "-"], {
      maxBuffer: 30 * 1024 * 1024
    });
    const text = cleanOcrText(stdout);
    return text.length >= 250 ? `--- Embedded PDF Text ---\n${text}` : "";
  } catch {
    return "";
  }
}

async function renderPdfWithPython(sourcePath, outputDir) {
  const pythonPath = await findExistingPath(pythonCandidates);
  if (!pythonPath) return null;
  try {
    const { stdout } = await execFileAsync(pythonPath, [pdfRenderScript, sourcePath, outputDir, String(maxPdfPages)], {
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

async function renderPdfWithPoppler(sourcePath, outputDir) {
  const pdftoppmPath = await findExistingPath(pdftoppmCandidates);
  if (!pdftoppmPath) return null;
  const pageCount = await getPdfPageCount(sourcePath);
  const lastPage = Math.min(pageCount || maxPdfPages, maxPdfPages);
  const outputPrefix = path.join(outputDir, "page");
  await execFileAsync(pdftoppmPath, ["-png", "-r", "200", "-f", "1", "-l", String(lastPage), sourcePath, outputPrefix], {
    maxBuffer: 20 * 1024 * 1024
  });
  return {
    renderedPages: lastPage,
    pageCount,
    renderer: "poppler"
  };
}

async function extractPdfText(sourcePath) {
  const tesseractPath = await findExistingPath(tesseractCandidates);
  if (!tesseractPath) {
    throw new Error("Tesseract was not found. Install Tesseract on the server or set TESSERACT_PATH.");
  }
  const embeddedText = await extractPdfEmbeddedText(sourcePath);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "contract-ocr-"));
  try {
    const renderResult = await renderPdfWithPython(sourcePath, tempDir)
      || await renderPdfWithPoppler(sourcePath, tempDir);
    if (!renderResult) {
      throw new Error("PDF renderer not available. Install pypdfium2 for Python or Poppler.");
    }
    const files = (await fs.readdir(tempDir))
      .filter(file => file.endsWith(".png"))
      .sort((a, b) => pageNumberFromImage(a) - pageNumberFromImage(b));
    if (!files.length) {
      throw new Error("No PDF pages were rendered for OCR.");
    }
    const pages = [];
    for (const file of files) {
      const pageNumber = pageNumberFromImage(file) || pages.length + 1;
      const imagePath = path.join(tempDir, file);
      const { stdout } = await execFileAsync(tesseractPath, [imagePath, ...tesseractArgs], {
        maxBuffer: 20 * 1024 * 1024
      });
      pages.push(`--- Page ${pageNumber} ---\n${stdout.trim()}`);
    }
    const limitedNotice = renderResult.pageCount && renderResult.pageCount > maxPdfPages
      ? `\n\n[OCR limited to first ${maxPdfPages} of ${renderResult.pageCount} pages. Set OCR_MAX_PDF_PAGES to raise this limit.]`
      : "";
    return `${embeddedText ? `${embeddedText}\n\n` : ""}${pages.join("\n\n")}\n\n[PDF rendered with ${renderResult.renderer}.]${limitedNotice}`.trim();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function extractText(sourcePath) {
  const ext = path.extname(sourcePath).toLowerCase();
  if ([".txt", ".text", ".md", ".csv"].includes(ext)) {
    return fs.readFile(sourcePath, "utf8");
  }
  if (ext === ".pdf") {
    return extractPdfText(sourcePath);
  }
  const tesseractPath = await findExistingPath(tesseractCandidates);
  if (!tesseractPath) {
    throw new Error("Tesseract was not found. Install Tesseract on the server or set TESSERACT_PATH.");
  }
  const { stdout } = await execFileAsync(tesseractPath, [sourcePath, ...tesseractArgs], {
    maxBuffer: 20 * 1024 * 1024
  });
  return stdout.trim();
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function readRawBody(req, limitBytes = maxUploadBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error(`Upload is too large. Limit is ${Math.round(limitBytes / 1024 / 1024)}MB.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sanitizeFileName(name) {
  const base = path.basename(String(name || "upload.pdf"));
  return base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "upload.pdf";
}

function parseMultipartForm(buffer, contentType) {
  const boundaryMatch = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error("Missing multipart boundary.");
  const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`;
  const body = buffer.toString("latin1");
  const fields = {};
  let file = null;
  for (const part of body.split(boundary)) {
    if (!part || part === "--\r\n" || part === "--") continue;
    const trimmed = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const separator = trimmed.indexOf("\r\n\r\n");
    if (separator === -1) continue;
    const rawHeaders = trimmed.slice(0, separator);
    const rawValue = trimmed.slice(separator + 4).replace(/\r\n--$/, "");
    const disposition = rawHeaders.match(/content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
    if (!disposition) continue;
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
    const vendor = pick("vendor") || "PSE&G";
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

async function createIntake(body) {
  const now = new Date().toISOString();
  const contract = {
    id: body.id || `CTR-${Date.now()}`,
    name: body.name || "Contract Intake",
    shareSyncUrl: body.shareSyncUrl || "",
    localFilePath: body.localFilePath || "",
    uploadedFileName: body.uploadedFileName || "",
    facility: body.facility || "Needs Classification",
    vendor: body.vendor || "Needs Classification",
    category: body.category || "Needs Classification",
    owner: body.owner || "Contract Dept",
    status: "Needs Review",
    reviewStatus: "Pending OCR",
    createdAt: now
  };
  const job = {
    id: `OCR-${Date.now()}`,
    contractId: contract.id,
    source: body.localFilePath ? "Uploaded File" : body.shareSyncUrl ? "ShareSync" : "Manual",
    shareSyncUrl: contract.shareSyncUrl,
    localFilePath: contract.localFilePath,
    status: "Queued",
    createdAt: now
  };
  saveContract(contract);
  saveOcrJob(job);
  logAudit("contract_uploaded", "contract", contract.id, { name: contract.name, file: contract.uploadedFileName || contract.localFilePath || contract.shareSyncUrl });
  return { contract, ocrJob: job };
}

function sendJson(res, value, status = 200, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
    ...extraHeaders
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

function clearExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (!session?.expiresAt || session.expiresAt <= now) sessions.delete(token);
  }
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
  const session = sessions.get(token);
  if (!session) return null;
  session.expiresAt = Date.now() + sessionMaxAgeSeconds * 1000;
  return session;
}

function sessionIsAdmin(req) {
  if (!loginRequired) return true;
  const session = currentSession(req);
  return session?.role === "Admin";
}

function createSession(user) {
  clearExpiredSessions();
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    user: user.username || user,
    role: user.role || "Read Only",
    fullName: user.fullName || "",
    facility: user.facility || "All",
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + sessionMaxAgeSeconds * 1000
  });
  return token;
}

function sessionCookie(token) {
  return `contract_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionMaxAgeSeconds}`;
}

function clearSessionCookie() {
  return "contract_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}

function isPublicApi(url) {
  return ["/api/health", "/api/auth/status", "/api/login", "/api/logout"].includes(url.pathname);
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
  const relative = path.relative(parentPath, childPath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function attachmentName(contract) {
  const baseName = contract.uploadedFileName || contract.name || "contract.pdf";
  return path.basename(baseName).replace(/[\r\n"]/g, "_");
}

function fileContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if ([".png"].includes(ext)) return "image/png";
  if ([".jpg", ".jpeg"].includes(ext)) return "image/jpeg";
  if ([".tif", ".tiff"].includes(ext)) return "image/tiff";
  if ([".txt", ".text", ".md"].includes(ext)) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

async function sendContractFile(res, contract) {
  if (!contract?.localFilePath) return sendJson(res, { error: "No uploaded contract file is saved for this record." }, 404);
  const filePath = path.resolve(contract.localFilePath);
  if (!isPathInside(uploadsDir, filePath)) {
    return sendJson(res, { error: "Only files uploaded through this app can be downloaded." }, 403);
  }
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "content-type": fileContentType(filePath),
      "content-disposition": `attachment; filename="${attachmentName(contract)}"`,
      "content-length": data.length
    });
    res.end(data);
  } catch {
    return sendJson(res, { error: "Saved file was not found on disk." }, 404);
  }
}

async function systemReadiness() {
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
      await execFileAsync(pythonPath, ["-c", "import pypdfium2"], { maxBuffer: 1024 * 1024 });
      pythonPdfRenderer = true;
    } catch {
      pythonPdfRenderer = false;
    }
  }
  const localAi = await ollamaStatus();
  const checks = [
    { key: "server", label: "Backend server", ok: true, detail: "Server is responding." },
    { key: "auth", label: "Access mode", ok: authConfigured(), detail: loginRequired ? authConfigured() ? `Sign-in required as ${adminUser}` : "Set ADMIN_USER and ADMIN_PASSWORD before requiring sign-in." : "Open internal mode. Sign-in can be turned on later with REQUIRE_LOGIN=true." },
    { key: "database", label: "SQLite database", ok: true, detail: dbPath },
    { key: "uploads", label: "Upload folder", ok: true, detail: uploadsDir },
    { key: "tesseract", label: "Tesseract OCR", ok: Boolean(tesseractPath), detail: tesseractPath || "Missing. Install Tesseract on the server or set TESSERACT_PATH." },
    { key: "pdf-renderer", label: "PDF renderer", ok: Boolean(pythonPdfRenderer || pdftoppmPath), detail: pythonPdfRenderer ? `pypdfium2 through ${pythonPath}` : pdftoppmPath || "Missing. Install pypdfium2 or Poppler." },
    { key: "pdf-text", label: "PDF text extraction", ok: Boolean(pdftotextPath), detail: pdftotextPath || "Optional but recommended. Install Poppler for better readable-PDF extraction." },
    { key: "ai", label: "AI extraction", ok: Boolean(process.env.OPENAI_API_KEY || (localAi.available && localAi.hasModel)), detail: process.env.OPENAI_API_KEY ? `OpenAI ${openAiModel}` : localAi.available && localAi.hasModel ? `Ollama ${ollamaModel}` : "Rules-only. Add OpenAI key or install Ollama model for AI." },
    { key: "backup", label: "Backup folder", ok: true, detail: backupsDir }
  ];
  const required = checks.filter(check => ["server", "auth", "database", "uploads", "tesseract", "pdf-renderer", "backup"].includes(check.key));
  const productionReady = required.every(check => check.ok);
  return {
    ok: productionReady,
    productionReady,
    mode: productionReady ? "ready-for-ocr-testing" : "not-ready",
    checks,
    summary: productionReady ? "Core OCR server pieces are ready." : "One or more required OCR/server pieces are missing.",
    paths: { tesseractPath, pdftoppmPath, pdfinfoPath, pdftotextPath, pythonPath, dbPath, uploadsDir, backupsDir },
    maxPdfPages
  };
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

initDatabase();
seedAdminUser();
await migrateJsonToSqlite();

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return sendJson(res, { ok: true });

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/health") {
      const readiness = await systemReadiness();
      return sendJson(res, {
        ok: true,
        mode: "live-server",
        auth: loginRequired ? authConfigured() ? "required-configured" : "required-setup-needed" : "open-internal-mode",
        storage: "sqlite",
        ocr: readiness.paths.tesseractPath ? "tesseract-installed" : "tesseract-not-found",
        pdfOcr: readiness.checks.find(check => check.key === "pdf-renderer")?.ok ? "pdf-renderer-installed" : "pdf-renderer-not-found",
        maxPdfPages
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
      if (token) sessions.delete(token);
      if (session) logAudit("user_logout", "auth", session.user, { username: session.user });
      return sendJson(res, { authenticated: false }, 200, {
        "set-cookie": clearSessionCookie()
      });
    }

    if (url.pathname.startsWith("/api/") && !isPublicApi(url) && !currentSession(req)) {
      return sendJson(res, { error: "Authentication required." }, 401);
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
        enabled: Boolean(process.env.OPENAI_API_KEY) || (localAi.available && localAi.hasModel),
        provider: process.env.OPENAI_API_KEY ? "openai" : "ollama",
        model: process.env.OPENAI_API_KEY ? openAiModel : ollamaModel,
        mode: process.env.OPENAI_API_KEY ? "ai-extraction-ready" : localAi.available && localAi.hasModel ? "local-ai-ready" : "rules-only",
        localAi
      });
    }

    if (url.pathname === "/api/admin-settings" && req.method === "GET") {
      return sendJson(res, getAdminSettings());
    }

    if (url.pathname === "/api/admin-settings" && req.method === "POST") {
      const body = await readBody(req);
      return sendJson(res, saveAdminSettings(body));
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
      const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") || 25)));
      return sendJson(res, listContracts({ q: url.searchParams.get("q"), page, pageSize }));
    }

    const contractUpdateMatch = url.pathname.match(/^\/api\/contracts\/([^/]+)$/);
    if (contractUpdateMatch && req.method === "PATCH") {
      const contract = getContract(decodeURIComponent(contractUpdateMatch[1]));
      if (!contract) return sendJson(res, { error: "Contract not found" }, 404);
      const body = await readBody(req);
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
      return sendContractFile(res, contract);
    }

    if (url.pathname === "/api/dashboard" && req.method === "GET") {
      return sendJson(res, dashboardSummary());
    }

    if (url.pathname === "/api/facilities" && req.method === "GET") {
      return sendJson(res, facilitySummaries());
    }

    if (url.pathname === "/api/vendors" && req.method === "GET") {
      return sendJson(res, vendorSummaries());
    }

    if (url.pathname === "/api/vendor-profiles" && req.method === "GET") {
      return sendJson(res, listVendorProfiles());
    }

    if (url.pathname === "/api/vendor-profiles" && req.method === "POST") {
      const body = await readBody(req);
      const name = String(body.name || body.legalName || "").trim();
      if (!name) return sendJson(res, { error: "Vendor name is required." }, 400);
      const existing = listVendorProfiles().find(profile => normalizeMatchValue(profile.name) === normalizeMatchValue(name));
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
        vendor: body.vendor || "PSE&G",
        utilityType: body.utilityType || body.category || "Utility",
        accountNumber: body.accountNumber || "",
        meterNumber: body.meterNumber || "",
        serviceAddress: body.serviceAddress || "",
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

    const reviewMatch = url.pathname.match(/^\/api\/review\/([^/]+)$/);
    if (reviewMatch && req.method === "GET") {
      const contractId = decodeURIComponent(reviewMatch[1]);
      const contract = getContract(contractId);
      if (!contract) return sendJson(res, { error: "Contract not found" }, 404);
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
      const body = await readBody(req);
      const fields = Array.isArray(body.fields) ? body.fields : [];
      applyApprovedFields(contract, fields);
      saveContract(contract);
      logAudit("contract_review_approved", "contract", contract.id, { name: contract.name, approvedFields: fields.length });
      return sendJson(res, { contract, fields: contract.approvedFields });
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
      logAudit("contract_created", "contract", contract.id, { name: contract.name });
      return sendJson(res, contract, 201);
    }

    if (url.pathname === "/api/sharesync-intake" && req.method === "POST") {
      const body = await readBody(req);
      return sendJson(res, await createIntake({
        ...body,
        name: body.name || "ShareSync Intake Contract"
      }), 201);
    }

    if (url.pathname === "/api/upload-contract" && req.method === "POST") {
      const body = await readRawBody(req);
      const { fields, file } = parseMultipartForm(body, req.headers["content-type"]);
      if (!file || !file.buffer.length) return sendJson(res, { error: "Choose a PDF, image, or text file to upload." }, 400);
      const ext = path.extname(file.originalName).toLowerCase();
      const allowed = new Set([".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".txt", ".text", ".md"]);
      if (!allowed.has(ext)) return sendJson(res, { error: "Unsupported upload type. Use PDF, image, or text files." }, 400);
      const uploadId = `UP-${Date.now()}`;
      const filePath = path.join(uploadsDir, `${uploadId}-${file.originalName}`);
      await fs.writeFile(filePath, file.buffer);
      return sendJson(res, await createIntake({
        name: fields.name || file.originalName,
        localFilePath: filePath,
        uploadedFileName: file.originalName,
        facility: fields.facility,
        vendor: fields.vendor,
        category: fields.category,
        owner: fields.owner
      }), 201);
    }

    if (url.pathname === "/api/invoices" && req.method === "GET") {
      return sendJson(res, listInvoices());
    }

    if (url.pathname === "/api/upload-invoice" && req.method === "POST") {
      const body = await readRawBody(req);
      const { fields, file } = parseMultipartForm(body, req.headers["content-type"]);
      if (!file || !file.buffer.length) return sendJson(res, { error: "Choose an invoice file to upload." }, 400);
      const ext = path.extname(file.originalName).toLowerCase();
      const allowed = new Set([".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".txt", ".text", ".md", ".csv", ".xlsx"]);
      if (!allowed.has(ext)) return sendJson(res, { error: "Unsupported invoice type. Use PDF, image, CSV, Excel, or text files." }, 400);
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
        createdAt: now,
        updatedAt: now
      };
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "contract-invoice-"));
      const filePath = path.join(tempDir, file.originalName);
      try {
        await fs.writeFile(filePath, file.buffer);
        if (ext !== ".xlsx") {
          const text = await extractText(filePath);
          const details = extractInvoiceDetails(text, invoice);
          const match = matchInvoiceToContract({ ...invoice, vendor: details.vendor || invoice.vendor, invoiceDate: details.invoiceDate || invoice.invoiceDate, total: details.total || invoice.total }, text);
          invoice.ocrText = details.clean;
          invoice.ocrTextPreview = details.clean.slice(0, 1200);
          invoice.extractedFields = details.fields;
          invoice.invoiceNumber = details.invoiceNumber || invoice.invoiceNumber;
          invoice.invoiceDate = details.invoiceDate || invoice.invoiceDate;
          invoice.total = details.total || invoice.total;
          invoice.vendor = details.vendor || invoice.vendor;
          invoice.status = match ? "Matched" : "Needs Match";
          invoice.matchedContractId = match?.contractId || "";
          invoice.matchedContractName = match?.contractName || "";
          invoice.matchConfidence = match?.confidence || 0;
          invoice.matchReasons = match?.reasons || [];
          invoice.exceptions = match ? [] : [{ issue: "No confident contract match", status: "Review" }];
        } else {
          const match = matchInvoiceToContract(invoice, "");
          invoice.status = match ? "Matched" : "Needs Match";
          invoice.matchedContractId = match?.contractId || "";
          invoice.matchedContractName = match?.contractName || "";
          invoice.matchConfidence = match?.confidence || 0;
          invoice.matchReasons = match?.reasons || [];
        }
      } catch (error) {
        invoice.status = "Needs Match";
        invoice.ocrError = error.message || "Invoice OCR did not finish.";
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
      logAudit("invoice_checked", "invoice", invoice.id, { name: invoice.name, status: invoice.status, matchedContractId: invoice.matchedContractId || "" });
      return sendJson(res, invoice, 200);
    }

    if (url.pathname === "/api/upload-utility-accounts" && req.method === "POST") {
      const body = await readRawBody(req);
      const { file } = parseMultipartForm(body, req.headers["content-type"]);
      if (!file || !file.buffer.length) return sendJson(res, { error: "Choose a CSV file with facility/account data." }, 400);
      const ext = path.extname(file.originalName).toLowerCase();
      if (ext !== ".csv" && ext !== ".txt") return sendJson(res, { error: "Use a CSV file for utility accounts." }, 400);
      const accounts = parseUtilityAccountsCsv(file.buffer.toString("utf8"));
      for (const account of accounts) saveUtilityAccount(account);
      return sendJson(res, { imported: accounts.length, accounts }, 201);
    }

    if (url.pathname === "/api/ocr-jobs" && req.method === "GET") {
      return sendJson(res, listOcrJobs());
    }

    const ocrRunMatch = url.pathname.match(/^\/api\/ocr-jobs\/([^/]+)\/run$/);
    if (ocrRunMatch && req.method === "POST") {
      const job = getOcrJob(decodeURIComponent(ocrRunMatch[1]));
      if (!job) return sendJson(res, { error: "OCR job not found" }, 404);
      if (!job.localFilePath) {
        job.status = "Waiting for local file";
        job.error = "Add a local file path to this OCR job before running OCR.";
        job.updatedAt = new Date().toISOString();
        saveOcrJob(job);
        return sendJson(res, job, 400);
      }
      job.status = "Processing";
      job.updatedAt = new Date().toISOString();
      saveOcrJob(job);
      try {
        const contract = getContract(job.contractId);
        const text = await extractText(job.localFilePath);
        const extraction = extractContractFields(text, contract || {});
        let aiExtraction = await runAiExtraction(text, contract || {}, extraction).catch(error => ({
          enabled: Boolean(process.env.OPENAI_API_KEY),
          status: "failed",
          message: error.message
        }));
        const aiResult = aiExtraction.result || {};
        const aiFields = [...(aiResult.fields || []), ...(aiResult.category_fields || [])];
        const mergedFields = mergeExtractedFields(extraction.fields, aiFields);
        const smartMatch = enrichFieldsWithUtilityAccount(mergedFields, text);
        const mergedClauses = [...(extraction.clauses || []), ...(aiResult.clauses || [])];
        job.status = "Complete";
        job.extractedText = text;
        job.extractedTextPreview = text.slice(0, 1200);
        job.extractedFields = smartMatch.fields;
        job.extractedClauses = mergedClauses;
        job.utilityAccountMatch = smartMatch.match;
        job.aiExtraction = aiExtraction;
        job.completedAt = new Date().toISOString();
        delete job.error;
        if (contract) {
          contract.reviewStatus = "OCR Complete";
          contract.status = "Needs Review";
          contract.ocrTextPreview = job.extractedTextPreview;
          contract.ocrText = extraction.text;
          contract.extractedFields = smartMatch.fields;
          contract.extractedClauses = mergedClauses;
          contract.utilityAccountMatch = smartMatch.match;
          contract.aiExtraction = aiExtraction;
          contract.contractType = aiResult.contract_type || fieldValue(smartMatch.fields, "Contract Type") || fieldValue(smartMatch.fields, "Category") || contract.contractType;
          contract.documentTitle = fieldValue(smartMatch.fields, "Contract Name") || fieldValue(smartMatch.fields, "Document Title") || contract.documentTitle;
          contract.agreementType = fieldValue(smartMatch.fields, "Contract Type") || fieldValue(smartMatch.fields, "Agreement Type") || contract.agreementType;
          contract.purposeScope = fieldValue(smartMatch.fields, "Purpose / Scope") || contract.purposeScope;
          contract.categoryReason = fieldValue(smartMatch.fields, "Category Reason") || smartMatch.fields.find(field => field.label === "Category")?.source?.replace(/^Why:\s*/i, "") || contract.categoryReason;
          contract.vendor = fieldValue(smartMatch.fields, "Vendor") || contract.vendor;
          contract.vendorMailingAddress = fieldValue(smartMatch.fields, "Vendor Mailing Address") || contract.vendorMailingAddress;
          contract.vendorAddress = contract.vendorMailingAddress || contract.vendorAddress;
          contract.vendorPhone = fieldValue(smartMatch.fields, "Vendor Phone") || contract.vendorPhone;
          contract.vendorEmail = fieldValue(smartMatch.fields, "Vendor Email") || contract.vendorEmail;
          contract.facility = fieldValue(smartMatch.fields, "Facility") || contract.facility;
          contract.category = fieldValue(smartMatch.fields, "Category") || aiResult.contract_type || contract.category;
          contract.end = fieldValue(smartMatch.fields, "End Date") || contract.end;
          contract.autoRenewal = fieldValue(smartMatch.fields, "Auto Renewal") || contract.autoRenewal;
          contract.terminationClause = fieldValue(smartMatch.fields, "Notice Period") || contract.terminationClause;
          contract.utilityAccountNumber = fieldValue(smartMatch.fields, "Account Number") || fieldValue(smartMatch.fields, "Utility Account Number") || contract.utilityAccountNumber;
          contract.meterNumber = fieldValue(smartMatch.fields, "Meter Number") || contract.meterNumber;
          contract.serviceAddress = fieldValue(smartMatch.fields, "Service Address") || contract.serviceAddress;
          contract.rate = fieldValue(smartMatch.fields, "Rate / Fee") || contract.rate;
          contract.ppdRate = fieldValue(smartMatch.fields, "PPD Rate") || contract.ppdRate;
          contract.labTestPricing = fieldValue(smartMatch.fields, "Lab Test Pricing") || contract.labTestPricing;
          contract.specimenPickup = fieldValue(smartMatch.fields, "Specimen Pickup / Phlebotomy") || contract.specimenPickup;
          contract.signer = fieldValue(smartMatch.fields, "Signer") || contract.signer;
          contract.signerTitle = fieldValue(smartMatch.fields, "Signer Title") || contract.signerTitle;
          contract.signedDate = fieldValue(smartMatch.fields, "Signed Date") || contract.signedDate;
          contract.updatedAt = new Date().toISOString();
          updateVendorProfileFromContract(contract, smartMatch.fields);
          saveContract(contract);
        }
        saveOcrJob(job);
        return sendJson(res, job);
      } catch (error) {
        job.status = "Failed";
        job.error = error.message;
        job.updatedAt = new Date().toISOString();
        saveOcrJob(job);
        return sendJson(res, job, 500);
      }
    }

    if (url.pathname === "/api/alerts" && req.method === "GET") {
      return sendJson(res, await readJson("alerts.json"));
    }

    return serveStatic(req, res);
  } catch (error) {
    return sendJson(res, { error: error.message }, 500);
  }
});

server.listen(port, host, () => {
  console.log(`Contract app running at http://127.0.0.1:${port}/`);
  if (host === "0.0.0.0") {
    const urls = localNetworkUrls(port);
    if (urls.length) console.log(`Local network URL: ${urls.join(" or ")}`);
  }
});
