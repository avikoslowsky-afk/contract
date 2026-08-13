const bootstrap = window.CONTRACT_APP_BOOTSTRAP || {};
const categories = [...(bootstrap.categories || [])];
const facilitySeedData = [...(bootstrap.facilitySeedData || [])];
const vendorSeedData = [...(bootstrap.vendorSeedData || [])];
const contractTemplates = [...(bootstrap.contractTemplates || [])];
const FAST_PAGE_SIZE = 75;
const SAFE_INDEX_PAGE_SIZE = 250;
const MAX_BACKGROUND_CONTRACTS = 300;
const MAX_TABLE_RENDER_ROWS = 60;
try {
  const learnedTemplates = JSON.parse(localStorage.getItem("contractBuilderTemplates") || "[]");
  if (Array.isArray(learnedTemplates)) {
    learnedTemplates.forEach(template => {
      if (template?.name && !contractTemplates.some(item => item.name === template.name)) contractTemplates.push(template);
    });
  }
  const learnedCategories = JSON.parse(localStorage.getItem("contractBuilderCategories") || "[]");
  if (Array.isArray(learnedCategories)) {
    learnedCategories.forEach(category => {
      if (category && !categories.some(item => String(item).toLowerCase() === String(category).toLowerCase())) categories.push(category);
    });
  }
} catch {}

    const facilities = [];

    const contracts = [];

    let contractData = [...contracts];
    let contractsTotalCount = contracts.length;
    let financeContractData = [];
    let financeContractsLoaded = false;
    let financeContractsLoadingPromise = null;
    let financeContractsWarmLoadScheduled = false;
    let financeContractsTotal = 0;
    let compactContractIndexLoaded = false;
    let compactContractIndexPromise = null;
    let currentPage = 1;
    let activeContractView = "search";
    let contractFinderShowAll = false;
    const selectedContractIds = new Set();
    let ocrJobs = [];
    let ocrQueuePage = 1;
    let ocrQueuePageSize = 40;
    let ocrQueueTotal = 0;
    const backgroundOcrQueuedIds = new Set();
    let dashboardData = {};
    let financeSummaryData = null;
    let servicesSummaryData = null;
    let adminSummaryData = null;
    let reviewSummaryData = null;
    let reviewQueuePage = 1;
    const reviewQueuePageSize = 15;
    let categoryData = [];
    let reviewFields = [];
    let reviewFeeLines = [];
    let aiStatus = { enabled: false, mode: "rules-only" };
    let activeReviewContractId = "";
    let activeReviewJobId = "";
    let activeReviewContractName = "";
    let activeReviewStatus = "";
    let activeReviewOcrText = "";
    let reviewSaveStatus = "";
    let reviewApprovalJustification = "";
    let reviewQueueRefreshPending = false;
    let reviewFullRecordLoadingId = "";
    let activeSourceClueKey = "";
    let utilityAccounts = [];
    let invoiceUploads = [];
    let auditLogs = [];
    let activePresenceData = [];
    let activeWorkContext = { itemId: "", itemName: "", action: "Viewing" };
    let lastPresenceSentAt = 0;
    let learningRules = [];
    let vendorRequirementLearningCache = null;
    let vendorDirectoryRevision = 0;
    let vendorDirectoryCache = null;
    let backupRecords = [];
    let readinessData = null;
    let appUsers = [];
    let currentUser = null;
    let bulkUploadItems = [];
    let backendOnline = false;
    let contractSearchTimer = null;
    let lastBackendContractSearch = "";
    let backendLoadPromise = null;
    let dashboardLoadPromise = null;
    let dashboardLiveLoaded = false;
    let backendDataLoaded = false;
    let liveDataLoadedForSection = "";
    let dashboardLiveLoadedAt = 0;
    const liveDataLoadedAtBySection = {};
    let contractSearchEngine = "";
    let sectionRenderToken = 0;
    let facilityCoordinates = {};
    let adminSettings = {};
    const apiBase = (() => {
      const params = new URLSearchParams(location.search);
      const fromUrl = params.get("apiBase") || params.get("backend") || "";
      if (fromUrl) {
        localStorage.setItem("contractApiBase", fromUrl.replace(/\/+$/, ""));
        return fromUrl.replace(/\/+$/, "");
      }
      return String(window.CONTRACT_API_BASE || localStorage.getItem("contractApiBase") || "").replace(/\/+$/, "");
    })();
    const inviteSetupToken = new URLSearchParams(location.search).get("invite") || "";

    const ROLE_SECTION_ACCESS = {
      admin: "all",
      "contract team": ["dashboard", "contracts", "upload", "builder", "ocrqueue", "review", "review-detail", "exceptions", "facilities", "vendors", "categories", "renewals", "compliance", "reports", "tasks", "ai", "clauses", "help"],
      "contract department": ["dashboard", "contracts", "upload", "builder", "ocrqueue", "review", "review-detail", "exceptions", "facilities", "vendors", "categories", "renewals", "compliance", "reports", "tasks", "ai", "clauses", "help"],
      "facility user": ["dashboard", "contracts", "facilities", "renewals", "compliance", "reports", "tasks", "help"],
      "vendor/profile user": ["dashboard", "contracts", "vendors", "categories", "reports", "tasks", "help"],
      "vendor profile user": ["dashboard", "contracts", "vendors", "categories", "reports", "tasks", "help"],
      "finance user": ["dashboard", "contracts", "finance", "reports", "invoices", "exceptions", "facilities", "vendors", "tasks", "help"],
      "read only": ["dashboard", "contracts", "facilities", "vendors", "categories", "renewals", "compliance", "finance", "reports", "help"],
      "field reviewer": ["dashboard", "contracts", "review", "review-detail", "ocrqueue", "tasks", "help"]
    };

    function currentRoleKey() {
      return String(currentUser?.role || "Read Only").trim().toLowerCase();
    }

    function roleAccessIsOpen() {
      return !currentUser || currentUser.publicMode || currentUser.loginRequired === false || currentRoleKey() === "admin";
    }

    function canAccessSection(sectionId = "") {
      if (roleAccessIsOpen()) return true;
      const allowed = ROLE_SECTION_ACCESS[currentRoleKey()] || ROLE_SECTION_ACCESS["read only"];
      return allowed === "all" || allowed.includes(sectionId);
    }

    function firstAllowedSection() {
      if (canAccessSection("dashboard")) return "dashboard";
      const allowed = ROLE_SECTION_ACCESS[currentRoleKey()] || ROLE_SECTION_ACCESS["read only"];
      return Array.isArray(allowed) ? allowed[0] || "dashboard" : "dashboard";
    }

    function applyRoleAccessUi() {
      document.querySelectorAll(".nav-button[data-section]").forEach(button => {
        const allowed = canAccessSection(button.dataset.section);
        button.hidden = !allowed;
        button.disabled = !allowed;
      });
      const adminButton = document.querySelector('.nav-button[data-section="admin"]');
      if (adminButton && !roleAccessIsOpen()) adminButton.hidden = currentRoleKey() !== "admin";
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function jsArg(value) {
      return String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "");
    }

    function contractFileUrl(contract) {
      return contract?.id && (contract.localFilePath || contract.shareSyncLocalPath)
        ? `/api/contracts/${encodeURIComponent(contract.id)}/file`
        : "";
    }

    function contractSourceName(contract) {
      return contract?.uploadedFileName
        || queuePathName(contract?.shareSyncLocalPath || contract?.localFilePath || contract?.shareSyncUrl || contract?.url || "")
        || contract?.name
        || "Original contract file";
    }

    function contractSourceKind(contract) {
      const source = [
        contract?.uploadedFileName,
        contract?.localFilePath,
        contract?.shareSyncLocalPath,
        contract?.shareSyncUrl,
        contract?.url,
        contractSourceName(contract)
      ].filter(Boolean).join(" ").toLowerCase();
      if (/\.(docx|doc)\b/.test(source)) return "word";
      if (/\.pdf\b/.test(source)) return "pdf";
      if (/\.(png|jpe?g|tiff?|tif)\b/.test(source)) return "image";
      return "file";
    }

    function sourceKindLabel(kind) {
      if (kind === "word") return "Word";
      if (kind === "pdf") return "PDF";
      if (kind === "image") return "Image";
      return "File";
    }

    function sourceOpenLabel(kind) {
      if (kind === "word") return "Open Word";
      if (kind === "pdf") return "Open PDF";
      if (kind === "image") return "Open Image";
      return "Open File";
    }

    function closeModal() {
      activeSourceClueKey = "";
      const nav = document.getElementById("modalNavControls");
      if (nav) nav.innerHTML = "";
      document.getElementById("contractModal")?.classList.remove("open");
    }

    function setModalReviewNavigation(index) {
      const nav = document.getElementById("modalNavControls");
      if (!nav) return;
      nav.innerHTML = `
        <button class="btn ghost modal-arrow" type="button" title="Previous field" onclick="openAdjacentReviewField(${index}, -1)">‹</button>
        <button class="btn ghost modal-arrow" type="button" title="Next field" onclick="openAdjacentReviewField(${index}, 1)">›</button>
      `;
    }

    function clearModalReviewNavigation() {
      const nav = document.getElementById("modalNavControls");
      if (nav) nav.innerHTML = "";
    }

    function openPdfCompareModal(fileUrl = "", title = "Original contract file", kind = "pdf") {
      if (!fileUrl) {
        showToast("No source file is linked to this contract yet.");
        return;
      }
      const normalizedKind = kind || "file";
      const isPdf = normalizedKind === "pdf";
      const label = sourceKindLabel(normalizedKind);
      const { text, clipped } = displayOcrText(reviewContractText(), 500000);
      document.getElementById("modalTitle").textContent = `${label} / OCR Compare`;
      document.getElementById("modalBody").innerHTML = `
        <div class="pdf-compare-layout">
          <article class="card pdf-compare-card">
            <div class="panel-head">
              <h3>${escapeHtml(title || "Original contract file")}</h3>
              <span class="badge blue">${escapeHtml(label)}</span>
            </div>
            <div class="panel-body">
              ${isPdf
                ? `<iframe class="contract-preview-frame pdf-modal-frame" src="${escapeHtml(fileUrl)}" title="Original contract PDF"></iframe>`
                : `<div class="paper">
                    <h4>Original ${escapeHtml(label)} document</h4>
                    <p>Open the original file. The text the app read is searchable on the OCR side.</p>
                    <a class="btn primary" href="${escapeHtml(fileUrl)}" target="_blank" rel="noopener">${escapeHtml(sourceOpenLabel(normalizedKind))}</a>
                  </div>`}
            </div>
          </article>
          <article class="card pdf-compare-card">
            <div class="panel-head">
              <h3>OCR Text</h3>
              <span class="badge gray">Read by system</span>
            </div>
            <div class="panel-body">
              <div class="field" style="margin-bottom:10px">
                <label>Search OCR text</label>
                <div class="search-row">
                  <input id="pdfCompareOcrSearch" placeholder="Search term, date, fee, renewal, notice..." onkeydown="if(event.key==='Enter'){event.preventDefault(); updatePdfCompareOcrSearch();}" />
                  <button class="btn" type="button" onclick="updatePdfCompareOcrSearch()">Search</button>
                  <button class="btn ghost" type="button" onclick="resetPdfCompareOcrText()">Full OCR</button>
                </div>
              </div>
              ${clipped ? `<div class="source">Showing up to ${text.length.toLocaleString()} characters for browser speed. Use search to jump through the saved OCR.</div>` : ""}
              <textarea readonly class="ocr-compare-text" id="pdfCompareOcrText">${escapeHtml(text || "No OCR text is saved for this contract yet.")}</textarea>
            </div>
          </article>
        </div>
        <div class="table-actions" style="margin-top:14px">
          <a class="btn" href="${escapeHtml(fileUrl)}" target="_blank" rel="noopener">${escapeHtml(sourceOpenLabel(normalizedKind))}</a>
          <button class="btn primary" type="button" onclick="closeModal()">Close Preview</button>
        </div>
      `;
      document.getElementById("contractModal")?.classList.add("open");
    }

    function resetPdfCompareOcrText() {
      const area = document.getElementById("pdfCompareOcrText");
      if (!area) return;
      area.value = displayOcrText(reviewContractText(), 500000).text || "No OCR text is saved for this contract yet.";
    }

    function updatePdfCompareOcrSearch() {
      const input = document.getElementById("pdfCompareOcrSearch");
      const area = document.getElementById("pdfCompareOcrText");
      if (!area) return;
      const query = String(input?.value || "").trim();
      if (!query) {
        resetPdfCompareOcrText();
        return;
      }
      const matches = searchOcrText(reviewContractText(), query, 25);
      area.value = matches.length
        ? matches.join("\n\n--- next match ---\n\n")
        : `No OCR matches found for: ${query}`;
    }

    function removeLocalContract(id) {
      selectedContractIds.delete(id);
      replaceArray(contracts, contracts.filter(contract => contract.id !== id));
      contractData = contractData.filter(contract => contract.id !== id);
      ocrJobs = ocrJobs.filter(job => job.contractId !== id && job.contract_id !== id);
      if (activeReviewContractId === id) {
        reviewFields = [];
        reviewFeeLines = [];
      activeReviewContractId = "";
      activeReviewJobId = "";
      activeReviewContractName = "";
      activeReviewStatus = "";
      activeReviewOcrText = "";
      reviewSaveStatus = "";
        reviewApprovalJustification = "";
      }
      currentPage = Math.min(currentPage, Math.max(1, Math.ceil(contractData.length / Number(document.getElementById("pageSize")?.value || 10))));
      renderActiveSectionOnly();
      scheduleIdleTask(() => renderDashboard(), 400);
    }

    async function deleteContractRecord(id) {
      if (!id) return;
      const record = contractData.find(contract => contract.id === id) || contracts.find(contract => contract.id === id);
      const name = record?.name || "this contract";
      if (!confirm(`Delete ${name} from this app?\n\nThis removes only the app record and OCR job. The PDF or Word file stays in ShareSync/the original folder. To delete the actual file, delete it directly from ShareSync or File Explorer.`)) return;
      try {
        await apiJson(`/api/contracts/${encodeURIComponent(id)}`, { method: "DELETE" });
        closeModal();
        removeLocalContract(id);
        showToast("App record deleted. Source file was kept.");
      } catch (error) {
        const message = String(error?.message || "");
        if (message.includes("Contract not found")) {
          closeModal();
          removeLocalContract(id);
          showToast("Contract was already deleted.");
          return;
        }
        showToast("Could not delete this contract. Please try again.");
      }
    }

    function setContractSelected(id, checked) {
      if (!id) return;
      if (checked) selectedContractIds.add(id);
      else selectedContractIds.delete(id);
      renderContracts();
    }

    function updateBulkContractControls(pageRows = []) {
      const count = selectedContractIds.size;
      const countEl = document.getElementById("bulkSelectedCount");
      const deleteBtn = document.getElementById("bulkDeleteContracts");
      const selectPage = document.getElementById("selectPageContracts");
      if (countEl) countEl.textContent = `${count} selected`;
      if (deleteBtn) deleteBtn.disabled = count === 0;
      if (selectPage) {
        const selectable = pageRows.map(contract => contract.id).filter(Boolean);
        selectPage.checked = selectable.length > 0 && selectable.every(id => selectedContractIds.has(id));
        selectPage.indeterminate = selectable.some(id => selectedContractIds.has(id)) && !selectPage.checked;
      }
    }

    function toggleSelectPageContracts(checked) {
      const pageRows = [...document.querySelectorAll("#contractRows input[data-contract-select]")];
      pageRows.forEach(input => {
        if (checked) selectedContractIds.add(input.value);
        else selectedContractIds.delete(input.value);
      });
      renderContracts();
    }

    async function bulkDeleteSelectedContracts() {
      const ids = [...selectedContractIds];
      if (!ids.length) return;
      if (!confirm(`Delete ${ids.length} selected contract${ids.length === 1 ? "" : "s"} from this app?\n\nThis removes only app records and OCR jobs. PDF/Word files stay in ShareSync/the original folders.`)) return;
      try {
        const result = await apiJson("/api/contracts/bulk-delete", {
          method: "POST",
          body: JSON.stringify({ ids })
        });
        ids.forEach(id => {
          selectedContractIds.delete(id);
          replaceArray(contracts, contracts.filter(contract => contract.id !== id));
          contractData = contractData.filter(contract => contract.id !== id);
          ocrJobs = ocrJobs.filter(job => job.contractId !== id && job.contract_id !== id);
        });
        closeModal();
        currentPage = Math.min(currentPage, Math.max(1, Math.ceil(contractData.length / Number(document.getElementById("pageSize")?.value || 10))));
        renderActiveSectionOnly();
        scheduleIdleTask(() => renderDashboard(), 400);
        showToast(`Deleted ${result.deletedCount || ids.length} app record${(result.deletedCount || ids.length) === 1 ? "" : "s"}. Source files were kept.`);
      } catch (error) {
        showToast("Could not delete selected contracts. Please try again.");
      }
    }

    async function setContractHistoryStatus(id, archived) {
      const record = contractData.find(contract => contract.id === id) || contracts.find(contract => contract.id === id);
      if (!record) return;
      const nextStatus = archived ? "Archived" : "Needs Review";
      const action = archived ? "Archive" : "Restore";
      if (archived && !confirm(`Archive ${record.name}? It will leave the current list but stay available in contract history.`)) return;
      try {
        const updated = await apiJson(`/api/contracts/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus })
        });
        const normalized = normalizeContract(updated);
        [contracts, contractData].forEach(list => {
          const index = list.findIndex(contract => contract.id === id);
          if (index >= 0) list[index] = normalized;
        });
        closeModal();
        renderActiveSectionOnly();
        scheduleIdleTask(() => renderDashboard(), 400);
        showToast(archived ? "Contract moved to history." : "Contract restored to current list.");
      } catch (error) {
        showToast(`${action} did not finish. Try again.`);
      }
    }

    const alerts = [];

    const extracted = [];

    const tasks = [];

    const reportsBootstrap = window.CONTRACT_APP_REPORTS || {};
    const reportDefinitions = [...(reportsBootstrap.reportDefinitions || [])];
    const reviewConfigBootstrap = window.CONTRACT_APP_REVIEW_CONFIG || {};
    const businessConfig = window.CONTRACT_APP_BUSINESS_CONFIG || {};
    const categoryGroupOrder = [...(businessConfig.categoryGroupOrder || [])];
    const categorySynonymGroups = [...(businessConfig.categorySynonymGroups || [])];
    const learnedRequirementCatalog = [...(businessConfig.learnedRequirementCatalog || [])];
    const contractLifecycleStatuses = [...(businessConfig.contractLifecycleStatuses || [])];
    const customReportColumns = [...(businessConfig.customReportColumns || [])];
    const defaultCustomColumns = [...(businessConfig.defaultCustomColumns || [])];
    let activeReportId = "contract-inventory";

    const costReport = [];

    const vendorsData = [];
    const reportVendorsData = [];
    let vendorPage = 1;
    const vendorPageSize = 25;

    const relatedDocs = [];

    const termSchedule = [];

    const feeScheduleByCategory = {};

    const auditTrail = [];

    const weatherChecks = [];

    const invoiceComparison = [];

    const exceptions = [];

    const clauses = [];

    const badgeClass = value => {
      if (["Critical", "High", "High Risk"].includes(value)) return "red";
      if (["Medium", "Needs Review", "Expiring Soon"].includes(value)) return "amber";
      if (["Low", "Active"].includes(value)) return "green";
      return "blue";
    };

    function moneyToNumber(value) {
      const raw = String(value || "");
      const match = raw.match(/\$?\s*(\d[\d,]*(?:\.\d{1,2})?)(?:\s*([MK])\b)?/i);
      if (!match) return 0;
      const suffix = String(match[2] || "").toUpperCase();
      const multiplier = suffix === "M" ? 1000000 : suffix === "K" ? 1000 : 1;
      return Number(String(match[1] || "").replace(/,/g, "")) * multiplier || 0;
    }

    function formatCurrencyNumber(value, options = {}) {
      const amount = Number(value || 0);
      if (!Number.isFinite(amount)) return "";
      const hasCents = options.forceCents || Math.abs(amount % 1) > 0.0001;
      return amount.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: hasCents ? 2 : 0,
        maximumFractionDigits: 2
      });
    }

    function formatMoneyText(value) {
      const original = String(value || "").replace(/\s+/g, " ").trim();
      if (!original || /^(needs review|needs classification|unknown|not found|tbd|n\/a|na|none|missing)$/i.test(original)) return original;
      let changed = false;
      const formatted = original.replace(/(\$)?\s*(\d[\d,]*(?:\.\d{1,4})?)\s*([mk])?\b(?!\s*%)/gi, (match, symbol, number, suffix, offset, fullText) => {
        const before = fullText.slice(Math.max(0, offset - 12), offset).toLowerCase();
        const after = fullText.slice(offset + match.length, offset + match.length + 12).toLowerCase();
        if (!symbol && /\b(days?|months?|years?|yrs?|notice|term|date|page|section|article|floor|room|suite)\b/.test(after)) return match;
        if (!symbol && /\b(section|article|page|date|term)\s*$/i.test(before)) return match;
        const multiplier = String(suffix || "").toUpperCase() === "M" ? 1000000 : String(suffix || "").toUpperCase() === "K" ? 1000 : 1;
        const amount = Number(String(number || "").replace(/,/g, "")) * multiplier;
        if (!Number.isFinite(amount)) return match;
        changed = true;
        return formatCurrencyNumber(amount, { forceCents: /\.\d{1,4}/.test(number) });
      });
      return changed
        ? formatted
          .replace(/\s*\/\s*/g, " / ")
          .replace(/\s+\b(per)\b/gi, " per")
          .replace(/\s+/g, " ")
          .trim()
        : original;
    }

    function costPerBed(spend, beds) {
      const amount = moneyToNumber(spend);
      if (!beds) return "Missing beds";
      if (!amount) return "Needs cost";
      return formatCurrencyNumber(Math.round(amount / beds));
    }

    function facilityPpd(spend, census) {
      const amount = moneyToNumber(spend);
      const dailyCensus = Number(census || 0);
      if (!dailyCensus) return "Needs census";
      if (!amount) return "Needs cost";
      return formatCurrencyNumber(amount / dailyCensus / 365, { forceCents: true });
    }

    function facilityRecordType(facility = {}) {
      const value = String(facility.recordType || facility.facilityStatus || facility.status || "Active Facility").trim();
      if (/historical|record.?only|inactive|closed/i.test(value)) return "Historical / Record Only";
      if (/external|other company|not a facility/i.test(value)) return "External Company / Not a Facility";
      return "Active Facility";
    }

    function facilityIsActive(facility = {}) {
      return facilityRecordType(facility) === "Active Facility";
    }

    function contractUsesActiveFacility(contract = {}) {
      const names = contractFacilityNames(contract);
      const matches = names.map(facilityRecordForName).filter(Boolean);
      return !matches.length || matches.some(facilityIsActive);
    }

    function terminationBadge(value) {
      if (!value || value === "Missing" || value === "No termination clause") return "red";
      if (value.includes("120") || value.includes("90")) return "amber";
      return "green";
    }

    function cleanMasterName(value) {
      return String(value || "").replace(/[“”"]/g, "").replace(/\s+/g, " ").replace(/\s*,\s*$/, "").trim();
    }

    function masterKey(value) {
      return cleanMasterName(value)
        .toLowerCase()
        .replace(/\b(the|incorporated|inc|llc|l\.l\.c|corp|corporation|co|company|ltd|limited)\b/g, "")
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]/g, "");
    }

    function dedupeRecords(records, keyField = "name") {
      const merged = new Map();
      (records || []).forEach(record => {
        const key = masterKey(record?.[keyField]);
        if (!key) return;
        const existing = merged.get(key) || {};
        merged.set(key, {
          ...record,
          ...existing,
          ...Object.fromEntries(Object.entries(record || {}).map(([field, value]) => [field, existing[field] || value])),
          name: existing.name || cleanMasterName(record.name || record[keyField])
        });
      });
      return [...merged.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    }

    function facilityAliasKey(value = "") {
      const key = masterKey(value);
      const aliases = {
        nmanor: "northernmanor",
        northernmanor: "northernmanor",
        northernmanorgeriatriccenter: "northernmanor",
        nmetropolitan: "northernmetropolitan",
        northernmetropolitan: "northernmetropolitan",
        northernmetropolitanresidentialhealthcarefacility: "northernmetropolitan",
        nriverview: "northernriverview",
        northernriverview: "northernriverview",
        northernriverviewhealthcarecenter: "northernriverview",
        stpatrick: "stpatricks",
        stpatricks: "stpatricks",
        stpatrickshome: "stpatricks"
      };
      return aliases[key] || key;
    }

    function facilityRecordScore(record = {}) {
      return [
        record.sourceRow ? 20 : 0,
        Number(record.beds || 0) > 0 ? 15 : 0,
        record.address ? 10 : 0,
        record.dba ? 8 : 0,
        record.legalName ? 8 : 0,
        record.commonName ? 4 : 0,
        record.shortName ? 2 : 0
      ].reduce((sum, value) => sum + value, 0);
    }

    function dedupeFacilities(records = []) {
      const merged = new Map();
      records.forEach(record => {
        const normalized = normalizeFacilityRecord(record);
        const candidateKeys = [
          normalized.name,
          normalized.shortName,
          normalized.commonName,
          normalized.dba,
          normalized.legalName,
          ...(Array.isArray(normalized.aliases) ? normalized.aliases : [])
        ].map(facilityAliasKey).filter(Boolean);
        const existingKey = candidateKeys.find(key => merged.has(key)) || candidateKeys[0];
        if (!existingKey) return;
        const existing = merged.get(existingKey) || {};
        const primary = facilityRecordScore(normalized) >= facilityRecordScore(existing) ? normalized : existing;
        const secondary = primary === normalized ? existing : normalized;
        const combinedAliases = uniqueTextList([
          ...(Array.isArray(existing.aliases) ? existing.aliases : []),
          ...(Array.isArray(normalized.aliases) ? normalized.aliases : []),
          existing.name,
          normalized.name,
          existing.shortName,
          normalized.shortName,
          existing.commonName,
          normalized.commonName,
          existing.dba,
          normalized.dba,
          existing.legalName,
          normalized.legalName
        ]);
        const combined = {
          ...secondary,
          ...primary,
          beds: Number(primary.beds || 0) || Number(secondary.beds || 0) || "",
          contracts: Math.max(Number(existing.contracts || 0), Number(normalized.contracts || 0)),
          spendValue: Math.max(Number(existing.spendValue || 0), Number(normalized.spendValue || 0)),
          renewals: Math.max(Number(existing.renewals || 0), Number(normalized.renewals || 0)),
          compliance: Math.max(Number(existing.compliance || 0), Number(normalized.compliance || 0)),
          risk: Math.max(Number(existing.risk || 0), Number(normalized.risk || 0)),
          aliases: combinedAliases
        };
        merged.set(existingKey, combined);
        candidateKeys.forEach(key => merged.set(key, combined));
      });
      return [...new Set([...merged.values()])].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    }

    function facilityHiddenKeys() {
      return new Set((adminSettings.hiddenFacilities || [])
        .flatMap(item => {
          if (typeof item === "string") return [item];
          return [item?.name, item?.dba, item?.legalName, item?.shortName, item?.commonName, ...(Array.isArray(item?.aliases) ? item.aliases : [])];
        })
        .filter(Boolean)
        .map(facilityAliasKey));
    }

    function isHiddenFacilityRecord(record = {}, hiddenKeys = facilityHiddenKeys()) {
      const keys = [
        record.name,
        record.dba,
        record.legalName,
        record.shortName,
        record.commonName,
        ...(Array.isArray(record.aliases) ? record.aliases : [])
      ].map(facilityAliasKey).filter(Boolean);
      return keys.some(key => hiddenKeys.has(key));
    }

    function uniqueTextList(items) {
      return [...new Map((items || [])
        .map(item => cleanMasterName(item))
        .filter(Boolean)
        .map(item => [masterKey(item), item])).values()];
    }

    function categoryCanonicalName(value) {
      const clean = cleanMasterName(value);
      const key = masterKey(clean);
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
        firesafety: "Fire Safety / Sprinkler",
        firesafetysprinkler: "Fire Safety / Sprinkler",
        sprinkler: "Fire Safety / Sprinkler",
        firealarm: "Fire / Alarm / Central Monitoring",
        firealarmcentralmonitoring: "Fire / Alarm / Central Monitoring",
        centralmonitoring: "Fire / Alarm / Central Monitoring",
        securitycamera: "Security Cameras",
        securitycameras: "Security Cameras",
        fooddietary: "Food / Dietary",
        legalscompliance: "Legal / Compliance",
        legalcompliance: "Legal / Compliance",
        rentalparking: "Rental / Parking",
        portablexray: "Portable X-Ray",
        xray: "Portable X-Ray",
        physician: "Physician Services",
        physicianservices: "Physician Services",
        medicaldirector: "Medical Director",
        psychological: "Psychological Services",
        psychologicalservices: "Psychological Services",
        psychology: "Psychological Services",
        psychologyservices: "Psychological Services",
        behavioralhealth: "Psychological Services",
        mentalhealth: "Psychological Services",
        equipmentlease: "Equipment Lease",
        consultingmanagement: "Consulting / Management"
      };
      return aliases[key] || clean;
    }

    const standardServiceCategories = [
      "Landscape / Lawn Care",
      "Snow Removal",
      "Grease Trap / Interceptor",
      "Medical Waste",
      "Waste Removal",
      "Fire Safety / Sprinkler",
      "Fire / Alarm / Central Monitoring",
      "Pest Control",
      "Laundry / Linen",
      "HVAC",
      "Elevator",
      "Maintenance",
      "Security",
      "Security Cameras",
      "Transportation",
      "Rental / Parking",
      "Electric",
      "Gas",
      "Oil",
      "Water / Sewer",
      "Internet / Telecom",
      "IT / Software",
      "Oxygen",
      "Medical Gas",
      "Pharmacy",
      "Dental Services",
      "Lab / Diagnostics",
      "Portable X-Ray",
      "Radiology",
      "Medical Director",
      "Medical Practitioner",
      "Medical Practitioner / Vascular",
      "Physician Services",
      "Psychological Services",
      "Healthcare Services",
      "Rehab / Therapy",
      "Staffing",
      "Food / Dietary",
      "Medical Supplies",
      "Insurance",
      "Legal / Compliance",
      "Equipment Lease",
      "Consulting / Management",
      "Other"
    ];

    function categoryGroupFor(value) {
      const key = masterKey(value);
      if (["electric", "gas", "oil", "watersewer", "internettelecom", "utility"].includes(key)) return "Utilities";
      if (["healthcareservices", "medicaldirector", "medicalpractitioner", "medicalpractitionervascular", "physicianservices", "dentalservices", "radiology", "portablexray", "labdiagnostics", "pharmacy", "rehabtherapy", "therapy", "oxygen", "medicalgas", "medicalsupplies", "respiratorytherapist"].includes(key)) return "Clinical / Healthcare";
      if (["maintenance", "hvac", "elevator", "firesafetysprinkler", "firealarmcentralmonitoring", "pestcontrol", "landscapelawncare", "snowremoval", "wasteremoval", "medicalwaste", "greasetrapinterceptor", "laundry", "laundrylinen", "fooddietary", "security", "securitycameras", "transportation", "rentalparking", "equipmentlease"].includes(key)) return "Facility Services";
      if (["insurance", "legalcompliance", "itsoftware", "staffing", "software", "consultingmanagement", "other"].includes(key)) return "Business / Admin";
      return "Other Services";
    }

    function isUsableCategory(value) {
      const clean = cleanMasterName(value);
      if (!clean || clean.length > 70) return false;
      const key = masterKey(clean);
      return ![
        "needsclassification", "unknown", "notfound", "choosecategory", "chooseservicetype",
        "optional", "letocrreadit", "needsreview", "agreement", "contract"
      ].includes(key);
    }

    function uniqueCategories(extraValues = []) {
      return uniqueTextList([
        ...standardServiceCategories,
        ...categories,
        ...contractTemplates.map(template => template.category),
        ...contracts.map(contract => contract.category || contract.services || contract.contractType || contract.agreementType),
        ...contractData.map(contract => contract.category || contract.services || contract.contractType || contract.agreementType),
        ...vendorsData.flatMap(vendor => [vendor.category, ...(Array.isArray(vendor.services) ? vendor.services : [])]),
        ...utilityAccounts.map(account => account.utilityType),
        ...extraValues
      ].filter(isUsableCategory).map(categoryCanonicalName));
    }

    function categoryOptionsHtml(selectedValue = "", placeholder = "Choose service type", extraValues = []) {
      const selected = categoryCanonicalName(selectedValue);
      const options = uniqueCategories([selected, ...extraValues]).filter(isUsableCategory).sort((a, b) => {
        const groupCompare = categoryGroupFor(a).localeCompare(categoryGroupFor(b));
        return groupCompare || a.localeCompare(b);
      });
      const hasSelected = selected && options.some(option => sameMasterName(option, selected));
      const grouped = options.reduce((groups, option) => {
        const group = categoryGroupFor(option);
        groups[group] = groups[group] || [];
        groups[group].push(option);
        return groups;
      }, {});
      return [
        `<option value="">${escapeHtml(placeholder)}</option>`,
        selected && !hasSelected ? optionHtml(selected, `${selected} - current value`, true) : "",
        ...categoryGroupOrder.filter(group => grouped[group]?.length).map(group => (
          `<optgroup label="${escapeHtml(group)}">${grouped[group].map(option => optionHtml(option, option, sameMasterName(option, selected))).join("")}</optgroup>`
        ))
      ].join("");
    }

    function vendorMasterOptions(extraNames = []) {
      const usableVendor = item => {
        const name = cleanMasterName(item?.name || item);
        return name && !["needs classification", "unknown", "not found", "choose vendor", "new vendor"].includes(name.toLowerCase());
      };
      const canonicalVendor = item => {
        const record = typeof item === "string" ? { name: item } : { ...(item || {}) };
        const key = masterKey(record.name);
        if (key === "patientcareassocates") record.name = "Patient Care Associates";
        if (key === "dentserve" || key === "dentserv") record.name = "Dentserv Dental Services";
        if (key === "liscript" || key === "liscriptnorth") record.name = "Li Script North LLC";
        return record;
      };
      return dedupeRecords([
        ...vendorsData.filter(usableVendor),
        ...vendorSeedData,
        ...contracts.map(contract => ({ name: contract.vendor, category: contract.category, paymentTerms: contract.paymentTerms })).filter(usableVendor),
        ...invoiceUploads.map(invoice => ({ name: invoice.vendor })).filter(usableVendor),
        ...extraNames.map(name => ({ name })).filter(usableVendor)
      ].map(canonicalVendor), "name");
    }

    function vendorSuggestionOptions(currentValue = "", limit = 250) {
      const options = vendorMasterOptions(currentValue ? [currentValue] : []);
      const search = cleanMasterName(currentValue);
      const filtered = search
        ? options
            .map(vendor => ({ vendor, score: vendorNameMatchScore(search, vendor) }))
            .filter(item => item.score >= 55)
            .sort((a, b) => b.score - a.score || a.vendor.name.localeCompare(b.vendor.name))
            .slice(0, limit)
            .map(item => item.vendor)
        : options.slice(0, limit);
      if (currentValue && !filtered.some(vendor => sameVendorName(vendor.name, currentValue))) {
        filtered.unshift({ name: currentValue });
      }
      return filtered;
    }

    function vendorNameMatchScore(value, vendor) {
      const aliases = [vendor?.name, vendor?.legalName, vendor?.dba, ...(Array.isArray(vendor?.aliases) ? vendor.aliases : String(vendor?.aliases || "").split(/[;|,]/))].filter(Boolean);
      const inputKey = masterKey(value);
      if (!inputKey) return 0;
      return aliases.reduce((best, alias) => {
        const aliasKey = masterKey(alias);
        if (!aliasKey) return best;
        if (aliasKey === inputKey) return 100;
        if (aliasKey.includes(inputKey) || inputKey.includes(aliasKey)) {
          const ratio = Math.min(aliasKey.length, inputKey.length) / Math.max(aliasKey.length, inputKey.length);
          return Math.max(best, 70 + Math.round(ratio * 25));
        }
        const inputTokens = fuzzyMatchTokens(value);
        const aliasTokens = fuzzyMatchTokens(alias);
        const overlap = inputTokens.filter(token => aliasTokens.some(other => token === other || (token.length >= 5 && (token.includes(other) || other.includes(token))))).length;
        const tokenScore = Math.round((overlap / Math.max(1, Math.max(inputTokens.length, aliasTokens.length))) * 80);
        return Math.max(best, tokenScore);
      }, 0);
    }

    function vendorDuplicateCandidates(value, minimumScore = 75) {
      return vendorMasterOptions()
        .map(vendor => ({ vendor, score: vendorNameMatchScore(value, vendor) }))
        .filter(item => item.score >= minimumScore)
        .sort((a, b) => b.score - a.score || a.vendor.name.localeCompare(b.vendor.name));
    }

    async function ensureVendorCard(name, details = {}) {
      const vendorName = cleanMasterName(name);
      if (!vendorName || ["needs classification", "unknown", "not found", "choose vendor", "new vendor"].includes(vendorName.toLowerCase())) return null;
      if (isBadVendorReviewValue(vendorName)) return null;
      const existing = vendorsData.find(item => sameMasterName(item.name, vendorName));
      if (existing) return existing;
      if (!backendOnline && !(await checkBackendStatus())) {
        return { name: vendorName, legalName: vendorName, status: "Active", ...details };
      }
      const profile = await apiJson("/api/vendor-profiles", {
        method: "POST",
        body: JSON.stringify({
          name: vendorName,
          legalName: vendorName,
          status: "Active",
          notes: "Created automatically from Vendor Master/search so every vendor option has a vendor card.",
          ...details
        })
      });
      replaceArray(vendorsData, dedupeRecords([...vendorsData, profile], "name"));
      return profile;
    }

    function isBadVendorReviewValue(value) {
      const text = cleanMasterName(value);
      if (!text) return false;
      if (text.length > 90) return true;
      if (/^[a-z]\.\s+/i.test(text)) return true;
      if (text.split(/\s+/).length > 9 && !/\b(llc|l\.l\.c\.|inc|inc\.|corp|corporation|company|co\.|pllc|pc|p\.c\.|services|service|systems|solutions|transport|transportation|protection|security|waste|medical|dental|pharmacy|labs?|electric|gas|water|maintenance|landscap|fire|alarm)\b/i.test(text)) return true;
      if (/[.!?;:]$/.test(text) && text.split(/\s+/).length > 5) return true;
      return /\b(in the event|institution determines|patient requires|whereas|shall|hereunder|agreement|section|article|terms and conditions|confidential information|financial information)\b/i.test(text);
    }

    function vendorDatalistHtml(id, options) {
      return `<datalist id="${escapeHtml(id)}">${options.map(vendor => {
        const detail = [vendor.category, vendor.phone, vendor.email].filter(Boolean).join(" | ");
        return `<option value="${escapeHtml(vendor.name)}">${escapeHtml(detail)}</option>`;
      }).join("")}</datalist>`;
    }

    function optionHtml(value, label = value, selected = false) {
      return `<option value="${escapeHtml(value)}" ${selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
    }

    function sameMasterName(a, b) {
      const left = masterKey(a);
      return left && left === masterKey(b);
    }

    function fuzzyMatchTokens(value) {
      return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s/+-]/g, " ")
        .split(/\s+/)
        .filter(token => token.length > 2 && !["agreement", "contract", "service", "services", "the", "and", "for", "with", "patient", "patients", "resident", "residents", "facility", "provider"].includes(token));
    }

    function expandCategoryTokens(tokens) {
      const expanded = new Set(tokens);
      for (const token of tokens) {
        const compact = masterKey(token);
        const group = categorySynonymGroups.find(items => items.some(item => compact.includes(masterKey(item)) || masterKey(item).includes(compact)));
        if (group) group.forEach(item => expanded.add(item));
      }
      return [...expanded];
    }

    function fuzzyCategoryMatch(value, options = uniqueCategories()) {
      const current = String(value || "").trim();
      if (!current) return null;
      const currentKey = masterKey(current);
      const exact = options.find(option => masterKey(option) === currentKey);
      if (exact) return { value: exact, score: 100, exact: true };
      const currentTokens = expandCategoryTokens(fuzzyMatchTokens(current));
      if (!currentTokens.length) return null;
      const scored = options.map(option => {
        const optionTokens = expandCategoryTokens(fuzzyMatchTokens(option));
        const overlap = optionTokens.filter(token => currentTokens.some(currentToken => currentToken.includes(token) || token.includes(currentToken))).length;
        const compactHit = masterKey(option).length >= 5 && (currentKey.includes(masterKey(option)) || masterKey(option).includes(currentKey));
        const score = (overlap / Math.max(1, optionTokens.length)) * 80 + (compactHit ? 20 : 0);
        return { value: option, score };
      }).sort((a, b) => b.score - a.score);
      return scored[0]?.score >= 45 ? scored[0] : null;
    }

    function splitMultiValue(value) {
      if (Array.isArray(value)) return value.map(item => cleanMasterName(item)).filter(Boolean);
      return String(value || "")
        .split(/\s*(?:,|;|\||\/|\band\b|\+)\s*/i)
        .map(item => cleanMasterName(item))
        .filter(Boolean);
    }

    function normalizeFacilityRecord(record = {}) {
      const bedCount = Number(record.beds || record.bed || 0) || "";
      return {
        ...record,
        name: cleanMasterName(record.name || record.facility || record.dba || record.legalName),
        region: record.region || record.group || record.county || "",
        beds: bedCount || record.beds || "",
        contracts: Number(record.contracts || 0),
        spend: record.spend || "$0",
        compliance: Number(record.compliance || 0),
        renewals: Number(record.renewals || 0),
        missing: Array.isArray(record.missing) ? record.missing : [],
        risk: Number(record.risk || record.compliance || 0),
        dba: record.dba || "",
        legalName: record.legalName || "",
        address: record.address || record.street || "",
        cityStateZip: record.cityStateZip || ""
      };
    }

    function facilityMasterOptions() {
      const masterProfiles = (adminSettings.facilityProfiles || []).map(normalizeFacilityRecord);
      const liveFacilities = facilities.map(normalizeFacilityRecord).filter(f =>
        f.sourceRow
        || f.address
        || f.legalName
        || f.dba
        || f.shortName
        || f.commonName
        || Number(f.beds || 0) > 0
      );
      const contractFacilities = contractData
        .flatMap(contract => splitMultiValue(contract.facilities || contract.facility))
        .filter(name => name && !["needs classification", "unknown", "all facilities"].includes(name.toLowerCase()))
        .map(name => ({ name, source: "contract index" }));
      const userFacilities = (appUsers || [])
        .flatMap(user => splitMultiValue(user.facility || user.facilities))
        .filter(name => name && !["all"].includes(name.toLowerCase()))
        .map(name => ({ name, source: "user access" }));
      const hiddenKeys = facilityHiddenKeys();
      return dedupeFacilities([
        ...facilitySeedData,
        ...masterProfiles,
        ...liveFacilities,
        ...contractFacilities,
        ...userFacilities
      ], "name").filter(record => !isHiddenFacilityRecord(record, hiddenKeys));
    }

    function facilityDropdownLabel(record = {}) {
      const normalized = normalizeFacilityRecord(record);
      const beds = Number(normalized.beds || 0);
      return beds > 0 ? `${normalized.name} (${beds} beds)` : normalized.name;
    }

    function contractFieldFromRecord(record = {}, labels = []) {
      const wanted = (Array.isArray(labels) ? labels : [labels]).map(reviewCanonicalLabel);
      return (record.extractedFields || record.approvedFields || []).find(field => wanted.includes(reviewCanonicalLabel(field?.label || ""))) || null;
    }

    function safeContractDisplayValue(record = {}, labels = [], keys = [], fallback = "") {
      const keyList = Array.isArray(keys) ? keys : [keys];
      const fields = (record.extractedFields || record.approvedFields || []);
      const field = contractFieldFromRecord(record, labels);
      const label = Array.isArray(labels) ? labels[0] : labels;
      const canonical = reviewCanonicalLabel(label || field?.label || keyList[0] || "");
      const candidates = [
        ...keyList.map(key => ({ value: record?.[key], source: record?.[`${key}Source`] || "" })),
        field ? { value: field.value, source: field.source || field.snippet || "" } : null,
        ...fields
          .filter(item => (Array.isArray(labels) ? labels : [labels]).map(reviewCanonicalLabel).includes(reviewCanonicalLabel(item?.label || "")))
          .map(item => ({ value: item.value, source: item.source || item.snippet || "" }))
      ].filter(Boolean);

      for (const candidate of candidates) {
        const text = String(candidate.value || "").replace(/\s+/g, " ").trim();
        if (!text) continue;
        if (reviewValueIsEmpty(text)) continue;
        if (canonical === "vendor" && isBadVendorReviewValue(text)) continue;
        if (["cost", "rate / fee", "fee", "contract value", "monthly cost"].includes(canonical)) {
          const combined = `${text} ${candidate.source || ""}`;
          if (/\b(insurance|liability|claim|occurrence|aggregate|additional insured|policy|coverage|confidential|financial information)\b/i.test(combined)) continue;
          if (!/(\$|\b\d+(?:\.\d+)?\s*%|\b(?:fee schedule|rate|fee|charge|cost|monthly|annual|per month|per day|per mile|per visit|per square foot|per sq ft|per linear foot|per unit|delivery)\b)/i.test(text)) continue;
        }
        if (["payment terms", "days payable"].includes(canonical)) {
          if (text.length < 2 || /^[.\-_/]+$/.test(text)) continue;
          if (!/\b(?:net\s*\d{1,3}|\d{1,3}\s*days?|due|payable|paid|invoice|receipt|completion|monthly|advance)\b/i.test(text)) continue;
        }
        if (["start date", "start of services", "effective date", "end date", "signature date", "signed date"].includes(canonical)) {
          if (text.length > 70) continue;
          if (!/\b(?:\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i.test(text)) continue;
        }
        return text;
      }
      return fallback;
    }

    function readableContractName(record = {}, vendor = "", facility = "", service = "", start = "") {
      const cleanPart = value => {
        const clean = String(value || "")
          .replace(/\.(pdf|docx?)$/i, "")
          .replace(/[_|]+/g, " ")
          .replace(/\s*[-\u2013\u2014]\s*/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        return !clean || /^(needs (?:review|classification)|unknown|not found|tbd|n\/a)$/i.test(clean) ? "" : clean.slice(0, 70);
      };
      const fullyReviewed = String(record.reviewStatus || "").toLowerCase() === "approved"
        || Boolean(record.approvedAt)
        || (Array.isArray(record.approvedFields) && record.approvedFields.length > 0 && !/needs review|pending/i.test(String(record.status || "")));
      if (!fullyReviewed) return cleanPart(record.name) || "Untitled Contract";
      const vendorName = cleanPart(vendor);
      const serviceName = cleanPart(service);
      if (!vendorName || !serviceName) return cleanPart(record.name) || "Untitled Contract";
      const facilityName = cleanPart(String(facility || "").split(/[;|]/)[0]);
      const year = String(start || record.signatureDate || record.signedDate || "").match(/\b(?:19|20)\d{2}\b/)?.[0] || "";
      const documentType = cleanPart(record.documentType || "");
      const suffix = /\b(amendment|addendum|renewal)\b/i.test(documentType) ? documentType : "";
      const parts = [vendorName, serviceName, facilityName, year, suffix]
        .filter(Boolean)
        .filter((part, index, all) => all.findIndex(item => masterKey(item) === masterKey(part)) === index);
      return parts.join(" - ").slice(0, 180);
    }

    function normalizeContract(record) {
      const safeVendor = safeContractDisplayValue(record, "Vendor", ["vendor"], "");
      const safeFacility = safeContractDisplayValue(record, "Facility", ["facility"], "");
      const safeCategory = fuzzyCategoryMatch(record.category || record.services || record.service || "")?.value || record.category || record.services || record.service || "";
      const safePaymentTerms = safeContractDisplayValue(record, "Payment Terms", ["paymentTerms"], "");
      const safeFee = safeContractDisplayValue(record, ["Fee", "Rate / Fee", "Cost"], ["fee", "rate", "spend"], "");
      const safeMonthlyCost = safeContractDisplayValue(record, "Monthly Cost", ["monthlyCost"], "");
      const safeStart = safeContractDisplayValue(record, ["Start of Services", "Start Date", "Effective Date"], ["startOfServices", "start", "startDate"], "");
      const safeSignature = safeContractDisplayValue(record, ["Signature Date", "Signed Date"], ["signatureDate", "signedDate"], "");
      return {
        id: record.id,
        name: readableContractName(record, safeVendor, safeFacility, safeCategory, safeStart),
        sourceDocumentName: record.sourceDocumentName || record.uploadedFileName || record.documentTitle || record.name || "",
        facility: cleanMasterName(safeFacility) || "Needs Classification",
        facilities: record.facilities || safeFacility || "",
        vendor: cleanMasterName(safeVendor) || "Needs Classification",
        category: safeCategory || "Needs Classification",
        services: safeCategory || "",
        contractStatus: record.contractStatus || record.status || "",
        signatureDate: safeSignature,
        start: safeStart,
        startOfServices: safeStart,
        initialContractLength: record.initialContractLength || "",
        renewalTerm: record.renewalTerm || "",
        termination: record.termination || record.terminationClause || "",
        paymentTerms: safePaymentTerms,
        daysPayable: record.daysPayable || "",
        fee: safeFee,
        monthlyCost: safeMonthlyCost,
        monthlySpend: record.monthlySpend || "",
        annualCost: record.annualCost || "",
        annualSpend: record.annualSpend || "",
        contractValue: record.contractValue || "",
        totalAnnualSpend: record.totalAnnualSpend || "",
        cost: record.cost || "",
        price: record.price || "",
        costBedMonth: record.costBedMonth || "",
        beds: record.beds || "",
        bedCount: record.bedCount || record.bed_count || "",
        quantityOfServices: record.quantityOfServices || "",
        end: record.end || record.endDate || "",
        renewal: record.renewal || record.renewalDate || "",
        spend: safeFee || "TBD",
        autoRenewal: record.autoRenewal || "Unknown",
        terminationClause: record.terminationClause || "Unknown",
        status: record.status || "Needs Review",
        risk: record.risk || "Medium",
        owner: record.owner || "Contract Dept",
        url: record.url || record.shareSyncUrl || "Pending ShareSync link",
        localFilePath: record.localFilePath || "",
        shareSyncLocalPath: record.shareSyncLocalPath || "",
        shareSyncFolderPath: record.shareSyncFolderPath || "",
        shareSyncUrl: record.shareSyncUrl || "",
        uploadedFileName: record.uploadedFileName || "",
        documentType: record.documentType || "Contract",
        parentContractId: record.parentContractId || "",
        parentContractName: record.parentContractName || "",
        relatedDocuments: Array.isArray(record.relatedDocuments) ? record.relatedDocuments : [],
        relatedMatchConfidence: record.relatedMatchConfidence || 0,
        relatedMatchReasons: record.relatedMatchReasons || [],
        utilityAccountNumber: record.utilityAccountNumber || "",
        meterNumber: record.meterNumber || "",
        serviceAddress: record.serviceAddress || "",
        vendorMailingAddress: record.vendorMailingAddress || record.vendorAddress || record.mailingAddress || "",
        vendorPhone: record.vendorPhone || record.phone || "",
        vendorEmail: record.vendorEmail || record.email || "",
        documentTitle: record.documentTitle || "",
        agreementType: record.agreementType || record.contractType || "",
        purposeScope: record.purposeScope || "",
        categoryReason: record.categoryReason || "",
        utilityAccountMatch: record.utilityAccountMatch || null,
        ocrText: record.ocrText || record.fullText || record.sourceText || "",
        ocrTextPreview: record.ocrTextPreview || "",
        signer: record.signer || "",
        signerTitle: record.signerTitle || "",
        signedDate: record.signedDate || "",
        extractedFields: record.extractedFields || [],
        extractedFeeLines: record.extractedFeeLines || [],
        reviewStatus: record.reviewStatus || "Pending",
        approvedAt: record.approvedAt || ""
      };
    }

    async function apiJson(path, options = {}) {
      if (typeof fetch !== "function" && typeof XMLHttpRequest === "function") {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open(options.method || "GET", `${apiBase}${path}`);
          xhr.withCredentials = true;
          xhr.setRequestHeader("content-type", options.headers?.["content-type"] || "application/json");
          xhr.onload = () => {
            if (xhr.status < 200 || xhr.status >= 300) {
              reject(new Error(xhr.responseText || `Request failed: ${xhr.status}`));
              return;
            }
            try {
              resolve(xhr.responseText ? JSON.parse(xhr.responseText) : {});
            } catch (error) {
              reject(error);
            }
          };
          xhr.onerror = () => reject(new Error("Cannot reach local server."));
          xhr.send(options.body || null);
        });
      }
      const response = await fetch(`${apiBase}${path}`, {
        credentials: apiBase ? "omit" : "same-origin",
        headers: { "content-type": "application/json", ...(options.headers || {}) },
        ...options
      });
      if (!response.ok) {
        const text = await response.text();
        let message = text || `Request failed: ${response.status}`;
        let parsed = null;
        try {
          parsed = JSON.parse(text);
          message = parsed.error || message;
        } catch {}
        const error = new Error(message);
        if (parsed?.detail) error.detail = parsed.detail;
        if (parsed?.fields) error.fields = parsed.fields;
        if (parsed?.nextStep) error.nextStep = parsed.nextStep;
        error.status = response.status;
        throw error;
      }
      return response.json();
    }

    function activeSectionId() {
      return document.querySelector(".section.active")?.id || "dashboard";
    }

    function sectionPresenceLabel(section = activeSectionId()) {
      const button = document.querySelector(`.nav-button[data-section="${section}"]`);
      const label = button?.querySelector("strong")?.textContent
        || button?.querySelector(".nav-label")?.textContent
        || button?.textContent
        || section;
      return String(label || section || "Dashboard").replace(/\s+/g, " ").trim();
    }

    function setActiveWorkContext(next = {}) {
      activeWorkContext = {
        ...activeWorkContext,
        ...next,
        itemId: next.itemId ?? activeWorkContext.itemId ?? "",
        itemName: next.itemName ?? activeWorkContext.itemName ?? "",
        action: next.action || activeWorkContext.action || "Viewing"
      };
      sendPresenceUpdate(activeWorkContext.action, { immediate: Boolean(next.immediate) });
    }

    function sendPresenceUpdate(action = "Viewing", options = {}) {
      if (!backendOnline) return;
      const now = Date.now();
      if (!options.immediate && now - lastPresenceSentAt < 8000) return;
      lastPresenceSentAt = now;
      const section = activeSectionId();
      apiJson("/api/presence", {
        method: "POST",
        body: JSON.stringify({
          section,
          page: sectionPresenceLabel(section),
          itemId: activeWorkContext.itemId || "",
          itemName: activeWorkContext.itemName || "",
          action: action || activeWorkContext.action || "Viewing"
        })
      }).catch(() => {});
    }

    const helpAnswerLibrary = [
      { page: "review", title: "Review Queue", keywords: "review queue needs review approve approval save field source proof required submit wrong ocr", answer: "Open Review Queue, choose the contract, check required fields against Source/Search or the original file, save corrected fields, then submit when required fields are proven." },
      { page: "upload", title: "Upload and ShareSync", keywords: "upload pdf word docx sharesync folder save file original source", answer: "Use Upload for PDF, Word, image, pasted text, or ShareSync paths. After review/approval, the source file should link to the contract and file to the correct facility folder." },
      { page: "contracts", title: "Find a Contract", keywords: "search find contract vendor facility service term payment notice fee rate", answer: "Use Contracts to search by vendor, facility, service/category, contract name, payment term, renewal wording, notice language, fee, or source text words." },
      { page: "finance", title: "Finance and Cost", keywords: "finance cost fee rate annual spend monthly ppd bed beds missing money per mile per square foot", answer: "Finance works when cost/rate, unit, billing cycle, quantity/frequency, facility, and bed count are saved. Per-mile or per-service rates should not annualize unless quantity or frequency is proven." },
      { page: "facilities", title: "Facilities and Beds", keywords: "facility beds bed count aliases legal entity dba address", answer: "Facilities hold bed count, address, DBA/legal names, and aliases. Facility must be saved separately from vendor so finance, ShareSync, reports, and access scope work correctly." },
      { page: "vendors", title: "Vendor Cards", keywords: "vendor card alias duplicate history profile service contact", answer: "Vendor cards connect approved contracts, aliases, contacts, services, facilities served, and history. Correct vendor names teach future matching and prevent duplicates." },
      { page: "reports", title: "Reports", keywords: "report excel export leadership renewal 30 60 90 custom columns", answer: "Reports answer business questions from saved data. Use filters and columns to build a report, then export to Excel. Renewal reports depend on end date, auto-renewal, and notice language." },
      { page: "admin", title: "Users and Access", keywords: "admin user invite password login role scope permission active staff current work", answer: "Admin creates users, assigns role and scope, sends invites, and can see Active Staff / Current Work. Scope controls which facilities, teams, or fields a person can work on." },
      { page: "builder", title: "Contract Builder", keywords: "builder draft contract legal terms template agreement create word pdf", answer: "Contract Builder drafts standard facility-side agreements. After the signed version comes back, upload the final PDF or Word file so it becomes the official searchable record." },
      { page: "invoices", title: "Invoice Review", keywords: "invoice match approve payment compare vendor facility fee exception", answer: "Invoice Review temporarily reads an invoice, matches it to a contract, compares vendor/facility/fees/terms, and flags exceptions. It is a checking tool, not the permanent file cabinet." },
      { page: "help", title: "No Guessing Rule", keywords: "guess wrong assume ai ocr confidence blank needs review prove proof", answer: "The app should not guess key data. If the contract does not prove vendor, facility, date, cost, renewal, or termination, leave it blank or mark Needs Review until a person verifies the source." }
    ];

    function scoreHelpAnswer(query, item) {
      const terms = String(query || "").toLowerCase().split(/[^a-z0-9$./]+/).filter(term => term.length > 1);
      const haystack = `${item.title} ${item.keywords} ${item.answer}`.toLowerCase();
      return terms.reduce((score, term) => score + (haystack.includes(term) ? (item.title.toLowerCase().includes(term) ? 3 : 1) : 0), 0);
    }

    function renderHelpAnswer(query = "") {
      const box = document.getElementById("helpAnswerBox");
      if (!box) return;
      const cleanQuery = String(query || "").trim();
      if (!cleanQuery) {
        box.innerHTML = `<strong>Ask a question above.</strong><span>Search OCR, ShareSync, review, finance, reports, users, or access.</span>`;
        return;
      }
      const matches = helpAnswerLibrary
        .map(item => ({ ...item, score: scoreHelpAnswer(cleanQuery, item) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
      const fallback = matches.length ? "" : `
        <div class="help-answer-result">
          <strong>No exact match yet.</strong>
          <span>Try words like OCR, approve, ShareSync, vendor, facility, cost, PPD, report, user, role, or invoice.</span>
        </div>
      `;
      box.innerHTML = fallback || matches.map(item => `
        <div class="help-answer-result">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(item.answer)}</span>
          </div>
          <button class="btn ghost" type="button" onclick="switchSection('${jsArg(item.page)}')">Open</button>
        </div>
      `).join("");
    }

    function selectedTemplateRecord() {
      const name = document.getElementById("templateName")?.value || contractTemplates[0]?.name || "";
      return contractTemplates.find(template => template.name === name) || {
        name: name || "Custom Contract",
        contractType: "Service Agreement",
        category: "",
        length: "1 year",
        renewal: "Unknown",
        renewalTerm: "",
        termination: "",
        notice: "",
        paymentTerms: "",
        daysPayable: "",
        terms: "Custom contract. Fill in the service, scope, pricing, term, renewal, termination, insurance, compliance, and special language before sending.",
        language: ""
      };
    }

    function templateField(label, value, source = "Template Draft") {
      return {
        label,
        value: value || "",
        confidence: 100,
        source,
        sourceText: value || "",
        approved: true
      };
    }

    function templateFacilityBeds(facilityName) {
      const profile = facilityMasterOptions().find(item => sameMasterName(item.name, facilityName));
      return Number(profile?.beds || 0) || 0;
    }

    function templateFacilityProfile(facilityName) {
      const name = cleanMasterName(facilityName || "");
      if (!name) return {};
      return facilityMasterOptions().find(item => sameMasterName(item.name, name) || facilityNamesMatch(item.name, name)) || {};
    }

    function templateFacilityAddress(facilityName) {
      const profile = templateFacilityProfile(facilityName);
      return [profile.address, profile.cityStateZip].filter(Boolean).join(profile.address && profile.cityStateZip ? ", " : "") || profile.address || "";
    }

    function standardFacilityContractLanguage() {
      return [
        "6.1 Services. Vendor shall provide the services described in this Agreement in a timely, professional, workmanlike, and legally compliant manner. Vendor shall supply all labor, supervision, equipment, materials, licenses, permits, and approvals required to perform the services unless this Agreement states otherwise.",
        "",
        "6.2 Compliance. Vendor shall comply with all applicable federal, state, and local laws, rules, regulations, codes, facility policies, safety requirements, privacy requirements, and healthcare compliance requirements that apply to the services.",
        "",
        "6.3 Licenses and Qualifications. Vendor represents that it is properly licensed, qualified, trained, and authorized to perform the services. Vendor shall promptly notify Facility of any suspension, expiration, restriction, investigation, or loss of any license, certification, insurance, permit, approval, or authority needed to perform the services.",
        "",
        "6.4 Insurance. Vendor shall maintain insurance coverage appropriate for the services, including commercial general liability, workers compensation, automobile liability where applicable, professional liability where applicable, and any additional insurance required by Facility. Vendor shall provide certificates of insurance upon request and shall not perform services if required insurance is not active.",
        "",
        "6.5 Confidentiality and HIPAA. Vendor shall protect Facility, resident, patient, employee, financial, operational, and confidential information. If Vendor receives, creates, maintains, or transmits protected health information, Vendor shall comply with HIPAA and execute a Business Associate Agreement if required.",
        "",
        "6.6 Billing and Payment. Vendor may invoice only for authorized services actually provided and supported by the applicable rate schedule, purchase order, written approval, or this Agreement. Facility may dispute any invoice that is inaccurate, unsupported, outside the contract scope, or inconsistent with agreed pricing.",
        "",
        "6.7 Indemnification. Vendor shall defend, indemnify, and hold harmless Facility and its owners, officers, directors, employees, agents, affiliates, successors, and assigns from claims, damages, losses, penalties, fines, costs, expenses, and reasonable attorneys' fees arising from Vendor's negligence, willful misconduct, breach of this Agreement, failure to comply with law, or failure to perform the services.",
        "",
        "6.8 Termination for Cause. Facility may terminate immediately for cause, including material breach, compliance risk, resident or patient safety concern, insurance failure, license issue, fraud, misconduct, or failure to perform.",
        "",
        "6.9 Records and Audit. Vendor shall maintain accurate records relating to services, invoices, licenses, insurance, and compliance obligations. Vendor shall provide records reasonably requested by Facility for audit, reimbursement, compliance, payment review, or regulatory purposes.",
        "",
        "6.10 Independent Contractor. Vendor is an independent contractor and is not an employee, agent, partner, joint venturer, or representative of Facility. Vendor shall be responsible for its employees, contractors, taxes, benefits, supervision, training, and compliance obligations.",
        "",
        "6.11 No Exclusivity. Unless this Agreement expressly states otherwise, Facility may use other vendors or providers for the same or similar services.",
        "",
        "6.12 Assignment and Subcontracting. Vendor shall not assign this Agreement or subcontract material services without Facility's prior written approval. Any approved subcontractor shall be bound by obligations at least as protective of Facility as those contained in this Agreement.",
        "",
        "6.13 Notices. Any notice required under this Agreement shall be given in writing to the notice address or contact designated by the receiving Party, or to another address later designated in writing.",
        "",
        "6.14 Entire Agreement; Amendments. This Agreement, together with any approved exhibits, schedules, attachments, and Business Associate Agreement where applicable, constitutes the entire agreement of the Parties regarding the services. Any amendment must be in writing and signed by authorized representatives of both Parties.",
        "",
        "6.15 Governing Law and Venue. This Agreement shall be governed by the laws of the state where Facility is located unless another governing law is expressly stated in the business terms. Any venue requirement shall be applied only as approved by Facility and legal counsel.",
        "",
        "6.16 Attachments. Any approved schedule, rate sheet, service description, Business Associate Agreement, certificate of insurance, W-9, proposal, statement of work, or other attachment referenced in this Agreement is incorporated only to the extent accepted by Facility in writing.",
        "",
        "6.17 Electronic Signatures and Counterparts. This Agreement may be executed in counterparts and by electronic signature, each of which shall be deemed an original and all of which together shall constitute one agreement."
      ].join("\n");
    }

    function serviceSpecificTemplateLanguage(service = "") {
      const key = String(service || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (/(transport|ambulette|ambulance)/.test(key)) {
        return "SERVICE-SPECIFIC TERMS: Transportation vendor shall maintain all vehicle licenses, driver qualifications, insurance, dispatch records, trip records, Medicaid/Medicare or payer compliance requirements where applicable, and resident safety procedures. Rates must clearly state base rate, mileage, wait time, wheelchair/stretcher charges, no-show charges, and any after-hours or holiday charges.";
      }
      if (/(medicalwaste|wasteremoval|waste|shredding|grease)/.test(key)) {
        return "SERVICE-SPECIFIC TERMS: Waste vendor shall comply with all handling, pickup, manifest, storage, disposal, OSHA, environmental, and documentation requirements. Pricing must clearly state container size, pickup frequency, per-unit rate, minimum charge, surcharge rules, and any fuel, disposal, compliance, or environmental fees.";
      }
      if (/(electric|gas|water|sewer|utility|telecom|internet)/.test(key)) {
        return "SERVICE-SPECIFIC TERMS: Utility or telecom vendor shall identify service addresses, account numbers, meters, recurring charges, usage rates, taxes, surcharges, installation charges, renewal terms, service levels, outage support, and cancellation requirements.";
      }
      if (/(pharmacy|therapy|healthcare|psycholog|medical|lab|diagnostic|dental|radiology)/.test(key)) {
        return "SERVICE-SPECIFIC TERMS: Healthcare vendor shall maintain professional licenses, credentialing, documentation, resident/patient privacy, billing compliance, quality standards, and facility reporting requirements. The Agreement should clearly state covered services, excluded services, rates, payer rules, supervision, and documentation responsibilities.";
      }
      if (/(snow|landscape|lawn|maintenance|hvac|elevator|fire|alarm|pest|security)/.test(key)) {
        return "SERVICE-SPECIFIC TERMS: Facility service vendor shall define covered locations, service frequency, response time, emergency coverage, materials, equipment, labor, weather/event triggers where applicable, inspection obligations, and any excluded work or extra charges.";
      }
      return "";
    }

    function calculateCostPerBedMonth(monthlyCost, facilityName) {
      const amount = Number(String(monthlyCost || "").replace(/[^0-9.]/g, ""));
      const beds = templateFacilityBeds(facilityName);
      if (!amount || !beds) return "";
      return `$${(amount / beds).toFixed(2)}`;
    }

    function templateDraftName() {
      const vendor = cleanMasterName(document.getElementById("templateVendor")?.value || "");
      const facility = cleanMasterName(document.getElementById("templateFacility")?.value || "");
      const category = cleanMasterName(document.getElementById("templateCategory")?.value || "");
      const type = cleanMasterName(document.getElementById("templateContractType")?.value || "Contract");
      return [facility, vendor, category || type].filter(Boolean).join(" - ") || "New Template Contract";
    }

    function syncTemplateDraftName(force = false) {
      const nameInput = document.getElementById("templateContractName");
      if (!nameInput) return;
      if (force || !nameInput.value || nameInput.dataset.auto === "1") {
        nameInput.value = templateDraftName();
        nameInput.dataset.auto = "1";
      }
    }

    function syncTemplateFacilityProfile() {
      const facility = document.getElementById("templateFacility")?.value || "";
      const addressInput = document.getElementById("templateFacilityAddress");
      if (addressInput) addressInput.value = templateFacilityAddress(facility);
      const legalInput = document.getElementById("templateFacilityLegalName");
      if (legalInput && !legalInput.value) legalInput.value = templateFacilityProfile(facility)?.legalName || cleanMasterName(facility);
      const noticeInput = document.getElementById("templateFacilityNoticeAddress");
      if (noticeInput && !noticeInput.value) noticeInput.value = templateFacilityAddress(facility);
    }

    function refreshTemplateStandardLanguage() {
      const languageInput = document.getElementById("templateBaseLanguage");
      if (!languageInput) return;
      const template = selectedTemplateRecord();
      const service = document.getElementById("templateCategory")?.value || template?.category || template?.contractType || "";
      languageInput.value = [
        template?.language || template?.terms || "",
        serviceSpecificTemplateLanguage(service),
        standardFacilityContractLanguage()
      ].filter(Boolean).join("\n\n");
    }

    function saveBuilderLearning(values = currentTemplateDraftValues()) {
      const category = categoryCanonicalName(values.category || "");
      if (category && isUsableCategory(category) && !categories.some(item => sameMasterName(item, category))) {
        categories.push(category);
        const learnedCategories = uniqueTextList([
          ...JSON.parse(localStorage.getItem("contractBuilderCategories") || "[]"),
          category
        ].filter(Boolean));
        localStorage.setItem("contractBuilderCategories", JSON.stringify(learnedCategories));
      }
      const templateName = cleanMasterName(values.templateName || "");
      const standardNames = new Set(["custom", "custom contract", "other", "new template"]);
      if (templateName && !standardNames.has(templateName.toLowerCase()) && !contractTemplates.some(template => sameMasterName(template.name, templateName))) {
        const learnedTemplate = {
          name: templateName,
          contractType: values.contractType || "Service Agreement",
          category: category || values.category || "Other",
          length: values.length || "1 year",
          renewal: values.autoRenewal || "Unknown",
          renewalTerm: values.renewalTerm || "",
          termination: values.termination || "",
          notice: values.notice || "",
          paymentTerms: values.paymentTerms || "",
          daysPayable: values.daysPayable || "",
          terms: values.specialTerms || "Custom saved template.",
          language: values.baseLanguage || ""
        };
        contractTemplates.push(learnedTemplate);
        const learnedTemplates = JSON.parse(localStorage.getItem("contractBuilderTemplates") || "[]");
        learnedTemplates.push(learnedTemplate);
        localStorage.setItem("contractBuilderTemplates", JSON.stringify(learnedTemplates));
      }
    }

    function appendTemplateTerm(kind = "custom") {
      const target = document.getElementById("templateSpecialTerms");
      if (!target) return;
      const clauses = {
        insurance: "Insurance Requirement: Vendor shall maintain insurance coverage appropriate for the services and shall provide certificates of insurance upon Facility request before beginning services.",
        hipaa: "HIPAA / Confidentiality: Vendor shall protect all resident, patient, employee, operational, financial, and confidential information and shall comply with HIPAA where applicable.",
        termination: "Termination: Facility may terminate this Agreement upon written notice, and may terminate immediately for cause, compliance risk, resident or patient safety concern, insurance failure, license issue, fraud, misconduct, or material breach.",
        billing: "Billing: Vendor shall invoice only for authorized services actually provided and supported by the agreed rate, fee schedule, purchase order, written approval, or this Agreement.",
        compliance: "Compliance: Vendor shall comply with Facility policies, applicable federal and state laws, healthcare compliance requirements, exclusion screening requirements, and all licensing or regulatory requirements applicable to the services.",
        custom: ""
      };
      const text = clauses[kind] || "";
      if (!text) return;
      target.value = [target.value.trim(), text].filter(Boolean).join("\n\n");
      target.focus();
    }

    function applyTemplateDefaults() {
      const template = selectedTemplateRecord();
      if (!template) return;
      const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value || "";
      };
      const templateInput = document.getElementById("templateName");
      if (templateInput && !templateInput.value) templateInput.value = template.name || "";
      setValue("templateContractType", template.contractType);
      setValue("templateCategory", template.category);
      setValue("templateInitialLength", template.length);
      setValue("templateAutoRenewal", template.renewal);
      setValue("templateRenewalTerm", template.renewalTerm);
      setValue("templateTermination", template.termination);
      setValue("templateNotice", template.notice);
      setValue("templatePaymentTerms", template.paymentTerms);
      setValue("templateDaysPayable", template.daysPayable);
      setValue("templateSpecialTerms", template.terms);
      setValue("templateBaseLanguage", [template.language || template.terms, serviceSpecificTemplateLanguage(template.category || template.contractType), standardFacilityContractLanguage()].filter(Boolean).join("\n\n"));
      syncTemplateDraftName(true);
      syncTemplateFacilityProfile();
      toggleBaaBuilderFinance();
    }

    function builderIsBaa() {
      return /\b(business\s+associate\s+agreement|baa|data\s+privacy)\b/i.test([
        document.getElementById("templateName")?.value,
        document.getElementById("templateContractType")?.value,
        document.getElementById("templateCategory")?.value
      ].filter(Boolean).join(" "));
    }

    function toggleBaaBuilderFinance() {
      const isBaa = builderIsBaa();
      const defaults = {
        templatePaymentTerms: "No payment - data sharing agreement",
        templateDaysPayable: "Not applicable",
        templateFee: "No cost",
        templateMonthlyCost: ""
      };
      Object.entries(defaults).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (!input) return;
        if (isBaa) input.value = value;
        input.disabled = isBaa;
        input.setAttribute("aria-disabled", String(isBaa));
      });
      document.querySelectorAll("[data-baa-finance-field]").forEach(field => field.classList.toggle("field-not-applicable", isBaa));
      const note = document.getElementById("baaFinanceNote");
      if (note) note.hidden = !isBaa;
    }

    function applyBaaBuilderDefaults() {
      const template = contractTemplates.find(item => /business associate agreement|\bbaa\b/i.test(`${item.name} ${item.contractType}`));
      const templateInput = document.getElementById("templateName");
      if (templateInput && template) templateInput.value = template.name;
      applyTemplateDefaults();
      const setValue = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.value = value;
      };
      setValue("templateContractType", "Business Associate Agreement");
      setValue("templateCategory", "BAA / Data Privacy");
      setValue("templateAutoRenewal", "Ongoing");
      setValue("templateInitialLength", "Ongoing while protected health information is shared");
      setValue("templateRenewalTerm", "No renewal cycle");
      setValue("templatePaymentTerms", "No payment - data sharing agreement");
      setValue("templateDaysPayable", "Not applicable");
      setValue("templateFee", "No cost");
      setValue("templateMonthlyCost", "");
      setValue("templateAttachments", "Underlying service agreement, if applicable");
      syncTemplateDraftName(true);
      refreshTemplateStandardLanguage();
      toggleBaaBuilderFinance();
      showToast("BAA draft ready. Add the parties, effective date, PHI purpose, and signers.");
    }

    function templateContractFormHtml(mode = "modal") {
      const facilityOptions = facilityMasterOptions();
      const vendorOptions = vendorMasterOptions();
      const templateOptions = contractTemplates.map(template => `<option value="${escapeHtml(template.name)}"></option>`).join("");
      const facilityList = facilityOptions.map(f => `<option value="${escapeHtml(f.name)}"></option>`).join("");
      const vendorList = vendorOptions.map(v => `<option value="${escapeHtml(v.name)}"></option>`).join("");
      const categoryList = uniqueCategories().map(category => `<option value="${escapeHtml(category)}"></option>`).join("");
      const cancelButton = mode === "modal" ? `<button class="btn" type="button" onclick="closeModal()">Cancel</button>` : "";
      const submitText = mode === "page" ? "Save Draft Record" : "Create Draft Contract";
      return `
        <form id="templateContractForm" class="builder-form" onsubmit="event.preventDefault(); saveTemplateContractDraft();">
          <div class="builder-form-header">
            <div>
              <strong>Draft setup</strong>
              <span>Choose a template or type a new one. Saved drafts teach future Builder options.</span>
            </div>
            <div class="table-actions"><button class="btn ghost" type="button" onclick="applyBaaBuilderDefaults()">Add BAA</button><span class="badge blue">Draft</span></div>
          </div>
          <div class="builder-section">
            <h4>Parties and Template</h4>
            <div class="metric-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));align-items:start">
            <label class="field">Template
              <input id="templateName" list="templateNameList" placeholder="Choose or type template" onchange="applyTemplateDefaults()" />
              <datalist id="templateNameList">${templateOptions}</datalist>
            </label>
            <label class="field">Contract Name
              <input id="templateContractName" oninput="this.dataset.auto='0'" placeholder="Facility - Vendor - Service" />
            </label>
            <label class="field">Client / Facility
              <input id="templateFacility" list="templateFacilityList" placeholder="Choose facility" oninput="syncTemplateDraftName(); syncTemplateFacilityProfile();" required />
              <datalist id="templateFacilityList">${facilityList}</datalist>
            </label>
            <label class="field">Facility Legal Name
              <input id="templateFacilityLegalName" placeholder="Legal entity name" />
            </label>
            <label class="field">Facility Address
              <input id="templateFacilityAddress" placeholder="Auto from facility profile" readonly />
            </label>
            <label class="field">Facility Notice Address
              <input id="templateFacilityNoticeAddress" placeholder="Notice address" />
            </label>
            <label class="field">Vendor / Provider
              <input id="templateVendor" list="templateVendorList" placeholder="Choose or type vendor" oninput="syncTemplateDraftName()" required />
              <datalist id="templateVendorList">${vendorList}</datalist>
            </label>
            <label class="field">Vendor Legal Name
              <input id="templateVendorLegalName" placeholder="Vendor legal entity" />
            </label>
            <label class="field">Vendor Notice Address
              <input id="templateVendorNoticeAddress" placeholder="Vendor notice address" />
            </label>
            <label class="field">Service / Category
              <input id="templateCategory" list="templateCategoryList" placeholder="Choose or type service" oninput="syncTemplateDraftName(); refreshTemplateStandardLanguage(); toggleBaaBuilderFinance();" />
              <datalist id="templateCategoryList">${categoryList}</datalist>
            </label>
            <label class="field">Contract Type
              <input id="templateContractType" list="templateContractTypeList" placeholder="Service Agreement or BAA" oninput="toggleBaaBuilderFinance()" />
              <datalist id="templateContractTypeList"><option value="Service Agreement"></option><option value="Business Associate Agreement"></option><option value="Amendment"></option><option value="Lease"></option><option value="License Agreement"></option></datalist>
              <span class="field-help">The legal form of the document. Choose Business Associate Agreement when the main purpose is sharing or protecting PHI.</span>
            </label>
            </div>
          </div>
          <div class="builder-section">
            <h4>Dates and Term</h4>
            <div class="metric-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));align-items:start">
            <label class="field">Start of Services
              <input id="templateStart" type="date" />
            </label>
            <label class="field">End Date
              <input id="templateEnd" type="date" />
            </label>
            <label class="field">Initial Contract Length
              <input id="templateInitialLength" placeholder="1 year, 3 years, monthly..." />
            </label>
            <label class="field">Auto-Renewal
              <select id="templateAutoRenewal"><option>Yes</option><option>No</option><option>Ongoing</option><option>Unknown</option></select>
              <span class="field-help"><strong>Yes:</strong> renews for another term automatically. <strong>No:</strong> stops at its end date. <strong>Ongoing:</strong> continues until terminated, with no renewal event.</span>
            </label>
            <label class="field">Renewal Term
              <input id="templateRenewalTerm" placeholder="Additional 1-year terms" />
            </label>
            <label class="field">Notice Period
              <input id="templateNotice" placeholder="30 days" />
            </label>
            <label class="field">Termination Terms
              <input id="templateTermination" placeholder="30 days written notice" />
            </label>
            <label class="field">Termination Without Cause
              <input id="templateTerminationWithoutCause" placeholder="30 days written notice, if allowed" />
            </label>
            </div>
          </div>
          <div class="builder-section">
            <h4>Money and Operations</h4>
            <div class="metric-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));align-items:start">
            <div id="baaFinanceNote" class="baa-finance-note" hidden><strong>No financial impact</strong><span>BAAs protect shared health information. Cost and payment fields are completed automatically.</span></div>
            <label class="field" data-baa-finance-field>Payment Terms
              <input id="templatePaymentTerms" placeholder="Net 30" />
              <span class="field-help">How and when payment is due. For a stand-alone BAA, use “No payment - data sharing agreement.”</span>
            </label>
            <label class="field" data-baa-finance-field>Days Payable
              <input id="templateDaysPayable" placeholder="30 days" />
            </label>
            <label class="field" data-baa-finance-field>Fee / Rate
              <input id="templateFee" placeholder="$500/month, $30 pickup, $2/mile..." />
              <span class="field-help">Enter the actual pricing basis, or “No cost” when no money changes hands.</span>
            </label>
            <label class="field" data-baa-finance-field>Monthly Cost
              <input id="templateMonthlyCost" placeholder="$1,250" />
            </label>
            <label class="field">Quantity / Services
              <input id="templateQuantity" placeholder="Weekly pickup, 12 tanks, 200 lbs..." />
            </label>
            <label class="field">Service Location
              <input id="templateServiceLocation" placeholder="Facility, site, room, account, route..." />
            </label>
            <label class="field">Excluded Work / Extra Charges
              <input id="templateExcludedWork" placeholder="What is not included or billed separately" />
            </label>
            <label class="field">Insurance Limits
              <input id="templateInsuranceLimits" placeholder="$1,000,000 GL, WC, auto, professional..." />
            </label>
            <label class="field">Governing Law / Venue
              <input id="templateGoverningLaw" placeholder="State / county, if legal approves" />
            </label>
            <label class="field">Attachments
              <input id="templateAttachments" placeholder="BAA, COI, W-9, rate sheet, proposal..." />
            </label>
            <label class="field">Vendor Contact
              <input id="templateVendorContact" placeholder="Name, phone, email" />
            </label>
            <label class="field">Internal Owner
              <input id="templateOwner" value="Contract Dept" />
            </label>
            <label class="field">Facility Signer
              <input id="templateFacilitySignerName" placeholder="Name" />
            </label>
            <label class="field">Facility Signer Title
              <input id="templateFacilitySignerTitle" placeholder="Title" />
            </label>
            <label class="field">Vendor Signer
              <input id="templateVendorSignerName" placeholder="Name" />
            </label>
            <label class="field">Vendor Signer Title
              <input id="templateVendorSignerTitle" placeholder="Title" />
            </label>
            </div>
          </div>
          <div class="builder-section">
            <h4>Custom Terms</h4>
            <div class="builder-term-buttons">
              <button class="btn ghost" type="button" onclick="appendTemplateTerm('insurance')">Add Insurance</button>
              <button class="btn ghost" type="button" onclick="appendTemplateTerm('hipaa')">Add HIPAA</button>
              <button class="btn ghost" type="button" onclick="appendTemplateTerm('termination')">Add Termination</button>
              <button class="btn ghost" type="button" onclick="appendTemplateTerm('billing')">Add Billing</button>
              <button class="btn ghost" type="button" onclick="appendTemplateTerm('compliance')">Add Compliance</button>
            </div>
            <label class="field">Contract Terms / Special Instructions
              <textarea id="templateSpecialTerms" rows="7" placeholder="Add any special business terms, service details, fee schedule notes, insurance requirements, or language that must appear in this contract."></textarea>
            </label>
          </div>
          <details class="builder-section builder-legal-details">
            <summary>Standard Contract Language</summary>
            <label class="field">
              <textarea id="templateBaseLanguage" rows="12" placeholder="Standard legal, compliance, insurance, billing, termination, audit, and service-specific language."></textarea>
            </label>
          </details>
          <div class="builder-actions">
            ${cancelButton}
            <button class="btn" type="button" onclick="previewTemplateContractDraft()">Preview / Export</button>
            <button class="btn" type="button" onclick="saveTemplateContractDraft(currentTemplateDraftValues(), { uploadAfterSave: true })">Save + Upload Signed File</button>
            <button class="btn primary" type="submit">${submitText}</button>
          </div>
        </form>
      `;
    }

    function renderContractBuilderPage() {
      const target = document.getElementById("contractBuilderPage");
      if (!target) return;
      target.innerHTML = templateContractFormHtml("page");
      applyTemplateDefaults();
      toggleBaaBuilderFinance();
    }

    function openTemplateContractModal() {
      document.getElementById("modalTitle").textContent = "Create Contract From Template";
      document.getElementById("modalBody").innerHTML = templateContractFormHtml("modal");
      document.getElementById("contractModal").classList.add("open");
      applyTemplateDefaults();
      toggleBaaBuilderFinance();
    }

    let templateDraftPreviewSnapshot = null;

    function builderDraftUploadRecord(contract = {}, values = {}) {
      return {
        draftId: contract.id || "",
        name: values.name || contract.name || "",
        facility: values.facility || contract.facility || "",
        vendor: values.vendor || contract.vendor || "",
        category: values.category || contract.category || contract.services || "",
        documentType: values.contractType || contract.documentType || "Contract",
        owner: values.owner || contract.owner || "Contract Dept",
        terms: {
          start: values.start || contract.startOfServices || contract.start || "",
          end: values.end || contract.end || "",
          length: values.length || contract.initialContractLength || "",
          autoRenewal: values.autoRenewal || contract.autoRenewal || "",
          renewalTerm: values.renewalTerm || contract.renewalTerm || "",
          termination: values.termination || contract.termination || "",
          notice: values.notice || contract.noticePeriod || "",
          paymentTerms: values.paymentTerms || contract.paymentTerms || "",
          daysPayable: values.daysPayable || contract.daysPayable || "",
          fee: values.fee || contract.fee || "",
          monthlyCost: values.monthlyCost || contract.monthlyCost || "",
          quantity: values.quantity || contract.quantityOfServices || "",
          serviceLocation: values.serviceLocation || contract.serviceLocation || "",
          excludedWork: values.excludedWork || contract.excludedWork || "",
          terminationWithoutCause: values.terminationWithoutCause || contract.terminationWithoutCause || "",
          insuranceLimits: values.insuranceLimits || contract.insuranceLimits || contract.insurance || "",
          governingLaw: values.governingLaw || contract.governingLaw || "",
          attachments: values.attachments || contract.attachments || "",
          facilityLegalName: values.facilityLegalName || contract.facilityLegalName || "",
          facilityNoticeAddress: values.facilityNoticeAddress || contract.facilityNoticeAddress || "",
          vendorLegalName: values.vendorLegalName || contract.vendorLegalName || "",
          vendorNoticeAddress: values.vendorNoticeAddress || contract.vendorNoticeAddress || "",
          facilitySignerName: values.facilitySignerName || contract.facilitySignerName || "",
          facilitySignerTitle: values.facilitySignerTitle || contract.facilitySignerTitle || "",
          vendorSignerName: values.vendorSignerName || contract.vendorSignerName || "",
          vendorSignerTitle: values.vendorSignerTitle || contract.vendorSignerTitle || "",
          vendorContact: values.vendorContact || contract.vendorContact || "",
          specialTerms: values.specialTerms || contract.purposeScope || "",
          baseLanguage: values.baseLanguage || contract.templateLanguage || ""
        },
        extractedFields: Array.isArray(contract.extractedFields) ? contract.extractedFields : [],
        extractedFeeLines: Array.isArray(contract.extractedFeeLines) ? contract.extractedFeeLines : [],
        createdAt: new Date().toISOString()
      };
    }

    function pendingBuilderDraftUpload() {
      try {
        return JSON.parse(localStorage.getItem("pendingBuilderDraftUpload") || "null");
      } catch {
        return null;
      }
    }

    function applyPendingBuilderDraftToUploadForm(record = pendingBuilderDraftUpload()) {
      if (!record) return;
      const set = (id, value) => {
        const el = document.getElementById(id);
        if (el && value !== undefined && value !== null) el.value = value;
      };
      set("hintFacility", record.facility || "");
      set("hintVendor", record.vendor || "");
      set("hintCategory", record.category || "");
      set("hintDocumentType", record.documentType || "Contract");
      set("hintOwner", record.owner || "Contract Dept");
      const status = document.getElementById("bulkUploadStatus");
      if (status) status.textContent = record.name ? `Builder draft ready: upload signed PDF or Word file for ${record.name}` : "Builder draft ready: upload signed PDF or Word file.";
      refreshDropdownsForSection("upload");
      updateUploadShareSyncDestination();
    }

    function stageBuilderDraftForUpload(contract = {}, values = {}) {
      const record = builderDraftUploadRecord(contract, values);
      localStorage.setItem("pendingBuilderDraftUpload", JSON.stringify(record));
      applyPendingBuilderDraftToUploadForm(record);
      return record;
    }

    function mergeExtractedFields(current = [], learned = []) {
      const list = Array.isArray(current) ? [...current] : [];
      const seen = new Set(list.map(field => masterKey(field?.label || field?.name || "")));
      (Array.isArray(learned) ? learned : []).forEach(field => {
        const key = masterKey(field?.label || field?.name || "");
        if (key && !seen.has(key)) {
          seen.add(key);
          list.push({ ...field, source: field.source || "Contract Builder Draft", confidence: field.confidence || 100 });
        }
      });
      return list;
    }

    function mergeFeeLines(current = [], learned = []) {
      const list = Array.isArray(current) ? [...current] : [];
      const seen = new Set(list.map(line => masterKey(`${line?.service || ""} ${line?.amount || line?.rate || ""}`)));
      (Array.isArray(learned) ? learned : []).forEach(line => {
        const key = masterKey(`${line?.service || ""} ${line?.amount || line?.rate || ""}`);
        if (key && !seen.has(key)) {
          seen.add(key);
          list.push({ ...line, source: line.source || "Contract Builder Draft", confidence: line.confidence || 100 });
        }
      });
      return list;
    }

    async function applyPendingBuilderTermsToUploadedContract(uploadedContract = {}) {
      const pending = pendingBuilderDraftUpload();
      if (!pending?.terms || !uploadedContract?.id) return uploadedContract;
      const terms = pending.terms || {};
      const update = {
        name: pending.name || uploadedContract.name,
        facility: pending.facility || uploadedContract.facility,
        vendor: pending.vendor || uploadedContract.vendor,
        category: pending.category || uploadedContract.category,
        services: pending.category || uploadedContract.services,
        contractType: pending.documentType || uploadedContract.contractType,
        agreementType: pending.documentType || uploadedContract.agreementType,
        start: terms.start || uploadedContract.start,
        startOfServices: terms.start || uploadedContract.startOfServices,
        end: terms.end || (terms.autoRenewal === "Yes" ? "Auto-renews unless terminated" : uploadedContract.end),
        initialContractLength: terms.length || uploadedContract.initialContractLength,
        autoRenewal: terms.autoRenewal || uploadedContract.autoRenewal,
        renewalTerm: terms.renewalTerm || uploadedContract.renewalTerm,
        termination: terms.termination || uploadedContract.termination,
        terminationClause: terms.termination || uploadedContract.terminationClause,
        noticePeriod: terms.notice || uploadedContract.noticePeriod,
        paymentTerms: terms.paymentTerms || uploadedContract.paymentTerms,
        daysPayable: terms.daysPayable || uploadedContract.daysPayable,
        fee: terms.fee || uploadedContract.fee,
        rate: terms.fee || uploadedContract.rate,
        monthlyCost: terms.monthlyCost || uploadedContract.monthlyCost,
        quantityOfServices: terms.quantity || uploadedContract.quantityOfServices,
        serviceLocation: terms.serviceLocation || uploadedContract.serviceLocation,
        excludedWork: terms.excludedWork || uploadedContract.excludedWork,
        terminationWithoutCause: terms.terminationWithoutCause || uploadedContract.terminationWithoutCause,
        insuranceLimits: terms.insuranceLimits || uploadedContract.insuranceLimits,
        insurance: terms.insuranceLimits || uploadedContract.insurance,
        governingLaw: terms.governingLaw || uploadedContract.governingLaw,
        attachments: terms.attachments || uploadedContract.attachments,
        facilityLegalName: terms.facilityLegalName || uploadedContract.facilityLegalName,
        facilityNoticeAddress: terms.facilityNoticeAddress || uploadedContract.facilityNoticeAddress,
        vendorLegalName: terms.vendorLegalName || uploadedContract.vendorLegalName,
        vendorNoticeAddress: terms.vendorNoticeAddress || uploadedContract.vendorNoticeAddress,
        facilitySignerName: terms.facilitySignerName || uploadedContract.facilitySignerName,
        facilitySignerTitle: terms.facilitySignerTitle || uploadedContract.facilitySignerTitle,
        vendorSignerName: terms.vendorSignerName || uploadedContract.vendorSignerName,
        vendorSignerTitle: terms.vendorSignerTitle || uploadedContract.vendorSignerTitle,
        vendorContact: terms.vendorContact || uploadedContract.vendorContact,
        purposeScope: terms.specialTerms || uploadedContract.purposeScope,
        templateLanguage: terms.baseLanguage || uploadedContract.templateLanguage,
        complianceLanguage: terms.baseLanguage || uploadedContract.complianceLanguage,
        builderDraftId: pending.draftId || "",
        builderDraftTermsAppliedAt: new Date().toISOString(),
        extractedFields: mergeExtractedFields(uploadedContract.extractedFields, pending.extractedFields),
        extractedFeeLines: mergeFeeLines(uploadedContract.extractedFeeLines, pending.extractedFeeLines)
      };
      try {
        const patched = await apiJson(`/api/contracts/${encodeURIComponent(uploadedContract.id)}`, {
          method: "PATCH",
          body: JSON.stringify(update)
        });
        localStorage.removeItem("pendingBuilderDraftUpload");
        showToast("Signed file uploaded. Builder terms attached for review.");
        return normalizeContract(patched);
      } catch {
        showToast("File uploaded, but Builder terms did not attach. Open the draft record if needed.");
        return uploadedContract;
      }
    }

    async function saveTemplateContractDraft(values = currentTemplateDraftValues(), options = {}) {
      const facility = cleanMasterName(values.facility);
      const vendor = cleanMasterName(values.vendor);
      const category = cleanMasterName(values.category);
      const name = values.name || templateDraftName();
      const specialTerms = values.specialTerms;
      const templateLanguage = values.baseLanguage;
      if (!facility || !vendor || !category) {
        showToast("Facility, vendor, and service/category are required.");
        return;
      }
      const monthlyCost = values.monthlyCost;
      const endValue = values.end || (values.autoRenewal === "Yes" ? "Auto-renews unless terminated" : "");
      saveBuilderLearning(values);
      const contract = {
        name,
        status: "Draft",
        contractStatus: "Draft",
        reviewStatus: "Template Draft",
        documentType: "Contract",
        source: "Template Draft",
        isTemplateDraft: true,
        templateName: values.templateName,
        facility,
        facilityLegalName: values.facilityLegalName,
        facilityAddress: values.facilityAddress,
        facilityNoticeAddress: values.facilityNoticeAddress,
        facilityBeds: templateFacilityBeds(facility),
        vendor,
        vendorLegalName: values.vendorLegalName,
        vendorNoticeAddress: values.vendorNoticeAddress,
        category,
        services: category,
        contractType: values.contractType,
        agreementType: values.contractType,
        start: values.start,
        startOfServices: values.start,
        end: endValue,
        initialContractLength: values.length,
        autoRenewal: values.autoRenewal,
        renewalTerm: values.renewalTerm,
        termination: values.termination,
        terminationClause: values.termination,
        terminationWithoutCause: values.terminationWithoutCause,
        noticePeriod: values.notice,
        paymentTerms: values.paymentTerms,
        daysPayable: values.daysPayable,
        fee: values.fee,
        rate: values.fee,
        monthlyCost,
        costBedMonth: calculateCostPerBedMonth(monthlyCost, facility),
        quantityOfServices: values.quantity,
        serviceLocation: values.serviceLocation,
        excludedWork: values.excludedWork,
        insuranceLimits: values.insuranceLimits,
        insurance: values.insuranceLimits,
        governingLaw: values.governingLaw,
        attachments: values.attachments,
        facilitySignerName: values.facilitySignerName,
        facilitySignerTitle: values.facilitySignerTitle,
        vendorSignerName: values.vendorSignerName,
        vendorSignerTitle: values.vendorSignerTitle,
        vendorContact: values.vendorContact,
        owner: values.owner || "Contract Dept",
        notes: [specialTerms, templateLanguage ? `Template legal / compliance language:\n${templateLanguage}` : ""].filter(Boolean).join("\n\n"),
        purposeScope: specialTerms,
        templateLanguage,
        complianceLanguage: templateLanguage,
        risk: "Low",
        spend: values.fee || monthlyCost || "TBD",
        extractedFields: [
          templateField("Contract Name", name),
          templateField("Facility", facility),
          templateField("Facility Legal Name", values.facilityLegalName),
          templateField("Facility Address", values.facilityAddress),
          templateField("Facility Notice Address", values.facilityNoticeAddress),
          templateField("Facility Beds", templateFacilityBeds(facility)),
          templateField("Vendor", vendor),
          templateField("Vendor Legal Name", values.vendorLegalName),
          templateField("Vendor Notice Address", values.vendorNoticeAddress),
          templateField("Category", category),
          templateField("Contract Type", values.contractType),
          templateField("Start of Services", values.start),
          templateField("End Date", endValue),
          templateField("Initial Contract Length", values.length),
          templateField("Auto Renewal", values.autoRenewal),
          templateField("Renewal Term", values.renewalTerm),
          templateField("Notice Period", values.notice),
          templateField("Termination", values.termination),
          templateField("Termination Without Cause", values.terminationWithoutCause),
          templateField("Payment Terms", values.paymentTerms),
          templateField("Days Payable", values.daysPayable),
          templateField("Fee", values.fee),
          templateField("Monthly Cost", monthlyCost),
          templateField("Quantity of Services", values.quantity),
          templateField("Service Location", values.serviceLocation),
          templateField("Excluded Work", values.excludedWork),
          templateField("Insurance Limits", values.insuranceLimits),
          templateField("Governing Law", values.governingLaw),
          templateField("Attachments", values.attachments),
          templateField("Facility Signer", values.facilitySignerName),
          templateField("Facility Signer Title", values.facilitySignerTitle),
          templateField("Vendor Signer", values.vendorSignerName),
          templateField("Vendor Signer Title", values.vendorSignerTitle),
          templateField("Vendor Contact", values.vendorContact),
          templateField("Contract Terms", specialTerms),
          templateField("Standard Contract Language", templateLanguage)
        ].filter(field => field.value),
        extractedFeeLines: values.fee ? [{
          service: category,
          amount: values.fee,
          frequency: monthlyCost ? "Monthly or contract-specific" : "Contract-specific",
          source: "Template Draft",
          sourceText: values.fee,
          confidence: 100
        }] : []
      };
      try {
        const created = await apiJson("/api/contracts", {
          method: "POST",
          body: JSON.stringify(contract)
        });
        const normalized = normalizeContract(created);
        contracts.unshift(normalized);
        contractData = [...contracts];
        currentPage = 1;
        if (options.uploadAfterSave) {
          stageBuilderDraftForUpload(normalized, values);
          closeModal();
          switchSection("upload");
          renderActiveSectionOnly("upload");
          showToast("Draft saved. Upload the signed PDF or Word file and it will use these terms.");
          return normalized;
        }
        closeModal();
        switchSection("contracts");
        renderActiveSectionOnly("contracts");
        scheduleIdleTask(() => renderDashboard(), 400);
        showToast("Draft contract created from template.");
        openContract(normalized.id);
      } catch (error) {
        showToast(error.message || "Could not create the draft contract.");
      }
    }

    function currentTemplateDraftValues() {
      const value = id => document.getElementById(id)?.value?.trim() || "";
      const facility = cleanMasterName(value("templateFacility"));
      const vendor = cleanMasterName(value("templateVendor"));
      const category = cleanMasterName(value("templateCategory"));
      const facilityProfile = templateFacilityProfile(facility);
      return {
        templateName: value("templateName"),
        name: value("templateContractName") || templateDraftName(),
        facility,
        facilityLegalName: value("templateFacilityLegalName") || facilityProfile.legalName || facility,
        facilityAddress: value("templateFacilityAddress") || templateFacilityAddress(facility),
        facilityNoticeAddress: value("templateFacilityNoticeAddress") || value("templateFacilityAddress") || templateFacilityAddress(facility),
        facilityBeds: Number(facilityProfile.beds || 0) || 0,
        vendor,
        vendorLegalName: value("templateVendorLegalName") || vendor,
        vendorNoticeAddress: value("templateVendorNoticeAddress"),
        category,
        contractType: value("templateContractType"),
        start: value("templateStart"),
        end: value("templateEnd"),
        length: value("templateInitialLength"),
        autoRenewal: value("templateAutoRenewal"),
        renewalTerm: value("templateRenewalTerm"),
        notice: value("templateNotice"),
        termination: value("templateTermination"),
        terminationWithoutCause: value("templateTerminationWithoutCause"),
        paymentTerms: value("templatePaymentTerms"),
        daysPayable: value("templateDaysPayable"),
        fee: value("templateFee"),
        monthlyCost: value("templateMonthlyCost"),
        quantity: value("templateQuantity"),
        serviceLocation: value("templateServiceLocation"),
        excludedWork: value("templateExcludedWork"),
        insuranceLimits: value("templateInsuranceLimits"),
        governingLaw: value("templateGoverningLaw"),
        attachments: value("templateAttachments"),
        vendorContact: value("templateVendorContact"),
        facilitySignerName: value("templateFacilitySignerName"),
        facilitySignerTitle: value("templateFacilitySignerTitle"),
        vendorSignerName: value("templateVendorSignerName"),
        vendorSignerTitle: value("templateVendorSignerTitle"),
        owner: value("templateOwner") || "Contract Dept",
        specialTerms: value("templateSpecialTerms"),
        baseLanguage: value("templateBaseLanguage")
      };
    }

    function legalParagraphsFromText(text = "") {
      return String(text || "")
        .replace(/\r/g, "")
        .replace(/STANDARD FACILITY-SIDE TERMS FOR LEGAL REVIEW/gi, "")
        .replace(/IN WITNESS WHEREOF/gi, "")
        .split(/\n{1,}/)
        .map(item => item.trim())
        .filter(Boolean)
        .filter(item => !/^[A-Z][A-Z\s/&.-]{8,}\s+TEMPLATE$/.test(item))
        .join("\n\n")
        .replace(/\s+(\d{1,2}(?:\.\d{1,2})?\.\s+[A-Z])/g, "\n\n$1")
        .replace(/\s+([a-z]\.\s+[A-Z])/g, "\n$1")
        .split(/\n{1,}/)
        .map(item => item.trim())
        .filter(Boolean)
        .flatMap(item => item
          .split(/(?=\b\d{1,2}(?:\.\d{1,2})?\.\s+[A-Z])/g)
          .map(part => part.trim())
          .filter(Boolean));
    }

    function legalClauseTitle(text = "") {
      const lower = String(text || "").toLowerCase();
      if (lower.startsWith("service-specific terms:")) return "Service-Specific Terms";
      if (/medical director duties|duties shall include/.test(lower)) return "Medical Director Duties";
      if (/licensed physician|current unrestricted|dea|credential/.test(lower)) return "Licenses and Qualifications";
      if (/comply with|public health law|nycrr|hipaa|privacy/.test(lower)) return "Compliance";
      if (/ultimate authority|operation|books|records|assets|independent contractor/.test(lower)) return "Facility Authority";
      if (/removal|replacement|substitute physician/.test(lower)) return "Replacement of Assigned Provider";
      if (/maintain records|documentation|reports|credentialing/.test(lower)) return "Records and Documentation";
      if (/compensation|fair market value|referral|kickback/.test(lower)) return "Required Final Terms";
      if (/insurance/.test(lower)) return "Insurance";
      if (/indemnification|indemnify/.test(lower)) return "Indemnification";
      if (/termination/.test(lower)) return "Termination";
      if (/billing|invoice|payment/.test(lower)) return "Billing and Payment";
      if (/facility operates|desires to engage|provider represents/.test(lower)) return "Background";
      const firstSentence = String(text || "").split(/[.;:]/)[0].replace(/[^A-Za-z0-9\s/&-]/g, "").trim();
      return firstSentence.split(/\s+/).slice(0, 5).join(" ") || "Additional Term";
    }

    function cleanLegalClauseBody(text = "", title = "") {
      let body = String(text || "").trim();
      body = body.replace(/^SERVICE-SPECIFIC TERMS:\s*/i, "");
      if (title && body.toLowerCase().startsWith(title.toLowerCase())) {
        body = body.slice(title.length).replace(/^[\s:.-]+/, "");
      }
      return body;
    }

    function legalParagraphHtml(text = "", fallback = "", options = {}) {
      const paragraphs = legalParagraphsFromText(text || fallback);
      let autoIndex = 0;
      return paragraphs.map(item => {
        const subClause = /^[a-z]\.\s+/.test(item);
        const clauseMatch = item.match(/^(\d{1,2}(?:\.\d{1,2})?\.|[a-z]\.)\s+([^.]*)\.\s*(.*)$/);
        const heading = /^[A-Z][A-Z0-9\s/&(),.-]{8,}$/.test(item) && !clauseMatch;
        if (heading) return `<h4 class="contract-doc-subhead">${escapeHtml(item)}</h4>`;
        let body = "";
        if (options.renumberPrefix) {
          autoIndex += 1;
          const number = `${options.renumberPrefix}.${autoIndex}`;
          const title = clauseMatch ? clauseMatch[2] : legalClauseTitle(item);
          const clauseBody = clauseMatch ? clauseMatch[3] : cleanLegalClauseBody(item, title);
          body = `<strong>${escapeHtml(`${number} ${title}.`)}</strong>${clauseBody ? ` ${escapeHtml(clauseBody)}` : ""}`;
        } else if (clauseMatch) {
          body = `<strong>${escapeHtml(`${clauseMatch[1]} ${clauseMatch[2]}.`)}</strong>${clauseMatch[3] ? ` ${escapeHtml(clauseMatch[3])}` : ""}`;
        } else if (options.autoNumberPrefix) {
          autoIndex += 1;
          const number = `${options.autoNumberPrefix}.${autoIndex}`;
          const title = legalClauseTitle(item);
          body = `<strong>${escapeHtml(`${number} ${title}.`)}</strong> ${escapeHtml(cleanLegalClauseBody(item, title))}`;
        } else {
          const title = legalClauseTitle(item);
          body = `<strong>${escapeHtml(`${title}.`)}</strong> ${escapeHtml(cleanLegalClauseBody(item, title))}`;
        }
        return `<p class="contract-doc-paragraph ${subClause ? "contract-doc-subparagraph" : "contract-doc-clause"}">${body}</p>`;
      }).join("");
    }

    function templateDraftPreviewHtml(values = currentTemplateDraftValues()) {
      const service = values.category || values.contractType || "Services";
      const effective = values.start || "To be inserted";
      const end = values.end || (values.autoRenewal === "Yes" ? "No fixed end date; auto-renews unless terminated" : "To be inserted");
      const agreementTitle = String(values.contractType || values.name || "Service Agreement").toUpperCase();
      const scopeFallback = "Vendor shall provide the services described above and any additional scope, pricing, service frequency, service location, and performance requirements inserted before sending.";
      const facilityLegal = values.facilityLegalName || values.facility || "Facility";
      const vendorLegal = values.vendorLegalName || values.vendor || "Vendor / Provider";
      const contractRows = [
        ["Facility", facilityLegal],
        ["Facility Address", values.facilityAddress],
        ["Facility Notice Address", values.facilityNoticeAddress],
        ["Vendor", vendorLegal],
        ["Vendor Notice Address", values.vendorNoticeAddress],
        ["Service", service],
        ["Service Location", values.serviceLocation || values.facility],
        ["Effective Date", effective],
        ["Initial Term", values.length],
        ["End Date", end],
        ["Auto-Renewal", values.autoRenewal],
        ["Renewal Term", values.renewalTerm],
        ["Termination Without Cause", values.terminationWithoutCause || values.termination],
        ["Notice Period", values.notice],
        ["Fee / Rate", values.fee || values.monthlyCost],
        ["Payment Terms", values.paymentTerms || values.daysPayable],
        ["Quantity / Frequency", values.quantity],
        ["Excluded Work / Extra Charges", values.excludedWork],
        ["Insurance Limits", values.insuranceLimits],
        ["Governing Law / Venue", values.governingLaw],
        ["Attachments", values.attachments]
      ].filter(([, value]) => value);
      const scheduleHtml = contractRows.length
        ? `<table class="contract-doc-table contract-schedule-table"><tbody>${contractRows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}</tbody></table>`
        : "";
      const noticeParts = [
        values.facilityNoticeAddress ? `Notices to Facility shall be sent to ${values.facilityNoticeAddress}.` : "",
        values.vendorNoticeAddress ? `Notices to Vendor shall be sent to ${values.vendorNoticeAddress}.` : ""
      ].filter(Boolean).join(" ");
      const signatureName = value => escapeHtml(value || "______________________________");
      const signatureTitle = value => escapeHtml(value || "______________________________");
      return `
        <div class="contract-draft-preview" id="templateDraftPreviewDocument">
          <div class="contract-doc-brand">
            <img src="/assets/centers-health-care-letterhead.png" alt="Centers Health Care" />
          </div>
          <div class="contract-doc-title">
            <h1>${escapeHtml(agreementTitle)}</h1>
            <p>between</p>
            <h2>${escapeHtml(facilityLegal)}</h2>
            <p>and</p>
            <h2>${escapeHtml(vendorLegal)}</h2>
          </div>

          <p class="contract-doc-paragraph">This ${escapeHtml(values.contractType || "Agreement")} is entered into and effective as of <strong>${escapeHtml(effective)}</strong> by and between <strong>${escapeHtml(facilityLegal)}</strong>${values.facilityAddress ? `, located at ${escapeHtml(values.facilityAddress)}` : ""} ("Facility"), and <strong>${escapeHtml(vendorLegal)}</strong> ("Vendor"). Facility and Vendor may each be referred to as a "Party" and collectively as the "Parties."</p>

          <h3>WITNESSETH</h3>
          <p class="contract-doc-paragraph">WHEREAS, Facility operates a healthcare, residential, or related facility and desires to obtain the services described in this Agreement; and</p>
          <p class="contract-doc-paragraph">WHEREAS, Vendor represents that it is qualified, licensed where required, insured, and able to provide such services in accordance with applicable law and Facility requirements; and</p>
          <p class="contract-doc-paragraph">WHEREAS, the Parties desire to set forth their respective rights and obligations with respect to such services.</p>
          <p class="contract-doc-paragraph"><strong>NOW, THEREFORE</strong>, in consideration of the mutual covenants and agreements contained herein, and for other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the Parties, intending to be legally bound, agree as follows:</p>

          <h3>Schedule A - Business and Service Terms</h3>
          ${scheduleHtml}

          <h3>1. Engagement</h3>
          <p class="contract-doc-paragraph">Facility hereby engages Vendor to provide <strong>${escapeHtml(service)}</strong> services for Facility, and Vendor accepts such engagement, subject to the terms and conditions of this Agreement. Vendor shall furnish all labor, supervision, equipment, materials, licenses, permits, approvals, vehicles, documentation, and other resources required to perform the services unless this Agreement expressly provides otherwise.</p>

          <h3>2. Scope of Services</h3>
          ${legalParagraphHtml(values.specialTerms, scopeFallback)}
          ${values.quantity ? `<p class="contract-doc-paragraph">The services shall include the following quantity, schedule, location, or service detail: <strong>${escapeHtml(values.quantity)}</strong>.</p>` : ""}
          ${values.excludedWork ? `<p class="contract-doc-paragraph">Excluded work, out-of-scope services, pass-through charges, or extra charges must be separately approved in writing before they are billable. Current exclusions or extra charges: <strong>${escapeHtml(values.excludedWork)}</strong>.</p>` : ""}

          <h3>3. Term</h3>
          <p class="contract-doc-paragraph">This Agreement shall commence on the Effective Date and shall continue for an initial term of <strong>${escapeHtml(values.length || "To be inserted")}</strong>, unless sooner terminated in accordance with this Agreement. End date: <strong>${escapeHtml(end)}</strong>.</p>

          <h3>4. Term, Renewal, and Termination</h3>
          <p class="contract-doc-paragraph">Auto-renewal: <strong>${escapeHtml(values.autoRenewal || "To be inserted")}</strong>. Renewal term: <strong>${escapeHtml(values.renewalTerm || "To be inserted")}</strong>. Either Party may terminate this Agreement in accordance with the following notice and termination provisions: <strong>${escapeHtml(values.termination || values.notice || "To be inserted")}</strong>.</p>
          ${values.terminationWithoutCause ? `<p class="contract-doc-paragraph">Termination without cause: <strong>${escapeHtml(values.terminationWithoutCause)}</strong>.</p>` : ""}

          <h3>5. Compensation and Billing</h3>
          <p class="contract-doc-paragraph">In consideration of the services provided under this Agreement, Vendor shall be compensated at the following rate or fee: <strong>${escapeHtml(values.fee || values.monthlyCost || "To be inserted")}</strong>. Payment terms shall be: <strong>${escapeHtml(values.paymentTerms || values.daysPayable || "To be inserted")}</strong>. Vendor shall invoice only for authorized services actually provided and supported by this Agreement, an approved rate schedule, purchase order, written approval, or other written authorization from Facility.</p>
          <p class="contract-doc-paragraph">Unless otherwise agreed in writing, Vendor shall submit invoices to Facility in a format reasonably acceptable to Facility. Facility may review, dispute, offset, or reject charges that are not supported by this Agreement, not authorized by Facility, duplicative, outside the agreed service scope, inconsistent with the agreed rate, or otherwise not payable under applicable law or Facility policy.</p>
          ${values.vendorContact ? `<p class="contract-doc-paragraph">Vendor contact for operational and billing purposes: <strong>${escapeHtml(values.vendorContact)}</strong>.</p>` : ""}

          <h3>6. Additional Terms and Conditions</h3>
          ${legalParagraphHtml(values.baseLanguage || standardFacilityContractLanguage(), "", { renumberPrefix: "6" })}
          ${noticeParts ? `<p class="contract-doc-paragraph"><strong>Notice Addresses.</strong> ${escapeHtml(noticeParts)}</p>` : ""}
          ${values.governingLaw ? `<p class="contract-doc-paragraph"><strong>Governing Law / Venue.</strong> ${escapeHtml(values.governingLaw)}</p>` : ""}
          ${values.attachments ? `<p class="contract-doc-paragraph"><strong>Attachments.</strong> ${escapeHtml(values.attachments)}</p>` : ""}

          <h3>IN WITNESS WHEREOF</h3>
          <p>The Parties have caused this Agreement to be executed by their duly authorized representatives as of the Effective Date.</p>
          <div class="contract-signature-grid">
            <div><strong>${escapeHtml(facilityLegal)}</strong><p>By: ________________________________</p><p>Name: ${signatureName(values.facilitySignerName)}</p><p>Title: ${signatureTitle(values.facilitySignerTitle)}</p><p>Date: _______________________________</p></div>
            <div><strong>${escapeHtml(vendorLegal)}</strong><p>By: ________________________________</p><p>Name: ${signatureName(values.vendorSignerName)}</p><p>Title: ${signatureTitle(values.vendorSignerTitle)}</p><p>Date: _______________________________</p></div>
          </div>
        </div>
      `;
    }

    function previewTemplateContractDraft() {
      const values = currentTemplateDraftValues();
      templateDraftPreviewSnapshot = values;
      document.getElementById("modalTitle").textContent = "Contract Draft Preview";
      document.getElementById("modalBody").innerHTML = `
        ${templateDraftPreviewHtml(values)}
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:16px">
          <button class="btn" type="button" onclick="closeModal()">Close</button>
          <button class="btn" type="button" onclick="printTemplateContractPreview()">Print / Save PDF</button>
          <button class="btn" type="button" onclick="downloadTemplateContractWord()">Download Word</button>
          <button class="btn primary" type="button" onclick="saveTemplateContractPreview()">Save Draft Record</button>
          <button class="btn primary" type="button" onclick="saveTemplateContractPreviewAndUpload()">Save + Upload Signed File</button>
        </div>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    function saveTemplateContractPreview() {
      return saveTemplateContractDraft(templateDraftPreviewSnapshot || currentTemplateDraftValues());
    }

    function saveTemplateContractPreviewAndUpload() {
      return saveTemplateContractDraft(templateDraftPreviewSnapshot || currentTemplateDraftValues(), { uploadAfterSave: true });
    }

    function templateContractWordFileName(values = {}) {
      const name = values.name || values.contractType || values.vendor || values.facility || "contract-draft";
      return String(name)
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9._ -]+/gi, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 90)
        .replace(/\s/g, "-") || "contract-draft";
    }

    function templateContractDocumentStyles() {
      return `
        body{margin:0;background:#fff;color:#111}
        .contract-draft-preview{max-width:7.5in;margin:0 auto;padding:0;font-family:"Times New Roman",Times,serif;font-size:12pt;line-height:1.55;color:#111}
        .contract-doc-brand{margin:0 0 24pt;border-bottom:3pt solid #2f267f;text-align:center;page-break-inside:avoid}
        .contract-doc-brand img{display:block;width:100%;max-height:86pt;object-fit:cover;object-position:top center}
        .contract-doc-title{text-align:center;margin-bottom:24pt}
        .contract-doc-title h1{margin:0 0 10pt;font-size:16pt;line-height:1.25;letter-spacing:0;text-transform:uppercase;text-decoration:underline;color:#2f267f}
        .contract-doc-title h2{margin:7pt 0;font-size:13pt;line-height:1.3;letter-spacing:0;text-transform:uppercase;color:#2f267f}
        .contract-doc-title p{margin:3pt 0;font-size:10pt;text-transform:uppercase}
        .contract-draft-preview h3{margin:18pt 0 6pt;padding-bottom:2pt;border-bottom:1pt solid #f6b200;font-family:"Times New Roman",Times,serif;font-size:12pt;line-height:1.3;letter-spacing:0;text-transform:uppercase;text-decoration:none;color:#2f267f}
        .contract-draft-preview p{margin:7pt 0;text-align:justify}
        .contract-doc-paragraph{text-align:justify}
        .contract-doc-clause{margin:10pt 0;page-break-inside:avoid}
        .contract-doc-clause strong{font-weight:800}
        .contract-doc-subparagraph{margin:6pt 0 6pt 24pt;page-break-inside:avoid}
        .contract-doc-subhead{margin:14pt 0 6pt;font-family:"Times New Roman",Times,serif;font-size:11pt;line-height:1.3;letter-spacing:0;text-transform:uppercase;text-decoration:none;font-weight:800}
        .contract-doc-table{width:100%;border-collapse:collapse;margin:10pt 0 16pt;font-family:Arial,sans-serif;font-size:10pt}
        .contract-doc-table th,.contract-doc-table td{border:1px solid #777;padding:6pt 8pt;text-align:left;vertical-align:top}
        .contract-doc-table th{width:170pt;background:#f4f1ff;color:#2f267f;font-weight:800}
        .contract-signature-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28pt;margin-top:18pt;page-break-inside:avoid}
        @page{margin:0.65in}
      `;
    }

    function downloadTemplateContractWord() {
      const values = templateDraftPreviewSnapshot || currentTemplateDraftValues();
      const html = (document.getElementById("templateDraftPreviewDocument")?.outerHTML || templateDraftPreviewHtml(values))
        .replace(/src="\/assets\//g, `src="${window.location.origin}/assets/`);
      const documentHtml = `
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>${escapeHtml(values.name || values.contractType || "Contract Draft")}</title>
            <style>${templateContractDocumentStyles()}</style>
          </head>
          <body>${html}</body>
        </html>
      `;
      const blob = new Blob(["\ufeff", documentHtml], { type: "application/msword;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${templateContractWordFileName(values)}.doc`;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        URL.revokeObjectURL(link.href);
        link.remove();
      }, 0);
      showToast("Word draft downloaded. Open it in Microsoft Word to edit.");
    }

    function printTemplateContractPreview() {
      const html = document.getElementById("templateDraftPreviewDocument")?.outerHTML || templateDraftPreviewHtml();
      const printWindow = window.open("", "_blank", "noopener,noreferrer");
      if (!printWindow) {
        showToast("Popup blocked. Allow popups to print or save PDF.");
        return;
      }
      printWindow.document.write(`
        <!doctype html>
        <html>
          <head>
            <title>Contract Draft</title>
            <style>
              ${templateContractDocumentStyles()}
            </style>
          </head>
          <body>${html}</body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    }

    function contractEmailSubject(contract, mode = "internal") {
      const action = mode === "vendor" ? "Contract for Review" : "Internal Contract Review";
      return `${action}: ${contract.name || contract.vendor || "Contract"}`;
    }

    function contractEmailBody(contract, mode = "internal") {
      const fileUrl = contractFileUrl(contract);
      const originalLink = fileUrl ? `${window.location.origin}${fileUrl}` : (contract.url && contract.url !== "Pending ShareSync link" ? contract.url : "");
      const action = mode === "vendor"
        ? "Please review the contract information below and advise if any changes are needed."
        : "Please review the contract information below before approval, signature, renewal, or vendor follow-up.";
      return [
        action,
        "",
        `Contract: ${contract.name || "Needs Review"}`,
        `Contract ID: ${contract.id || ""}`,
        `Facility: ${contract.facility || "Needs Review"}`,
        `Vendor: ${contract.vendor || "Needs Review"}`,
        `Service / Category: ${contract.services || contract.category || "Needs Review"}`,
        `Status: ${contract.contractStatus || contract.status || "Needs Review"}`,
        "",
        "Key Terms",
        `Start of Services: ${contract.startOfServices || contract.start || "Needs Review"}`,
        `End Date: ${endDateDisplay(contract.end, contract.autoRenewal) || "Needs Review"}`,
        `Initial Contract Length: ${contract.initialContractLength || "Needs Review"}`,
        `Auto-Renewal: ${contract.autoRenewal || "Unknown"}`,
        `Renewal Term: ${contract.renewalTerm || "Needs Review"}`,
        `Termination / Notice: ${contract.terminationClause || contract.termination || "Needs Review"}`,
        `Payment Terms: ${contract.paymentTerms || "Needs Review"}`,
        `Days Payable: ${contract.daysPayable || "Needs Review"}`,
        `Fee / Rate: ${contract.fee || contract.rate || contract.spend || "Needs Review"}`,
        `Monthly Cost: ${contract.monthlyCost || "Needs Review"}`,
        `Cost Bed/Month: ${contract.costBedMonth || "Needs Review"}`,
        `Quantity / Services: ${contract.quantityOfServices || "Needs Review"}`,
        "",
        `Vendor Contact: ${contract.vendorContact || [contract.vendorPhone, contract.vendorEmail].filter(Boolean).join(" / ") || "Needs Review"}`,
        `Owner: ${contract.owner || "Contract Dept"}`,
        "",
        contract.notes ? `Notes / Special Terms:\n${contract.notes}` : "Notes / Special Terms: Needs Review",
        "",
        originalLink ? `Contract/source link: ${originalLink}` : "Contract/source link: Not saved yet",
        "",
        "Please confirm any missing or incorrect information before this is treated as final."
      ].join("\n");
    }

    function openContractEmail(id, mode = "internal") {
      const contract = contractData.find(item => item.id === id) || contracts.find(item => item.id === id);
      if (!contract) {
        showToast("Open a saved contract before sending email.");
        return;
      }
      const vendorCard = vendorForContract(contract);
      const internalEmail = adminSettings.contractDepartmentEmail || adminSettings.emailSender || "contracts@company.com";
      const to = mode === "vendor" ? (vendorCard.email || contract.vendorEmail || "") : internalEmail;
      if (mode === "vendor" && !to) {
        showToast("Vendor email is missing. Outlook will open with the To field blank.");
      }
      const subject = contractEmailSubject(contract, mode);
      const body = contractEmailBody(contract, mode);
      window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      showToast("Opening Outlook email draft.");
    }

    function setLoginMessage(message, tone = "normal") {
      const note = document.getElementById("loginStatusNote");
      if (!note) return;
      note.textContent = message;
      note.style.borderColor = tone === "error" ? "rgba(185, 28, 28, 0.32)" : "";
      note.style.background = tone === "error" ? "rgba(254, 242, 242, 0.92)" : "";
    }

    function showLoginScreen(message = "") {
      document.getElementById("loginScreen")?.classList.remove("hidden");
      if (message) setLoginMessage(message);
    }

    function hideLoginScreen() {
      document.getElementById("loginScreen")?.classList.add("hidden");
    }

    function showInviteSetupPanel(show = true) {
      document.getElementById("inviteSetupPanel")?.classList.toggle("hidden", !show);
      document.getElementById("forgotPasswordPanel")?.classList.add("hidden");
      document.getElementById("loginUser")?.closest(".field")?.classList.toggle("hidden", show);
      document.getElementById("loginPass")?.closest(".field")?.classList.toggle("hidden", show);
      document.getElementById("loginButton")?.classList.toggle("hidden", show);
      document.getElementById("forgotPasswordButton")?.classList.toggle("hidden", show);
    }

    function showForgotPasswordPanel(show = true) {
      document.getElementById("forgotPasswordPanel")?.classList.toggle("hidden", !show);
      document.getElementById("inviteSetupPanel")?.classList.add("hidden");
      document.getElementById("loginUser")?.closest(".field")?.classList.toggle("hidden", show);
      document.getElementById("loginPass")?.closest(".field")?.classList.toggle("hidden", show);
      document.getElementById("loginButton")?.classList.toggle("hidden", show);
      document.getElementById("forgotPasswordButton")?.classList.toggle("hidden", show);
      if (show) {
        document.getElementById("forgotPasswordEmail").value = document.getElementById("loginUser")?.value || "";
        setLoginMessage("Enter your account email to create a reset link.");
      }
    }

    async function loadInviteSetup() {
      if (!inviteSetupToken) return false;
      showLoginScreen("Checking invite link...");
      showInviteSetupPanel(true);
      try {
        const invite = await apiJson("/api/invite/validate", {
          method: "POST",
          body: JSON.stringify({ token: inviteSetupToken })
        });
        const summary = document.getElementById("inviteSetupSummary");
        if (summary) {
          summary.textContent = `${invite.fullName || invite.username} | ${invite.role || "User"} | ${invite.facility || "All facilities"}`;
        }
        setLoginMessage("Create your password to finish setup.");
      } catch (error) {
        showInviteSetupPanel(false);
        showLoginScreen(error.message || "Invite link is invalid or expired.");
        setLoginMessage(error.message || "Invite link is invalid or expired.", "error");
      }
      return true;
    }

    async function acceptInviteSetup() {
      const password = document.getElementById("invitePassword")?.value || "";
      const confirmPassword = document.getElementById("invitePasswordConfirm")?.value || "";
      if (password.length < 8) {
        setLoginMessage("Password must be at least 8 characters.", "error");
        return;
      }
      if (password !== confirmPassword) {
        setLoginMessage("Passwords do not match.", "error");
        return;
      }
      try {
        const result = await apiJson("/api/invite/accept", {
          method: "POST",
          body: JSON.stringify({ token: inviteSetupToken, password })
        });
        currentUser = result;
        showInviteSetupPanel(false);
        hideLoginScreen();
        applyRoleAccessUi();
        setLoginMessage(`Signed in as ${result.fullName || result.user}.`);
        showToast("Password created. Signed in.");
        history.replaceState({}, "", `${location.pathname}${location.hash || "#dashboard"}`);
        await loadBackendData();
      } catch (error) {
        setLoginMessage(error.message || "Could not create password.", "error");
        showToast("Could not create password.");
      }
    }

    async function requestPasswordReset() {
      const username = document.getElementById("forgotPasswordEmail")?.value.trim() || "";
      if (!username) {
        setLoginMessage("Enter your email first.", "error");
        return;
      }
      try {
        const result = await apiJson("/api/password-reset/request", {
          method: "POST",
          body: JSON.stringify({ username })
        });
        if (result.resetUrl && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(result.resetUrl).catch(() => {});
        }
        if (result.email?.sent) {
          setLoginMessage("Password reset email sent. Use the link in that email to create a new password.");
          showToast("Password reset email sent.");
        } else if (result.mailto) {
          window.location.href = result.mailto;
          setLoginMessage("Email server is not configured yet. Reset email draft opened instead.");
          showToast("Password reset email draft opened.");
        } else {
          setLoginMessage("If that account exists, an admin can send a reset link.", "error");
          showToast("Reset request received.");
        }
      } catch (error) {
        setLoginMessage(error.message || "Could not create reset link.", "error");
        showToast("Could not create reset link.");
      }
    }

    async function checkAuthStatus() {
      if (location.protocol === "file:") {
        showLoginScreen("Open the server address to use the live app. File preview cannot sign in or save data.");
        return false;
      }
      if (await loadInviteSetup()) return false;
      const isFrontendOnlyHost = /(^|\.)vercel\.app$/i.test(location.hostname) && !apiBase;
      if (isFrontendOnlyHost) {
        currentUser = {
          authenticated: true,
          user: "preview",
          fullName: "Frontend Preview",
          role: "preview",
          publicMode: true
        };
        hideLoginScreen();
        applyRoleAccessUi();
        setLoginMessage("Frontend preview mode. Connect a backend URL when you want live uploads, OCR, and saving.");
        return true;
      }
      try {
        const status = await apiJson("/api/auth/status");
        if (status.loginRequired === false) {
          currentUser = status;
          hideLoginScreen();
          applyRoleAccessUi();
          setLoginMessage("Open internal mode. Sign-in is turned off for now.");
          loadDashboardLiveData({ renderAfter: true }).catch(() => {});
          return true;
        }
        if (status.setupRequired) {
          showLoginScreen("Live login is not set up yet. Add ADMIN_USER and ADMIN_PASSWORD to the server .env file, then restart.");
          return false;
        }
        if (status.authenticated) {
          currentUser = status;
          hideLoginScreen();
          applyRoleAccessUi();
          setLoginMessage(`Signed in as ${status.fullName || status.user}.`);
          loadDashboardLiveData({ renderAfter: true }).catch(() => {});
          return true;
        }
        showLoginScreen("Enter your live server username and password.");
        return false;
      } catch (error) {
        showLoginScreen("Cannot reach the login server yet. Start the local server, then refresh.");
        return false;
      }
    }

    async function signInUser() {
      const user = document.getElementById("loginUser").value.trim();
      const pass = document.getElementById("loginPass").value;
      if (!user || !pass) {
        setLoginMessage("Enter username and password.", "error");
        showToast("Enter username and password.");
        return;
      }
      try {
        const result = await apiJson("/api/login", {
          method: "POST",
          body: JSON.stringify({ username: user, password: pass })
        });
        hideLoginScreen();
        currentUser = result;
        applyRoleAccessUi();
        setLoginMessage(`Signed in as ${result.user || user}.`);
        showToast(`Signed in as ${result.user || user}.`);
        await loadBackendData();
      } catch (error) {
        showLoginScreen(error.message || "Sign in failed.");
        setLoginMessage(error.message || "Sign in failed.", "error");
        showToast("Sign in failed.");
      }
    }

    async function signOutUser() {
      await apiJson("/api/logout", { method: "POST" }).catch(() => {});
      currentUser = null;
      applyRoleAccessUi();
      document.getElementById("loginPass").value = "";
      showLoginScreen("Signed out. Enter your credentials to continue.");
      showToast("Signed out.");
    }

    function setBackendStatus(online, detail = "") {
      backendOnline = online;
      const badge = document.getElementById("backendStatusBadge");
      const banner = document.getElementById("runtimeBanner");
      const title = document.getElementById("runtimeBannerTitle");
      const text = document.getElementById("runtimeBannerText");
      if (badge) {
        badge.textContent = online ? "Server connected" : "Server offline";
        badge.className = `badge ${online ? "green" : "amber"}`;
      }
      const adminBadge = document.getElementById("adminServerBadge");
      if (adminBadge) {
        adminBadge.textContent = online ? "Connected" : "Server offline";
        adminBadge.className = `badge ${online ? "green" : "amber"}`;
      }
      if (banner && title && text) {
        banner.classList.toggle("show", !online);
        title.textContent = "Local server is not connected";
        text.textContent = detail || "Upload, OCR, invoice matching, database saves, and real weather need http://127.0.0.1:4182/ instead of opening index.html directly.";
      }
    }

    async function checkBackendStatus() {
      if (location.protocol === "file:") {
        setBackendStatus(false);
        return false;
      }
      setBackendStatus(true);
      try {
        const health = await apiJson("/api/health");
        readinessData = health.readiness || readinessData;
        setBackendStatus(true);
        return true;
      } catch (error) {
        setBackendStatus(false, error.message || "The page could not reach the local server yet.");
        return false;
      }
    }

    async function reconnectBackendIfNeeded() {
      if (backendOnline || location.protocol === "file:") return;
      const online = await checkBackendStatus();
      if (!online) return;
      const authenticated = await checkAuthStatus();
      if (authenticated && backendDataLoaded) await loadBackendData();
      showToast("Server connected.");
    }

    function renderSystemReadiness() {
      const badge = document.getElementById("readinessBadge");
      const rows = document.getElementById("readinessRows");
      if (!rows) return;
      const checks = readinessData?.checks || [];
      if (badge) {
        badge.textContent = readinessData?.productionReady ? "Ready" : checks.length ? "Needs fixes" : "Checking";
        badge.className = `badge ${readinessData?.productionReady ? "green" : checks.length ? "amber" : "gray"}`;
      }
      rows.innerHTML = checks.map(check => `
        <tr>
          <td><strong>${escapeHtml(check.label)}</strong></td>
          <td><span class="badge ${check.ok ? "green" : "red"}">${check.ok ? "OK" : "Fix"}</span></td>
          <td>${escapeHtml(check.detail)}</td>
        </tr>
      `).join("") || `<tr><td colspan="3">Server readiness has not loaded yet.</td></tr>`;
    }

    function requireBackend(action = "This feature") {
      if (backendOnline) return true;
      showToast(`${action} needs the local server. Open http://127.0.0.1:4182/`);
      setBackendStatus(false);
      return false;
    }

    async function createLocalBackup() {
      if (!requireBackend("Creating a backup")) return;
      try {
        const backup = await apiJson("/api/backup", { method: "POST" });
        await loadBackupRecords();
        showToast(`Backup created: ${backup.backupPath}`);
      } catch (error) {
        showToast("Backup failed. Restart the local server, then try again.");
      }
    }

    function formatBytes(bytes) {
      const size = Number(bytes || 0);
      if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
      if (size >= 1024) return `${Math.round(size / 1024)} KB`;
      return `${size} B`;
    }

    function renderBackupRecords() {
      const rows = document.getElementById("backupRows");
      if (!rows) return;
      rows.innerHTML = backupRecords.map(backup => `
        <tr>
          <td><strong>${escapeHtml(backup.name)}</strong><br><span style="color:var(--muted);font-size:12px">${escapeHtml(backup.backupPath || "")}</span></td>
          <td>${escapeHtml(new Date(backup.updatedAt || backup.createdAt).toLocaleString())}</td>
          <td>${escapeHtml(formatBytes(backup.bytes))}</td>
          <td><button class="btn danger" onclick="restoreLocalBackup('${jsArg(backup.id)}')">Restore</button></td>
        </tr>
      `).join("") || `<tr><td colspan="4">No backups created yet.</td></tr>`;
    }

    async function loadBackupRecords() {
      if (!backendOnline && !(await checkBackendStatus())) {
        renderBackupRecords();
        return;
      }
      try {
        backupRecords = await apiJson("/api/backups");
      } catch {
        backupRecords = [];
      }
      renderBackupRecords();
    }

    async function restoreLocalBackup(id) {
      const backup = backupRecords.find(item => item.id === id);
      if (!backup) return;
      if (!confirm(`Restore ${backup.name}? The app will create a safety backup first, restore this database, then the local server will stop so you can restart it.`)) return;
      try {
        await apiJson("/api/restore", {
          method: "POST",
          body: JSON.stringify({ id })
        });
        showToast("Backup restored. Restart the local server, then refresh this page.");
      } catch (error) {
        showToast("Restore failed. The current database was not changed.");
      }
    }

    function replaceArray(target, records) {
      target.splice(0, target.length, ...(records || []));
    }

    function mergeLiveContracts(records, totalCount = null) {
      const incoming = (records || []).map(normalizeContract).filter(record => record?.id);
      const byId = new Map();
      [...contracts, ...contractData].filter(record => record?.id).forEach(record => byId.set(record.id, record));
      incoming.forEach(record => byId.set(record.id, { ...(byId.get(record.id) || {}), ...record }));
      const merged = [...byId.values()].sort((a, b) => {
        const left = Date.parse(b.updatedAt || b.createdAt || b.uploadDate || "") || 0;
        const right = Date.parse(a.updatedAt || a.createdAt || a.uploadDate || "") || 0;
        return left - right;
      });
      replaceArray(contracts, merged);
      contractData = [...merged];
      if (Number.isFinite(Number(totalCount))) contractsTotalCount = Number(totalCount);
      else contractsTotalCount = Math.max(contractsTotalCount, contractData.length);
    }

    async function loadContractsAlphabetically() {
      if (!backendOnline && !(await checkBackendStatus())) return false;
      const pageSize = SAFE_INDEX_PAGE_SIZE;
      let page = 1;
      let total = 0;
      const records = [];
      do {
        const result = await apiJson(`/api/contracts?page=${page}&pageSize=${pageSize}&compact=1&sort=name`);
        const pageRecords = Array.isArray(result) ? result : (result.records || []);
        records.push(...pageRecords.map(normalizeContract).filter(record => record?.id));
        total = Number(result.total || records.length || 0);
        page += 1;
        if (!pageRecords.length) break;
      } while (records.length < total && records.length < MAX_BACKGROUND_CONTRACTS && page <= 3);
      const byId = new Map();
      records.forEach(record => byId.set(record.id, record));
      const sorted = [...byId.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }));
      replaceArray(contracts, sorted);
      contractData = [...sorted];
      contractsTotalCount = total || sorted.length;
      compactContractIndexLoaded = sorted.length >= Number(contractsTotalCount || 0);
      backendDataLoaded = true;
      liveDataLoadedForSection = "contracts";
      liveDataLoadedAtBySection.contracts = Date.now();
      sendPresenceUpdate(activeWorkContext.action || "Viewing", { immediate: true });
      return true;
    }

    async function ensureCompactContractIndex({ sort = "" } = {}) {
      if (!backendOnline && !(await checkBackendStatus())) return contractData;
      if (compactContractIndexLoaded && contractData.length >= Number(contractsTotalCount || 0)) return contractData;
      if (compactContractIndexPromise) return compactContractIndexPromise;
      compactContractIndexPromise = (async () => {
        try {
          const sortQuery = sort ? `&sort=${encodeURIComponent(sort)}` : "";
          const result = await apiJson(`/api/contracts?page=1&pageSize=${MAX_BACKGROUND_CONTRACTS}&compact=1${sortQuery}`);
          const records = Array.isArray(result) ? result : (result.records || []);
          mergeLiveContracts(records, Array.isArray(result) ? records.length : result.total);
          compactContractIndexLoaded = contractData.length >= Number(contractsTotalCount || 0);
          return contractData;
        } catch (error) {
          return contractData;
        } finally {
          compactContractIndexPromise = null;
        }
      })();
      return compactContractIndexPromise;
    }

    function markLiveDataDirty() {
      backendLoadPromise = null;
      dashboardLoadPromise = null;
      dashboardLiveLoaded = false;
      dashboardLiveLoadedAt = 0;
      backendDataLoaded = false;
      liveDataLoadedForSection = "";
      Object.keys(liveDataLoadedAtBySection).forEach(key => delete liveDataLoadedAtBySection[key]);
      financeSummaryData = null;
      servicesSummaryData = null;
      adminSummaryData = null;
      reviewSummaryData = null;
      financeContractsLoaded = false;
      financeContractsLoadingPromise = null;
      financeContractsWarmLoadScheduled = false;
      financeContractData = [];
      financeContractsTotal = 0;
      compactContractIndexLoaded = false;
      compactContractIndexPromise = null;
      contractsTotalCount = Math.max(contractsTotalCount, contracts.length, contractData.length);
      lastBackendContractSearch = "";
      contractSearchEngine = "";
      clearVendorRequirementLearningCache();
    }

    function upsertLiveContract(record, options = {}) {
      if (!record) return null;
      const shouldMarkDirty = options.markDirty !== false;
      const normalized = normalizeContract(record);
      if (!normalized.id) return normalized;
      const upsert = (list, item) => {
        const index = list.findIndex(contract => contract.id === item.id);
        if (index >= 0) list.splice(index, 1, item);
        else list.unshift(item);
      };
      upsert(contracts, normalized);
      upsert(contractData, normalized);
      if (financeContractsLoaded || financeContractData.length) upsert(financeContractData, normalized);
      ocrJobs.forEach(job => {
        if (job.contractId === normalized.id || job.contract_id === normalized.id) {
          job.extractedFields = normalized.extractedFields || job.extractedFields;
          job.name = normalized.name || job.name;
          job.updatedAt = normalized.updatedAt || job.updatedAt;
        }
      });
      if (activeReviewContractId === normalized.id && normalized.extractedFields?.length) {
        reviewFields = normalized.extractedFields;
      }
      if (shouldMarkDirty) markLiveDataDirty();
      return normalized;
    }

    async function ensureFinanceContractsLoaded({ rerender = false } = {}) {
      if (!backendOnline || financeContractsLoaded) return financeContractData;
      if (financeContractsLoadingPromise) return financeContractsLoadingPromise;
      financeContractsLoadingPromise = (async () => {
        try {
          const pageSize = 500;
          let page = 1;
          let total = 0;
          const records = [];
          do {
            const result = await apiJson(`/api/contracts?page=${page}&pageSize=${pageSize}&compact=1`);
            const pageRecords = Array.isArray(result) ? result : (result.records || []);
            records.push(...pageRecords.map(normalizeContract));
            total = Number(result.total || records.length || 0);
            page += 1;
            if (!pageRecords.length) break;
          } while (records.length < total && page <= 20);
          financeContractsTotal = total || records.length;
          financeContractData = records;
          financeContractsLoaded = true;
          contractsTotalCount = Math.max(contractsTotalCount, financeContractsTotal, records.length);
          const merged = new Map(contractData.map(contract => [contract.id, contract]));
          records.forEach(contract => merged.set(contract.id, { ...(merged.get(contract.id) || {}), ...contract }));
          contractData = [...merged.values()];
          if (rerender && activeSectionId() === "finance") renderFinancePage();
          if (rerender && activeSectionId() === "dashboard") renderDashboard();
          return financeContractData;
        } catch (error) {
          financeContractsLoaded = false;
          return financeContractData;
        } finally {
          financeContractsLoadingPromise = null;
        }
      })();
      return financeContractsLoadingPromise;
    }

    async function ensureFullContractRecord(id) {
      let contract = contractData.find(item => item.id === id) || contracts.find(item => item.id === id) || null;
      const contractId = contract?.id || id;
      const needsFullRecord = backendOnline && contractId && (
        !contract
        || !Array.isArray(contract.extractedFields)
        || Number(contract.extractedFieldsCount || 0) > (contract.extractedFields || []).length
        || !contract.ocrText
        || (contract.ocrTextPreview && !contract.ocrText)
      );
      if (!needsFullRecord) return contract;
      const fullContract = normalizeContract(await apiJson(`/api/contracts/${encodeURIComponent(contractId)}`));
      const replaceOrAdd = (list, record) => {
        const index = list.findIndex(item => item.id === record.id);
        if (index >= 0) list.splice(index, 1, record);
        else list.unshift(record);
      };
      replaceOrAdd(contracts, fullContract);
      replaceOrAdd(contractData, fullContract);
      return fullContract;
    }

    function scopedContractSearchQuery(value, scope) {
      const text = String(value || "").trim();
      if (!text) return "";
      const prefix = {
        name: "contract name",
        vendor: "vendor",
        facility: "facility",
        service: "service category type",
        ocr: "terms clause OCR text"
      }[scope] || "";
      return [prefix, text].filter(Boolean).join(" ");
    }

    async function refreshContractBackendSearch({ force = false } = {}) {
      const searchInput = document.getElementById("contractSearch");
      const scopeInput = document.getElementById("contractSearchScope");
      const rawSearch = String(searchInput?.value || "").trim();
      const scope = String(scopeInput?.value || "all");
      if (!backendOnline || !rawSearch) return false;
      const query = scopedContractSearchQuery(rawSearch, scope);
      const key = `${scope}:${query}`;
      if (!force && key === lastBackendContractSearch) return true;
      lastBackendContractSearch = key;
      try {
        const result = await apiJson(`/api/contracts?q=${encodeURIComponent(query)}&page=1&pageSize=100`);
        const records = Array.isArray(result) ? result : (result.records || []);
        const incoming = records.map(normalizeContract);
        const byId = new Map(contracts.map(contract => [contract.id, contract]));
        incoming.forEach(contract => byId.set(contract.id, contract));
        replaceArray(contracts, [...byId.values()]);
        contractData = incoming.length ? incoming : [...contracts];
        if (!Array.isArray(result) && Number.isFinite(Number(result.total))) contractsTotalCount = Number(result.total);
        contractSearchEngine = result.searchEngine || "database";
        return true;
      } catch (error) {
        contractSearchEngine = "local fallback";
        return false;
      }
    }

    function scheduleContractBackendSearch() {
      clearTimeout(contractSearchTimer);
      contractSearchTimer = setTimeout(async () => {
        const didSearch = await refreshContractBackendSearch();
        if (didSearch) renderContracts();
      }, 250);
    }

    async function loadBackendData(options = {}) {
      const shouldRenderAfterLoad = options.renderAfter !== false;
      if (backendLoadPromise) return backendLoadPromise;
      backendLoadPromise = (async () => {
      try {
        if (!backendOnline && !(await checkBackendStatus())) return;
        const activeAtLoad = activeSectionId();
        const wantsAdminOptional = activeAtLoad === "admin";
        const wantsFullOptional = ["reports", "facilities", "renewals", "compliance", "exceptions", "tasks"].includes(activeAtLoad);
        const wantsPortfolioOptional = wantsFullOptional || ["vendors", "upload"].includes(activeAtLoad);
        const wantsFacilitiesOptional = wantsPortfolioOptional || wantsAdminOptional || activeAtLoad === "finance";
        const ocrJobsRequest = activeAtLoad === "ocrqueue"
          ? apiJson(`/api/ocr-jobs?page=${ocrQueuePage}&pageSize=${ocrQueuePageSize}&lean=1`)
          : activeAtLoad === "review"
            ? apiJson(`/api/ocr-jobs?page=1&pageSize=${MAX_TABLE_RENDER_ROWS}&lean=1`)
            : Promise.resolve([]);
        const wantsCompleteCompactIndex = ["reports", "renewals", "compliance", "tasks", "exceptions"].includes(activeAtLoad);
        const contractPageSize = activeAtLoad === "dashboard"
          ? 1
          : activeAtLoad === "review"
            ? MAX_TABLE_RENDER_ROWS
            : wantsCompleteCompactIndex
              ? MAX_BACKGROUND_CONTRACTS
              : FAST_PAGE_SIZE;
        const [contractResult, jobs] = await Promise.all([
          apiJson(`/api/contracts?page=1&pageSize=${contractPageSize}&compact=1`),
          ocrJobsRequest
        ]);
        const optional = await Promise.all([
          (activeAtLoad === "dashboard" || wantsFullOptional) ? apiJson("/api/dashboard").catch(() => dashboardData || {}) : Promise.resolve(dashboardData || {}),
          wantsFacilitiesOptional ? apiJson("/api/facilities").catch(() => []) : Promise.resolve(facilities || []),
          wantsPortfolioOptional ? apiJson("/api/vendors?light=1&limit=500").catch(() => vendorsData || []) : Promise.resolve(vendorsData || []),
          wantsPortfolioOptional ? apiJson("/api/categories").catch(() => categoryData || []) : Promise.resolve(categoryData || []),
          (wantsFullOptional || wantsAdminOptional) ? apiJson("/api/tasks").catch(() => tasks || []) : Promise.resolve(tasks || []),
          wantsFullOptional ? apiJson("/api/exceptions").catch(() => exceptions || []) : Promise.resolve(exceptions || []),
          wantsFullOptional ? apiJson("/api/reports/cost").catch(() => costReport || []) : Promise.resolve(costReport || []),
          (activeAtLoad === "admin") ? apiJson("/api/ai-status").catch(() => aiStatus) : Promise.resolve(aiStatus),
          (activeAtLoad === "vendors") ? apiJson("/api/utility-accounts").catch(() => utilityAccounts || []) : Promise.resolve(utilityAccounts || []),
          (activeAtLoad === "admin" || activeAtLoad === "upload" || activeAtLoad === "reports") ? apiJson("/api/admin-settings").catch(() => adminSettings || {}) : Promise.resolve(adminSettings || {}),
          (activeAtLoad === "admin") ? apiJson("/api/readiness").catch(() => readinessData) : Promise.resolve(readinessData),
          (activeAtLoad === "admin" && currentUser?.role === "Admin") ? apiJson("/api/users").catch(() => appUsers || []) : Promise.resolve(appUsers || []),
          (activeAtLoad === "finance") ? apiJson("/api/finance-summary").catch(() => financeSummaryData) : Promise.resolve(financeSummaryData),
          (activeAtLoad === "categories") ? apiJson("/api/services-summary").catch(() => servicesSummaryData) : Promise.resolve(servicesSummaryData),
          (activeAtLoad === "admin") ? apiJson("/api/admin-summary").catch(() => adminSummaryData) : Promise.resolve(adminSummaryData),
          (activeAtLoad === "review") ? apiJson("/api/review-summary").catch(() => reviewSummaryData) : Promise.resolve(reviewSummaryData)
        ]);
        const [dashboard, facilityRecords, vendorRecords, categoryRecords, taskRecords, exceptionRecords, costRows, ai, utilityRecords, settings, readiness, userRecords, financeSummary, servicesSummary, adminSummary, reviewSummary] = optional;
        const contractRecords = Array.isArray(contractResult) ? contractResult : (contractResult.records || []);
        mergeLiveContracts(contractRecords, Array.isArray(contractResult) ? contractRecords.length : contractResult.total);
        compactContractIndexLoaded = contractData.length >= Number(contractsTotalCount || 0);
        ocrJobs = Array.isArray(jobs) ? jobs : (Array.isArray(jobs?.records) ? jobs.records : []);
        if (jobs && !Array.isArray(jobs)) {
          ocrQueuePage = jobs.page || ocrQueuePage;
          ocrQueuePageSize = jobs.pageSize || ocrQueuePageSize;
          ocrQueueTotal = jobs.total || ocrJobs.length;
        } else if (activeAtLoad !== "ocrqueue") {
          ocrQueueTotal = Math.max(ocrQueueTotal, ocrJobs.length);
        }
        dashboardData = dashboard || {};
        if (dashboard && Object.keys(dashboard).length) dashboardLiveLoaded = true;
        adminSettings = settings || adminSettings;
        if (Array.isArray(adminSettings.categories) && adminSettings.categories.length) {
          replaceArray(categories, [...new Map(adminSettings.categories.map(item => [masterKey(item), item])).values()]);
        }
        replaceArray(facilities, dedupeRecords([
          ...((adminSettings.facilityProfiles || []).map(normalizeFacilityRecord)),
          ...((Array.isArray(facilityRecords) ? facilityRecords : []).map(normalizeFacilityRecord))
        ], "name"));
        replaceArray(vendorsData, dedupeRecords([
          ...(Array.isArray(vendorRecords) ? vendorRecords : [])
        ], "name"));
        vendorDirectoryRevision += 1;
        vendorDirectoryCache = null;
        categoryData = dedupeRecords(Array.isArray(categoryRecords) ? categoryRecords : [], "category");
        replaceArray(tasks, taskRecords);
        replaceArray(exceptions, exceptionRecords);
        replaceArray(costReport, costRows);
        aiStatus = ai || aiStatus;
        utilityAccounts = Array.isArray(utilityRecords) ? utilityRecords : [];
        readinessData = readiness || readinessData;
        appUsers = Array.isArray(userRecords) ? userRecords : [];
        financeSummaryData = financeSummary || financeSummaryData;
        servicesSummaryData = servicesSummary || servicesSummaryData;
        adminSummaryData = adminSummary || adminSummaryData;
        reviewSummaryData = reviewSummary || reviewSummaryData;
        if (adminSettings.weatherCoordinates) {
          facilityCoordinates = { ...facilityCoordinates, ...adminSettings.weatherCoordinates };
          saveFacilityCoordinates();
        }
        backendDataLoaded = true;
        liveDataLoadedForSection = activeAtLoad;
        liveDataLoadedAtBySection[activeAtLoad] = Date.now();
        sendPresenceUpdate(activeWorkContext.action || "Viewing", { immediate: true });
        const active = activeSectionId();
        if (shouldRenderAfterLoad) renderActiveSectionOnly(active);
        scheduleIdleTask(() => initFilters(activeSectionId()), 500);
        if (active === "backups") scheduleIdleTask(() => loadBackupRecords(), 500);
      } catch (error) {
        if (String(error.message || "").includes("Authentication required")) {
          showLoginScreen("Your session expired. Sign in again to continue.");
          return;
        }
        console.warn("Core contract data load failed:", error);
        showToast("The server is connected, but the contract list did not load. Refresh once or restart the server window.");
      }
      })();
      try {
        return await backendLoadPromise;
      } finally {
        backendLoadPromise = null;
      }
    }

    async function loadDashboardLiveData(options = {}) {
      const shouldRenderAfterLoad = options.renderAfter !== false;
      if (dashboardLoadPromise) return dashboardLoadPromise;
      dashboardLoadPromise = (async () => {
        try {
          if (!backendOnline && !(await checkBackendStatus())) return;
          const [dashboardSummary, financeSummary] = await Promise.all([
            apiJson("/api/dashboard").catch(() => dashboardData || {}),
            apiJson("/api/finance-summary").catch(() => financeSummaryData)
          ]);
          dashboardData = dashboardSummary || {};
          financeSummaryData = financeSummary || financeSummaryData;
          dashboardLiveLoaded = true;
          dashboardLiveLoadedAt = Date.now();
          if (shouldRenderAfterLoad && activeSectionId() === "dashboard") renderActiveSectionOnly("dashboard");
        } catch (error) {
          console.warn("Dashboard data load failed:", error);
          dashboardLiveLoaded = true;
          dashboardLiveLoadedAt = Date.now();
          if (shouldRenderAfterLoad && activeSectionId() === "dashboard") renderActiveSectionOnly("dashboard");
        }
      })();
      try {
        return await dashboardLoadPromise;
      } finally {
        dashboardLoadPromise = null;
      }
    }

    async function loadSectionSummary(section = activeSectionId(), { fresh = false } = {}) {
      if (!backendOnline && !(await checkBackendStatus())) return null;
      const suffix = fresh ? "?fresh=1" : "";
      if (section === "finance") {
        financeSummaryData = await apiJson(`/api/finance-summary${suffix}`).catch(() => financeSummaryData);
        liveDataLoadedAtBySection.finance = Date.now();
        if (activeSectionId() === "finance") renderFinancePage();
        return financeSummaryData;
      }
      if (section === "categories") {
        servicesSummaryData = await apiJson(`/api/services-summary${suffix}`).catch(() => servicesSummaryData);
        liveDataLoadedAtBySection.categories = Date.now();
        if (activeSectionId() === "categories") renderCategories();
        return servicesSummaryData;
      }
      if (section === "admin") {
        const [summary, presence] = await Promise.all([
          apiJson(`/api/admin-summary${suffix}`).catch(() => adminSummaryData),
          apiJson("/api/presence").catch(() => activePresenceData)
        ]);
        adminSummaryData = summary;
        activePresenceData = Array.isArray(presence) ? presence : activePresenceData;
        liveDataLoadedAtBySection.admin = Date.now();
        if (activeSectionId() === "admin") renderActiveSectionOnly("admin");
        return adminSummaryData;
      }
      if (section === "review") {
        reviewSummaryData = await apiJson(`/api/review-summary?page=${reviewQueuePage}&pageSize=${reviewQueuePageSize}${suffix ? "&fresh=1" : ""}`).catch(() => reviewSummaryData);
        if (Array.isArray(reviewSummaryData?.records)) mergeLiveContracts(reviewSummaryData.records, contractsTotalCount);
        if (activeSectionId() === "review") renderReviewQueue();
        return reviewSummaryData;
      }
      return null;
    }

    async function refreshLiveDataNow() {
      if (!backendOnline && !(await checkBackendStatus())) {
        showToast("Server is not connected.");
        return;
      }
      const section = activeSectionId();
      showToast("Refreshing live data...");
      if (section === "dashboard") {
        dashboardLiveLoaded = false;
        dashboardLoadPromise = null;
        await loadDashboardLiveData();
      } else if (["finance", "categories", "admin", "review"].includes(section)) {
        await loadSectionSummary(section, { fresh: true });
        liveDataLoadedAtBySection[section] = Date.now();
      } else {
        backendDataLoaded = false;
        liveDataLoadedForSection = "";
        backendLoadPromise = null;
        await loadBackendData();
      }
      renderActiveSectionOnly(section);
      showToast("Live data updated.");
    }

    function renderAiStatus() {
      const status = document.getElementById("aiExtractionStatus");
      const badge = document.getElementById("aiExtractionBadge");
      if (!status || !badge) return;
      status.textContent = aiStatus.enabled
        ? `AI extraction ready with ${aiStatus.model}.`
        : "Rules-only until OPENAI_API_KEY is configured.";
      badge.textContent = aiStatus.enabled ? "AI Ready" : "Rules";
      badge.className = `badge ${aiStatus.enabled ? "green" : "gray"}`;
    }

    function renderUtilityAccounts() {
      const count = document.getElementById("utilityAccountCount");
      const preview = document.getElementById("utilityAccountPreview");
      if (!count || !preview) return;
      count.textContent = `${utilityAccounts.length} account${utilityAccounts.length === 1 ? "" : "s"}`;
      preview.innerHTML = utilityAccounts.slice(0, 4).map(account => `
        <div class="metric-row">
          <div><strong>${escapeHtml(account.facility || "Unknown facility")}</strong><span>${escapeHtml(account.vendor || "Utility")} ${escapeHtml(account.accountNumber || account.meterNumber || "No account number")}</span></div>
          <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="badge blue">${escapeHtml(account.utilityType || "Utility")}</span><button class="btn danger" onclick="deleteUtilityAccount('${jsArg(account.id)}', '${jsArg(account.accountNumber || account.meterNumber || "this account")}')">Delete</button></span>
        </div>
      `).join("") || `<div class="metric-row"><div><strong>No utility accounts imported yet.</strong><span>Add utility account numbers to improve OCR matching.</span></div><span class="badge gray">Empty</span></div>`;
    }

    function sameVendorName(a, b) {
      const canonicalKey = value => {
        const key = masterKey(value);
        const profile = vendorsData.find(vendor => [
          vendor.name,
          vendor.legalName,
          vendor.dba,
          ...(Array.isArray(vendor.aliases) ? vendor.aliases : String(vendor.aliases || "").split(/[;|,]/))
        ].some(alias => masterKey(alias) === key));
        return masterKey(profile?.name || value);
      };
      const left = canonicalKey(a);
      return Boolean(left && left === canonicalKey(b));
    }

    function loadFacilityCoordinates() {
      try {
        facilityCoordinates = JSON.parse(localStorage.getItem("contractFacilityCoordinates") || "{}") || {};
      } catch {
        facilityCoordinates = {};
      }
    }

    function saveFacilityCoordinates() {
      localStorage.setItem("contractFacilityCoordinates", JSON.stringify(facilityCoordinates));
    }

    function applyWeatherFacilityCoordinates() {
      const facility = document.getElementById("weatherFacility")?.value || "";
      const coords = facilityCoordinates[facility];
      if (!coords) return;
      document.getElementById("weatherLatitude").value = coords.latitude || "";
      document.getElementById("weatherLongitude").value = coords.longitude || "";
    }

    function shortDateTime(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value || "";
      return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    }

    function auditActionLabel(action = "") {
      return String(action || "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, letter => letter.toUpperCase());
    }

    function actionBadgeClass(status = "") {
      const clean = String(status || "").toLowerCase();
      if (clean.includes("fail") || clean.includes("overdue") || clean.includes("error")) return "red";
      if (clean.includes("pending") || clean.includes("queued") || clean.includes("needs") || clean.includes("processing") || clean.includes("open")) return "amber";
      if (clean.includes("complete") || clean.includes("approved") || clean.includes("active")) return "green";
      return "gray";
    }

    function userLastSeen(username) {
      const key = String(username || "").toLowerCase();
      const event = auditLogs.find(log => {
        const actor = String(log.actor || "").toLowerCase();
        const detailUser = String(log.details?.username || log.details?.actor || "").toLowerCase();
        const entity = String(log.entityId || "").toLowerCase();
        return actor === key || detailUser === key || entity === key;
      });
      return event ? shortDateTime(event.createdAt) : "No activity yet";
    }

    function renderAdminMonitor() {
      if (backendOnline && !adminSummaryData) {
        loadSectionSummary("admin").catch(() => null);
      }
      const badge = document.getElementById("adminMonitorBadge");
      if (!badge) return;
      const activeUsers = appUsers.filter(user => (user.status || "Active") === "Active");
      const openTasks = tasks.filter(task => !/done|closed|complete/i.test(task.status || ""));
      const reviewQueue = reviewQueueItems();
      const ocrIssues = ocrJobs.filter(job => !/complete/i.test(job.status || ""));
      const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
      };
      setText("adminActiveUserCount", adminSummaryData?.activeUsers ?? activeUsers.length);
      setText("adminOpenTaskCount", adminSummaryData?.openTasks ?? openTasks.length);
      setText("adminReviewQueueCount", adminSummaryData?.reviewWaiting ?? reviewQueue.length);
      setText("adminOcrIssueCount", adminSummaryData?.ocrIssues ?? ocrIssues.length);
      setText("adminLearningRuleCount", adminSummaryData?.learningRules ?? learningRules.length);
      badge.textContent = adminSummaryData?.generatedAt ? "Live summary" : `${auditLogs.length} audit events`;
      badge.className = `badge ${auditLogs.length ? "blue" : "gray"}`;

      const presenceRows = document.getElementById("adminPresenceRows");
      if (presenceRows) {
        presenceRows.innerHTML = activePresenceData.slice(0, 30).map(record => `
          <tr>
            <td><strong>${escapeHtml(record.fullName || record.user || "User")}</strong><br><span style="color:var(--muted);font-size:12px">${escapeHtml(record.user || "")}</span></td>
            <td>${escapeHtml(record.page || sectionPresenceLabel(record.section || "dashboard"))}</td>
            <td>${record.itemName ? `<strong>${escapeHtml(record.itemName)}</strong>` : `<span class="muted">No record open</span>`}</td>
            <td><span class="badge blue">${escapeHtml(record.action || "Viewing")}</span></td>
            <td>${escapeHtml(shortDateTime(record.lastSeenAt))}</td>
          </tr>
        `).join("") || `<tr><td colspan="5">No active staff pings yet. This fills as users open pages or records.</td></tr>`;
      }

      const workItems = [
        ...openTasks.map(task => ({
          type: "Task",
          item: task.task || "Untitled task",
          owner: task.owner || "Unassigned",
          status: task.status || "Open",
          due: task.due || task.updatedAt || ""
        })),
        ...ocrIssues.map(job => {
          const contract = contractForJob(job);
          return {
            type: "OCR",
            item: contract.name || job.contractId || job.id,
            owner: contract.owner || "Contract Dept",
            status: job.status || "Queued",
            due: job.updatedAt || job.createdAt || ""
          };
        }),
        ...reviewQueue.slice(0, 25).map(job => {
          const contract = contractForJob(job);
          return {
          type: contract.documentType && contract.documentType !== "Contract" ? contract.documentType : "Review",
          item: contract.name || job.contractId || job.id,
          owner: contract.owner || "Contract Dept",
          status: contract.reviewStatus || contract.status || job.status || "Needs Review",
          due: contract.updatedAt || job.updatedAt || job.createdAt || ""
          };
        })
      ].slice(0, 30);

      const workRows = document.getElementById("adminWorkQueueRows");
      if (workRows) {
        workRows.innerHTML = workItems.map(item => `
          <tr>
            <td><span class="badge blue">${escapeHtml(item.type)}</span></td>
            <td><strong>${escapeHtml(item.item)}</strong></td>
            <td>${escapeHtml(item.owner)}</td>
            <td><span class="badge ${actionBadgeClass(item.status)}">${escapeHtml(item.status)}</span></td>
            <td>${escapeHtml(shortDateTime(item.due))}</td>
          </tr>
        `).join("") || `<tr><td colspan="5">No open tasks, OCR issues, or review queue items right now.</td></tr>`;
      }

      const activityRows = document.getElementById("adminActivityRows");
      if (activityRows) {
        activityRows.innerHTML = auditLogs.slice(0, 20).map(log => `
          <tr>
            <td>${escapeHtml(shortDateTime(log.createdAt))}</td>
            <td>${escapeHtml(log.details?.username || log.details?.actor || log.actor || "local-user")}</td>
            <td><span class="badge ${actionBadgeClass(log.action)}">${escapeHtml(auditActionLabel(log.action))}</span></td>
            <td>${escapeHtml(log.details?.name || log.details?.task || log.entityId || "")}</td>
          </tr>
        `).join("") || `<tr><td colspan="4">No user activity has been recorded yet.</td></tr>`;
      }

      const userActivityRows = document.getElementById("adminUserActivityRows");
      if (userActivityRows) {
        const visibleUsers = appUsers.slice(0, 80);
        userActivityRows.innerHTML = visibleUsers.map(user => `
          <tr>
            <td><strong>${escapeHtml(user.fullName || user.username)}</strong><br><span style="color:var(--muted);font-size:12px">${escapeHtml(user.username || "")}</span></td>
            <td>${escapeHtml(user.role || "Read Only")}</td>
            <td>${escapeHtml(user.facility || "All")}</td>
            <td><span class="badge ${user.status === "Disabled" ? "gray" : "green"}">${escapeHtml(user.status || "Active")}</span></td>
            <td>${escapeHtml(userLastSeen(user.username))}</td>
          </tr>
        `).join("") + (appUsers.length > visibleUsers.length ? `<tr><td colspan="5"><span class="badge gray">Showing first ${visibleUsers.length} of ${appUsers.length} users.</span></td></tr>` : "") || `<tr><td colspan="5">No app users are configured yet. Add users in Permissions below.</td></tr>`;
      }
    }

    const adminResponsibilityOptions = [
      { key: "upload", label: "Upload" },
      { key: "review", label: "Review" },
      { key: "approve", label: "Approve" },
      { key: "search", label: "Search" },
      { key: "reports", label: "Reports" },
      { key: "finance", label: "Finance" },
      { key: "vendors", label: "Vendors" },
      { key: "facilities", label: "Facilities" },
      { key: "admin", label: "Admin" },
      { key: "readonly", label: "Read only" }
    ];

    const adminRoleResponsibilityDefaults = {
      "admin": adminResponsibilityOptions.map(item => item.key),
      "contract team": ["upload", "review", "approve", "search", "reports"],
      "contract department": ["upload", "review", "approve", "search", "reports"],
      "facility user": ["search", "reports", "readonly"],
      "vendor/profile user": ["vendors", "search"],
      "finance user": ["finance", "reports", "search"],
      "read only": ["search", "readonly"],
      "field reviewer": ["review", "search"]
    };

    function splitAdminScope(scope = "All") {
      const raw = String(scope || "All").trim();
      if (!raw || /^all$/i.test(raw)) return ["All"];
      return raw.split(/[;,|]/).map(item => item.trim()).filter(Boolean);
    }

    function selectedAdminResponsibilities() {
      return [...document.querySelectorAll("[data-admin-responsibility]:checked")].map(input => input.value);
    }

    function selectedAdminFacilities() {
      const allBox = document.querySelector("[data-admin-facility='All']");
      if (allBox?.checked) return ["All"];
      return [...document.querySelectorAll("[data-admin-facility]:checked")]
        .map(input => input.value)
        .filter(value => value && value !== "All");
    }

    function syncAdminFacilityScopeFromChecks() {
      const active = document.activeElement;
      if (active?.matches?.("[data-admin-facility]")) {
        const allBox = document.querySelector("[data-admin-facility='All']");
        if (active.value === "All" && active.checked) {
          document.querySelectorAll("[data-admin-facility]").forEach(input => {
            if (input.value !== "All") input.checked = false;
          });
        } else if (active.value !== "All" && active.checked && allBox) {
          allBox.checked = false;
        }
      }
      const selected = selectedAdminFacilities();
      const value = selected.includes("All") || !selected.length ? "All" : selected.join("; ");
      document.getElementById("adminUserFacility").value = value;
      setAdminScopePreset(value);
      renderAdminFacilityChecklist(selected);
    }

    function renderAdminFacilityChecklist(selected = splitAdminScope(document.getElementById("adminUserFacility")?.value || "All")) {
      const target = document.getElementById("adminFacilityChecklist");
      if (!target) return;
      const selectedSet = new Set((selected || []).map(item => String(item || "").trim()).filter(Boolean));
      const allSelected = selectedSet.has("All") || !selectedSet.size;
      const facilityNames = [...new Set((adminSettings.facilityProfiles || [])
        .map(profile => profile.name)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)))];
      target.innerHTML = `
        <label class="admin-check-pill ${allSelected ? "checked" : ""}">
          <input type="checkbox" data-admin-facility="All" value="All" ${allSelected ? "checked" : ""} onchange="syncAdminFacilityScopeFromChecks()" />
          <span>All facilities</span>
        </label>
        ${facilityNames.map(name => {
          const checked = !allSelected && selectedSet.has(name);
          return `
            <label class="admin-check-pill ${checked ? "checked" : ""}">
              <input type="checkbox" data-admin-facility="${escapeHtml(name)}" value="${escapeHtml(name)}" ${checked ? "checked" : ""} onchange="syncAdminFacilityScopeFromChecks()" />
              <span>${escapeHtml(name)}</span>
            </label>
          `;
        }).join("")}
      `;
    }

    function renderAdminResponsibilityChecklist(selected = []) {
      const target = document.getElementById("adminResponsibilityChecklist");
      if (!target) return;
      const selectedSet = new Set((selected || []).map(item => String(item || "").trim()).filter(Boolean));
      target.innerHTML = adminResponsibilityOptions.map(item => {
        const checked = selectedSet.has(item.key);
        return `
          <label class="admin-check-pill ${checked ? "checked" : ""}">
            <input type="checkbox" data-admin-responsibility value="${escapeHtml(item.key)}" ${checked ? "checked" : ""} onchange="this.closest('label')?.classList.toggle('checked', this.checked)" />
            <span>${escapeHtml(item.label)}</span>
          </label>
        `;
      }).join("");
    }

    function adminRoleDefaultResponsibilities(role) {
      return adminRoleResponsibilityDefaults[String(role || "").trim().toLowerCase()] || ["search"];
    }

    function applyAdminRoleDefaults() {
      const role = document.getElementById("adminUserRole")?.value || "Read Only";
      renderAdminResponsibilityChecklist(adminRoleDefaultResponsibilities(role));
      if (/admin|contract/i.test(role)) {
        setAdminScopePreset("All");
        renderAdminFacilityChecklist(["All"]);
      }
    }

    function resetAdminUserForm() {
      document.getElementById("adminUserEmail").value = "";
      document.getElementById("adminUserFullName").value = "";
      document.getElementById("adminUserRole").value = "Read Only";
      setAdminScopePreset("All");
      document.getElementById("adminUserStatus").value = "Active";
      document.getElementById("adminUserPassword").value = "";
      renderAdminFacilityChecklist(["All"]);
      renderAdminResponsibilityChecklist(adminRoleDefaultResponsibilities("Read Only"));
    }

    function adminResponsibilityLabels(values = []) {
      const labels = new Map(adminResponsibilityOptions.map(item => [item.key, item.label]));
      return (values || []).map(value => labels.get(value) || value).filter(Boolean);
    }

    function renderAdminSettings() {
      document.getElementById("adminShareSyncRoot").value = adminSettings.shareSyncRoot || "/Contracts/";
      document.getElementById("adminEmailSender").value = adminSettings.emailSender || "contracts@company.com";
      document.getElementById("adminAlertSchedule").value = adminSettings.alertSchedule || "90, 60, 30 days";
      document.getElementById("adminNetworkAccess").value = adminSettings.networkAccess || "Company network/VPN only";
      document.getElementById("adminPublicAccess").value = adminSettings.publicInternetAccess || "Blocked";
      document.getElementById("adminCategories").value = (adminSettings.categories || categories).join("\n");
      document.getElementById("adminRolesJson").value = JSON.stringify(adminSettings.roles || [], null, 2);
      const adminFacilityProfiles = adminSettings.facilityProfiles || [];
      const adminVisibleFacilities = adminFacilityProfiles.slice(0, 60);
      document.getElementById("adminFacilityRows").innerHTML = adminVisibleFacilities.map(profile => `
        <tr>
          <td><strong>${escapeHtml(profile.name)}</strong><br><span style="color:var(--muted);font-size:12px">${escapeHtml(profile.address || "")}</span></td>
          <td>${escapeHtml(profile.region || "")}</td>
          <td>${escapeHtml(profile.beds || "")}</td>
          <td>${escapeHtml([profile.latitude, profile.longitude].filter(Boolean).join(", ") || "Not saved")}${profile.aliases?.length ? `<br><span style="color:var(--muted);font-size:12px">Aliases: ${escapeHtml(Array.isArray(profile.aliases) ? profile.aliases.join("; ") : profile.aliases)}</span>` : ""}</td>
        </tr>
      `).join("") + (adminFacilityProfiles.length > adminVisibleFacilities.length ? `<tr><td colspan="4"><span class="badge gray">Showing first ${adminVisibleFacilities.length} of ${adminFacilityProfiles.length}. Use Facilities page to search all.</span></td></tr>` : "") || `<tr><td colspan="4">No facility profiles saved yet.</td></tr>`;
      document.getElementById("adminRoleRows").innerHTML = (adminSettings.roles || []).map(role => `
        <tr><td>${escapeHtml(role.role)}</td><td>${escapeHtml(role.canView)}</td><td>${escapeHtml(role.canEdit)}</td><td>${escapeHtml(role.canApprove)}</td><td>${escapeHtml(role.admin)}</td></tr>
      `).join("") || `<tr><td colspan="5">No roles saved yet.</td></tr>`;
      const userRows = document.getElementById("adminUserRows");
      if (userRows) {
        userRows.innerHTML = appUsers.map(user => `
          <tr>
            <td><strong>${escapeHtml(user.fullName || user.username)}</strong><br><span style="color:var(--muted);font-size:12px">${escapeHtml(user.username)}</span></td>
            <td>${escapeHtml(user.role || "Read Only")}</td>
            <td>${escapeHtml(user.facility || "All")}</td>
            <td>${adminResponsibilityLabels(user.responsibilities || adminRoleDefaultResponsibilities(user.role)).slice(0, 4).map(label => `<span class="badge gray">${escapeHtml(label)}</span>`).join(" ") || `<span class="badge gray">Search</span>`}</td>
            <td><span class="badge ${user.status === "Active" ? "green" : "gray"}">${escapeHtml(user.status || "Active")}</span></td>
            <td><button class="btn" onclick="fillUserForm('${jsArg(user.username)}')">Edit</button> <button class="btn ghost" onclick="sendUserInvite('${jsArg(user.username)}')">Send Invite</button> <button class="btn danger" onclick="deleteAppUser('${jsArg(user.username)}')">Delete</button></td>
          </tr>
        `).join("") || `<tr><td colspan="6">No users yet. Add the first admin user.</td></tr>`;
      }
      renderAdminFacilityChecklist(splitAdminScope(document.getElementById("adminUserFacility")?.value || "All"));
      renderAdminResponsibilityChecklist(selectedAdminResponsibilities().length ? selectedAdminResponsibilities() : adminRoleDefaultResponsibilities(document.getElementById("adminUserRole")?.value || "Read Only"));
      renderAdminMonitor();
      refreshSmtpStatus();
    }

    async function refreshSmtpStatus() {
      const field = document.getElementById("adminSmtpStatus");
      if (!field || !backendOnline) return;
      try {
        const status = await apiJson("/api/email/status");
        field.value = status.configured
          ? `Connected: ${status.user || status.from} via ${status.host}:${status.port}`
          : `IT setup needed: ${status.missing.join(", ")}`;
      } catch {
        field.value = "Could not check email settings";
      }
    }

    async function sendSmtpTest() {
      const to = document.getElementById("adminSmtpTestTo")?.value.trim() || "";
      if (!to) {
        showToast("Enter the email address that should receive the test.");
        return;
      }
      try {
        await apiJson("/api/email/test", { method: "POST", body: JSON.stringify({ to }) });
        showToast("Test email sent. Check the inbox.");
        await refreshSmtpStatus();
      } catch (error) {
        showToast(error.message || "Could not send the test email.");
      }
    }

    function collectAdminSettings() {
      return {
        ...adminSettings,
        shareSyncRoot: document.getElementById("adminShareSyncRoot").value.trim() || "/Contracts/",
        emailSender: document.getElementById("adminEmailSender").value.trim() || "contracts@company.com",
        alertSchedule: document.getElementById("adminAlertSchedule").value.trim() || "90, 60, 30 days",
        networkAccess: document.getElementById("adminNetworkAccess").value,
        publicInternetAccess: document.getElementById("adminPublicAccess").value,
        categories: document.getElementById("adminCategories").value.split(/\r?\n/).map(item => item.trim()).filter(Boolean)
      };
    }

    async function saveAdminSettings(partial = null) {
      if (!requireBackend("Saving admin settings")) return;
      try {
        adminSettings = await apiJson("/api/admin-settings", {
          method: "POST",
          body: JSON.stringify(partial || collectAdminSettings())
        });
        renderAdminSettings();
        await loadBackendData();
        showToast("Admin settings saved.");
      } catch (error) {
        showToast("Could not save admin settings.");
      }
    }

    function addOrUpdateFacilityProfile() {
      const name = document.getElementById("adminFacilityName").value.trim();
      if (!name) {
        showToast("Facility name is required.");
        return;
      }
      const profile = {
        name,
        region: document.getElementById("adminFacilityRegion").value.trim(),
        beds: document.getElementById("adminFacilityBeds").value.trim(),
        address: document.getElementById("adminFacilityAddress").value.trim(),
        aliases: document.getElementById("adminFacilityAliases").value.split(/[;|,]/).map(item => item.trim()).filter(Boolean),
        latitude: document.getElementById("adminFacilityLatitude").value.trim(),
        longitude: document.getElementById("adminFacilityLongitude").value.trim()
      };
      const existing = (adminSettings.facilityProfiles || []).filter(item => item.name.toLowerCase() !== name.toLowerCase());
      const weatherCoordinates = { ...(adminSettings.weatherCoordinates || {}) };
      if (profile.latitude && profile.longitude) {
        weatherCoordinates[name] = { latitude: profile.latitude, longitude: profile.longitude };
        facilityCoordinates[name] = { latitude: profile.latitude, longitude: profile.longitude };
        saveFacilityCoordinates();
      }
      saveAdminSettings({ ...collectAdminSettings(), facilityProfiles: [...existing, profile], weatherCoordinates });
    }

    function parseSimpleCsvLine(line) {
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

    async function importFacilityMasterData() {
      const rows = document.getElementById("facilityBulkInput").value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const imported = rows.map(parseSimpleCsvLine).filter(cols => cols[0] && !/^facility\s*name/i.test(cols[0])).map(cols => ({
        name: cols[0],
        beds: cols[1] || "",
        region: cols[2] || "",
        address: cols[3] || "",
        aliases: String(cols[4] || "").split(/[;|]/).map(item => item.trim()).filter(Boolean)
      }));
      if (!imported.length) {
        showToast("Paste at least one facility row first.");
        return;
      }
      const existing = new Map((adminSettings.facilityProfiles || []).map(profile => [profile.name.toLowerCase(), profile]));
      imported.forEach(profile => existing.set(profile.name.toLowerCase(), { ...(existing.get(profile.name.toLowerCase()) || {}), ...profile }));
      await saveAdminSettings({ ...collectAdminSettings(), facilityProfiles: [...existing.values()] });
      showToast(`Imported ${imported.length} facility profile${imported.length === 1 ? "" : "s"}.`);
    }

    async function importVendorMasterData() {
      const rows = document.getElementById("vendorBulkInput").value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const imported = rows.map(parseSimpleCsvLine).filter(cols => cols[0] && !/^vendor\s*name/i.test(cols[0])).map(cols => ({
        name: cols[0],
        legalName: cols[0],
        primaryContact: cols[1] || "",
        phone: cols[2] || "",
        email: cols[3] || "",
        mailingAddress: cols[4] || "",
        aliases: String(cols[5] || "").split(/[;|]/).map(item => item.trim()).filter(Boolean),
        status: "Active"
      }));
      if (!imported.length) {
        showToast("Paste at least one vendor row first.");
        return;
      }
      for (const vendor of imported) {
        await apiJson("/api/vendor-profiles", {
          method: "POST",
          body: JSON.stringify(vendor)
        });
      }
      await loadBackendData();
      showToast(`Imported ${imported.length} vendor profile${imported.length === 1 ? "" : "s"}.`);
    }

    async function uploadMasterExcel(inputId, endpoint, label) {
      if (!requireBackend(`Uploading ${label} Excel`)) return;
      const file = document.getElementById(inputId)?.files?.[0];
      if (!file) {
        showToast(`Choose a ${label} Excel or CSV file first.`);
        return;
      }
      const form = new FormData();
      form.append("file", file);
      try {
        const response = await fetch(`${apiBase}${endpoint}`, { method: "POST", body: form });
        if (!response.ok) throw new Error(await response.text());
        const result = await response.json();
        await loadBackendData();
        showToast(`Imported ${result.imported || 0} ${label} record${Number(result.imported || 0) === 1 ? "" : "s"}.`);
      } catch (error) {
        showToast(`${label} Excel import failed. Check the column names and try again.`);
      }
    }

    function saveAdminRoles() {
      try {
        const roles = JSON.parse(document.getElementById("adminRolesJson").value || "[]");
        if (!Array.isArray(roles)) throw new Error("Roles must be an array");
        saveAdminSettings({ ...collectAdminSettings(), roles });
      } catch {
        showToast("Roles must be valid JSON.");
      }
    }

    function fillUserForm(username) {
      const user = appUsers.find(item => item.username === username);
      if (!user) return;
      document.getElementById("adminUserEmail").value = user.username || "";
      document.getElementById("adminUserFullName").value = user.fullName || "";
      document.getElementById("adminUserRole").value = user.role || "Read Only";
      document.getElementById("adminUserFacility").value = user.facility || "All";
      setAdminScopePreset(user.facility || "All");
      renderAdminFacilityChecklist(splitAdminScope(user.facility || "All"));
      renderAdminResponsibilityChecklist(user.responsibilities || adminRoleDefaultResponsibilities(user.role));
      document.getElementById("adminUserStatus").value = user.status || "Active";
      document.getElementById("adminUserPassword").value = "";
      showToast("User loaded. Add a new password only if you want to change it.");
    }

    function setAdminScopePreset(scope = "All") {
      const preset = document.getElementById("adminUserScopePreset");
      const customField = document.getElementById("adminUserScopeCustomField");
      const customInput = document.getElementById("adminUserFacility");
      if (!preset || !customField || !customInput) return;
      const normalized = String(scope || "All").trim() || "All";
      const presetValues = [...preset.options].map(option => option.value).filter(value => value !== "custom");
      if (presetValues.includes(normalized)) {
        preset.value = normalized;
        customInput.value = normalized;
        customField.style.display = "none";
      } else {
        preset.value = "custom";
        customInput.value = normalized;
        customField.style.display = "";
      }
    }

    async function uploadCensusExcel() {
      if (!requireBackend("Updating census")) return;
      const input = document.getElementById("censusExcelInput");
      const file = input?.files?.[0];
      if (!file) {
        showToast("Choose the weekly census Excel file first.");
        return;
      }
      const form = new FormData();
      form.append("file", file);
      try {
        const response = await fetch(`${apiBase}/api/upload-census`, { method: "POST", body: form });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Census update failed.");
        await loadBackendData();
        input.value = "";
        const unmatched = Number(result.unmatchedCount || 0);
        showToast(`Updated census for ${result.updated || 0} facilities${unmatched ? `; ${unmatched} name${unmatched === 1 ? "" : "s"} need matching` : ""}.`);
      } catch (error) {
        showToast(error.message || "Census update failed. Check the workbook and try again.");
      }
    }

    function syncAdminScopeFromPreset() {
      const preset = document.getElementById("adminUserScopePreset");
      const customField = document.getElementById("adminUserScopeCustomField");
      const customInput = document.getElementById("adminUserFacility");
      if (!preset || !customField || !customInput) return;
      if (preset.value === "custom") {
        customField.style.display = "";
        if (!customInput.value || customInput.value === "All") customInput.value = "";
        customInput.focus();
      } else {
        customInput.value = preset.value || "All";
        customField.style.display = "none";
      }
    }

    async function addOrUpdateUser() {
      if (!requireBackend("Saving users")) return;
      const payload = {
        username: document.getElementById("adminUserEmail").value.trim(),
        fullName: document.getElementById("adminUserFullName").value.trim(),
        role: document.getElementById("adminUserRole").value,
        facility: document.getElementById("adminUserFacility").value.trim() || "All",
        responsibilities: selectedAdminResponsibilities(),
        status: document.getElementById("adminUserStatus").value,
        password: document.getElementById("adminUserPassword").value
      };
      if (!payload.username) {
        showToast("User email is required.");
        return;
      }
      try {
        await apiJson("/api/users", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        document.getElementById("adminUserPassword").value = "";
        await loadBackendData();
        showToast("User access saved.");
      } catch (error) {
        showToast(error.message || "Could not save user.");
      }
    }

    async function deleteAppUser(username) {
      if (!confirm(`Delete access for ${username}?`)) return;
      try {
        await apiJson(`/api/users/${encodeURIComponent(username)}`, { method: "DELETE" });
        await loadBackendData();
        showToast("User access deleted.");
      } catch (error) {
        showToast(error.message || "Could not delete user.");
      }
    }

    async function sendUserInvite(username) {
      if (!requireBackend("Sending invite")) return;
      try {
        const result = await apiJson(`/api/users/${encodeURIComponent(username)}/invite`, { method: "POST" });
        if (result.inviteUrl && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(result.inviteUrl).catch(() => {});
        }
        if (result.email?.sent) {
          showToast("Invite email sent.");
        } else if (result.mailto) {
          window.location.href = result.mailto;
          showToast("Email server is not configured. Invite draft opened and link copied.");
        } else {
          showToast("Invite link created and copied.");
        }
        await loadBackendData();
      } catch (error) {
        showToast(error.message || "Could not create invite.");
      }
    }

    function vendorProfilePayloadFromModal(originalName = "") {
      const value = id => document.getElementById(id)?.value.trim() || "";
      const enteredName = value("vendorProfileName");
      const legalName = value("vendorProfileLegalName");
      const dba = value("vendorProfileDba");
      const fallbackName = originalName && originalName !== "New Vendor" ? originalName : "";
      return {
        name: enteredName || legalName || dba || fallbackName,
        legalName,
        dba,
        status: value("vendorProfileStatus") || "Active",
        category: value("vendorProfileCategory"),
        mailingAddress: value("vendorProfileMailingAddress"),
        remitAddress: value("vendorProfileRemitAddress"),
        primaryContact: value("vendorProfileContact"),
        phone: value("vendorProfilePhone"),
        email: value("vendorProfileEmail"),
        website: value("vendorProfileWebsite"),
        taxId: value("vendorProfileTaxId"),
        paymentTerms: value("vendorProfilePaymentTerms"),
        insuranceStatus: value("vendorProfileInsurance"),
        notes: value("vendorProfileNotes")
      };
    }

    function bestVendorMatch(name) {
      const needle = masterKey(name);
      if (!needle) return null;
      const namesFor = vendor => [vendor.name, vendor.legalName, vendor.dba, ...(Array.isArray(vendor.aliases) ? vendor.aliases : String(vendor.aliases || "").split(/[;|,]/))];
      return vendorsData.find(v => namesFor(v).some(alias => masterKey(alias) === needle))
        || vendorsData.find(v => namesFor(v).some(alias => masterKey(alias).startsWith(needle)))
        || vendorsData.find(v => namesFor(v).some(alias => masterKey(alias).includes(needle)));
    }

    function fillVendorProfileFromMatch(match) {
      if (!match) return;
      const setIfEmpty = (id, value) => {
        const input = document.getElementById(id);
        if (input && !input.value && value) input.value = value;
      };
      setIfEmpty("vendorProfileLegalName", match.legalName || match.name);
      setIfEmpty("vendorProfileDba", match.dba || "");
      setIfEmpty("vendorProfileCategory", match.category || "");
      setIfEmpty("vendorProfileMailingAddress", match.mailingAddress === "Needs Vendor Address" ? "" : match.mailingAddress || "");
      setIfEmpty("vendorProfileRemitAddress", match.remitAddress || "");
      setIfEmpty("vendorProfileContact", match.primaryContact || "");
      setIfEmpty("vendorProfilePhone", match.phone || "");
      setIfEmpty("vendorProfileEmail", match.email || "");
      setIfEmpty("vendorProfileWebsite", match.website || "");
      setIfEmpty("vendorProfileTaxId", match.taxId || "");
      setIfEmpty("vendorProfilePaymentTerms", match.paymentTerms || "");
      setIfEmpty("vendorProfileInsurance", match.insuranceStatus || match.insurance || "");
      setIfEmpty("vendorProfileNotes", match.notes || "");
      const status = document.getElementById("vendorProfileStatus");
      if (status && match.status) status.value = match.status;
    }

    function handleVendorNameInput() {
      const input = document.getElementById("vendorProfileName");
      const match = bestVendorMatch(input?.value);
      const helper = document.getElementById("vendorAutofillHelper");
      if (helper) {
        helper.textContent = match
          ? `Matched ${match.name}. Known details can be filled from saved contracts and vendor records.`
          : "Type the vendor name. If it already exists, the card fills in. If it is new, save it and it will be added to vendor dropdowns.";
      }
      fillVendorProfileFromMatch(match);
    }

    async function saveVendorProfile(originalName = "") {
      const payload = vendorProfilePayloadFromModal(originalName);
      if (!payload.name) {
        showToast("Vendor name is required.");
        return;
      }
      try {
        const profile = await apiJson("/api/vendor-profiles", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        replaceArray(vendorsData, dedupeRecords([...vendorsData, profile], "name"));
        await loadBackendData();
        const vendorSearch = document.getElementById("vendorSearch");
        if (vendorSearch) vendorSearch.value = "";
        initFilters();
        if (activeSectionId() === "vendors") renderVendors();
        closeModal();
        showToast("Vendor saved and connected.");
      } catch (error) {
        showToast(error.message || "Could not save vendor profile.");
      }
    }

    async function deleteVendorProfile(name) {
      const vendor = vendorsData.find(item => item.name === name) || { name };
      const linkedContracts = contracts.filter(contract => sameVendorName(contract.vendor, name)).length;
      const message = linkedContracts
        ? `Delete only the vendor profile for ${name}? The ${linkedContracts} linked contract${linkedContracts === 1 ? "" : "s"} will stay saved and may still show this vendor from contract data.`
        : `Delete the saved vendor profile for ${name}?`;
      if (!confirm(message)) return;
      try {
        await apiJson(`/api/vendor-profiles/${encodeURIComponent(vendor.id || name)}`, { method: "DELETE" });
        vendorsData.splice(0, vendorsData.length, ...vendorsData.filter(item => item.name !== name));
        utilityAccounts = utilityAccounts.filter(account => !sameVendorName(account.vendor, name));
        closeModal();
        await loadBackendData();
        renderVendors();
        showToast("Vendor profile deleted. Contracts were kept.");
      } catch (error) {
        showToast("Could not delete this vendor profile. If it comes from a contract, edit or delete the linked contract instead.");
      }
    }

    async function deleteUtilityAccount(id, label = "this account") {
      if (!id) {
        showToast("This account came from a contract. Delete or edit the contract record to remove it.");
        return;
      }
      if (!confirm(`Delete ${label}? This removes the saved account ID, not the contract.`)) return;
      try {
        await apiJson(`/api/utility-accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
        utilityAccounts = utilityAccounts.filter(account => account.id !== id);
        await loadBackendData();
        renderUtilityAccounts();
        renderVendors();
        showToast("Account deleted.");
      } catch (error) {
        showToast("Could not delete this account.");
      }
    }

    function downloadUtilityAccountTemplate() {
      const rows = [
        ["Facility","Vendor","Utility Type","Account Number","Meter Number","Service Address","Vendor Mailing Address","Vendor Phone","Vendor Email","Aliases","Status"]
      ];
      const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "facility-utility-accounts-template.csv";
      link.click();
      URL.revokeObjectURL(link.href);
    }

    async function uploadUtilityAccounts() {
      if (!requireBackend("Importing account CSV")) return;
      const file = document.getElementById("utilityAccountFile").files?.[0];
      if (!file) {
        showToast("Choose a facility/account CSV first.");
        return;
      }
      try {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch(`${apiBase}/api/upload-utility-accounts`, {
          method: "POST",
          body: form
        });
        if (!response.ok) throw new Error(await response.text());
        const result = await response.json();
        await loadBackendData();
        showToast(`Imported ${result.imported} utility account${result.imported === 1 ? "" : "s"}.`);
      } catch (error) {
        showToast("Could not import the account CSV. Check the column names and try again.");
      }
    }

    function canonicalUploadFacility(value = "") {
      const clean = cleanMasterName(value);
      const target = masterKey(clean);
      if (!target) return clean;
      const profiles = adminSettings.facilityProfiles || [];
      const primary = profiles.find(profile => masterKey(profile.name) === target);
      if (primary) return cleanMasterName(primary.name);
      let best = null;
      let tied = false;
      profiles.forEach(profile => {
        const values = [profile.dba, profile.legalName, profile.commonName, profile.shortName, ...(Array.isArray(profile.aliases) ? profile.aliases : [])];
        let score = 0;
        values.forEach(alias => {
          const key = masterKey(alias);
          if (!key || key.length < 5) return;
          if (key === target) score = Math.max(score, 2000 + key.length);
          else if (key.includes(target) || target.includes(key)) score = Math.max(score, 1000 + Math.min(key.length, target.length));
        });
        if (!score) return;
        if (!best || score > best.score) {
          best = { profile, score };
          tied = false;
        } else if (score === best.score && masterKey(profile.name) !== masterKey(best.profile.name)) {
          tied = true;
        }
      });
      return !tied && best?.profile?.name ? cleanMasterName(best.profile.name) : clean;
    }

    function selectedUploadHints(name = "") {
      const shareSyncUrl = document.getElementById("shareSyncUrl").value.trim();
      const localFilePath = document.getElementById("localFilePath").value.trim();
      return {
        shareSyncUrl,
        localFilePath,
        name: name || shareSyncUrl.split("/").filter(Boolean).pop() || "New Contract Intake",
        facility: canonicalUploadFacility(document.getElementById("hintFacility").value.trim()),
        vendor: document.getElementById("hintVendor").value.trim(),
        category: document.getElementById("hintCategory").value,
        documentType: document.getElementById("hintDocumentType")?.value || "",
        owner: document.getElementById("hintOwner").value.trim() || "Contract Dept"
      };
    }

    function uploadFolderSegment(value = "", fallback = "Needs Classification") {
      const cleaned = String(value || "").trim()
        .replace(/[<>:"/\\|?*\x00-\x1F]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return cleaned || fallback;
    }

    function updateUploadShareSyncDestination() {
      const target = document.getElementById("shareSyncTargetPreview");
      if (!target) return;
      const payload = selectedUploadHints();
      const root = String(adminSettings.shareSyncRoot || "").trim();
      const shareSyncRoot = root && root !== "/Contracts/"
        ? root
        : "C:\\Users\\akoslowsky\\My ShareSync\\Signed Contracts";
      const facility = uploadFolderSegment(payload.facility, "");
      const category = uploadFolderSegment(payload.category, "Needs Classification");
      const vendor = uploadFolderSegment(payload.vendor, "Needs Classification");
      if (!facility) {
        target.innerHTML = `
          <div><strong>Filing destination</strong><span>Pick a facility now, or the contract will stay in review until the facility is confirmed.</span></div>
          <span class="badge amber">Needs facility</span>
        `;
        return;
      }
      const displayPath = `${shareSyncRoot}\\${facility}\\${category}\\${vendor}`;
      target.innerHTML = `
        <div><strong>Filing destination</strong><span>${escapeHtml(displayPath)}</span></div>
        <span class="badge green">ShareSync</span>
      `;
    }

    function bulkBadgeClass(status) {
      if (status === "Done") return "green";
      if (status === "Failed") return "red";
      if (status === "Duplicate") return "blue";
      if (status === "Uploading" || status === "Reading") return "amber";
      return "gray";
    }

    function renderBulkUploadActivity() {
      const list = document.getElementById("bulkUploadList");
      const count = document.getElementById("bulkUploadCount");
      if (!list || !count) return;
      const done = bulkUploadItems.filter(item => item.status === "Done" || item.status === "Duplicate").length;
      const failed = bulkUploadItems.filter(item => item.status === "Failed").length;
      count.textContent = bulkUploadItems.length ? `${done}/${bulkUploadItems.length} done${failed ? `, ${failed} failed` : ""}` : "No batch";
      count.className = `badge ${failed ? "red" : done && done === bulkUploadItems.length ? "green" : bulkUploadItems.length ? "amber" : "gray"}`;
      const visibleItems = bulkUploadItems.slice(0, 150);
      const hiddenCount = Math.max(0, bulkUploadItems.length - visibleItems.length);
      list.innerHTML = visibleItems.map(item => `
        <div class="bulk-upload-row">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.detail || "Waiting to upload")}</span>
            ${item.shareSyncPath ? `<span style="display:block;color:var(--muted);font-size:12px">ShareSync: ${escapeHtml(item.shareSyncPath)}</span>` : ""}
            ${item.contractId ? `<span style="display:block;color:var(--muted);font-size:12px">Contract: ${escapeHtml(item.contractId)}${item.ocrJobId ? ` | OCR: ${escapeHtml(item.ocrJobId)}` : ""}</span>` : ""}
          </div>
          <div class="table-actions">
            ${item.pdfUrl ? `<a class="btn ghost" href="${escapeHtml(item.pdfUrl)}" target="_blank" rel="noopener">Open PDF</a>` : ""}
            <span class="badge ${bulkBadgeClass(item.status)}">${escapeHtml(item.status)}</span>
          </div>
        </div>
      `).join("") + (hiddenCount ? `
        <div class="bulk-upload-row">
          <div><strong>${hiddenCount} more files in this batch</strong><span>They are still being uploaded and read one at a time to protect the system.</span></div>
          <span class="badge amber">Queued</span>
        </div>
      ` : "") || `<div class="metric-row"><div><strong>No files in this batch yet.</strong><span>Drop PDF or Word contracts above and each file will show here while it uploads and reads.</span></div><span class="badge gray">Ready</span></div>`;
    }

    const maxBrowserUploadBytes = 50 * 1024 * 1024;
    const allowedContractUploadExts = new Set(["pdf", "docx", "png", "jpg", "jpeg", "tif", "tiff", "txt", "text", "md", "eml"]);
    const allowedInvoiceUploadExts = new Set(["pdf", "png", "jpg", "jpeg", "tif", "tiff", "txt", "text", "md", "csv", "xlsx"]);

    function fileExtension(file) {
      return String(file?.name || "").split(".").pop().toLowerCase();
    }

    function validateUploadFile(file, allowedExts = allowedContractUploadExts) {
      if (!file?.name) return "Choose a file first.";
      if (file.size > maxBrowserUploadBytes) return `${file.name} is too large. The starter server limit is 50MB per file.`;
      if (fileExtension(file) === "doc") return `${file.name} is an old Word .doc file. Open it in Microsoft Word, save as .docx or PDF, then upload again.`;
      if (!allowedExts.has(fileExtension(file))) return `${file.name} is not a supported file type.`;
      return "";
    }

    function emailContractFileName(text = "") {
      const subject = String(text.match(/^subject:\s*(.+)$/im)?.[1] || "Email Contract").trim();
      return `${subject.replace(/[^a-z0-9-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "Email-Contract"}.eml`;
    }

    async function uploadEmailContractText() {
      if (!requireBackend("Email contract intake")) return;
      const input = document.getElementById("emailContractText");
      const text = String(input?.value || "").trim();
      if (!text) {
        showToast("Paste the email text first.");
        return;
      }
      const file = new File([text], emailContractFileName(text), { type: "message/rfc822" });
      await uploadContractFiles([file]);
      if (input) input.value = "";
    }

    async function responseErrorMessage(response, fallback = "Request failed.") {
      const text = await response.text().catch(() => "");
      if (!text) return fallback;
      try {
        const parsed = JSON.parse(text);
        return parsed.error || fallback;
      } catch {
        return text.slice(0, 220) || fallback;
      }
    }

    async function uploadContractFile(file, index = 1, total = 1, options = {}) {
      const status = document.getElementById("bulkUploadStatus");
      const payload = selectedUploadHints(file.name);
      const item = bulkUploadItems[index - 1];
      const deferRefresh = Boolean(options.deferRefresh);
      const validationError = validateUploadFile(file);
      if (validationError) {
        if (item) {
          item.status = "Failed";
          item.detail = validationError;
          renderBulkUploadActivity();
        }
        throw new Error(validationError);
      }
      if (item) {
        item.status = "Uploading";
        item.detail = `Uploading ${index} of ${total}`;
        renderBulkUploadActivity();
      }
      if (status) status.textContent = `Uploading ${index} of ${total}: ${file.name}`;
      const form = new FormData();
      form.append("file", file);
      form.append("name", payload.name);
      form.append("facility", payload.facility);
      form.append("vendor", payload.vendor);
      form.append("category", payload.category);
      form.append("documentType", payload.documentType);
      form.append("owner", payload.owner);
      const response = await fetch(`${apiBase}/api/upload-contract`, {
        method: "POST",
        body: form
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response, "Upload failed."));
      const result = await response.json();
      if (result.duplicate || result.skipped) {
        if (item) {
          item.status = "Duplicate";
          item.contractId = result.existingContract?.id || "";
          item.detail = `Duplicate found: ${result.existingContract?.name || "existing contract"}. It was not uploaded again.`;
          renderBulkUploadActivity();
        }
        if (status) status.textContent = `Duplicate found: ${file.name}. Existing contract was kept.`;
        showToast(`Duplicate found. Existing contract kept: ${result.existingContract?.name || result.existingContract?.id || file.name}`);
        return result;
      }
      if (result.contract) {
        result.contract = await applyPendingBuilderTermsToUploadedContract(result.contract);
      }
      if (item) {
        item.contractId = result.contract?.id || "";
        item.ocrJobId = result.ocrJob?.id || "";
        item.shareSyncPath = result.contract?.shareSyncLocalPath || result.contract?.shareSyncFolderPath || "";
        item.pdfUrl = contractFileUrl(result.contract) || "";
        item.detail = item.shareSyncPath
          ? "Saved to ShareSync and added to Review Queue"
          : result.contract?.id ? `Separate contract created: ${result.contract.id}` : "Separate contract created";
        renderBulkUploadActivity();
      }
      if (!deferRefresh) {
        upsertLiveContract(result.contract);
        ocrJobs = [result.ocrJob, ...ocrJobs].filter(Boolean);
        switchSection("review");
        renderActiveSectionOnly("review");
        showToast("Contract added to Review Queue.");
      }
      if (result.ocrJob?.id) {
        if (item) {
          item.status = "Reading";
          item.detail = "Reading the contract text and extracting fields";
          renderBulkUploadActivity();
        }
        if (status) status.textContent = `Reading ${index} of ${total}: ${file.name}`;
        enqueueBackgroundOcr(result.ocrJob.id, {
          fileName: file.name,
          item,
          quiet: total > 1 || deferRefresh
        });
      }
      if (item) {
        item.status = result.ocrJob?.id ? "Queued" : "Done";
        item.shareSyncPath = result.contract?.shareSyncLocalPath || result.contract?.shareSyncFolderPath || item.shareSyncPath || "";
        item.pdfUrl = contractFileUrl(result.contract) || item.pdfUrl || "";
        item.detail = result.ocrJob?.id
          ? "Saved. Waiting for background OCR."
          : item.shareSyncPath
            ? "Saved to ShareSync. Review fields next."
            : `Saved as separate contract ${result.contract?.id || "record"}`;
        renderBulkUploadActivity();
      }
      return result;
    }

    async function uploadContractFiles(files) {
      if (!requireBackend("Contract upload and OCR")) return;
      const selected = [...(files || [])].filter(file => file?.name);
      if (!selected.length) {
        showToast("Choose or drop at least one contract file.");
        return;
      }
      const status = document.getElementById("bulkUploadStatus");
      const largeBatch = selected.length > 25;
      bulkUploadItems = selected.map((file, index) => ({ name: file.name, status: "Waiting", detail: `Waiting to create separate contract ${index + 1} of ${selected.length}` }));
      renderBulkUploadActivity();
      switchSection("upload");
      if (status && largeBatch) status.textContent = `Large batch mode: ${selected.length} files will upload and OCR one at a time. You can leave this screen open.`;
      if (largeBatch) showToast(`Large batch mode on: ${selected.length} files will process one at a time so the app does not get overloaded.`);
      let completed = 0;
      for (const file of selected) {
        completed += 1;
        try {
          await uploadContractFile(file, completed, selected.length, { deferRefresh: largeBatch });
        } catch (error) {
          const item = bulkUploadItems[completed - 1];
          if (item) {
            item.status = "Failed";
            item.detail = error.message || "This file could not be uploaded or read";
            renderBulkUploadActivity();
          }
        }
      }
      await loadBackendData();
      switchSection("review");
      if (status) status.textContent = `Finished ${selected.length} file${selected.length === 1 ? "" : "s"}.`;
      const failed = bulkUploadItems.filter(item => item.status === "Failed").length;
      showToast(failed ? `Finished with ${failed} file${failed === 1 ? "" : "s"} needing attention. Saved uploads remain as separate Review Queue contracts.` : `Uploaded ${selected.length} separate contract${selected.length === 1 ? "" : "s"} to Review Queue.`);
    }

    async function createShareSyncIntake() {
      if (!requireBackend("Contract intake")) return;
      const files = [...(document.getElementById("fileInput").files || [])];
      if (files.length) {
        try {
          await uploadContractFiles(files);
        } catch (error) {
          showToast("One of the files could not upload. Check the file type and try again.");
        }
        return;
      }
      const payload = selectedUploadHints();
      if (!payload.shareSyncUrl && !payload.localFilePath) {
        showToast("Choose a file, paste a ShareSync link, or enter a local OCR path first.");
        return;
      }
      try {
        const result = await apiJson("/api/sharesync-intake", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        if (result.duplicate || result.skipped) {
          showToast(`Duplicate found. Existing contract kept: ${result.existingContract?.name || result.existingContract?.id || "existing contract"}`);
          if (result.existingContract?.id) openContract(result.existingContract.id);
          return;
        }
        upsertLiveContract(result.contract);
        ocrJobs = [result.ocrJob, ...ocrJobs].filter(Boolean);
        switchSection("review");
        renderActiveSectionOnly("review");
        const hasReadableFile = Boolean(result.ocrJob?.localFilePath || result.contract?.localFilePath);
        showToast(hasReadableFile ? "Contract added to Review Queue. OCR is running now..." : "ShareSync link saved. OCR needs the synced file or a direct download link.");
        if (result.ocrJob?.id && hasReadableFile) {
          enqueueBackgroundOcr(result.ocrJob.id, {
            fileName: result.contract?.name || "ShareSync contract",
            quiet: false
          });
        } else if (result.ocrJob?.id && !hasReadableFile) {
          await loadBackendData();
          renderActiveSectionOnly("review");
          scheduleIdleTask(() => renderDashboard(), 400);
        } else {
          await loadBackendData();
          renderActiveSectionOnly("review");
          scheduleIdleTask(() => renderDashboard(), 400);
          showToast("Contract saved to Review Queue.");
        }
      } catch (error) {
        showToast(error.message || "Could not create the Review Queue item. Check the server and try again.");
      }
    }

    async function importShareSyncFolder() {
      if (!requireBackend("ShareSync folder import")) return;
      const status = document.getElementById("bulkUploadStatus");
      if (status) status.textContent = "Scanning ShareSync folder. This may take a moment...";
      try {
        const result = await apiJson("/api/sharesync-scan", {
          method: "POST",
          body: JSON.stringify({ limit: 100 })
        });
        await loadBackendData();
        switchSection("review");
        renderActiveSectionOnly("review");
        scheduleIdleTask(() => renderDashboard(), 400);
        const imported = result.imported?.length || 0;
        const skipped = result.skipped?.length || 0;
        if (status) status.textContent = `ShareSync scan complete: ${imported} imported, ${skipped} skipped.`;
        showToast(`ShareSync import complete: ${imported} added to Review Queue, ${skipped} skipped as duplicates.`);
      } catch (error) {
        if (status) status.textContent = "ShareSync import failed. Check Admin ShareSync root folder.";
        showToast(error.message || "ShareSync import failed.");
      }
    }

    async function enqueueBackgroundOcr(jobId, options = {}) {
      if (!jobId || backgroundOcrQueuedIds.has(jobId)) return;
      backgroundOcrQueuedIds.add(jobId);
      try {
        const queued = await apiJson(`/api/ocr-jobs/${encodeURIComponent(jobId)}/queue`, { method: "POST" });
        const index = ocrJobs.findIndex(job => job.id === jobId);
        if (index >= 0) ocrJobs.splice(index, 1, { ...ocrJobs[index], ...queued });
        if (options.item) {
          options.item.status = "Queued";
          options.item.detail = "Saved. Server OCR is running in the background.";
          renderBulkUploadActivity();
        }
      } catch (error) {
        if (options.item) {
          options.item.status = "Queued";
          options.item.detail = "Saved. OCR needs attention.";
          renderBulkUploadActivity();
        }
        if (!options.quiet) showToast(error.message || "Contract saved, but OCR could not be queued.");
      } finally {
        backgroundOcrQueuedIds.delete(jobId);
      }
    }

    async function runOcrJob(jobId, options = {}) {
      if (!requireBackend("Reading contract files")) return;
      let progressTimer = null;
      const startProgressPolling = () => {
        progressTimer = setInterval(async () => {
          try {
            const jobs = await apiJson("/api/ocr-jobs?page=1&pageSize=100&lean=1");
            ocrJobs = Array.isArray(jobs) ? jobs : (jobs.records || []);
            const current = ocrJobs.find(item => item.id === jobId);
            if (current?.progress?.message) reviewSaveStatus = current.progress.message;
            renderReview();
            renderOcrQueue();
          } catch {
            // Keep the running OCR request alive even if one progress poll misses.
          }
        }, 2000);
      };
      try {
        if (options.auto && !options.background) {
          reviewSaveStatus = "OCR is running automatically after upload...";
          renderReview();
        }
        if (options.poll !== false) startProgressPolling();
        const job = await apiJson(`/api/ocr-jobs/${encodeURIComponent(jobId)}/run`, { method: "POST" });
        if (progressTimer) clearInterval(progressTimer);
        ocrJobs = ocrJobs.map(item => item.id === job.id ? job : item);
        reviewFields = job.extractedFields || [];
        reviewFeeLines = job.extractedFeeLines || [];
        activeReviewContractId = job.contractId || "";
        activeReviewJobId = job.id || "";
        const relatedContract = contractData.find(contract => contract.id === activeReviewContractId) || contracts.find(contract => contract.id === activeReviewContractId);
        if (relatedContract) {
          relatedContract.ocrText = job.extractedText || relatedContract.ocrText || "";
          relatedContract.ocrTextPreview = job.extractedTextPreview || relatedContract.ocrTextPreview || "";
          relatedContract.extractedFields = job.extractedFields || relatedContract.extractedFields || [];
          relatedContract.extractedFeeLines = job.extractedFeeLines || relatedContract.extractedFeeLines || [];
        }
        activeReviewContractName = relatedContract?.name || job.contractId || "Selected contract";
        activeReviewStatus = relatedContract?.status || "Needs Review";
        reviewSaveStatus = "OCR complete. Review required fields.";
        if (!options.background || ["review", "review-detail"].includes(activeSectionId())) renderReview();
        if (!options.background || activeSectionId() === "ocrqueue") renderOcrQueue();
        if (!options.background) await loadBackendData();
        if (!options.quiet) showToast(job.status === "Complete" ? "OCR complete. Review the fields now." : `OCR status: ${job.status}`);
      } catch (error) {
        if (progressTimer) clearInterval(progressTimer);
        if (!options.background) await loadBackendData();
        const message = String(error?.message || "").trim();
        if (!options.quiet) showToast(message || "OCR could not read this file. Upload the PDF/Word again or check the source file path.");
        if (options.background) throw error;
      }
    }

    async function openReviewContractRecord(contractId, options = {}) {
      const job = ocrJobs.find(item => item.contractId === contractId);
      if (!options.skipJobRedirect && job?.id) {
        openReviewJob(job.id);
        document.getElementById("contractModal")?.classList.remove("open");
        return;
      }
      let contract = contractData.find(item => item.id === contractId) || contracts.find(item => item.id === contractId);
      try {
        contract = await ensureFullContractRecord(contractId) || contract;
      } catch {
        showToast("Full contract fields did not load yet. Showing the saved queue fields.");
      }
      if (!contract) {
        showToast("Contract record was not found.");
        return;
      }
      reviewFields = contract.extractedFields || [];
      reviewFeeLines = contract.extractedFeeLines || [];
      activeReviewContractId = contract.id || "";
      activeReviewJobId = "";
      activeReviewContractName = contract.name || "Selected contract";
      activeReviewStatus = contract.status || contract.reviewStatus || "Needs Review";
      reviewApprovalJustification = contract.approvalJustification || "";
      reviewSaveStatus = activeReviewStatus === "Approved"
        ? "This contract is approved, saved, and already taught to the system."
        : "Review required fields, then submit.";
      setActiveWorkContext({ itemId: contract.id || "", itemName: contract.name || "Selected contract", action: "Reviewing contract", immediate: true });
      document.getElementById("contractModal")?.classList.remove("open");
      switchSection("review-detail");
      renderReview();
    }

    async function openReviewJob(jobId) {
      const summaryContract = (reviewSummaryData?.records || []).find(contract =>
        contract.ocrJobId === jobId || `JOB-${contract.id}` === jobId
      );
      const job = ocrJobs.find(item => item.id === jobId)
        || reviewQueueItems().find(item => item.id === jobId)
        || (summaryContract ? {
          id: jobId,
          contractId: summaryContract.id,
          status: (summaryContract.extractedFields || []).length ? "Complete" : "Needs Review",
          reviewStatus: summaryContract.reviewStatus || summaryContract.status || "Needs Review",
          extractedFields: summaryContract.extractedFields || [],
          extractedFeeLines: summaryContract.extractedFeeLines || []
        } : null);
      if (!job) {
        switchSection("review");
        return;
      }
      if (job.status === "Complete" && !(job.extractedFields || []).length && job.contractId) {
        await openReviewContractRecord(job.contractId, { skipJobRedirect: true });
        return;
      }
      if (job.status !== "Complete" || !(job.extractedFields || []).length) {
        if (job.contractId) {
          await openReviewContractRecord(job.contractId, { skipJobRedirect: true });
          return;
        }
        runOcrJob(jobId);
        return;
      }
      reviewFields = job.extractedFields || [];
      reviewFeeLines = job.extractedFeeLines || [];
      activeReviewContractId = job.contractId || "";
      activeReviewJobId = job.id || "";
      activeReviewOcrText = job.extractedText || job.extractedTextPreview || "";
      let relatedContract = contractData.find(contract => contract.id === activeReviewContractId)
        || contracts.find(contract => contract.id === activeReviewContractId);
      if (activeReviewContractId) {
        try {
          const reviewPayload = await apiJson(`/api/review/${encodeURIComponent(activeReviewContractId)}`);
          if (Array.isArray(reviewPayload.extractedFields) && reviewPayload.extractedFields.length) reviewFields = reviewPayload.extractedFields;
          if (Array.isArray(reviewPayload.feeLines)) reviewFeeLines = reviewPayload.feeLines;
          const fullContract = normalizeContract(reviewPayload.contract || await ensureFullContractRecord(activeReviewContractId));
          const fullJob = (reviewPayload.ocrJobs || []).find(item => item.id === job.id || item.contractId === activeReviewContractId) || null;
          if (fullJob) {
            const jobIndex = ocrJobs.findIndex(item => item.id === fullJob.id);
            const mergedJob = { ...(jobIndex >= 0 ? ocrJobs[jobIndex] : {}), ...fullJob };
            if (jobIndex >= 0) ocrJobs.splice(jobIndex, 1, mergedJob);
            else ocrJobs.unshift(mergedJob);
            activeReviewOcrText = fullJob.extractedText || fullJob.extractedTextPreview || activeReviewOcrText;
          }
          if (fullContract?.id) {
            activeReviewOcrText = fullContract.ocrText || fullContract.fullText || fullContract.sourceText || activeReviewOcrText;
            const mergeContract = {
              ...fullContract,
              ocrText: activeReviewOcrText || fullContract.ocrText || fullJob?.extractedText || fullContract.ocrTextPreview || fullJob?.extractedTextPreview || "",
              localFilePath: fullContract.localFilePath || fullJob?.localFilePath || fullJob?.shareSyncLocalPath || "",
              shareSyncLocalPath: fullContract.shareSyncLocalPath || fullJob?.shareSyncLocalPath || fullJob?.localFilePath || "",
              uploadedFileName: fullContract.uploadedFileName || fullJob?.uploadedFileName || fullJob?.fileName || fullJob?.name || "",
              shareSyncUrl: fullContract.shareSyncUrl || fullJob?.shareSyncUrl || ""
            };
            [contracts, contractData].forEach(list => {
              const index = list.findIndex(item => item.id === mergeContract.id);
              if (index >= 0) list.splice(index, 1, mergeContract);
              else list.unshift(mergeContract);
            });
            relatedContract = mergeContract;
          }
        } catch {
          showToast("Opened the review item. Full OCR text is still loading.");
        }
      }
      if (relatedContract) {
        relatedContract.ocrText = job.extractedText || relatedContract.ocrText || "";
        relatedContract.ocrTextPreview = job.extractedTextPreview || relatedContract.ocrTextPreview || "";
        relatedContract.extractedFields = job.extractedFields || relatedContract.extractedFields || [];
        relatedContract.extractedFeeLines = job.extractedFeeLines || relatedContract.extractedFeeLines || [];
        relatedContract.localFilePath = relatedContract.localFilePath || job.localFilePath || job.shareSyncLocalPath || "";
        relatedContract.shareSyncLocalPath = relatedContract.shareSyncLocalPath || job.shareSyncLocalPath || job.localFilePath || "";
        relatedContract.uploadedFileName = relatedContract.uploadedFileName || job.uploadedFileName || job.fileName || job.name || "";
      }
      activeReviewContractName = relatedContract?.name || job.name || job.fileName || job.contractId || "Selected contract";
      activeReviewStatus = relatedContract?.status || job.status || "Needs Review";
      reviewApprovalJustification = relatedContract?.approvalJustification || "";
      reviewSaveStatus = relatedContract?.status === "Approved"
        ? "This contract is approved, saved, and already taught to the system."
        : "Review required fields, then submit.";
      setActiveWorkContext({ itemId: activeReviewContractId || job.id || "", itemName: activeReviewContractName, action: "Reviewing OCR fields", immediate: true });
      const searchInput = document.getElementById("reviewOcrSearchInput");
      const searchResults = document.getElementById("reviewOcrSearchResults");
      if (searchInput) searchInput.value = "";
      if (searchResults) searchResults.innerHTML = "";
      switchSection("review-detail");
      renderReview();
      showToast("Contract selected. Review and save fields.");
    }

    function currentReviewFieldsFromInputs() {
      const seen = new Set();
      const fields = [...document.querySelectorAll("[data-extracted-index]")].map(input => {
        const index = Number(input.dataset.extractedIndex);
        if (seen.has(index)) return null;
        seen.add(index);
        const source = reviewFields[index] || extracted[index] || {};
        const value = reviewFieldInputValue(index) || input.value.trim();
        return withReviewerVerification({
          ...source,
          value,
          approved: true
        });
      }).filter(field => field?.label && field.value);
      const calc = calculateReviewAnnualSpend(fields);
      const hasAnnualSpend = fields.some(field => reviewCanonicalLabel(field.label) === "annual spend" && !reviewValueIsEmpty(field.value));
      if (calc.annual && !hasAnnualSpend) {
        fields.push({
          label: "Annual Spend",
          value: reportMoney(calc.annual),
          confidence: 100,
          source: calc.source,
          approved: true
        });
      }
      return fields;
    }

    function currentReviewBusinessStatus() {
      const status = document.getElementById("reviewBusinessStatus")?.value || "Active";
      const replacementContractId = document.getElementById("reviewReplacementContract")?.value || "";
      const replacementContract = contractData.find(contract => contract.id === replacementContractId)
        || contracts.find(contract => contract.id === replacementContractId);
      return {
        status,
        replacementContractId,
        replacementContractName: replacementContract?.name || ""
      };
    }

    function toggleReplacementStatus() {
      const status = document.getElementById("reviewBusinessStatus")?.value || "";
      const box = document.getElementById("reviewReplacementBox");
      if (box) box.style.display = status === "Replaced" ? "" : "none";
    }

    function reviewStatusCardHtml(selected) {
      const currentStatus = selected?.status && !["Approved", "OCR Complete", "Pending OCR", "Needs Review"].includes(selected.status)
        ? selected.status
        : selected?.contractStatus || "Active";
      const replacementOptions = contractData
        .filter(contract => contract.id !== activeReviewContractId)
        .slice()
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
        .map(contract => `<option value="${escapeHtml(contract.id)}" ${contract.id === selected?.replacementContractId ? "selected" : ""}>${escapeHtml(contract.name || contract.id)}</option>`)
        .join("");
      return `
        <div class="card" style="grid-column:1/-1">
          <div class="panel-head"><h3>Contract Status</h3><span class="badge blue">User set</span></div>
          <div class="panel-body field-grid">
            <div class="field">
              <label>Status</label>
              <select id="reviewBusinessStatus" onchange="toggleReplacementStatus()">
                ${["Active", "Pending", "Expired", "Terminated", "Replaced", "Do Not Use", "Needs Legal Review"].map(status => `<option value="${status}" ${status === currentStatus ? "selected" : ""}>${status}</option>`).join("")}
              </select>
            </div>
            <div class="field" id="reviewReplacementBox" style="display:${currentStatus === "Replaced" ? "" : "none"}">
              <label>Replaced by</label>
              <select id="reviewReplacementContract">
                <option value="">Select replacement contract</option>
                ${replacementOptions}
              </select>
            </div>
          </div>
        </div>
      `;
    }

    function currentReviewFeeLinesFromInputs() {
      const rows = [...document.querySelectorAll("[data-fee-index]")].reduce((map, input) => {
        const index = Number(input.dataset.feeIndex);
        map[index] = map[index] || { ...(reviewFeeLines[index] || {}) };
        map[index][input.dataset.feeField] = input.value.trim();
        return map;
      }, {});
      return normalizeReviewFeeLines(Object.values(rows).filter(line => line.service || line.rate || line.unit || line.frequency).map(line => ({
        service: line.service || "Fee",
        unit: line.unit || "",
        rate: line.rate || "",
        chargeType: line.chargeType || "",
        quantity: line.quantity || "",
        calculatedAmount: line.calculatedAmount || "",
        frequency: line.frequency || "",
        source: line.source || "Reviewed fee line",
        approved: true
      })));
    }

    function reviewDisplayLabel(label) {
      const normalized = reviewCanonicalLabel(label);
      if (normalized === "document title") return "Contract Name";
      if (normalized === "contract name") return "Contract Name";
      if (normalized === "utility account number") return "Account Number";
      if (normalized === "contract type") return "Contract type";
      if (normalized === "vendor") return "Vendor Name";
      if (normalized === "effective date") return "Effective date";
      if (normalized === "end date") return "End Date";
      if (normalized === "initial contract length") return "Contract Term";
      if (normalized === "how to terminate") return "Termination / Notice";
      if (normalized === "auto renew") return "Auto renew";
      if (normalized === "payment terms") return "Payment Terms";
      if (normalized === "cost") return "Cost";
      if (normalized === "quantity of services") return "Quantity";
      if (normalized === "billing frequency") return "Billing Frequency";
      if (normalized === "annual spend") return "Annual Spend";
      if (normalized === "vendor mailing address") return "Vendor Address";
      if (normalized === "insurance requirement") return "Insurance";
      return label || "";
    }

    function cleanTermDisplay(value) {
      return String(value || "")
        .replace(/\s+/g, " ")
        .replace(/^of\s+(this\s+)?agreement\s+shall\s+be\s+for\s+a\s+(period|term)\s+of\s+/i, "")
        .replace(/^shall\s+be\s+for\s+a\s+(period|term)\s+of\s+/i, "")
        .replace(/^for\s+a\s+(period|term)\s+of\s+/i, "")
        .replace(/\b(\d{2,3}|\([2-9]\d*\))\s+(month|year|day)\b/gi, "$1 $2s")
        .replace(/\s+commencing\s+on\s+.*$/i, "")
        .replace(/\s+beginning\s+on\s+.*$/i, "")
        .replace(/\s+starting\s+on\s+.*$/i, "")
        .replace(/\s+unless\s+.*$/i, "")
        .replace(/\s*,?\s*provided\s+that.*$/i, "")
        .trim();
    }

    function reviewInputValue(item) {
      const label = String(item.label || "").toLowerCase();
      if (["initial contract length", "renewal term", "notice period", "termination"].includes(label)) {
        return cleanTermDisplay(item.value);
      }
      return item.value || "";
    }

    function shouldBlankUntrustedReviewValue(item = {}) {
      const label = reviewCanonicalLabel(item.label || "");
      const value = String(item.value || "").replace(/\s+/g, " ").trim();
      const source = String(item.source || "");
      const confidence = Number(item.confidence || 0);
      if (!value || item.approved || /verified against current contract ocr|manually verified against the current source pdf/i.test(source)) return false;
      if (label === "vendor" && isBadVendorReviewValue(value)) return true;
      if (["cost", "rate / fee", "fee", "contract value", "monthly cost"].includes(label)) {
        if (/\b(insurance|liability|claim|occurrence|aggregate|additional insured|policy|coverage|confidential|financial information|billing)\b/i.test(`${value} ${source}`)) return true;
        if (!/(\$|\b\d+(?:\.\d+)?\s*%|\b(?:fee schedule|rate|fee|charge|cost|monthly|annual|per month|per day|per mile|per visit|per square foot|per sq ft|per linear foot|per unit|delivery)\b)/i.test(value)) return true;
      }
      if (["start date", "start of services", "effective date", "end date", "signature date", "signed date"].includes(label)) {
        if (!/\b(?:\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i.test(value)) return true;
        if (value.length > 60) return true;
      }
      if (label === "payment terms" && !/\b(?:net\s*\d{1,3}|due|payable|paid|invoice|receipt)\b/i.test(value)) return true;
      if (label === "how to terminate" && (/\b(?:insurance|liability|certificate|additional insured|policy|coverage|claim|occurrence|aggregate)\b/i.test(`${value} ${source}`) || !/\b(?:terminate|termination|cancel|non[-\s]?renew|notice|days|without cause|for cause)\b/i.test(value))) return true;
      if (label === "auto renew" && !/^(yes|no|ongoing|unknown)$/i.test(value) && !/\b(?:automatically renew|auto[-\s]?renew|renewal term|successive|unless terminated|continues? until terminated|ongoing|does not renew|will not renew|no automatic renewal)\b/i.test(value)) return true;
      if (confidence && confidence < 55 && ["vendor", "payment terms", "cost", "rate / fee", "fee", "effective date", "start of services", "end date"].includes(label)) return true;
      return false;
    }

    function reviewInputDisplayValue(item = {}) {
      if (shouldBlankUntrustedReviewValue(item)) return "";
      const value = reviewInputValue(item);
      const canonical = reviewCanonicalLabel(item.label || item.key || "");
      return isMoneyReviewField(canonical) ? formatMoneyText(value) : value;
    }

    function isMoneyReviewField(label = "") {
      const canonical = reviewCanonicalLabel(label);
      return ["cost", "rate / fee", "fee", "monthly cost", "annual spend", "contract value", "service pricing detail"].includes(canonical)
        || /\b(cost|fee|rate|price|pricing|charge|spend|amount|monthly|annual)\b/i.test(canonical);
    }

    const reviewChecklistFields = [...(reviewConfigBootstrap.reviewChecklistFields || [])];
    const financeSupportFields = [...(reviewConfigBootstrap.financeSupportFields || [])];
    const primaryReviewLabels = [...(reviewConfigBootstrap.primaryReviewLabels || [])];
    const reviewSelectOptionsByLabel = { ...(reviewConfigBootstrap.reviewSelectOptionsByLabel || {}) };
    if (!reviewChecklistFields.some(field => reviewCanonicalLabel(field.label) === "facility")) {
      reviewChecklistFields.splice(2, 0, { label: "Facility", aliases: ["Facility"], required: true });
    }
    if (!primaryReviewLabels.map(reviewCanonicalLabel).includes("facility")) {
      primaryReviewLabels.splice(2, 0, "Facility");
    }
    const requiredReviewCanonicalLabels = new Set(reviewChecklistFields.map(field => reviewCanonicalLabel(field.label)));

    function isPrimaryReviewField(label) {
      return primaryReviewLabels.map(reviewCanonicalLabel).includes(reviewCanonicalLabel(label));
    }

    const coreReviewCanonicalLabels = new Set([
      "contract type",
      "vendor",
      "facility",
      "effective date",
      "cost",
      "auto renew",
      "how to terminate"
    ]);
    const financeSupportCanonicalLabels = new Set([
      "quantity of services",
      "billing frequency",
      "annual spend"
    ]);

    function isCoreReviewField(label) {
      return coreReviewCanonicalLabels.has(reviewCanonicalLabel(label));
    }

    function reviewFieldRank(label) {
      const normalized = reviewCanonicalLabel(label);
      const index = primaryReviewLabels.map(reviewCanonicalLabel).indexOf(normalized);
      return index >= 0 ? index : 999;
    }

    function reviewCompletionStats(cards) {
      const selected = selectedReviewContract();
      const requiredLabels = selected
        ? requiredFieldsForContractType(reviewComparableContract(selected, cards.map(({ item }) => item)))
          .filter(row => row.mandatory !== false && !row.learned && !row.vendorSpecific && !row.serviceSpecific)
          .map(row => row.label.toLowerCase())
        : [];
      const primary = cards.filter(({ item }) => isCoreReviewField(item.label) && (requiredLabels.length
        ? requiredLabels.some(label => reviewFieldMatches(item, requirementAliasesForLabel(label)) || String(item.label || "").toLowerCase().includes(label.split("/")[0].trim()))
        : isPrimaryReviewField(item.label)));
      const required = primary.length ? primary : cards.filter(({ item }) => isCoreReviewField(item.label) && isPrimaryReviewField(item.label));
      const approved = required.filter(({ item }) => item.approved && !isSuspiciousReviewField(item)).length;
      const lowConfidence = required.filter(({ item }) => Number(item.confidence || 0) && Number(item.confidence || 0) < 65).length;
      return {
        required,
        approved,
        lowConfidence,
        remaining: Math.max(0, required.length - approved),
        percent: required.length ? Math.round((approved / required.length) * 100) : 0
      };
    }

    function reviewFinanceCalculatorHtml(fields = []) {
      const calc = calculateReviewAnnualSpend(fields);
      const rate = reviewFieldByCanonical(fields, "cost")?.value || "Needs rate";
      const quantity = reviewFieldByCanonical(fields, "quantity of services")?.value || "Needs quantity";
      const frequency = reviewFieldByCanonical(fields, "billing frequency")?.value || "Needs frequency";
      const annual = calc.annual ? reportMoney(calc.annual) : calc.source;
      const badgeClass = calc.annual ? "green" : calc.status === "percent-rate" ? "blue" : "amber";
      const feeLineCount = (reviewFeeLines || []).filter(line => reviewCostValueIsUsable(line.rate, `${line.service || ""} ${line.source || ""}`)).length;
      const feeLineSummary = feeLineCount > 1
        ? `<div class="metric-row"><div><strong>${feeLineCount} fee lines</strong><span>Base fees and add-on charges are tracked below in the fee schedule.</span></div><span class="badge blue">Multiple</span></div>`
        : "";
      return `
        <div class="card" style="grid-column:1/-1">
          <div class="panel-head">
            <h3>Finance Calculation</h3>
            <span class="badge ${badgeClass}">${calc.annual ? "Calculated" : "Needs data"}</span>
          </div>
          <div class="panel-body metric-list">
            <div class="metric-row"><div><strong>${escapeHtml(rate)}</strong><span>Cost / Rate</span></div><span class="badge gray">Rate</span></div>
            <div class="metric-row"><div><strong>${escapeHtml(quantity)}</strong><span>Quantity / volume</span></div><span class="badge gray">Qty</span></div>
            <div class="metric-row"><div><strong>${escapeHtml(frequency)}</strong><span>Billing frequency</span></div><span class="badge gray">Cycle</span></div>
            <div class="metric-row"><div><strong>${escapeHtml(annual)}</strong><span>Annual spend</span></div><span class="badge ${badgeClass}">${calc.annual ? "Saved" : "Open"}</span></div>
            ${feeLineSummary}
          </div>
        </div>
      `;
    }

    function fieldInputHtml(item, index) {
      const label = String(item.label || "").toLowerCase();
      const canonical = reviewCanonicalLabel(item.label || "");
      if (label === "facility") {
        const options = facilityMasterOptions();
        const current = reviewInputDisplayValue(item);
        const hasCurrent = current && !options.some(f => sameMasterName(f.name, current));
        return `
          <select data-extracted-index="${index}">
            ${hasCurrent ? `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} - OCR value</option>` : ""}
            <option value="">${options.length ? "Choose facility" : "No facility master loaded yet"}</option>
            ${options.map(f => `<option value="${escapeHtml(f.name)}" ${sameMasterName(f.name, current) ? "selected" : ""}>${escapeHtml(f.name)}</option>`).join("")}
          </select>
        `;
      }
      if (canonical === "vendor") {
        const current = reviewInputDisplayValue(item);
        const options = vendorSuggestionOptions(current, 80);
        const matchedCurrent = current && options.some(v => sameMasterName(v.name, current));
        const typedValue = matchedCurrent || !isBadVendorReviewValue(current) ? current : "";
        const vendorListId = `reviewVendorList${index}`;
        return `
          <input data-extracted-index="${index}" data-review-new-value-index="${index}" list="${escapeHtml(vendorListId)}" placeholder="Type vendor name" value="${escapeHtml(typedValue)}" autocomplete="off" oninput="handleReviewVendorInput(${index})" onchange="handleReviewVendorInput(${index})" />
          ${vendorDatalistHtml(vendorListId, options)}
          <div id="reviewVendorMatch${index}" class="source">${matchedCurrent ? `Matched saved vendor: ${escapeHtml(options.find(v => sameMasterName(v.name, current))?.name || current)}.` : "Start typing to search all saved vendors."}</div>
          <div class="source" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="btn ghost" type="button" onclick="saveReviewVendorToMaster(${index})">Save as New Vendor</button>
            <button class="btn ghost" type="button" onclick="saveReviewVendorToMaster(${index}, true)">Save + Open Vendor Card</button>
            <button class="btn ghost" type="button" onclick="openVendorFromReview(${index})">Open Vendor Card</button>
            <span>${isBadVendorReviewValue(current) ? "Vendor not confirmed." : "Saved vendors match as you type."}</span>
          </div>
        `;
      }
      if (canonical === "contract type") {
        const current = reviewInputDisplayValue(item);
        const cleanCategories = uniqueCategories();
        const fuzzy = fuzzyCategoryMatch(current, cleanCategories);
        const selectedCategory = fuzzy?.value || "";
        const currentIsSaved = selectedCategory && cleanCategories.some(category => sameMasterName(category, selectedCategory));
        const showOtherInput = current && !currentIsSaved;
        return `
          <select data-extracted-index="${index}" onchange="toggleReviewServiceOther(${index})">
            <option value="">Choose service type</option>
            ${cleanCategories.map(category => `<option value="${escapeHtml(category)}" ${sameMasterName(category, selectedCategory || current) ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
            <option value="__other__" ${showOtherInput ? "selected" : ""}>Other / Add new service</option>
          </select>
          <input data-review-new-value-index="${index}" id="reviewServiceOther${index}" placeholder="Type new service" value="${escapeHtml(showOtherInput ? current : "")}" style="${showOtherInput ? "margin-top:8px" : "display:none;margin-top:8px"}" />
          <div class="source" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="btn ghost" type="button" onclick="saveReviewServiceToMaster(${index})">Save as New Service</button>
            <span>Choose a saved service, or choose Other and type it here.</span>
          </div>
          ${fuzzy && !fuzzy.exact ? `<div class="source">Suggested closest saved type: ${escapeHtml(fuzzy.value)}. OCR read: ${escapeHtml(current)}.</div>` : ""}
        `;
      }
      const selectOptions = reviewSelectOptionsByLabel[label] || reviewSelectOptionsByLabel[canonical];
      if (selectOptions) {
        const current = reviewInputDisplayValue(item) || "";
        const options = selectOptions;
        const hasCurrent = current && !options.some(option => sameMasterName(option, current));
        return `
          <select data-extracted-index="${index}">
            ${hasCurrent ? `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} - OCR value</option>` : ""}
            ${options.map(option => `<option value="${escapeHtml(option)}" ${sameMasterName(option, current) ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
          </select>
          <div class="source review-dropdown-help">${escapeHtml(reviewDropdownGuidance(canonical))}</div>
        `;
      }
      return `<input value="${escapeHtml(reviewInputDisplayValue(item))}" data-extracted-index="${index}" placeholder="${shouldBlankUntrustedReviewValue(item) ? "Needs Review - type value from contract" : ""}" />`;
    }

    function reviewDropdownGuidance(label = "") {
      const guidance = {
        "auto renew": "Yes = automatically starts another term. No = ends without automatic renewal. Ongoing = continues until terminated and has no renewal event. Unknown = source is unclear.",
        "contract status": "Active is currently in use. Pending is not final. Expired or Terminated is historical. Replaced links it to a newer agreement.",
        "risk": "Low, Medium, High, or Critical describes business/legal attention needed; it is not the contract status.",
        "insurance certificate": "Received, Missing, Expired, or Not Required describes proof of insurance for this vendor relationship."
      };
      return guidance[label] || "Choose the option that matches the actual contract wording. Use Needs Review when the source is not clear.";
    }

    function handleReviewVendorInput(index) {
      const input = document.querySelector(`[data-review-new-value-index="${index}"]`);
      const list = document.getElementById(`reviewVendorList${index}`);
      const helper = document.getElementById(`reviewVendorMatch${index}`);
      if (!input || !list) return;
      const typed = cleanMasterName(input.value || "");
      const options = vendorSuggestionOptions(typed, 20);
      list.innerHTML = options.map(vendor => `<option value="${escapeHtml(vendor.name)}">${escapeHtml([vendor.category, vendor.primaryContact, vendor.phone, vendor.email].filter(Boolean).join(" | "))}</option>`).join("");
      const exact = typed && vendorMasterOptions().find(vendor => sameVendorName(vendor.name, typed));
      const possibleDuplicate = !exact ? vendorDuplicateCandidates(typed, 75)[0] : null;
      if (helper) {
        helper.textContent = exact
          ? `Matched saved vendor: ${exact.name}. Save Field to link this contract.`
          : possibleDuplicate
            ? `Possible existing vendor: ${possibleDuplicate.vendor.name}. Choose it to avoid a duplicate vendor card.`
          : typed
            ? `${options.length} possible match${options.length === 1 ? "" : "es"}. Choose one, or save as a new vendor.`
            : "Start typing to search all saved vendors.";
        helper.style.color = exact ? "var(--green)" : "var(--muted)";
        helper.style.fontWeight = exact ? "800" : "600";
      }
    }

    function isHiddenReviewField(fieldOrLabel) {
      if (fieldOrLabel && typeof fieldOrLabel === "object" && fieldOrLabel.hidden) return true;
      const label = typeof fieldOrLabel === "object" ? fieldOrLabel.label : fieldOrLabel;
      const canonical = reviewCanonicalLabel(label);
      return [
        "purpose / scope",
        "category reason",
        "signer",
        "signer title",
        "signature date",
        "signed date",
        "cost bed/month",
        "cost per bed month"
      ].includes(String(label || "").toLowerCase()) || ["signature date", "cost bed/month"].includes(canonical);
    }

    function reviewCanonicalLabel(label) {
      const normalized = String(label || "").toLowerCase().replace(/\s+/g, " ").trim();
      if (["title", "document title", "contract title", "contract name"].includes(normalized)) return "contract name";
      if (["contract type", "agreement type", "service type", "category", "services", "service/category"].includes(normalized)) return "contract type";
      if (["vendor name", "vendor", "provider", "contractor", "supplier"].includes(normalized)) return "vendor";
      if (["signed date", "signature date", "date signed"].includes(normalized)) return "signature date";
      if (["annual cost", "annual charge", "annual spend", "annualized spend", "total annual spend"].includes(normalized)) return "annual spend";
      if (["billing frequency", "billing cycle", "frequency", "recurring"].includes(normalized)) return "billing frequency";
      if (["quantity of services", "service quantity", "quantity", "units", "square feet", "sq ft", "miles", "trips", "pickups", "boxes", "containers", "tests", "meals", "sessions"].includes(normalized)) return "quantity of services";
      if (["cost", "fee", "fees", "rate", "rates", "rate / fee", "contract value", "contract amount", "contract price", "amount", "charge", "charges", "price", "pricing", "monthly cost", "monthly charge", "monthly recurring charge", "mrc", "non-recurring charge", "nrc", "service order total", "recurring charge", "service charge", "service charges", "service fee", "service fees", "service pricing detail", "fee details", "pricing detail", "lab test pricing"].includes(normalized)) return "cost";
      if (["payment terms", "days payable", "payable days", "invoice due", "due date", "due within", "paid within", "payable within", "net terms"].includes(normalized)) return "payment terms";
      if (["start date", "effective date", "start of services", "service start date", "service date", "commencement date", "commencement", "effective"].includes(normalized)) return "effective date";
      if (["end date", "expiration date", "expires"].includes(normalized)) return "end date";
      if (["initial contract length", "contract length", "contract term", "agreement term", "term"].includes(normalized)) return "initial contract length";
      if (["auto-renewal", "auto renewal", "automatic renewal", "auto renew", "automatically renew", "renews", "renewal", "successive terms"].includes(normalized)) return "auto renew";
      if (["how to terminate", "termination", "termination notice", "termination rights", "notice period", "required notice days", "cancellation", "cancel", "non-renewal", "notice to terminate", "written notice"].includes(normalized)) return "how to terminate";
      if (["vendor address", "vendor mailing address", "vendor remit address", "remit address", "mailing address"].includes(normalized)) return "vendor mailing address";
      if (["vendor email", "vendor e-mail"].includes(normalized)) return "vendor email";
      if (["vendor phone", "vendor telephone"].includes(normalized)) return "vendor phone";
      if (["insurance", "insurance requirement", "insurance certificate", "coi"].includes(normalized)) return "insurance requirement";
      return normalized;
    }

    function applyReviewFieldToMatchingAliases(index, savedField = {}) {
      if (!savedField?.label) return;
      const canonical = reviewCanonicalLabel(savedField.label);
      const verified = withReviewerVerification(savedField);
      let matched = false;
      reviewFields = (reviewFields || []).map((field, fieldIndex) => {
        if (!field) return field;
        const sameField = fieldIndex === index || reviewCanonicalLabel(field.label || "") === canonical;
        if (!sameField) return field;
        matched = true;
        return {
          ...field,
          ...verified,
          confidence: Number(verified.confidence || field.confidence || 100),
          snippet: verified.snippet || field.snippet,
          context: verified.context || field.context,
          savedCanonical: canonical
        };
      });
      if (!matched) {
        reviewFields.push({
          ...verified,
          savedCanonical: canonical
        });
      }
    }

    function withReviewerVerification(field = {}) {
      const source = String(field.source || "");
      const alreadyProof = /verified against current contract ocr|source verified|pdf verified|verified against source|verified by reviewer/i.test(source);
      const fallbackSource = "Source Verified by reviewer against the current source contract.";
      return {
        ...field,
        confidence: Number(field.confidence || 100),
        approved: field.approved !== false,
        approvedAt: field.approvedAt || new Date().toISOString(),
        approvedBy: field.approvedBy || "Reviewer",
        source: alreadyProof ? source : (source ? `${source} Source Verified by reviewer.` : fallbackSource)
      };
    }

    function refreshReviewFieldsAfterFieldSave(result, fallbackField, index) {
      if (result?.contract) {
        const normalized = upsertLiveContract(result.contract);
        const selected = contracts.find(contract => contract.id === activeReviewContractId) || normalized;
        const savedFields = selected?.extractedFields?.length ? selected.extractedFields : normalized?.extractedFields;
        if (savedFields?.length) reviewFields = [...savedFields];
      }
      applyReviewFieldToMatchingAliases(index, result?.field || fallbackField);
    }

    function reviewFieldIndexByLabel(label) {
      const wanted = reviewCanonicalLabel(label);
      return (reviewFields || []).findIndex(field => reviewCanonicalLabel(field?.label || "") === wanted);
    }

    function modalCorrectionInputHtml(field, index) {
      const inputHtml = fieldInputHtml(field, index).replaceAll("data-extracted-index=", "data-modal-extracted-index=");
      return inputHtml;
    }

    function fieldSourceSelectorHtml(index, text = "", query = "") {
      const snippets = query ? searchOcrText(text, query, 10) : [];
      const sourceText = snippets.length
        ? snippets.join("\n\n--- next match ---\n\n")
        : displayOcrText(text, 20000).text;
      const clipped = String(text || "").length > sourceText.length;
      const highlightQuery = query || reviewFields[index]?.label || "";
      return `
        <div class="field-source-selector">
          <div class="field" style="margin-bottom:10px">
            <label>Search source text</label>
            <div class="search-row">
              <input id="fieldSourceSearch${index}" value="${escapeHtml(query || "")}" placeholder="Search term, renewal, fee, 30 days, insurance..." onkeydown="if(event.key==='Enter'){event.preventDefault(); updateFieldSourceSearch(${index});}" />
              <button class="btn" type="button" onclick="updateFieldSourceSearch(${index})">Search</button>
              <button class="btn ghost" type="button" onclick="resetFieldSourceSearch(${index})">Clear</button>
            </div>
          </div>
          <textarea id="fieldSourceOcrText${index}" readonly class="field-source-text source-hidden-textarea">${escapeHtml(sourceText || "No OCR text is saved for this contract yet.")}</textarea>
          <div id="fieldSourceOcrReader${index}" class="field-source-reader" tabindex="0">${highlightOcrReaderText(sourceText || "No OCR text is saved for this contract yet.", highlightQuery, 22000)}</div>
          ${clipped ? `<div class="source">Showing ${sourceText.length.toLocaleString()} of ${String(text || "").length.toLocaleString()} OCR characters. Use Full OCR for the complete text.</div>` : ""}
          <div class="table-actions" style="margin-top:10px">
            <button class="btn" type="button" onclick="useSelectedOcrTextForField(${index}, false)">Use Highlighted Wording</button>
            <button class="btn primary" type="button" onclick="useSelectedOcrTextForField(${index}, true)">Use Highlighted + Save</button>
            <button class="btn ghost" type="button" onclick="showFullOcrText()">Full OCR</button>
          </div>
        </div>
      `;
    }

    function updateFieldSourceSearch(index) {
      const input = document.getElementById(`fieldSourceSearch${index}`);
      const area = document.getElementById(`fieldSourceOcrText${index}`);
      const reader = document.getElementById(`fieldSourceOcrReader${index}`);
      const query = String(input?.value || "").trim();
      if (!area && !reader) return;
      const text = reviewContractText();
      const matches = query ? searchOcrText(text, query, 12) : [];
      const sourceText = matches.length
        ? matches.join("\n\n--- next match ---\n\n")
        : (query ? `No OCR matches found for: ${query}` : displayOcrText(text, 12000).text);
      if (area) area.value = sourceText;
      if (reader) {
        reader.innerHTML = matches.length || !query
          ? highlightOcrReaderText(sourceText, query || reviewFields[index]?.label || "", 22000)
          : escapeHtml(sourceText);
        reader.scrollTop = 0;
      }
    }

    function resetFieldSourceSearch(index) {
      const input = document.getElementById(`fieldSourceSearch${index}`);
      const area = document.getElementById(`fieldSourceOcrText${index}`);
      const reader = document.getElementById(`fieldSourceOcrReader${index}`);
      const sourceText = displayOcrText(reviewContractText(), 20000).text || "No OCR text is saved for this contract yet.";
      if (input) input.value = "";
      if (area) area.value = sourceText;
      if (reader) {
        reader.innerHTML = highlightOcrReaderText(sourceText, reviewFields[index]?.label || "", 22000);
        reader.scrollTop = 0;
      }
    }

    function setReviewFieldControlValue(index, value) {
      const cleanValue = cleanReviewFieldValue(reviewFields[index]?.label || "", value);
      const controls = [
        document.querySelector(`[data-modal-extracted-index="${index}"]`),
        document.querySelector(`[data-modal-review-new-value-index="${index}"]`),
        document.querySelector(`[data-extracted-index="${index}"]`),
        document.querySelector(`[data-review-new-value-index="${index}"]`)
      ].filter(Boolean);
      controls.forEach(control => {
        if (control.tagName === "SELECT" && cleanValue && ![...control.options].some(option => option.value === cleanValue)) {
          control.insertAdjacentHTML("afterbegin", `<option value="${escapeHtml(cleanValue)}">${escapeHtml(cleanValue)} - selected from OCR</option>`);
        }
        control.value = cleanValue;
      });
      return cleanValue;
    }

    function useSelectedOcrTextForField(index, saveNow = false) {
      const area = document.getElementById(`fieldSourceOcrText${index}`);
      if (!reviewFields[index]) return;
      const browserSelection = String(window.getSelection?.().toString() || "").trim();
      const textareaSelection = area ? area.value.slice(area.selectionStart || 0, area.selectionEnd || 0).trim() : "";
      const selected = browserSelection || textareaSelection;
      if (!selected) {
        showToast("Highlight the correct wording in the OCR text first.");
        return;
      }
      const value = setReviewFieldControlValue(index, selected);
      reviewSaveStatus = `${reviewDisplayLabel(reviewFields[index].label)} filled from highlighted OCR text.`;
      showToast("Highlighted OCR text was copied into the field.");
      if (saveNow && value) {
        saveReviewCorrectionFromModal(index, true);
      }
    }

    function openReviewCorrectionModal(index, searchQuery = "") {
      const field = reviewFields[index];
      if (!field) return;
      const clueKey = `${activeReviewContractId || activeReviewJobId || "review"}:${index}:source-clues`;
      const modal = document.getElementById("contractModal");
      if (activeSourceClueKey === clueKey && modal?.classList.contains("open")) {
        closeModal();
        return;
      }
      activeSourceClueKey = clueKey;
      const query = searchQuery || similarSearchQueryForField(field);
      const text = reviewContractText();
      const snippets = searchOcrText(reviewContractText(), query, 6);
      const selected = selectedReviewContract();
      const sourceRecord = selectedReviewSourceRecord();
      const sourceFileUrl = contractFileUrl(sourceRecord);
      const sourceKind = contractSourceKind(sourceRecord);
      const openLabel = sourceOpenLabel(sourceKind);
      document.getElementById("modalTitle").textContent = `Edit ${reviewDisplayLabel(field.label)}`;
      document.getElementById("modalBody").innerHTML = `
        <div class="pdf-compare-layout">
          <article class="card">
            <div class="panel-head"><h3>Edit Field</h3><span class="badge ${confidenceBadge(field).className}">${confidenceBadge(field).text}</span></div>
            <div class="panel-body grid">
              <div class="field">
                <label>${escapeHtml(reviewDisplayLabel(field.label))}</label>
                ${modalCorrectionInputHtml(field, index)}
              </div>
              <div class="source">${field.confidence ? `${field.confidence}% confidence. ` : ""}${escapeHtml(field.source || "OCR suggestion")}</div>
              <div class="paper">${highlightSourceText(field.snippet || field.context || "No source snippet was saved for this field.", field.label, 650)}</div>
              <div class="table-actions">
                <button class="btn primary" type="button" onclick="saveReviewCorrectionFromModal(${index}, true)">Save Field</button>
                <button class="btn" type="button" onclick="closeModal()">Close Clues</button>
                <button class="btn ghost" type="button" onclick="checkReviewFieldAgainstSource(${index})">Check Source</button>
                <details class="inline-more">
                  <summary class="btn ghost">More</summary>
                  <div class="more-menu">
                    <button class="btn ghost" type="button" onclick="markReviewFieldPdfVerified(${index})">Source Verified</button>
                    <button class="btn ghost" type="button" onclick="showReviewFieldSource(${index})">Show Source</button>
                    <button class="btn danger" type="button" onclick="clearReviewFieldFromModal(${index})">Clear Wrong Value</button>
                  </div>
                </details>
              </div>
            </div>
          </article>
          <article class="card">
            <div class="panel-head"><h3>Source</h3><div class="table-actions">${sourceFileUrl ? `<a class="btn ghost" href="${escapeHtml(sourceFileUrl)}" target="_blank" rel="noopener">${escapeHtml(openLabel)}</a>` : `<span class="badge amber">No source</span>`}</div></div>
            <div class="panel-body metric-list">
              <div class="metric-row"><div><strong>Source clues</strong><span>Clues are not auto-saved. Highlight the correct wording only.</span></div><span class="badge amber">Manual choice</span></div>
              ${fieldSourceSelectorHtml(index, text, query)}
              ${snippets.length ? snippets.map((snippet, matchIndex) => `
                <div class="metric-row">
                  <div><strong>Clue ${matchIndex + 1}</strong><span>${highlightSourceText(snippet, query, 520)}</span></div>
                </div>
              `).join("") : `<div class="metric-row"><div><strong>No clue found</strong><span>Use the field box to correct manually, or open the full OCR text.</span></div><button class="btn ghost" type="button" onclick="showFullOcrText()">Full OCR</button></div>`}
              ${sourceFileUrl && sourceKind === "pdf" ? `<iframe class="contract-preview-frame" src="${escapeHtml(sourceFileUrl)}" title="Original contract PDF"></iframe>` : ""}
            </div>
          </article>
        </div>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    async function saveReviewCorrectionFromModal(index, approve = false, options = {}) {
      const field = reviewFields[index];
      if (!field) return;
      const scroller = document.querySelector("main");
      const keepY = scroller ? scroller.scrollTop : window.scrollY;
      const control = document.querySelector(`[data-modal-extracted-index="${index}"]`);
      const rawValue = control ? control.value : "";
      const value = cleanReviewFieldValue(field.label, rawValue);
      const savedField = {
        ...field,
        value,
        confidence: 100,
        approved: approve || Boolean(value),
        source: sourceCheckSnippets(field, value).exact.length
          ? "Corrected by reviewer and verified against current contract OCR."
          : "Source Verified by reviewer against the current source contract. Exact value was not found in OCR."
      };
      applyReviewFieldToMatchingAliases(index, savedField);
      try {
        let result = null;
        if (activeReviewContractId && value) {
          result = await apiJson(`/api/review/${encodeURIComponent(activeReviewContractId)}/field`, {
            method: "POST",
            body: JSON.stringify({ field: savedField })
          });
          refreshReviewFieldsAfterFieldSave(result, savedField, index);
          if (result.learnedRules) {
            learningRules = await apiJson("/api/learning-rules").catch(() => learningRules);
          }
        }
        const learned = Number(result?.learnedRules || 0);
        reviewSaveStatus = activeReviewContractId
          ? `${reviewDisplayLabel(field.label)} saved to the contract record${learned ? ` and taught ${learned} new example${learned === 1 ? "" : "s"}` : ""}.`
          : `${reviewDisplayLabel(field.label)} saved on this screen. Select a contract before final submit.`;
      } catch (error) {
        reviewSaveStatus = `${reviewDisplayLabel(field.label)} was not saved to the backend. Fix the value or try Save Field again.`;
        renderReview();
        showReviewSaveProblem(error, "Field Not Saved");
        showToast(error.message || "Field save failed.");
        return;
      }
      renderReview();
      if (scroller) scroller.scrollTop = keepY;
      else window.scrollTo(0, keepY);
      showToast("Saved to contract record.");
      if (Number.isFinite(options.nextDirection)) {
        setTimeout(() => openAdjacentReviewField(index, options.nextDirection), 80);
      } else if (options.closeOnSave) {
        document.getElementById("contractModal").classList.remove("open");
      } else {
        setTimeout(() => showReviewFieldSource(index), 80);
      }
    }

    function saveReviewCorrectionAndNext(index) {
      return saveReviewCorrectionFromModal(index, true, { nextDirection: 1 });
    }

    function clearReviewFieldFromModal(index) {
      clearReviewField(index);
      document.getElementById("contractModal").classList.remove("open");
    }

    function openReviewSummaryField(label, searchQuery = "") {
      const index = reviewFieldIndexByLabel(label);
      if (index < 0) {
        runReviewOcrSearch(searchQuery || label);
        showToast(`Search opened for ${label}. Add the value below if OCR missed it.`);
        return;
      }
      openReviewCorrectionModal(index, searchQuery);
      const card = document.getElementById(`review-field-${index}`);
      if (card) {
        card.classList.add("needs-attention");
        setTimeout(() => card.classList.remove("needs-attention"), 2400);
      }
    }

    function clearReviewField(index) {
      if (!reviewFields[index]) return;
      const scroller = document.querySelector("main");
      const keepY = scroller ? scroller.scrollTop : window.scrollY;
      const clearedField = {
        ...reviewFields[index],
        value: "",
        confidence: 0,
        approved: false,
        source: "Cleared by reviewer. Enter the correct value and save."
      };
      applyReviewFieldToMatchingAliases(index, clearedField);
      renderReview();
      if (scroller) scroller.scrollTop = keepY;
      else window.scrollTo(0, keepY);
      showToast("Field cleared. Enter the correct value, then save and teach.");
    }

    async function deleteReviewField(index) {
      if (!reviewFields[index]) return;
      const field = reviewFields[index];
      const label = reviewDisplayLabel(field.label);
      if (!confirm(`Delete ${label} from this review?`)) return;
      const scroller = document.querySelector("main");
      const keepY = scroller ? scroller.scrollTop : window.scrollY;
      const canonical = reviewCanonicalLabel(field.label);
      reviewFields = reviewFields.map(item => reviewCanonicalLabel(item?.label) === canonical ? {
        ...item,
        value: "",
        approved: false,
        hidden: true,
        source: "Deleted from Review Queue by reviewer."
      } : item);
      try {
        if (activeReviewContractId) {
          const result = await apiJson(`/api/review/${encodeURIComponent(activeReviewContractId)}/field`, {
            method: "DELETE",
            body: JSON.stringify({ label: field.label })
          });
          if (result.contract) {
            upsertLiveContract(result.contract);
          }
        }
        reviewSaveStatus = `${label} was deleted from this review. Continue with the fields that matter.`;
        renderReview();
        if (scroller) scroller.scrollTop = keepY;
        else window.scrollTo(0, keepY);
        showToast("Field deleted.");
      } catch (error) {
        renderReview();
        showToast(error.message || "Field hidden here, but backend delete failed.");
      }
    }

    function reviewFieldMatches(field, labels) {
      const normalized = reviewCanonicalLabel(field?.label || "");
      return labels.some(label => normalized === reviewCanonicalLabel(label));
    }

    function reviewValueIsEmpty(value) {
      const text = String(value || "").trim();
      return !text || ["needs review", "needs classification", "unknown", "not found", "tbd", "n/a", "na", "none"].includes(text.toLowerCase());
    }

    function reviewCostValueIsUsable(value, source = "") {
      const text = String(value || "").replace(/\s+/g, " ").trim();
      const combined = `${text} ${source || ""}`;
      if (reviewValueIsEmpty(text)) return false;
      if (/\b(insurance|liability|claim|occurrence|aggregate|additional insured|policy|coverage|deductible)\b/i.test(combined)) return false;
      if (/\b(no charge|no cost|zero charge|included at no additional cost|included free|free of charge|not charged)\b/i.test(combined)) return true;
      return /(\$\s*\d|\b\d+(?:\.\d+)?\s*%|\b(?:percent|fee schedule|rate schedule|pricing schedule|price list|fee|rate|charge|cost|price|pricing|monthly|annual|annually|minimum|surcharge|flat fee|hourly|daily|weekly|quarterly|per month|per day|per mile|per visit|per square foot|per sq ft|per linear foot|per pickup|per trip|per load|per test|per box|per container|per meal|per session|per service call|per unit|per delivery|per gallon|per hour|per bed|per resident day|per patient day|per diem|ppd)\b)/i.test(combined);
    }

    function isSuspiciousReviewField(field) {
      const label = reviewCanonicalLabel(field?.label || "");
      const value = String(field?.value || "");
      const source = String(field?.source || "");
      const combined = `${value} ${source}`.toLowerCase();
      if (reviewValueIsEmpty(value)) return true;
      if (/learned from approved correction/i.test(source)) return true;
      if (["how to terminate", "notice period", "termination", "insurance requirement", "indemnification", "payment terms", "cost", "rate / fee"].includes(label)
        && /suggested from prior correction/i.test(source)) return true;
      if (["how to terminate", "notice period", "termination", "insurance requirement", "indemnification", "payment terms", "cost", "rate / fee", "fee"].includes(label)
        && !/ocr|source|found|pricing|manual|saved|review/i.test(source)) return true;
      if ((label === "cost" || label === "rate / fee" || label === "monthly cost" || label === "contract value") && /\b(insurance|liability|claim|occurrence|aggregate|additional insured)\b/.test(combined)) return true;
      if (label === "cost" && !reviewCostValueIsUsable(value, source)) return true;
      if (label === "how to terminate" && /\b(insurance|liability|certificate|additional insured|policy|coverage|claim|occurrence|aggregate)\b/.test(combined)) return true;
      if ((label === "payment terms" || label === "days payable") && /net\s+(\d{3,})\b/i.test(value)) return true;
      if (label === "contract type" && value.length > 70) return true;
      if (label === "initial contract length" && value.length > 80) return true;
      if ((label === "vendor" || label === "vendor contact") && /\b(county|facility|center|contracts?)\b/i.test(value) && !/\b(llc|inc|corp|company|co\.|services|transport|protection|security|waste|airgas|synnex|firstlight)\b/i.test(value)) return true;
      if (label === "quantity of services" && value.length > 120) return true;
      return false;
    }

    function requirementAliasesForLabel(label = "") {
      const normalized = reviewCanonicalLabel(label);
      const aliases = {
        "contract name": ["Contract Name", "Document Title", "Name"],
        "contract type": ["Contract type", "Contract Type", "Category", "Agreement Type", "Service Type", "Services"],
        "facility": ["Facility"],
        "vendor": ["Vendor Name", "Vendor"],
        "service/category": ["Category", "Services", "Service Type", "Contract Type", "Agreement Type"],
        "contract status": ["Contract Status", "Status"],
        "effective date": ["Effective date", "Effective Date", "Start of Services", "Start Date", "Service Start Date", "Commencement Date", "Signature Date", "Signed Date"],
        "cost": ["Cost", "Fee", "Fees", "Rate / Fee", "Contract Value", "Contract Amount", "Contract Price", "Amount", "Charge", "Charges", "Rate", "Rates", "Price", "Pricing", "Service Charge", "Service Charges", "Service Fee", "Service Fees", "Monthly Cost", "Monthly Charge", "Monthly Recurring Charge", "MRC", "Annual Cost", "Annual Charge", "Service Order Total"],
        "payment terms": ["Payment Terms", "Days Payable", "Payable Days", "Invoice Due", "Due Within", "Paid Within", "Payable Within", "Net Terms"],
        "auto renew": ["Auto renew", "Auto Renewal", "Auto-Renewal", "Automatic Renewal", "Automatically Renew", "Renews", "Renewal", "Successive Terms"],
        "how to terminate": ["How to terminate", "Notice Period", "Termination", "Termination Notice", "Required Notice Days", "Termination Rights", "Cancellation", "Cancel", "Non-Renewal", "Notice to Terminate", "Written Notice"],
        "start/effective/service date": ["Start of Services", "Start Date", "Effective Date", "Signature Date"],
        "fee/rate or no-fee explanation": ["Fee", "Rate / Fee", "Contract Value", "Monthly Cost"],
        "payment terms or not stated": ["Payment Terms", "Days Payable"],
        "renewal / auto-renewal status": ["Auto Renewal", "Auto-Renewal", "Renewal Term", "Initial Contract Length"],
        "termination / notice language": ["Notice Period", "Termination", "Termination Notice"],
        "account / meter / service address": ["Account Number", "Utility Account Number", "Meter Number", "Service Address"],
        "service detail / frequency": ["Quantity of Services", "Service Pricing Detail", "Pickup / Service Detail"],
        "quantity of services": ["Quantity of Services", "Service Quantity", "Quantity", "Units", "Square Feet", "Sq Ft", "Miles", "Trips", "Pickups", "Boxes", "Containers", "Tests", "Meals", "Sessions"],
        "billing frequency": ["Billing Frequency", "Frequency", "Billing Cycle", "Recurring"],
        "annual spend": ["Annual Spend", "Annual Cost", "Annual Charge", "Annualized Spend", "Total Annual Spend"],
        "clinical/service scope": ["Services", "Service Pricing Detail", "Clinical/service scope"],
        "vendor contact": ["Vendor Contact", "Primary Contact"],
        "vendor address": ["Vendor Mailing Address", "Vendor Address"],
        "vendor email": ["Vendor Email"],
        "vendor phone": ["Vendor Phone"],
        "insurance": ["Insurance Requirement", "Insurance Certificate"],
        "indemnification": ["Indemnification"],
        "monthly cost": ["Monthly Cost"],
        "cost bed/month": ["Cost Bed/Month"],
        "service pricing detail": ["Service Pricing Detail"],
        "pickup / service detail": ["Pickup / Service Detail"]
      };
      return aliases[normalized] || [label];
    }

    function ensureReviewChecklistFields(fields) {
      const list = fields || [];
      reviewChecklistFields.forEach(definition => {
        const existing = list.find(field => reviewFieldMatches(field, definition.aliases));
        if (!existing) {
          list.push({
            label: definition.label,
            value: "",
            confidence: 0,
            source: "Not found in OCR yet. Fill this in manually if the contract has it.",
            approved: false
          });
        }
      });
      financeSupportFields.forEach(definition => {
        const existing = list.find(field => reviewFieldMatches(field, definition.aliases));
        if (!existing) {
          list.push({
            label: definition.label,
            value: "",
            confidence: 0,
            source: "Finance support field. Fill when the rate needs quantity or frequency to calculate annual spend.",
            approved: false,
            financeSupport: true
          });
        }
      });
      const selected = selectedReviewContract();
      if (selected) {
        if (reviewContractIsBaa(selected, list)) {
          const baaDefaults = { cost: "No cost", "payment terms": "No payment - data sharing agreement" };
          Object.entries(baaDefaults).forEach(([canonical, value]) => {
            const field = list.find(item => reviewCanonicalLabel(item.label) === canonical);
            if (!field) return;
            field.value = value;
            field.approved = true;
            field.confidence = 100;
            field.source = "System rule: BAA has no financial impact.";
            field.systemResolved = "baa-no-financial-impact";
          });
        }
        // Vendor/service history should help search and hints, but it must not add extra required fields.
        // The required review section stays limited to reviewChecklistFields.
      }
      return list;
    }

    function reviewContractIsBaa(contract = {}, fields = []) {
      const fieldText = (fields || [])
        .filter(field => ["contract type", "category", "service type"].includes(reviewCanonicalLabel(field.label)))
        .map(field => field.value)
        .join(" ");
      return /\b(business\s+associate\s+agreement|baa|data\s+privacy)\b/i.test([
        contract.contractType,
        contract.agreementType,
        contract.documentType,
        contract.category,
        contract.services,
        contract.name,
        fieldText
      ].filter(Boolean).join(" "));
    }

    function consolidateReviewCards(fields) {
      const best = new Map();
      (fields || []).forEach((item, index) => {
        if (!item?.label || isHiddenReviewField(item)) return;
        const key = reviewCanonicalLabel(item.label);
        const current = best.get(key);
        const score = Number(item.confidence || 0)
          + (item.approved ? 25 : 0)
          + (!reviewValueIsEmpty(item.value) ? 20 : 0)
          - (isSuspiciousReviewField(item) ? 35 : 0);
        const currentScore = current ? Number(current.item.confidence || 0)
          + (current.item.approved ? 25 : 0)
          + (!reviewValueIsEmpty(current.item.value) ? 20 : 0)
          - (isSuspiciousReviewField(current.item) ? 35 : 0) : -1;
        if (!current || score >= currentScore) best.set(key, { item, index });
      });
      return [...best.values()].sort((a, b) => reviewFieldRank(a.item.label) - reviewFieldRank(b.item.label));
    }

    function reviewFieldCardHtml(item, index, priorityLabel = "") {
      const badge = confidenceBadge(item);
      const suspicious = isSuspiciousReviewField(item);
      const blankedGuess = shouldBlankUntrustedReviewValue(item);
      const proof = sourceProofStatus(item);
      const isRequired = String(priorityLabel || "").toLowerCase() === "required";
      const optionalMissing = !isRequired && reviewValueIsEmpty(item.value);
      const displayProof = !isRequired
        ? (proof.className === "green"
          ? proof
          : { text: "Optional", className: "gray", detail: "Optional field. Fill only if this contract has it." })
        : proof;
      const displayBadge = !isRequired
        ? (item.approved && !suspicious
          ? { text: "Saved", className: "green" }
          : { text: optionalMissing ? "Blank" : "Optional", className: "gray" })
        : badge;
      const requiredNeedsWork = isRequired && (!item.approved || suspicious || blankedGuess || proof.className !== "green");
      const cardNeedsAttention = isRequired && suspicious;
      const sourceSummary = optionalMissing
        ? ""
        : isRequired
          ? `${item.confidence ? `${item.confidence}% confidence. ` : ""}${escapeHtml(displayProof.detail)}`
          : (proof.className === "green" ? `${escapeHtml(displayProof.detail)}` : "");
      const baaResolved = item.systemResolved === "baa-no-financial-impact";
      return `
        <details class="extracted-card ${isRequired ? "required-card" : ""} ${requiredNeedsWork ? "required-open" : ""} ${item.approved && !suspicious ? "saved" : ""} ${item.aiDraft ? "ai-draft" : ""} ${cardNeedsAttention ? "needs-attention" : ""} ${baaResolved ? "baa-resolved-field" : ""}" id="review-field-${index}" data-review-label="${escapeHtml(reviewCanonicalLabel(item.label))}" ${requiredNeedsWork ? "open" : ""}>
          <summary class="extracted-top">
            <strong>${escapeHtml(reviewDisplayLabel(item.label))}</strong>
            <span class="source-proof-strip">
              ${priorityLabel ? `<span class="badge ${isRequired ? "blue" : "gray"}">${escapeHtml(priorityLabel)}</span>` : ""}
              ${item.aiDraft ? `<span class="badge amber">AI Draft</span>` : ""}
              <span class="badge ${displayProof.className}" title="${escapeHtml(displayProof.detail)}">${escapeHtml(displayProof.text)}</span>
              <span class="badge ${displayBadge.className}">${displayBadge.text}</span>
            </span>
          </summary>
          <div class="review-field-body" onclick="if(!event.target.closest('button,a,input,select,textarea,summary,details')) showReviewFieldSource(${index})">
            ${baaResolved ? `<input value="${escapeHtml(item.value)}" disabled aria-label="${escapeHtml(reviewDisplayLabel(item.label))}" /><div class="baa-auto-note">Completed automatically for BAA. No money changes hands.</div>` : fieldInputHtml(item, index)}
            ${sourceSummary ? `<div class="source review-field-source-summary">${blankedGuess ? "<strong>Needs review.</strong> " : suspicious ? "<strong>Check value.</strong> " : ""}${sourceSummary}</div>` : ""}
            <div class="table-actions">
            ${baaResolved ? `<span class="badge gray">Not applicable</span>` : `
            <button class="btn ${item.approved ? "primary" : "ghost"}" title="Save this field value to the contract record now." onclick="saveReviewFieldInline(${index})">${item.approved ? "Saved" : "Save Field"}</button>
            <button class="btn ghost" title="Open source, OCR search, and PDF side-by-side." onclick="showReviewFieldSource(${index})">Source</button>
            <button class="btn danger" title="Remove this field from this contract review because it does not belong here." onclick="deleteReviewField(${index})">Delete</button>
            <details class="inline-more">
              <summary class="btn ghost">More</summary>
              <div class="more-menu">
                <button class="btn ghost" title="Show the OCR/source wording behind this field." onclick="showReviewFieldSource(${index})">Show Source</button>
                <button class="btn ghost" title="Find likely source wording for this field in the contract text." onclick="openReviewCorrectionModal(${index})">Source Clues</button>
                <button class="btn ghost" title="Use only after you checked this value in the actual PDF, Word, or source contract." onclick="markReviewFieldPdfVerified(${index})">Source Verified</button>
                <button class="btn danger" title="Keep this field, but erase the wrong value so you can enter the right one." onclick="clearReviewField(${index})">Blank Value</button>
              </div>
            </details>
            `}
            </div>
          </div>
        </details>
      `;
    }

    function sourceProofStatus(field = {}) {
      const source = String(field.source || "");
      const value = String(field.value || "").trim();
      if (!value || reviewValueIsEmpty(value)) {
        return { text: "Needs answer", className: "red", detail: "No contract value is saved yet." };
      }
      if (/source verified|pdf verified|verified against source|verified by reviewer|manually verified against the current source/i.test(source)) {
        return { text: "Verified", className: "green", detail: "Reviewer checked the original source contract." };
      }
      if (/verified against current contract ocr/i.test(source) || sourceCheckSnippets(field, value).exact.length) {
        return { text: "OCR proven", className: "green", detail: "The saved value is found in this contract OCR text." };
      }
      if (/learned|suggested|master|hint/i.test(source)) {
        return { text: "Needs proof", className: "amber", detail: "This is a hint. Verify it against this contract before final submit." };
      }
      if (field.approved) {
        return { text: "Saved - verify", className: "amber", detail: "Saved, but still needs OCR proof or Source Verified before final approval." };
      }
      return { text: "Needs proof", className: "amber", detail: "Check the current OCR text or verify against the PDF/Word file." };
    }

    function sourceProofStatusForContract(field = {}, contract = {}) {
      const source = String(field.source || "");
      const value = String(field.value || "").trim();
      if (!value || reviewValueIsEmpty(value)) {
        return { text: "Needs answer", className: "red", detail: "No contract value is saved yet." };
      }
      if (/source verified|pdf verified|verified against source|verified by reviewer|manually verified against the current source/i.test(source)) {
        return { text: "Verified", className: "green", detail: "Reviewer checked the original source contract." };
      }
      const text = contract?.ocrText || contract?.fullText || contract?.sourceText || contract?.ocrTextPreview || "";
      const exact = value && text ? searchOcrText(text, value, 3) : [];
      if (/verified against current contract ocr/i.test(source) || exact.length) {
        return { text: "OCR proven", className: "green", detail: "The saved value is found in this contract OCR text." };
      }
      if (/learned|suggested|master|hint/i.test(source)) {
        return { text: "Needs proof", className: "amber", detail: "This is a hint. Verify it against this contract before final approval." };
      }
      if (field.approved) {
        return { text: "Saved - verify", className: "amber", detail: "Saved, but still needs OCR proof or Source Verified before final approval." };
      }
      return { text: "Needs proof", className: "amber", detail: "Check the OCR text or verify against the PDF/Word file." };
    }

    function confidenceBadge(field) {
      if (field.approved) return { text: "Complete", className: "green" };
      if (/learned from approved correction/i.test(String(field?.source || ""))) return { text: "Verify source", className: "amber" };
      if (/suggested from prior correction/i.test(String(field?.source || ""))) return { text: "Suggestion", className: "amber" };
      if (isSuspiciousReviewField(field)) return { text: reviewValueIsEmpty(field.value) ? "Missing" : "Check this", className: reviewValueIsEmpty(field.value) ? "red" : "amber" };
      const score = Number(field.confidence || 0);
      if (score >= 85) return { text: "Looks right", className: "green" };
      if (score >= 65) return { text: "Check this", className: "amber" };
      return { text: "Low confidence", className: "red" };
    }

    function reviewFieldValue(fields, label, fallback = "") {
      const labels = Array.isArray(label) ? label : [label];
      return fields.find(field => reviewFieldMatches(field, labels))?.value || fallback;
    }

    function reviewSnapshotValue(selected, fields, label, contractKey, fallback = "Needs Review") {
      const value = reviewFieldValue(fields, label, selected?.[contractKey] || fallback);
      const labels = Array.isArray(label) ? label : [label];
      if (labels.some(item => ["Vendor"].includes(item)) && isBadVendorReviewValue(value)) {
        return fallback || "Needs Review";
      }
      if (labels.some(item => ["Category", "Contract Type", "Agreement Type"].includes(item))) {
        return fuzzyCategoryMatch(value)?.value || value;
      }
      return value;
    }

    function reviewComparableContract(selected = {}, fields = []) {
      const category = reviewSnapshotValue(selected, fields, "Category", "category", "")
        || reviewSnapshotValue(selected, fields, ["Contract Type", "Agreement Type"], "agreementType", "");
      const fee = reviewSnapshotValue(selected, fields, "Fee", "fee", "");
      const rate = reviewSnapshotValue(selected, fields, "Rate / Fee", "rate", fee);
      const monthlyCost = reviewSnapshotValue(selected, fields, "Monthly Cost", "monthlyCost", "");
      const costBedMonth = reviewSnapshotValue(selected, fields, "Cost Bed/Month", "costBedMonth", "");
      return {
        ...(selected || {}),
        id: selected?.id || activeReviewContractId,
        name: selected?.name || activeReviewContractName,
        vendor: reviewSnapshotValue(selected, fields, "Vendor", "vendor", selected?.vendor || ""),
        facility: reviewSnapshotValue(selected, fields, "Facility", "facility", selected?.facility || ""),
        category,
        services: reviewSnapshotValue(selected, fields, "Services", "services", selected?.services || category),
        fee,
        rate,
        monthlyCost,
        costBedMonth,
        spend: reviewSnapshotValue(selected, fields, "Contract Value", "spend", selected?.spend || "")
      };
    }

    function contractBenchmarkComparison(selected = {}, fields = []) {
      const candidate = reviewComparableContract(selected, fields);
      const categoryKey = masterKey(candidate.category || candidate.services);
      const candidateAnnual = annualizedContractSpend(candidate);
      const candidateBeds = facilityBedsForContract(candidate);
      const candidateMonthly = monthlyContractSpend(candidate);
      const candidateBedMonth = candidateBeds && candidateMonthly ? candidateMonthly / candidateBeds : 0;
      const peerRows = financialRowsForContracts(contracts)
        .filter(row => row.contract.id !== candidate.id)
        .filter(row => masterKey(row.category) === categoryKey)
        .filter(row => row.annual || row.costBedMonth);
      const metric = candidateBedMonth && peerRows.filter(row => row.costBedMonth).length >= 2 ? "cost per bed/month" : "annualized spend";
      const peerValues = peerRows
        .map(row => metric === "cost per bed/month" ? row.costBedMonth : row.annual)
        .filter(Boolean);
      const candidateValue = metric === "cost per bed/month" ? candidateBedMonth : candidateAnnual;
      if (!categoryKey) return { status: "needs-category", tone: "amber", requiresJustification: false, message: "Pick a service/category before benchmarking.", peerCount: 0, candidate, metric };
      if (!candidateValue) return { status: "needs-money", tone: "amber", requiresJustification: false, message: "Enter fee, rate, monthly cost, or annual spend before benchmarking.", peerCount: peerValues.length, candidate, metric };
      if (peerValues.length < 2) return { status: "not-enough-peers", tone: "gray", requiresJustification: false, message: `Not enough ${candidate.category || "same-type"} contracts to compare yet.`, peerCount: peerValues.length, candidate, metric, candidateValue };
      const average = peerValues.reduce((sum, value) => sum + value, 0) / peerValues.length;
      const min = Math.min(...peerValues);
      const max = Math.max(...peerValues);
      const percent = average ? ((candidateValue - average) / average) * 100 : 0;
      const significant = Math.abs(percent) >= 15;
      return {
        status: significant ? (percent > 0 ? "higher" : "lower") : "in-range",
        tone: significant ? (percent > 0 ? "red" : "blue") : "green",
        requiresJustification: significant,
        message: significant
          ? `${percent > 0 ? "Higher" : "Lower"} than similar ${candidate.category || "service"} contracts by ${Math.abs(percent).toFixed(0)}%. Add a reason before approving.`
          : `In normal range for similar ${candidate.category || "service"} contracts.`,
        peerCount: peerValues.length,
        average,
        min,
        max,
        percent,
        candidate,
        candidateValue,
        metric
      };
    }

    function reviewBenchmarkHtml(comparison) {
      const value = comparison.candidateValue ? reportMoney(comparison.candidateValue) : "Needs money";
      const average = comparison.average ? reportMoney(comparison.average) : "Needs peers";
      return `
        <div class="metric-row clickable-row" onclick="openReport('contract-approval-justifications')">
          <div><strong>Financial Benchmark</strong><span>${escapeHtml(comparison.message)} Current ${escapeHtml(comparison.metric || "spend")}: ${escapeHtml(value)} | Peer average: ${escapeHtml(average)} | Peers: ${comparison.peerCount || 0}</span></div>
          <span class="badge ${comparison.tone || "gray"}">${comparison.requiresJustification ? "Reason required" : "Benchmark"}</span>
        </div>
      `;
    }

    function reviewBenchmarkApprovalHtml(comparison) {
      const currentValue = reviewApprovalJustification || selectedReviewContract()?.approvalJustification || "";
      return `
        <div class="metric-row" style="align-items:stretch">
          <div style="width:100%">
            <strong>${comparison.requiresJustification ? "Approval Justification Required" : "Approval Justification"}</strong>
            <span>${escapeHtml(comparison.message)} This note is saved on the contract and appears in finance reports.</span>
            <textarea id="reviewApprovalJustification" rows="3" oninput="reviewApprovalJustification = this.value" placeholder="Example: Chosen vendor is higher because they cover emergency response, multiple facilities, special equipment, or better terms." style="margin-top:10px;width:100%;border:1px solid var(--line);border-radius:10px;padding:10px;font:inherit">${escapeHtml(currentValue)}</textarea>
          </div>
          <span class="badge ${comparison.requiresJustification ? "red" : "gray"}">${comparison.requiresJustification ? "Required" : "Optional"}</span>
        </div>
      `;
    }

    function parseReviewDate(value) {
      const date = new Date(String(value || "").trim());
      return Number.isNaN(date.getTime()) ? null : date;
    }

    function calculatedLengthFromDates(startValue, endValue) {
      const start = parseReviewDate(startValue);
      const end = parseReviewDate(endValue);
      if (!start || !end || end <= start) return "";
      const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
      const months = Math.round(days / 30.4375);
      const years = months / 12;
      if (months >= 12 && Math.abs(Math.round(years) - years) < 0.15) {
        const roundedYears = Math.round(years);
        return `${roundedYears} year${roundedYears === 1 ? "" : "s"} calculated from dates`;
      }
      if (months >= 1) return `${months} month${months === 1 ? "" : "s"} calculated from dates`;
      return `${days} day${days === 1 ? "" : "s"} calculated from dates`;
    }

    function isAutoRenewing(value) {
      const text = String(value || "").trim().toLowerCase();
      if (!text || ["unknown", "needs review", "not found"].includes(text)) return false;
      if (/\b(no|none|not applicable|does not|will not)\b/.test(text)) return false;
      return /\b(yes|auto|automatic|renews|renewal)\b/.test(text);
    }

    function endDateDisplay(endDate, autoRenewal) {
      const cleanEndDate = String(endDate || "Needs Review").trim() || "Needs Review";
      if (isAutoRenewing(autoRenewal) && ["Needs Review", "Unknown", "Not found", "TBD"].includes(cleanEndDate)) {
        return "Auto-renews / no fixed end date";
      }
      return isAutoRenewing(autoRenewal) ? `${cleanEndDate} (auto-renews)` : cleanEndDate;
    }

    function initialTermEndDate(startDate, termLength) {
      const start = dashboardDateObject(startDate);
      const termText = String(termLength || "").toLowerCase();
      if (!start || !termText || reviewValueIsEmpty(termText)) return null;
      const numberWords = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
      const rawAmount = termText.match(/\b(\d{1,2})\b/)?.[1] || Object.entries(numberWords).find(([word]) => termText.includes(word))?.[1] || "";
      const amount = Number(rawAmount || 0);
      if (!amount) return null;
      const date = new Date(start.getTime());
      if (/\b(year|years|yr|yrs)\b/.test(termText)) date.setFullYear(date.getFullYear() + amount);
      else if (/\b(month|months|mo)\b/.test(termText)) date.setMonth(date.getMonth() + amount);
      else return null;
      return date;
    }

    function initialTermEndDisplay(startDate, termLength, autoRenewal) {
      const date = initialTermEndDate(startDate, termLength);
      if (!date) return "";
      const label = date.toLocaleDateString();
      return isAutoRenewing(autoRenewal) ? `Initial term ends ${label}; then auto-renews` : `Initial term ends ${label}`;
    }

    function renderReviewSnapshot(selected, fields) {
      const startDate = reviewSnapshotValue(selected, fields, "Start Date", "start");
      const startOfServices = reviewSnapshotValue(selected, fields, "Start of Services", "startOfServices", startDate);
      const endDate = reviewSnapshotValue(selected, fields, "End Date", "end");
      const autoRenewal = reviewSnapshotValue(selected, fields, "Auto Renewal", "autoRenewal", "Unknown");
      const endDateText = endDateDisplay(endDate, autoRenewal);
      const extractedTermLength = cleanTermDisplay(reviewSnapshotValue(selected, fields, "Initial Contract Length", "initialContractLength", ""));
      const termLength = extractedTermLength || calculatedLengthFromDates(startDate, endDate) || "Needs Review";
      const notice = reviewSnapshotValue(selected, fields, "Notice Period", "terminationClause", "Unknown");
      const spend = reviewSnapshotValue(selected, fields, "Rate / Fee", "spend", "TBD");
      const fee = reviewSnapshotValue(selected, fields, "Fee", "fee", spend);
      const paymentTerms = reviewSnapshotValue(selected, fields, "Payment Terms", "paymentTerms", "Needs Review");
      const facilityName = reviewSnapshotValue(selected, fields, "Facility", "facility", "Needs Review");
      const vendorName = reviewSnapshotValue(selected, fields, "Vendor", "vendor", "Needs Review");
      const serviceType = reviewSnapshotValue(selected, fields, ["Contract Type", "Agreement Type"], "agreementType", reviewSnapshotValue(selected, fields, "Category", "category", "Needs Review"));
      const pdfUrl = contractFileUrl(selected || {});
      const sourceKind = contractSourceKind(selected);
      const sourceTypeLabel = sourceKindLabel(sourceKind);
      const openSourceLabel = sourceOpenLabel(sourceKind);
      const shareSyncPath = selected?.shareSyncLocalPath || selected?.localFilePath || selected?.shareSyncUrl || "";
      const sourceLabel = shareSyncPath
        ? queuePathName(shareSyncPath) || shareSyncPath
        : "No ShareSync source file linked yet";
      return `
        <div class="review-summary-clean">
          <button class="review-summary-row" type="button" onclick="openReviewSummaryField('Vendor', 'vendor company provider supplier contractor dba business associate')">
            <span>Vendor</span>
            <strong>${escapeHtml(vendorName)}</strong>
          </button>
          <button class="review-summary-row" type="button" onclick="openReviewSummaryField('Facility', 'facility center location customer client nursing rehabilitation address')">
            <span>Facility</span>
            <strong>${escapeHtml(facilityName)}</strong>
          </button>
          <button class="review-summary-row" type="button" onclick="openReviewSummaryField('Category', 'services scope agreement work provide service')">
            <span>Service</span>
            <strong>${escapeHtml(serviceType)}</strong>
          </button>
          <button class="review-summary-row" type="button" onclick="openReviewSummaryField('Rate / Fee', 'fee rate charge pricing schedule payment terms invoice payable net due')">
            <span>Cost</span>
            <strong>${escapeHtml(fee)}</strong>
          </button>
          <button class="review-summary-row wide" type="button" onclick="openReviewSummaryField('Initial Contract Length', 'initial term agreement shall commence year month effective date service start')">
            <span>Dates</span>
            <strong>Effective ${escapeHtml(startOfServices || startDate || "Needs review")} | End ${escapeHtml(endDateText)} | Term ${escapeHtml(termLength)}</strong>
          </button>
          <button class="review-summary-row wide" type="button" onclick="openReviewSummaryField('Auto Renewal', 'automatic renewal renews renewal term successive additional unless termination notice')">
            <span>Exit</span>
            <strong>${escapeHtml(isAutoRenewing(autoRenewal) ? "Auto-renews" : autoRenewal || "Needs review")} | Notice ${escapeHtml(notice)}</strong>
          </button>
          <div class="review-source-line">
            <div>
              <span>Source ${escapeHtml(sourceTypeLabel)}</span>
              <strong>${escapeHtml(sourceLabel)}</strong>
            </div>
            <div class="button-row">
              ${pdfUrl ? `<a class="btn ghost" href="${escapeHtml(pdfUrl)}" target="_blank" rel="noopener">${escapeHtml(openSourceLabel)}</a>` : `<span class="badge amber">Needs path</span>`}
              ${selected?.id ? `<button class="btn ghost" type="button" onclick="openContractSafe('${jsArg(selected.id)}', '${jsArg(selected.name || selected.vendor || "")}')">Open Contract</button>` : ""}
            </div>
          </div>
        </div>
      `;
    }

    function selectedReviewContract() {
      return contractData.find(contract => contract.id === activeReviewContractId)
        || contracts.find(contract => contract.id === activeReviewContractId)
        || null;
    }

    function selectedReviewSourceRecord() {
      const contract = selectedReviewContract() || {};
      const job = ocrJobs.find(item => item.id === activeReviewJobId || item.contractId === activeReviewContractId) || {};
      return {
        ...contract,
        id: contract.id || job.contractId || activeReviewContractId || "",
        localFilePath: contract.localFilePath || job.localFilePath || job.shareSyncLocalPath || "",
        shareSyncLocalPath: contract.shareSyncLocalPath || job.shareSyncLocalPath || job.localFilePath || "",
        uploadedFileName: contract.uploadedFileName || job.uploadedFileName || job.fileName || job.name || "",
        shareSyncUrl: contract.shareSyncUrl || job.shareSyncUrl || "",
        url: contract.url || job.url || ""
      };
    }

    function contractForJob(job) {
      return contractData.find(contract => contract.id === job.contractId)
        || contracts.find(contract => contract.id === job.contractId)
        || {};
    }

    function isReviewSubmittedStatus(status) {
      return /\b(approved|submitted|terminated|archived|replaced|ai reviewed)\b/i.test(String(status || ""));
    }

    function visibleReviewJobs(excludeContractId = "") {
      return ocrJobs.filter(job => {
        if (excludeContractId && (job.contractId === excludeContractId || job.contract_id === excludeContractId)) return false;
        const contract = contractForJob(job);
        const combinedStatus = `${contract.status || ""} ${contract.reviewStatus || ""} ${job.reviewStatus || ""}`;
        return !isReviewSubmittedStatus(combinedStatus);
      });
    }

    function nextReviewJob(excludeContractId = "") {
      const waiting = reviewQueueItems(excludeContractId);
      return waiting.find(job => job.status === "Complete")
        || waiting.find(job => job.status === "Queued" || job.status === "Processing")
        || waiting[0]
        || null;
    }

    function reviewQueueItems(excludeContractId = "") {
      const jobs = visibleReviewJobs(excludeContractId);
      if (jobs.length) return jobs;
      return contractData
        .filter(contract => {
          if (excludeContractId && contract.id === excludeContractId) return false;
          const combinedStatus = `${contract.status || ""} ${contract.reviewStatus || ""}`;
          return !isReviewSubmittedStatus(combinedStatus)
            && (
              contract.status === "Needs Review"
              || /pending|needs|ocr complete|parent match|linked to parent/i.test(contract.reviewStatus || "")
              || (contract.extractedFields || []).length
            );
        })
        .map(contract => ({
          id: contract.ocrJobId || `JOB-${contract.id}`,
          contractId: contract.id,
          status: (contract.extractedFields || []).length ? "Complete" : "Needs Review",
          reviewStatus: contract.reviewStatus || contract.status,
          documentType: contract.documentType || "Contract",
          extractedFields: contract.extractedFields || [],
          extractedFeeLines: contract.extractedFeeLines || [],
          extractedText: contract.ocrText || contract.fullText || contract.sourceText || "",
          extractedTextPreview: contract.ocrTextPreview || "",
          source: contract.source || "Contract record",
          localFilePath: contract.localFilePath || "",
          shareSyncUrl: contract.shareSyncUrl || "",
          createdAt: contract.createdAt,
          updatedAt: contract.updatedAt
        }));
    }

    function reviewFieldFromJob(job, label) {
      const labels = Array.isArray(label) ? label : [label];
      const fields = job.extractedFields || contractForJob(job).extractedFields || [];
      return fields.find(field => reviewFieldMatches(field, labels))?.value || "";
    }

    function reviewMissingItems(job) {
      const contract = contractForJob(job);
      const fields = job.extractedFields || contract.extractedFields || [];
      const missing = [];
      [
        ["Vendor", ["Vendor"], contract.vendor],
        ["Facility", ["Facility"], contract.facility],
        ["Service type", ["Category", "Contract Type"], contract.category],
        ["Start of services", ["Start of Services", "Start Date"], contract.startOfServices || contract.start],
        ["Contract term", ["Initial Contract Length", "Contract Length"], contract.initialContractLength],
        ["Payment terms", ["Payment Terms"], contract.paymentTerms],
        ["Fee / rate", ["Fee", "Rate / Fee", "Contract Value"], contract.fee || contract.rate || contract.spend],
        ["Auto-renewal", ["Auto Renewal"], contract.autoRenewal],
        ["Termination", ["Termination", "Notice Period"], contract.termination || contract.terminationClause]
      ].forEach(([label, aliases, fallback]) => {
        const field = fields.find(item => reviewFieldMatches(item, aliases));
        const value = field?.value || fallback || "";
        if (reviewValueIsEmpty(value) || (field && isSuspiciousReviewField(field))) missing.push(label);
      });
      return missing;
    }

    function autoRenewalForJob(job) {
      const contract = contractForJob(job);
      return reviewFieldFromJob(job, "Auto Renewal") || contract.autoRenewal || "Unknown";
    }

    function reviewNextStep(job) {
      if (job.status === "Queued") return "Read Source";
      if (job.status === "Processing") return job.progress?.message || "OCR is reading the contract";
      if (job.status === "Failed") return "Fix OCR issue or delete and upload again";
      if (job.status === "Complete") return reviewMissingItems(job).length ? "Review fields" : "Approve";
      return "Review status";
    }

    function renderReviewQueue() {
      const reviewPageItems = () => Array.isArray(reviewSummaryData?.records)
        ? reviewSummaryData.records.map(contract => ({
            id: contract.ocrJobId || `JOB-${contract.id}`,
            contractId: contract.id,
            status: "Complete",
            reviewStatus: contract.reviewStatus || contract.status || "Needs Review",
            documentType: contract.documentType || "Contract",
            extractedFields: contract.extractedFields || [],
            createdAt: contract.createdAt,
            updatedAt: contract.updatedAt
          }))
        : reviewQueueItems();
      const rendered = window.CONTRACT_APP_QUEUES_PAGE?.renderReviewQueuePage({
        activeReviewJobId,
        autoRenewalForJob,
        badgeClass,
        cleanQueueMoney,
        cleanQueueNotice,
        cleanQueueServiceType,
        cleanQueueText,
        contractForJob,
        endDateDisplay,
        escapeHtml,
        jsArg,
        queueContractTitle,
        queuePathName,
        reviewFieldFromJob,
        reviewMissingItems,
        reviewNextStep,
        reviewQueueItems: reviewPageItems,
        reviewQueuePage: Number(reviewSummaryData?.page || reviewQueuePage || 1),
        reviewQueuePageSize: Number(reviewSummaryData?.pageSize || reviewQueuePageSize),
        reviewQueueTotal: Number(reviewSummaryData?.totalWaiting || reviewPageItems().length),
        reviewQueueTotalPages: Number(reviewSummaryData?.totalPages || 1)
      });
      const queue = document.getElementById("ocrJobRows");
      if (!rendered && queue && !queue.children.length && !reviewQueueRefreshPending) {
        refreshReviewQueueDirect();
      }
      return rendered;
    }

    async function loadReviewQueuePage(page = 1) {
      if (!requireBackend("Loading Review Queue")) return;
      const safePage = Math.max(1, Number(page) || 1);
      try {
        reviewSummaryData = await apiJson(`/api/review-summary?page=${safePage}&pageSize=${reviewQueuePageSize}&fresh=1`);
        reviewQueuePage = Number(reviewSummaryData?.page || safePage);
        if (Array.isArray(reviewSummaryData?.records)) mergeLiveContracts(reviewSummaryData.records, contractsTotalCount);
        renderReviewQueue();
        document.getElementById("reviewQueueCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (error) {
        showToast(error.message || "Could not load the next Review Queue page.");
      }
    }

    function ocrJobStatusGroup(job = {}) {
      const status = String(`${job.status || ""} ${job.progress?.status || ""} ${job.progress?.message || ""}`).toLowerCase();
      if (/fail|error|blocked|invalid|cannot|denied/.test(status)) return "failed";
      if (/complete|ready|finished|done/.test(status)) return "completed";
      if (/process|reading|running|ocr|extract|render/.test(status)) return "reading";
      return "waiting";
    }

    function ocrJobContractName(job = {}) {
      const contract = contractForJob(job);
      return contract.name
        || job.name
        || job.contractName
        || job.uploadedFileName
        || job.fileName
        || queuePathName(job.localFilePath || job.shareSyncLocalPath || job.shareSyncUrl)
        || job.contractId
        || job.id
        || "OCR job";
    }

    function ocrJobUploadedBy(job = {}) {
      return job.uploadedBy || job.createdBy || job.owner || job.user || "Local user";
    }

    function ocrJobPageCount(job = {}) {
      return job.pages || job.pageCount || job.progress?.pages || job.progress?.totalPages || job.extractedPages || "Unknown";
    }

    function ocrJobStartedAt(job = {}) {
      return job.startedAt || job.progress?.startedAt || job.runStartedAt || job.createdAt || "";
    }

    function ocrJobFinishedAt(job = {}) {
      return job.finishedAt || job.completedAt || job.progress?.finishedAt || job.progress?.completedAt || job.updatedAt || "";
    }

    function renderOcrQueue() {
      return window.CONTRACT_APP_QUEUES_PAGE?.renderOcrQueuePage({
        cleanQueueText,
        contractForJob,
        escapeHtml,
        jsArg,
        ocrJobContractName,
        ocrJobFinishedAt,
        ocrJobPageCount,
        ocrJobStartedAt,
        ocrJobStatusGroup,
        ocrJobUploadedBy,
        ocrJobs,
        ocrQueuePage,
        ocrQueuePageSize,
        ocrQueueTotal,
        queuePathName,
        shortDateTime
      });
    }

    async function loadOcrQueuePage(page = 1) {
      try {
        const safePage = Math.max(1, Number(page) || 1);
        const result = await apiJson(`/api/ocr-jobs?page=${safePage}&pageSize=${ocrQueuePageSize}&lean=1`);
        ocrJobs = Array.isArray(result) ? result : (Array.isArray(result?.records) ? result.records : []);
        if (result && !Array.isArray(result)) {
          ocrQueuePage = result.page || safePage;
          ocrQueuePageSize = result.pageSize || ocrQueuePageSize;
          ocrQueueTotal = result.total || ocrJobs.length;
        }
        renderOcrQueue();
      } catch (error) {
        showToast("Could not load OCR Queue page. Check the server window.");
      }
    }

    async function refreshOcrQueue() {
      try {
        await loadOcrQueuePage(ocrQueuePage || 1);
        renderOcrQueue();
        renderReviewQueue();
        showToast("OCR Queue refreshed.");
      } catch (error) {
        showToast("Could not refresh OCR Queue. Check the server window.");
      }
    }

    async function refreshReviewQueueDirect() {
      const queue = document.getElementById("ocrJobRows");
      if (!queue) return;
      queue.innerHTML = `<div class="metric-row"><div><strong>Refreshing Review Queue...</strong><span>Checking saved contracts and OCR jobs.</span></div><span class="badge blue">Refresh</span></div>`;
      reviewQueueRefreshPending = true;
      try {
        const [contractResult, jobs] = await Promise.all([
          apiJson("/api/contracts?page=1&pageSize=60&compact=1"),
          apiJson(`/api/ocr-jobs?page=1&pageSize=${MAX_TABLE_RENDER_ROWS}&lean=1`)
        ]);
        mergeLiveContracts(contractResult.records || [], contractResult.total);
        ocrJobs = Array.isArray(jobs) ? jobs : [];
        renderOcrQueue();
        renderReviewQueue();
        if (!queue.querySelector(".review-queue-item") && ocrJobs.length) {
          queue.innerHTML = ocrJobs
            .filter(job => {
              const contract = contractForJob(job);
              return !isReviewSubmittedStatus(`${contract.status || ""} ${contract.reviewStatus || ""} ${job.reviewStatus || ""}`);
            })
            .map(job => {
              const contract = contractForJob(job);
              const title = queueContractTitle(job, contract);
              const vendor = cleanQueueText(reviewFieldFromJob(job, "Vendor") || contract.vendor, "Vendor not confirmed", 54);
              const facility = cleanQueueText(reviewFieldFromJob(job, "Facility") || contract.facility, "Facility not confirmed", 46);
              const category = cleanQueueServiceType(reviewFieldFromJob(job, ["Category", "Contract Type"]) || contract.category);
              const missing = reviewMissingItems(job);
              return `
                <article class="review-queue-item ${job.id === activeReviewJobId ? "selected-review-row" : ""}">
                  <div class="review-queue-primary"><span class="review-queue-label">Contract / Vendor</span><strong class="review-contract-name">${escapeHtml(title)}</strong><div class="review-subline"><span class="badge blue">Contract</span><span class="badge ${badgeClass(job.status)}">${escapeHtml(job.status === "Complete" ? "Ready" : job.status || "Waiting")}</span></div><span class="review-vendor-line">${escapeHtml(vendor)}</span></div>
                  <div class="review-queue-meta"><span class="review-queue-label">Facility / Type</span><div class="review-meta-card"><strong>${escapeHtml(facility)}</strong><span class="badge blue">${escapeHtml(category)}</span></div></div>
                  <div class="review-queue-terms"><span class="review-queue-label">Status</span><div class="review-known"><span style="color:var(--blue);font-size:12px;font-weight:800">${escapeHtml(job.progress?.message || "Ready for review")}</span></div></div>
                  <div class="review-queue-checks"><span class="review-queue-label">Needs Check</span><div class="review-badge-stack">${missing.length ? missing.map(item => `<span class="badge amber review-check-chip">${escapeHtml(item)}</span>`).join("") : `<span class="badge green">Core fields found</span>`}</div></div>
                  <div class="review-queue-action-col"><span class="review-queue-label">Actions</span><div class="review-queue-actions"><button class="btn primary" data-open-review-job="${escapeHtml(job.id)}">Review</button>${job.contractId ? `<button class="btn ghost" onclick="openContractSafe('${jsArg(job.contractId)}', '${jsArg(job.name || job.contract || job.vendor || "")}')">Card</button>` : ""}</div></div>
                </article>
              `;
            }).join("") || `<div class="metric-row"><div><strong>No contracts are waiting for review.</strong><span>Upload or import contracts to start.</span></div><span class="badge green">Clear</span></div>`;
        }
      } catch (error) {
        queue.innerHTML = `<div class="metric-row"><div><strong>Could not refresh Review Queue.</strong><span>Check the server window, then refresh the page.</span></div><span class="badge red">Error</span></div>`;
      } finally {
        reviewQueueRefreshPending = false;
      }
    }

    function vendorForContract(contract) {
      const vendorName = contract?.vendor || reviewFieldValue(contract?.extractedFields || [], "Vendor", "");
      const savedVendor = vendorsData.find(v => sameVendorName(v.name, vendorName));
      return {
        name: vendorName || savedVendor?.name || "Vendor not confirmed",
        legalName: savedVendor?.legalName || vendorName || "Needs review",
        primaryContact: savedVendor?.primaryContact || contract?.vendorContact || "",
        phone: savedVendor?.phone || contract?.vendorPhone || "",
        email: savedVendor?.email || contract?.vendorEmail || "",
        mailingAddress: savedVendor?.mailingAddress || contract?.vendorMailingAddress || contract?.vendorAddress || "",
        remitAddress: savedVendor?.remitAddress || "",
        paymentTerms: savedVendor?.paymentTerms || contract?.paymentTerms || "",
        insurance: savedVendor?.insuranceStatus || savedVendor?.insurance || contract?.insuranceStatus || "",
        issues: savedVendor?.issues || "",
        hasProfile: Boolean(savedVendor)
      };
    }

    function savedContractFieldValue(contract = {}, labels = [], keys = []) {
      const fieldValue = reviewFieldValue(contract.extractedFields || [], labels, "");
      const keyedValue = keys.map(key => contract?.[key]).find(contractHasUsableValue) || "";
      return fieldValue || keyedValue || "";
    }

    function mostCommonValues(values = [], limit = 2) {
      const counts = new Map();
      values
        .map(value => cleanQueueText(value, "", 90))
        .filter(contractHasUsableValue)
        .forEach(value => {
          const key = value.toLowerCase();
          const current = counts.get(key) || { value, count: 0 };
          current.count += 1;
          counts.set(key, current);
        });
      return [...counts.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, limit);
    }

    function reviewLearningHintsHtml(selected = {}, fields = []) {
      const vendor = reviewSnapshotValue(selected, fields, "Vendor", "vendor", "");
      const category = reviewSnapshotValue(selected, fields, "Category", "category", "")
        || reviewSnapshotValue(selected, fields, ["Contract Type", "Agreement Type"], "agreementType", "");
      const currentId = selected?.id || activeReviewContractId;
      const peerBase = contractData.filter(contract => contract.id !== currentId);
      const sameVendor = vendor ? peerBase.filter(contract => sameVendorName(contract.vendor, vendor)) : [];
      const sameCategory = category ? peerBase.filter(contract => fuzzyCategoryMatch(contract.category || contract.agreementType || contract.services || "")?.value === fuzzyCategoryMatch(category)?.value) : [];
      const vendorPayments = mostCommonValues(sameVendor.map(contract => savedContractFieldValue(contract, ["Payment Terms"], ["paymentTerms"])));
      const vendorNotices = mostCommonValues(sameVendor.map(contract => savedContractFieldValue(contract, ["Notice Period", "Termination"], ["terminationClause", "noticePeriod", "termination"])));
      const categoryPayments = mostCommonValues(sameCategory.map(contract => savedContractFieldValue(contract, ["Payment Terms"], ["paymentTerms"])));
      const categoryNotices = mostCommonValues(sameCategory.map(contract => savedContractFieldValue(contract, ["Notice Period", "Termination"], ["terminationClause", "noticePeriod", "termination"])));
      const vendorHint = [vendorPayments[0] ? `Payment often ${vendorPayments[0].value}` : "", vendorNotices[0] ? `Notice often ${vendorNotices[0].value}` : ""].filter(Boolean).join(" | ");
      const categoryHint = [categoryPayments[0] ? `Payment often ${categoryPayments[0].value}` : "", categoryNotices[0] ? `Notice often ${categoryNotices[0].value}` : ""].filter(Boolean).join(" | ");
      const rows = [];
      if (vendorHint) {
        rows.push(`<div class="metric-row clickable-row" onclick="runReviewOcrSearch('payment invoice payable net due termination notice written days')"><div><strong>Vendor hint</strong><span>${escapeHtml(vendorHint)} (${sameVendor.length} saved).</span></div><span class="badge amber">Verify</span></div>`);
      }
      if (categoryHint && categoryHint !== vendorHint) {
        rows.push(`<div class="metric-row clickable-row" onclick="runReviewOcrSearch('payment invoice payable net due termination notice written days')"><div><strong>Service hint</strong><span>${escapeHtml(categoryHint)} (${sameCategory.length} peers).</span></div><span class="badge blue">Verify</span></div>`);
      }
      return rows.join("");
    }

    function reviewContractText() {
      const selected = selectedReviewContract();
      const job = ocrJobs.find(item => item.id === activeReviewJobId || item.contractId === activeReviewContractId);
      return activeReviewOcrText || selected?.ocrText || job?.extractedText || selected?.ocrTextPreview || job?.extractedTextPreview || "";
    }

    function displayOcrText(value, limit = 20000) {
      const raw = String(value || "");
      return {
        text: raw.slice(0, limit),
        clipped: raw.length > limit,
        total: raw.length
      };
    }

    function normalizeOcrWhitespace(text) {
      return String(text || "").replace(/\s+/g, " ").trim();
    }

    function findOcrSnippets(patterns, text, limit = 4) {
      const clean = normalizeOcrWhitespace(text);
      if (!clean) return [];
      const snippets = [];
      const seen = new Set();
      for (const pattern of patterns) {
        const regex = new RegExp(pattern.source, pattern.flags?.includes("g") ? pattern.flags : `${pattern.flags || "i"}g`);
        let match;
        while ((match = regex.exec(clean)) && snippets.length < limit) {
          const start = Math.max(0, match.index - 130);
          const end = Math.min(clean.length, match.index + String(match[0]).length + 210);
          const snippet = clean.slice(start, end).trim();
          const key = snippet.toLowerCase().slice(0, 90);
          if (!seen.has(key)) {
            seen.add(key);
            snippets.push(snippet);
          }
          if (match.index === regex.lastIndex) regex.lastIndex += 1;
        }
        if (snippets.length >= limit) break;
      }
      return snippets;
    }

    function escapeRegex(value) {
      return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function meaningfulSearchWords(value = "", max = 14) {
      const stopWords = new Set(["the", "and", "for", "with", "this", "that", "shall", "will", "from", "into", "upon", "herein", "thereof", "agreement", "contract", "services", "service"]);
      return String(value || "")
        .toLowerCase()
        .replace(/[$,]/g, " ")
        .split(/\s+/)
        .map(word => word.replace(/^[^a-z0-9%]+|[^a-z0-9%]+$/gi, "").trim())
        .filter(word => word.length > 2 && word.length < 34 && !stopWords.has(word))
        .slice(0, max);
    }

    function smartSearchParts(query = "") {
      const raw = String(query || "").trim();
      const phrases = [];
      raw.split(/[|;]+/).map(part => part.trim()).filter(Boolean).forEach(part => {
        if (part.includes(" ")) phrases.push(part);
      });
      const quoted = raw.match(/"([^"]+)"/g) || [];
      quoted.forEach(item => phrases.push(item.replaceAll('"', "").trim()));
      const words = meaningfulSearchWords(raw, 28);
      return {
        phrases: [...new Set(phrases.filter(item => item.length > 4).slice(0, 16))],
        words: [...new Set(words)]
      };
    }

    function searchOcrText(text, query, limit = 8) {
      const clean = normalizeOcrWhitespace(text);
      const { phrases, words } = smartSearchParts(query);
      if (!clean || (!words.length && !phrases.length)) return [];
      const patterns = [
        ...phrases.map(phrase => new RegExp(escapeRegex(phrase).replace(/\s+/g, "\\s+"), "i")),
        ...words.map(word => new RegExp(escapeRegex(word), "i"))
      ];
      const snippets = [];
      const seen = new Set();
      for (const pattern of patterns) {
        for (const snippet of findOcrSnippets([pattern], clean, limit)) {
          const lower = snippet.toLowerCase();
          const score = words.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0)
            + phrases.reduce((sum, phrase) => sum + (lower.includes(phrase.toLowerCase()) ? 4 : 0), 0);
          const key = snippet.toLowerCase().slice(0, 100);
          if (!seen.has(key)) {
            seen.add(key);
            snippets.push({ snippet, score });
          }
        }
      }
      return snippets
        .sort((a, b) => b.score - a.score || b.snippet.length - a.snippet.length)
        .slice(0, limit)
        .map(item => item.snippet);
    }

    function searchExactOcrText(text, query, limit = 4) {
      const clean = normalizeOcrWhitespace(text);
      const value = normalizeOcrWhitespace(query);
      if (!clean || !value || value.length < 2) return [];
      const relaxed = escapeRegex(value).replace(/\s+/g, "\\s+");
      return findOcrSnippets([new RegExp(relaxed, "i")], clean, limit);
    }

    function sourceCheckSnippets(field = {}, typedValue = "") {
      const text = reviewContractText();
      const value = String(typedValue || field.value || "").trim();
      const canonical = reviewCanonicalLabel(field.label || "");
      const valueQueries = [value];
      const dateValue = dashboardDateObject(value);
      if (dateValue && /date|effective|start|signature|signed/i.test(canonical)) {
        const month = String(dateValue.getMonth() + 1);
        const day = String(dateValue.getDate());
        const year = String(dateValue.getFullYear());
        valueQueries.push(`${month}/${day}/${year}`, `${month}-${day}-${year}`, `${month}.${day}.${year}`);
        valueQueries.push(dateValue.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }));
      }
      const exactSnippets = value
        ? [...new Set(valueQueries.flatMap(query => searchExactOcrText(text, query, 4)))]
        : [];
      const similarQuery = similarSearchQueryForField({ ...field, value });
      const similarSnippets = similarQuery ? searchOcrText(text, similarQuery, 8) : [];
      const exactKeys = new Set(exactSnippets.map(snippet => snippet.toLowerCase().slice(0, 100)));
      return {
        exact: exactSnippets,
        similar: similarSnippets.filter(snippet => !exactKeys.has(snippet.toLowerCase().slice(0, 100))),
        value,
        similarQuery
      };
    }

    function checkReviewFieldAgainstSource(index) {
      if (!reviewFields.length && extracted[index]) reviewFields = [...extracted];
      const field = reviewFields[index];
      if (!field) return;
      const typedValue = reviewFieldInputValue(index) || field.value || "";
      const check = sourceCheckSnippets(field, typedValue);
      const exactFound = check.exact.length > 0;
      const similarFound = check.similar.length > 0;
      document.getElementById("modalTitle").textContent = `${reviewDisplayLabel(field.label)} Source Check`;
      document.getElementById("modalBody").innerHTML = `
        <div class="grid">
          <article class="card">
            <div class="panel-head">
              <h3>Typed Value</h3>
              <span class="badge ${exactFound ? "green" : similarFound ? "amber" : "red"}">${exactFound ? "Exact proof" : similarFound ? "Clues only" : "Not found"}</span>
            </div>
            <div class="panel-body metric-list">
              <div class="metric-row">
                <div><strong>${escapeHtml(check.value || "No value entered")}</strong><span>${exactFound ? "This exact value appears in the current contract OCR." : similarFound ? "Exact value was not found. These are only clues for review." : "This value was not found in the current contract OCR."}</span></div>
              </div>
              ${!exactFound ? `<div class="metric-row"><div><strong>Before saving</strong><span>If the exact value is visible in the source file but not OCR, mark it Source Verified after checking the document.</span></div><button class="btn ghost" onclick="markReviewFieldPdfVerified(${index})">Source Verified</button></div>` : ""}
            </div>
          </article>
          <article class="card">
            <div class="panel-head"><h3>Exact Matches</h3><span class="badge ${exactFound ? "green" : "gray"}">${exactFound ? check.exact.length : "None"}</span></div>
            <div class="panel-body metric-list">
              ${check.exact.length ? check.exact.map((snippet, matchIndex) => `
                <div class="metric-row"><div><strong>Exact match ${matchIndex + 1}</strong><span>${highlightSourceText(snippet, check.value, 720)}</span></div></div>
              `).join("") : `<div class="metric-row"><div><strong>No exact match</strong><span>The typed value was not found exactly in the OCR text.</span></div></div>`}
            </div>
          </article>
          <article class="card" style="grid-column:1/-1">
            <div class="panel-head"><h3>Source Clues</h3><span class="badge amber">Reviewer must choose</span></div>
            <div class="panel-body metric-list">
              ${check.similar.length ? check.similar.map((snippet, matchIndex) => `
                <div class="metric-row"><div><strong>Clue ${matchIndex + 1}</strong><span>${highlightSourceText(snippet, check.similarQuery, 760)}</span></div></div>
              `).join("") : `<div class="metric-row"><div><strong>No similar source found</strong><span>Open Full OCR or the source file if the field still needs manual proof.</span></div><button class="btn ghost" onclick="showFullOcrText()">Full OCR</button></div>`}
            </div>
          </article>
        </div>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    async function markReviewFieldPdfVerified(index) {
      if (!reviewFields.length && extracted[index]) reviewFields = [...extracted];
      const field = reviewFields[index];
      if (!field) return;
      const rawValue = reviewFieldInputValue(index) || field.value || "";
      const cleanValue = cleanReviewFieldValue(field.label, rawValue);
      if (!cleanValue) {
        showToast("Enter the value first, then mark it Source Verified.");
        return;
      }
      const verifiedField = {
        ...field,
        value: cleanValue,
        confidence: 100,
        approved: true,
        source: "Manually verified against the current source contract by reviewer."
      };
      applyReviewFieldToMatchingAliases(index, verifiedField);
      try {
        if (activeReviewContractId) {
          const result = await apiJson(`/api/review/${encodeURIComponent(activeReviewContractId)}/field`, {
            method: "POST",
            body: JSON.stringify({ field: verifiedField })
          });
          refreshReviewFieldsAfterFieldSave(result, verifiedField, index);
        }
        reviewSaveStatus = `${reviewDisplayLabel(field.label)} marked Source Verified. This can pass final submit even if OCR missed the exact text.`;
      } catch (error) {
        reviewSaveStatus = `${reviewDisplayLabel(field.label)} marked Source Verified on screen, but backend save failed. Try again before final submit.`;
      }
      document.getElementById("contractModal").classList.remove("open");
      renderReview();
      showToast("Field marked Source Verified.");
    }

    function sourceProofIssuesForFields(fields = []) {
      const keyLabels = coreReviewCanonicalLabels;
      const issues = [];
      const costField = (fields || []).find(field => reviewCanonicalLabel(field.label) === "cost")
        || (fields || []).find(field => ["rate / fee", "fee", "monthly cost", "contract value", "annual cost", "annual spend"].includes(reviewCanonicalLabel(field.label)));
      const feeLines = currentReviewFeeLinesFromInputs();
      const feeLineHasCost = feeLines.some(line => reviewCostValueIsUsable(line.rate, `${line.service || ""} ${line.source || ""}`));
      if (!reviewCostValueIsUsable(costField?.value, costField?.source) && !feeLineHasCost) {
        issues.push({
          label: "Cost",
          value: "Enter fee, rate, monthly/annual cost, fee schedule, or verified no-charge wording",
          index: costField ? reviewFields.findIndex(item => reviewCanonicalLabel(item.label) === reviewCanonicalLabel(costField.label)) : -1
        });
      }
      issues.push(...(fields || [])
        .filter(field => keyLabels.has(reviewCanonicalLabel(field.label)))
        .filter(field => !reviewValueIsEmpty(field.value))
        .filter(field => reviewCanonicalLabel(field.label) !== "cost")
        .filter(field => {
          const source = String(field.source || "");
          if (/verified against current contract ocr/i.test(source)) return false;
          if (/source verified|pdf verified|verified against source|verified by reviewer/i.test(source)) return false;
          if (field.approved && field.approvedAt && /reviewer|review queue|manual reviewer|manual correction/i.test(source)) return false;
          if (/manually verified against the current source (pdf\/contract|contract|file)/i.test(source)) return false;
          return !sourceCheckSnippets(field, field.value).exact.length;
        })
        .map(field => ({
          label: reviewDisplayLabel(field.label),
          value: field.value,
          index: reviewFields.findIndex(item => reviewCanonicalLabel(item.label) === reviewCanonicalLabel(field.label))
        })));
      return issues;
    }

    function showSubmitSourceIssues(issues = []) {
      const safeIssues = (issues || []).filter(Boolean);
      const firstIndex = safeIssues.find(issue => Number(issue.index) >= 0)?.index ?? -1;
      document.getElementById("modalTitle").textContent = "Finish Required Fields";
      document.getElementById("modalBody").innerHTML = `
        <article class="card">
          <div class="panel-head"><h3>Required Fields Need Proof</h3><span class="badge amber">${safeIssues.length} field${safeIssues.length === 1 ? "" : "s"}</span></div>
          <div class="panel-body metric-list">
            <div class="metric-row">
              <div><strong>Before approval</strong><span>Each required field needs a clear answer and proof from this contract. Use Source if OCR can find it, or Source Verified after checking the PDF/Word file.</span></div>
              <span class="badge amber">Action needed</span>
            </div>
            ${safeIssues.map(issue => `
              <div class="metric-row clickable-row" ${Number(issue.index) >= 0 ? `onclick="closeModal(); showReviewFieldSource(${Number(issue.index)})"` : ""}>
                <div><strong>${escapeHtml(issue.label || "Required field")}</strong><span>${escapeHtml(issue.value || "Needs value")}</span></div>
                <button class="btn ghost" type="button" ${Number(issue.index) >= 0 ? `onclick="event.stopPropagation(); closeModal(); showReviewFieldSource(${Number(issue.index)})"` : "disabled"}>Open</button>
              </div>
            `).join("")}
            <div class="table-actions">
              ${firstIndex >= 0 ? `<button class="btn primary" type="button" onclick="closeModal(); showReviewFieldSource(${firstIndex})">Open First Field</button>` : ""}
              <button class="btn ghost" type="button" onclick="closeModal()">Close</button>
            </div>
          </div>
        </article>
      `;
      document.getElementById("contractModal")?.classList.add("open");
      showToast("Required fields need source proof before final submit.");
    }

    function showReviewSaveProblem(error, fallbackTitle = "Needs Review") {
      const title = error?.message || fallbackTitle;
      const detail = error?.detail || "The app could not save this yet because one required answer is missing or not usable.";
      const nextStep = error?.nextStep || "Enter the correct value from the contract, then click Save Field again.";
      const fields = Array.isArray(error?.fields)
        ? error.fields.map(field => typeof field === "string" ? { label: field, value: "", reason: "Needs review" } : field)
        : [];
      document.getElementById("modalTitle").textContent = fallbackTitle;
      document.getElementById("modalBody").innerHTML = `
        <article class="card">
          <div class="panel-head"><h3>${escapeHtml(title)}</h3><span class="badge amber">Action needed</span></div>
          <div class="panel-body metric-list">
            <div class="metric-row"><div><strong>What happened</strong><span>${escapeHtml(detail)}</span></div></div>
            ${fields.length ? fields.map(field => `
              <div class="metric-row">
                <div><strong>${escapeHtml(field.label || "Field")}</strong><span>${escapeHtml(field.value || field.reason || "Needs answer")}</span></div>
                <span class="badge amber">${escapeHtml(field.reason || "Review")}</span>
              </div>
            `).join("") : ""}
            <div class="metric-row"><div><strong>Next step</strong><span>${escapeHtml(nextStep)}</span></div></div>
            <div class="table-actions"><button class="btn primary" type="button" onclick="closeModal()">Go Back</button></div>
          </div>
        </article>
      `;
      document.getElementById("contractModal")?.classList.add("open");
    }

    function keywordTermsForLabel(labelOrQuery = "") {
      const text = String(labelOrQuery || "").toLowerCase();
      const terms = new Set(String(labelOrQuery || "").split(/\s+/).filter(word => word.length > 2));
      const add = (...items) => items.forEach(item => terms.add(item));
      if (/start|effective|signature|commence|begin|dated/.test(text)) add("effective", "commence", "commencement", "start", "begin", "date", "dated", "made");
      if (/end|expiration|expire/.test(text)) add("end", "expiration", "expires", "through", "until", "ending", "no fixed end");
      if (/term|length/.test(text)) add("term", "initial", "year", "month", "agreement", "commence", "continue", "period");
      if (/renew/.test(text)) add("renew", "renewal", "automatically", "additional", "successive", "unless", "evergreen");
      if (/terminat|notice|exit|cancel/.test(text)) add("terminate", "termination", "notice", "written", "days", "cause", "cancel", "cancellation", "non-renewal", "without penalty");
      if (/payment|payable|invoice|net|billing/.test(text)) add("payment", "payable", "invoice", "net", "paid", "due", "days", "billing", "statement", "receipt");
      if (/fee|rate|cost|price|charge|compensation|spend/.test(text)) add("fee", "rate", "charge", "cost", "pricing", "schedule", "monthly", "annual", "compensation", "per", "billed");
      if (/insurance|liability/.test(text)) add("insurance", "liability", "insured", "coverage", "occurrence", "aggregate");
      if (/indemnif|hold harmless/.test(text)) add("indemnification", "indemnify", "indemnified", "hold", "harmless", "mutual", "each", "party");
      if (/vendor|contact|company|provider|contractor|supplier/.test(text)) add("vendor", "company", "provider", "contractor", "supplier", "consultant", "contact", "billing", "dba");
      if (/facility|client|customer|institution|location|site/.test(text)) add("facility", "client", "customer", "institution", "center", "location", "site", "operator");
      return [...terms].map(term => term.trim()).filter(term => term.length > 2);
    }

    function learnedSourceTermsForField(field = {}) {
      const label = reviewCanonicalLabel(field.label || "");
      const terms = [];
      (Array.isArray(learningRules) ? learningRules : []).forEach(rule => {
        if (reviewCanonicalLabel(rule?.label || "") !== label) return;
        terms.push(...meaningfulSearchWords(rule.value || "", 6));
        terms.push(...meaningfulSearchWords(rule.originalValue || "", 4));
        terms.push(...meaningfulSearchWords(rule.snippet || "", 8));
      });
      return [...new Set(terms)].slice(0, 18);
    }

    function similarSearchQueryForField(field = {}) {
      const label = reviewCanonicalLabel(field.label || "");
      const valueWords = meaningfulSearchWords(field.value || "", 8);
      const synonymMap = {
        "facility": ["facility", "client", "customer", "institution", "center", "location", "site", "resident care", "health care", "operator"],
        "vendor": ["vendor", "company", "contractor", "provider", "service provider", "consultant", "supplier", "dba", "by and between", "between"],
        "category": ["services", "scope", "agreement", "work", "provide", "service", "statement of work", "service type"],
        "contract type": ["services", "scope", "agreement", "work", "provider shall", "service agreement", "medical director", "transportation", "maintenance", "waste", "pharmacy"],
        "contract status": ["executed", "active", "agreement", "effective", "signed"],
        "start of services": ["effective date", "commence", "commencement", "start", "begin", "made as of", "services shall begin"],
        "effective date": ["effective date", "commencement date", "start date", "service date", "made as of", "dated", "beginning", "agreement shall commence"],
        "end date": ["end date", "expiration", "expires", "until", "through", "ending", "terminate on"],
        "cost": ["fee schedule", "rate schedule", "pricing", "monthly fee", "service fee", "charge", "charges", "cost", "rate", "compensation", "shall pay", "billed at", "per month", "per visit", "per mile", "per square foot", "per sq ft", "per room", "per bed", "per trip", "per pickup", "per load", "minimum"],
        "initial contract length": ["initial term", "term of this agreement", "agreement shall commence", "shall continue", "for a term", "one year", "twelve months"],
        "auto renewal": ["automatically renew", "auto-renew", "renewal term", "successive", "additional term", "unless terminated", "non-renewal"],
        "notice period": ["written notice", "prior notice", "advance notice", "days notice", "terminate", "termination", "non-renewal", "cancel", "cancellation", "without cause", "for cause"],
        "how to terminate": ["terminate", "termination", "cancel", "cancellation", "non-renewal", "written notice", "prior notice", "advance notice", "days notice", "without cause", "for cause", "cure period", "unless either party"],
        "payment terms": ["payment terms", "invoice", "payable", "net 30", "net thirty", "paid within", "due within", "billing"],
        "days payable": ["net", "days", "payable", "paid within", "due within", "invoice date", "receipt of invoice"],
        "rate / fee": ["fee schedule", "rate schedule", "pricing", "monthly fee", "service fee", "charge", "cost", "rate", "per month", "per visit", "per mile", "per square foot", "per sq ft", "per linear foot", "per room", "per bed", "per trip", "per load", "per box", "per container"],
        "monthly cost": ["monthly", "per month", "monthly fee", "monthly charge", "recurring", "rate"],
        "cost bed/month": ["per bed", "bed month", "beds", "monthly cost", "census"],
        "quantity of services": ["quantity", "number of services", "visits", "pickups", "deliverables", "scope of services"],
        "insurance requirement": ["insurance", "liability", "additional insured", "coverage", "occurrence", "aggregate", "certificate"],
        "indemnification": ["indemnification", "indemnify", "hold harmless", "mutual indemnification", "each party", "defend"]
      };
      const terms = [
        ...(synonymMap[label] || keywordTermsForLabel(field.label || "")),
        ...valueWords,
        ...learnedSourceTermsForField(field)
      ];
      return [...new Set(terms)].join(" ");
    }

    function highlightSourceText(value, labelOrQuery = "", limit = 320) {
      const clean = shortSourceText(value, limit);
      const terms = keywordTermsForLabel(labelOrQuery);
      if (!terms.length) return escapeHtml(clean);
      const pattern = new RegExp(`\\b(${terms.map(escapeRegex).join("|")})\\b`, "gi");
      return escapeHtml(clean).replace(pattern, "<mark>$1</mark>");
    }

    function highlightOcrReaderText(value, labelOrQuery = "", limit = 20000) {
      const raw = String(value || "");
      const clipped = raw.length > limit;
      const clean = raw.slice(0, limit).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const terms = keywordTermsForLabel(labelOrQuery).slice(0, 30);
      let html = escapeHtml(clean || "No OCR text is saved for this contract yet.");
      if (terms.length) {
        const pattern = new RegExp(`\\b(${terms.map(escapeRegex).join("|")})\\b`, "gi");
        html = html.replace(pattern, "<mark>$1</mark>");
      }
      return `${html}${clipped ? `\n\n[Showing first ${limit.toLocaleString()} characters. Open Full OCR for the complete contract text.]` : ""}`;
    }

    function runReviewOcrSearch(query = "") {
      const input = document.getElementById("reviewOcrSearchInput");
      const results = document.getElementById("reviewOcrSearchResults");
      const text = reviewContractText();
      const term = query || input?.value || "";
      if (input && query) input.value = query;
      if (!results) return;
      const snippets = searchOcrText(text, term, 8);
      results.innerHTML = snippets.length ? snippets.map((snippet, index) => `
        <div class="metric-row">
          <div><strong>Match ${index + 1}</strong><span>${highlightSourceText(snippet, term, 340)}</span></div>
          <button class="btn ghost" type="button" onclick="showReviewOcrSearchSource(${index})">Open</button>
        </div>
      `).join("") : `<div class="metric-row"><div><strong>No matches found</strong><span>Try another word from the contract, or open Full Contract Text OCR Read.</span></div><span class="badge gray">No match</span></div>`;
      results.dataset.query = term;
    }

    function resetReviewOcrSearch() {
      const input = document.getElementById("reviewOcrSearchInput");
      const results = document.getElementById("reviewOcrSearchResults");
      if (input) input.value = "";
      if (!results) return;
      const { text, clipped } = displayOcrText(reviewContractText(), 9000);
      results.dataset.query = "";
      results.innerHTML = `<div class="metric-row"><div><strong>Full OCR Text</strong><span>${escapeHtml(text || "No OCR text is saved for this contract yet.")}</span></div><button class="btn ghost" type="button" onclick="showFullOcrText()">${clipped ? "Open Full OCR" : "Full OCR"}</button></div>`;
    }

    function showReviewOcrSearchSource(index) {
      const query = document.getElementById("reviewOcrSearchResults")?.dataset.query || "";
      const snippets = searchOcrText(reviewContractText(), query, 8);
      const snippet = snippets[index] || "";
      const { text, clipped } = displayOcrText(reviewContractText(), 15000);
      document.getElementById("modalTitle").textContent = `OCR Search: ${query || "Contract text"}`;
      document.getElementById("modalBody").innerHTML = `
        <div class="grid">
          <article class="card">
            <div class="panel-head"><h3>Selected Match</h3><span class="badge blue">OCR text</span></div>
            <div class="panel-body"><div class="paper">${highlightSourceText(snippet || "No snippet selected.", query, 900)}</div></div>
          </article>
          <article class="card">
            <div class="panel-head"><h3>Full OCR Text</h3></div>
            <div class="panel-body">
              ${clipped ? `<div class="source">Showing the first ${text.length.toLocaleString()} characters for browser speed.</div>` : ""}
              <textarea readonly style="width:100%;min-height:360px;border:1px solid var(--line);border-radius:8px;padding:12px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(text || "No OCR text is saved for this contract yet.")}</textarea>
            </div>
          </article>
        </div>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    function showOcrQuickFind(query, title = "Contract Text") {
      const text = reviewContractText();
      const display = displayOcrText(text, 15000);
      const snippets = searchOcrText(text, query, 10);
      document.getElementById("modalTitle").textContent = title;
      document.getElementById("modalBody").innerHTML = `
        <div class="grid">
          <article class="card">
            <div class="panel-head"><h3>Best Matches</h3><span class="badge blue">OCR search</span></div>
            <div class="panel-body metric-list">
              ${snippets.length ? snippets.map((snippet, index) => `
                <div class="metric-row">
                  <div><strong>Match ${index + 1}</strong><span>${highlightSourceText(snippet, query, 520)}</span></div>
                </div>
              `).join("") : `<div class="metric-row"><div><strong>No match found</strong><span>Open the full text and search for a different word from the contract.</span></div><span class="badge gray">No match</span></div>`}
            </div>
          </article>
          <article class="card">
            <div class="panel-head"><h3>Full OCR Text</h3><span class="badge gray">Use browser find</span></div>
            <div class="panel-body">
              ${display.clipped ? `<div class="source">Showing the first ${display.text.length.toLocaleString()} characters for browser speed.</div>` : ""}
              <textarea readonly style="width:100%;min-height:360px;border:1px solid var(--line);border-radius:8px;padding:12px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(display.text || "No OCR text is saved for this contract yet.")}</textarea>
            </div>
          </article>
        </div>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    function showReviewFieldSimilarSource(index) {
      const field = reviewFields[index];
      if (!field) return;
      const query = similarSearchQueryForField(field);
      const text = reviewContractText();
      const display = displayOcrText(text, 15000);
      const snippets = searchOcrText(text, query, 12);
      document.getElementById("modalTitle").textContent = `${reviewDisplayLabel(field.label)} Field Search`;
      document.getElementById("modalBody").innerHTML = `
        <div class="grid">
          <article class="card">
            <div class="panel-head"><h3>Document Matches For This Field</h3><span class="badge blue">Section search</span></div>
            <div class="panel-body metric-list">
              ${snippets.length ? snippets.map((snippet, matchIndex) => `
                <div class="metric-row">
                  <div><strong>Possible match ${matchIndex + 1}</strong><span>${highlightSourceText(snippet, query, 620)}</span></div>
                </div>
              `).join("") : `<div class="metric-row"><div><strong>No wording found for this field</strong><span>Open the full OCR text and search manually, or correct this field and save so the app learns.</span></div><span class="badge gray">No match</span></div>`}
            </div>
          </article>
          <article class="card">
            <div class="panel-head"><h3>Full OCR Text</h3><span class="badge gray">Manual check</span></div>
            <div class="panel-body">
              ${display.clipped ? `<div class="source">Showing the first ${display.text.length.toLocaleString()} characters for browser speed.</div>` : ""}
              <textarea readonly style="width:100%;min-height:360px;border:1px solid var(--line);border-radius:8px;padding:12px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(display.text || "No OCR text is saved for this contract yet.")}</textarea>
            </div>
          </article>
        </div>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    function missingTermHints(text, cards) {
      if (!text) return [];
      const missingLabels = new Set(cards
        .filter(({ item }) => isPrimaryReviewField(item.label) && isSuspiciousReviewField(item))
        .map(({ item }) => reviewCanonicalLabel(item.label)));
      const definitions = [
        {
          label: "Start / Effective Date",
          keys: ["start of services", "signature date"],
          patterns: [/\b(?:effective date|commence|commencement|start(?:s|ing)?(?: date)?|services shall begin|made the)\b.{0,160}?\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4})\b/i]
        },
        {
          label: "End Date / Expiration",
          keys: ["end date"],
          patterns: [/\b(?:end date|expiration date|expires|through|until|ending|terminate on)\b.{0,180}?\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4})\b/i]
        },
        {
          label: "Contract Length / Term",
          keys: ["initial contract length"],
          patterns: [/\b(?:initial term|term of this agreement|agreement shall commence|for a term|contract term)\b.{0,220}?\b(?:one|two|three|four|five|\d+)\s*(?:\(\d+\)\s*)?(?:year|years|month|months)\b/i]
        },
        {
          label: "Auto-Renewal",
          keys: ["auto renewal"],
          patterns: [/\b(?:automatically renew|auto-renew|renewal term|successive|additional)\b.{0,220}?\b(?:year|month|term|unless|notice|terminated)\b/i]
        },
        {
          label: "Termination / Notice",
          keys: ["termination", "notice period", "how to terminate"],
          patterns: [
            /\b(?:either party|company|client|customer|facility|vendor|provider|contractor)\b.{0,140}?\b(?:terminate|cancel|not renew|non-renew)\b.{0,220}?\b(?:written notice|prior notice|advance notice|days? notice)\b/i,
            /\b(?:automatic(?:ally)? renew|auto-renew|renewal term|successive term)\b.{0,260}?\b(?:unless|until)\b.{0,220}?\b(?:written notice|prior notice|non-renewal|termination)\b/i,
            /\b(?:termination for convenience|without cause|for cause)\b.{0,220}?\b(?:written notice|notice|cure period|breach|default)\b/i,
            /\b(?:terminate|termination|without cause|written notice|notice to|non-renewal|cancellation)\b.{0,220}?\b(?:\d+|thirty|sixty|ninety|one hundred twenty)\s*(?:\(\d+\)\s*)?(?:day|days)\b/i
          ]
        },
        {
          label: "Payment Terms",
          keys: ["payment terms", "days payable"],
          patterns: [/\b(?:net\s*\d{1,2}|payment terms|payable|invoice(?:s)? (?:shall|will|is|are)|paid within|due within)\b.{0,180}?\b(?:\d+|thirty|sixty|ninety)\s*(?:day|days)?\b/i]
        },
        {
          label: "Fee / Rate",
          keys: ["rate / fee", "monthly cost"],
          patterns: [/\b(?:fee schedule|rate schedule|pricing|monthly fee|monthly charge|service fee|flat fee|minimum|surcharge|rate|charge|cost|per mile|per visit|per pickup|per trip|per load|per test|per box|per container|per meal|per session|per service call|per square foot|per linear foot|per month)\b.{0,220}?\$[\d,]+(?:\.\d{2})?/i, /\$[\d,]+(?:\.\d{2})?.{0,170}\b(?:per mile|per visit|per pickup|per trip|per load|per test|per box|per container|per meal|per session|per service call|per month|per square foot|per linear foot|monthly|service fee|charge|rate|minimum|surcharge)\b/i]
        },
        {
          label: "Insurance",
          keys: ["insurance requirement"],
          patterns: [/\b(?:insurance|commercial general liability|professional liability|workers compensation|additional insured)\b.{0,220}?\$[\d,]+/i]
        },
        {
          label: "Vendor / Contact",
          keys: ["vendor", "vendor contact", "vendor email", "vendor phone"],
          patterns: [/\b(?:vendor|company|provider|consultant|contractor|billing contact|account manager|to company|notice to company)\b.{0,220}?(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4})/i]
        }
      ];
      return definitions
        .filter(def => def.keys.some(key => missingLabels.has(reviewCanonicalLabel(key))))
        .map(def => ({ ...def, snippets: findOcrSnippets(def.patterns, text, 4) }))
        .filter(def => def.snippets.length);
    }

    function renderMissingTermFinder(fullText, reviewCards) {
      const hints = missingTermHints(fullText, reviewCards);
      if (!hints.length) return "";
      return `
        <article class="card" style="margin-top:14px">
          <div class="panel-head">
            <h3>Source Clues</h3>
            <div class="table-actions"><span class="badge amber">Review</span><button class="btn ghost" type="button" onclick="hideMissingTermFinder()">Hide</button></div>
          </div>
          <div class="panel-body metric-list">
            ${hints.map(hint => `
              <div class="metric-row">
                <div>
                  <strong>${escapeHtml(hint.label)}</strong>
                  ${hint.snippets.slice(0, 3).map(snippet => `<span style="display:block;margin-top:5px">${highlightSourceText(snippet, hint.label, 240)}</span>`).join("")}
                </div>
                <button class="btn ghost" type="button" onclick="showMissingTermSource('${jsArg(hint.label)}')">Review</button>
              </div>
            `).join("")}
          </div>
        </article>
      `;
    }

    function hideMissingTermFinder() {
      const finder = document.getElementById("missingTermFinder");
      if (finder) finder.innerHTML = "";
    }

    function updateMissingTermSourceSearch(label = "") {
      const input = document.getElementById("missingTermSourceSearch");
      const results = document.getElementById("missingTermSourceResults");
      const query = String(input?.value || label || "").trim();
      if (!results) return;
      const matches = query ? searchOcrText(reviewContractText(), query, 10) : [];
      results.innerHTML = matches.length
        ? matches.map(snippet => `<div class="paper">${highlightSourceText(snippet, query, 1000)}</div>`).join("")
        : `<div class="metric-row"><div><strong>No matches found</strong><span>Try fewer words, a dollar amount, date, vendor name, or phrase from the PDF.</span></div><span class="badge amber">Search</span></div>`;
    }

    function showMissingTermSource(label) {
      const clueKey = `${activeReviewContractId || activeReviewJobId || "review"}:missing:${label}`;
      const modal = document.getElementById("contractModal");
      if (activeSourceClueKey === clueKey && modal?.classList.contains("open")) {
        closeModal();
        return;
      }
      activeSourceClueKey = clueKey;
      const text = reviewContractText();
      const display = displayOcrText(text, 15000);
      const hints = missingTermHints(text, consolidateReviewCards(ensureReviewChecklistFields(reviewFields.length ? reviewFields : extracted)));
      const hint = hints.find(item => item.label === label);
      document.getElementById("modalTitle").textContent = `${label} Source Clues`;
      document.getElementById("modalBody").innerHTML = `
        <div class="grid">
          <article class="card">
            <div class="panel-head"><h3>Likely Contract Wording</h3><div class="table-actions"><span class="badge amber">Verify</span><button class="btn ghost" type="button" onclick="closeModal()">Close Clues</button></div></div>
            <div class="panel-body metric-list">
              <div class="field">
                <label>Search source text</label>
                <div class="search-row">
                  <input id="missingTermSourceSearch" value="${escapeHtml(label)}" placeholder="Search contract OCR..." onkeydown="if(event.key==='Enter'){event.preventDefault(); updateMissingTermSourceSearch('${jsArg(label)}');}" />
                  <button class="btn" type="button" onclick="updateMissingTermSourceSearch('${jsArg(label)}')">Search</button>
                </div>
              </div>
              <div id="missingTermSourceResults">
                ${(hint?.snippets || []).map(snippet => `<div class="paper">${highlightSourceText(snippet, label, 1200)}</div>`).join("") || `<p>No snippets found.</p>`}
              </div>
            </div>
          </article>
          <article class="card">
            <div class="panel-head"><h3>Full OCR Text</h3></div>
            <div class="panel-body">
              ${display.clipped ? `<div class="source">Showing the first ${display.text.length.toLocaleString()} characters for browser speed.</div>` : ""}
              <textarea readonly style="width:100%;min-height:360px;border:1px solid var(--line);border-radius:8px;padding:12px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(display.text || "No OCR text is saved for this contract yet.")}</textarea>
            </div>
          </article>
        </div>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    function markExtractedFieldApproved(index) {
      if (!reviewFields.length && extracted[index]) reviewFields = [...extracted];
      if (!reviewFields[index]) return;
      const rawValue = reviewFieldInputValue(index) || reviewFields[index].value || "";
      const cleanValue = cleanReviewFieldValue(reviewFields[index].label, rawValue);
      applyReviewFieldToMatchingAliases(index, withReviewerVerification({ ...reviewFields[index], value: cleanValue, confidence: 100, approved: true }));
      reviewSaveStatus = cleanValue !== rawValue
        ? `Field cleaned to "${cleanValue}". Submit when the required fields are complete.`
        : "Field marked OK. Submit when the required fields are complete.";
      renderReview();
      setTimeout(() => scrollToNextReviewField(index), 60);
    }

    async function saveReviewFieldInline(index) {
      if (!reviewFields.length && extracted[index]) reviewFields = [...extracted];
      if (!reviewFields[index]) return;
      const rawValue = reviewFieldInputValue(index) || reviewFields[index].value || "";
      const cleanValue = cleanReviewFieldValue(reviewFields[index].label, rawValue);
      if (!cleanValue) {
        showToast("Enter a clean value before saving this field.");
        return;
      }
      const field = {
        ...reviewFields[index],
        value: cleanValue,
        confidence: 100,
        source: sourceCheckSnippets(reviewFields[index], cleanValue).exact.length
          ? "Corrected by reviewer and verified against current contract OCR."
          : "Source Verified by reviewer against the current source contract. Exact value was not found in OCR.",
        approved: true
      };
      applyReviewFieldToMatchingAliases(index, field);
      try {
        let result = null;
        if (activeReviewContractId) {
          result = await apiJson(`/api/review/${encodeURIComponent(activeReviewContractId)}/field`, {
            method: "POST",
            body: JSON.stringify({ field })
          });
          refreshReviewFieldsAfterFieldSave(result, field, index);
          if (result.learnedRules) {
            learningRules = await apiJson("/api/learning-rules").catch(() => learningRules);
          }
        }
        const learned = Number(result?.learnedRules || 0);
        const isVendorField = reviewCanonicalLabel(field.label) === "vendor";
        reviewSaveStatus = isVendorField
          ? `Vendor saved as ${cleanValue} and linked to this contract${learned ? `; ${learned} vendor correction${learned === 1 ? "" : "s"} learned` : ""}.`
          : `${reviewDisplayLabel(field.label)} saved${learned ? ` and taught ${learned} new example${learned === 1 ? "" : "s"}` : ""}. Continue to the next field, then final submit when done.`;
        renderReview();
        scheduleIdleTask(() => renderDashboard(), 500);
        setTimeout(() => scrollToNextReviewField(index), 60);
        showToast(isVendorField ? `Vendor saved: ${cleanValue}` : learned ? "Field saved and taught." : "Field saved.");
      } catch (error) {
        reviewSaveStatus = "Field is saved on this page, but the backend save failed. Try again before final submit.";
        renderReview();
        showReviewSaveProblem(error, "Field Not Saved");
        showToast(error.message || "Could not save field.");
      }
    }

    function reviewFieldInputValue(index) {
      const typed = document.querySelector(`[data-review-new-value-index="${index}"]`)
        || document.querySelector(`[data-modal-review-new-value-index="${index}"]`);
      if (String(typed?.value || "").trim()) return String(typed.value || "").trim();
      const input = document.querySelector(`[data-extracted-index="${index}"]`)
        || document.querySelector(`[data-modal-extracted-index="${index}"]`);
      return String(input?.value || "").trim();
    }

    function toggleReviewServiceOther(index) {
      const select = document.querySelector(`[data-extracted-index="${index}"]`);
      const input = document.getElementById(`reviewServiceOther${index}`);
      if (!select || !input) return;
      const isOther = select.value === "__other__";
      input.style.display = isOther ? "" : "none";
      if (!isOther) input.value = "";
      if (isOther) setTimeout(() => input.focus(), 0);
    }

    function cleanReviewFieldValue(label, value) {
      const canonical = reviewCanonicalLabel(label);
      let text = String(value || "").replace(/\s+/g, " ").trim();
      if (!text) return "";
      if (["initial contract length", "contract length", "term", "renewal term"].includes(canonical)) {
        const exact = text.match(/\b((?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)(?:\s*\(\s*\d+\s*\))?\s+(?:year|years|month|months|day|days))\b/i);
        return (exact?.[1] || text).replace(/\s+thereafter.*$/i, "").replace(/\s+unless.*$/i, "").trim();
      }
      if (["notice period", "termination", "how to terminate"].includes(canonical)) {
        if (/\b(?:insurance|liability|certificate|additional insured|policy|coverage|claim|occurrence|aggregate)\b/i.test(text)) return "";
        const exact = text.match(/\b((?:thirty|sixty|ninety|one hundred twenty|\d{1,3})(?:\s*\(\s*\d{1,3}\s*\))?\s+days?(?:\s+(?:prior|advance|written))?(?:\s+(?:written\s+)?notice)?)\b/i);
        return (exact?.[1] || text).replace(/\s+will\s+be\s+sent.*$/i, "").replace(/\s+of\s+its\s+giving\s+of\s+/i, " ").trim();
      }
      if (["rate / fee", "fee", "cost", "contract value", "monthly cost"].includes(canonical)) {
        if (/\b(?:insurance|liability|claim|occurrence|aggregate|coverage|policy)\b/i.test(text)) return "";
        const exact = text.match(/(\$[\d,]+(?:\.\d{2})?(?:\s*(?:\/|per)\s*(?:mile|gallon|visit|pickup|trip|load|test|box|container|meal|session|service\s*call|month|year|hour|day|resident|patient|bed|unit|service|delivery|square\s*(?:foot|feet|ft)|sq\.?\s*ft|linear\s*(?:foot|feet|ft)|lf|yard|ton|room))?)/i);
        return exact?.[1] || text;
      }
      if (canonical === "payment terms") {
        const exact = text.match(/\b(?:net\s*\d{1,3}|(?:due|payable)\s+within\s+(?:\d{1,3}|thirty|sixty|ninety)\s+days?|(?:\d{1,3}|thirty|sixty|ninety)\s+days?\s+(?:from|after)\s+(?:invoice|receipt|invoicing))\b/i);
        return exact?.[0] || text;
      }
      if (["effective date", "start of services", "start date", "service start date", "signature date", "signed date", "end date", "expiration date"].includes(canonical)) {
        const exact = text.match(/\b(?:\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})\b/i);
        return exact?.[0]?.replace(/(\d{1,2})(st|nd|rd|th)/i, "$1") || text;
      }
      if (canonical === "auto renewal" || canonical === "auto renew") {
        if (/\b(no|not|non[-\s]?renew|does not renew|will not renew)\b/i.test(text)) return "No";
        if (/\b(yes|auto(?:matic(?:ally)?)?[-\s]?renew|renews automatically|successive|renewal term)\b/i.test(text)) return "Yes";
      }
      if (canonical === "vendor" && isBadVendorReviewValue(text)) return "";
      return text;
    }

    async function saveReviewVendorToMaster(index, openAfterSave = false) {
      if (!reviewFields.length && extracted[index]) reviewFields = [...extracted];
      const vendorName = cleanReviewFieldValue("Vendor", reviewFieldInputValue(index) || reviewFields[index]?.value || "");
      if (!vendorName) {
        showToast("Enter a clean vendor name first. Do not save contract sentence text as a vendor.");
        return;
      }
      if (isBadVendorReviewValue(vendorName)) {
        showToast("That looks like contract wording, not a vendor name. Please type the actual vendor.");
        return;
      }
      const duplicateCandidates = vendorDuplicateCandidates(vendorName, 75);
      const exactExisting = duplicateCandidates.find(item => item.score === 100)?.vendor || null;
      const possibleDuplicate = !exactExisting ? duplicateCandidates[0] : null;
      if (possibleDuplicate) {
        showToast(`Possible duplicate: choose ${possibleDuplicate.vendor.name} from the vendor suggestions before saving a new vendor.`);
        const helper = document.getElementById(`reviewVendorMatch${index}`);
        if (helper) {
          helper.textContent = `Possible existing vendor: ${possibleDuplicate.vendor.name}. Select it, then click Save Field.`;
          helper.style.color = "var(--amber)";
          helper.style.fontWeight = "800";
        }
        return;
      }
      try {
        const profile = exactExisting || await apiJson("/api/vendor-profiles", {
          method: "POST",
          body: JSON.stringify({
            name: vendorName,
            legalName: vendorName,
            status: "Active",
            category: reviewFieldValue(reviewFields, ["Category", "Contract Type"], ""),
            notes: activeReviewContractName ? `Created from review queue: ${activeReviewContractName}` : "Created from review queue"
          })
        });
        replaceArray(vendorsData, dedupeRecords([...vendorsData, profile], "name"));
        const vendorField = {
          ...(reviewFields[index] || { label: "Vendor" }),
          label: "Vendor",
          value: profile.name || vendorName,
          confidence: 100,
          source: "Saved to vendor master from Review Queue.",
          approved: true
        };
        applyReviewFieldToMatchingAliases(index, vendorField);
        let learned = 0;
        if (activeReviewContractId) {
          const saved = await apiJson(`/api/review/${encodeURIComponent(activeReviewContractId)}/field`, {
            method: "POST",
            body: JSON.stringify({ field: vendorField })
          });
          learned = Number(saved.learnedRules || 0);
          refreshReviewFieldsAfterFieldSave(saved, vendorField, index);
          if (learned) learningRules = await apiJson("/api/learning-rules").catch(() => learningRules);
        }
        reviewSaveStatus = `${profile.name || vendorName} was saved to Vendor Master, saved on this contract, and ${learned ? `taught ${learned} vendor correction${learned === 1 ? "" : "s"}` : "ready for future matching"}.`;
        renderReview();
        if (activeSectionId() === "vendors") renderVendors();
        scheduleIdleTask(() => initFilters(activeSectionId()), 500);
        if (openAfterSave) {
          setTimeout(() => openVendor(profile.name || vendorName), 80);
        } else {
          setTimeout(() => scrollToNextReviewField(index), 60);
        }
        showToast(exactExisting ? `Existing vendor linked: ${profile.name}` : "New vendor saved and added to dropdowns.");
      } catch (error) {
        showToast(error.message || "Could not save vendor.");
      }
    }

    function openVendorFromReview(index) {
      const vendorName = reviewFieldInputValue(index) || reviewFields[index]?.value || "New Vendor";
      openVendor(vendorName);
    }

    async function saveReviewServiceToMaster(index) {
      if (!reviewFields.length && extracted[index]) reviewFields = [...extracted];
      const rawService = reviewFieldInputValue(index) || reviewFields[index]?.value || "";
      const serviceName = categoryCanonicalName(cleanMasterName(rawService));
      if (!serviceName || !isUsableCategory(serviceName)) {
        showToast("Type the service name first.");
        return;
      }
      const currentCategories = [
        ...(adminSettings.categories || []),
        ...(categories || [])
      ].filter(Boolean).map(categoryCanonicalName);
      if (!currentCategories.some(item => sameMasterName(item, serviceName))) currentCategories.push(serviceName);
      const sortedCategories = [...new Set(currentCategories)]
        .sort((a, b) => categoryGroupFor(a).localeCompare(categoryGroupFor(b)) || a.localeCompare(b));
      try {
        adminSettings = await apiJson("/api/admin-settings", {
          method: "POST",
          body: JSON.stringify({ ...adminSettings, categories: sortedCategories })
        });
      } catch (error) {
        adminSettings = { ...adminSettings, categories: sortedCategories };
      }
      replaceArray(categories, sortedCategories);
      const serviceField = {
        ...(reviewFields[index] || { label: "Contract type" }),
        label: "Contract type",
        value: serviceName,
        confidence: 100,
        source: "Saved to service master from Review Queue.",
        approved: true
      };
      applyReviewFieldToMatchingAliases(index, serviceField);
      if (activeReviewContractId) {
        try {
          const saved = await apiJson(`/api/review/${encodeURIComponent(activeReviewContractId)}/field`, {
            method: "POST",
            body: JSON.stringify({ field: serviceField })
          });
          refreshReviewFieldsAfterFieldSave(saved, serviceField, index);
        } catch (error) {
          // Keep the master service save even if this contract field still needs another save attempt.
        }
      }
      reviewSaveStatus = `${serviceName} was saved to the service list.`;
      renderReview();
      scheduleIdleTask(() => initFilters(activeSectionId()), 500);
      setTimeout(() => scrollToNextReviewField(index), 60);
      showToast("Service saved and added to dropdowns.");
    }

    function scrollToNextReviewField(index) {
      const cards = [...document.querySelectorAll(".extracted-card[id^='review-field-']")];
      const currentPosition = cards.findIndex(card => card.id === `review-field-${index}`);
      const nextCard = currentPosition >= 0 ? cards[currentPosition + 1] : cards[0];
      if (nextCard) {
        nextCard.scrollIntoView({ behavior: "smooth", block: "center" });
        nextCard.style.boxShadow = "0 0 0 4px rgba(31, 94, 255, 0.14)";
        setTimeout(() => { nextCard.style.boxShadow = ""; }, 1400);
      }
    }

    function reviewNavigationIndexes() {
      const fields = reviewFields.length ? ensureReviewChecklistFields(reviewFields) : reviewFields;
      return consolidateReviewCards(fields)
        .filter(({ item }) => !isHiddenReviewField(item))
        .map(({ index }) => index);
    }

    function openAdjacentReviewField(index, direction = 1) {
      const indexes = reviewNavigationIndexes();
      if (!indexes.length) return;
      const position = indexes.indexOf(index);
      const base = position >= 0 ? position : 0;
      const nextIndex = indexes[Math.max(0, Math.min(indexes.length - 1, base + direction))];
      showReviewFieldSource(nextIndex);
    }

    function openFirstIncompleteReviewField() {
      const fields = reviewFields.length ? ensureReviewChecklistFields(reviewFields) : reviewFields;
      const cards = consolidateReviewCards(fields);
      const stats = reviewCompletionStats(cards);
      const target = (stats.required || []).find(({ item }) => !item.approved || isSuspiciousReviewField(item))
        || cards.find(({ item }) => !item.approved || isSuspiciousReviewField(item))
        || cards[0];
      if (target) showReviewFieldSource(target.index);
    }

    function markFeeLineApproved(index) {
      if (!reviewFeeLines[index]) return;
      reviewFeeLines[index] = { ...reviewFeeLines[index], approved: true };
      reviewSaveStatus = "Fee marked OK.";
      renderReview();
    }

    function deleteReviewFeeLine(index) {
      if (!reviewFeeLines[index]) return;
      reviewFeeLines.splice(index, 1);
      reviewSaveStatus = "Fee line removed. It will not be saved when you submit the contract.";
      renderReview();
      showToast("Fee line deleted from this review.");
    }

    function addReviewFeeLine() {
      reviewFeeLines.push({
        service: "",
        unit: "",
        rate: "",
        frequency: "",
        source: "Manual correction",
        approved: false
      });
      reviewSaveStatus = "Add fee, then submit.";
      renderReview();
    }

    function cleanAiFeeDraft(line = {}) {
      const combined = `${line.service || ""} ${line.rate || ""} ${line.unit || ""} ${line.frequency || ""} ${line.source_snippet || ""}`.replace(/\s+/g, " ").trim();
      const rate = combined.match(/\$\s*[\d,]+(?:\.\d{1,2})?/)?.[0]?.replace(/\s+/g, "") || String(line.rate || "").trim();
      const unit = String(line.unit || combined.match(/\bper\s+(square\s+foot|sq\.?\s*ft|linear\s+foot|visit|service|mow|trip|mile|hour|day|pickup|delivery|unit|inch|room|bed)\b/i)?.[1] || "").replace(/^sq\.?\s*ft$/i, "square foot");
      const frequency = String(line.frequency || combined.match(/\b(daily|weekly|biweekly|monthly|quarterly|annual(?:ly)?|yearly|per\s+(?:visit|service|mow|trip|day|pickup|delivery))\b/i)?.[1] || "").replace(/^per\s+/i, "Per ");
      let service = String(line.service || "Fee").replace(/\s+/g, " ").trim();
      if (/after\s+10\s+inches/i.test(combined)) service = "Snow removal over 10 inches";
      if (service.length > 80) service = `${service.slice(0, 77).trimEnd()}...`;
      return { ...line, service, rate, unit, frequency, source: line.source_snippet || line.source || "AI pasted fee wording", approved: false, aiDraft: true };
    }

    async function readPastedFeeTextWithAi() {
      const input = document.getElementById("feeAiPasteText");
      const button = document.getElementById("readPastedFeesButton");
      const status = document.getElementById("feeAiPasteStatus");
      const feeText = String(input?.value || "").trim();
      if (!activeReviewContractId) return showToast("Open a contract from Review Queue first.");
      if (feeText.length < 12) return showToast("Paste the pricing sentence or fee schedule first.");
      if (button) { button.disabled = true; button.textContent = "Reading..."; }
      if (status) status.textContent = "AI is separating the fee, unit, quantity, and billing cycle...";
      try {
        const result = await apiJson(`/api/review/${encodeURIComponent(activeReviewContractId)}/ai-review`, {
          method: "POST",
          body: JSON.stringify({ feeText })
        });
        const drafts = (Array.isArray(result.suggestedFeeLines) ? result.suggestedFeeLines : []).map(cleanAiFeeDraft);
        if (!drafts.length) {
          if (status) status.textContent = "No supported fee was found. Paste a sentence that includes the dollar amount and billing unit.";
          return showToast("No supported fee was found in the pasted wording.");
        }
        const existingKeys = new Set((reviewFeeLines || []).map(line => normalizeMatchValue(`${line.service}|${line.rate}|${line.unit}|${line.frequency}`)));
        const additions = drafts.filter(line => {
          const key = normalizeMatchValue(`${line.service}|${line.rate}|${line.unit}|${line.frequency}`);
          if (!key || existingKeys.has(key)) return false;
          existingKeys.add(key);
          return true;
        });
        reviewFeeLines = normalizeReviewFeeLines([...(reviewFeeLines || []), ...additions]);
        reviewSaveStatus = `${additions.length} AI fee draft${additions.length === 1 ? "" : "s"} added. Review each row and mark it OK.`;
        if (status) status.textContent = additions.length ? `${additions.length} draft fee row${additions.length === 1 ? "" : "s"} added below.` : "Those fee rows already exist.";
        renderReview();
        document.querySelector(".review-fee-details")?.setAttribute("open", "");
        showToast(additions.length ? `${additions.length} fee draft${additions.length === 1 ? "" : "s"} ready for review.` : "No duplicate fee rows were added.");
      } catch (error) {
        if (status) status.textContent = error?.detail || error?.message || "AI could not read this fee wording.";
        showToast(error?.detail || error?.message || "AI could not read this fee wording.");
      } finally {
        if (button) { button.disabled = false; button.textContent = "Read Fee Text"; }
      }
    }

    function showReviewFieldSource(index) {
      const field = reviewFields[index];
      if (!field) return;
      const text = reviewContractText();
      const selected = selectedReviewContract();
      const sourceRecord = selectedReviewSourceRecord();
      const sourceFileUrl = contractFileUrl(sourceRecord);
      const sourceKind = contractSourceKind(sourceRecord);
      const openLabel = sourceOpenLabel(sourceKind);
      document.getElementById("modalTitle").textContent = `${reviewDisplayLabel(field.label)} Source`;
      setModalReviewNavigation(index);
      document.getElementById("modalBody").innerHTML = `
        <div class="pdf-compare-layout">
          <article class="card">
            <div class="panel-head"><h3>Correct Field</h3><span class="badge ${confidenceBadge(field).className}">${confidenceBadge(field).text}</span></div>
            <div class="panel-body grid">
              <div class="field">
                <label>${escapeHtml(reviewDisplayLabel(field.label))}</label>
                ${modalCorrectionInputHtml(field, index)}
              </div>
              <div class="source">${field.confidence ? `${field.confidence}% confidence. ` : ""}${escapeHtml(field.source || "OCR source text")}</div>
              <div class="paper">${highlightSourceText(field.snippet || field.context || "No source snippet was saved for this field.", field.label, 900)}</div>
              <div class="table-actions">
                <button class="btn primary" type="button" onclick="saveReviewCorrectionFromModal(${index}, true)">Save Field</button>
                <button class="btn primary" type="button" onclick="saveReviewCorrectionAndNext(${index})">Save + Next</button>
                <button class="btn" type="button" onclick="useSelectedOcrTextForField(${index}, false)">Use Highlighted Text</button>
                <button class="btn ghost" type="button" onclick="closeModal()">Close</button>
              </div>
            </div>
          </article>
          <article class="card">
            <div class="panel-head"><h3>Source</h3><div class="table-actions">${sourceFileUrl ? `<a class="btn ghost" href="${escapeHtml(sourceFileUrl)}" target="_blank" rel="noopener">${escapeHtml(openLabel)}</a>` : `<span class="badge amber">No source</span>`}</div></div>
            <div class="panel-body">
              <div class="metric-row"><div><strong>Search OCR</strong><span>Find the exact wording, highlight it, then save.</span></div><span class="badge amber">Proof</span></div>
              ${fieldSourceSelectorHtml(index, text, similarSearchQueryForField(field))}
              ${sourceFileUrl && sourceKind === "pdf" ? `<iframe class="contract-preview-frame pdf-modal-frame" src="${escapeHtml(sourceFileUrl)}" title="Original contract PDF"></iframe>` : ""}
            </div>
          </article>
        </div>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    function shortSourceText(value, limit = 110) {
      const clean = String(value || "").replace(/\s+/g, " ").trim();
      if (!clean) return "No source saved";
      if (hasUnreadableOcrText(clean)) return "OCR unclear. Check source.";
      return clean.length > limit ? `${clean.slice(0, limit - 1)}...` : clean;
    }

    function hasUnreadableOcrText(value) {
      const text = String(value || "");
      if (!text) return false;
      const bad = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uE000-\uF8FF\uFFFD]/g) || []).length;
      const readable = (text.match(/[a-z0-9$%.,:/()\-\s]/gi) || []).length;
      return bad >= 2 || (bad > 0 && bad / Math.max(text.length, 1) > 0.025) || (text.length > 12 && readable / text.length < 0.55);
    }

    function cleanFeeLineDisplay(value, fallback = "Unclear fee line - review source") {
      const clean = String(value || "").replace(/\s+/g, " ").trim();
      return clean && !hasUnreadableOcrText(clean) ? clean : fallback;
    }

    function cleanFeeRate(value = "") {
      const money = String(value || "").match(/\$\s*\d[\d,]*(?:\.\d{2})?/);
      const clean = money ? money[0].replace(/\s+/g, "") : String(value || "").replace(/\s+/g, " ").trim();
      return formatMoneyText(clean);
    }

    function cleanFeeServiceName(line = {}) {
      const raw = cleanFeeLineDisplay(line.service || line.source || line.sourceSnippet || "", "");
      const source = cleanFeeLineDisplay(feeSourceSnippet(line), "");
      const text = `${raw} ${source}`.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
      const rate = cleanFeeRate(line.rate);
      if (rate === "$0.00" && /\bnon[-\s]?recurring\b/i.test(text)) return "No non-recurring charge";
      if (/\b(?:m(?:ont)?hly|hly)\s+recurring\b/i.test(text) || /\bmonthly recurring charge\b/i.test(text)) return "Monthly recurring charge";
      if (/\bnon[-\s]?recurring\b/i.test(text)) return "Non-recurring charge";
      if (/\bservice order total\b/i.test(text)) return "Service order total";
      return raw
        .replace(/\bservice order total\b/ig, "")
        .replace(/\b(?:monthly|hly)?\s*recurring\s*charge?\b/ig, "Monthly recurring charge")
        .replace(/\bnon[-\s]?recurring\s*charge?\b/ig, "Non-recurring charge")
        .replace(/\$\s*\d[\d,]*(?:\.\d{2})?/g, "")
        .replace(/[|:]+/g, " ")
        .replace(/\s+/g, " ")
        .trim() || "Fee / charge";
    }

    function cleanFeeFrequency(line = {}) {
      const text = `${line.frequency || ""} ${line.service || ""} ${feeSourceSnippet(line)}`.replace(/\s+/g, " ");
      if (cleanFeeRate(line.rate) === "$0.00" && /\bnon[-\s]?recurring\b/i.test(text)) return "One-time";
      if (/\b(?:m(?:ont)?hly|hly)\s+recurring\b/i.test(text) || /\bmonthly\b/i.test(text)) return "Monthly";
      if (/\bnon[-\s]?recurring\b/i.test(text) || /\bone[-\s]?time\b/i.test(text)) return "One-time";
      return cleanFeeLineDisplay(line.frequency || "", "");
    }

    function normalizeReviewFeeLine(line = {}) {
      const rate = cleanFeeRate(line.rate);
      const service = cleanFeeServiceName({ ...line, rate });
      return {
        ...line,
        service,
        unit: cleanFeeLineDisplay(line.unit || "", ""),
        rate,
        frequency: cleanFeeFrequency(line),
        source: feeSourceSnippet(line) || line.source || "Reviewed fee line",
        approved: Boolean(line.approved)
      };
    }

    function normalizeReviewFeeLines(lines = []) {
      const seen = new Set();
      return (lines || [])
        .map(normalizeReviewFeeLine)
        .filter(line => line.service || line.rate)
        .filter(line => {
          const key = `${String(line.service || "").toLowerCase()}|${String(line.rate || "").toLowerCase()}|${String(line.frequency || "").toLowerCase()}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    }

    function cleanQueueText(value, fallback = "Needs review", limit = 72) {
      const text = String(value || "")
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
        .replace(/[^\S\r\n]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) return fallback;
      const weirdChars = (text.match(/[^\w\s$.,:/()&@#+'"-]/g) || []).length;
      if (weirdChars > Math.max(5, text.length * 0.08)) return fallback;
      if (/^[^A-Za-z0-9$]{3,}/.test(text)) return fallback;
      if (["unknown", "not found", "needs review", "needs classification", "tbd", "n/a", "na"].includes(text.toLowerCase())) return fallback;
      return text.length > limit ? `${text.slice(0, limit - 1).trim()}...` : text;
    }

    function queuePathName(value = "") {
      return String(value || "")
        .replace(/^["']|["']$/g, "")
        .split(/[\\/]/)
        .pop()
        .replace(/\.(pdf|docx?|png|jpe?g|tiff?|txt|text|md|eml)$/i, "")
        .replace(/^UP-\d+-/i, "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function isGenericContractName(value = "") {
      const clean = String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
      return !clean || clean === "new contract intake" || clean === "contract intake" || clean === "sharesync intake contract" || clean === "needs contract name";
    }

    function queueContractTitle(job, contract) {
      const extractedName = reviewFieldValue(job.extractedFields || contract.extractedFields || [], ["Contract Name", "Agreement Name", "Document Title"], "");
      const choices = [
        contract.documentTitle,
        contract.name,
        extractedName,
        job.name,
        job.fileName,
        contract.uploadedFileName,
        job.uploadedFileName,
        queuePathName(contract.localFilePath || job.localFilePath || contract.shareSyncLocalPath || job.shareSyncLocalPath),
        contract.id || job.contractId || job.id
      ];
      const value = choices.find(item => item && !isGenericContractName(item));
      return cleanQueueText(value, "Pending contract", 72);
    }

    function cleanQueueMoney(value) {
      const clean = cleanQueueText(value, "", 56);
      if (!clean) return "TBD";
      if (/\b(insurance|liability|claim|occurrence|aggregate|additional insured)\b/i.test(clean)) return "TBD";
      return clean;
    }

    function cleanQueueServiceType(value) {
      const clean = cleanQueueText(value, "", 44);
      if (!clean) return "Type not confirmed";
      if (/\b(entire agreement|constitutes|whereas|hereby|shall|terms and conditions|section|article|exhibit)\b/i.test(clean)) {
        return "Type not confirmed";
      }
      if (clean.split(/\s+/).length > 6 && !/\b(transportation|pharmacy|dental|maintenance|waste|laundry|gas|electric|internet|security|fire|therapy|staffing|food|medical|lab|diagnostic|oxygen|water|hvac|elevator|lease)\b/i.test(clean)) {
        return "Type not confirmed";
      }
      return clean;
    }

    function cleanQueueNotice(value) {
      return cleanQueueText(value, "Not found", 72);
    }

    function ocrTextForJob(jobId) {
      const job = ocrJobs.find(item => item.id === jobId);
      const contract = job?.contractId
        ? contractData.find(item => item.id === job.contractId) || contracts.find(item => item.id === job.contractId)
        : null;
      return {
        title: contract?.name || job?.name || job?.fileName || "OCR Text",
        contractId: contract?.id || job?.contractId || "",
        text: job?.extractedText || contract?.ocrText || job?.extractedTextPreview || contract?.ocrTextPreview || ""
      };
    }

    async function showFullOcrText(jobId = "") {
      const fromJob = jobId ? ocrTextForJob(jobId) : null;
      let text = fromJob?.text || reviewContractText();
      let title = fromJob?.title || activeReviewContractName || "Selected Contract";
      const contractId = fromJob?.contractId || activeReviewContractId || "";
      if (contractId && String(text || "").length < 1500) {
        try {
          const fullContract = await ensureFullContractRecord(contractId);
          text = fullContract?.ocrText || fullContract?.fullText || text;
          title = fullContract?.name || title;
        } catch {
          // The preview text is still useful if the full record cannot be loaded.
        }
      }
      const displayText = String(text || "").slice(0, 20000);
      const clipped = String(text || "").length > displayText.length;
      document.getElementById("modalTitle").textContent = "Full OCR Text Read";
      document.getElementById("modalBody").innerHTML = `
        <article class="card">
          <div class="panel-head"><h3>${escapeHtml(title)}</h3><span class="badge blue">OCR</span></div>
          <div class="panel-body">
            <div class="metric-row">
              <div><strong>Fix OCR Text</strong><span>Select the bad read, then type the correct contract wording.</span></div>
              <span class="badge blue">Teach</span>
            </div>
            ${clipped ? `<div class="source">Showing first ${displayText.length.toLocaleString()} characters.</div>` : ""}
            <textarea id="fullOcrTextArea" data-contract-id="${escapeHtml(contractId)}" readonly style="width:100%;min-height:420px;border:1px solid var(--line);border-radius:8px;padding:12px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink);background:#fff">${escapeHtml(displayText || "No OCR text is saved for this contract yet. Try reading the source again, or check that the PDF/Word file is readable.")}</textarea>
            <div class="field-grid" style="margin-top:12px">
              <label class="field">OCR read this
                <textarea id="ocrBadSelection" rows="3" placeholder="Select text above or paste what the OCR got wrong."></textarea>
              </label>
              <label class="field">Correct text
                <textarea id="ocrCorrectedText" rows="3" placeholder="Type the exact wording from the contract."></textarea>
              </label>
            </div>
            <div class="table-actions" style="margin-top:12px">
              <button class="btn" type="button" onclick="copySelectedOcrTextForCorrection()">Use highlighted text</button>
              <button class="btn primary" type="button" onclick="saveOcrTextCorrection()">Save correction</button>
            </div>
          </div>
        </article>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    function copySelectedOcrTextForCorrection() {
      const area = document.getElementById("fullOcrTextArea");
      const output = document.getElementById("ocrBadSelection");
      if (!area || !output) return;
      const selected = area.value.slice(area.selectionStart || 0, area.selectionEnd || 0).trim();
      if (!selected) {
        showToast("Highlight the wrong OCR words first.");
        return;
      }
      output.value = selected;
    }

    async function saveOcrTextCorrection() {
      const area = document.getElementById("fullOcrTextArea");
      const badInput = document.getElementById("ocrBadSelection");
      const goodInput = document.getElementById("ocrCorrectedText");
      if (!badInput || !goodInput) return;
      const originalValue = badInput.value.trim() || (area ? area.value.slice(area.selectionStart || 0, area.selectionEnd || 0).trim() : "");
      const correctedValue = goodInput.value.trim();
      if (!originalValue || !correctedValue) {
        showToast("Add both the wrong OCR words and the correct wording.");
        return;
      }
      const contractId = area?.dataset.contractId || activeReviewContractId || "";
      try {
        const result = await apiJson("/api/learning-rules", {
          method: "POST",
          body: JSON.stringify({
            contractId,
            sourceText: area?.value || "",
            fields: [{
              label: "OCR Text Correction",
              value: correctedValue,
              originalValue,
              snippet: originalValue
            }]
          })
        });
        learningRules = await apiJson("/api/learning-rules").catch(() => learningRules);
        showToast(`Saved OCR correction${result?.count ? ` (${result.count})` : ""}.`);
        badInput.value = "";
        goodInput.value = "";
      } catch (error) {
        showToast("Could not save OCR correction. Check that the server is connected.");
      }
    }

    function feeSourceSnippet(fee) {
      return fee?.sourceSnippet || fee?.snippet || fee?.context || fee?.source || "";
    }

    function showReviewFeeSource(index) {
      const fee = reviewFeeLines[index];
      if (!fee) return;
      const source = feeSourceSnippet(fee);
      const { text, clipped } = displayOcrText(reviewContractText(), 15000);
      const serviceLabel = cleanFeeLineDisplay(fee.service || "Fee", "Fee Source");
      const sourceWarning = hasUnreadableOcrText(source) ? `<div class="metric-row"><div><strong>OCR needs review</strong><span>The scan produced unreadable characters near this fee. Use the PDF/original contract if the source text is not clear.</span></div><span class="badge amber">Check source</span></div>` : "";
      document.getElementById("modalTitle").textContent = `${serviceLabel} Source`;
      document.getElementById("modalBody").innerHTML = `
        <div class="grid">
          <article class="card">
            <div class="panel-head"><h3>Extracted Fee</h3><span class="badge blue">Source proof</span></div>
            <div class="panel-body">
              ${sourceWarning}
              <div class="metric-row"><div><strong>${escapeHtml(fee.rate || "No rate")}</strong><span>${escapeHtml([fee.unit, fee.frequency].filter(Boolean).join(" | ") || "Fee line")}</span></div></div>
              <div class="metric-row"><div><strong>${escapeHtml(serviceLabel)}</strong><span>${escapeHtml(fee.sourcePage ? `Page ${fee.sourcePage}` : "OCR text")}</span></div></div>
              <div class="paper">${highlightSourceText(source || "No source snippet was saved for this fee line.", `${fee.service || ""} ${fee.rate || ""} fee rate charge cost`, 900)}</div>
            </div>
          </article>
          <article class="card">
            <div class="panel-head"><h3>Full OCR Text</h3></div>
            <div class="panel-body">
              ${clipped ? `<div class="source">Showing the first ${text.length.toLocaleString()} characters for speed.</div>` : ""}
              <textarea readonly style="width:100%;min-height:360px;border:1px solid var(--line);border-radius:8px;padding:12px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(text || "No OCR text is saved for this contract yet.")}</textarea>
            </div>
          </article>
        </div>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    function showContractFeeSource(contractId, index) {
      const contract = contracts.find(item => item.id === contractId) || contractData.find(item => item.id === contractId);
      const fee = contract?.extractedFeeLines?.[index];
      if (!contract || !fee) return;
      const source = feeSourceSnippet(fee);
      const { text, clipped } = displayOcrText(contract.ocrText || contract.ocrTextPreview || "", 15000);
      const serviceLabel = cleanFeeLineDisplay(fee.service || "Fee", "Fee Source");
      const sourceWarning = hasUnreadableOcrText(source) ? `<div class="metric-row"><div><strong>OCR needs review</strong><span>The scan produced unreadable characters near this fee. Use the PDF/original contract if the source text is not clear.</span></div><span class="badge amber">Check source</span></div>` : "";
      document.getElementById("modalTitle").textContent = `${serviceLabel} Source`;
      document.getElementById("modalBody").innerHTML = `
        <div class="grid">
          <article class="card">
            <div class="panel-head"><h3>Extracted Fee</h3><span class="badge blue">Source proof</span></div>
            <div class="panel-body">
              ${sourceWarning}
              <div class="metric-row"><div><strong>${escapeHtml(fee.rate || "No rate")}</strong><span>${escapeHtml([fee.unit, fee.frequency].filter(Boolean).join(" | ") || "Fee line")}</span></div></div>
              <div class="metric-row"><div><strong>${escapeHtml(contract.name || "Contract")}</strong><span>${escapeHtml(fee.sourcePage ? `Page ${fee.sourcePage}` : "OCR text")}</span></div></div>
              <div class="paper">${highlightSourceText(source || "No source snippet was saved for this fee line.", `${fee.service || ""} ${fee.rate || ""} fee rate charge cost`, 900)}</div>
              <button class="btn primary" type="button" onclick="openContractSafe('${jsArg(contract.id)}', '${jsArg(contract.name || contract.vendor || "")}')">Back to Contract</button>
            </div>
          </article>
          <article class="card">
            <div class="panel-head"><h3>Full OCR Text</h3></div>
            <div class="panel-body">
              ${clipped ? `<div class="source">Showing the first ${text.length.toLocaleString()} characters for speed.</div>` : ""}
              <textarea readonly style="width:100%;min-height:360px;border:1px solid var(--line);border-radius:8px;padding:12px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(text || "No OCR text is saved for this contract yet.")}</textarea>
            </div>
          </article>
        </div>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    async function approveReviewFields() {
      if (!activeReviewContractId) {
        showToast("Run OCR or open a reviewed contract first.");
        return;
      }
      const fields = currentReviewFieldsFromInputs();
      if (!fields.length) {
        showToast("No extracted fields to approve yet.");
        return;
      }
      try {
        const businessStatus = currentReviewBusinessStatus();
        const feeLines = currentReviewFeeLinesFromInputs();
        const selected = selectedReviewContract();
        const benchmark = contractBenchmarkComparison(selected, fields);
        const approvalJustification = (document.getElementById("reviewApprovalJustification")?.value || reviewApprovalJustification || "").trim();
        if (benchmark.requiresJustification && approvalJustification.length < 10) {
          reviewSaveStatus = "This contract is significantly different from similar contracts. Add a short approval justification before submitting.";
          reviewApprovalJustification = approvalJustification;
          renderReview();
          showToast("Add a justification before approving this outlier contract.");
          return;
        }
        if (businessStatus.status === "Replaced" && !businessStatus.replacementContractId) {
          reviewSaveStatus = "Select which contract replaced this one before saving.";
          renderReview();
          showToast("Select the replacement contract before saving.");
          return;
        }
        const sourceIssues = sourceProofIssuesForFields(fields);
        if (sourceIssues.length) {
          const preview = sourceIssues.slice(0, 4).map(issue => `${issue.label}: ${issue.value}`).join(", ");
          const more = sourceIssues.length > 4 ? `, +${sourceIssues.length - 4} more` : "";
          reviewSaveStatus = `Submit blocked. Save or verify required fields first: ${preview}${more}`;
          renderReview();
          showSubmitSourceIssues(sourceIssues);
          return;
        }
        reviewSaveStatus = "Saving approved fields to the contract record...";
        renderReview();
        const result = await apiJson(`/api/review/${encodeURIComponent(activeReviewContractId)}`, {
          method: "POST",
          body: JSON.stringify({ fields, feeLines, businessStatus, approvalJustification, financialBenchmark: benchmark })
        });
        await apiJson(`/api/contracts/${encodeURIComponent(activeReviewContractId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            approvalJustification,
            financialBenchmark: {
              status: benchmark.status,
              tone: benchmark.tone,
              requiresJustification: Boolean(benchmark.requiresJustification),
              message: benchmark.message,
              metric: benchmark.metric,
              peerCount: benchmark.peerCount || 0,
              candidateValue: benchmark.candidateValue || 0,
              average: benchmark.average || 0,
              min: benchmark.min || 0,
              max: benchmark.max || 0,
              percent: benchmark.percent || 0,
              comparedAt: new Date().toISOString()
            }
          })
        }).catch(() => null);
        reviewFields = result.fields || fields;
        reviewFeeLines = feeLines;
        activeReviewStatus = result.contract?.status || businessStatus.status || "Active";
        activeReviewContractName = result.contract?.name || activeReviewContractName;
        if (result.contract) {
          upsertLiveContract(result.contract);
        }
        const submittedContractId = activeReviewContractId;
        try {
          markLiveDataDirty();
          await loadBackendData();
        } catch (refreshError) {
          console.warn("Approved contract saved, but live refresh failed.", refreshError);
        }
        ocrJobs = ocrJobs.filter(job => job.contractId !== submittedContractId && job.contract_id !== submittedContractId);
        const learnedRules = result.learnedRules || 0;
        const learnedMasterData = result.learnedMasterData || 0;
        reviewSaveStatus = `Submitted, saved, taught, and removed from the Review Queue. The system learned ${learnedRules} field correction${learnedRules === 1 ? "" : "s"} and ${learnedMasterData} master match${learnedMasterData === 1 ? "" : "es"} for future uploads.`;
        const nextJob = nextReviewJob(submittedContractId);
        activeReviewStatus = "";
        activeReviewJobId = "";
        activeReviewContractId = "";
        activeReviewContractName = "";
        reviewApprovalJustification = "";
        reviewFields = [];
        extracted = [];
        reviewFeeLines = [];
        renderReview();
        showApprovedContractSummary(result.contract || selected || { id: submittedContractId }, nextJob?.id || "");
        showToast(nextJob ? "Submitted and removed. Summary is open; continue to the next contract when ready." : "Submitted and removed. No more contracts are waiting for review.");
      } catch (error) {
        const message = error?.message || "Could not save approved fields.";
        reviewSaveStatus = `Submit needs attention: ${error?.detail || message}`;
        renderReview();
        showReviewSaveProblem(error, "Cannot Submit Yet");
        showToast(message);
      }
    }

    function showApprovedContractSummary(contract = {}, nextJobId = "") {
      const c = normalizeContract(contract || {});
      const sourceFileUrl = c.id ? `/api/contracts/${encodeURIComponent(c.id)}/file` : "";
      const sourceKind = contractSourceKind(c);
      const sourceLabel = sourceKindLabel(sourceKind);
      const openLabel = sourceOpenLabel(sourceKind);
      document.getElementById("modalTitle").textContent = "Approved Contract Summary";
      document.getElementById("modalBody").innerHTML = `
        <div class="record-header">
          <div class="record-title-row">
            <div>
              <h2 style="margin:0">${escapeHtml(c.name || "Approved contract")}</h2>
              <p style="margin:6px 0 0;color:var(--muted)">Final saved record for search, reports, alerts, and vendor tracking.</p>
            </div>
            <span class="badge green">Approved</span>
          </div>
        </div>
        <div class="approved-summary-grid">
          ${approvedSummaryRow("Vendor", c.vendor || "Needs Review", "Record")}
          ${approvedSummaryRow("Facility", c.facility || "Needs Review", "Record")}
          ${approvedSummaryRow("Service", c.services || c.category || c.contractType || "Needs Review", "Type")}
          ${approvedSummaryRow("Dates", `Start: ${c.startOfServices || c.start || c.effectiveDate || "Needs Review"} | End: ${endDateDisplay(c.end, c.autoRenewal)}`, "Term")}
          ${approvedSummaryRow("Fees", c.fee || c.rate || c.spend || c.monthlyCost || "Needs Review", "Money")}
          ${approvedSummaryRow("Payment", `${c.paymentTerms || "Needs Review"}${c.daysPayable ? ` (${c.daysPayable})` : ""}`, "Terms")}
          ${approvedSummaryRow("Auto-renewal", `${c.autoRenewal || "Unknown"}${c.renewalTerm ? ` | ${c.renewalTerm}` : ""}`, "Renewal")}
          ${approvedSummaryRow("Notice", c.terminationClause || c.noticePeriod || "Needs Review", "Exit")}
          ${approvedSummaryRow("Insurance", c.insuranceRequirement || "Needs Review", "Compliance")}
          ${approvedSummaryRow(`Source ${sourceLabel}`, c.uploadedFileName || c.shareSyncLocalPath || c.shareSyncUrl || "No source file linked", "Source")}
        </div>
        <div class="table-actions" style="margin-top:14px">
          ${c.id ? `<button class="btn primary" onclick="closeModal(); openContractSafe('${jsArg(c.id)}', '${jsArg(c.name || c.vendor || "")}')">Open Contract Record</button>` : ""}
          ${sourceFileUrl ? `<a class="btn ghost" href="${sourceFileUrl}" target="_blank" rel="noopener">${escapeHtml(openLabel)}</a>` : ""}
          ${nextJobId ? `<button class="btn primary" data-close-modal-before="1" data-open-review-job="${escapeHtml(nextJobId)}">Next Review Item</button>` : `<button class="btn ghost" onclick="closeModal(); switchSection('review')">Back to Queue</button>`}
          <button class="btn" onclick="closeModal(); switchSection('contracts')">Contract Search</button>
        </div>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    async function askAiToReviewContract() {
      if (!activeReviewContractId) {
        showToast("Open a contract from Review Queue first.");
        return;
      }
      const button = document.getElementById("askAiReviewButton");
      if (button) {
        button.disabled = true;
        button.textContent = "AI Reviewing...";
      }
      showToast("Local AI is reviewing this contract. You can keep reading the source.");
      try {
        const result = await apiJson(`/api/review/${encodeURIComponent(activeReviewContractId)}/ai-review`, { method: "POST", body: "{}" });
        window.pendingContractAiReview = result;
        const issues = Array.isArray(result.issues) ? result.issues : [];
        const fields = (Array.isArray(result.suggestedFields) ? result.suggestedFields : []).filter(field => {
          const label = reviewCanonicalLabel(field?.label || "");
          const value = String(field?.value || "").trim();
          if (label === "quantity of services") return /\d/.test(value) && !/^per\s+[a-z -]+$/i.test(value);
          return Boolean(value);
        });
        const fees = (Array.isArray(result.suggestedFeeLines) ? result.suggestedFeeLines : []).map(line => {
          const combined = `${line?.service || ""} ${line?.rate || ""} ${line?.unit || ""} ${line?.frequency || ""} ${line?.source_snippet || ""}`.replace(/\s+/g, " ").trim();
          const money = combined.match(/\$\s*[\d,]+(?:\.\d{1,2})?/)?.[0]?.replace(/\s+/g, "") || String(line?.rate || "").trim();
          const unit = String(line?.unit || combined.match(/\bper\s+(square\s+foot|sq\.?\s*ft|linear\s+foot|visit|service|mow|trip|mile|hour|day|pickup|delivery|unit|inch|room|bed)\b/i)?.[1] || "").replace(/^sq\.?\s*ft$/i, "square foot");
          const frequency = String(line?.frequency || combined.match(/\b(daily|weekly|biweekly|monthly|quarterly|annual(?:ly)?|yearly|per\s+(?:visit|service|mow|trip|day|pickup|delivery))\b/i)?.[1] || "").replace(/^per\s+/i, "Per ");
          let service = String(line?.service || "Fee").replace(/\s+/g, " ").trim();
          if (/after\s+10\s+inches/i.test(combined)) service = "Snow removal over 10 inches";
          if (service.length > 80) service = `${service.slice(0, 77).trimEnd()}...`;
          return { ...line, service, rate: money, unit, frequency };
        });
        window.pendingContractAiReview = { ...result, suggestedFields: fields, suggestedFeeLines: fees };
        const suggestionCount = fields.length + fees.length;
        document.getElementById("modalTitle").textContent = "AI Contract Review";
        document.getElementById("modalBody").innerHTML = `
          <section class="ai-review-result-head">
            <div><span class="ai-review-kicker">REVIEW FINISHED</span><h2>${suggestionCount ? `${suggestionCount} suggestion${suggestionCount === 1 ? "" : "s"} ready` : "No safe correction found"}</h2><p>${escapeHtml(result.summary || "The contract review is complete.")}</p></div>
            <div class="ai-review-counts"><strong>${issues.length}</strong><span>issues</span><strong>${suggestionCount}</strong><span>suggestions</span></div>
          </section>
          <div class="ai-review-safety-note"><strong>Nothing was changed automatically.</strong><span>${suggestionCount ? "Review the suggestions below, then click Apply Suggestions." : "Check the source and complete uncertain fields manually."}</span></div>
          <div class="panel-head" style="margin-top:14px"><h3>Issues Found</h3><span class="badge ${issues.length ? "amber" : "green"}">${issues.length}</span></div>
          ${issues.map(issue => `<div class="metric-row"><div><strong>${escapeHtml(issue.field || "Contract")}</strong><span>${escapeHtml(issue.message || "Review suggested")}</span></div><span class="badge ${String(issue.severity || "").toLowerCase() === "high" ? "red" : "amber"}">${escapeHtml(issue.severity || "Review")}</span></div>`).join("") || `<div class="metric-row"><div><strong>No clear issue found</strong><span>Continue normal source verification.</span></div><span class="badge green">Clear</span></div>`}
          <div class="panel-head" style="margin-top:14px"><h3>Suggested Corrections</h3><span class="badge blue">${suggestionCount}</span></div>
          ${fields.map(field => `<div class="metric-row"><div><strong>${escapeHtml(reviewDisplayLabel(field.label || "Field"))}: ${escapeHtml(field.value || "")}</strong><span>${escapeHtml(field.source_snippet || "No source snippet returned")}</span></div><div class="ai-review-target"><span>Fills ${escapeHtml(reviewDisplayLabel(field.label || "Field"))}</span><span class="badge blue">${escapeHtml(String(field.confidence || "Review"))}${field.confidence ? "%" : ""}</span></div></div>`).join("")}
          ${fees.map(line => `<div class="metric-row"><div><strong>${escapeHtml(line.service || "Fee")}: ${escapeHtml(line.rate || "")}${line.quantity ? ` × ${escapeHtml(String(line.quantity))}` : ""}${line.calculatedAmount ? ` = ${escapeHtml(line.calculatedAmount)}` : ""}</strong><span>${escapeHtml(line.source_snippet || "")}</span></div><span class="badge blue">${escapeHtml(line.chargeType || line.frequency || "Fee")}</span></div>`).join("")}
          ${suggestionCount ? "" : `<div class="ai-review-empty"><strong>No suggestions were applied.</strong><span>The AI did not find a correction it could support with the contract text.</span></div>`}
          <div class="table-actions" style="margin-top:16px">
            <button class="btn primary" type="button" onclick="applyContractAiSuggestions()" ${fields.length || fees.length ? "" : "disabled"}>Apply Suggestions</button>
            <button class="btn ghost" type="button" onclick="closeModal()">Close</button>
          </div>`;
        document.getElementById("contractModal").classList.add("open");
        document.querySelector("#contractModal .modal-card")?.scrollTo({ top: 0 });
        showToast(`AI review finished: ${suggestionCount} suggestion${suggestionCount === 1 ? "" : "s"}.`);
      } catch (error) {
        showToast(error?.detail || error?.message || "AI review could not finish. Confirm Ollama is running.");
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = "Ask AI to Review";
        }
      }
    }

    function applyContractAiSuggestions() {
      const result = window.pendingContractAiReview || {};
      const changedLabels = [];
      for (const suggestion of result.suggestedFields || []) {
        if (!suggestion?.label || !suggestion?.value) continue;
        const canonical = reviewCanonicalLabel(suggestion.label);
        const index = reviewFields.findIndex(field => reviewCanonicalLabel(field.label) === canonical);
        const next = {
          ...(index >= 0 ? reviewFields[index] : {}),
          label: suggestion.label,
          value: suggestion.value,
          confidence: Number(suggestion.confidence || 65),
          source: `AI suggestion - verify against source. ${suggestion.source_snippet || ""}`.trim(),
          snippet: suggestion.source_snippet || "",
          aiDraft: true,
          approved: false
        };
        if (index >= 0) reviewFields.splice(index, 1, next);
        else reviewFields.push(next);
        changedLabels.push(canonical);
      }
      if ((result.suggestedFeeLines || []).length) {
        reviewFeeLines = normalizeReviewFeeLines(result.suggestedFeeLines.map(line => ({
          ...line,
          source: line.source_snippet || "AI suggestion - verify against source",
          approved: false
        })));
      }
      reviewSaveStatus = "AI suggestions applied as a draft. Verify each one against the PDF/OCR, then save.";
      closeModal();
      renderReview();
      requestAnimationFrame(() => {
        const firstLabel = changedLabels[0];
        const firstCard = firstLabel ? document.querySelector(`[data-review-label="${CSS.escape(firstLabel)}"]`) : null;
        firstCard?.scrollIntoView({ behavior: "smooth", block: "center" });
        firstCard?.classList.add("ai-draft-focus");
        window.setTimeout(() => firstCard?.classList.remove("ai-draft-focus"), 2400);
      });
      showToast(`${changedLabels.length} field${changedLabels.length === 1 ? "" : "s"} filled as AI drafts. Review and save each highlighted answer.`);
    }

    function approvedSummaryRow(label, value, badge) {
      return `<div class="metric-row"><div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(cleanQueueText(value, "Needs Review", 160))}</span></div><span class="badge blue">${escapeHtml(badge)}</span></div>`;
    }

    async function teachReviewCorrections() {
      if (!activeReviewContractId) {
        showToast("Open a contract in Review Queue first.");
        return;
      }
      const fields = currentReviewFieldsFromInputs();
      const feeLines = currentReviewFeeLinesFromInputs();
      if (!fields.length && !feeLines.length) {
        showToast("Nothing to teach yet. Correct at least one field or fee first.");
        return;
      }
      try {
        const result = await apiJson("/api/learning-rules", {
          method: "POST",
          body: JSON.stringify({ contractId: activeReviewContractId, fields, feeLines })
        });
        reviewSaveStatus = `Saved ${result.count || 0} teaching example${result.count === 1 ? "" : "s"}. Approval also teaches automatically, so this button is optional.`;
        renderReview();
        showToast(`Saved ${result.count || 0} teaching example${result.count === 1 ? "" : "s"}.`);
      } catch {
        showToast("Could not save the teaching correction.");
      }
    }

    function showToast(message) {
      const toast = document.getElementById("toast");
      toast.textContent = message;
      toast.style.display = "block";
      clearTimeout(window.toastTimer);
      window.toastTimer = setTimeout(() => toast.style.display = "none", 3600);
    }

    function reportClientError(message, detail = "") {
      console.error(message, detail);
      showToast("Something went wrong. Your data is still saved; refresh the page or restart the local server if it repeats.");
      const banner = document.getElementById("runtimeBanner");
      const title = document.getElementById("runtimeBannerTitle");
      const text = document.getElementById("runtimeBannerText");
      if (banner && title && text) {
        banner.classList.add("show");
        title.textContent = "App recovered from an error";
        const cleanDetail = String(detail || "").split("\n")[0].slice(0, 180);
        text.textContent = cleanDetail
          ? `The page caught an unexpected error: ${message}. ${cleanDetail}`
          : `The page caught an unexpected error: ${message}. Refresh the app, then continue from the last saved contract.`;
      }
    }

    function onElement(id, eventName, handler) {
      const element = document.getElementById(id);
      if (!element) return null;
      element.addEventListener(eventName, handler);
      return element;
    }

    window.addEventListener("error", event => {
      reportClientError(event.message || "Unexpected browser error", event.error?.stack || "");
    });

    window.addEventListener("unhandledrejection", event => {
      reportClientError("Unexpected app promise error", event.reason?.stack || event.reason || "");
    });

    function scheduleIdleTask(callback, timeout = 200) {
      if (typeof callback !== "function") return;
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(() => callback(), { timeout });
      } else {
        window.setTimeout(callback, Math.min(timeout, 250));
      }
    }

    function sectionNeedsLiveData(id) {
      const section = id || "dashboard";
      const now = Date.now();
      const freshMs = 30000;
      if (section === "dashboard") return backendOnline && (!dashboardLiveLoaded || (dashboardLiveLoadedAt && now - dashboardLiveLoadedAt > freshMs));
      if (section === "upload") return false;
      const loadedAt = liveDataLoadedAtBySection[section] || 0;
      if (section === "finance") return backendOnline && !financeSummaryData && !loadedAt;
      if (section === "categories") return backendOnline && !servicesSummaryData && !loadedAt;
      return backendOnline && (!backendDataLoaded || !loadedAt || now - loadedAt > freshMs);
    }

    let activeSectionRefreshPromise = null;
    let lastActiveRefreshStartedAt = 0;
    async function refreshActiveSectionLiveData({ force = false, allowHeavy = false } = {}) {
      if (!backendOnline || document.visibilityState === "hidden") return;
      if (activeSectionRefreshPromise) return activeSectionRefreshPromise;
      const section = activeSectionId();
      const now = Date.now();
      if (!force && now - lastActiveRefreshStartedAt < 5000) return;
      const loadedAt = section === "dashboard" ? dashboardLiveLoadedAt : (liveDataLoadedAtBySection[section] || 0);
      if (!force && loadedAt && now - loadedAt < 60000) return;
      lastActiveRefreshStartedAt = now;
      activeSectionRefreshPromise = (async () => {
      try {
        if (section === "dashboard") {
          dashboardLiveLoaded = false;
          dashboardLoadPromise = null;
          await loadDashboardLiveData({ renderAfter: true });
          return;
        }
        if (section === "finance" || section === "categories" || section === "admin") {
          await loadSectionSummary(section, { fresh: force });
          liveDataLoadedAtBySection[section] = Date.now();
          return;
        }
        if (allowHeavy && ["contracts", "review", "renewals", "compliance", "reports", "facilities", "vendors", "tasks", "exceptions"].includes(section)) {
          backendDataLoaded = false;
          backendLoadPromise = null;
          await loadBackendData({ renderAfter: true });
        }
      } catch (error) {
        console.warn("Live refresh skipped:", error);
      } finally {
        activeSectionRefreshPromise = null;
      }
      })();
      return activeSectionRefreshPromise;
    }

    let operationsSummaryLoadPromise = null;
    async function loadOperationsSummaryData() {
      if (operationsSummaryLoadPromise) return operationsSummaryLoadPromise;
      operationsSummaryLoadPromise = (async () => {
        if (!backendOnline && !(await checkBackendStatus())) return;
        const [contractResult, dashboard] = await Promise.all([
          apiJson(`/api/contracts?page=1&pageSize=${MAX_BACKGROUND_CONTRACTS}&compact=1`),
          apiJson("/api/dashboard").catch(() => dashboardData || {})
        ]);
        const records = Array.isArray(contractResult) ? contractResult : (contractResult.records || []);
        const reportTotal = Array.isArray(contractResult) ? records.length : Number(contractResult.total || records.length);
        if (records.length >= reportTotal) {
          const authoritative = records.map(normalizeContract).filter(record => record?.id).sort((a, b) =>
            (Date.parse(b.updatedAt || b.createdAt || b.uploadDate || "") || 0) -
            (Date.parse(a.updatedAt || a.createdAt || a.uploadDate || "") || 0)
          );
          replaceArray(contracts, authoritative);
          contractData = [...authoritative];
          contractsTotalCount = reportTotal;
        } else {
          mergeLiveContracts(records, reportTotal);
        }
        compactContractIndexLoaded = contractData.length >= Number(contractsTotalCount || 0);
        dashboardData = dashboard || dashboardData;
        liveDataLoadedAtBySection.renewals = Date.now();
        liveDataLoadedAtBySection.compliance = Date.now();
      })().finally(() => {
        operationsSummaryLoadPromise = null;
      });
      return operationsSummaryLoadPromise;
    }

    let reportsDataLoadPromise = null;
    let reportsDataLoadedAt = 0;
    async function loadAllReportOcrJobs() {
      const pageSize = 100;
      const first = await apiJson(`/api/ocr-jobs?page=1&pageSize=${pageSize}&lean=1`);
      const rows = Array.isArray(first) ? [...first] : [...(first.records || [])];
      const total = Array.isArray(first) ? rows.length : Number(first.total || rows.length);
      const pageCount = Math.ceil(total / pageSize);
      if (pageCount <= 1) return rows;
      const remaining = await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) =>
        apiJson(`/api/ocr-jobs?page=${index + 2}&pageSize=${pageSize}&lean=1`).catch(() => ({ records: [] }))
      ));
      remaining.forEach(result => rows.push(...(Array.isArray(result) ? result : (result.records || []))));
      return rows;
    }

    async function loadReportsPageData({ force = false } = {}) {
      if (reportsDataLoadPromise) return reportsDataLoadPromise;
      if (!force && reportsDataLoadedAt && Date.now() - reportsDataLoadedAt < 60000) return;
      reportsDataLoadPromise = (async () => {
        if (!backendOnline && !(await checkBackendStatus())) return;
        const [contractResult, dashboard, costRows, settings, facilityRows, vendorRows, categoryRows, utilityRows] = await Promise.all([
          apiJson("/api/contracts?page=1&pageSize=1000&compact=1"),
          apiJson("/api/dashboard").catch(() => dashboardData || {}),
          apiJson("/api/reports/cost").catch(() => costReport || []),
          apiJson("/api/admin-settings").catch(() => adminSettings || {}),
          apiJson("/api/facilities").catch(() => facilities || []),
          apiJson("/api/vendors?light=1&limit=2000").catch(() => vendorsData || []),
          apiJson("/api/categories").catch(() => categoryData || []),
          apiJson("/api/utility-accounts").catch(() => utilityAccounts || [])
        ]);
        const records = Array.isArray(contractResult) ? contractResult : (contractResult.records || []);
        mergeLiveContracts(records, Array.isArray(contractResult) ? records.length : contractResult.total);
        compactContractIndexLoaded = contractData.length >= Number(contractsTotalCount || 0);
        dashboardData = dashboard || dashboardData;
        replaceArray(costReport, Array.isArray(costRows) ? costRows : costReport);
        adminSettings = settings || adminSettings;
        replaceArray(facilities, Array.isArray(facilityRows) ? facilityRows : facilities);
        replaceArray(reportVendorsData, Array.isArray(vendorRows) ? vendorRows : vendorsData);
        categoryData = Array.isArray(categoryRows) ? categoryRows : categoryData;
        utilityAccounts = Array.isArray(utilityRows) ? utilityRows : utilityAccounts;
        reportsDataLoadedAt = Date.now();
        liveDataLoadedAtBySection.reports = Date.now();
      })().finally(() => {
        reportsDataLoadPromise = null;
      });
      return reportsDataLoadPromise;
    }

    let pendingSectionRenderFrame = 0;
    let pendingSectionRenderId = "";
    function renderActiveSectionOnly(id = activeSectionId()) {
      pendingSectionRenderId = id;
      if (pendingSectionRenderFrame) return;
      pendingSectionRenderFrame = window.requestAnimationFrame(() => {
        pendingSectionRenderFrame = 0;
        const sectionId = pendingSectionRenderId || activeSectionId();
        pendingSectionRenderId = "";
        renderActiveSectionNow(sectionId);
      });
    }

    function renderActiveSectionNow(id = activeSectionId()) {
      try {
        renderSectionContent(id);
      } catch (error) {
        reportClientError("Active page render failed", error?.stack || error || "");
      }
    }

    function renderSectionContent(id = activeSectionId()) {
      if (sectionNeedsLiveData(id)) {
        const token = ++sectionRenderToken;
        showToast("Loading live records...");
        const loadPromise = id === "dashboard"
          ? loadDashboardLiveData({ renderAfter: false })
          : (id === "finance" || id === "categories")
            ? loadSectionSummary(id)
            : (id === "renewals" || id === "compliance")
              ? loadOperationsSummaryData()
              : id === "reports"
                ? loadReportsPageData()
            : loadBackendData({ renderAfter: false });
        loadPromise.then(() => {
          if (token === sectionRenderToken) renderSectionContent(id);
        }).catch(error => {
          reportClientError("Live records did not load", error?.stack || error || "");
        });
        return;
      }
      if (id === "dashboard") renderDashboard();
      else if (id === "contracts") renderContracts();
      else if (id === "builder") renderContractBuilderPage();
      else if (id === "upload") {
        renderBulkUploadActivity();
        checkShareSyncStatus();
        applyPendingBuilderDraftToUploadForm();
        updateUploadShareSyncDestination();
      } else if (id === "review") {
        renderReviewQueue();
      } else if (id === "review-detail") {
        renderReview();
      } else if (id === "ocrqueue") renderOcrQueue();
      else if (id === "facilities") renderFacilities();
      else if (id === "vendors") {
        loadFullVendorsForPage();
        renderVendors();
      }
      else if (id === "categories") renderCategories();
      else if (id === "renewals" || id === "compliance") renderRenewalsAndCompliance();
      else if (id === "finance") renderFinancePage();
      else if (id === "reports") {
        setReportView("home");
        renderReports();
      } else if (id === "weather") renderWeather();
      else if (id === "invoices") renderInvoices();
      else if (id === "exceptions") renderExceptions();
      else if (id === "clauses") renderClauses();
      else if (id === "tasks") renderTasks();
      else if (id === "backups") renderBackupRecords();
      else if (id === "admin") {
        renderAdminSettings();
        renderSystemReadiness();
        if (document.getElementById("aiAgentStatus")) renderAiStatus();
        if (document.getElementById("utilityAccountCount")) renderUtilityAccounts();
      }
    }

    let fullVendorsLoaded = false;
    let fullVendorsLoading = false;
    async function loadFullVendorsForPage() {
      if (fullVendorsLoaded || fullVendorsLoading || !backendOnline) return;
      fullVendorsLoading = true;
      try {
        const records = await apiJson("/api/vendors?light=1&limit=500");
        replaceArray(vendorsData, dedupeRecords(Array.isArray(records) ? records : [], "name"));
        fullVendorsLoaded = true;
        if (activeSectionId() === "vendors") renderVendors();
      } catch {
        showToast("Vendor details are still loading. Try again in a moment.");
      } finally {
        fullVendorsLoading = false;
      }
    }

    let financeFacilitiesLoadingPromise = null;
    async function ensureFinanceFacilitiesLoaded({ rerender = false } = {}) {
      if (!backendOnline) return;
      const hasBedsLoaded = facilityMasterOptions().some(facility => Number(facility.beds || 0) > 0);
      if (hasBedsLoaded) return;
      if (!financeFacilitiesLoadingPromise) {
        financeFacilitiesLoadingPromise = apiJson("/api/facilities")
          .then(records => {
            replaceArray(facilities, dedupeRecords([
              ...((adminSettings.facilityProfiles || []).map(normalizeFacilityRecord)),
              ...((Array.isArray(records) ? records : []).map(normalizeFacilityRecord))
            ], "name"));
          })
          .finally(() => {
            financeFacilitiesLoadingPromise = null;
          });
      }
      await financeFacilitiesLoadingPromise;
      if (rerender && activeSectionId() === "finance") renderFinancePage();
    }

    function switchSection(id, options = {}) {
      if (!document.getElementById(id)) return;
      if (!canAccessSection(id)) {
        const fallback = firstAllowedSection();
        showToast("This page is not available for your role.");
        if (fallback && fallback !== id) return switchSection(fallback, options);
        return;
      }
      if (activeSectionId() === id) {
        renderSectionContent(id);
        if (id === "review" && !reviewQueueRefreshPending) {
          loadSectionSummary("review", { fresh: true }).catch(() => {});
        }
        return;
      }
      const scroller = document.querySelector("main");
      const keepY = scroller ? scroller.scrollTop : window.scrollY;
      document.querySelectorAll(".section").forEach(section => section.classList.toggle("active", section.id === id));
      document.querySelectorAll(".nav-button").forEach(button => button.classList.toggle("active", button.dataset.section === id));
      const keepCurrentItem = id === "review-detail" && activeWorkContext.itemId;
      setActiveWorkContext({
        itemId: keepCurrentItem ? activeWorkContext.itemId : "",
        itemName: keepCurrentItem ? activeWorkContext.itemName : "",
        action: keepCurrentItem ? activeWorkContext.action : `Viewing ${sectionPresenceLabel(id)}`,
        immediate: true
      });
      if (document.getElementById(id) && location.hash !== `#${id}`) {
        const nextUrl = `${location.pathname}${location.search}#${id}`;
        if (options.replace) history.replaceState({ appSection: id }, "", nextUrl);
        else if (!options.fromHistory) history.pushState({ appSection: id }, "", nextUrl);
      }
      const token = ++sectionRenderToken;
      requestAnimationFrame(() => {
        if (token !== sectionRenderToken) return;
        window.setTimeout(() => {
          if (token !== sectionRenderToken) return;
          renderSectionContent(id);
          if (id === "review") {
            const queueRows = document.querySelectorAll("#ocrJobRows tr").length;
            if (!queueRows && !reviewQueueRefreshPending) {
              refreshReviewQueueDirect();
            }
          }
        }, 0);
      });
      requestAnimationFrame(() => {
        if (scroller) scroller.scrollTop = keepY;
        else window.scrollTo(0, keepY);
      });
    }

    function startNewContractUpload() {
      switchSection("upload");
      requestAnimationFrame(() => {
        const fileInput = document.getElementById("fileInput");
        fileInput?.scrollIntoView({ block: "center" });
        fileInput?.focus?.();
        showToast("Choose the new contract PDF. Pick facility/vendor/category if you know them, then upload.");
      });
    }

    function showContractsView(mode = "all") {
      activeContractView = mode || "all";
      contractFinderShowAll = mode === "all" || mode !== "search";
      const search = document.getElementById("contractSearch");
      const status = document.getElementById("statusFilter");
      const risk = document.getElementById("riskFilter");
      const facility = document.getElementById("facilityFilter");
      const vendor = document.getElementById("vendorFilter");
      const category = document.getElementById("categoryFilter");
      const history = document.getElementById("historyFilter");
      if (search && mode === "all") search.value = "";
      if (status) status.value = "";
      if (risk) risk.value = "";
      if (facility && mode === "all") facility.value = "";
      if (vendor && mode === "all") vendor.value = "";
      if (category && mode === "all") category.value = "";
      if (history && mode === "all") history.value = "current";
      currentPage = 1;
      renderContracts();
      switchSection("contracts");
    }

    function emptyContractValue(value) {
      const text = String(value || "").trim();
      return !text || /^(needs review|needs classification|unknown|tbd|not found|n\/a|none)$/i.test(text);
    }

    function contractViewMatches(c) {
      if (!activeContractView || activeContractView === "search" || activeContractView === "all") return true;
      const statusText = String(c.contractStatus || c.status || c.reviewStatus || "").toLowerCase();
      if (activeContractView === "needs-review") return /needs review|pending|ocr/i.test(statusText);
      if (activeContractView === "approved") return /approved/i.test(statusText) && !/archived|terminated|expired|replaced|superseded/i.test(statusText);
      if (activeContractView === "active") return /active|approved/i.test(statusText) && !/archived|terminated/i.test(statusText);
      if (activeContractView === "auto-renewal") return /yes|auto|renew/i.test(String(c.autoRenewal || c.renewalTerm || ""));
      if (activeContractView === "missing-fee") return emptyContractValue(c.fee) && emptyContractValue(c.rate) && emptyContractValue(c.spend);
      if (activeContractView === "missing-vendor") return emptyContractValue(c.vendor);
      if (activeContractView === "no-end-date") return emptyContractValue(c.end) || /no fixed/i.test(String(c.end || ""));
      return true;
    }

    function updateContractViewButtons() {
      document.querySelectorAll("[data-contract-view]").forEach(button => {
        button.classList.toggle("active", button.dataset.contractView === activeContractView);
      });
    }

    async function dashboardOpenAttention() {
      switchSection("review");
      loadSectionSummary("review", { fresh: true }).catch(() => {
        showToast("Review Queue opened. Live records are still loading.");
      });
    }

    function dashboardOpenRenewals() {
      const contract = dashboardRenewalItems()[0]?.contract || null;
      if (contract?.id) openContract(contract.id);
      else switchSection("renewals");
    }

    function dashboardRowNeedsReview(row = {}, contract = {}) {
      const text = [row.issue, row.action, contract.status, contract.reviewStatus].filter(Boolean).join(" ").toLowerCase();
      return /review|required|missing|ocr|classification|approve/.test(text)
        || contract.status === "Needs Review"
        || contract.reviewStatus === "OCR Complete"
        || contract.reviewStatus === "Pending OCR";
    }

    function dashboardFindContractByAlert(row = {}) {
      const rowName = String(row.contract || row.name || "").trim();
      const rowVendor = String(row.vendor || "").trim();
      const rowFacility = String(row.facility || "").trim();
      const rowCategory = String(row.category || row.service || "").trim();
      const haystack = [rowName, rowVendor, rowFacility, rowCategory, row.issue].filter(Boolean).join(" ").toLowerCase();
      const pools = [dashboardContracts(), contracts.filter(contractInUserScope)];
      const matchInPool = pool => {
        const candidates = (pool || []).filter(Boolean);
        return candidates.find(c => c.id === row.contractId)
          || candidates.find(c => rowName && sameMasterName(c.name, rowName))
          || candidates.find(c => {
            const name = String(c.name || "").toLowerCase();
            const wanted = rowName.toLowerCase();
            return wanted && name && (name.includes(wanted) || wanted.includes(name));
          })
          || candidates.find(c => rowVendor && sameVendorName(c.vendor, rowVendor) && (!rowFacility || sameMasterName(c.facility, rowFacility)))
          || candidates.find(c => haystack && [c.name, c.vendor, c.facility, c.category, c.services].some(value => {
            const text = String(value || "").toLowerCase();
            return text && text.length > 3 && (haystack.includes(text) || text.includes(rowName.toLowerCase()));
          }))
          || null;
      };
      return matchInPool(pools[0]) || matchInPool(pools[1]) || null;
    }

    async function dashboardFindContractFromBackend(row = {}) {
      if (!backendOnline) return null;
      const contractId = String(row.contractId || "").trim();
      const contractName = String(row.contract || row.name || "").trim();
      if (contractId) {
        try {
          return upsertLiveContract(await ensureFullContractRecord(contractId));
        } catch (error) {
          // Fall through to name search when an alert row has a stale or missing id.
        }
      }
      if (!contractName) return null;
      try {
        const result = await apiJson(`/api/contracts?q=${encodeURIComponent(contractName)}&page=1&pageSize=25&compact=1`);
        const records = Array.isArray(result) ? result : (result.records || []);
        const normalized = records.map(normalizeContract).filter(contractInUserScope);
        const exact = normalized.find(c => sameMasterName(c.name, contractName));
        const partial = normalized.find(c => {
          const name = String(c.name || "").toLowerCase();
          const wanted = contractName.toLowerCase();
          return name && wanted && (name.includes(wanted) || wanted.includes(name));
        });
        const found = exact || partial || normalized[0] || null;
        return found ? upsertLiveContract(found) : null;
      } catch (error) {
        return null;
      }
    }

    async function dashboardOpenContractTarget(contractId = "", contractName = "", issue = "") {
      const row = { contractId, contract: contractName, issue };
      let contract = dashboardFindContractByAlert(row);
      if (!contract?.id) contract = await dashboardFindContractFromBackend(row);
      if (contract?.id) {
        if (dashboardRowNeedsReview(row, contract)) await openReviewContractRecord(contract.id);
        else openContract(contract.id);
        return;
      }
      showToast("Contract record is still loading. Opening Review Queue.");
      dashboardOpenAttention();
    }

    async function dashboardOpenAlert(index) {
      const row = dashboardAttentionRows()[index] || alerts[index] || {};
      let contract = dashboardFindContractByAlert(row);
      if (!contract?.id) contract = await dashboardFindContractFromBackend(row);
      if (row.action === "review") {
        if (contract?.id) await openReviewContractRecord(contract.id);
        else dashboardOpenAttention();
        return;
      }
      if (row.action === "vendors") {
        switchSection("vendors");
        return;
      }
      if (row.action === "report") {
        openReport(row.reportId || "needs-correction");
        return;
      }
      if (contract?.id) {
        if (dashboardRowNeedsReview(row, contract)) await openReviewContractRecord(contract.id);
        else openContract(contract.id);
      }
      else dashboardOpenAttention();
    }

    function userFacilityScope() {
      const role = String(currentUser?.role || "").toLowerCase();
      const raw = String(currentUser?.facility || "All").trim();
      if (!raw || /^all$/i.test(raw) || role === "admin" || role === "contract department" || currentUser?.publicMode) {
        return { all: true, facilities: [], label: "All facilities" };
      }
      const facilities = raw
        .split(/[;,|]/)
        .map(item => item.trim())
        .filter(Boolean);
      return {
        all: !facilities.length,
        facilities,
        label: facilities.length ? facilities.join(", ") : "All facilities"
      };
    }

    function contractInUserScope(contract = {}) {
      const scope = userFacilityScope();
      if (scope.all) return true;
      const contractFacilities = String(contract.facility || contract.facilities || "")
        .split(/[;,|]/)
        .map(item => item.trim())
        .filter(Boolean);
      return contractFacilities.some(name => scope.facilities.some(allowed => sameMasterName(name, allowed)));
    }

    function dashboardContracts() {
      const source = financeContractData.length ? financeContractData : contractData;
      return source.filter(contractInUserScope);
    }

    function dashboardOcrJobs() {
      return ocrJobs.filter(job => contractInUserScope(contractForJob(job)));
    }

    function dashboardAttentionRows() {
      const scopedContracts = dashboardContracts();
      const missingCoreFields = contract => {
        const missing = [];
        if (!contractHasUsableValue(contract.category || contract.contractType || contract.agreementType || contract.services)) missing.push("Contract type");
        if (!contractHasUsableValue(contract.vendor)) missing.push("Vendor Name");
        if (!contractHasUsableValue(contract.effectiveDate || contract.startOfServices || contract.start || contract.signatureDate || contract.signedDate)) missing.push("Effective date");
        if (!contractHasUsableValue(contract.fee || contract.rate || contract.contractValue || contract.monthlyCost || contract.annualCost || contract.spend)) missing.push("Cost");
        if (!contractHasUsableValue(contract.autoRenewal || contract.renewal)) missing.push("Auto renew");
        if (!contractHasUsableValue(contract.terminationClause || contract.noticePeriod || contract.termination)) missing.push("How to terminate");
        return missing;
      };
      const rows = alerts.map((row, index) => ({
        ...row,
        owner: row.owner || "Contract Dept",
        due: row.due || "Today",
        severity: index < 2 ? "red" : "amber"
      }));
      dashboardOcrJobs()
        .filter(job => job.status && job.status !== "Complete")
        .slice(0, 5)
        .forEach(job => rows.push({
          contract: contractForJob(job).name || job.contractId || "Uploaded contract",
          facility: contractForJob(job).facility || "Needs review",
          issue: `OCR ${job.status || "needs attention"}${job.error ? `: ${job.error}` : ""}`,
          due: "Today",
          owner: "Contract Dept",
          severity: "red",
          action: "review"
        }));
      scopedContracts
        .filter(c => c.status === "Needs Review" || c.reviewStatus === "OCR Complete" || c.reviewStatus === "Pending OCR")
        .slice(0, 6)
        .forEach(c => rows.push({
          contract: c.name,
          contractId: c.id,
          facility: c.facility || "Needs review",
          issue: "Review OCR fields before contract becomes official",
          due: "Today",
          owner: c.owner || "Contract Dept",
          severity: "amber"
        }));
      scopedContracts
        .map(c => ({ contract: c, missing: missingCoreFields(c) }))
        .filter(row => row.missing.length)
        .slice(0, 4)
        .forEach(({ contract: c, missing }) => rows.push({
          contract: c.name,
          contractId: c.id,
          facility: c.facility || "Needs review",
          issue: `Missing required field: ${missing.join(", ")}`,
          due: "Before approval",
          owner: c.owner || "Contract Dept",
          severity: "amber"
        }));
      scopedContracts
        .filter(c => isAutoRenewing(c.autoRenewal) && !contractHasUsableValue(c.terminationClause) && !contractHasUsableValue(c.noticePeriod))
        .slice(0, 4)
        .forEach(c => rows.push({
          contract: c.name,
          contractId: c.id,
          facility: c.facility || "Needs review",
          issue: "Auto-renewal found but no notice/termination language saved",
          due: "Before renewal",
          owner: c.owner || "Contract Dept",
          severity: "red"
        }));
      vendorsData
        .filter(v => (!contractHasUsableValue(v.phone) && !contractHasUsableValue(v.email)) || !contractHasUsableValue(v.mailingAddress))
        .slice(0, 3)
        .forEach(v => rows.push({
          contract: v.name,
          facility: "Vendor Master",
          issue: "Vendor card missing address or phone/email",
          due: "This week",
          owner: "Contract Dept",
          severity: "amber",
          action: "vendors"
        }));
      return rows.slice(0, 12);
    }

    function dashboardOpenDataGap(kind = "all") {
      const search = document.getElementById("contractSearch");
      const status = document.getElementById("statusFilter");
      const risk = document.getElementById("riskFilter");
      const facility = document.getElementById("facilityFilter");
      const scope = userFacilityScope();
      if (status) status.value = "";
      if (risk) risk.value = "";
      if (facility && !scope.all && scope.facilities.length === 1) facility.value = scope.facilities[0];
      if (search) {
        const searchTerms = {
          review: "Needs Review",
          vendor: "Needs Classification",
          dates: "Needs Review",
          cost: "TBD",
          payment: "Payment terms",
          renewal: "Auto",
          notice: "Unknown"
        };
        search.value = searchTerms[kind] || "";
      }
      contractFinderShowAll = false;
      activeContractView = "search";
      currentPage = 1;
      renderContracts();
      switchSection("contracts");
    }

    function dashboardActionHtml(item) {
      return `
        <div class="decision-item clickable-row" onclick="${item.action}">
          <i class="severity ${item.severity || "amber"}"></i>
          <div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></div>
          <button class="btn ghost" onclick="event.stopPropagation(); ${item.action}">${escapeHtml(item.button || "Open")}</button>
        </div>
      `;
    }

    function dashboardDateValue(contract = {}) {
      return contract.terminationDeadline || contract.noticeDeadline || contract.renewalDate || contract.renewal || contract.end || contract.expirationDate || contract.endDate || "";
    }

    function dashboardDaysUntil(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      date.setHours(0, 0, 0, 0);
      return Math.ceil((date - today) / 86400000);
    }

    function dashboardDateObject(value) {
      const text = String(value || "").trim();
      if (!text || /^(needs review|needs classification|unknown|not found|tbd|n\/a|na)$/i.test(text)) return null;
      const date = new Date(text);
      if (Number.isNaN(date.getTime())) return null;
      date.setHours(0, 0, 0, 0);
      return date;
    }

    function termIntervalFromText(value = "") {
      const text = String(value || "").toLowerCase();
      if (!text || reviewValueIsEmpty(text)) return null;
      const numberWords = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
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

    function currentRenewalBaseDate(contract = {}, baseDate, noticeDays = 0) {
      if (!isAutoRenewing(contract.autoRenewal) || !baseDate) return { date: baseDate, rolled: false };
      const interval = termIntervalFromText(contract.renewalTerm || contract.renewalLength || contract.initialContractLength || contract.contractLength || contract.term)
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

    function formatDashboardDate(date) {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${date.getFullYear()}-${month}-${day}`;
    }

    function noticeDaysFromContract(contract = {}) {
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

    function contractRenewalAlert(contract = {}) {
      const explicitDeadline = dashboardDateObject(contract.terminationDeadline || contract.noticeDeadline);
      if (explicitDeadline) {
        const days = dashboardDaysUntil(explicitDeadline);
        return { contract, targetDate: formatDashboardDate(explicitDeadline), days, basis: "Notice deadline", noticeDays: 0 };
      }
      const calculatedInitialEnd = initialTermEndDate(
        contract.effectiveDate || contract.startOfServices || contract.start || contract.signatureDate || contract.signedDate,
        contract.initialContractLength || contract.contractLength || contract.term
      );
      const savedBaseDate = dashboardDateObject(contract.renewalDate || contract.renewal || contract.end || contract.expirationDate || contract.endDate);
      const noticeDays = noticeDaysFromContract(contract);
      const { date: baseDate, rolled } = currentRenewalBaseDate(contract, savedBaseDate || calculatedInitialEnd, noticeDays);
      if (!baseDate) return null;
      const target = new Date(baseDate);
      const basis = isAutoRenewing(contract.autoRenewal) && noticeDays
        ? (rolled ? "Next renewal notice deadline" : "Calculated notice deadline")
        : calculatedInitialEnd && !savedBaseDate ? "Initial term end" : "End / renewal date";
      if (isAutoRenewing(contract.autoRenewal) && noticeDays) target.setDate(target.getDate() - noticeDays);
      const days = dashboardDaysUntil(target);
      return { contract, targetDate: formatDashboardDate(target), days, basis, noticeDays, baseDate: formatDashboardDate(baseDate) };
    }

    function contractEndDateDisplay(contract = {}) {
      const savedEnd = contract.end || contract.expirationDate || contract.endDate || "";
      const shown = endDateDisplay(savedEnd, contract.autoRenewal);
      const alert = contractRenewalAlert(contract);
      if (alert?.baseDate && (!savedEnd || /needs review|unknown|not found|tbd/i.test(String(shown)))) {
        return isAutoRenewing(contract.autoRenewal)
          ? `${alert.baseDate} next renewal`
          : `${alert.baseDate} calculated`;
      }
      return shown;
    }

    function dashboardRenewalItems(source = dashboardContracts()) {
      return source
        .map(contract => {
          const alert = contractRenewalAlert(contract);
          if (!alert || alert.days === null || alert.days < 0 || alert.days > 90) return null;
          const { targetDate, days } = alert;
          const window = days <= 30 ? "30 days" : days <= 60 ? "60 days" : "90 days";
          return { ...alert, targetDate, days, window };
        })
        .filter(Boolean)
        .sort((a, b) => a.days - b.days);
    }

    function facilityRecordForName(name = "") {
      const wanted = String(name || "").trim();
      if (!wanted) return null;
      const options = facilityMasterOptions();
      const wantedKey = facilityAliasKey(wanted);
      const exactName = options.find(f => facilityAliasKey(f.name) === wantedKey);
      if (exactName) return exactName;
      const exactIdentity = options.filter(f => [f.approvedDba, f.legalName, f.dba, f.shortName, f.commonName]
        .some(value => facilityAliasKey(value) === wantedKey));
      if (exactIdentity.length === 1) return exactIdentity[0];
      const exactAliases = options.filter(f => Array.isArray(f.aliases)
        && f.aliases.some(alias => facilityAliasKey(alias) === wantedKey));
      if (exactAliases.length === 1) return exactAliases[0];
      if (wantedKey.length < 6) return null;
      const partial = options.filter(f => [f.name, f.approvedDba, f.legalName, f.dba, f.shortName, f.commonName, ...(Array.isArray(f.aliases) ? f.aliases : [])]
        .some(value => {
          const key = facilityAliasKey(value);
          return key && (key.includes(wantedKey) || wantedKey.includes(key));
        }));
      return partial.length === 1 ? partial[0] : null;
    }

    function facilityNamesMatch(a = "", b = "") {
      if (sameMasterName(a, b)) return true;
      const left = facilityRecordForName(a);
      const right = facilityRecordForName(b);
      if (left && right && sameMasterName(left.name, right.name)) return true;
      if (left && sameMasterName(left.name, b)) return true;
      if (right && sameMasterName(a, right.name)) return true;
      return false;
    }

    function contractFacilityNames(contract = {}) {
      return uniqueTextList([
        ...splitMultiValue(contract.facilities || ""),
        ...splitMultiValue(contract.facility || ""),
        contract.facilityName,
        contract.facilityLegalName,
        contract.facilityDba,
        contract.serviceAddress
      ]);
    }

    function facilityBedsForContract(contract = {}) {
      const directBeds = Number(contract.beds || contract.bedCount || contract.quantityOfBeds || 0);
      if (directBeds) return directBeds;
      const seen = new Set();
      const matchedBeds = contractFacilityNames(contract)
        .map(name => facilityRecordForName(name))
        .filter(Boolean)
        .filter(facility => {
          const key = facilityAliasKey(facility.name || facility.legalName || facility.commonName);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map(facility => Number(facility?.beds || facility?.bedCount || facility?.bed_count || facility?.Bed || facility?.Beds || 0) || 0)
        .filter(Boolean);
      if (matchedBeds.length > 1) return matchedBeds.reduce((sum, beds) => sum + beds, 0);
      return matchedBeds[0] || 0;
    }

    function facilityCensusForContract(contract = {}) {
      const directCensus = Number(contract.averageDailyCensus || contract.currentCensus || 0);
      if (directCensus) return directCensus;
      const seen = new Set();
      const matchedCensus = contractFacilityNames(contract)
        .map(name => facilityRecordForName(name))
        .filter(Boolean)
        .filter(facility => {
          const key = facilityAliasKey(facility.name || facility.legalName || facility.commonName);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map(facility => Number(facility?.averageDailyCensus || facility?.currentCensus || 0) || 0)
        .filter(Boolean);
      const totalCensus = matchedCensus.reduce((sum, census) => sum + census, 0);
      const totalBeds = facilityBedsForContract(contract);
      return totalBeds && totalCensus > totalBeds ? 0 : totalCensus;
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

    function provenMonthlyCostValue(contract = {}) {
      const value = contract.monthlyCost || contract.monthlySpend || "";
      if (!value) return "";
      const proof = [value, contract.billingFrequency, contract.serviceFrequency, contract.paymentFrequency].filter(Boolean).join(" ");
      return /\b(?:per\s+)?(?:month|monthly|mo)\b|\/\s*(?:month|mo)\b/i.test(proof) ? value : "";
    }

    function contractHasNoFinancialImpact(contract = {}) {
      const typeText = [contract.contractType, contract.agreementType, contract.documentType, contract.category, contract.services, contract.serviceType].filter(Boolean).join(" ");
      const moneyText = [contract.fee, contract.rate, contract.cost, contract.price, contract.paymentTerms, contract.servicePricingDetail, contract.feeDetails].filter(Boolean).join(" ");
      const explicitNoMoney = /\b(no\s+(?:cost|charge|fee|payment|financial\s+impact|money)|without\s+(?:cost|charge|payment)|not\s+applicable)\b/i.test(moneyText);
      const nonFinancialType = /\b(business\s+associate\s+agreement|baa|data\s+privacy|confidentiality|non[-\s]?disclosure|nda)\b/i.test(typeText);
      return explicitNoMoney || (nonFinancialType && !moneyToNumber(contractFinanceAnnualText(contract)));
    }

    function annualizedContractSpend(contract = {}) {
      if (contractHasNoFinancialImpact(contract)) return 0;
      const annual = annualizedMoneyValue(contract.annualCost || contract.annualSpend || contract.totalAnnualSpend, "year");
      if (annual) return annual;
      const legacyAnnual = annualizedMoneyValue(contract.spend || contract.contractValue, "");
      if (legacyAnnual) return legacyAnnual;
      const monthly = annualizedMoneyValue(provenMonthlyCostValue(contract), "month");
      if (monthly) return monthly;
      return 0;
    }

    function contractFinanceCostText(contract = {}) {
      const savedFields = Array.isArray(contract.extractedFields) ? contract.extractedFields : [];
      const financeLabels = [
        "cost",
        "fee",
        "fees",
        "rate / fee",
        "rate",
        "rates",
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
        .filter(field => financeLabels.includes(reviewCanonicalLabel(field.label || "")) || financeLabels.some(label => reviewCanonicalLabel(field.label || "").includes(label)))
        .map(field => [field.value, field.source].filter(Boolean).join(" "))
        .join(" ");
      const feeLines = Array.isArray(contract.extractedFeeLines) ? contract.extractedFeeLines : [];
      const feeLineText = feeLines.map(line => [line.service, line.unit, line.rate, line.amount, line.fee, line.frequency, feeSourceSnippet(line)].filter(Boolean).join(" ")).join(" ");
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
        "rate / fee",
        "rate",
        "rates",
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
        .filter(field => financeLabels.includes(reviewCanonicalLabel(field.label || "")) || financeLabels.some(label => reviewCanonicalLabel(field.label || "").includes(label)))
        .map(field => field.value)
        .filter(Boolean)
        .join(" ");
      const feeLineText = (Array.isArray(contract.extractedFeeLines) ? contract.extractedFeeLines : [])
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
        extractedFinance,
        feeLineText
      ].filter(Boolean).join(" ");
    }

    function reviewFieldByCanonical(fields = [], canonical = "") {
      return (fields || []).find(field => reviewCanonicalLabel(field?.label || "") === canonical);
    }

    function quantityNumber(value = "") {
      const match = String(value || "").replace(/,/g, "").match(/\b(\d+(?:\.\d+)?)\b/);
      return match ? Number(match[1]) || 0 : 0;
    }

    function financeFrequencyMultiplier(value = "") {
      const text = String(value || "").toLowerCase();
      if (/\b(one[-\s]?time|once|non[-\s]?recurring|nrc)\b/.test(text)) return { multiplier: 1, label: "one-time" };
      if (/\b(semi[-\s]?annual|twice\s+(?:a\s+)?year|2\s*(?:x|times)\s+(?:a\s+)?year)\b/.test(text)) return { multiplier: 2, label: "semi-annual" };
      if (/\b(per\s+)?(year|yr|annual|annually|yearly)\b|\/\s*(year|yr)\b/.test(text)) return { multiplier: 1, label: "annual" };
      if (/\b(per\s+)?(quarter|qtr|quarterly)\b|\/\s*qtr\b/.test(text)) return { multiplier: 4, label: "quarterly" };
      if (/\b(per\s+)?(month|monthly|mo)\b|\/\s*(month|mo)\b/.test(text)) return { multiplier: 12, label: "monthly" };
      if (/\b(per\s+)?(week|weekly|wk)\b|\/\s*(week|wk)\b/.test(text)) return { multiplier: 52, label: "weekly" };
      if (/\b(per\s+)?(day|daily|per diem|ppd)\b|\/\s*day\b/.test(text)) return { multiplier: 365, label: "daily" };
      return { multiplier: 0, label: "" };
    }

    function calculateReviewAnnualSpend(fields = []) {
      const annualField = reviewFieldByCanonical(fields, "annual spend");
      const explicitAnnual = annualizedMoneyValue(annualField?.value || "", "year");
      if (explicitAnnual) return { annual: explicitAnnual, status: "ready", source: "Annual spend entered by reviewer." };
      const costField = reviewFieldByCanonical(fields, "cost");
      const quantityField = reviewFieldByCanonical(fields, "quantity of services");
      const frequencyField = reviewFieldByCanonical(fields, "billing frequency");
      const rateText = String(costField?.value || "").trim();
      const rate = moneyToNumber(rateText);
      if (!rate) return { annual: 0, status: "needs-rate", source: "Needs cost/rate." };
      if (/\b\d+(?:\.\d+)?\s*%|\bpercent\b/.test(rateText)) return { annual: 0, status: "percent-rate", source: "Percent or fee schedule saved as rate; annual spend needs invoice/volume data." };
      const rateFrequency = financeFrequencyMultiplier(rateText);
      const explicitFrequency = financeFrequencyMultiplier(frequencyField?.value || "");
      const frequency = explicitFrequency.multiplier ? explicitFrequency : rateFrequency;
      const unitRate = /\b(?:per|\/)\s*(?:mile|gallon|visit|pickup|trip|load|test|box|container|meal|session|service\s*call|hour|resident|patient|bed|resident\s*day|patient\s*day|diem|trap|unit|service|delivery|square\s*(?:foot|feet|ft)|sq\.?\s*ft|linear\s*(?:foot|feet|ft)|lf|yard|ton)\b/i.test(rateText);
      const quantity = quantityNumber(quantityField?.value || "");
      if (unitRate && !quantity) return { annual: 0, status: "needs-quantity", source: "Rate saved; needs quantity/volume for annual spend." };
      if (!frequency.multiplier) return { annual: 0, status: "needs-frequency", source: "Rate saved; needs billing frequency for annual spend." };
      const annual = rate * (unitRate ? quantity : 1) * frequency.multiplier;
      return annual ? {
        annual,
        status: "ready",
        source: `Calculated from ${rateText}${unitRate ? ` x ${quantityField?.value || quantity}` : ""} x ${frequency.label}.`
      } : { annual: 0, status: "needs-data", source: "Needs enough finance data to calculate." };
    }

    function contractHasFinanceCost(contract = {}) {
      const financeText = contractFinanceCostText(contract);
      return reviewCostValueIsUsable(financeText, financeText);
    }

    function monthlyContractSpend(contract = {}) {
      const monthly = moneyToNumber(contract.monthlyCost || contract.monthlySpend);
      if (monthly) return monthly;
      const annual = annualizedContractSpend(contract);
      return annual ? annual / 12 : 0;
    }

    function estimatedPpdForContract(contract = {}) {
      const beds = facilityBedsForContract(contract);
      const annual = annualizedContractSpend(contract);
      return beds && annual ? annual / beds / 365 : 0;
    }

    function financeMoneySource(contract = {}) {
      if (moneyToNumber(contract.annualCost || contract.annualSpend || contract.spend || contract.contractValue || contract.totalAnnualSpend)) return "Annual / spend field";
      if (moneyToNumber(contract.monthlyCost || contract.monthlySpend)) return "Monthly cost x 12";
      if (moneyToNumber(contractFinanceCostText(contract))) return annualizedContractSpend(contract) ? "Calculated from saved cost/rate" : "Rate saved; needs quantity/frequency";
      if (contractHasFinanceCost(contract)) return "Fee saved; needs quantity for annual spend";
      return "Needs money field";
    }

    function contractFinancialCategory(contract = {}) {
      return contract.category || contract.services || contract.serviceType || contract.contractType || "Uncategorized";
    }

    function financialRowsForContracts(source = dashboardContracts()) {
      return source.map(contract => {
        const annual = annualizedContractSpend(contract);
        const monthly = monthlyContractSpend(contract);
        const beds = facilityBedsForContract(contract);
        const census = facilityCensusForContract(contract);
        const costBedMonth = beds && monthly ? monthly / beds : 0;
        const ppd = census && annual ? annual / census / 365 : 0;
        return {
          contract,
          annual,
          monthly,
          beds,
          census,
          costBedMonth,
          ppd,
          vendor: contract.vendor || "Needs Vendor",
          facility: contract.facility || "Needs Facility",
          category: contractFinancialCategory(contract)
        };
      });
    }

    function dashboardFinancialInsights(source = dashboardContracts()) {
      const rows = financialRowsForContracts(source);
      const noFinancialImpactRows = rows.filter(row => contractHasNoFinancialImpact(row.contract));
      const costRows = rows.filter(row => contractHasFinanceCost(row.contract) && !contractHasNoFinancialImpact(row.contract));
      const moneyRows = rows.filter(row => row.annual || row.monthly || row.costBedMonth);
      const bedRows = moneyRows.filter(row => row.costBedMonth);
      const needsAnnualBasis = rows.filter(row => contractHasFinanceCost(row.contract) && !row.annual && !row.monthly && !row.costBedMonth).length;
      const totalAnnual = moneyRows.reduce((sum, row) => sum + row.annual, 0);
      const avgBedMonth = bedRows.length ? bedRows.reduce((sum, row) => sum + row.costBedMonth, 0) / bedRows.length : 0;
      const highestBed = [...bedRows].sort((a, b) => b.costBedMonth - a.costBedMonth)[0] || null;
      const missingMoney = source.filter(contract => !contractHasFinanceCost(contract) && !contractHasNoFinancialImpact(contract)).length;
      const missingBeds = source.filter(contract => annualizedContractSpend(contract) && !facilityBedsForContract(contract)).length;
      const byCategory = new Map();
      bedRows.forEach(row => {
        if (!contractHasUsableValue(row.category) || /^needs classification$/i.test(String(row.category || "").trim())) return;
        const key = masterKey(row.category) || "uncategorized";
        if (!byCategory.has(key)) byCategory.set(key, []);
        byCategory.get(key).push(row);
      });
      const overMarket = [];
      byCategory.forEach(group => {
        if (group.length < 2) return;
        const average = group.reduce((sum, row) => sum + row.costBedMonth, 0) / group.length;
        group.forEach(row => {
          if (average && row.costBedMonth > average * 1.15) {
            overMarket.push({ ...row, categoryAverage: average, percentOver: ((row.costBedMonth - average) / average) * 100 });
          }
        });
      });
      overMarket.sort((a, b) => b.percentOver - a.percentOver);
      return { rows, costRows, moneyRows, bedRows, noFinancialImpact: noFinancialImpactRows.length, needsAnnualBasis, totalAnnual, avgBedMonth, highestBed, missingMoney, missingBeds, overMarket };
    }

    function financeScopedContracts() {
      const facilityFilter = document.getElementById("financeFacilityFilter");
      const selectedFacility = String(facilityFilter?.value || "").trim();
      const serviceFilter = document.getElementById("financeServiceFilter");
      const selectedService = categoryCanonicalName(serviceFilter?.value || "");
      const vendorFilter = document.getElementById("financeVendorFilter");
      const selectedVendor = String(vendorFilter?.value || "").trim();
      const statusFilter = document.getElementById("financeStatusFilter");
      const selectedStatus = String(statusFilter?.value || "").trim();
      const source = financeContractData.length ? financeContractData : dashboardContracts();
      const allowedContracts = source.filter(contract => contractInUserScope(contract) && contractUsesActiveFacility(contract));
      return allowedContracts.filter(contract => {
        if (selectedFacility && !contractFacilityNames(contract).some(name => facilityNamesMatch(name, selectedFacility))) return false;
        if (selectedService && categoryCanonicalName(contract.category || contract.services || contract.contractType || "") !== selectedService) return false;
        if (selectedVendor && !sameMasterName(contract.vendor, selectedVendor)) return false;
        if (selectedStatus && String(contract.contractStatus || contract.status || "").trim() !== selectedStatus) return false;
        return true;
      });
    }

    function openFinanceDrilldown(kind = "spend") {
      const scopedContracts = financeScopedContracts();
      const finance = dashboardFinancialInsights(scopedContracts);
      const selectedFacility = String(document.getElementById("financeFacilityFilter")?.value || "").trim();
      if (kind === "scope" || kind === "facilities") {
        switchSection("facilities");
        return;
      }
      if (kind === "contracts") {
        switchSection("contracts");
        return;
      }
      let title = "Finance Records";
      let rows = [];
      if (kind === "all") {
        title = "All Finance Contracts";
        rows = finance.rows;
      } else if (kind === "with-money") {
        title = "Contracts With Cost / Bed / PPD";
        rows = finance.costRows;
      } else if (kind === "spend") {
        title = "Annualized Spend";
        rows = finance.moneyRows;
      } else if (kind === "missing-money") {
        title = "Needs Finance Data";
        rows = financialRowsForContracts(scopedContracts.filter(contract => !contractHasFinanceCost(contract)));
      } else if (kind === "missing-beds") {
        title = "Missing Beds";
        rows = financialRowsForContracts(scopedContracts.filter(contract => annualizedContractSpend(contract) && !facilityBedsForContract(contract)));
      } else if (kind === "cost-bed" || kind === "ppd") {
        title = kind === "ppd" ? "Estimated PPD" : "Cost Per Bed";
        rows = kind === "ppd" ? finance.moneyRows.filter(row => row.ppd) : finance.bedRows;
      } else if (kind === "overpay") {
        title = "Possible Overpay";
        rows = finance.overMarket;
      }
      document.getElementById("modalTitle").textContent = selectedFacility ? `${title} - ${selectedFacility}` : title;
      document.getElementById("modalBody").innerHTML = `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Contract</th><th>Facility</th><th>Vendor</th><th>Service</th><th>Annual</th><th>Beds</th><th>Avg Census</th><th>Cost / Bed</th><th>PPD</th><th></th></tr></thead>
            <tbody>
              ${rows.map(row => {
                const contract = row.contract || row;
                const annual = row.annual || annualizedContractSpend(contract);
                const beds = row.beds || facilityBedsForContract(contract);
                const census = row.census || facilityCensusForContract(contract);
                const costBedMonth = row.costBedMonth || (beds && monthlyContractSpend(contract) ? monthlyContractSpend(contract) / beds : 0);
                const ppd = row.ppd || (census && annual ? annual / census / 365 : 0);
                const hasCost = contractHasFinanceCost(contract);
                const annualMissingLabel = hasCost ? "Needs quantity/frequency" : "Needs fee/rate";
                const bedCostMissingLabel = hasCost && beds ? "Needs annual amount" : "Needs data";
                return `
                  <tr>
                    <td><strong>${escapeHtml(contract.name || "Untitled")}</strong></td>
                    <td>${escapeHtml(contract.facility || row.facility || "Needs Review")}</td>
                    <td>${escapeHtml(contract.vendor || row.vendor || "Needs Review")}</td>
                    <td>${escapeHtml(contractFinancialCategory(contract) || row.category || "Needs Review")}</td>
                    <td>${annual ? reportMoney(annual) : annualMissingLabel}</td>
                    <td>${beds || "Needs beds"}</td>
                    <td>${census ? Number(census).toLocaleString(undefined, { maximumFractionDigits: 1 }) : "Needs census"}</td>
                    <td>${costBedMonth ? reportMoney(costBedMonth) : bedCostMissingLabel}</td>
                    <td>${ppd ? `$${ppd.toFixed(2)}` : bedCostMissingLabel}</td>
                    <td><button class="btn ghost" onclick="openContractSafe('${jsArg(contract.id)}', '${jsArg(contract.name || contract.vendor || "")}')">Open</button></td>
                  </tr>
                `;
              }).join("") || `<tr><td colspan="9">No matching records.</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="modal-actions">
          <button class="btn" onclick="closeModal()">Close</button>
          ${(kind === "missing-money" || kind === "missing-beds") ? `<button class="btn primary" onclick="closeModal(); openReport('missing-spend')">Open Cleanup Report</button>` : ""}
          ${kind === "overpay" ? `<button class="btn primary" onclick="closeModal(); openReport('possible-overpay')">Open Report</button>` : ""}
          ${(kind === "cost-bed" || kind === "ppd") ? `<button class="btn primary" onclick="closeModal(); openReport('per-bed-ppd-finance')">Open Report</button>` : ""}
          ${(kind === "with-money" || kind === "spend") ? `<button class="btn primary" onclick="closeModal(); openReport('spend-by-service-vendor')">Open Report</button>` : ""}
        </div>
      `;
      document.getElementById("contractModal")?.classList.add("open");
    }

    function contractHasUsableValue(value) {
      const text = String(value || "").trim();
      if (!text || !/[A-Za-z0-9$]/.test(text)) return false;
      return !["needs review", "needs classification", "needs vendor address", "unknown", "not found", "tbd", "n/a", "na", "."].includes(text.toLowerCase());
    }

    const vendorLearningBlockedLabels = new Set([
      "contract name",
      "facility",
      "vendor",
      "category",
      "contract status",
      "signature date",
      "start of services",
      "end date",
      "initial contract length",
      "auto renewal",
      "notice period",
      "payment terms",
      "rate / fee",
      "source pdf / sharesync link"
    ]);

    function learnedVendorFieldLabel(field = {}) {
      const label = reviewDisplayLabel(field.label || field.key || "").trim();
      const canonical = reviewCanonicalLabel(label);
      const value = field.value || "";
      if (!label || vendorLearningBlockedLabels.has(canonical)) return "";
      if (isHiddenReviewField(label) || isSuspiciousReviewField(field)) return "";
      if (!contractHasUsableValue(value)) return "";
      if (/^(source|reason|confidence|status|risk|document|unknown|needs review)$/i.test(label)) return "";
      return label;
    }

    function learnedVendorFieldsFromContract(contract = {}) {
      return (contract.extractedFields || [])
        .filter(field => field?.approved || /manual|review|verified|saved|ocr proven/i.test(String(field?.source || "")))
        .map(learnedVendorFieldLabel)
        .filter(Boolean);
    }

    function clearVendorRequirementLearningCache() {
      vendorRequirementLearningCache = null;
    }

    function vendorRequirementLearningMap() {
      if (vendorRequirementLearningCache?.count === contractData.length) return vendorRequirementLearningCache.map;
      const map = new Map();
      contractData.forEach(item => {
        const vendor = cleanMasterName(item.vendor || "");
        if (!vendor || ["needs classification", "unknown", "not found"].includes(vendor.toLowerCase())) return;
        const vendorKey = masterKey(vendor);
        if (!vendorKey) return;
        if (!map.has(vendorKey)) map.set(vendorKey, new Map());
        const learnedCounts = map.get(vendorKey);
        [...new Set(learnedVendorFieldsFromContract(item))].forEach(label => {
          const key = reviewCanonicalLabel(label);
          const current = learnedCounts.get(key) || { label, count: 0 };
          current.count += 1;
          learnedCounts.set(key, current);
        });
      });
      vendorRequirementLearningCache = { count: contractData.length, map };
      return map;
    }

    function dynamicVendorRequirementRowsForContract(contract = {}) {
      const vendor = cleanMasterName(contract.vendor || "");
      if (!vendor || ["needs classification", "unknown", "not found"].includes(vendor.toLowerCase())) return [];
      const learnedCounts = vendorRequirementLearningMap().get(masterKey(vendor));
      if (!learnedCounts?.size) return [];
      return [...learnedCounts.values()]
        .filter(item => item.count >= 1)
        .map(item => {
          const aliases = requirementAliasesForLabel(item.label);
          return {
            key: `vendor-learned-${reviewCanonicalLabel(item.label)}`,
            label: item.label,
            value: savedContractFieldValue(contract, aliases, []),
            learned: true,
            vendorSpecific: true,
            reason: `${vendor} history: ${item.count} saved contract${item.count === 1 ? "" : "s"} used this field. Verify it from this contract before approval.`
          };
        });
    }

    function contractValueForRequirement(contract = {}, requirement = {}) {
      return savedContractFieldValue(contract, requirement.aliases || [requirement.label], requirement.keys || []);
    }

    function learnedRequirementRowsForContract(contract = {}) {
      const vendor = contract.vendor || "";
      const category = fuzzyCategoryMatch(contract.category || contract.services || contract.agreementType || contract.contractType || "")?.value || "";
      const currentId = contract.id || "";
      const peers = contractData.filter(item => item.id !== currentId);
      const sameVendor = vendor ? peers.filter(item => sameVendorName(item.vendor, vendor)) : [];
      const sameService = category ? peers.filter(item => fuzzyCategoryMatch(item.category || item.services || item.agreementType || item.contractType || "")?.value === category) : [];
      const learned = [];
      learnedRequirementCatalog.forEach(requirement => {
        const vendorCount = sameVendor.filter(item => contractHasUsableValue(contractValueForRequirement(item, requirement))).length;
        const serviceCount = sameService.filter(item => contractHasUsableValue(contractValueForRequirement(item, requirement))).length;
        const vendorStrong = sameVendor.length >= 2 && vendorCount >= Math.min(2, sameVendor.length);
        const serviceStrong = sameService.length >= 4 && serviceCount >= Math.ceil(sameService.length * 0.5);
        if (!vendorStrong && !serviceStrong) return;
        learned.push({
          key: `learned-${reviewCanonicalLabel(requirement.label)}`,
          label: requirement.label,
          value: contractValueForRequirement(contract, requirement),
          learned: true,
          vendorSpecific: vendorStrong,
          serviceSpecific: !vendorStrong && serviceStrong,
          reason: vendorStrong
            ? `Vendor history: ${vendorCount} saved ${vendor || "vendor"} contract${vendorCount === 1 ? "" : "s"} include this field.`
            : `Service history: ${serviceCount} saved ${category || "similar"} contract${serviceCount === 1 ? "" : "s"} include this field.`
        });
      });
      return mergeRequirementRows([...learned, ...dynamicVendorRequirementRowsForContract(contract)]);
    }

    function mergeRequirementRows(rows = []) {
      const merged = new Map();
      rows.forEach(row => {
        const key = reviewCanonicalLabel(row.label || row.key || "");
        if (!key) return;
        const current = merged.get(key);
        const next = { ...row, ok: contractHasUsableValue(row.value) };
        if (!current || (next.learned && !current.learned) || (next.ok && !current.ok)) merged.set(key, next);
      });
      return [...merged.values()];
    }

    function contractSourceProofRows(contract = {}) {
      return [
        ["Vendor", contract.vendor],
        ["Facility", contract.facility],
        ["Service/category", contract.category || contract.services],
        ["Start/effective/service date", contract.startOfServices || contract.start || contract.signatureDate],
        ["Fee/rate or no-fee explanation", contract.fee || contract.rate || contract.monthlyCost || contract.spend],
        ["Payment terms or not stated", contract.paymentTerms || contract.daysPayable],
        ["Renewal / auto-renewal status", contract.autoRenewal || contract.renewal || contract.initialContractLength],
        ["Termination / notice language", contract.terminationClause || contract.noticePeriod || contract.termination]
      ].map(([label, fallback]) => {
        const field = contractFieldByLabel(contract, requirementAliasesForLabel(label));
        const value = field?.value || fallback || "";
        const proof = sourceProofStatusForContract({ ...(field || {}), label, value }, contract);
        return { label, value, confidence: field?.confidence || "", source: field?.source || "", sourceText: field?.sourceText || "", proof };
      });
    }

    function contractListValue(value, fallback = "Needs Review", limit = 48) {
      const clean = cleanQueueText(value, "", limit);
      if (!contractHasUsableValue(clean)) return fallback;
      return clean;
    }

    function contractListJoinedValue(values = [], fallback = "Needs Review", limit = 60) {
      const parts = values
        .map(value => contractListValue(value, "", limit))
        .filter(contractHasUsableValue);
      return parts.length ? [...new Set(parts)].join(" / ") : fallback;
    }

    function contractHasPayment(c) {
      return contractHasUsableValue(c.paymentTerms) || contractHasUsableValue(c.daysPayable);
    }

    function contractHasCost(c) {
      return contractHasFinanceCost(c);
    }

    function contractRequirementProfile(contract = {}) {
      const text = `${contract.category || ""} ${contract.services || ""} ${contract.agreementType || ""} ${contract.contractType || ""} ${contract.name || ""}`.toLowerCase();
      const isBaa = /\b(business associate agreement|baa|data privacy)\b/.test(text);
      const requirements = [
        { key: "contractType", label: "Contract type", value: contract.category || contract.contractType || contract.agreementType || contract.services, mandatory: true },
        { key: "vendor", label: "Vendor Name", value: contract.vendor, mandatory: true },
        { key: "facility", label: "Facility", value: contract.facility, mandatory: true },
        { key: "effectiveDate", label: "Effective date", value: contract.effectiveDate || contract.startOfServices || contract.start || contract.signatureDate || contract.signedDate, mandatory: true },
        { key: "cost", label: "Cost", value: isBaa ? "No cost" : contract.fee || contract.rate || contract.contractValue || contract.monthlyCost || contract.annualCost || contract.spend, mandatory: !isBaa },
        { key: "paymentTerms", label: "Payment terms", value: isBaa ? "No payment - data sharing agreement" : contract.paymentTerms || contract.daysPayable, mandatory: !isBaa },
        { key: "autoRenew", label: "Auto renew", value: contract.autoRenewal || contract.renewal, mandatory: true },
        { key: "termination", label: "How to terminate", value: contract.terminationClause || contract.noticePeriod || contract.termination, mandatory: true }
      ];
      const isUtility = /electric|gas|utility|water|internet|telecom|firstlight|constellation|phone|fiber/.test(text);
      const isClinical = /medical director|physician|clinical|doctor|pharmacy|oxygen|medical gas|lab|vascular|therapy|radiology/.test(text);
      const isService = /waste|lawn|landscap|snow|parking|security|maintenance|hvac|fire|sprinkler|pest|laundry|transport|ambulette|ambulance/.test(text);
      if (isUtility) {
        requirements.push({ key: "account", label: "Account / meter / service address", value: contract.utilityAccountNumber || contract.meterNumber || contract.serviceAddress, mandatory: false });
      }
      if (isService) {
        requirements.push({ key: "serviceDetail", label: "Service detail / frequency", value: contract.quantityOfServices || contract.services || contract.serviceAddress, mandatory: false });
      }
      if (isClinical) {
        requirements.push({ key: "clinicalScope", label: "Clinical/service scope", value: contract.services || contract.purposeScope || contract.labTestPricing, mandatory: false });
      }
      return mergeRequirementRows([
        ...requirements,
        ...learnedRequirementRowsForContract(contract)
      ]);
    }

    function missingRequiredFields(contract = {}) {
      return contractRequirementProfile(contract).filter(item => item.mandatory !== false && !item.learned && !item.vendorSpecific && !item.serviceSpecific && !item.ok);
    }

    function missingRequiredFieldLabels(contract = {}) {
      const labels = missingRequiredFields(contract).map(item => item.label);
      const calculatedInitialEnd = initialTermEndDate(
        contract.effectiveDate || contract.startOfServices || contract.start || contract.signatureDate || contract.signedDate,
        contract.initialContractLength || contract.contractLength || contract.term
      );
      const hasRenewalOrEndDate = Boolean(dashboardDateObject(contract.renewalDate || contract.renewal || contract.end || contract.expirationDate || contract.endDate) || calculatedInitialEnd);
      const autoRenews = isAutoRenewing(contract.autoRenewal);
      if (!autoRenews && !hasRenewalOrEndDate) labels.push("End date");
      if (autoRenews && hasRenewalOrEndDate && !noticeDaysFromContract(contract) && !dashboardDateObject(contract.terminationDeadline || contract.noticeDeadline)) labels.push("Notice deadline");
      return [...new Set(labels)];
    }

    function createMissingRequiredLabelReader() {
      const cache = new Map();
      return contract => {
        const key = contract?.id || `${contract?.name || ""}|${contract?.vendor || ""}|${contract?.facility || ""}`;
        if (!cache.has(key)) cache.set(key, missingRequiredFieldLabels(contract));
        return cache.get(key) || [];
      };
    }

    function renderDashboard() {
      let cachedAttentionRows = null;
      const dashboardIssueLabel = issue => {
        const text = String(issue || "").trim();
        if (/review ocr fields before contract becomes official/i.test(text)) return "Review fields";
        if (/missing required field:\s*/i.test(text)) return text.replace(/missing required field:\s*/i, "Missing ");
        if (/auto-renewal needs notice\/termination proof/i.test(text)) return "Needs termination proof";
        return text || "Review";
      };
      const dashboardDueLabel = due => {
        const text = String(due || "").trim();
        if (/before approval/i.test(text)) return "Approval";
        if (/before renewal/i.test(text)) return "Renewal";
        if (/this week/i.test(text)) return "Week";
        return text || "Today";
      };
      const dashboardOwnerLabel = owner => {
        const text = String(owner || "").trim();
        if (/contract dept/i.test(text)) return "Dept";
        return text || "Dept";
      };
      const getDashboardAttentionRows = () => {
        if (!cachedAttentionRows) cachedAttentionRows = dashboardAttentionRows();
        return cachedAttentionRows;
      };
      const dashboard = document.getElementById("dashboard");
      if (dashboard) {
        const useSummaryDashboard = Boolean(dashboardData?.totalContracts) && activeSectionId() === "dashboard";
        if (!backendDataLoaded || useSummaryDashboard) {
          const quick = dashboardData || {};
          const quickSet = (id, value) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
          };
          const totalContracts = Number(quick.totalContracts || quick.activeContracts || 0);
          const activeContracts = Number(quick.activeContracts || 0);
          const criticalIssues = Number(quick.criticalAttention || 0);
          const reviewWaiting = Number(quick.reviewWaiting ?? quick.criticalActions ?? 0);
          const needsAttention = Number(quick.criticalActions || 0);
          const localRenewalItems = useSummaryDashboard ? [] : (contractData.length ? dashboardRenewalItems(contractData) : []);
          const renewals90 = localRenewalItems.length || Number(quick.expiring90 || 0);
          const spendLabel = quick.annualSpendLabel || "$0";
          const sourceProof = Number(quick.sourceProofPercent || 0);
          const liveAttentionRows = Array.isArray(quick.attentionRows) ? quick.attentionRows : [];
          const liveRenewalRows = localRenewalItems.length
            ? localRenewalItems.slice(0, 8).map(item => ({
              contractId: item.contract.id,
              contract: item.contract.name || "Unnamed contract",
              vendor: item.contract.vendor || "Needs Review",
              facility: item.contract.facility || "Needs Review",
              category: item.contract.category || item.contract.services || "Needs Review",
              value: item.contract.spend || item.contract.annualCost || item.contract.monthlyCost || item.contract.fee || item.contract.rate || "Needs Review",
              targetDate: item.targetDate,
              days: item.days,
              window: item.window,
              basis: item.basis
            }))
            : Array.isArray(quick.renewalRows) ? quick.renewalRows : [];
          quickSet("dailyReviewText", needsAttention ? `${needsAttention} items need attention.` : "No urgent items loaded.");
          quickSet("dailyMoneyText", `${reviewWaiting} contracts waiting for approval.`);
          quickSet("dailyRenewalText", `${renewals90} due in 90 days.`);
          quickSet("dailyDateText", `${totalContracts} contracts indexed.`);
          quickSet("dataReadinessText", "Live records load when you open a work page.");
          quickSet("reviewReadinessText", `${needsAttention} item${needsAttention === 1 ? "" : "s"} need attention.`);
          quickSet("vendorReadinessText", "Vendor cards load on the Vendors page.");
          quickSet("reportReadinessText", "Reports load on the Reports page.");
          quickSet("dashboardScopeTitle", "Dashboard scope: quick view");
          quickSet("dashboardScopeDetail", "Open a side page to load live contract records.");
          const kpiValues = dashboard.querySelectorAll(".kpis .kpi .value");
          const kpiDeltas = dashboard.querySelectorAll(".kpis .kpi .delta");
          if (kpiValues.length >= 4) {
            kpiValues[0].textContent = criticalIssues;
            kpiValues[1].textContent = renewals90;
            kpiValues[2].textContent = reviewWaiting;
            kpiValues[3].textContent = activeContracts;
          }
          if (kpiDeltas.length >= 4) {
            kpiDeltas[0].textContent = criticalIssues ? "Urgent renewal or high-risk items" : "No critical issues";
            kpiDeltas[1].textContent = `${renewals90} due in the next 90 days`;
            kpiDeltas[2].textContent = "Contracts waiting for approval";
            kpiDeltas[3].textContent = "Current operational contracts";
          }
          const attentionPanelBadge = document.querySelector("#dashboard .panel-head h3")?.parentElement?.querySelector(".badge");
          if (attentionPanelBadge) {
            const criticalAttention = Number(quick.criticalAttention || 0);
            attentionPanelBadge.textContent = criticalAttention ? `${criticalAttention} critical / ${needsAttention} open` : `${needsAttention} open`;
            attentionPanelBadge.className = `badge ${criticalAttention ? "red" : needsAttention ? "amber" : "green"}`;
          }
          const attentionRowsElement = document.getElementById("alertRows");
          if (attentionRowsElement) {
            attentionRowsElement.innerHTML = liveAttentionRows.length
              ? liveAttentionRows.map((row, index) => `
                <tr class="clickable-row" onclick="dashboardOpenContractTarget('${jsArg(row.contractId || "")}', '${jsArg(row.contract || "")}', '${jsArg(row.issue || "")}')">
                  <td><strong>${escapeHtml(row.contract || "Needs attention")}</strong></td>
                  <td>${escapeHtml(row.facility || "")}</td>
                  <td title="${escapeHtml(row.issue || "Review")}">${escapeHtml(dashboardIssueLabel(row.issue))}</td>
                  <td><span class="badge ${row.severity === "red" ? "red" : "amber"}">${escapeHtml(dashboardDueLabel(row.due))}</span></td>
                  <td>${escapeHtml(dashboardOwnerLabel(row.owner))}</td>
                  <td><button class="btn ghost" onclick="event.stopPropagation(); dashboardOpenContractTarget('${jsArg(row.contractId || "")}', '${jsArg(row.contract || "")}', '${jsArg(row.issue || "")}')">Open</button></td>
                </tr>
              `).join("")
              : needsAttention
                ? `<tr class="clickable-row" onclick="dashboardOpenAttention()"><td><strong>Needs attention</strong></td><td></td><td>${needsAttention} open item${needsAttention === 1 ? "" : "s"}</td><td><span class="badge amber">Today</span></td><td>Dept</td><td><button class="btn ghost" onclick="event.stopPropagation(); dashboardOpenAttention()">Open</button></td></tr>`
              : `<tr><td colspan="6">No critical dashboard items right now.</td></tr>`;
          }
          const renewalRowsElement = document.getElementById("renewalRows");
          if (renewalRowsElement) {
            renewalRowsElement.innerHTML = liveRenewalRows.length
              ? liveRenewalRows.map(row => `
                <tr class="clickable-row" onclick="${row.contractId ? `openContractSafe('${jsArg(row.contractId)}', '${jsArg(row.contract || "")}')` : "dashboardOpenRenewals()"}">
                  <td><span class="badge ${Number(row.days || 999) <= 30 ? "red" : Number(row.days || 999) <= 60 ? "amber" : "blue"}">${escapeHtml(row.window || "90 days")}</span></td>
                  <td>${escapeHtml(row.vendor || "Needs Review")}</td>
                  <td>${escapeHtml(row.facility || "Needs Review")}</td>
                  <td>${escapeHtml(row.category || "Needs Review")}</td>
                  <td>${escapeHtml(row.value || "Needs Review")}</td>
                  <td><div class="table-actions"><span style="color:var(--muted);font-size:12px">${escapeHtml(row.targetDate || "")}${row.days !== undefined ? ` (${escapeHtml(row.days)} days)` : ""}</span><button class="btn ghost" onclick="event.stopPropagation(); ${row.contractId ? `openContractSafe('${jsArg(row.contractId)}', '${jsArg(row.contract || "")}')` : "dashboardOpenRenewals()"}">Open</button></div></td>
                </tr>
              `).join("")
              : `<tr><td colspan="6">${renewals90} contracts due in the next 90 days.</td></tr>`;
          }
          const snapshotRows = document.getElementById("executiveSnapshotRows");
          if (snapshotRows) {
            snapshotRows.innerHTML = `
              <div class="metric-row clickable-row" onclick="dashboardOpenAttention()"><div><strong>Action required</strong><span>${needsAttention} open item${needsAttention === 1 ? "" : "s"}.</span></div><button class="btn ghost" onclick="event.stopPropagation(); dashboardOpenAttention()">Open</button></div>
              <div class="metric-row clickable-row" onclick="dashboardOpenRenewals()"><div><strong>30 / 60 / 90</strong><span>${renewals90} contract${renewals90 === 1 ? "" : "s"} due in the next 90 days.</span></div><button class="btn ghost" onclick="event.stopPropagation(); dashboardOpenRenewals()">Open</button></div>
              <div class="metric-row clickable-row" onclick="showContractsView('active')"><div><strong>Active contracts</strong><span>${activeContracts} current operational contract${activeContracts === 1 ? "" : "s"}.</span></div><button class="btn ghost" onclick="event.stopPropagation(); showContractsView('active')">Open</button></div>
            `;
          }
          const financialRows = document.getElementById("financialInsightRows");
          if (financialRows) {
            financialRows.innerHTML = `
              <div class="metric-row clickable-row" onclick="switchSection('review')"><div><strong>Waiting for review</strong><span>${reviewWaiting} contract${reviewWaiting === 1 ? "" : "s"} need approval.</span></div><button class="btn ghost" onclick="event.stopPropagation(); switchSection('review')">Review</button></div>
              <div class="metric-row clickable-row" onclick="switchSection('reports')"><div><strong>Source coverage</strong><span>${sourceProof}% have OCR or source text.</span></div><button class="btn ghost" onclick="event.stopPropagation(); switchSection('reports')">Open</button></div>
            `;
          }
          document.querySelectorAll("#dashboard [id$='ReadinessBar']").forEach(bar => { bar.style.width = "0%"; });
          return;
        }
        const scope = userFacilityScope();
        const scopedContracts = dashboardContracts();
        const scopedJobs = dashboardOcrJobs();
        const totalContracts = scopedContracts.length;
        const needsReview = reviewQueueItems().filter(job => contractInUserScope(contractForJob(job))).length;
        const missingVendorInfo = scopedContracts.filter(c => !c.vendorMailingAddress || !c.vendor || c.vendor === "Needs Classification").length;
        const missingDates = scopedContracts.filter(c => {
          const missing = missingRequiredFieldLabels(c);
          return missing.includes("Effective date") || missing.includes("End date") || missing.includes("Notice deadline") || missing.includes("How to terminate");
        }).length;
        const missingCosts = scopedContracts.filter(c => !contractHasFinanceCost(c)).length;
        const missingPayment = 0;
        const autoRenewNoNotice = scopedContracts.filter(c => isAutoRenewing(c.autoRenewal) && !noticeDaysFromContract(c) && !dashboardDateObject(c.terminationDeadline || c.noticeDeadline)).length;
        const vendorCardsMissing = vendorsData.filter(v => !contractHasUsableValue(v.phone) && !contractHasUsableValue(v.email) || !contractHasUsableValue(v.mailingAddress)).length;
        const approved = scopedContracts.filter(c => c.status === "Approved").length;
        const activeContracts = scopedContracts.filter(c => /active|approved/i.test(String(c.contractStatus || c.status || "")) && !/archived|terminated|expired|replaced|superseded/i.test(String(c.contractStatus || c.status || ""))).length;
        const categorized = scopedContracts.filter(c => c.category && c.category !== "Needs Classification").length;
        const dated = scopedContracts.filter(c => contractRenewalAlert(c)).length;
        const costed = scopedContracts.filter(c => contractHasFinanceCost(c)).length;
        const withPdf = scopedContracts.filter(c => c.localFilePath).length;
        const scopedSpendValue = scopedContracts.reduce((sum, contract) => sum + annualizedContractSpend(contract), 0);
        const scopedSpendLabel = scope.all
          ? reportMoney(scopedSpendValue)
          : reportMoney(scopedSpendValue);
        const dashboardSpendLabel = financeContractsLoaded || scopedContracts.length >= Number(contractsTotalCount || 0)
          ? scopedSpendLabel
          : (dashboardData.annualSpendLabel || scopedSpendLabel);
        const renewalItems = dashboardRenewalItems(scopedContracts);
        const renewal30 = renewalItems.filter(item => item.days <= 30).length;
        const renewal60 = renewalItems.filter(item => item.days > 30 && item.days <= 60).length;
        const renewal90 = renewalItems.filter(item => item.days > 60 && item.days <= 90).length;
        const scopeTitle = document.getElementById("dashboardScopeTitle");
        const scopeDetail = document.getElementById("dashboardScopeDetail");
        if (scopeTitle) scopeTitle.textContent = `Dashboard scope: ${scope.label}`;
        if (scopeDetail) {
          scopeDetail.textContent = scope.all
            ? "Admin and contract department users see the full portfolio."
            : `${currentUser?.fullName || currentUser?.user || "This user"} is assigned to ${scope.label}. Dashboard counts are filtered to those facilities.`;
        }
        const vendorReady = totalContracts ? Math.round(((totalContracts - missingVendorInfo) / totalContracts) * 100) : 0;
        const reviewReady = totalContracts ? Math.round((approved / totalContracts) * 100) : 0;
        const dataReady = totalContracts ? Math.round(((categorized + dated + withPdf) / (totalContracts * 3)) * 100) : 0;
        const reportReady = totalContracts ? Math.round(((categorized + dated + costed) / (totalContracts * 3)) * 100) : 0;
        [
          ["dataReadinessBar", dataReady],
          ["reviewReadinessBar", reviewReady],
          ["vendorReadinessBar", vendorReady],
          ["reportReadinessBar", reportReady]
        ].forEach(([id, value]) => {
          const bar = document.getElementById(id);
          if (bar) bar.style.width = `${Math.max(0, Math.min(100, value))}%`;
        });
        const dataText = document.getElementById("dataReadinessText");
        const reviewText = document.getElementById("reviewReadinessText");
        const vendorText = document.getElementById("vendorReadinessText");
        const reportText = document.getElementById("reportReadinessText");
        if (dataText) dataText.textContent = totalContracts ? `${dataReady}% ready. ${categorized} categorized, ${dated} with term dates, ${withPdf} with source files.` : "Upload contracts to start scoring data quality.";
        if (reviewText) reviewText.textContent = totalContracts ? `${reviewReady}% approved. ${needsReview} contract${needsReview === 1 ? "" : "s"} still need review.` : "Approve OCR fields before records become official.";
        if (vendorText) vendorText.textContent = totalContracts ? `${vendorReady}% ready. ${missingVendorInfo} vendor profile gap${missingVendorInfo === 1 ? "" : "s"} remain.` : "Vendor address, phone, email, and account IDs matter.";
        if (reportText) reportText.textContent = totalContracts ? `${reportReady}% report-ready. ${costed} contract${costed === 1 ? "" : "s"} include spend data.` : "Reports get stronger as dates, costs, and categories are filled.";
        const setDailyText = (id, value) => {
          const el = document.getElementById(id);
          if (el) el.textContent = value;
        };
        setDailyText("dailyReviewText", needsReview ? `${needsReview} contract${needsReview === 1 ? "" : "s"} waiting for review.` : "No contracts waiting right now.");
        setDailyText("dailyMoneyText", (missingCosts || missingPayment) ? `${missingCosts} missing fee/rate. ${missingPayment} missing payment terms.` : "No missing money fields.");
        setDailyText("dailyRenewalText", autoRenewNoNotice ? `${autoRenewNoNotice} auto-renewal contract${autoRenewNoNotice === 1 ? "" : "s"} need notice language checked.` : "No auto-renewal issues found.");
        setDailyText("dailyDateText", missingDates ? `${missingDates} contract${missingDates === 1 ? "" : "s"} missing end/renewal dates.` : "No missing term records.");
        const nextTitle = document.getElementById("nextActionTitle");
        const nextCopy = document.getElementById("nextActionCopy");
        const nextBadge = document.getElementById("nextActionBadge");
        const nextButton = document.getElementById("nextActionButton");
        if (nextTitle && nextCopy && nextBadge && nextButton) {
          if (!totalContracts) {
            nextBadge.textContent = "Start here";
            nextBadge.className = "badge amber";
            nextTitle.textContent = "Upload your first contract";
            nextCopy.textContent = "Upload a PDF to start review.";
            nextButton.textContent = "Contract Upload";
            nextButton.dataset.sectionJump = "upload";
            nextButton.onclick = null;
            nextButton.removeAttribute("onclick");
          } else if (needsReview) {
            nextBadge.textContent = `${needsReview} need review`;
            nextBadge.className = "badge amber";
            nextTitle.textContent = "Review extracted contract fields";
            nextCopy.textContent = "Approve or fix the fields the system read before those contracts are treated as clean records.";
            nextButton.textContent = "Open Review Queue";
            nextButton.dataset.sectionJump = "review";
            nextButton.setAttribute("onclick", "dashboardOpenAttention()");
            nextButton.onclick = event => {
              event.preventDefault();
              event.stopPropagation();
              dashboardOpenAttention();
            };
          } else if (missingVendorInfo) {
            nextBadge.textContent = `${missingVendorInfo} missing vendor info`;
            nextBadge.className = "badge amber";
            nextTitle.textContent = "Complete vendor profiles";
            nextCopy.textContent = "Add or confirm mailing address, phone, email, and account IDs so contracts connect to the right vendor profile.";
            nextButton.textContent = "Open Vendors";
            nextButton.dataset.sectionJump = "vendors";
            nextButton.onclick = null;
            nextButton.removeAttribute("onclick");
          } else {
            nextBadge.textContent = `${approved} approved`;
            nextBadge.className = "badge green";
            nextTitle.textContent = "Use the contract file room";
            nextCopy.textContent = "Approved contract records are ready. Search contracts, open reports, or keep cleaning vendor and facility data.";
            nextButton.textContent = "Open Contracts";
            nextButton.dataset.sectionJump = "contracts";
            nextButton.onclick = null;
            nextButton.removeAttribute("onclick");
          }
        }
        const priorityValues = dashboard.querySelectorAll(".priority-item strong");
        const kpiValues = dashboard.querySelectorAll(".kpis .kpi .value");
        const kpiDeltas = dashboard.querySelectorAll(".kpis .kpi .delta");
        if (priorityValues.length >= 4) {
          priorityValues[0].textContent = dashboardData.criticalActions ?? 0;
          priorityValues[1].textContent = dashboardData.expiring90 ?? 0;
          priorityValues[2].textContent = dashboardData.missingInsurance ?? 0;
          priorityValues[3].textContent = dashboardData.potentialSavingsLabel || "$0";
        }
        if (kpiValues.length >= 4) {
          kpiValues[0].textContent = getDashboardAttentionRows().filter(row => row.severity === "red").length;
          kpiValues[1].textContent = renewalItems.length;
          kpiValues[2].textContent = needsReview;
          kpiValues[3].textContent = activeContracts;
        }
        if (kpiDeltas.length >= 4) {
          kpiDeltas[0].textContent = autoRenewNoNotice ? `${autoRenewNoNotice} urgent renewal risk` : "No critical issues";
          kpiDeltas[1].textContent = `${renewal30} in 30, ${renewal60} in 60, ${renewal90} in 90`;
          kpiDeltas[2].textContent = "Contracts waiting for approval";
          kpiDeltas[3].textContent = scope.all ? "Current operational contracts" : "Active in assigned facilities";
        }
        const actionItems = [];
        if (!totalContracts) {
          actionItems.push({ severity: "green", title: "No contracts loaded", detail: "Upload signed contracts to begin.", button: "Upload", action: "switchSection('upload')" });
        } else {
          if (needsReview) actionItems.push({ severity: "amber", title: `${needsReview} contract${needsReview === 1 ? "" : "s"} awaiting review`, detail: "Required fields need approval.", button: "Review", action: "dashboardOpenAttention()" });
          if (missingVendorInfo || vendorCardsMissing) actionItems.push({ severity: "amber", title: `${Math.max(missingVendorInfo, vendorCardsMissing)} vendor gap${Math.max(missingVendorInfo, vendorCardsMissing) === 1 ? "" : "s"}`, detail: "Vendor profile data incomplete.", button: "Vendors", action: "switchSection('vendors')" });
          if (missingDates) actionItems.push({ severity: "amber", title: `${missingDates} term gap${missingDates === 1 ? "" : "s"}`, detail: "Required date/renewal fields missing.", button: "Terms", action: "dashboardOpenDataGap('dates')" });
          if (missingCosts || missingPayment) actionItems.push({ severity: "amber", title: `${missingCosts + missingPayment} money gap${missingCosts + missingPayment === 1 ? "" : "s"}`, detail: "Cost or payment terms missing.", button: "Costs", action: "dashboardOpenDataGap('cost')" });
          if (autoRenewNoNotice) actionItems.push({ severity: "red", title: `${autoRenewNoNotice} renewal risk${autoRenewNoNotice === 1 ? "" : "s"}`, detail: "Auto-renewal missing notice language.", button: "Renewal", action: "dashboardOpenDataGap('renewal')" });
          if (!actionItems.length) actionItems.push({ severity: "green", title: "Portfolio clear", detail: "No priority exceptions open.", button: "Contracts", action: "switchSection('contracts')" });
        }
        const operatingBrief = document.getElementById("operatingBriefRows");
        if (operatingBrief) operatingBrief.innerHTML = actionItems.slice(0, 5).map(dashboardActionHtml).join("");
        const snapshotRows = document.getElementById("executiveSnapshotRows");
        if (snapshotRows) {
          snapshotRows.innerHTML = `
            <div class="metric-row clickable-row" onclick="dashboardOpenAttention()"><div><strong>Action required</strong><span>${getDashboardAttentionRows().length} open item${getDashboardAttentionRows().length === 1 ? "" : "s"}.</span></div><button class="btn ghost" onclick="event.stopPropagation(); dashboardOpenAttention()">Open</button></div>
            <div class="metric-row clickable-row" onclick="dashboardOpenRenewals()"><div><strong>30 / 60 / 90</strong><span>${renewal30} due in 30 days, ${renewal60} in 60 days, ${renewal90} in 90 days.</span></div><button class="btn ghost" onclick="event.stopPropagation(); dashboardOpenRenewals()">Open</button></div>
            <div class="metric-row clickable-row" onclick="showContractsView('active')"><div><strong>Active contracts</strong><span>${activeContracts} current operational contract${activeContracts === 1 ? "" : "s"}.</span></div><button class="btn ghost" onclick="event.stopPropagation(); showContractsView('active')">Open</button></div>
            <div class="metric-row clickable-row" onclick="openReport('needs-correction')"><div><strong>Data quality</strong><span>${missingDates} term; ${missingCosts} cost; ${missingPayment} payment; ${vendorCardsMissing} vendor.</span></div><button class="btn ghost" onclick="event.stopPropagation(); openReport('needs-correction')">Fix</button></div>
          `;
        }
        const financialRows = document.getElementById("financialInsightRows");
        if (financialRows) {
          financialRows.innerHTML = `
            <div class="metric-row clickable-row" onclick="switchSection('review')"><div><strong>Waiting for review</strong><span>${needsReview} contract${needsReview === 1 ? "" : "s"} need approval.</span></div><button class="btn ghost" onclick="event.stopPropagation(); switchSection('review')">Review</button></div>
            <div class="metric-row clickable-row" onclick="showContractsView('approved')"><div><strong>Ready records</strong><span>${approved} approved record${approved === 1 ? "" : "s"}.</span></div><button class="btn ghost" onclick="event.stopPropagation(); showContractsView('approved')">Open</button></div>
            <div class="metric-row clickable-row" onclick="openReport('needs-correction')"><div><strong>Data cleanup</strong><span>${missingDates} term and ${missingVendorInfo} vendor gap${missingVendorInfo === 1 ? "" : "s"}.</span></div><button class="btn ghost" onclick="event.stopPropagation(); openReport('needs-correction')">Fix</button></div>
          `;
        }
        const portfolioRows = document.getElementById("portfolioActionRows");
        if (portfolioRows) {
          portfolioRows.innerHTML = `
            <div class="metric-row clickable-row" onclick="showContractsView('approved')"><div><strong>Ready records</strong><span>${approved} approved of ${totalContracts} loaded contracts.</span></div><span class="badge ${reviewReady >= 80 ? "green" : "amber"}">${reviewReady}%</span></div>
            <div class="metric-row clickable-row" onclick="openReport('data-quality')"><div><strong>Report strength</strong><span>${categorized} categorized, ${dated} dated, ${costed} with spend data.</span></div><span class="badge ${reportReady >= 80 ? "green" : "amber"}">${reportReady}%</span></div>
            <div class="metric-row clickable-row" onclick="switchSection('vendors')"><div><strong>Vendor strength</strong><span>${vendorsData.length} vendor profile${vendorsData.length === 1 ? "" : "s"}; ${vendorCardsMissing} need cleanup.</span></div><span class="badge ${vendorCardsMissing ? "amber" : "green"}">Vendor cards</span></div>
          `;
        }
      }
      const attentionRows = getDashboardAttentionRows();
      const attentionBadge = document.querySelector("#dashboard .panel-head h3")?.parentElement?.querySelector(".badge");
      const attentionPanelBadge = [...document.querySelectorAll("#dashboard .panel-head")].find(head => head.textContent.includes("Priority Work Queue"))?.querySelector(".badge");
      if (attentionPanelBadge) {
        const criticalCount = attentionRows.filter(row => row.severity === "red").length;
        attentionPanelBadge.textContent = `${criticalCount} critical / ${attentionRows.length} live`;
        attentionPanelBadge.className = `badge ${criticalCount ? "red" : attentionRows.length ? "amber" : "gray"}`;
      }
      document.getElementById("alertRows").innerHTML = attentionRows.map((row, index) => `
        <tr class="clickable-row" onclick="dashboardOpenAlert(${index})">
          <td><strong>${escapeHtml(row.contract || "Attention item")}</strong></td>
          <td>${escapeHtml(row.facility || "")}</td>
          <td title="${escapeHtml(row.issue || "Review needed")}">${escapeHtml(dashboardIssueLabel(row.issue))}</td>
          <td><span class="badge ${row.severity === "red" ? "red" : "amber"}">${escapeHtml(dashboardDueLabel(row.due))}</span></td>
          <td>${escapeHtml(dashboardOwnerLabel(row.owner))}</td>
          <td><button class="btn ghost" onclick="event.stopPropagation(); dashboardOpenAlert(${index})">Open</button></td>
        </tr>
      `).join("") || `<tr><td colspan="6">No live attention items. Review queue, vendor cards, dates, costs, and renewal risks are clear for now.</td></tr>`;

      const renewalSource = dashboardRenewalItems().slice(0, 8);
      document.getElementById("renewalRows").innerHTML = renewalSource.map(({ contract: c, window, targetDate, days }) => `
        <tr class="clickable-row" onclick="openContractSafe('${jsArg(c.id)}', '${jsArg(c.name || c.vendor || "")}')">
          <td><span class="badge ${days <= 30 ? "red" : days <= 60 ? "amber" : "blue"}">${escapeHtml(window)}</span></td>
          <td>${escapeHtml(c.vendor || "Needs Review")}</td>
          <td>${escapeHtml(c.facility || "Needs Review")}</td>
          <td>${escapeHtml(c.category || c.services || "Needs Review")}</td>
          <td>${escapeHtml(c.spend || c.fee || c.rate || "Needs Review")}</td>
          <td><div class="table-actions"><span style="color:var(--muted);font-size:12px">${escapeHtml(targetDate)} (${days} days)</span><button class="btn ghost" onclick="event.stopPropagation(); openContractSafe('${jsArg(c.id)}', '${jsArg(c.name || c.vendor || "")}')">Open</button></div></td>
        </tr>
      `).join("") || `<tr><td colspan="6">No live renewal data yet.</td></tr>`;
    }

    function renderFinancePage() {
      const section = document.getElementById("finance");
      if (!section) return;
      if (backendOnline && !financeSummaryData) {
        loadSectionSummary("finance").catch(() => null);
      }
      ensureFinanceFacilitiesLoaded({ rerender: true }).catch(() => null);
      initFilters("finance");
      const setText = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
      };
      const scope = userFacilityScope();
      const facilityFilter = document.getElementById("financeFacilityFilter");
      const selectedFacility = String(facilityFilter?.value || "").trim();
      const selectedService = String(document.getElementById("financeServiceFilter")?.value || "").trim();
      const selectedVendor = String(document.getElementById("financeVendorFilter")?.value || "").trim();
      const selectedStatus = String(document.getElementById("financeStatusFilter")?.value || "").trim();
      const hasFinanceFilters = Boolean(selectedFacility || selectedService || selectedVendor || selectedStatus);
      const summary = financeSummaryData || {};
      const summaryReady = Boolean(summary.generatedAt) && !hasFinanceFilters;
      if (backendOnline && hasFinanceFilters && !financeContractsLoaded && !financeContractsLoadingPromise && !financeContractsWarmLoadScheduled) {
        financeContractsWarmLoadScheduled = true;
        scheduleIdleTask(() => {
          financeContractsWarmLoadScheduled = false;
          if (activeSectionId() !== "finance") return;
          ensureFinanceContractsLoaded({ rerender: hasFinanceFilters }).then(() => {
            if (activeSectionId() === "finance") initFilters("finance");
          }).catch(() => null);
        }, 80);
      }
      const scopedContracts = summaryReady && !financeContractsLoaded ? [] : financeScopedContracts();
      const finance = summaryReady && !financeContractsLoaded
        ? {
          rows: [],
          costRows: [],
          moneyRows: [],
          bedRows: [],
          totalAnnual: Number(summary.totalAnnual || 0),
          avgBedMonth: Number(summary.avgBedMonth || 0),
          highestBed: null,
          missingMoney: Number(summary.missingMoney || 0),
          noFinancialImpact: Number(summary.noFinancialImpact || 0),
          needsAnnualBasis: Number(summary.needsAnnualBasis || 0),
          missingBeds: Number(summary.missingBeds || 0),
          overMarket: Array.isArray(summary.overMarket) ? summary.overMarket : []
        }
        : dashboardFinancialInsights(scopedContracts);
      const contractsWithBeds = summaryReady && !financeContractsLoaded
        ? Number(summary.bedRows || 0)
        : scopedContracts.filter(contract => facilityBedsForContract(contract)).length;
      const facilitiesWithBeds = selectedFacility
        ? (facilityMasterOptions().some(facility => facilityNamesMatch(facility.name, selectedFacility) && Number(facility.beds || 0) > 0) ? 1 : 0)
        : facilityMasterOptions().filter(facility => Number(facility.beds || 0) > 0).length;
      const avgPpd = finance.bedRows.length
        ? finance.bedRows.reduce((sum, row) => sum + (row.ppd || 0), 0) / finance.bedRows.length
        : 0;
      const hasAnyBeds = Boolean(contractsWithBeds || facilitiesWithBeds);
      const bedCostMissingLabel = hasAnyBeds ? "Need annualized cost" : "Need beds + cost";
      const bedCostMissingDetail = hasAnyBeds
        ? "Beds loaded; add usable cost/rate"
        : "Add facility beds and contract cost";
      setText("financeAnnualSpend", summaryReady ? summary.totalAnnualLabel : reportMoney(finance.totalAnnual));
      setText("financeAnnualSpendDetail", summaryReady ? `${Number(summary.moneyRows || 0).toLocaleString()} contracts with a proven annual basis` : (finance.moneyRows.length ? `${finance.moneyRows.length} contracts with a proven annual basis` : "No proven annual cost yet"));
      setText("financeAvgBed", summaryReady ? summary.avgBedMonthLabel : (finance.avgBedMonth ? reportMoney(finance.avgBedMonth) : bedCostMissingLabel));
      setText("financeAvgBedDetail", summaryReady ? `${Number(summary.bedRows || 0).toLocaleString()} priced with beds` : (finance.bedRows.length
        ? `${finance.bedRows.length} priced with beds`
        : bedCostMissingDetail));
      setText("financeAvgPpd", summaryReady ? summary.avgPpdLabel : (avgPpd ? `$${avgPpd.toFixed(2)}` : bedCostMissingLabel));
      setText("financeAvgPpdDetail", summaryReady ? `${Number(summary.bedRows || 0).toLocaleString()} cost + bed records` : (finance.bedRows.length ? "Per patient day" : bedCostMissingDetail));
      setText("financeOverpayCount", summaryReady ? Number(summary.overpayCount || 0) : finance.overMarket.length);
      setText("financeOverpayDetail", (summaryReady ? Number(summary.overpayCount || 0) : finance.overMarket.length) ? "Pricing flags" : "No flags");

      const scopeRows = document.getElementById("financeScopeRows");
      if (scopeRows) {
        setText("financeScopeBadge", hasFinanceFilters ? "Filtered" : scope.all ? "All Facilities" : "Assigned");
        scopeRows.innerHTML = `
          <article class="card kpi" onclick="showContractsView('all')"><div class="label">Contract Warehouse</div><div class="value">${summaryReady ? Number(summary.totalContracts || 0).toLocaleString() : scopedContracts.length.toLocaleString()}</div><div class="delta">Current agreements in this scope</div></article>
          <article class="card kpi" onclick="openFinanceDrilldown('with-money')"><div class="label">Cost / Rate Found</div><div class="value">${summaryReady ? Number(summary.pricedContracts || 0).toLocaleString() : finance.costRows.length.toLocaleString()}</div><div class="delta">Fee, rate, monthly, annual, or unit cost</div></article>
          <article class="card kpi" onclick="openFinanceDrilldown('spend')"><div class="label">Annualized</div><div class="value">${summaryReady ? Number(summary.moneyRows || 0).toLocaleString() : finance.moneyRows.length.toLocaleString()}</div><div class="delta">Usable for spend / bed math</div></article>
          <article class="card kpi" onclick="openFinanceDrilldown('missing-money')"><div class="label">Needs Finance Data</div><div class="value">${summaryReady ? Number(summary.missingMoney || 0).toLocaleString() : finance.missingMoney.toLocaleString()}</div><div class="delta">Excludes no-payment agreements</div></article>
        `;
      }

      const highCost = summaryReady && !financeContractsLoaded && summary.highestBed ? {
        ...summary.highestBed,
        contract: { id: summary.highestBed.contractId, name: summary.highestBed.contract }
      } : finance.highestBed;
      const overMarket = finance.overMarket[0];
      const commandRows = document.getElementById("financeCommandRows");
      if (commandRows) {
        commandRows.innerHTML = `
          <div class="metric-row clickable-row" onclick="openFinanceDrilldown('spend')"><div><strong>Confirmed annual spend</strong><span>${summaryReady ? summary.totalAnnualLabel : reportMoney(finance.totalAnnual)} from amounts with a proven annual basis.</span></div><button class="btn ghost" onclick="event.stopPropagation(); openFinanceDrilldown('spend')">View</button></div>
          <div class="metric-row"><div><strong>No financial impact</strong><span>${summaryReady ? Number(summary.noFinancialImpact || 0).toLocaleString() : Number(finance.noFinancialImpact || 0).toLocaleString()} agreement${(summaryReady ? Number(summary.noFinancialImpact || 0) : Number(finance.noFinancialImpact || 0)) === 1 ? "" : "s"}, including no-payment BAAs, excluded from spend.</span></div><span class="badge blue">Warehouse only</span></div>
          <div class="metric-row clickable-row" onclick="openFinanceDrilldown('ppd')"><div><strong>PPD / per-bed</strong><span>${summaryReady ? Number(summary.bedRows || 0).toLocaleString() : finance.bedRows.length} contracts have cost plus beds.</span></div><button class="btn ghost" onclick="event.stopPropagation(); openFinanceDrilldown('ppd')">View</button></div>
          <div class="metric-row clickable-row" onclick="openReport('price-change-tracker')"><div><strong>Price changes</strong><span>Compare vendor/service pricing over time.</span></div><button class="btn ghost" onclick="event.stopPropagation(); openReport('price-change-tracker')">View</button></div>
          <div class="metric-row ${highCost ? "clickable-row" : ""}" ${highCost ? `onclick="openContractSafe('${jsArg(highCost.contract.id)}', '${jsArg(highCost.contract.name || highCost.contract.vendor || "")}')"` : ""}><div><strong>Highest cost per bed</strong><span>${highCost ? `${escapeHtml(highCost.contract.name || highCost.vendor)} at ${reportMoney(highCost.costBedMonth)} / bed / month` : "Awaiting cost + bed data."}</span></div>${highCost ? `<button class="btn ghost" onclick="event.stopPropagation(); openContractSafe('${jsArg(highCost.contract.id)}', '${jsArg(highCost.contract.name || highCost.contract.vendor || "")}')">Open</button>` : `<span class="badge amber">Pending</span>`}</div>
          <div class="metric-row clickable-row" onclick="openFinanceDrilldown('overpay')"><div><strong>Possible overpay</strong><span>${overMarket ? `${escapeHtml(overMarket.contract.name || overMarket.vendor)} is ${Math.round(overMarket.percentOver)}% above similar ${escapeHtml(overMarket.category)} contracts.` : "No above-average pricing flagged yet."}</span></div><button class="btn ghost" onclick="event.stopPropagation(); openFinanceDrilldown('overpay')">${finance.overMarket.length} flag${finance.overMarket.length === 1 ? "" : "s"}</button></div>
          <div class="metric-row clickable-row" onclick="openFinanceDrilldown('missing-money')"><div><strong>Cleanup</strong><span>${summaryReady ? Number(summary.missingMoney || 0).toLocaleString() : finance.missingMoney} missing cost/rate; ${summaryReady ? Number(summary.needsAnnualBasis || 0).toLocaleString() : Math.max(0, finance.costRows.length - finance.moneyRows.length).toLocaleString()} need frequency/quantity; ${summaryReady ? Number(summary.missingBeds || 0).toLocaleString() : finance.missingBeds} missing bed match.</span></div><div class="table-actions"><button class="btn ghost" onclick="event.stopPropagation(); openFinanceDrilldown('missing-money')">Costs</button><button class="btn ghost" onclick="event.stopPropagation(); openFinanceDrilldown('missing-beds')">Beds</button></div></div>
        `;
      }

      const rows = summaryReady && !financeContractsLoaded
        ? (summary.topRows || []).map(row => ({
          contract: { id: row.contractId, name: row.contract },
          facility: row.facility,
          category: row.category,
          vendor: row.vendor,
          annual: Number(row.annual || 0),
          monthly: Number(row.monthly || 0),
          beds: Number(row.beds || 0),
          census: Number(row.census || 0),
          costBedMonth: Number(row.costBedMonth || 0),
          ppd: Number(row.ppd || 0)
        }))
        : financialRowsForContracts(scopedContracts)
        .filter(row => row.annual || row.monthly || row.costBedMonth)
        .sort((a, b) => b.annual - a.annual)
        .slice(0, 25);
      setText("financeTopCount", `${rows.length} row${rows.length === 1 ? "" : "s"}`);
      const body = document.getElementById("financeBreakdownRows");
      if (body) {
        body.innerHTML = rows.map(row => {
          const contract = {
            ...(row.contract || {}),
            facility: row.facility || row.contract?.facility,
            vendor: row.vendor || row.contract?.vendor,
            category: row.category || row.contract?.category || row.contract?.services
          };
          const annual = Number(row.annual || 0) || annualizedContractSpend(contract);
          const monthly = Number(row.monthly || 0) || (annual ? annual / 12 : monthlyContractSpend(contract));
          const beds = Number(row.beds || 0) || facilityBedsForContract(contract);
          const census = Number(row.census || 0) || facilityCensusForContract(contract);
          const costBedMonth = Number(row.costBedMonth || 0) || (beds && monthly ? monthly / beds : 0);
          const ppd = Number(row.ppd || 0) || (census && annual ? annual / census / 365 : 0);
          const bedLabel = financeFacilitiesLoadingPromise ? "Loading" : "Needs bed match";
          const annualLabel = annual ? reportMoney(annual) : (contractHasFinanceCost(contract) ? "Rate needs qty" : "Needs cost");
          const monthlyLabel = monthly ? reportMoney(monthly) : (contractHasFinanceCost(contract) ? "Needs frequency" : "Needs cost");
          const bedCountLabel = beds ? beds.toLocaleString() : bedLabel;
          const censusLabel = census ? census.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "Needs census";
          const costBedLabel = costBedMonth ? reportMoney(costBedMonth) : (beds ? "Needs annualized" : bedLabel);
          const ppdLabel = ppd ? `$${ppd.toFixed(2)}` : (census ? "Needs annualized" : "Needs census");
          return `
            <tr class="clickable-row" onclick="openContractSafe('${jsArg(contract.id)}', '${jsArg(contract.name || contract.vendor || "")}')">
              <td class="finance-contract-cell"><strong>${escapeHtml(contract.name || "Untitled")}</strong></td>
              <td>${escapeHtml(row.facility || contract.facility || "Needs Review")}</td>
              <td>${escapeHtml(row.category || contract.category || "Needs Review")}</td>
              <td>${escapeHtml(row.vendor || contract.vendor || "Needs Review")}</td>
              <td class="finance-money-cell">${annualLabel}</td>
              <td class="finance-money-cell">${monthlyLabel}</td>
              <td class="finance-muted-cell">${bedCountLabel}</td>
              <td class="finance-muted-cell">${censusLabel}</td>
              <td class="finance-money-cell">${costBedLabel}</td>
              <td class="finance-money-cell">${ppdLabel}</td>
              <td><button class="btn ghost" onclick="event.stopPropagation(); openContractSafe('${jsArg(contract.id)}', '${jsArg(contract.name || contract.vendor || "")}')">Open</button></td>
            </tr>
          `;
        }).join("") || `<tr><td colspan="11">No financial contract rows yet. Add fee/rate, bed count, and census data.</td></tr>`;
      }
    }

    function renderContracts() {
      window.CONTRACT_APP_CONTRACTS_PAGE.renderContractsPage({
        activeContractView,
        badgeClass,
        contractData,
        contractFileUrl,
        contractFinderShowAll,
        contractListJoinedValue,
        contractListValue,
        contractSearchEngine,
        contractsTotalCount,
        contractViewMatches,
        currentPage,
        endDateDisplay,
        contractEndDateDisplay,
        escapeHtml,
        formatMoneyText,
        jsArg,
        sameMasterName,
        selectedContractIds,
        setCurrentPage: value => { currentPage = value; },
        updateBulkContractControls,
        updateContractViewButtons
      });
    }

    function renderReview() {
      const selected = selectedReviewContract();
      const baseReviewFields = reviewFields.length ? reviewFields : extracted;
      const fieldsToShow = (baseReviewFields.length || selected) ? ensureReviewChecklistFields(baseReviewFields) : baseReviewFields;
      const reviewCards = consolidateReviewCards(fieldsToShow);
      const fullText = reviewContractText();
      if (backendOnline && activeReviewContractId && !fullText && reviewFullRecordLoadingId !== activeReviewContractId) {
        reviewFullRecordLoadingId = activeReviewContractId;
        ensureFullContractRecord(activeReviewContractId).then(fullContract => {
          if (activeReviewContractId === fullContract?.id && (fullContract.ocrText || fullContract.ocrTextPreview)) {
            renderReview();
          }
        }).catch(() => {
          // Keep the review usable even if the OCR text cannot be fetched.
        }).finally(() => {
          if (reviewFullRecordLoadingId === activeReviewContractId) reviewFullRecordLoadingId = "";
        });
      }
      const stats = reviewCompletionStats(reviewCards);
      const requiredCardIndexes = new Set((stats.required || []).map(({ index }) => index));
      const primaryCards = reviewCards.filter(({ index }) => requiredCardIndexes.has(index));
      const primaryCardIndexes = new Set(primaryCards.map(({ index }) => index));
      const financeCards = reviewCards.filter(({ index, item }) => !primaryCardIndexes.has(index) && financeSupportCanonicalLabels.has(reviewCanonicalLabel(item.label)));
      const financeCardIndexes = new Set(financeCards.map(({ index }) => index));
      const otherCards = reviewCards.filter(({ index }) => !primaryCardIndexes.has(index) && !financeCardIndexes.has(index));
      const benchmark = contractBenchmarkComparison(selected, fieldsToShow);
      const approvedCount = stats.approved;
      const isSubmitted = isReviewSubmittedStatus(activeReviewStatus) || isReviewSubmittedStatus(selected?.status) || isReviewSubmittedStatus(selected?.reviewStatus);
      const statusLabel = isSubmitted ? "Submitted and saved" : reviewCards.length ? "Needs approval" : "Awaiting approval";
      const statusClass = isSubmitted ? "green" : reviewCards.length ? "amber" : "gray";
      const statusBadge = document.getElementById("reviewStatusBadge");
      if (statusBadge) {
        statusBadge.textContent = statusLabel;
        statusBadge.className = `badge ${statusClass}`;
      }
      const finder = document.getElementById("missingTermFinder");
      if (finder) finder.innerHTML = "";
      const searchPanel = document.getElementById("reviewOcrSearchPanel");
      const searchResults = document.getElementById("reviewOcrSearchResults");
      if (searchPanel) searchPanel.style.display = fullText ? "" : "none";
      if (searchResults && !fullText) searchResults.innerHTML = "";
      if (searchResults && fullText && !searchResults.innerHTML.trim()) {
        searchResults.innerHTML = `<div class="metric-row"><div><strong>Search OCR</strong><span>Type a term or use a chip.</span></div><button class="btn ghost" type="button" onclick="showFullOcrText()">Full OCR</button></div>`;
      }
      const preview = document.getElementById("reviewContractPreview");
      if (preview) {
        const sourceRecord = selectedReviewSourceRecord();
        // The contract file endpoint resolves the authoritative saved path on the server.
        // Lean queue records intentionally omit local paths, so do not hide the source here.
        const sourceFileUrl = sourceRecord.id ? `/api/contracts/${encodeURIComponent(sourceRecord.id)}/file` : "";
        const externalSourceUrl = sourceRecord.shareSyncUrl || (sourceRecord.url && sourceRecord.url !== "Pending ShareSync link" ? sourceRecord.url : "");
        const openSourceUrl = sourceFileUrl || externalSourceUrl;
        const sourceKind = contractSourceKind(sourceRecord);
        const sourceLabel = sourceKindLabel(sourceKind);
        const openLabel = sourceOpenLabel(sourceKind);
        const contractTitle = activeReviewContractName || selected?.name || "No contract selected";
        const ocrDocumentText = fullText ? fullText.slice(0, 120000) : "";
        const wordDocumentText = fullText ? fullText.slice(0, 50000) : "";
        const sourceSearchHtml = fullText ? `
          <div class="review-source-search">
            <div class="ask-box">
              <input id="reviewOcrSearchInput" placeholder="Search OCR: start date, fee, renewal, Net 30..." />
              <button class="btn primary" type="button" id="reviewOcrFindButton">Find</button>
              <button class="btn ghost" type="button" id="reviewOcrClearButton">Clear</button>
            </div>
            <div class="quick-prompts">
              <button class="prompt-chip" type="button" data-review-ocr-query="effective date commence start service start">Start</button>
              <button class="prompt-chip" type="button" data-review-ocr-query="initial term agreement shall commence year month">Term</button>
              <button class="prompt-chip" type="button" data-review-ocr-query="fee rate charge cost pricing schedule">Fee</button>
              <button class="prompt-chip" type="button" data-review-ocr-query="net payable invoice paid within due">Payment</button>
              <button class="prompt-chip" type="button" data-review-ocr-query="automatically renew renewal term">Renewal</button>
              <button class="prompt-chip" type="button" data-review-ocr-query="terminate termination written notice days">Exit</button>
            </div>
            <div id="reviewOcrSearchResults" class="metric-list review-search-results">
              <div class="metric-row"><div><strong>Ready</strong><span>Search this contract.</span></div><button class="btn ghost" type="button" onclick="showFullOcrText()">Full OCR</button></div>
            </div>
          </div>
        ` : "";
        preview.innerHTML = `
          <div class="contract-preview-shell">
            <div class="contract-preview-toolbar">
              <div>
                <strong>${escapeHtml(contractTitle)}</strong>
                <span class="badge ${statusClass}">${statusLabel}</span>
              </div>
              <div class="button-row">
                ${openSourceUrl ? `<a class="btn ghost" href="${escapeHtml(openSourceUrl)}" target="_blank" rel="noopener">${escapeHtml(openLabel)}</a>` : ""}
                <button class="btn ghost" type="button" onclick="showFullOcrText()">Full OCR</button>
              </div>
            </div>
            <div class="review-source-compare">
              <section class="review-source-pane">
                <div class="review-source-pane-head">
                  <div><strong>Original contract</strong><span>${escapeHtml(sourceLabel)}</span></div>
                  ${openSourceUrl ? `<a class="btn ghost" href="${escapeHtml(openSourceUrl)}" target="_blank" rel="noopener">Open</a>` : ""}
                </div>
                ${sourceFileUrl && sourceKind === "pdf" ? `
                  <iframe class="contract-preview-frame review-inline-source" src="${escapeHtml(sourceFileUrl)}" title="Original contract source"></iframe>
                ` : sourceFileUrl && sourceKind === "word" ? `
                  <div class="word-contract-document">
                    <article class="word-contract-page">
                      <h4>${escapeHtml(contractTitle)}</h4>
                      <pre>${escapeHtml(wordDocumentText || "No readable Word content was extracted. Open the original Word file to review it.")}</pre>
                      ${fullText.length > wordDocumentText.length ? `<p class="source">Showing the first ${wordDocumentText.length.toLocaleString()} characters for browser speed. Use Full OCR for the complete document.</p>` : ""}
                    </article>
                  </div>
                ` : sourceFileUrl ? `
                  <div class="paper review-file-placeholder"><h4>Original ${escapeHtml(sourceLabel)} file</h4><p>Open the source file while reviewing its extracted text.</p><a class="btn primary" href="${escapeHtml(sourceFileUrl)}" target="_blank" rel="noopener">${escapeHtml(openLabel)}</a></div>
                ` : `
                  <div class="paper review-file-placeholder"><h4>No source file linked</h4><p>Link the original PDF or Word contract before final approval.</p></div>
                `}
              </section>
              <section class="review-source-pane review-ocr-pane">
                <div class="review-source-pane-head"><div><strong>OCR text</strong><span>Searchable source</span></div><button class="btn ghost" type="button" onclick="showFullOcrText()">Open full</button></div>
                ${sourceSearchHtml}
                ${ocrDocumentText ? `<pre class="review-ocr-document">${escapeHtml(ocrDocumentText)}${fullText.length > ocrDocumentText.length ? "\n\n[Open Full OCR to view the remaining text.]" : ""}</pre>` : `<div class="paper review-file-placeholder"><h4>No OCR text</h4><p>Run OCR first, then compare it with the original contract.</p></div>`}
              </section>
            </div>
            <div class="contract-proof-strip">
              <span>${sourceFileUrl ? `${sourceLabel} source ready` : openSourceUrl ? "Open original available" : "No source file linked"}</span>
              ${reviewCards.length || selected ? `<span>${escapeHtml(reviewSaveStatus || "Check source before approval.")}</span>` : `<span>Select a contract.</span>`}
            </div>
            ${reviewCards.length || selected ? renderReviewSnapshot(selected, fieldsToShow) : ""}
            ${reviewCards.length ? `<div class="review-progress-line"><strong>${approvedCount} of ${stats.required.length}</strong> required fields marked OK.<div class="bar"><i style="width:${stats.percent}%"></i></div></div>` : ""}
          </div>
        `;
      }
      document.getElementById("extractedFields").innerHTML = reviewCards.length ? `
        ${reviewStatusCardHtml(selected)}
        <div class="card" style="grid-column:1/-1">
          <div class="panel-head"><h3>Required Fields</h3><span class="badge ${stats.remaining ? "amber" : "green"}">${stats.remaining ? `${stats.remaining} left` : "Ready"}</span></div>
        </div>
        ${primaryCards.map(({ item, index }) => reviewFieldCardHtml(item, index, "Required")).join("")}
        ${financeCards.length ? `
          ${reviewFinanceCalculatorHtml(fieldsToShow)}
          ${financeCards.map(({ item, index }) => reviewFieldCardHtml(item, index, "Finance")).join("")}
        ` : ""}
        ${otherCards.length ? `
          <details class="card optional-review-details" style="grid-column:1/-1">
            <summary><strong>Optional Details</strong><span>${otherCards.length} extra field${otherCards.length === 1 ? "" : "s"}</span></summary>
            <div class="grid" style="margin-top:12px">
              ${otherCards.map(({ item, index }) => reviewFieldCardHtml(item, index, "Optional")).join("")}
            </div>
          </details>
        ` : ""}
      ` : `<div class="metric-row"><div><strong>No reviews ready.</strong><span>Upload a contract.</span></div><span class="badge gray">Empty</span></div>`;
      if (reviewCards.length) {
        document.getElementById("extractedFields").insertAdjacentHTML("beforeend", `
          <div class="card" style="grid-column:1/-1">
            <div class="panel-head">
              <h3>${stats.remaining ? "Finish Review" : "Review Complete"}</h3>
              <span class="badge ${stats.remaining ? "amber" : "green"}">${stats.approved}/${stats.required.length} complete</span>
            </div>
            <div class="panel-body">
              <p style="margin-top:0;color:var(--muted)">${stats.remaining ? `Save the ${stats.remaining} required field${stats.remaining === 1 ? "" : "s"} still open.` : "Required fields are saved. Submit when ready."}</p>
            ${reviewBenchmarkApprovalHtml(benchmark)}
            <button class="btn primary" onclick="approveReviewFields()">Submit Contract</button>
            <span class="badge ${statusClass}" style="margin-left:8px">${statusLabel}</span>
            </div>
          </div>
        `);
      }
      reviewFeeLines = normalizeReviewFeeLines(reviewFeeLines);
      const feeLinesToShow = reviewFeeLines;
      document.getElementById("feeReviewRows").innerHTML = feeLinesToShow.map((f, index) => `
        <tr>
          <td><input data-fee-index="${index}" data-fee-field="service" value="${escapeHtml(cleanFeeLineDisplay(f.service || "", ""))}" placeholder="Type the service/fee name" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px" /></td>
          <td><input data-fee-index="${index}" data-fee-field="chargeType" value="${escapeHtml(f.chargeType || "")}" placeholder="Recurring" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px" /></td>
          <td><input data-fee-index="${index}" data-fee-field="unit" value="${escapeHtml(f.unit || "")}" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px" /></td>
          <td><input data-fee-index="${index}" data-fee-field="rate" value="${escapeHtml(f.rate || "")}" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px" /></td>
          <td><input data-fee-index="${index}" data-fee-field="quantity" value="${escapeHtml(f.quantity || "")}" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px" /></td>
          <td><input data-fee-index="${index}" data-fee-field="calculatedAmount" value="${escapeHtml(f.calculatedAmount || "")}" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px" /></td>
          <td><input data-fee-index="${index}" data-fee-field="frequency" value="${escapeHtml(f.frequency || "")}" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px" /></td>
          <td>
            <span style="display:block;color:var(--muted);font-size:12px;max-width:260px">${escapeHtml(shortSourceText(feeSourceSnippet(f)))}</span>
            <button class="btn ghost" type="button" onclick="showReviewFeeSource(${index})">View Source</button>
          </td>
          <td>
            <div class="table-actions" style="justify-content:flex-start">
              <button class="btn ${f.approved ? "primary" : "ghost"}" onclick="markFeeLineApproved(${index})">${f.approved ? "OK" : "Mark OK"}</button>
              <button class="btn danger" type="button" onclick="deleteReviewFeeLine(${index})">Delete</button>
            </div>
          </td>
        </tr>
      `).join("") || `<tr><td colspan="9">No fee lines found.</td></tr>`;
    }

    function renderFacilities() {
      const uniqueFacilities = dedupeRecords(facilityMasterOptions(), "name");
      const totalBeds = uniqueFacilities.reduce((sum, facility) => sum + Number(facility.beds || 0), 0);
      const withBeds = uniqueFacilities.filter(facility => Number(facility.beds || 0) > 0).length;
      const facilityDataNeeded = (facility = {}) => {
        const missing = [];
        if (!Number(facility.beds || 0)) missing.push("Beds");
        if (!Number(facility.averageDailyCensus || facility.currentCensus || 0)) missing.push("Census");
        if (!Number(facility.contracts || 0)) missing.push("Contracts");
        if (!moneyToNumber(facility.spend)) missing.push("Spend");
        if (!contractHasUsableValue(facility.address)) missing.push("Address");
        return missing;
      };
      const facilityAliasText = (facility = {}) => uniqueTextList([
        facility.shortName,
        facility.commonName,
        facility.dba,
        ...(Array.isArray(facility.aliases) ? facility.aliases : [])
      ].filter(alias => alias && !sameMasterName(alias, facility.name))).slice(0, 3).join(", ");
      const setFacilityStat = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
      };
      setFacilityStat("facilityTotalCount", uniqueFacilities.length.toLocaleString());
      setFacilityStat("facilityTotalBeds", totalBeds.toLocaleString());
      setFacilityStat("facilityAvgBeds", withBeds ? Math.round(totalBeds / withBeds).toLocaleString() : "0");
      setFacilityStat("facilityAddressCount", uniqueFacilities.filter(facility => contractHasUsableValue(facility.address)).length.toLocaleString());
      const facilitySearch = String(document.getElementById("facilitySearch")?.value || "").trim().toLowerCase();
      const matchedFacilities = facilitySearch
        ? uniqueFacilities.filter(facility => [
          facility.name,
          facility.dba,
          facility.legalName,
          facility.shortName,
          facility.commonName,
          facility.region,
          facility.county,
          facility.address,
          ...(Array.isArray(facility.aliases) ? facility.aliases : [])
        ].some(value => String(value || "").toLowerCase().includes(facilitySearch)))
        : uniqueFacilities;
      const visibleLimit = window.facilityDirectoryShowAll || facilitySearch ? 160 : 40;
      const visibleFacilities = matchedFacilities.slice(0, visibleLimit);
      const facilityResultSummary = document.getElementById("facilityResultSummary");
      if (facilityResultSummary) {
        facilityResultSummary.textContent = matchedFacilities.length > visibleFacilities.length
          ? `${visibleFacilities.length} of ${matchedFacilities.length}`
          : `${matchedFacilities.length} facilities`;
      }
      document.getElementById("facilityRows").innerHTML = visibleFacilities.map(f => `
        <tr>
          <td><strong>${escapeHtml(f.name)}</strong>${f.dba || f.legalName ? `<br><span style="color:var(--muted);font-size:12px">${escapeHtml(f.dba || f.legalName)}</span>` : ""}${facilityAliasText(f) ? `<br><span style="color:var(--muted);font-size:12px">Aliases: ${escapeHtml(facilityAliasText(f))}</span>` : ""}</td>
          <td>${escapeHtml(f.region || f.county || "")}${f.address ? `<br><span style="color:var(--muted);font-size:12px">${escapeHtml(f.address)}</span>` : ""}</td>
          <td><strong>${Number(f.beds || 0).toLocaleString()}</strong><br><span style="color:var(--muted);font-size:12px">beds</span>${Number(f.squareFeet || 0) ? `<br><span style="color:var(--muted);font-size:12px">${Number(f.squareFeet).toLocaleString()} sq ft</span>` : ""}</td>
          <td><strong>${Number(f.averageDailyCensus || f.currentCensus || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong><br><span style="color:var(--muted);font-size:12px">${escapeHtml(f.censusMonth || "census")}</span></td>
          <td><strong>${Number(f.contracts || 0).toLocaleString()}</strong></td>
          <td>${escapeHtml(f.spend || "$0")}</td>
          <td><strong>${costPerBed(f.spend, f.beds)}</strong></td>
          <td><strong>${facilityPpd(f.spend, f.averageDailyCensus || f.currentCensus)}</strong></td>
          <td><span class="badge ${facilityIsActive(f) ? "green" : "gray"}">${escapeHtml(facilityRecordType(f))}</span>${facilityIsActive(f) ? (facilityDataNeeded(f).length ? `<br>${facilityDataNeeded(f).map(item => `<span class="badge amber">${escapeHtml(item)}</span>`).join(" ")}` : `<br><span class="badge green">Ready</span>`) : ""}</td>
          <td><div class="table-actions"><button class="btn ghost" onclick="openFacility('${jsArg(f.name)}')">Open</button><button class="btn" onclick="openFacilityEditor('${jsArg(f.name)}')">Edit</button><button class="btn danger" onclick="deleteFacilityProfile('${jsArg(f.name)}')">Delete</button></div></td>
        </tr>
      `).join("") + (matchedFacilities.length > visibleFacilities.length ? `<tr><td colspan="10"><span class="badge gray">Search to narrow results or click Show All.</span></td></tr>` : "") || `<tr><td colspan="10">${facilitySearch ? "No facilities match this search." : "No facilities loaded yet."}</td></tr>`;
      document.getElementById("facilityCards").innerHTML = visibleFacilities.map(f => `
        <article class="card tile" role="button" tabindex="0" onclick="openFacility('${jsArg(f.name)}')">
          <div class="tile-title">
            <div><h3>${escapeHtml(f.name)}</h3><span style="color:var(--muted);font-size:12px">${escapeHtml(f.dba || f.legalName || f.address || f.region || "")}</span></div>
            <span class="badge ${facilityIsActive(f) ? (facilityDataNeeded(f).length ? "amber" : "green") : "gray"}">${escapeHtml(facilityIsActive(f) ? (facilityDataNeeded(f).length ? "Needs data" : "Ready") : facilityRecordType(f))}</span>
          </div>
          <div class="tile-stats">
            <div class="stat"><strong>${f.contracts || 0}</strong><span>Contracts</span></div>
            <div class="stat"><strong>${Number(f.beds || 0).toLocaleString()}</strong><span>Bed count</span></div>
            <div class="stat"><strong>${Number(f.squareFeet || 0) ? Number(f.squareFeet).toLocaleString() : "Not set"}</strong><span>Square feet</span></div>
            <div class="stat"><strong>${Number(f.averageDailyCensus || f.currentCensus || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong><span>Avg census</span></div>
            <div class="stat"><strong>${costPerBed(f.spend, f.beds)}</strong><span>Cost / bed</span></div>
            <div class="stat"><strong>${facilityPpd(f.spend, f.averageDailyCensus || f.currentCensus)}</strong><span>PPD</span></div>
          </div>
          ${f.address ? `<p style="margin:0;color:var(--muted);font-size:12px">${escapeHtml(f.address)}</p>` : ""}
          ${facilityAliasText(f) ? `<p style="margin:0;color:var(--muted);font-size:12px">Aliases: ${escapeHtml(facilityAliasText(f))}</p>` : ""}
          <div class="table-actions"><button class="btn" onclick="event.stopPropagation(); openFacilityEditor('${jsArg(f.name)}')">Edit</button><button class="btn danger" onclick="event.stopPropagation(); deleteFacilityProfile('${jsArg(f.name)}')">Delete</button></div>
          <span class="badge ${facilityDataNeeded(f).length ? "amber" : "green"}">${facilityDataNeeded(f).length ? "Missing: " + facilityDataNeeded(f).join(", ") : "Complete profile"}</span>
        </article>
      `).join("") || `<article class="card tile"><h3>${facilitySearch ? "No matches" : "No facilities loaded"}</h3><span style="color:var(--muted);font-size:13px">${facilitySearch ? "Try another facility, alias, or address." : "Import Excel data to populate facility records."}</span></article>`;
    }

    function renderVendors() {
      let uniqueVendors = vendorDirectoryCache?.revision === vendorDirectoryRevision
        ? vendorDirectoryCache.rows
        : null;
      if (!uniqueVendors) {
        const vendorStats = new Map();
        const vendorAliasNames = new Map();
        const vendorRecordsByKey = new Map();
        vendorsData.forEach(vendor => {
          [vendor.name, vendor.legalName, vendor.dba, ...(Array.isArray(vendor.aliases) ? vendor.aliases : [])]
            .filter(Boolean)
            .forEach(alias => {
              vendorAliasNames.set(masterKey(alias), vendor.name);
              vendorRecordsByKey.set(masterKey(alias), vendor);
            });
        });
        const canonicalStatsVendor = value => {
          const key = masterKey(value);
          return vendorAliasNames.get(key) || cleanMasterName(value);
        };
        contracts.forEach(contract => {
        const key = canonicalStatsVendor(contract.vendor);
        if (!key) return;
        const stats = vendorStats.get(key) || {
          contracts: 0,
          facilities: new Set(),
          categories: new Set(),
          spend: 0
        };
        stats.contracts += 1;
        if (contract.facility) stats.facilities.add(contract.facility);
        if (contract.category || contract.services) stats.categories.add(contract.category || contract.services);
        stats.spend += moneyToNumber(contract.annualCost || contract.spend || contract.contractValue || contract.monthlyCost);
          vendorStats.set(key, stats);
        });
        uniqueVendors = vendorMasterOptions().map(vendor => ({
        status: "Active",
        facilities: 0,
        contracts: 0,
        spend: "$0",
        insurance: "Needs review",
        issues: "None",
        ...(vendorRecordsByKey.get(masterKey(vendor.name)) || {}),
        ...vendor,
        name: vendor.name
      })).map(vendor => {
        const stats = vendorStats.get(canonicalStatsVendor(vendor.name));
        const contractFacilities = stats ? [...stats.facilities] : [];
        const savedFacilities = Array.isArray(vendor.facilitiesServed) ? vendor.facilitiesServed : [];
        const allFacilities = [...new Set([...savedFacilities, ...contractFacilities].filter(Boolean))];
        const contractCategories = stats ? [...stats.categories] : [];
        const categoryList = [...new Set([vendor.category, ...(Array.isArray(vendor.services) ? vendor.services : []), ...contractCategories].filter(Boolean))];
        const contractSpend = stats?.spend || 0;
        return {
          ...vendor,
          facilitiesList: allFacilities,
          categoryList,
          contracts: stats?.contracts || vendor.contracts || 0,
          spend: contractSpend ? reportMoney(contractSpend) : vendor.spend || "$0"
        };
        }).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
        vendorDirectoryCache = { revision: vendorDirectoryRevision, rows: uniqueVendors };
      }
      const search = String(document.getElementById("vendorSearch")?.value || "").toLowerCase().trim();
      const searchKey = masterKey(search);
      const vendorSearchMatches = value => {
        const text = String(value || "");
        return text.toLowerCase().includes(search)
          || Boolean(searchKey && masterKey(text).includes(searchKey));
      };
      const selectedCategory = String(document.getElementById("vendorCategoryFilter")?.value || "").toLowerCase().trim();
      const selectedFacility = String(document.getElementById("vendorFacilityFilter")?.value || "").toLowerCase().trim();
      const vendorSearchList = document.getElementById("vendorSearchList");
      if (vendorSearchList) {
        const datalistVendors = search
          ? uniqueVendors.filter(v => vendorSearchMatches([v.name, v.legalName, v.dba, v.category, ...(Array.isArray(v.aliases) ? v.aliases : [])].join(" "))).slice(0, 60)
          : uniqueVendors.slice(0, 60);
        vendorSearchList.innerHTML = datalistVendors.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml([v.category, v.primaryContact, v.phone, v.email].filter(Boolean).join(" | "))}</option>`).join("");
      }
      const vendorCategoryFilter = document.getElementById("vendorCategoryFilter");
      if (vendorCategoryFilter && vendorCategoryFilter.options.length <= 1) {
        const current = vendorCategoryFilter.value || "";
        const options = uniqueCategories(uniqueVendors.flatMap(v => v.categoryList || []));
        vendorCategoryFilter.innerHTML = `<option value="">All services</option>` + options.map(option => optionHtml(option, option, sameMasterName(option, current))).join("");
        vendorCategoryFilter.value = current;
      }
      const vendorFacilityFilterList = document.getElementById("vendorFacilityFilterList");
      if (vendorFacilityFilterList && !vendorFacilityFilterList.children.length) {
        vendorFacilityFilterList.innerHTML = facilityMasterOptions().map(f => `<option value="${escapeHtml(f.name)}">${escapeHtml([f.dba, f.address, f.beds ? `${f.beds} beds` : ""].filter(Boolean).join(" | "))}</option>`).join("");
      }
      const hasFilter = Boolean(search || selectedCategory || selectedFacility);
      const matchedVendors = hasFilter || window.vendorDirectoryShowAll ? uniqueVendors.filter(v => {
        const searchOk = !search || [
        v.name, v.legalName, v.dba, v.primaryContact, v.phone, v.email,
        v.mailingAddress, v.remitAddress, v.paymentTerms, v.category, v.insurance, v.issues,
        ...(Array.isArray(v.aliases) ? v.aliases : []), ...(v.categoryList || []), ...(v.facilitiesList || [])
        ].some(vendorSearchMatches);
        const categoryOk = !selectedCategory || (v.categoryList || []).some(category => String(category || "").toLowerCase().includes(selectedCategory));
        const facilityOk = !selectedFacility || (v.facilitiesList || []).some(facility => String(facility || "").toLowerCase().includes(selectedFacility));
        return searchOk && categoryOk && facilityOk;
      }) : [];
      const totalPages = Math.max(1, Math.ceil(matchedVendors.length / vendorPageSize));
      if (vendorPage > totalPages) vendorPage = totalPages;
      if (vendorPage < 1) vendorPage = 1;
      const startIndex = (vendorPage - 1) * vendorPageSize;
      const visibleVendors = matchedVendors.slice(startIndex, startIndex + vendorPageSize);
      const vendorResultCount = document.getElementById("vendorResultCount");
      if (vendorResultCount) {
        vendorResultCount.textContent = matchedVendors.length
          ? `${startIndex + 1}-${Math.min(startIndex + vendorPageSize, matchedVendors.length)} of ${matchedVendors.length}`
          : hasFilter ? "0 matches" : `${uniqueVendors.length} vendors`;
      }
      const vendorPageInfo = document.getElementById("vendorPageInfo");
      if (vendorPageInfo) vendorPageInfo.textContent = matchedVendors.length ? `Page ${vendorPage} of ${totalPages}` : "Page 1";
      const prevVendorPage = document.getElementById("prevVendorPage");
      const nextVendorPage = document.getElementById("nextVendorPage");
      if (prevVendorPage) prevVendorPage.disabled = vendorPage <= 1;
      if (nextVendorPage) nextVendorPage.disabled = vendorPage >= totalPages || !matchedVendors.length;
      document.getElementById("vendorRows").innerHTML = visibleVendors.map(v => `
        <tr class="clickable-row" onclick="openVendor('${jsArg(v.name)}')">
          <td><strong>${escapeHtml(v.name)}</strong>${v.legalName && v.legalName !== v.name ? `<br><span style="color:var(--muted);font-size:12px">Legal: ${escapeHtml(v.legalName)}</span>` : ""}</td>
          <td>${(v.categoryList || []).length ? v.categoryList.slice(0, 3).map(category => `<span class="badge blue">${escapeHtml(category)}</span>`).join(" ") : `<span style="color:var(--muted)">Not classified</span>`}${(v.facilitiesList || []).length ? `<br><span style="color:var(--muted);font-size:12px">${escapeHtml(v.facilitiesList.slice(0, 3).join(", "))}</span>` : ""}</td>
          <td>${[v.primaryContact, v.phone, v.email].filter(Boolean).map(escapeHtml).join("<br>") || `<span style="color:var(--muted)">Open profile</span>`}</td>
          <td>${escapeHtml(v.contracts || 0)}</td>
          <td>${escapeHtml(v.spend && v.spend !== "$0" ? v.spend : "")}</td>
          <td><div class="table-actions"><button class="btn primary" title="Open this vendor card to edit address, contacts, terms, insurance, notes, and linked contracts." onclick="event.stopPropagation(); openVendor('${jsArg(v.name)}')">Open Profile</button><button class="btn danger" title="Delete only this vendor profile. Linked contracts stay saved." onclick="event.stopPropagation(); deleteVendorProfile('${jsArg(v.name)}')">Delete Profile</button></div></td>
        </tr>
      `).join("") || `<tr><td colspan="6">${hasFilter ? "No vendors match this search. Type the new vendor name, then click New Vendor Profile to add it." : uniqueVendors.length ? "Search, filter, or click Show All." : "No vendors loaded yet. Upload and approve contracts, or import a vendor Excel file in Admin."}</td></tr>`;
    }

    async function loadVendorSearchResults(query = "") {
      const search = String(query || "").trim();
      if (!backendOnline || search.length < 2) return;
      try {
        const rows = await apiJson(`/api/vendors?q=${encodeURIComponent(search)}&limit=100`);
        if (!Array.isArray(rows)) return;
        const merged = dedupeRecords([...rows, ...vendorsData], "name");
        replaceArray(vendorsData, merged);
        vendorDirectoryRevision += 1;
        vendorDirectoryCache = null;
      } catch {
        // Keep the already-loaded vendor directory available if live search is temporarily unavailable.
      }
    }

    function showAllVendors() {
      window.vendorDirectoryShowAll = true;
      vendorPage = 1;
      renderVendors();
    }

    function clearVendorSearch() {
      const input = document.getElementById("vendorSearch");
      if (input) input.value = "";
      const category = document.getElementById("vendorCategoryFilter");
      if (category) category.value = "";
      const facility = document.getElementById("vendorFacilityFilter");
      if (facility) facility.value = "";
      window.vendorDirectoryShowAll = false;
      vendorPage = 1;
      renderVendors();
    }

    function newVendorProfile() {
      openVendor("New Vendor");
    }

    function renderCategories() {
      if (backendOnline && !servicesSummaryData) {
        loadSectionSummary("categories").catch(() => null);
      }
      const serviceSearch = String(document.getElementById("categoryServiceSearch")?.value || "").trim().toLowerCase();
      const summaryRows = Array.isArray(servicesSummaryData?.rows) ? servicesSummaryData.rows : [];
      const categorySource = summaryRows.length ? summaryRows.map(row => row.category) : categories;
      const categoryRows = categorySource.map(cat => {
        const summaryRow = summaryRows.find(row => sameMasterName(row.category, cat));
        const matches = contracts.filter(c => sameMasterName(c.category || c.services, cat));
        const summary = summaryRow || categoryData.find(item => item.category === cat) || {};
        const count = summary.contracts || matches.length;
        const spendTotal = Number(summary.spendValue || 0) || matches.reduce((sum, c) => sum + moneyToNumber(c.annualCost || c.spend || c.contractValue || c.monthlyCost), 0);
        const spend = contractHasUsableValue(summary.spend) ? summary.spend : (spendTotal ? reportMoney(spendTotal) : "");
        const searchText = `${cat} ${(summary.topVendors || []).join(" ")} ${matches.map(c => `${c.name} ${c.vendor} ${c.facility} ${c.category} ${c.services}`).join(" ")}`.toLowerCase();
        const facilities = summary.facilities ?? new Set(matches.map(c => c.facility).filter(contractHasUsableValue));
        const missing = summary.missing || matches.filter(c => !contractHasUsableValue(c.vendor) || !contractHasUsableValue(c.facility) || !contractHasUsableValue(c.fee || c.rate || c.contractValue || c.monthlyCost || c.annualCost || c.spend)).length;
        return { cat, matches, summary, count, spend, spendTotal, facilities, missing, searchText };
      });
      const filteredRows = serviceSearch
        ? categoryRows.filter(row => row.searchText.includes(serviceSearch))
        : categoryRows.filter(row => row.count > 0);
      const activeRows = filteredRows
        .sort((a, b) => (b.count - a.count) || a.cat.localeCompare(b.cat));
      const quickRows = (serviceSearch ? activeRows : categoryRows.filter(row => row.count > 0))
        .slice(0, 18);
      const activeAllRows = categoryRows.filter(row => row.count > 0);
      const serviceSetText = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
      };
      serviceSetText("serviceActiveCount", servicesSummaryData?.activeCount?.toLocaleString?.() || activeAllRows.length.toLocaleString());
      serviceSetText("serviceContractCount", servicesSummaryData?.contractCount?.toLocaleString?.() || activeAllRows.reduce((sum, row) => sum + Number(row.count || 0), 0).toLocaleString());
      serviceSetText("serviceSpendTotal", servicesSummaryData?.spend || reportMoney(activeAllRows.reduce((sum, row) => sum + Number(row.spendTotal || 0), 0)));
      serviceSetText("serviceMissingCount", servicesSummaryData?.missingCount?.toLocaleString?.() || activeAllRows.reduce((sum, row) => sum + Number(row.missing || 0), 0).toLocaleString());
      const visibleRows = activeRows.slice(0, serviceSearch ? 80 : 48);
      const resultCount = document.getElementById("categoryResultCount");
      if (resultCount) resultCount.textContent = serviceSearch ? `${activeRows.length} match${activeRows.length === 1 ? "" : "es"}` : `${activeRows.length} active`;
      document.getElementById("categoryQuickButtons").innerHTML = quickRows.map(({ cat, count }) => `
        <button class="prompt-chip" onclick="openCategory('${cat.replaceAll("'", "\\'")}')">${escapeHtml(cat)}${count ? ` (${count})` : ""}</button>
      `).join("") || `<span class="source">No service matches.</span>`;
      const activeHtml = visibleRows.map(({ cat, matches, summary, count, spend, facilities, missing }) => {
        const topVendors = Array.isArray(summary.topVendors) && summary.topVendors.length
          ? summary.topVendors.slice(0, 3)
          : [...new Set(matches.map(c => c.vendor).filter(contractHasUsableValue))].slice(0, 3);
        const facilityCount = facilities instanceof Set ? facilities.size : Number(facilities || 0);
        return `
        <article class="card tile service-card" role="button" tabindex="0" onclick="openCategory('${cat.replaceAll("'", "\\'")}')">
          <div class="service-card-head">
            <div>
              <h3>${escapeHtml(cat)}</h3>
              <span>${topVendors.length ? escapeHtml(topVendors.join(", ")) : "No vendor linked yet"}</span>
            </div>
            <span class="badge ${missing ? "amber" : count ? "green" : "gray"}">${missing ? "Needs cleanup" : "Ready"}</span>
          </div>
          <div class="service-card-stats">
            <div><strong>${Number(count || 0).toLocaleString()}</strong><span>Contracts</span></div>
            <div><strong>${facilityCount}</strong><span>Facilities</span></div>
            <div><strong>${spend || "TBD"}</strong><span>Spend</span></div>
          </div>
          <div class="service-card-meta">
            <span>${Number(summary.expiring90 || 0)} due 90d</span>
            <span>${Number(missing || 0)} missing</span>
          </div>
          <div class="table-actions"><button class="btn primary" onclick="event.stopPropagation(); openCategory('${cat.replaceAll("'", "\\'")}')">Open</button><button class="btn ghost" onclick="event.stopPropagation(); openReport('spend-by-service-vendor')">Report</button></div>
        </article>
      `}).join("");
      document.getElementById("categoryCards").innerHTML = activeHtml + (activeRows.length > visibleRows.length ? `
        <article class="card service-card muted-card" style="grid-column:1/-1">
          <div class="panel-body"><span class="badge gray">Showing ${visibleRows.length} of ${activeRows.length}. Search to narrow services.</span></div>
        </article>
      ` : "") || `
        <article class="card" style="grid-column:1/-1">
          <div class="panel-body">${serviceSearch ? "No services match that search." : "No categorized contracts yet."}</div>
        </article>
      `;
    }

    function renderRenewalsAndCompliance() {
      const renewalItems = dashboardRenewalItems(contracts);
      document.getElementById("renewalCenterRows").innerHTML = renewalItems.map(({ contract: c, window: noticeWindow, targetDate, days, basis }) => {
        const noticeClass = days <= 30 ? "red" : days <= 60 ? "amber" : "blue";
        const deadline = targetDate || "Needs Review";
        const emailTo = c.ownerEmail || c.owner || "Contract department";
        return `
        <tr class="clickable-row" onclick="openContractSafe('${jsArg(c.id)}', '${jsArg(c.name || c.vendor || "")}')" title="Open renewal details for ${escapeHtml(c.name)}">
          <td><span class="badge ${noticeClass}">${noticeWindow}</span></td>
          <td><button class="link-button" onclick="event.stopPropagation(); openContractSafe('${jsArg(c.id)}', '${jsArg(c.name || c.vendor || "")}')"><strong>${escapeHtml(c.name)}</strong></button><br><span style="color:var(--muted);font-size:12px">${escapeHtml(c.vendor || "Vendor needs review")}</span></td>
          <td>${escapeHtml(c.facility || "Needs Review")}</td>
          <td>${escapeHtml(deadline)}<br><span style="color:var(--muted);font-size:12px">${escapeHtml(basis || "")}</span></td>
          <td>${escapeHtml(emailTo)}</td>
          <td><select onclick="event.stopPropagation()" onchange="event.stopPropagation()"><option>Review</option><option>Renew</option><option>Renegotiate</option><option>Bid out</option><option>Terminate</option></select></td>
          <td><div class="table-actions"><button class="btn ghost" onclick="event.stopPropagation(); openContractSafe('${jsArg(c.id)}', '${jsArg(c.name || c.vendor || "")}')">Open</button><button class="btn danger" onclick="event.stopPropagation(); deleteContractRecord('${jsArg(c.id)}')">Delete</button></div></td>
        </tr>
      `}).join("") || `<tr><td colspan="7">No renewal records loaded yet.</td></tr>`;

      const complianceIssues = [];
      contracts.forEach(c => {
        const sourceLinked = contractHasUsableValue(c.localFilePath) || contractHasUsableValue(c.url) || contractHasUsableValue(c.shareSyncUrl);
        if (c.risk === "High" || c.risk === "Critical") {
          complianceIssues.push({ contract: c, issue: `${c.risk} risk`, priority: c.risk });
        }
        if (!sourceLinked) {
          complianceIssues.push({ contract: c, issue: "Missing PDF proof", priority: "Review" });
        }
        if (String(c.autoRenewal || "").toLowerCase() === "yes" && !contractHasUsableValue(c.notice) && !contractHasUsableValue(c.termination)) {
          complianceIssues.push({ contract: c, issue: "Auto-renewal: verify notice", priority: "Review" });
        }
        if (contractHasUsableValue(c.insuranceRequirement) && !contractHasUsableValue(c.insuranceCertificate)) {
          complianceIssues.push({ contract: c, issue: "Insurance proof missing", priority: "Review" });
        }
      });
      document.getElementById("complianceRows").innerHTML = complianceIssues.slice(0, 50).map(({ contract, issue, priority }) => `
        <tr class="clickable-row" onclick="openContractSafe('${jsArg(contract.id)}', '${jsArg(contract.name || contract.vendor || "")}')" title="Open ${escapeHtml(contract.name)}">
          <td>${escapeHtml(contract.facility || "Needs Review")}</td>
          <td><strong>${escapeHtml(issue)}</strong><br><span style="color:var(--muted);font-size:12px">${escapeHtml(contract.name)}</span></td>
          <td>${escapeHtml(contract.category || contract.services || "Needs Review")}</td>
          <td><span class="badge ${badgeClass(priority)}">${escapeHtml(priority)}</span></td>
          <td>${escapeHtml(contract.owner || "Contract department")}</td>
          <td><button class="btn primary" onclick="event.stopPropagation(); openContractSafe('${jsArg(contract.id)}', '${jsArg(contract.name || contract.vendor || "")}')">Review</button></td>
        </tr>
      `).join("") || `<tr><td colspan="6">No compliance exceptions.</td></tr>`;
    }

    function renderWeather() {
      const currentFacility = document.getElementById("weatherFacility").value;
      document.getElementById("weatherFacility").innerHTML = dedupeRecords(facilities, "name").map(f => optionHtml(f.name, f.name, sameMasterName(f.name, currentFacility))).join("");
      const weatherCategory = document.getElementById("weatherCategory");
      if (weatherCategory) {
        const currentCategory = weatherCategory.value;
        weatherCategory.innerHTML = categoryOptionsHtml(currentCategory, "Choose service type");
      }
      applyWeatherFacilityCoordinates();
      document.getElementById("weatherRows").innerHTML = weatherChecks.map(w => `
        <tr>
          <td>${w.date}</td>
          <td><strong>${w.facility}</strong></td>
          <td>${w.weather}</td>
          <td>${w.snowfall}</td>
          <td>${w.invoice}</td>
          <td>${w.rule}</td>
          <td><span class="badge ${w.status.includes("Review") || w.status.includes("Needs") ? "amber" : "green"}">${w.status}</span></td>
        </tr>
      `).join("") || `<tr><td colspan="7">No weather verification records loaded yet.</td></tr>`;
      if (weatherChecks[0]) renderWeatherResult(weatherChecks[0]);
      else document.getElementById("weatherResult").innerHTML = `<div class="metric-row"><div><strong>Ready for real weather lookup.</strong><span>Enter the facility latitude/longitude and service date. The app will call Open-Meteo historical weather for precipitation and snowfall.</span></div><span class="badge green">Ready</span></div>`;
    }

    function renderInvoices() {
      const invoiceVendor = document.getElementById("invoiceVendor");
      const invoiceFacility = document.getElementById("invoiceFacility");
      const currentVendor = invoiceVendor?.value || "";
      const currentFacility = invoiceFacility?.value || "";
      if (invoiceVendor) {
        const vendorOptions = vendorMasterOptions(currentVendor ? [currentVendor] : []);
        const invoiceVendorList = document.getElementById("invoiceVendorList");
        if (invoiceVendorList) invoiceVendorList.innerHTML = vendorOptions.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml([v.category, v.mailingAddress, v.phone, v.email].filter(Boolean).join(" | "))}</option>`).join("");
        invoiceVendor.value = currentVendor;
      }
      if (invoiceFacility) invoiceFacility.innerHTML = `<option value="">Let invoice OCR read it</option>` + dedupeRecords(facilities, "name").map(f => optionHtml(f.name, f.name, sameMasterName(f.name, currentFacility))).join("");
      if (invoiceUploads.length) {
        document.getElementById("invoiceUploadStatus").innerHTML = invoiceUploads.slice(0, 8).map(invoice => `
          <div class="metric-row">
            <div><strong>${escapeHtml(invoice.name || invoice.uploadedFileName || "Uploaded invoice")}</strong><span>${escapeHtml([invoice.vendor, invoice.facility, invoice.invoiceDate, invoice.total].filter(Boolean).join(" | ") || "Saved invoice file")}${invoice.matchedContractName ? ` | Matched: ${escapeHtml(invoice.matchedContractName)}` : ""}${invoice.costPerBed?.costPerBedLabel ? ` | Cost/bed: ${escapeHtml(invoice.costPerBed.costPerBedLabel)}` : invoice.costPerBed?.costPerBedLabel === "" ? ` | ${escapeHtml(invoice.costPerBed.costPerBedLabel || invoice.costPerBed.source || "Cost/bed needs review")}` : ""}</span></div>
            <div class="table-actions"><button class="btn primary" onclick="openInvoiceReviewModal('${jsArg(invoice.id)}')">Review Match</button><button class="btn" data-invoice-preview-id="${escapeHtml(invoice.id)}">View Invoice</button><span class="badge ${invoice.status === "Matched" ? "green" : invoice.status === "Needs Match" ? "amber" : "blue"}">${escapeHtml(invoice.status || "Received")}</span></div>
          </div>
        `).join("");
      } else {
        const approvedCount = contractData.filter(c => c.status === "Approved").length;
        document.getElementById("invoiceUploadStatus").innerHTML = `
          <div class="metric-row"><div><strong>${approvedCount ? "Ready for temporary invoice checks." : "Approve contracts first."}</strong><span>${approvedCount ? "Drop an invoice to compare it against approved contract records. The invoice file is not saved." : "Invoice matching works best after at least one contract has been uploaded, reviewed, and approved."}</span></div><span class="badge ${approvedCount ? "green" : "amber"}">${approvedCount ? "Ready" : "Needs contract"}</span></div>
        `;
      }
      const liveInvoiceRows = invoiceUploads.map(invoice => ({
        line: invoice.name || invoice.uploadedFileName || "Uploaded invoice",
        charge: invoice.total || "Needs Review",
        rule: invoice.matchedContractName || "Needs contract match",
        expected: invoice.costPerBed?.costPerBedLabel ? `${invoice.costPerBed.costPerBedLabel} per bed (${invoice.costPerBed.beds} beds)` : invoice.costPerBed?.source || (invoice.matchedContractId ? "Use matched contract terms" : "No match yet"),
        variance: invoice.costPerBed?.costPerBedLabel ? "Cost/bed calculated" : invoice.status === "Matched" ? "Review" : "Needs Match",
        status: invoice.status === "Matched" ? "Ready" : "Needs backup"
      }));
      const rowsToShow = liveInvoiceRows.length ? liveInvoiceRows : invoiceComparison;
      document.getElementById("invoiceRows").innerHTML = rowsToShow.map(row => `
        <tr>
          <td><strong>${escapeHtml(row.line)}</strong></td>
          <td>${escapeHtml(row.charge)}</td>
          <td>${escapeHtml(row.rule)}</td>
          <td>${escapeHtml(row.expected)}</td>
          <td><span class="badge ${String(row.variance).startsWith("+") || row.variance === "Review" || row.variance === "Needs Match" ? "amber" : "green"}">${escapeHtml(row.variance)}</span></td>
          <td><span class="badge ${row.status === "Exception" ? "red" : row.status === "Needs backup" ? "amber" : "green"}">${escapeHtml(row.status)}</span></td>
        </tr>
      `).join("") || `<tr><td colspan="6">No invoice comparison records loaded yet.</td></tr>`;
      renderInvoiceResult();
    }

    function renderExceptions() {
      document.getElementById("exceptionRows").innerHTML = exceptions.map(ex => `
        <tr>
          <td><strong>${escapeHtml(ex.issue || "Exception")}</strong></td>
          <td>${escapeHtml(ex.contract || "")}</td>
          <td>${escapeHtml(ex.facility || "")}</td>
          <td>${escapeHtml(ex.impact || "")}</td>
          <td>${escapeHtml(ex.owner || "")}</td>
          <td>${escapeHtml(ex.due || "")}</td>
          <td><span class="badge ${ex.status === "Critical" ? "red" : ex.status === "Review" ? "amber" : "blue"}">${escapeHtml(ex.status || "Open")}</span></td>
          <td><button class="btn ghost" onclick="openException('${jsArg(ex.contractId || ex.contract || "")}', '${jsArg(ex.issue || "Exception")}')">Open</button></td>
        </tr>
      `).join("") || `<tr><td colspan="8">No exceptions loaded yet.</td></tr>`;
    }

    function openException(contractRef, issue) {
      const contract = contractData.find(item => item.id === contractRef || item.name === contractRef)
        || contracts.find(item => item.id === contractRef || item.name === contractRef);
      if (contract) {
        openContract(contract.id);
        return;
      }
      document.getElementById("modalTitle").textContent = "Exception";
      document.getElementById("modalBody").innerHTML = `
        <article class="card">
          <div class="panel-head"><h3>${escapeHtml(issue)}</h3><span class="badge amber">Review</span></div>
          <div class="panel-body">
            <p>This exception is saved, but it is not linked to a specific contract record yet.</p>
            <button class="btn primary" onclick="switchSection('contracts'); closeModal();">Find Contract</button>
          </div>
        </article>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    function renderClauses(filter = "") {
      const term = String(filter || document.getElementById("clauseSearch")?.value || "").toLowerCase().trim();
      const riskType = String(document.getElementById("clauseRiskType")?.value || "").toLowerCase().trim();
      const riskLevel = String(document.getElementById("clauseRiskLevel")?.value || "").toLowerCase().trim();
      const riskTokens = riskType.split(/\s+/).filter(Boolean);
      const rows = clauses.filter(c => {
        const haystack = Object.values(c).join(" ").toLowerCase();
        const typeOk = !riskTokens.length || riskTokens.some(token => haystack.includes(token));
        const levelOk = !riskLevel || String(c.risk || "").toLowerCase().includes(riskLevel) || (riskLevel === "review" && /review|medium|high|needs/i.test(String(c.risk || "")));
        const textOk = !term || haystack.includes(term);
        return typeOk && levelOk && textOk;
      });
      document.getElementById("clauseRows").innerHTML = rows.map(c => `
        <tr>
          <td><strong>${escapeHtml(c.type || "Clause")}</strong></td>
          <td>${escapeHtml(c.contract || "")}</td>
          <td>${escapeHtml(c.facility || "")}</td>
          <td>${escapeHtml(c.snippet || "")}</td>
          <td><span class="badge ${c.risk === "High" ? "red" : c.risk === "Medium" || c.risk === "Review" ? "amber" : "green"}">${c.risk}</span></td>
          <td>${escapeHtml(c.source || "")}</td>
          <td><button class="btn ghost" onclick="openClauseSource('${jsArg(c.contract || "")}', '${jsArg(c.type || "Clause")}', '${jsArg(c.snippet || "")}', '${jsArg(c.source || "")}')">Source</button></td>
        </tr>
      `).join("") || `<tr><td colspan="7">No matching clauses found.</td></tr>`;
    }

    function clearRiskLanguageFilters() {
      const type = document.getElementById("clauseRiskType");
      const level = document.getElementById("clauseRiskLevel");
      const search = document.getElementById("clauseSearch");
      if (type) type.value = "";
      if (level) level.value = "";
      if (search) search.value = "";
      renderClauses("");
    }

    function openClauseSource(contractRef, type, snippet, source) {
      const contract = contractData.find(item => item.id === contractRef || item.name === contractRef)
        || contracts.find(item => item.id === contractRef || item.name === contractRef);
      document.getElementById("modalTitle").textContent = `${type} Source`;
      document.getElementById("modalBody").innerHTML = `
        <div class="grid">
          <article class="card">
            <div class="panel-head"><h3>${escapeHtml(type)}</h3><span class="badge blue">${escapeHtml(source || "Source")}</span></div>
            <div class="panel-body">
              <div class="paper">${escapeHtml(snippet || "No source snippet saved yet.")}</div>
              ${contract ? `<button class="btn primary" onclick="openContractSafe('${jsArg(contract.id)}', '${jsArg(contract.name || contract.vendor || "")}')">Open Contract</button>` : `<button class="btn" onclick="switchSection('contracts'); closeModal();">Find Contract</button>`}
            </div>
          </article>
        </div>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    function renderInvoiceResult() {
      const latest = invoiceUploads[0];
      if (latest) {
        const exceptionRows = (latest.exceptions || []).map(item => `<div class="metric-row"><div><strong>${escapeHtml(item.issue || "Review exception")}</strong><span>${escapeHtml(item.status || "Review")}</span></div><span class="badge amber">Check</span>${invoiceFixButton(latest.matchedContractId)}</div>`).join("");
        const realServiceLines = (latest.serviceLineChecks || []).filter(line => !/^No invoice service lines/i.test(line.description || ""));
        const reviewCount = realServiceLines.filter(line => !String(line.status || "").includes("Allowed")).length;
        const serviceLineRows = realServiceLines.slice(0, 10).map(line => {
          const ok = String(line.status || "").includes("Allowed");
          return `<div class="metric-row">
            <div>
              <strong>${escapeHtml(line.description || "Invoice line")}</strong>
              <span>${escapeHtml(line.amount || "")}${line.proof ? ` | ${escapeHtml(line.proof)}` : ""}</span>
            </div>
            <span class="badge ${ok ? "green" : "amber"}">${escapeHtml(line.status || "Review")}</span>
            ${ok ? "" : invoiceFixButton(latest.matchedContractId)}
          </div>`;
        }).join("");
        const resultOk = latest.reviewApproved || (latest.status === "Matched" && !reviewCount && !(latest.exceptions || []).length);
        const contractFeeText = latest.contractRate || latest.contractFee || latest.matchedContractFee || "No contract fee saved";
        const invoiceAmountNumber = moneyToNumber(latest.total);
        const contractFeeNumber = moneyToNumber(contractFeeText);
        const feeNeedsReview = !invoiceAmountNumber || !contractFeeNumber;
        const feeOverContract = invoiceAmountNumber && contractFeeNumber && invoiceAmountNumber > contractFeeNumber * 1.05;
        const feeBadge = feeNeedsReview ? "amber" : feeOverContract ? "red" : "green";
        const feeLabel = feeNeedsReview ? "Review" : feeOverContract ? "Over" : "OK";
        const feeMessage = feeNeedsReview
          ? "Need invoice total and saved contract fee/rate before approving payment."
          : feeOverContract
            ? "Invoice is higher than the saved contract fee/rate. Review before payment."
            : "Invoice total is within the saved contract fee/rate.";
        const comparisonRows = (latest.contractComparison || []).map(row => {
          const status = row.status || "Review";
          const badge = status === "OK" ? "green" : status === "Missing" ? "amber" : "red";
          return `<div class="metric-row">
            <div>
              <strong>${escapeHtml(row.label || "Comparison")}</strong>
              <span>Invoice: ${escapeHtml(row.invoiceValue || "Not found")} | Contract: ${escapeHtml(row.contractValue || "Not saved")}${row.note ? ` | ${escapeHtml(row.note)}` : ""}</span>
            </div>
            <span class="badge ${badge}">${escapeHtml(status)}</span>
          </div>`;
        }).join("");
        document.getElementById("invoiceMatchResult").innerHTML = `
          <div class="metric-row"><div><strong>${latest.reviewApproved ? "Invoice marked Looks OK" : resultOk ? "Invoice looks matched" : latest.status === "Matched" ? "Invoice matched, review flags" : "Needs contract match"}</strong><span>${latest.matchedContractName ? `Contract: ${escapeHtml(latest.matchedContractName)} (${latest.matchConfidence || 0}% confidence).` : "Choose vendor/facility or approve the contract first."}</span></div><span class="badge ${resultOk ? "green" : latest.status === "Matched" ? "amber" : "red"}">${latest.reviewApproved ? "Looks OK" : resultOk ? "OK" : "Review"}</span></div>
          <div class="metric-row"><div><strong>Invoice read</strong><span>Total: ${escapeHtml(latest.total || "Needs Review")} | Date: ${escapeHtml(latest.invoiceDate || "Needs Review")} | Invoice #: ${escapeHtml(latest.invoiceNumber || "Needs Review")}</span></div><span class="badge gray">OCR</span></div>
          <div class="metric-row fee-focus"><div><strong>Fee Check</strong><span>Invoice: ${escapeHtml(latest.total || "Needs Review")} | Contract fee/rate: ${escapeHtml(contractFeeText)}. ${escapeHtml(feeMessage)}</span></div><span class="badge ${feeBadge}">${feeLabel}</span>${feeNeedsReview || feeOverContract ? invoiceFixButton(latest.matchedContractId) : ""}</div>
          <div class="metric-row"><div><strong>Contract proof</strong><span>${escapeHtml((latest.matchReasons || []).join(", ") || "No strong match reason yet")}</span></div><div class="table-actions"><button class="btn primary" onclick="openInvoiceReviewModal('${jsArg(latest.id)}')">Open Match Review</button><button class="btn" data-invoice-preview-id="${escapeHtml(latest.id)}">View Invoice</button></div></div>
          <div class="metric-row"><div><strong>Cost per bed</strong><span>${escapeHtml(latest.costPerBed?.costPerBedLabel || latest.costPerBed?.source || "Needs facility bed count and invoice total")} ${latest.costPerBed?.beds ? `| Beds: ${escapeHtml(latest.costPerBed.beds)}` : ""}</span></div><span class="badge ${latest.costPerBed?.costPerBedLabel ? "green" : "amber"}">Per bed</span></div>
          <div class="metric-row"><div><strong>Charge lines found in contract</strong><span>${realServiceLines.length ? `${realServiceLines.length} possible charge line${realServiceLines.length === 1 ? "" : "s"} found. ${reviewCount ? `${reviewCount} need review.` : "All found in matched contract text."}` : "No separate charge lines found; use invoice total."}</span></div><span class="badge ${reviewCount ? "amber" : "blue"}">Service check</span></div>
          ${exceptionRows || `<div class="metric-row"><div><strong>No invoice exceptions found</strong><span>Still review the matched contract before paying.</span></div><span class="badge green">OK</span></div>`}
        `;
        return;
      }
      document.getElementById("invoiceMatchResult").innerHTML = `
        <div class="metric-row"><div><strong>No invoice checked yet.</strong><span>Upload an invoice after contracts are approved. This check is temporary and does not save the invoice file.</span></div><span class="badge gray">Empty</span></div>
      `;
    }

    function invoiceStatusBadge(status = "") {
      if (status === "OK" || String(status).includes("Allowed")) return "green";
      if (status === "Missing" || status === "Review") return "amber";
      return "red";
    }

    function invoiceFixButton(contractId = "", label = "Fix in Contract") {
      return contractId ? `<button class="btn ghost" onclick="closeModal(); openContractSafe('${jsArg(contractId)}', '')">${escapeHtml(label)}</button>` : "";
    }

    function showInvoiceOcrText(invoiceId = "") {
      const invoice = invoiceUploads.find(item => item.id === invoiceId) || invoiceUploads[0];
      if (!invoice) {
        showToast("Upload an invoice first.");
        return;
      }
      document.getElementById("modalTitle").textContent = "Invoice OCR Text";
      document.getElementById("modalBody").innerHTML = `
        <article class="card">
          <div class="panel-head"><h3>Invoice Text Read</h3><span class="badge gray">Temporary</span></div>
          <div class="panel-body">
            <textarea readonly style="width:100%;min-height:520px;border:1px solid var(--line);border-radius:8px;padding:12px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(invoice.ocrText || invoice.ocrTextPreview || "No invoice OCR text was saved for this temporary check.")}</textarea>
          </div>
        </article>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    function invoicePreviewHtml(invoice = {}) {
      if (!invoice.previewUrl) {
        return `<div class="metric-row"><div><strong>Invoice preview not available</strong><span>Upload the invoice again in this browser session to view the original PDF/image next to the match result. OCR text is still available.</span></div><span class="badge amber">Temporary</span></div>`;
      }
      if (/^image\//i.test(invoice.previewType || "")) {
        return `<img class="invoice-preview-image" src="${escapeHtml(invoice.previewUrl)}" alt="Uploaded invoice preview">`;
      }
      if (/pdf/i.test(invoice.previewType || invoice.uploadedFileName || invoice.name || "")) {
        return `<iframe class="invoice-preview-frame" src="${escapeHtml(invoice.previewUrl)}" title="Uploaded invoice preview"></iframe>`;
      }
      return `<div class="metric-row"><div><strong>${escapeHtml(invoice.uploadedFileName || invoice.name || "Uploaded invoice")}</strong><span>This file type was checked by OCR, but browser preview is only available for PDF and image invoices.</span></div><span class="badge gray">OCR only</span></div>`;
    }

    function showInvoicePreview(invoiceId = "") {
      const invoice = invoiceUploads.find(item => item.id === invoiceId) || invoiceUploads[0];
      if (!invoice) {
        showToast("Upload an invoice first.");
        return;
      }
      document.getElementById("modalTitle").textContent = "Original Invoice Preview";
      document.getElementById("modalBody").innerHTML = `
        <div class="record-header">
          <div class="record-title-row">
            <div>
              <h2>${escapeHtml(invoice.name || invoice.uploadedFileName || "Uploaded invoice")}</h2>
              <p>This is the actual invoice file you uploaded for this temporary check.</p>
            </div>
            <span class="badge ${invoice.status === "Matched" ? "green" : "amber"}">${escapeHtml(invoice.status || "Checked")}</span>
          </div>
          <div class="table-actions">
            <button class="btn primary" onclick="openInvoiceReviewModal('${jsArg(invoice.id)}')">Back to Match Review</button>
            <button class="btn" onclick="showInvoiceOcrText('${jsArg(invoice.id)}')">Invoice OCR</button>
          </div>
        </div>
        <article class="card premium-card" style="margin-top:14px">
          <div class="panel-head"><h3>Invoice Preview</h3><span class="badge blue">Original file</span></div>
          <div class="panel-body">${invoicePreviewHtml(invoice)}</div>
        </article>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    window.showInvoicePreview = showInvoicePreview;

    function showContractOcrFromInvoice(invoiceId = "") {
      const invoice = invoiceUploads.find(item => item.id === invoiceId) || invoiceUploads[0];
      const contract = invoice ? (contractData.find(c => c.id === invoice.matchedContractId) || contracts.find(c => c.id === invoice.matchedContractId)) : null;
      if (!contract) {
        showToast("No matched contract OCR to show.");
        return;
      }
      document.getElementById("modalTitle").textContent = "Matched Contract OCR Text";
      document.getElementById("modalBody").innerHTML = `
        <article class="card">
          <div class="panel-head"><h3>${escapeHtml(contract.name || "Matched contract")}</h3><span class="badge blue">Contract OCR</span></div>
          <div class="panel-body">
            <textarea readonly style="width:100%;min-height:520px;border:1px solid var(--line);border-radius:8px;padding:12px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(contract.ocrText || contract.ocrTextPreview || "No OCR text is saved for this contract yet.")}</textarea>
          </div>
        </article>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    function approveInvoiceCheck(invoiceId = "") {
      const invoice = invoiceUploads.find(item => item.id === invoiceId) || invoiceUploads[0];
      if (!invoice) return;
      invoice.reviewApproved = true;
      invoice.reviewApprovedAt = new Date().toISOString();
      invoice.status = "Looks OK";
      renderInvoiceResult();
      openInvoiceReviewModal(invoice.id);
      showToast("Invoice check marked Looks OK for this session.");
    }

    function openInvoiceReviewModal(invoiceId = "") {
      const invoice = invoiceUploads.find(item => item.id === invoiceId) || invoiceUploads[0];
      if (!invoice) {
        showToast("Upload an invoice first.");
        return;
      }
      const matchedContract = contractData.find(c => c.id === invoice.matchedContractId) || contracts.find(c => c.id === invoice.matchedContractId) || null;
      const comparisonRows = (invoice.contractComparison || []).map(row => {
        const needsFix = (row.status || "Review") !== "OK";
        return `
        <div class="metric-row">
          <div>
            <strong>${escapeHtml(row.label || "Comparison")}</strong>
            <span>Invoice: ${escapeHtml(row.invoiceValue || "Not found")} | Contract: ${escapeHtml(row.contractValue || "Not saved")}${row.note ? ` | ${escapeHtml(row.note)}` : ""}</span>
          </div>
          <span class="badge ${invoiceStatusBadge(row.status)}">${escapeHtml(row.status || "Review")}</span>
          ${needsFix ? invoiceFixButton(invoice.matchedContractId) : ""}
        </div>
      `;
      }).join("");
      const lineRows = (invoice.serviceLineChecks || [])
        .filter(line => !/^No invoice service lines/i.test(line.description || ""))
        .slice(0, 12)
        .map(line => {
          const needsFix = !String(line.status || "").includes("Allowed");
          return `
          <div class="metric-row">
            <div><strong>${escapeHtml(line.description || "Invoice line")}</strong><span>${escapeHtml(line.amount || "")}${line.proof ? ` | ${escapeHtml(line.proof)}` : ""}</span></div>
            <span class="badge ${invoiceStatusBadge(line.status)}">${escapeHtml(line.status || "Review")}</span>
            ${needsFix ? invoiceFixButton(invoice.matchedContractId) : ""}
          </div>
        `;
        }).join("");
      const exceptions = (invoice.exceptions || []).map(item => `
        <div class="metric-row"><div><strong>${escapeHtml(item.issue || "Review exception")}</strong><span>${escapeHtml(item.status || "Review")}</span></div><span class="badge amber">Check</span>${invoiceFixButton(invoice.matchedContractId)}</div>
      `).join("");
      const candidateRows = (invoice.contractCandidates || []).map((candidate, index) => `
        <div class="metric-row invoice-candidate-row">
          <div>
            <strong>${index + 1}. ${escapeHtml(candidate.contractName || "Possible contract")}</strong>
            <span>${escapeHtml([candidate.vendor, candidate.facility, candidate.category].filter(Boolean).join(" | "))}</span>
            <span>${escapeHtml((candidate.reasons || []).join(", ") || "Possible text match")}${candidate.contractRate ? ` | Saved rate: ${escapeHtml(candidate.contractRate)}` : ""}</span>
          </div>
          <div class="table-actions">
            <span class="badge ${candidate.confidence >= 70 ? "green" : candidate.confidence >= 45 ? "amber" : "gray"}">${escapeHtml(candidate.confidence || candidate.score || 0)}%</span>
            <button class="btn ghost" type="button" onclick="closeModal(); openContractSafe('${jsArg(candidate.contractId)}', '${jsArg(candidate.contractName || "Possible contract")}')">Open Contract</button>
          </div>
        </div>
      `).join("");
      const sourceUrl = matchedContract ? contractFileUrl(matchedContract) : "";
      const contractFeeText = matchedContract?.fee || matchedContract?.rate || invoice.contractRate || "No contract fee saved";
      const invoiceAmountNumber = moneyToNumber(invoice.total);
      const contractFeeNumber = moneyToNumber(contractFeeText);
      const feeNeedsReview = !invoiceAmountNumber || !contractFeeNumber;
      const feeOverContract = invoiceAmountNumber && contractFeeNumber && invoiceAmountNumber > contractFeeNumber * 1.05;
      const feeBadge = feeNeedsReview ? "amber" : feeOverContract ? "red" : "green";
      const feeLabel = feeNeedsReview ? "Review" : feeOverContract ? "Over" : "OK";
      const feeMessage = feeNeedsReview
        ? "Need invoice total and saved contract fee/rate before approving payment."
        : feeOverContract
          ? "Invoice is higher than the saved contract fee/rate. Review before payment."
          : "Invoice total is within the saved contract fee/rate.";
      document.getElementById("modalTitle").textContent = "Invoice Match Review";
      document.getElementById("modalBody").innerHTML = `
        <div class="record-header">
          <div class="record-title-row">
            <div>
              <h2>${escapeHtml(invoice.reviewApproved ? "Invoice marked Looks OK" : invoice.status === "Matched" ? "Invoice matched to contract" : "Invoice needs review")}</h2>
              <p>${escapeHtml(invoice.name || invoice.uploadedFileName || "Uploaded invoice")} ${invoice.matchConfidence ? `- ${escapeHtml(invoice.matchConfidence)}% confidence` : ""}</p>
            </div>
            <span class="badge ${invoice.reviewApproved ? "green" : invoice.status === "Matched" ? "green" : "amber"}">${escapeHtml(invoice.reviewApproved ? "Looks OK" : invoice.status || "Checked")}</span>
          </div>
          <div class="table-actions">
            <button class="btn primary" onclick="approveInvoiceCheck('${jsArg(invoice.id)}')">Mark Looks OK</button>
            <button class="btn" data-invoice-preview-id="${escapeHtml(invoice.id)}">View Invoice</button>
            <button class="btn" onclick="showInvoiceOcrText('${jsArg(invoice.id)}')">Invoice OCR</button>
            <button class="btn" onclick="showContractOcrFromInvoice('${jsArg(invoice.id)}')">Contract OCR</button>
            ${matchedContract ? `<button class="btn ghost" onclick="closeModal(); openContractSafe('${jsArg(matchedContract.id)}', '${jsArg(matchedContract.name || matchedContract.vendor || "")}')">Fix Contract</button>` : ""}
          </div>
        </div>
        <div class="invoice-review-layout">
          <article class="card premium-card">
            <div class="panel-head"><h3>Original Invoice</h3><span class="badge blue">What you uploaded</span></div>
            <div class="panel-body">${invoicePreviewHtml(invoice)}</div>
          </article>
          <article class="card premium-card">
            <div class="panel-head"><h3>Match Summary</h3><span class="badge ${feeBadge}">${feeLabel}</span></div>
            <div class="panel-body metric-list">
              <div class="metric-row fee-focus">
                <div><strong>Fee Check</strong><span>Invoice: ${escapeHtml(invoice.total || "Needs Review")} | Contract fee/rate: ${escapeHtml(contractFeeText)}. ${escapeHtml(feeMessage)}</span></div>
                <span class="badge ${feeBadge}">${feeLabel}</span>
                ${feeNeedsReview || feeOverContract ? invoiceFixButton(invoice.matchedContractId) : ""}
              </div>
              <div class="metric-row"><div><strong>Matched contract</strong><span>${escapeHtml(invoice.matchedContractName || "No contract matched")} ${invoice.matchConfidence ? `| ${escapeHtml(invoice.matchConfidence)}% confidence` : ""}</span></div><span class="badge ${invoice.matchedContractName ? "green" : "amber"}">Match</span></div>
              <div class="metric-row"><div><strong>Vendor / Facility</strong><span>${escapeHtml(matchedContract?.vendor || invoice.vendor || "Needs Review")} | ${escapeHtml(matchedContract?.facility || invoice.facility || "Needs Review")}</span></div><span class="badge gray">Record</span></div>
              <div class="metric-row"><div><strong>Payment terms</strong><span>Invoice: ${escapeHtml(invoice.paymentTerms || "Not found")} | Contract: ${escapeHtml(matchedContract?.paymentTerms || "Not saved")}</span></div><span class="badge ${invoice.paymentTerms ? "green" : "amber"}">Terms</span></div>
              <div class="table-actions">
                ${matchedContract ? `<button class="btn primary" onclick="closeModal(); openContractSafe('${jsArg(matchedContract.id)}', '${jsArg(matchedContract.name || matchedContract.vendor || "")}')">Open Contract</button>` : ""}
                ${sourceUrl ? `<a class="btn" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener">Open PDF</a>` : ""}
              </div>
            </div>
          </article>
        </div>
        <div class="field-grid" style="margin-top:14px">
          <article class="card premium-card">
            <div class="panel-head"><h3>Invoice Read</h3><span class="badge gray">Temporary</span></div>
            <div class="panel-body metric-list">
              <div class="metric-row"><div><strong>Total</strong><span>${escapeHtml(invoice.total || "Needs Review")}</span></div><span class="badge ${invoice.total ? "green" : "amber"}">Invoice</span></div>
              <div class="metric-row"><div><strong>Date / Number</strong><span>${escapeHtml(invoice.invoiceDate || "Needs Review")} | ${escapeHtml(invoice.invoiceNumber || "Needs Review")}</span></div><span class="badge gray">OCR</span></div>
              <div class="metric-row"><div><strong>Vendor / Facility</strong><span>${escapeHtml(invoice.vendor || "OCR did not name vendor")} | ${escapeHtml(invoice.facility || "OCR did not name facility")}</span></div><span class="badge gray">Read</span></div>
              <div class="metric-row"><div><strong>Payment terms</strong><span>${escapeHtml(invoice.paymentTerms || "Not found")}</span></div><span class="badge ${invoice.paymentTerms ? "green" : "amber"}">Terms</span></div>
              <div class="metric-row"><div><strong>Cost per bed</strong><span>${escapeHtml(invoice.costPerBed?.costPerBedLabel || invoice.costPerBed?.source || "Needs invoice total and bed count")}</span></div><span class="badge gray">CFO</span></div>
            </div>
          </article>
          <article class="card premium-card">
            <div class="panel-head"><h3>Matched Contract</h3><span class="badge blue">Contract</span></div>
            <div class="panel-body metric-list">
              <div class="metric-row"><div><strong>${escapeHtml(invoice.matchedContractName || "No contract matched")}</strong><span>${escapeHtml((invoice.matchReasons || []).join(", ") || "No match proof yet")}</span></div><span class="badge ${invoice.matchedContractName ? "green" : "amber"}">${escapeHtml(invoice.matchConfidence || 0)}%</span></div>
              <div class="metric-row"><div><strong>Vendor / Facility</strong><span>${escapeHtml(matchedContract?.vendor || invoice.vendor || "Needs Review")} | ${escapeHtml(matchedContract?.facility || invoice.facility || "Needs Review")}</span></div><span class="badge gray">Record</span></div>
              <div class="metric-row"><div><strong>Service / Fee</strong><span>${escapeHtml(matchedContract?.category || invoice.matchedCategory || "Needs Review")} | ${escapeHtml(matchedContract?.fee || matchedContract?.rate || invoice.contractRate || "No fee saved")}</span></div><span class="badge ${matchedContract?.fee || matchedContract?.rate || invoice.contractRate ? "green" : "amber"}">Terms</span></div>
              <div class="metric-row"><div><strong>Payment / Exit</strong><span>${escapeHtml(matchedContract?.paymentTerms || invoice.paymentTerms || "Needs Review")} | ${escapeHtml(matchedContract?.termination || matchedContract?.terminationClause || "No termination saved")}</span></div><span class="badge gray">Contract</span></div>
              <div class="table-actions">
                ${matchedContract ? `<button class="btn primary" onclick="closeModal(); openContractSafe('${jsArg(matchedContract.id)}', '${jsArg(matchedContract.name || matchedContract.vendor || "")}')">Open Contract</button>` : ""}
                ${sourceUrl ? `<a class="btn" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener">Open PDF</a>` : ""}
              </div>
            </div>
          </article>
        </div>
        <article class="card premium-card" style="margin-top:14px">
          <div class="panel-head"><h3>Possible Contracts</h3><span class="badge blue">${(invoice.contractCandidates || []).length} candidates</span></div>
          <div class="panel-body metric-list">
            ${candidateRows || `<div class="metric-row"><div><strong>No likely contract found</strong><span>Correct the vendor or facility hint, then upload the invoice again. The system will not guess.</span></div><span class="badge amber">Needs match</span></div>`}
          </div>
        </article>
        <article class="card premium-card" style="margin-top:14px">
          <div class="panel-head"><h3>Invoice vs Contract</h3><span class="badge blue">Compare</span></div>
          <div class="panel-body metric-list">
            ${comparisonRows || `<div class="metric-row"><div><strong>No comparison rows</strong><span>Approve contract fields, then upload invoice again.</span></div><span class="badge amber">Review</span></div>`}
          </div>
        </article>
        <article class="card premium-card" style="margin-top:14px">
          <div class="panel-head"><h3>Charge Lines</h3><span class="badge blue">Allowed?</span></div>
          <div class="panel-body metric-list">
            ${lineRows || `<div class="metric-row"><div><strong>No separate charge lines found</strong><span>Compare the invoice total to the contract fee/rate.</span></div><span class="badge amber">Review</span></div>`}
            ${exceptions || `<div class="metric-row"><div><strong>No exceptions found</strong><span>Still spot-check before approving payment.</span></div><span class="badge green">OK</span></div>`}
          </div>
        </article>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    function contractFieldByLabel(contract = {}, labels = []) {
      const targets = (Array.isArray(labels) ? labels : [labels]).map(reviewCanonicalLabel);
      return (contract.extractedFields || []).find(field => targets.includes(reviewCanonicalLabel(field.label || ""))) || null;
    }

    function contractConfidenceSummary(contract = {}) {
      const fields = contract.extractedFields || [];
      const importantLabels = ["Vendor", "Facility", "Category", "Start of Services", "Initial Contract Length", "Auto Renewal", "Notice Period", "Payment Terms", "Days Payable", "Fee"];
      const importantFields = importantLabels.map(label => contractFieldByLabel(contract, label)).filter(Boolean);
      const scored = (importantFields.length ? importantFields : fields).filter(field => Number(field.confidence || 0));
      const average = scored.length ? Math.round(scored.reduce((sum, field) => sum + Number(field.confidence || 0), 0) / scored.length) : 0;
      const missing = importantLabels.filter(label => {
        const field = contractFieldByLabel(contract, label);
        const value = field?.value || contract[reviewCanonicalLabel(label)] || "";
        return !contractHasUsableValue(value);
      });
      const low = scored.filter(field => Number(field.confidence || 0) < 70).length;
      const score = Math.max(0, Math.min(100, Math.round((average || 55) - missing.length * 4 - low * 3 + ((contract.status === "Approved" || contract.reviewStatus === "Approved") ? 10 : 0))));
      return { score, average, missing, low, fieldCount: fields.length };
    }

    function duplicateContractsFor(contract = {}) {
      const titleKey = masterKey(contract.name || contract.documentTitle || "");
      return contractData
        .filter(item => item.id !== contract.id)
        .filter(item => {
          const sameTitle = titleKey && masterKey(item.name || item.documentTitle || "") === titleKey;
          const sameVendorFacilityType = sameVendorName(item.vendor, contract.vendor)
            && sameMasterName(item.facility, contract.facility)
            && sameMasterName(item.category, contract.category);
          const sameFile = contract.uploadedFileName && item.uploadedFileName && masterKey(item.uploadedFileName) === masterKey(contract.uploadedFileName);
          return sameTitle || sameVendorFacilityType || sameFile;
        })
        .slice(0, 5);
    }

    function amendmentCandidatesFor(contract = {}) {
      return contractData
        .filter(item => item.id !== contract.id)
        .filter(item => {
          const typeText = `${item.documentType || ""} ${item.name || ""} ${item.category || ""}`.toLowerCase();
          const looksRelatedDoc = /\b(addendum|amendment|rider|extension|change order|supplement)\b/.test(typeText);
          if (!looksRelatedDoc) return false;
          return sameVendorName(item.vendor, contract.vendor)
            || sameMasterName(item.facility, contract.facility)
            || String(item.parentContractId || "") === String(contract.id || "");
        })
        .slice(0, 5);
    }

    function contractCorrectionRows(contract = {}) {
      const fieldMap = [
        ["Vendor", "vendor"],
        ["Facility", "facility"],
        ["Service Type", "category"],
        ["Start", "startOfServices"],
        ["End", "end"],
        ["Term", "initialContractLength"],
        ["Auto Renewal", "autoRenewal"],
        ["Notice", "terminationClause"],
        ["Payment", "paymentTerms"],
        ["Days Payable", "daysPayable"],
        ["Fee", "fee"]
      ];
      return fieldMap.map(([label, key]) => {
        const field = contractFieldByLabel(contract, label);
        const ocrValue = field?.value || "";
        const savedValue = contract[key] || "";
        const changed = contractHasUsableValue(ocrValue) && contractHasUsableValue(savedValue) && String(ocrValue).trim() !== String(savedValue).trim();
        return { label, ocrValue, savedValue, confidence: field?.confidence || "", source: field?.source || "", changed };
      });
    }

    function lifecycleStatusForContract(contract = {}) {
      const raw = String(contract.contractStatus || contract.status || contract.reviewStatus || "").trim();
      if (/archived/i.test(raw) || contract.archived) return "Archived";
      if (/terminated|cancelled|canceled/i.test(raw)) return "Terminated";
      if (/renewal/i.test(raw)) return "Renewal Review";
      if (/active/i.test(raw)) return "Active";
      if (/approved/i.test(raw)) return "Approved";
      if (/needs|review|pending/i.test(raw)) return "Needs Review";
      if (/ocr|read|complete/i.test(raw)) return "OCR Read";
      if (contract.localFilePath || contract.uploadedFileName) return "Uploaded";
      return "Needs Review";
    }

    function requiredFieldsForContractType(contract = {}) {
      return contractRequirementProfile(contract);
    }

    function governanceNextAction(contract = {}, confidence = contractConfidenceSummary(contract), requiredRows = requiredFieldsForContractType(contract)) {
      if (contract.status !== "Approved" && contract.reviewStatus !== "Approved") return "Review and approve OCR fields";
      if (requiredRows.some(row => !row.ok)) return "Complete required fields for this contract type";
      if (isAutoRenewing(contract.autoRenewal) && !contractHasUsableValue(contract.terminationClause) && !contractHasUsableValue(contract.noticePeriod)) return "Find termination / notice language";
      if (confidence.score < 75) return "Resolve low-confidence fields";
      if (!contractHasUsableValue(contract.owner)) return "Assign contract owner";
      return "Monitor renewal, invoices, and vendor card";
    }

    async function uploadInvoiceFile(file, index = 1, total = 1) {
      if (!requireBackend("Invoice matching")) throw new Error("Backend not connected");
      const validationError = validateUploadFile(file, allowedInvoiceUploadExts);
      if (validationError) throw new Error(validationError);
      const form = new FormData();
      form.append("file", file);
      form.append("name", file.name);
      form.append("vendor", document.getElementById("invoiceVendor")?.value || "");
      form.append("facility", document.getElementById("invoiceFacility")?.value || "");
      form.append("invoiceDate", document.getElementById("invoiceDate")?.value || "");
      form.append("total", document.getElementById("invoiceTotal")?.value || "");
      const response = await fetch(`${apiBase}/api/upload-invoice`, { method: "POST", body: form });
      if (!response.ok) throw new Error(await responseErrorMessage(response, "Invoice upload failed."));
      const invoice = await response.json();
      invoice.previewUrl = URL.createObjectURL(file);
      invoice.previewType = file.type || "";
      invoiceUploads = [invoice, ...invoiceUploads.filter(item => item.id !== invoice.id)];
      document.getElementById("invoiceUploadStatus").innerHTML = `
        <div class="metric-row"><div><strong>${escapeHtml(file.name)}</strong><span>Checked ${index} of ${total}. ${invoice.matchedContractName ? `Matched to ${escapeHtml(invoice.matchedContractName)}.` : "Not saved; review the match result below."}</span></div><div class="table-actions"><button class="btn primary" onclick="openInvoiceReviewModal('${jsArg(invoice.id)}')">Review Match</button><button class="btn" data-invoice-preview-id="${escapeHtml(invoice.id)}">View Invoice</button><span class="badge ${invoice.status === "Matched" ? "green" : "amber"}">${escapeHtml(invoice.status || "Checked")}</span></div></div>
      `;
      return invoice;
    }

    async function handleInvoiceFiles(files) {
      const selected = [...(files || [])].filter(file => file?.name);
      if (!selected.length) {
        showToast("Drop or choose at least one invoice file.");
        return;
      }
      const uploaded = [];
      for (const [index, file] of selected.entries()) {
        uploaded.push(await uploadInvoiceFile(file, index + 1, selected.length));
      }
      invoiceUploads = [...uploaded, ...invoiceUploads.filter(invoice => !uploaded.some(item => item.id === invoice.id))];
      document.getElementById("invoiceUploadStatus").innerHTML = uploaded.map((invoice, index) => `
        <div class="metric-row">
          <div><strong>${escapeHtml(invoice.name)}</strong><span>Invoice ${index + 1} of ${uploaded.length}. Temporary check complete; file was not saved.</span></div>
          <div class="table-actions"><button class="btn primary" onclick="openInvoiceReviewModal('${jsArg(invoice.id)}')">Review Match</button><button class="btn" data-invoice-preview-id="${escapeHtml(invoice.id)}">View Invoice</button><span class="badge ${invoice.status === "Matched" ? "green" : "amber"}">${escapeHtml(invoice.status || "Checked")}</span></div>
        </div>
      `).join("") + `<div class="metric-row"><div><strong>Next step</strong><span>Review the match result below. Refresh the page to clear invoice checks.</span></div><span class="badge amber">Review</span></div>`;
      renderInvoiceResult();
      showToast(`Checked ${uploaded.length} invoice${uploaded.length === 1 ? "" : "s"} against contracts.`);
    }

    function renderWeatherResult(result) {
      const dailyRows = Array.isArray(result.dailyRows) ? result.dailyRows : [];
      document.getElementById("weatherResult").innerHTML = `
        <div class="metric-row"><div><strong>${escapeHtml(result.facility || "Selected facility")}</strong><span>${escapeHtml(result.date || "")} weather result</span></div><span class="badge blue">${escapeHtml(result.weather || "Checked")}</span></div>
        <div class="metric-row"><div><strong>Total snowfall</strong><span>Historical snowfall for the selected place and date range.</span></div><span class="badge ${Number(result.snowfallInches || parseFloat(result.snowfall)) > 0 ? "green" : "amber"}">${escapeHtml(result.snowfall || "0.00 in")}</span></div>
        <div class="metric-row"><div><strong>Precipitation</strong><span>Rain + snow water equivalent: ${escapeHtml(result.precipitation || "0.00 in")}. Rain: ${escapeHtml(result.rain || "0.00 in")}.</span></div><span class="badge gray">Weather</span></div>
        <div class="metric-row"><div><strong>Temperature / wind</strong><span>High: ${escapeHtml(result.temperatureHigh ?? "N/A")}°F | Low: ${escapeHtml(result.temperatureLow ?? "N/A")}°F | Max wind: ${escapeHtml(result.windMaxMph ?? "N/A")} mph</span></div><span class="badge gray">Daily</span></div>
        <div class="metric-row"><div><strong>Invoice check</strong><span>${escapeHtml(result.rule || "Compare to contract weather clause")}. Vendor invoice: ${escapeHtml(result.invoice || "")}.</span></div><span class="badge ${String(result.status || "").includes("No") ? "amber" : "green"}">${escapeHtml(result.status || "Checked")}</span></div>
        <div class="metric-row"><div><strong>Source</strong><span>${escapeHtml(result.source || "Open-Meteo Historical Weather API")}</span></div><span class="badge green">Real data</span></div>
        ${dailyRows.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Weather</th><th>Snow</th><th>Precipitation</th><th>High / Low</th></tr></thead><tbody>${dailyRows.map(row => `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.weather)}</td><td><strong>${escapeHtml(row.snowfall)}</strong></td><td>${escapeHtml(row.precipitation)}</td><td>${escapeHtml(row.temperatureHigh ?? "N/A")} / ${escapeHtml(row.temperatureLow ?? "N/A")} °F</td></tr>`).join("")}</tbody></table></div>` : ""}
      `;
    }

    async function openContract(id) {
      const scroller = document.querySelector("main");
      const keepY = scroller ? scroller.scrollTop : window.scrollY;
      let c = contractData.find(item => item.id === id) || contracts.find(item => item.id === id) || null;
      if (!c && id && backendOnline) {
        try {
          c = normalizeContract(await apiJson(`/api/contracts/${encodeURIComponent(id)}`));
          upsertLiveContract(c, { markDirty: false });
        } catch (error) {
          console.warn("Contract lookup failed:", error);
        }
      }
      if (!c) {
        showToast("No live contract record is available yet.");
        return;
      }
      try {
        c = await ensureFullContractRecord(c.id) || c;
      } catch (error) {
        showToast("Full contract details did not load yet. Showing the saved list summary.");
      }
      await ensureCompactContractIndex();
      reviewFields = c.extractedFields || [];
      reviewFeeLines = c.extractedFeeLines || [];
      activeReviewContractId = c.id;
      activeReviewContractName = c.name;
      activeReviewStatus = c.status || c.reviewStatus || "Needs Review";
      reviewSaveStatus = c.status === "Approved" ? "Approved." : "Review required fields.";
      setActiveWorkContext({ itemId: c.id || "", itemName: c.name || "Contract", action: "Viewing contract card", immediate: true });
      const activeFeeSchedule = c.extractedFeeLines || [];
      const sourceFileUrl = contractFileUrl(c);
      const shareSyncSourceLabel = c.shareSyncLocalPath || c.localFilePath || c.shareSyncUrl || "";
      const sourceKind = contractSourceKind(c);
      const sourceLabel = sourceKindLabel(sourceKind);
      const openLabel = sourceOpenLabel(sourceKind);
      const contractAudit = auditLogs.filter(log => log.entityType === "contract" && log.entityId === c.id);
      const relatedDocuments = Array.isArray(c.relatedDocuments) ? c.relatedDocuments : [];
      const vendorCard = vendorForContract(c);
      const confidence = contractConfidenceSummary(c);
      const duplicates = duplicateContractsFor(c);
      const amendmentCandidates = amendmentCandidatesFor(c);
      const correctionRows = contractCorrectionRows(c);
      const lifecycleStatus = lifecycleStatusForContract(c);
      const requiredRows = requiredFieldsForContractType(c);
      const sourceProofRows = contractSourceProofRows(c);
      const learnedRequiredRows = requiredRows.filter(row => row.learned || row.vendorSpecific || row.serviceSpecific);
      const governanceAction = governanceNextAction(c, confidence, requiredRows);
      const currentStatus = contractCurrentStatus(c);
      const renewalAlert = contractRenewalAlert(c);
      const historyGroup = relatedContractHistory(c);
      const olderHistory = historyGroup.filter(item => item.id !== c.id);
      const hasUsableVendor = contractHasUsableValue(c.vendor) && !isBadVendorReviewValue(c.vendor);
      const vendorRelatedContracts = hasUsableVendor
        ? [...new Map(contractData
          .filter(item => item?.id && item.id !== c.id)
          .filter(item => contractHasUsableValue(item.vendor) && !isBadVendorReviewValue(item.vendor))
          .filter(item => sameMasterName(item.vendor, c.vendor))
          .map(item => [item.id, item])).values()].sort(contractHistorySort)
        : [];
      const parentContract = c.parentContractId
        ? contractData.find(item => item.id === c.parentContractId)
        : null;
      const parentLabel = parentContract?.name || c.parentContractName || c.parentContractId || "None linked";
      document.getElementById("modalTitle").textContent = "Contract Card";
      document.getElementById("modalBody").innerHTML = `
        <div class="record-header">
          <div class="record-title-row">
            <div>
              <span class="record-eyebrow">Saved contract record</span>
              <h2>${escapeHtml(c.name)}</h2>
              <div class="record-meta">
                <span>${escapeHtml(c.id || "No contract ID")}</span>
                <span>${escapeHtml(c.facility || "Facility needs review")}</span>
                <span>${escapeHtml(c.vendor || "Vendor needs review")}</span>
                <span>${escapeHtml(c.services || c.category || "Service needs review")}</span>
              </div>
              ${c.sourceDocumentName && !sameMasterName(c.sourceDocumentName, c.name) ? `<div class="source" style="margin-top:8px">Original file: ${escapeHtml(c.sourceDocumentName)}</div>` : ""}
            </div>
            <div class="table-actions">
              <button class="btn primary" onclick="openReviewContractRecord('${jsArg(c.id)}')">${c.reviewStatus === "Approved" || c.approvedAt ? "Recheck Fields" : "Review Fields"}</button>
              ${sourceFileUrl ? `<a class="btn ghost" href="${escapeHtml(sourceFileUrl)}" target="_blank" rel="noopener">${escapeHtml(openLabel)}</a>` : ""}
              <button class="btn ghost" onclick="openVendor('${jsArg(vendorCard.name)}')">Vendor</button>
              <button class="btn ghost" onclick="showContractVersions('${jsArg(c.id)}')">Versions</button>
              <button class="btn ghost" onclick="openContractEmail('${jsArg(c.id)}', 'internal')">Email</button>
            </div>
          </div>
          <div class="contract-chip-row">
            <span class="badge ${badgeClass(c.contractStatus || c.status)}">${escapeHtml(c.contractStatus || c.status || "Needs Review")}</span>
            <span class="badge ${confidence.score >= 85 ? "green" : confidence.score >= 65 ? "amber" : "red"}">Confidence ${confidence.score}/100</span>
            <span class="badge ${currentStatus.className}">${escapeHtml(currentStatus.label)}</span>
            <span class="badge ${c.autoRenewal === "Yes" ? "amber" : "gray"}">Auto-renewal: ${escapeHtml(c.autoRenewal || "Unknown")}</span>
            <span class="badge ${badgeClass(c.risk)}">Risk: ${escapeHtml(c.risk || "Needs Review")}</span>
            ${c.approvedAt ? `<span class="badge green">Last reviewed: ${escapeHtml(formatDate(c.approvedAt))}</span>` : ""}
          </div>
          <div class="record-facts">
            <div class="record-fact"><span>Start</span><strong title="${escapeHtml(c.startOfServices || c.start || "Needs Review")}">${escapeHtml(c.startOfServices || c.start || "Needs Review")}</strong></div>
            <div class="record-fact"><span>End</span><strong title="${escapeHtml(endDateDisplay(c.end, c.autoRenewal) || "No fixed end date")}">${escapeHtml(endDateDisplay(c.end, c.autoRenewal) || "No fixed end date")}</strong></div>
            <div class="record-fact"><span>Length</span><strong title="${escapeHtml(c.initialContractLength || "Needs Review")}">${escapeHtml(c.initialContractLength || "Needs Review")}</strong></div>
            <div class="record-fact"><span>Fee / Rate</span><strong title="${escapeHtml(c.fee || c.rate || c.spend || "Needs Review")}">${escapeHtml(c.fee || c.rate || c.spend || "Needs Review")}</strong></div>
            <div class="record-fact"><span>Payment</span><strong title="${escapeHtml([c.paymentTerms, c.daysPayable].filter(Boolean).join(" / ") || "Needs Review")}">${escapeHtml([c.paymentTerms, c.daysPayable].filter(Boolean).join(" / ") || "Needs Review")}</strong></div>
            <div class="record-fact"><span>Next Action</span><strong title="${escapeHtml(governanceAction)}">${escapeHtml(governanceAction)}</strong></div>
          </div>
        </div>
        <div class="split">
          <div class="document-preview">
            <div class="paper">
              <h4>${escapeHtml(c.name)}</h4>
              <p><strong>ShareSync ${escapeHtml(sourceLabel)}:</strong> ${shareSyncSourceLabel ? escapeHtml(queuePathName(shareSyncSourceLabel) || shareSyncSourceLabel) : "No ShareSync source file linked yet."}</p>
              <p><span class="highlight">${escapeHtml(c.vendor || "Vendor needs review")}</span> | <span class="highlight">${escapeHtml(c.facility || "Facility needs review")}</span> | <span class="highlight">${escapeHtml(c.category || c.services || "Service needs review")}</span></p>
              <p>Term: <span class="highlight">${escapeHtml(endDateDisplay(c.end, c.autoRenewal))}</span></p>
              ${sourceFileUrl ? `<p><a class="btn primary" href="${escapeHtml(sourceFileUrl)}" target="_blank" rel="noopener">Open Original ${escapeHtml(sourceLabel)}</a></p>` : ""}
            </div>
          </div>
          <div class="grid">
            <article class="card">
              <div class="panel-head"><h3>Relationship</h3><span class="badge blue">Linked record</span></div>
              <div class="panel-body metric-list">
                <div class="metric-row"><div><strong>Contract ID</strong><span>${escapeHtml(c.id || "No contract ID")}</span></div><span class="badge blue">ID</span></div>
                <div class="metric-row"><div><strong>Parent contract</strong><span>${escapeHtml(parentLabel)}</span></div><span class="badge ${parentContract || c.parentContractId ? "green" : "gray"}">${parentContract || c.parentContractId ? "Linked" : "None"}</span></div>
                <div class="metric-row"><div><strong>Vendor card</strong><span>${escapeHtml(vendorCard.name || c.vendor || "Needs vendor")}</span></div><button class="btn ghost" onclick="openVendor('${jsArg(vendorCard.name || c.vendor || "")}')">Open</button></div>
                <div class="metric-row"><div><strong>Facility</strong><span>${escapeHtml(c.facility || "Needs facility")}</span></div><span class="badge ${contractHasUsableValue(c.facility) ? "green" : "amber"}">${contractHasUsableValue(c.facility) ? "Linked" : "Review"}</span></div>
                <div class="metric-row"><div><strong>Same vendor</strong><span>${escapeHtml(vendorRelatedContracts.length ? `${vendorRelatedContracts.length} other contract${vendorRelatedContracts.length === 1 ? "" : "s"} across facilities.` : "No other vendor contracts found yet.")}</span></div><span class="badge ${vendorRelatedContracts.length ? "blue" : "gray"}">${vendorRelatedContracts.length}</span></div>
                ${parentContract?.id ? `<button class="btn primary" onclick="openContractSafe('${jsArg(parentContract.id)}', '${jsArg(parentContract.name || "")}')">Open Parent Contract</button>` : ""}
              </div>
            </article>
            <article class="card">
              <div class="panel-head"><h3>Vendor Contact</h3><span class="badge ${vendorCard.hasProfile ? "green" : "amber"}">${vendorCard.hasProfile ? "Vendor profile linked" : "Needs vendor profile"}</span></div>
              <div class="panel-body metric-list">
                <div class="metric-row"><div><strong>${escapeHtml(vendorCard.name)}</strong><span>Legal name: ${escapeHtml(vendorCard.legalName || "Needs review")}</span></div><span class="badge blue">Vendor</span></div>
                <div class="metric-row"><div><strong>Primary contact</strong><span>${escapeHtml(vendorCard.primaryContact || "Contact person not saved yet")}</span></div><span class="badge ${vendorCard.primaryContact ? "green" : "amber"}">${vendorCard.primaryContact ? "Saved" : "Needed"}</span></div>
                <div class="metric-row"><div><strong>Phone / Email</strong><span>${escapeHtml([vendorCard.phone, vendorCard.email].filter(Boolean).join(" / ") || "Phone and email are not saved yet")}</span></div><span class="badge ${vendorCard.phone || vendorCard.email ? "green" : "amber"}">${vendorCard.phone || vendorCard.email ? "Contactable" : "Needed"}</span></div>
                <div class="metric-row"><div><strong>Mailing address</strong><span>${escapeHtml(vendorCard.mailingAddress || "Vendor address not saved yet")}</span></div><span class="badge ${vendorCard.mailingAddress ? "green" : "amber"}">${vendorCard.mailingAddress ? "Saved" : "Needed"}</span></div>
                <div class="metric-row"><div><strong>Payment / Insurance</strong><span>${escapeHtml([vendorCard.paymentTerms ? `Terms: ${vendorCard.paymentTerms}` : "", vendorCard.insurance ? `Insurance: ${vendorCard.insurance}` : ""].filter(Boolean).join(" | ") || "Payment terms and insurance need review")}</span></div><span class="badge amber">Verify</span></div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                  <button class="btn primary" onclick="openVendor('${jsArg(vendorCard.name)}')">Open Vendor Profile</button>
                  <button class="btn" onclick="switchSection('vendors'); closeModal();">Vendor Master</button>
                </div>
              </div>
            </article>
            <article class="card">
              <div class="panel-head"><h3>Current / Renewal</h3><span class="badge ${currentStatus.className}">${escapeHtml(currentStatus.label)}</span></div>
              <div class="panel-body metric-list">
                <div class="metric-row"><div><strong>Status basis</strong><span>${escapeHtml(currentStatus.reason)}</span></div><span class="badge ${currentStatus.className}">${escapeHtml(currentStatus.label)}</span></div>
                <div class="metric-row"><div><strong>Auto-renewal</strong><span>${escapeHtml(autoRenewalActionForContract(c, renewalAlert))}</span></div><span class="badge ${isAutoRenewing(c.autoRenewal) ? "amber" : "gray"}">${escapeHtml(c.autoRenewal || "Unknown")}</span></div>
                <div class="metric-row"><div><strong>Renewal / notice date</strong><span>${escapeHtml(renewalAlert?.targetDate || c.renewal || c.end || "Needs date")}</span></div><span class="badge ${renewalAlert?.days !== null && renewalAlert?.days !== undefined ? "blue" : "amber"}">${renewalAlert?.days !== null && renewalAlert?.days !== undefined ? `${renewalAlert.days} days` : "Check"}</span></div>
                <div class="metric-row"><div><strong>Related history</strong><span>${escapeHtml(olderHistory.length ? `${olderHistory.length} older or related record${olderHistory.length === 1 ? "" : "s"} for this vendor/facility/service.` : "No older related records found.")}</span></div><span class="badge ${olderHistory.length ? "blue" : "green"}">${olderHistory.length}</span></div>
              </div>
            </article>
            <article class="card">
              <div class="panel-head"><h3>Same Vendor Contracts</h3><span class="badge ${vendorRelatedContracts.length ? "blue" : "gray"}">${vendorRelatedContracts.length} linked</span></div>
              <div class="panel-body table-wrap">
                <table>
                  <thead><tr><th>Contract ID</th><th>Contract</th><th>Facility</th><th>Service</th><th>Status</th><th></th></tr></thead>
                  <tbody>${vendorRelatedContracts.slice(0, 12).map(item => `
                    <tr>
                      <td><span style="color:var(--muted);font-size:12px">${escapeHtml(item.id || "")}</span></td>
                      <td><strong>${escapeHtml(item.name || "Untitled contract")}</strong></td>
                      <td>${escapeHtml(item.facility || "Needs facility")}</td>
                      <td>${escapeHtml(item.category || item.services || "Needs type")}</td>
                      <td><span class="badge ${badgeClass(item.status || item.reviewStatus)}">${escapeHtml(item.status || item.reviewStatus || "Needs Review")}</span></td>
                      <td><button class="btn ghost" onclick="openContractSafe('${jsArg(item.id)}', '${jsArg(item.name || item.vendor || "")}')">Open</button></td>
                    </tr>
                  `).join("") || `<tr><td colspan="6">No other contracts are linked to this vendor yet.</td></tr>`}</tbody>
                </table>
                ${vendorRelatedContracts.length > 12 ? `<p style="color:var(--muted);font-size:12px;margin-top:8px">Showing 12 of ${vendorRelatedContracts.length}. Open the vendor profile for the full history.</p>` : ""}
              </div>
            </article>
            <article class="card">
              <div class="panel-head"><h3>Required Fields for This Contract Type</h3><span class="badge ${requiredRows.every(row => row.ok) ? "green" : "amber"}">${requiredRows.filter(row => row.ok).length}/${requiredRows.length} filled</span></div>
              <div class="panel-body table-wrap">
                <table>
                  <thead><tr><th>Required Item</th><th>Current Value</th><th>Why</th><th>Status</th></tr></thead>
                  <tbody>${requiredRows.map(row => `<tr><td><strong>${escapeHtml(row.label)}</strong></td><td>${escapeHtml(row.value || "Needs Review")}</td><td>${escapeHtml(row.reason || (row.learned ? "Learned from contract history" : "Core contract field"))}</td><td><span class="badge ${row.ok ? "green" : "amber"}">${row.ok ? "Filled" : "Missing"}</span></td></tr>`).join("")}</tbody>
                </table>
              </div>
            </article>
            <article class="card">
              <div class="panel-head"><h3>Source Proof</h3><span class="badge ${sourceProofRows.every(row => row.proof.className === "green") ? "green" : "amber"}">Proof status</span></div>
              <div class="panel-body table-wrap">
                <table>
                  <thead><tr><th>Field</th><th>Value</th><th>Proof</th><th>Source</th></tr></thead>
                  <tbody>${sourceProofRows.map(row => `<tr><td><strong>${escapeHtml(row.label)}</strong></td><td>${escapeHtml(row.value || "Needs Review")}</td><td><span class="badge ${row.proof.className}">${escapeHtml(row.proof.text)}</span></td><td>${escapeHtml(shortSourceText(row.sourceText || row.source || row.proof.detail || ""))}</td></tr>`).join("")}</tbody>
                </table>
              </div>
            </article>
            <article class="card">
              <div class="panel-head"><h3>Vendor Rules</h3><span class="badge ${learnedRequiredRows.length ? "blue" : "gray"}">${learnedRequiredRows.length}</span></div>
              <div class="panel-body metric-list">
                ${learnedRequiredRows.map(row => `<div class="metric-row"><div><strong>${escapeHtml(row.label)}</strong><span>${escapeHtml(row.reason || "Recurring vendor field.")}</span></div><span class="badge ${row.ok ? "green" : "amber"}">${row.ok ? "Found" : "Check"}</span></div>`).join("") || `<div class="metric-row"><div><strong>No vendor rules yet</strong><span>None saved.</span></div><span class="badge gray">Empty</span></div>`}
              </div>
            </article>
            <article class="card">
              <div class="panel-head"><h3>Contract Confidence Score</h3><span class="badge ${confidence.score >= 85 ? "green" : confidence.score >= 65 ? "amber" : "red"}">${confidence.score} / 100</span></div>
              <div class="panel-body metric-list">
                <div class="metric-row"><div><strong>OCR confidence</strong><span>Average field confidence: ${confidence.average || "Needs review"}%. ${confidence.low} low-confidence field${confidence.low === 1 ? "" : "s"}.</span></div><span class="badge ${confidence.average >= 80 ? "green" : "amber"}">${confidence.fieldCount} fields</span></div>
                <div class="metric-row"><div><strong>Missing key fields</strong><span>${escapeHtml(confidence.missing.length ? confidence.missing.join(", ") : "No major key-field gaps.")}</span></div><span class="badge ${confidence.missing.length ? "amber" : "green"}">${confidence.missing.length ? "Fix" : "Ready"}</span></div>
                <div class="metric-row"><div><strong>Auto-renewal</strong><span>${c.autoRenewal === "Yes" ? "Review notice deadline before renewal." : "No auto-renewal detected."}</span></div><span class="badge ${c.autoRenewal === "Yes" ? "amber" : "green"}">${c.autoRenewal || "Unknown"}</span></div>
                <div class="metric-row"><div><strong>Termination language</strong><span>${(!c.terminationClause || c.terminationClause === "Missing") ? "No clear termination clause found. Legal review required." : c.terminationClause}</span></div><span class="badge ${terminationBadge(c.terminationClause)}">${c.terminationClause || "Unknown"}</span></div>
                <div class="metric-row"><div><strong>Source proof</strong><span>PDF/OCR source required.</span></div><span class="badge amber">Review</span></div>
              </div>
            </article>
            <article class="card">
              <div class="panel-head"><h3>Duplicate / Amendment Check</h3><span class="badge ${duplicates.length || amendmentCandidates.length ? "amber" : "green"}">${duplicates.length || amendmentCandidates.length ? "Review" : "Clear"}</span></div>
              <div class="panel-body metric-list">
                <div class="metric-row"><div><strong>Duplicates</strong><span>${duplicates.length ? duplicates.map(item => item.name).join(", ") : "None found."}</span></div><span class="badge ${duplicates.length ? "amber" : "green"}">${duplicates.length}</span></div>
                <div class="metric-row"><div><strong>Amendments</strong><span>${amendmentCandidates.length ? amendmentCandidates.map(item => item.name).join(", ") : "None found."}</span></div><span class="badge ${amendmentCandidates.length ? "amber" : "gray"}">${amendmentCandidates.length}</span></div>
                <div class="metric-row"><div><strong>Link check</strong><span>Amendments should attach to originals.</span></div><span class="badge blue">Check</span></div>
              </div>
            </article>
            <article class="card">
              <div class="panel-head"><h3>Before / After OCR Corrections</h3><span class="badge blue">Audit-ready</span></div>
              <div class="panel-body table-wrap">
                <table>
                  <thead><tr><th>Field</th><th>OCR Read</th><th>Saved Value</th><th>Confidence</th><th>Status</th></tr></thead>
                  <tbody>${correctionRows.map(row => `<tr><td><strong>${escapeHtml(row.label)}</strong></td><td>${escapeHtml(row.ocrValue || "Not found")}</td><td>${escapeHtml(row.savedValue || "Needs Review")}</td><td>${escapeHtml(row.confidence || "")}</td><td><span class="badge ${row.changed ? "amber" : contractHasUsableValue(row.savedValue) ? "green" : "red"}">${row.changed ? "Corrected" : contractHasUsableValue(row.savedValue) ? "Saved" : "Missing"}</span></td></tr>`).join("")}</tbody>
                </table>
              </div>
            </article>
            <article class="card">
              <div class="panel-head"><h3>Structured Contract Record</h3><span class="badge ${badgeClass(c.status)}">${c.status}</span></div>
              <div class="panel-body field-grid">
                ${[
                  ["name", "Contract"],
                  ["facility", "Facility"],
                  ["vendor", "Vendor"],
                  ["category", "Category"],
                  ["services", "Services"],
                  ["contractStatus", "Contract Status"],
                  ["startOfServices", "Start of Services"],
                  ["initialContractLength", "Initial Contract Length"],
                  ["end", "End Date"],
                  ["renewal", "Renewal"],
                  ["paymentTerms", "Payment Terms"],
                  ["fee", "Fee"],
                  ["monthlyCost", "Monthly Cost"],
                  ["costBedMonth", "Cost Bed/Month"],
                  ["quantityOfServices", "Quantity of Services"],
                  ["owner", "Owner"]
                ].map(([key, label]) => `
                  <div class="field"><label>${label}</label><input value="${escapeHtml(c[key] || "Needs Review")}" /></div>
                `).join("")}
                <div class="field"><label>Risk</label><input value="${c.risk}" /></div>
                <div class="field"><label>Contract Name</label><input value="${c.documentTitle || c.name || "Needs Review"}" /></div>
                <div class="field"><label>Contract Type</label><input value="${c.agreementType || c.contractType || c.category || "Needs Review"}" /></div>
                <div class="field"><label>Why Category Was Picked</label><input value="${c.categoryReason || "Review source proof"}" /></div>
                <div class="field"><label>ShareSync Folder Path</label><input value="/Contracts/${c.facility}/${c.category}/${c.vendor}/" /></div>
                <div class="field"><label>Auto-Renewal</label><input value="${c.autoRenewal || "Unknown"}" /></div>
                <div class="field"><label>Termination Clause</label><input value="${c.terminationClause || "Unknown"}" /></div>
                <div class="field"><label>Exit Risk</label><input value="${(!c.terminationClause || c.terminationClause === "Missing") ? "High - no termination clause detected" : "Review notice deadline"}" /></div>
                <div class="field"><label>Signature Date</label><input value="${c.signatureDate || c.signedDate || "Needs Review"}" /></div>
                <div class="field"><label>Payment Terms</label><input value="${c.paymentTerms || "Needs Review"}" /></div>
                <div class="field"><label>Days Payable</label><input value="${c.daysPayable || "Needs Review"}" /></div>
                <div class="field"><label>Per-Day / Unit Rate</label><input value="${c.ppdRate || "Not found"}" /></div>
                <div class="field"><label>Service Pricing Detail</label><input value="${c.labTestPricing || "Not found"}" /></div>
                <div class="field"><label>Pickup / Service Details</label><input value="${c.specimenPickup || "Not found"}" /></div>
                <div class="field"><label>Signer</label><input value="${c.signer || "Needs Review"}" /></div>
                <div class="field"><label>Signer Title</label><input value="${c.signerTitle || "Needs Review"}" /></div>
                <div class="field"><label>Signed Date</label><input value="${c.signedDate || "Needs Review"}" /></div>
                <div class="field"><label>Account Number</label><input value="${c.utilityAccountNumber || "Not found yet"}" /></div>
                <div class="field"><label>Meter Number</label><input value="${c.meterNumber || "Not matched yet"}" /></div>
                <div class="field"><label>Service Address</label><input value="${c.serviceAddress || "Not matched yet"}" /></div>
                <div class="field"><label>Vendor Mailing Address</label><input value="${c.vendorMailingAddress || "Needs Vendor Address"}" /></div>
                <div class="field"><label>Vendor Phone</label><input value="${c.vendorPhone || "Needs Vendor Phone"}" /></div>
                <div class="field"><label>Vendor Email</label><input value="${c.vendorEmail || "Needs Vendor Email"}" /></div>
                <div class="field"><label>Insurance Required</label><input value="${c.insuranceRequirement || "Needs Review"}" /></div>
                <div class="field"><label>Termination Notice</label><input value="${c.terminationClause || "Unknown"}" /></div>
                <div class="field"><label>Indemnification</label><input value="${c.indemnification || "Needs Review"}" /></div>
                <div class="field"><label>Limitation of Liability</label><input value="${c.limitationOfLiability || "Needs Review"}" /></div>
                <div class="field"><label>Compliance Language</label><input value="${c.complianceLanguage || "Needs Review"}" /></div>
                <div class="field"><label>Governing Law</label><input value="${c.governingLaw || "Needs Review"}" /></div>
              </div>
            </article>
            <article class="card">
              <div class="panel-head"><h3>Final Approved Contract Summary</h3><span class="badge ${c.status === "Approved" ? "green" : "amber"}">${c.status === "Approved" ? "Approved" : "Draft / Needs Review"}</span></div>
              <div class="panel-body">
                <p><strong>Parties:</strong> ${c.facility} and ${c.vendor}.</p>
                <p><strong>Service:</strong> ${c.category}. <strong>Term:</strong> ${c.startOfServices || c.start || "Needs Review"} to ${endDateDisplay(c.end, c.autoRenewal)}. <strong>Length:</strong> ${c.initialContractLength || "Needs Review"}.</p>
                <p><strong>Money:</strong> ${c.fee || c.rate || c.spend || "TBD"}. <strong>Payment:</strong> ${c.paymentTerms || "Needs Review"} ${c.daysPayable ? `(${c.daysPayable})` : ""}.</p>
                <p><strong>Renewal / exit:</strong> Auto-renewal ${c.autoRenewal || "Unknown"}. Notice: ${c.terminationClause || c.noticePeriod || "Unknown"}.</p>
                <p><strong>Required action:</strong> ${confidence.missing.length ? `Fix ${confidence.missing.join(", ")} before treating this as final.` : c.risk === "Critical" || c.risk === "High" ? "Review risk and renewal options." : "Ready for reporting once approved."}</p>
                ${sourceFileUrl ? `<a class="btn primary" href="${sourceFileUrl}" download>Download Original ${escapeHtml(sourceLabel)}</a>` : `<button class="btn primary" onclick="showToast('No uploaded source file is saved for this contract yet.')">Download Original File</button>`}
                <button class="btn" onclick="openContractEmail('${jsArg(c.id)}', 'internal')">Email Internal Review</button>
                <button class="btn" onclick="openContractEmail('${jsArg(c.id)}', 'vendor')">Email Vendor</button>
                <button class="btn" onclick="closeModal(); switchSection('review'); showToast('Use Review Queue to edit and save extracted fields.')">Review / Save Fields</button>
                <button class="btn ghost" onclick="setContractHistoryStatus('${c.id}', ${c.status === "Archived" ? "false" : "true"})">${c.status === "Archived" ? "Restore to Current" : "Move to History"}</button>
                <button class="btn ghost" onclick="deleteContractRecord('${c.id}')">Delete Contract</button>
              </div>
            </article>
            <article class="card">
              <div class="panel-head"><h3>Detected Fees and Service Lines</h3><span class="badge amber">Extracted only</span></div>
              <div class="panel-body">
                <p style="margin-top:0;color:var(--muted)">Fee rows appear only when the uploaded contract text contains pricing, rate tables, exhibits, add-ons, formulas, or surcharges.</p>
                <div class="table-wrap">
                  <table>
                    <thead><tr><th>Service / Fee</th><th>Unit</th><th>Rate</th><th>Frequency</th><th>Escalation</th><th>Source</th></tr></thead>
                    <tbody>${activeFeeSchedule.map((f, index) => `<tr><td><strong>${escapeHtml(f.service || "Fee")}</strong></td><td>${escapeHtml(f.unit || "")}</td><td>${escapeHtml(f.rate || "")}</td><td>${escapeHtml(f.frequency || "")}</td><td>${escapeHtml(f.escalation || "")}</td><td><span style="display:block;color:var(--muted);font-size:12px;max-width:280px">${escapeHtml(shortSourceText(feeSourceSnippet(f)))}</span><button class="btn ghost" type="button" onclick="showContractFeeSource('${jsArg(c.id)}', ${index})">View Source</button></td></tr>`).join("") || `<tr><td colspan="6">No fee lines were extracted from this contract yet.</td></tr>`}</tbody>
                  </table>
                </div>
              </div>
            </article>
            <article class="card">
              <div class="panel-head"><h3>Important Terms</h3><span class="badge blue">Clause-level extraction</span></div>
              <div class="panel-body table-wrap">
                <table>
                  <thead><tr><th>Term</th><th>Value</th><th>Detail</th><th>Source</th></tr></thead>
                  <tbody>${(c.extractedClauses || []).map(t => `<tr><td><strong>${escapeHtml(t.type || "Clause")}</strong></td><td>${escapeHtml(t.risk || "Review")}</td><td>${escapeHtml(t.snippet || "")}</td><td>${escapeHtml(t.source || "Contract OCR")}</td></tr>`).join("") || `<tr><td colspan="4">No important clauses were extracted from this contract yet.</td></tr>`}</tbody>
                </table>
              </div>
            </article>
            <article class="card">
              <div class="panel-head"><h3>Related Documents</h3><span class="badge blue">Amendments / invoices / insurance</span></div>
              <div class="panel-body table-wrap">
                <table>
                  <thead><tr><th>Type</th><th>Name</th><th>Date</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>${relatedDocuments.map(d => `<tr><td>${escapeHtml(d.type || "Related Document")}</td><td><strong>${escapeHtml(d.name || "Uploaded document")}</strong>${d.matchConfidence ? `<br><span style="color:var(--muted);font-size:12px">Match score: ${escapeHtml(d.matchConfidence)}</span>` : ""}</td><td>${escapeHtml(d.date || "")}</td><td><span class="badge gray">${escapeHtml(d.status || "Needs Review")}</span></td><td>${d.id ? `<button class="btn ghost" onclick="openContractSafe('${jsArg(d.id)}', '${jsArg(d.name || "")}')">Open</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="5">No addendums, amendments, invoices, or insurance documents are linked to this contract yet.</td></tr>`}</tbody>
                </table>
              </div>
            </article>
            <article class="card">
              <div class="panel-head"><h3>Alerts and Tasks</h3><span class="badge amber">Action required</span></div>
              <div class="panel-body metric-list">
                <div class="metric-row"><div><strong>Renewal reminder</strong><span>Email at 90/60/30 days before ${c.renewal}.</span></div><span class="badge blue">Scheduled</span></div>
                <div class="metric-row"><div><strong>Termination notice</strong><span>Confirm whether notice must be sent before renewal.</span></div><span class="badge amber">Review</span></div>
                <div class="metric-row"><div><strong>Insurance check</strong><span>Certificate must match extracted coverage requirement.</span></div><span class="badge ${c.risk === "High" ? "red" : "green"}">${c.risk === "High" ? "Gap" : "OK"}</span></div>
              </div>
            </article>
            <article class="card">
              <div class="panel-head"><h3>Audit Trail</h3></div>
              <div class="panel-body table-wrap">
                <table>
                  <thead><tr><th>When</th><th>User</th><th>Action</th><th>Field</th></tr></thead>
                  <tbody>${contractAudit.map(a => `<tr><td>${escapeHtml(a.createdAt || "")}</td><td>${escapeHtml(a.actor || "local-user")}</td><td>${escapeHtml(a.action || "")}</td><td>${escapeHtml(a.details?.name || a.entityId || "")}</td></tr>`).join("") || `<tr><td colspan="4">No audit events for this contract yet.</td></tr>`}</tbody>
                </table>
              </div>
            </article>
          </div>
        </div>
      `;
      document.getElementById("contractModal").classList.add("open");
      requestAnimationFrame(() => {
        if (scroller) scroller.scrollTop = keepY;
        else window.scrollTo(0, keepY);
      });
    }

    async function openContractSafe(id = "", name = "") {
      const wantedId = String(id || "").trim();
      const wantedName = String(name || "").trim();
      let contract = (wantedId && (contractData.find(item => item.id === wantedId) || contracts.find(item => item.id === wantedId))) || null;
      if (wantedId && backendOnline) {
        try {
          contract = normalizeContract(await apiJson(`/api/contracts/${encodeURIComponent(wantedId)}`));
          upsertLiveContract(contract, { markDirty: false });
        } catch (error) {
          console.warn("Direct contract open failed:", error);
        }
      }
      if (!contract?.id && backendOnline) {
        contract = await dashboardFindContractFromBackend({ contractId: wantedId, contract: wantedName });
      }
      if (contract?.id) {
        await openContract(contract.id);
        return;
      }
      if (wantedName) {
        const search = document.getElementById("contractSearch");
        if (search) search.value = wantedName;
      }
      showToast("Opening Contract Finder. Search is ready if this record is still loading.");
      switchSection("contracts");
    }

    async function showContractVersions(id) {
      try {
        const versions = await apiJson(`/api/contracts/${encodeURIComponent(id)}/versions`);
        document.getElementById("modalTitle").textContent = "Contract Version History";
        document.getElementById("modalBody").innerHTML = `
          <article class="card">
            <div class="panel-head"><h3>Revisions and File History</h3><span class="badge blue">${versions.length} version${versions.length === 1 ? "" : "s"}</span></div>
            <div class="panel-body table-wrap">
              <table>
                <thead><tr><th>Version</th><th>When</th><th>User</th><th>Action</th><th>File / ShareSync</th></tr></thead>
                <tbody>${versions.map(v => `
                  <tr>
                    <td><strong>v${escapeHtml(v.versionNumber || "")}</strong></td>
                    <td>${escapeHtml(v.createdAt || "")}</td>
                    <td>${escapeHtml(v.actor || "local-user")}</td>
                    <td>${escapeHtml(v.action || "Saved")}</td>
                    <td>${escapeHtml(v.shareSyncPath || v.filePath || "No file path saved")}</td>
                  </tr>
                `).join("") || `<tr><td colspan="5">No version records yet. Versions are created when fields are saved, approved, archived, or updated.</td></tr>`}</tbody>
              </table>
            </div>
          </article>
        `;
        document.getElementById("contractModal").classList.add("open");
      } catch (error) {
        showToast(error.message || "Could not load version history.");
      }
    }

    function renderTasks() {
      const openTasks = tasks.filter(task => !/done|closed|complete/i.test(task.status || ""));
      const badge = document.getElementById("taskOpenBadge");
      if (badge) badge.textContent = `${openTasks.length} open`;
      document.getElementById("taskRows").innerHTML = tasks.map(task => `
        <tr>
          <td>${escapeHtml(task.owner || "")}</td>
          <td>${escapeHtml(task.due || "")}</td>
          <td><span class="badge ${/urgent|high/i.test(task.priority || "") ? "red" : "gray"}">${escapeHtml(task.priority || "Normal")}</span></td>
          <td><span class="badge ${/done|complete/i.test(task.status || "") ? "green" : /waiting|progress|review/i.test(task.status || "") ? "amber" : "blue"}">${escapeHtml(task.status || "Open")}</span></td>
          <td><strong>${escapeHtml(task.task)}</strong>${task.contract || task.facility ? `<br><span style="color:var(--muted);font-size:12px">${escapeHtml([task.contract, task.facility].filter(Boolean).join(" | "))}</span>` : ""}</td>
          <td><div class="table-actions"><button class="btn ghost" onclick="editTask('${jsArg(task.id)}')">Edit</button><button class="btn primary" onclick="markTaskDone('${jsArg(task.id)}')">Done</button><button class="btn danger" onclick="deleteTaskRecord('${jsArg(task.id)}')">Delete</button></div></td>
        </tr>
      `).join("") || `<tr><td colspan="7">No worklist tasks yet.</td></tr>`;
    }

    function clearTaskForm() {
      ["taskId", "taskName", "taskOwner", "taskDue", "taskContract", "taskFacility"].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.value = "";
      });
      const priority = document.getElementById("taskPriority");
      if (priority) priority.value = "Normal";
      const status = document.getElementById("taskStatus");
      if (status) status.value = "Open";
      const mode = document.getElementById("taskFormMode");
      if (mode) mode.textContent = "New";
    }

    function editTask(id) {
      const task = tasks.find(item => item.id === id);
      if (!task) return;
      const values = {
        taskId: task.id || "",
        taskName: task.task || "",
        taskOwner: task.owner || "",
        taskDue: task.due || "",
        taskContract: task.contract || "",
        taskFacility: task.facility || ""
      };
      Object.entries(values).forEach(([fieldId, value]) => {
        const element = document.getElementById(fieldId);
        if (element) element.value = value;
      });
      const priority = document.getElementById("taskPriority");
      if (priority) priority.value = task.priority || "Normal";
      const status = document.getElementById("taskStatus");
      if (status) status.value = task.status || "Open";
      const mode = document.getElementById("taskFormMode");
      if (mode) mode.textContent = "Edit";
      document.getElementById("taskName")?.focus();
    }

    async function saveTaskFromForm() {
      if (!requireBackend("Creating a task")) return;
      const id = String(document.getElementById("taskId")?.value || "").trim();
      const task = String(document.getElementById("taskName")?.value || "").trim();
      if (!task) return showToast("Type the task first.");
      const payload = {
        id,
        task,
        owner: String(document.getElementById("taskOwner")?.value || currentUser?.fullName || currentUser?.user || "Contract team").trim(),
        due: String(document.getElementById("taskDue")?.value || "").trim(),
        priority: String(document.getElementById("taskPriority")?.value || "Normal").trim(),
        status: String(document.getElementById("taskStatus")?.value || "Open").trim(),
        contract: String(document.getElementById("taskContract")?.value || "").trim(),
        facility: String(document.getElementById("taskFacility")?.value || "").trim()
      };
      try {
        await apiJson("/api/tasks", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        clearTaskForm();
        await loadBackendData();
        showToast(id ? "Task updated." : "Task created.");
      } catch (error) {
        showToast(error.message || "Could not create task.");
      }
    }

    async function markTaskDone(id) {
      const task = tasks.find(item => item.id === id);
      if (!task) return;
      try {
        await apiJson(`/api/tasks/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "Done" })
        });
        await loadBackendData();
        showToast("Task marked done.");
      } catch (error) {
        showToast(error.message || "Could not update task.");
      }
    }

    async function deleteTaskRecord(id) {
      const task = tasks.find(item => item.id === id);
      if (!task || !confirm(`Delete task: ${task.task}?`)) return;
      try {
        await apiJson(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
        await loadBackendData();
        showToast("Task deleted.");
      } catch (error) {
        showToast(error.message || "Could not delete task.");
      }
    }

    function reportDateDays(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      return Math.ceil((date - new Date()) / 86400000);
    }

    function reportMoney(value) {
      return formatCurrencyNumber(value || 0);
    }

    function reportValue(contract, key, fallback = "") {
      const field = (contract.extractedFields || []).find(item => {
        const label = String(item.label || item.key || "").toLowerCase();
        return label === key.toLowerCase() || label.includes(key.toLowerCase());
      });
      return contract[key] || field?.value || fallback;
    }

    function reportDateValue(row, key) {
      const value = row[key] || "";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    function customReportRecords(sourceOverride = "") {
      const source = sourceOverride || document.getElementById("customReportSource")?.value || "contracts";
      const contractRows = contracts.map(c => ({
        sourceType: "Contract",
        facility: c.facility,
        vendor: c.vendor,
        category: c.services || c.category,
        name: c.name,
        status: c.status || c.reviewStatus,
        signatureDate: c.signatureDate || c.signedDate || "",
        start: c.startOfServices || c.start || "",
        end: c.end || "",
        renewal: c.renewal || "",
        invoiceDate: "",
        initialContractLength: c.initialContractLength || "",
        autoRenewal: c.autoRenewal || "",
        termination: c.termination || c.terminationClause || "",
        paymentTerms: c.paymentTerms || "",
        daysPayable: c.daysPayable || "",
        fee: formatMoneyText(c.fee || c.rate || c.spend || ""),
        annualizedSpend: annualizedContractSpend(c) ? reportMoney(annualizedContractSpend(c)) : "",
        monthlyCost: monthlyContractSpend(c) ? reportMoney(monthlyContractSpend(c)) : formatMoneyText(c.monthlyCost || ""),
        costBedMonth: moneyToNumber(c.costBedMonth) ? formatMoneyText(c.costBedMonth) : (facilityBedsForContract(c) && monthlyContractSpend(c) ? reportMoney(monthlyContractSpend(c) / facilityBedsForContract(c)) : ""),
        estimatedPpd: estimatedPpdForContract(c) ? `$${estimatedPpdForContract(c).toFixed(2)}` : "",
        invoiceTotal: "",
        invoiceCostPerBed: "",
        beds: facilityBedsForContract(c) || "",
        risk: c.risk || "",
        owner: c.owner || "",
        matchedContractName: "",
        searchText: JSON.stringify(c)
      }));
      const invoiceRows = invoiceUploads.map(i => ({
        sourceType: "Invoice",
        facility: i.facility || i.costPerBed?.facility || "",
        vendor: i.vendor || "",
        category: i.matchedCategory || "",
        name: i.name || i.uploadedFileName || "Uploaded invoice",
        status: i.status || "Checked",
        signatureDate: "",
        start: "",
        end: "",
        renewal: "",
        invoiceDate: i.invoiceDate || "",
        initialContractLength: "",
        autoRenewal: "",
        termination: "",
        paymentTerms: i.paymentTerms || "",
        daysPayable: "",
        fee: formatMoneyText(i.contractRate || ""),
        annualizedSpend: "",
        monthlyCost: "",
        costBedMonth: "",
        estimatedPpd: "",
        invoiceTotal: formatMoneyText(i.total || ""),
        invoiceCostPerBed: formatMoneyText(i.costPerBed?.costPerBedLabel || i.costPerBed?.source || ""),
        beds: i.costPerBed?.beds || "",
        risk: i.status === "Matched" ? "Review" : "Needs Match",
        owner: "AP / Contract Dept",
        matchedContractName: i.matchedContractName || "",
        searchText: JSON.stringify(i)
      }));
      if (source === "invoices") return invoiceRows;
      if (source === "combined") return [...contractRows, ...invoiceRows];
      return contractRows;
    }

    function selectedCustomReportColumns() {
      const checked = [...document.querySelectorAll("[data-custom-report-column]:checked")].map(input => input.value);
      const picker = document.getElementById("customReportColumns");
      if (checked.length) return checked;
      return picker?.dataset.ready ? [] : defaultCustomColumns;
    }

    function updateCustomReportColumnCount() {
      const count = document.getElementById("customReportColumnCount");
      if (!count) return;
      const selected = selectedCustomReportColumns();
      count.textContent = selected.length ? `${selected.length} selected` : "No columns selected";
    }

    function setCustomReportColumns(mode) {
      const columnKeys = customReportColumns.map(([key]) => key);
      const presets = {
        core: ["sourceType", "facility", "vendor", "category", "name", "status", "start", "end", "autoRenewal", "termination"],
        finance: ["facility", "vendor", "category", "name", "fee", "annualizedSpend", "monthlyCost", "costBedMonth", "estimatedPpd", "beds", "paymentTerms", "daysPayable"],
        all: columnKeys,
        clear: []
      };
      const selected = new Set((presets[mode] || defaultCustomColumns).filter(key => columnKeys.includes(key)));
      document.querySelectorAll("[data-custom-report-column]").forEach(input => {
        input.checked = selected.has(input.value);
      });
      updateCustomReportColumnCount();
      renderReports();
    }

    function customReportConfigFromControls() {
      return {
        facility: document.getElementById("reportFacilityFilter")?.value || "",
        category: document.getElementById("reportCategoryFilter")?.value || "",
        vendor: document.getElementById("reportVendorFilter")?.value || "",
        status: document.getElementById("reportStatusFilter")?.value || "",
        search: document.getElementById("reportSearchInput")?.value || "",
        dateField: document.getElementById("reportDateField")?.value || "",
        from: document.getElementById("reportDateFrom")?.value || "",
        to: document.getElementById("reportDateTo")?.value || "",
        source: document.getElementById("customReportSource")?.value || "contracts",
        columns: selectedCustomReportColumns()
      };
    }

    function buildCustomReport(config = null, definition = null) {
      const reportConfig = config || customReportConfigFromControls();
      const facility = reportConfig.facility || "";
      const category = reportConfig.category || "";
      const vendor = reportConfig.vendor || "";
      const status = reportConfig.status || "";
      const search = String(reportConfig.search || "").toLowerCase();
      const dateField = reportConfig.dateField || "";
      const from = reportConfig.from ? new Date(reportConfig.from) : null;
      const to = reportConfig.to ? new Date(reportConfig.to) : null;
      const selected = Array.isArray(reportConfig.columns) ? reportConfig.columns : selectedCustomReportColumns();
      const columnMap = new Map(customReportColumns);
      const filtered = customReportRecords(reportConfig.source).filter(row => {
        const joined = `${row.searchText || ""} ${Object.values(row).join(" ")}`.toLowerCase();
        if (facility && !sameMasterName(row.facility, facility)) return false;
        if (category && !sameMasterName(row.category, category)) return false;
        if (vendor && !sameMasterName(row.vendor, vendor)) return false;
        if (status && !String(row.status || "").toLowerCase().includes(status.toLowerCase())) return false;
        if (search && !joined.includes(search)) return false;
        if (dateField && (from || to)) {
          const date = reportDateValue(row, dateField);
          if (!date) return false;
          if (from && date < from) return false;
          if (to) {
            const endOfDay = new Date(to);
            endOfDay.setHours(23, 59, 59, 999);
            if (date > endOfDay) return false;
          }
        }
        return true;
      });
      const headers = selected.map(key => columnMap.get(key) || key);
      const rows = filtered.map(row => selected.map(key => row[key] || ""));
      return {
        name: definition?.name || reportConfig.name || "Custom Report",
        description: definition?.description || "Search-built report from selected filters and columns.",
        id: definition?.id || "custom-builder",
        group: definition?.group || "Builder",
        headers,
        rows,
        summary: [
          ["Rows", rows.length.toLocaleString(), "Filtered records"],
          ["Facilities", new Set(filtered.map(row => row.facility).filter(Boolean)).size.toLocaleString(), "Facilities in report"],
          ["Vendors", new Set(filtered.map(row => row.vendor).filter(Boolean)).size.toLocaleString(), "Vendors in report"]
        ]
      };
    }

    function customReportFilterLabel(config = null) {
      const reportConfig = config || customReportConfigFromControls();
      const labels = [];
      [
        ["facility", "Facility"],
        ["category", "Service"],
        ["vendor", "Vendor"],
        ["status", "Status"],
        ["source", "Source"]
      ].forEach(([key, label]) => {
        const value = reportConfig[key] || "";
        if (value && !(key === "source" && value === "contracts")) labels.push(`${label}: ${value}`);
      });
      const search = String(reportConfig.search || "").trim();
      if (search) labels.push(`Search: ${search}`);
      const dateField = reportConfig.dateField || "";
      const from = reportConfig.from || "";
      const to = reportConfig.to || "";
      if (dateField || from || to) labels.push(`Date: ${dateField || "any"} ${from || ""}${to ? ` to ${to}` : ""}`.trim());
      return labels.length ? labels.join(" | ") : "All searchable contract records";
    }

    function refreshCustomReportPreview() {
      const report = buildCustomReport();
      const count = document.getElementById("customReportCount");
      const preview = document.getElementById("customReportPreviewText");
      if (count) count.textContent = `${report.rows.length.toLocaleString()} row${report.rows.length === 1 ? "" : "s"}`;
      if (preview) preview.textContent = `${customReportFilterLabel()} | ${report.headers.length} columns`;
      updateCustomReportColumnCount();
      return report;
    }

    function reportMissing(contract) {
      return missingRequiredFieldLabels(contract);
    }

    function applyReportFilters(rows) {
      const facility = document.getElementById("reportFacilityFilter")?.value || "";
      const category = document.getElementById("reportCategoryFilter")?.value || "";
      const status = document.getElementById("reportStatusFilter")?.value || "";
      const search = (document.getElementById("reportSearchInput")?.value || "").toLowerCase();
      return rows.filter(row => {
        const joined = row.map(cell => String(cell ?? "")).join(" ").toLowerCase();
        if (facility && !joined.includes(facility.toLowerCase())) return false;
        if (category && !joined.includes(category.toLowerCase())) return false;
        if (status && !joined.includes(status.toLowerCase())) return false;
        if (search && !joined.includes(search)) return false;
        return true;
      });
    }

    function contractReportRows(source = contracts) {
      return source.map(c => [
        c.facility, c.services || c.category, c.vendor, c.contractStatus || c.status,
        c.signatureDate || c.signedDate || "", c.startOfServices || c.start || "",
        c.initialContractLength || "", c.termination || c.terminationClause || "Unknown",
        c.autoRenewal || "Unknown", c.paymentTerms || "", c.daysPayable || "", c.fee || c.rate || c.spend || "",
        c.monthlyCost || "", c.costBedMonth || "", c.quantityOfServices || "",
        c.name, c.risk, c.localFilePath ? "PDF saved" : "No PDF"
      ]);
    }

    function contractCurrentStatus(contract = {}) {
      const statusText = String(contract.contractStatus || contract.status || contract.reviewStatus || "").toLowerCase();
      if (contract.archived || /archived|history|replaced|terminated|do not use/.test(statusText)) {
        return { label: "Historical", className: "gray", reason: "Record is archived, replaced, terminated, or marked do not use." };
      }
      const endValue = contract.end || contract.expirationDate || contract.endDate || "";
      const days = reportDateDays(endValue);
      if (days !== null && days < 0 && !isAutoRenewing(contract.autoRenewal)) {
        return { label: "Expired", className: "red", reason: `End date passed: ${endValue}.` };
      }
      if (isAutoRenewing(contract.autoRenewal)) {
        return { label: "Current", className: "green", reason: "Auto-renewal is saved; review notice/termination before the renewal window." };
      }
      if (days !== null && days >= 0) {
        return { label: "Current", className: days <= 90 ? "amber" : "green", reason: `End date is ${endValue}.` };
      }
      if (/approved|active/.test(statusText)) {
        return { label: "Current", className: "green", reason: "Record is marked active/approved, but renewal/end date should still be verified." };
      }
      return { label: "Needs Review", className: "amber", reason: "Current status cannot be proven from saved dates/status yet." };
    }

    function contractHistoryKey(contract = {}) {
      return [
        masterKey(contract.vendor || "needs vendor"),
        masterKey(contract.facility || "needs facility"),
        masterKey(contractFinancialCategory(contract) || contract.category || contract.services || "needs service")
      ].join("||");
    }

    function contractSortTime(contract = {}) {
      return reportContractDate(contract)?.getTime()
        || dashboardDateObject(contract.updatedAt || contract.createdAt || contract.uploadDate)?.getTime()
        || 0;
    }

    function relatedContractHistory(contract = {}) {
      const key = contractHistoryKey(contract);
      return contracts
        .filter(item => contractHistoryKey(item) === key)
        .sort((a, b) => contractSortTime(b) - contractSortTime(a));
    }

    function currentContractRecords(source = contracts) {
      const groups = new Map();
      source.forEach(contract => {
        const key = contractHistoryKey(contract);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(contract);
      });
      return [...groups.values()].map(group => {
        const sorted = group
          .filter(item => !item.archived)
          .sort((a, b) => {
            const aStatus = contractCurrentStatus(a);
            const bStatus = contractCurrentStatus(b);
            const aScore = aStatus.label === "Current" ? 2 : aStatus.label === "Needs Review" ? 1 : 0;
            const bScore = bStatus.label === "Current" ? 2 : bStatus.label === "Needs Review" ? 1 : 0;
            return bScore - aScore || contractSortTime(b) - contractSortTime(a);
          });
        return sorted[0] || group.sort((a, b) => contractSortTime(b) - contractSortTime(a))[0];
      }).filter(Boolean);
    }

    function currentContractReportRows(source = contracts) {
      return currentContractRecords(source).map(contract => {
        const historyCount = relatedContractHistory(contract).filter(item => item.id !== contract.id).length;
        const currentStatus = contractCurrentStatus(contract);
        return [
          contract.name || "Untitled Contract",
          contract.facility || "Needs Facility",
          contract.vendor || "Needs Vendor",
          contractFinancialCategory(contract),
          currentStatus.label,
          currentStatus.reason,
          contract.autoRenewal || "Unknown",
          contract.end || contract.renewal || "Needs date",
          contract.fee || contract.rate || contract.spend || contract.monthlyCost || "Needs cost",
          historyCount,
          contract.localFilePath || contract.shareSyncLocalPath ? "Linked" : "Needs source"
        ];
      });
    }

    function autoRenewalActionForContract(contract = {}, alert = contractRenewalAlert(contract)) {
      const notice = noticeDaysFromContract(contract);
      if (!isAutoRenewing(contract.autoRenewal)) return "Not an auto-renewal record";
      if (!notice && !contractHasUsableValue(contract.terminationClause || contract.termination || contract.noticePeriod)) return "Find notice / termination proof";
      if (!alert) return "Add renewal/end date or mark no fixed end date";
      if (alert.days !== null && alert.days <= 90 && alert.days >= 0) return "Decision needed";
      if (alert.days !== null && alert.days < 0) return "Review current status";
      return "Monitor";
    }

    function autoRenewalActionRows(source = contracts) {
      return source.filter(c => isAutoRenewing(c.autoRenewal)).map(c => {
        const alert = contractRenewalAlert(c);
        const status = contractCurrentStatus(c);
        return [
          c.name || "Untitled Contract",
          c.facility || "Needs Facility",
          c.vendor || "Needs Vendor",
          contractFinancialCategory(c),
          status.label,
          c.autoRenewal || "Yes",
          c.terminationClause || c.termination || c.noticePeriod || "Needs notice proof",
          alert?.baseDate || c.renewal || c.end || "Needs date",
          alert?.targetDate || "Needs date",
          alert?.days ?? "",
          autoRenewalActionForContract(c, alert),
          c.localFilePath || c.shareSyncLocalPath ? "Linked" : "Needs source"
        ];
      }).sort((a, b) => {
        const aDays = Number(a[9]);
        const bDays = Number(b[9]);
        if (Number.isFinite(aDays) && Number.isFinite(bDays)) return aDays - bDays;
        if (Number.isFinite(aDays)) return -1;
        if (Number.isFinite(bDays)) return 1;
        return String(a[1]).localeCompare(String(b[1]));
      });
    }

    function aggregateReportRows(key, label) {
      const totals = new Map();
      contracts.forEach(c => {
        const name = c[key] || `Missing ${label}`;
        const current = totals.get(name) || { count: 0, spend: 0, needsReview: 0, risk: 0 };
        current.count += 1;
        current.spend += annualizedContractSpend(c);
        if (c.status === "Needs Review") current.needsReview += 1;
        if (["High", "High Risk", "Critical"].includes(c.risk)) current.risk += 1;
        totals.set(name, current);
      });
      return [...totals.entries()].map(([name, item]) => [name, item.count, reportMoney(item.spend), item.needsReview, item.risk]);
    }

    function reportContractDate(c = {}) {
      const value = c.startOfServices || c.start || c.startDate || c.signatureDate || c.signedDate || c.uploadDate || c.createdAt || "";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    function reportContractYear(c = {}) {
      return reportContractDate(c)?.getFullYear() || "";
    }

    function serviceSpendRows(source = contracts) {
      const totals = new Map();
      source.forEach(c => {
        const service = contractFinancialCategory(c);
        const vendor = c.vendor || "Needs Vendor";
        const key = `${masterKey(service)}||${masterKey(vendor)}`;
        const current = totals.get(key) || { service, vendor, contracts: 0, facilities: new Set(), annual: 0, missing: 0 };
        current.contracts += 1;
        current.facilities.add(c.facility || "Needs Facility");
        const annual = annualizedContractSpend(c);
        if (annual) current.annual += annual;
        else current.missing += 1;
        totals.set(key, current);
      });
      return [...totals.values()]
        .sort((a, b) => b.annual - a.annual)
        .map(item => [item.service, item.vendor, item.facilities.size, item.contracts, reportMoney(item.annual), item.missing, item.missing ? "Add fee/rate for full tracking" : "Tracked"]);
    }

    function priceChangeRows(source = contracts) {
      const groups = new Map();
      source.forEach(c => {
        const annual = annualizedContractSpend(c);
        if (!annual) return;
        const key = `${masterKey(c.vendor)}||${masterKey(contractFinancialCategory(c))}||${masterKey(c.facility)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
      });
      const rows = [];
      groups.forEach(group => {
        if (group.length < 2) return;
        const sorted = group.sort((a, b) => (reportContractDate(a)?.getTime() || 0) - (reportContractDate(b)?.getTime() || 0));
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const oldSpend = annualizedContractSpend(first);
        const newSpend = annualizedContractSpend(last);
        if (!oldSpend || !newSpend || first.id === last.id) return;
        const change = newSpend - oldSpend;
        const percent = oldSpend ? (change / oldSpend) * 100 : 0;
        rows.push([
          last.vendor || "Needs Vendor",
          contractFinancialCategory(last),
          last.facility || "Needs Facility",
          reportContractYear(first) || "Older",
          reportMoney(oldSpend),
          reportContractYear(last) || "Newer",
          reportMoney(newSpend),
          `${change >= 0 ? "+" : ""}${reportMoney(change)}`,
          `${percent >= 0 ? "+" : ""}${Math.round(percent)}%`,
          change > 0 ? "Price up - review" : change < 0 ? "Price down" : "No change",
          last.name
        ]);
      });
      return rows.sort((a, b) => moneyToNumber(b[7]) - moneyToNumber(a[7]));
    }

    function serviceRateBenchmarkRows(source = contracts) {
      return source.flatMap(c => {
        const feeLines = c.extractedFeeLines || [];
        if (feeLines.length) {
          return feeLines.map(line => [
            contractFinancialCategory(c),
            c.vendor || "Needs Vendor",
            c.facility || "Needs Facility",
            line.service || "Fee",
            line.unit || line.frequency || "",
            line.rate || line.amount || line.fee || "",
            c.name,
            line.source || line.snippet || "OCR"
          ]);
        }
        const fallbackRate = c.fee || c.rate || c.monthlyCost || c.spend || "";
        return fallbackRate ? [[contractFinancialCategory(c), c.vendor || "Needs Vendor", c.facility || "Needs Facility", "Contract total/rate", "", fallbackRate, c.name, "Saved field"]] : [];
      });
    }

    function perBedPpdRows(source = contracts) {
      return financialRowsForContracts(source)
        .sort((a, b) => b.annual - a.annual)
        .map(row => {
          const hasCost = contractHasFinanceCost(row.contract);
          const annualMissingLabel = hasCost ? "Needs annual amount" : "Needs fee/rate";
          const bedCostMissingLabel = hasCost && row.beds ? "Needs annual amount" : "Needs cost + beds";
          return [
            row.facility,
            row.beds || "Needs bed count",
            row.category,
            row.vendor,
            row.contract.name || "Untitled Contract",
            row.annual ? reportMoney(row.annual) : annualMissingLabel,
            row.monthly ? reportMoney(row.monthly) : annualMissingLabel,
            row.costBedMonth ? reportMoney(row.costBedMonth) : bedCostMissingLabel,
            row.ppd ? `$${row.ppd.toFixed(2)}` : bedCostMissingLabel,
            financeMoneySource(row.contract),
            row.contract.paymentTerms || "Needs payment terms",
            row.contract.status || row.contract.reviewStatus || ""
          ];
        });
    }

    function financeCleanupRows(source = contracts) {
      return financialRowsForContracts(source)
        .map(row => {
          const contract = row.contract || {};
          const missing = [];
          if (!contractHasFinanceCost(contract)) missing.push("Cost");
          if (!contractHasUsableValue(contract.facility)) missing.push("Facility");
          if (annualizedContractSpend(contract) && !facilityBedsForContract(contract)) missing.push("Beds");
          return { row, contract, missing };
        })
        .filter(item => item.missing.length)
        .map(({ row, contract, missing }) => [
          contract.name || "Untitled Contract",
          contract.facility || "Needs Facility",
          facilityRecordForName(contract.facility)?.name || "No facility match",
          facilityBedsForContract(contract) || "Missing",
          contract.vendor || "Needs Vendor",
          contractFinancialCategory(contract),
          annualizedContractSpend(contract) ? reportMoney(annualizedContractSpend(contract)) : "Missing",
          contract.fee || contract.rate || contract.monthlyCost || contract.spend || "",
          missing.join(", "),
          missing.includes("Cost")
            ? "Open Review and save Cost"
            : missing.includes("Facility")
              ? "Choose Facility"
              : "Add facility bed count or alias",
          contract.status || contract.reviewStatus || ""
        ]);
    }

    function contractText(c) {
      return [c.name, c.category, c.agreementType, c.ocrText, c.ocrTextPreview, ...(c.extractedClauses || []).map(item => item.snippet || item.type || "")].join(" ").toLowerCase();
    }

    function buildReport(reportId = activeReportId, options = {}) {
      const savedDefinition = findReportDefinition(reportId);
      if (savedDefinition?.customConfig) return buildCustomReport(savedDefinition.customConfig, savedDefinition);
      if (reportId === "custom-builder") return buildCustomReport();
      const definition = savedDefinition || reportDefinitions.find(report => report.id === reportId) || reportDefinitions[0];
      let headers = ["Facility", "Services", "Vendor", "Contract Status", "Signature Date", "Start of Services", "Initial Contract Length", "Termination", "Auto Renewal", "Payment Terms", "Days Payable", "Fee", "Monthly Cost", "Cost Bed/Month", "Quantity of Services", "Contract", "Risk", "Source PDF"];
      let rows = contractReportRows();
      const reportVendorRows = reportVendorsData.length ? reportVendorsData : vendorsData;
      if (reportId === "current-contracts") {
        headers = ["Current Contract", "Facility", "Vendor", "Service", "Current?", "Status Basis", "Auto Renewal", "Renewal / End", "Cost / Fee", "Older Related Records", "Source"];
        rows = currentContractReportRows(contracts);
      }
      if (reportId === "approved-contracts") rows = contractReportRows(contracts.filter(c => c.status === "Approved" || c.reviewStatus === "Approved"));
      if (reportId === "needs-review") rows = contractReportRows(contracts.filter(c => c.status === "Needs Review" || c.reviewStatus !== "Approved"));
      if (reportId === "contract-history") rows = contractReportRows(contracts.filter(c => c.status === "Archived" || c.archived));
      if (reportId.startsWith("expiring-")) {
        const limit = Number(reportId.split("-")[1]);
        const dueItems = contracts
          .map(contractRenewalAlert)
          .filter(item => item && item.days !== null && item.days >= 0 && item.days <= limit)
          .sort((a, b) => a.days - b.days);
        rows = dueItems.map(item => {
          const row = contractReportRows([item.contract])[0];
          return [...row, item.targetDate, item.basis, item.noticeDays || "", item.baseDate || "", item.days];
        });
        headers = [...headers, "Alert Date", "Alert Basis", "Notice Days", "Renewal/End Date", "Days Left"];
      }
      if (reportId === "auto-renewal") rows = contractReportRows(contracts.filter(c => isAutoRenewing(c.autoRenewal)));
      if (reportId === "auto-renewal-action") {
        headers = ["Contract", "Facility", "Vendor", "Service", "Current?", "Auto Renewal", "Notice / Termination", "Renewal / End", "Notice Deadline", "Days Left", "Action", "Source"];
        rows = autoRenewalActionRows(contracts);
      }
      if (reportId === "unknown-renewal-status") rows = contractReportRows(contracts.filter(c => !isAutoRenewing(c.autoRenewal) && /unknown|needs review|not found|^$/i.test(String(c.autoRenewal || ""))));
      if (reportId === "termination-missing") rows = contractReportRows(contracts.filter(c => !c.terminationClause || ["Unknown", "Missing", "No termination clause"].includes(c.terminationClause)));
      if (reportId === "high-risk") rows = contractReportRows(contracts.filter(c => ["High", "High Risk", "Critical"].includes(c.risk)));
      if (reportId === "missing-insurance") rows = contractReportRows(contracts.filter(c => !String(reportValue(c, "insurance", "")).trim() || String(reportValue(c, "insurance", "")).includes("Needs")));
      if (reportId === "signer-missing") rows = contractReportRows(contracts.filter(c => !c.signer || c.signer === "Needs Review"));
      if (reportId === "signed-date-missing") rows = contractReportRows(contracts.filter(c => !c.signedDate || c.signedDate === "Needs Review"));
      if (reportId === "missing-pdf") rows = contractReportRows(contracts.filter(c => !c.localFilePath));
      if (reportId === "data-quality") {
        headers = ["Contract", "Facility", "Vendor", "Category", "Missing Fields", "Status", "Risk", "Next Action"];
        rows = contracts.map(c => [c.name, c.facility, c.vendor, c.category, reportMissing(c).join(", ") || "Looks complete", c.status, c.risk, reportMissing(c).length ? "Fix before going live" : "Ready"]);
      }
      if (reportId === "vendor-directory") {
        headers = ["Vendor", "Legal Name", "Mailing Address", "Phone", "Email", "Facilities", "Contracts", "Spend", "Insurance", "Issues"];
        rows = reportVendorRows.map(v => [v.name, v.legalName || v.name, v.mailingAddress || "Needs Vendor Address", v.phone || "", v.email || "", v.facilities, v.contracts, v.spend, v.insurance, v.issues]);
      }
      if (reportId === "vendor-address-gaps") {
        headers = ["Vendor", "Mailing Address", "Phone", "Email", "Contracts", "Spend", "Action"];
        rows = reportVendorRows.filter(v => !v.mailingAddress || v.mailingAddress === "Needs Vendor Address").map(v => [v.name, v.mailingAddress || "Missing", v.phone || "", v.email || "", v.contracts, v.spend, "Add vendor profile address"]);
      }
      if (reportId === "vendor-account-ids") {
        headers = ["Contract", "Facility", "Vendor", "Account Number", "Meter / ID", "Service Address", "Category"];
        rows = contracts.filter(c => c.utilityAccountNumber || c.meterNumber || c.serviceAddress).map(c => [c.name, c.facility, c.vendor, c.utilityAccountNumber || "Missing", c.meterNumber || "", c.serviceAddress || "", c.category]);
      }
      if (reportId === "spend-by-vendor") { headers = ["Vendor", "Contracts", "Annual Spend", "Needs Review", "High Risk"]; rows = aggregateReportRows("vendor", "vendor"); }
      if (reportId === "spend-by-facility") { headers = ["Facility", "Contracts", "Annual Spend", "Needs Review", "High Risk"]; rows = aggregateReportRows("facility", "facility"); }
      if (reportId === "spend-by-category") { headers = ["Category", "Contracts", "Annual Spend", "Needs Review", "High Risk"]; rows = aggregateReportRows("category", "category"); }
      if (reportId === "spend-by-service-vendor") {
        headers = ["Service / Category", "Vendor", "Facilities", "Contracts", "Annualized Spend", "Missing Money Fields", "Status"];
        rows = serviceSpendRows(contracts);
      }
      if (reportId === "price-change-tracker") {
        headers = ["Vendor", "Service / Category", "Facility", "Old Year", "Old Annualized Spend", "New Year", "New Annualized Spend", "Change", "Percent", "Signal", "Newest Contract"];
        rows = priceChangeRows(contracts);
      }
      if (reportId === "service-rate-benchmark") {
        headers = ["Service / Category", "Vendor", "Facility", "Fee Line / Product", "Unit / Frequency", "Rate / Amount", "Contract", "Source"];
        rows = serviceRateBenchmarkRows(contracts);
      }
      if (reportId === "possible-overpay") {
        headers = ["Contract", "Facility", "Vendor", "Service / Category", "Cost Bed/Month", "Category Average", "Percent Above", "Annualized Spend", "Reason"];
        rows = dashboardFinancialInsights(contracts).overMarket.map(item => [
          item.contract.name,
          item.facility,
          item.vendor,
          item.category,
          reportMoney(item.costBedMonth),
          reportMoney(item.categoryAverage),
          `${Math.round(item.percentOver)}%`,
          reportMoney(item.annual),
          "Above similar service/category average"
        ]);
      }
      if (reportId === "contract-approval-justifications") {
        headers = ["Contract", "Facility", "Vendor", "Service / Category", "Status", "Current Value", "Peer Average", "Percent Difference", "Peer Count", "Justification", "Approved At"];
        rows = contracts
          .filter(c => c.approvalJustification || c.financialBenchmark?.requiresJustification || c.financialBenchmark?.status)
          .map(c => {
            const benchmark = c.financialBenchmark || {};
            const percent = Number(benchmark.percent || 0);
            return [
              c.name,
              c.facility,
              c.vendor,
              c.category || c.services,
              benchmark.status || "Saved",
              benchmark.candidateValue ? reportMoney(benchmark.candidateValue) : reportMoney(annualizedContractSpend(c)),
              benchmark.average ? reportMoney(benchmark.average) : "Not enough peers",
              benchmark.percent === undefined ? "" : `${percent > 0 ? "+" : ""}${percent.toFixed(0)}%`,
              benchmark.peerCount ?? "",
              c.approvalJustification || "No reason saved",
              c.approvedAt || c.updatedAt || ""
            ];
          });
      }
      if (reportId === "per-bed-ppd-finance") {
        headers = ["Facility", "Beds", "Service / Category", "Vendor", "Contract", "Annualized Spend", "Monthly Run Rate", "Cost Bed/Month", "Estimated PPD", "Money Source", "Payment Terms", "Status"];
        rows = perBedPpdRows(contracts);
      }
      if (reportId === "rate-fee-lines" || reportId === "unit-day-rates") {
        headers = ["Contract", "Facility", "Vendor", "Category", "Service / Fee", "Unit", "Rate", "Frequency", "Source"];
        rows = contracts.flatMap(c => (c.extractedFeeLines || []).map(f => [c.name, c.facility, c.vendor, c.category, f.service || "Fee", f.unit || "", f.rate || "", f.frequency || "", f.source || "OCR"]));
        if (reportId === "unit-day-rates") rows = rows.filter(row => /ppd|patient day|per day|per bed|per unit|unit|rate|price|fee/i.test(row.join(" ")));
      }
      if (reportId === "payment-terms") {
        headers = ["Contract", "Facility", "Vendor", "Category", "Payment Terms", "Days Payable", "Spend"];
        rows = contracts.map(c => [c.name, c.facility, c.vendor, c.category, reportValue(c, "payment", "Needs Review"), c.daysPayable || "Needs Review", c.spend]);
      }
      if (reportId === "facility-coverage") {
        headers = ["Facility", "Region", "Beds", "Contracts", "Annual Spend", "Missing Categories", "Weather Coordinates"];
        rows = facilities.map(f => [f.name, f.region || "", f.beds || "", f.contracts || 0, f.spend || "$0", (f.missing || []).join("; ") || "None listed", facilityCoordinates[f.name] ? `${facilityCoordinates[f.name].latitude}, ${facilityCoordinates[f.name].longitude}` : "Not saved"]);
      }
      if (reportId === "category-coverage") {
        headers = ["Category", "Contracts", "Contract", "Facility"];
        rows = categories.map(cat => {
          const match = contracts.find(c => c.category === cat);
          return [cat, contracts.filter(c => c.category === cat).length, match?.name || "None indexed", match?.facility || "No facility"];
        });
      }
      if (reportId === "utility-accounts") {
        headers = ["Facility", "Vendor", "Type", "Account Number", "Meter Number", "Service Address", "Source"];
        rows = utilityAccounts.map(a => [a.facility, a.vendor, a.utilityType || "Account", a.accountNumber, a.meterNumber || "", a.serviceAddress || "", a.source || "CSV / Contract"]);
      }
      if (reportId === "service-addresses") {
        headers = ["Facility", "Vendor", "Contract", "Service Address", "Account Number"];
        rows = contracts.filter(c => c.serviceAddress).map(c => [c.facility, c.vendor, c.name, c.serviceAddress, c.utilityAccountNumber || ""]);
      }
      if (reportId === "ocr-jobs" || reportId === "ocr-failed") {
        headers = ["Job", "Contract", "Source", "File / Link", "Status", "Created", "Error"];
        const jobs = reportId === "ocr-failed" ? ocrJobs.filter(j => j.status !== "Complete") : ocrJobs;
        rows = jobs.map(j => [j.id, j.contractId || "", j.source || "", j.localFilePath || j.shareSyncUrl || "", j.status || "", j.createdAt || "", j.error || ""]);
      }
      if (reportId === "low-confidence") {
        headers = ["Contract", "Field", "Value", "Confidence", "Source"];
        rows = contracts.flatMap(c => (c.extractedFields || []).filter(f => Number(f.confidence || 100) < 80).map(f => [c.name, f.label || f.key || "Field", f.value || "", f.confidence || "", f.source || f.snippet || ""]));
      }
      if (reportId === "needs-correction") {
        headers = ["Contract", "Facility", "Vendor", "Issue", "Detail", "Confidence", "Action"];
        rows = contracts.flatMap(c => {
          const confidence = contractConfidenceSummary(c);
          const issues = [];
          confidence.missing.forEach(label => issues.push([c.name, c.facility, c.vendor, "Missing key field", label, confidence.score, "Open contract and fix field"]));
          (c.extractedFields || []).filter(f => Number(f.confidence || 100) < 70).forEach(f => issues.push([c.name, c.facility, c.vendor, "Low OCR confidence", `${f.label || "Field"}: ${f.value || ""}`, f.confidence || "", "Use Search This Field"]));
          if (isAutoRenewing(c.autoRenewal) && !contractHasUsableValue(c.terminationClause) && !contractHasUsableValue(c.noticePeriod)) issues.push([c.name, c.facility, c.vendor, "Auto-renewal/no notice risk", "Auto-renewal exists but notice/termination language is missing", confidence.score, "Find Termination / Notice"]);
          duplicateContractsFor(c).forEach(d => issues.push([c.name, c.facility, c.vendor, "Possible duplicate", d.name, confidence.score, "Compare records"]));
          amendmentCandidatesFor(c).forEach(d => issues.push([c.name, c.facility, c.vendor, "Possible amendment/addendum", d.name, confidence.score, "Link to parent contract"]));
          return issues;
        });
      }
      if (reportId === "invoice-matches") {
        headers = ["Invoice", "Vendor", "Facility", "Invoice Date", "Total", "Beds", "Cost Per Bed", "Matched Contract", "Confidence", "Status"];
        rows = invoiceUploads.map(i => [i.name || i.uploadedFileName || "Uploaded invoice", i.vendor || "", i.facility || "", i.invoiceDate || "", i.total || "", i.costPerBed?.beds || "", i.costPerBed?.costPerBedLabel || i.costPerBed?.source || "", i.matchedContractName || "No match", i.matchConfidence || "", i.status || "Checked"]);
      }
      if (reportId === "weather-history") {
        headers = ["Facility", "Date", "End Date", "Category", "Snowfall", "Precipitation", "Invoice", "Status", "Source"];
        rows = weatherChecks.map(w => [w.facility || "", w.date || w.startDate || "", w.endDate || "", w.category || "", w.snowfall || "", w.precipitation || "", w.invoice || "", w.status || "", w.source || "Open-Meteo"]);
      }
      if (reportId === "invoice-needs-match") {
        headers = ["Invoice", "Vendor", "Facility", "Invoice Date", "Total", "Beds", "Cost Per Bed", "Matched Contract", "Confidence", "Status"];
        rows = invoiceUploads.filter(i => i.status !== "Matched").map(i => [i.name || i.uploadedFileName || "Uploaded invoice", i.vendor || "", i.facility || "", i.invoiceDate || "", i.total || "", i.costPerBed?.beds || "", i.costPerBed?.costPerBedLabel || i.costPerBed?.source || "", i.matchedContractName || "No match", i.matchConfidence || "", i.status || "Needs Match"]);
      }
      if (reportId === "weather-snow-events") {
        headers = ["Facility", "Date", "End Date", "Snowfall", "Precipitation", "Invoice", "Status"];
        rows = weatherChecks.filter(w => Number(w.snowfallInches || parseFloat(w.snowfall) || 0) > 0).map(w => [w.facility || "", w.date || w.startDate || "", w.endDate || "", w.snowfall || "", w.precipitation || "", w.invoice || "", w.status || "Checked"]);
      }
      if (reportId === "contract-type-summary") {
        headers = ["Contract Type", "Contracts", "Annual Spend", "Needs Review", "High Risk"];
        const totals = new Map();
        contracts.forEach(c => {
          const name = c.agreementType || c.documentTitle || c.category || "Unknown Type";
          const item = totals.get(name) || { count: 0, spend: 0, review: 0, risk: 0 };
          item.count += 1;
          item.spend += annualizedContractSpend(c);
          if (c.status === "Needs Review") item.review += 1;
          if (["High", "High Risk", "Critical"].includes(c.risk)) item.risk += 1;
          totals.set(name, item);
        });
        rows = [...totals.entries()].map(([name, item]) => [name, item.count, reportMoney(item.spend), item.review, item.risk]);
      }
      if (reportId === "facility-vendor-matrix") {
        headers = ["Facility", "Vendor", "Contracts", "Annual Spend", "Categories"];
        const matrix = new Map();
        contracts.forEach(c => {
          const key = `${c.facility}||${c.vendor}`;
          const item = matrix.get(key) || { facility: c.facility, vendor: c.vendor, count: 0, spend: 0, cats: new Set() };
          item.count += 1;
          item.spend += annualizedContractSpend(c);
          item.cats.add(c.category);
          matrix.set(key, item);
        });
        rows = [...matrix.values()].map(item => [item.facility, item.vendor, item.count, reportMoney(item.spend), [...item.cats].join("; ")]);
      }
      if (reportId === "facility-category-matrix") {
        headers = ["Facility", "Category", "Contracts", "Annual Spend", "Vendors"];
        const matrix = new Map();
        contracts.forEach(c => {
          const key = `${c.facility}||${c.category}`;
          const item = matrix.get(key) || { facility: c.facility, category: c.category, count: 0, spend: 0, vendors: new Set() };
          item.count += 1;
          item.spend += annualizedContractSpend(c);
          item.vendors.add(c.vendor);
          matrix.set(key, item);
        });
        rows = [...matrix.values()].map(item => [item.facility, item.category, item.count, reportMoney(item.spend), [...item.vendors].join("; ")]);
      }
      if (reportId === "vendor-facility-count") {
        headers = ["Vendor", "Facilities", "Contracts", "Annual Spend"];
        const totals = new Map();
        contracts.forEach(c => {
          const item = totals.get(c.vendor) || { facilities: new Set(), contracts: 0, spend: 0 };
          item.facilities.add(c.facility);
          item.contracts += 1;
          item.spend += annualizedContractSpend(c);
          totals.set(c.vendor, item);
        });
        rows = [...totals.entries()].map(([vendor, item]) => [vendor, item.facilities.size, item.contracts, reportMoney(item.spend)]).sort((a, b) => b[1] - a[1]);
      }
      if (reportId === "unknown-vendors") rows = contractReportRows(contracts.filter(c => c.vendor === "Needs Classification" || !c.vendor));
      if (reportId === "unknown-facilities") rows = contractReportRows(contracts.filter(c => c.facility === "Needs Classification" || !c.facility));
      if (reportId === "unknown-categories") rows = contractReportRows(contracts.filter(c => c.category === "Needs Classification" || !c.category));
      if (reportId === "large-spend-contracts") rows = contractReportRows([...contracts].sort((a, b) => annualizedContractSpend(b) - annualizedContractSpend(a)).slice(0, 50));
      if (reportId === "missing-spend") {
        headers = ["Contract", "Facility", "Matched Facility", "Beds", "Vendor", "Service", "Annualized Spend", "Saved Finance Field", "Missing", "Action", "Status"];
        rows = financeCleanupRows(contracts);
      }
      if (reportId === "monthly-run-rate") {
        headers = ["Contract", "Facility", "Vendor", "Category", "Annual Spend", "Estimated Monthly", "Status"];
        rows = contracts.map(c => [c.name, c.facility, c.vendor, c.category, reportMoney(annualizedContractSpend(c)), reportMoney(annualizedContractSpend(c) / 12), c.status]);
      }
      if (reportId === "fee-lines-missing") rows = contractReportRows(contracts.filter(c => !(c.extractedFeeLines || []).length));
      if (reportId === "vendor-contact-gaps") {
        headers = ["Vendor", "Phone", "Email", "Mailing Address", "Contracts", "Action"];
        rows = reportVendorRows.filter(v => !v.phone || !v.email).map(v => [v.name, v.phone || "Missing", v.email || "Missing", v.mailingAddress || "Needs Vendor Address", v.contracts, "Complete vendor profile"]);
      }
      if (reportId === "vendor-insurance-gaps") {
        headers = ["Vendor", "Insurance", "Contracts", "Spend", "Issues"];
        rows = reportVendorRows.filter(v => !v.insurance || v.insurance !== "Current").map(v => [v.name, v.insurance || "Missing", v.contracts, v.spend, v.issues || "Review"]);
      }
      if (reportId === "vendor-payment-terms-gaps") {
        headers = ["Vendor", "Payment Terms", "Contracts", "Spend", "Action"];
        rows = reportVendorRows.filter(v => !v.paymentTerms).map(v => [v.name, "Missing", v.contracts, v.spend, "Add payment terms"]);
      }
      if (reportId === "account-number-gaps") rows = contractReportRows(contracts.filter(c => !c.utilityAccountNumber));
      if (reportId === "service-address-gaps") rows = contractReportRows(contracts.filter(c => !c.serviceAddress));
      if (reportId === "facility-weather-coordinates" || reportId === "missing-weather-coordinates") {
        headers = ["Facility", "Region", "Beds", "Latitude", "Longitude", "Status"];
        rows = facilities.map(f => {
          const coords = facilityCoordinates[f.name] || {};
          return [f.name, f.region || "", f.beds || "", coords.latitude || "", coords.longitude || "", coords.latitude && coords.longitude ? "Ready" : "Missing coordinates"];
        });
        if (reportId === "missing-weather-coordinates") rows = rows.filter(row => row[5] === "Missing coordinates");
      }
      if (reportId === "ocr-complete") {
        headers = ["Job", "Contract", "Source", "File / Link", "Status", "Created"];
        rows = ocrJobs.filter(j => j.status === "Complete").map(j => [j.id, j.contractId || "", j.source || "", j.localFilePath || j.shareSyncUrl || "", j.status || "", j.createdAt || ""]);
      }
      if (reportId === "ocr-queued") {
        headers = ["Job", "Contract", "Source", "File / Link", "Status", "Created"];
        rows = ocrJobs.filter(j => j.status !== "Complete").map(j => [j.id, j.contractId || "", j.source || "", j.localFilePath || j.shareSyncUrl || "", j.status || "", j.createdAt || ""]);
      }
      if (reportId === "contracts-with-ocr-text") rows = contractReportRows(contracts.filter(c => c.ocrText || c.ocrTextPreview));
      if (reportId === "contracts-without-ocr-text") rows = contractReportRows(contracts.filter(c => !c.ocrText && !c.ocrTextPreview));
      if (reportId === "renewal-owner") {
        headers = ["Owner", "Contract", "Facility", "Vendor", "End Date", "Renewal", "Status", "Risk"];
        rows = contracts.map(c => [c.owner || "Contract Dept", c.name, c.facility, c.vendor, c.end, c.renewal, c.status, c.risk]);
      }
      if (reportId === "expired-contracts") rows = contractReportRows(contracts.filter(c => {
        const days = reportDateDays(c.end);
        return days !== null && days < 0;
      }));
      if (reportId === "no-end-date") rows = contractReportRows(contracts.filter(c => !c.end || c.end === "Needs Review"));
      if (reportId === "notice-90-plus") rows = contractReportRows(contracts.filter(c => String(c.terminationClause || "").includes("90") || String(c.terminationClause || "").includes("120")));
      if (["insurance-clause-check", "hipaa-clause-check", "indemnification-check", "liability-check", "audit-rights-check"].includes(reportId)) {
        const keywordMap = {
          "insurance-clause-check": ["insurance"],
          "hipaa-clause-check": ["hipaa", "privacy"],
          "indemnification-check": ["indemnification", "indemnify"],
          "liability-check": ["liability", "limitation"],
          "audit-rights-check": ["audit"]
        };
        const words = keywordMap[reportId] || [];
        headers = ["Contract", "Facility", "Vendor", "Category", "Clause Found", "Status", "Risk"];
        rows = contracts.map(c => {
          const found = words.some(word => contractText(c).includes(word));
          return [c.name, c.facility, c.vendor, c.category, found ? "Found" : "Missing / Not read", c.status, c.risk];
        });
      }
      if (reportId === "audit-trail") {
        headers = ["Date", "Actor", "Entity Type", "Entity ID", "Action", "Details"];
        rows = auditLogs.map(a => [a.createdAt || "", a.actor || "local-user", a.entityType || "", a.entityId || "", a.action || "", JSON.stringify(a.details || {})]);
      }
      if (reportId === "admin-settings-summary") {
        headers = ["Area", "Setting", "Value"];
        rows = [
          ["System", "ShareSync Root", adminSettings.shareSyncRoot || "Not set"],
          ["System", "Alert Schedule", adminSettings.alertSchedule || "Not set"],
          ["System", "Network Access", adminSettings.networkAccess || "Not set"],
          ["System", "Public Internet Access", adminSettings.publicInternetAccess || "Not set"],
          ["Categories", "Configured Categories", (adminSettings.categories || categories).join("; ")],
          ["Facilities", "Saved Facility Profiles", (adminSettings.facilityProfiles || []).length],
          ["Roles", "Configured Roles", (adminSettings.roles || []).map(role => role.role).join("; ")]
        ];
      }
      rows = options.applyFilters === false ? rows : applyReportFilters(rows);
      const totalSpend = contracts.reduce((sum, c) => sum + annualizedContractSpend(c), 0);
      return {
        ...definition,
        headers,
        rows,
        summary: [
          ["Rows", rows.length.toLocaleString(), rows.length ? "Live data" : "No matches"],
          ["Contracts", contracts.length.toLocaleString(), "Loaded records"],
          ["Spend", reportMoney(totalSpend), "Contract spend indexed"]
        ]
      };
    }

    function populateReportControls() {
      const reportSelect = document.getElementById("reportTypeSelect");
      if (reportSelect) {
        const uniqueReports = [...new Map(availableReportDefinitions().map(report => [report.id, report])).values()];
        reportSelect.innerHTML = uniqueReports.map(report => optionHtml(report.id, `${report.group} - ${report.name}`, report.id === activeReportId)).join("");
      }
      const facilitySelect = document.getElementById("reportFacilityFilter");
      if (facilitySelect) {
        const value = facilitySelect.value;
        facilitySelect.innerHTML = `<option value="">All Facilities</option>` + dedupeRecords(facilities, "name").map(f => optionHtml(f.name, f.name, sameMasterName(f.name, value))).join("");
        facilitySelect.value = value;
      }
      const categorySelect = document.getElementById("reportCategoryFilter");
      if (categorySelect) {
        const value = categorySelect.value;
        categorySelect.innerHTML = categoryOptionsHtml(value, "All categories");
        categorySelect.value = value;
      }
      const vendorSelect = document.getElementById("reportVendorFilter");
      if (vendorSelect) {
        const value = vendorSelect.value;
        const vendorOptions = vendorMasterOptions(value ? [value] : []);
        vendorSelect.innerHTML = `<option value="">All Vendors</option>` + vendorOptions.map(v => optionHtml(v.name, v.name, sameMasterName(v.name, value))).join("");
        vendorSelect.value = value;
      }
      const columnPicker = document.getElementById("customReportColumns");
      if (columnPicker && !columnPicker.dataset.ready) {
        columnPicker.innerHTML = customReportColumns.map(([key, label]) => `
          <label class="report-column-chip">
            <input type="checkbox" data-custom-report-column value="${escapeHtml(key)}" ${defaultCustomColumns.includes(key) ? "checked" : ""} />
            <span>${escapeHtml(label)}</span>
          </label>
        `).join("");
        columnPicker.dataset.ready = "true";
        columnPicker.querySelectorAll(".report-column-chip").forEach(chip => {
          chip.addEventListener("click", event => {
            if (event.target?.matches?.("input")) return;
            event.preventDefault();
            const input = chip.querySelector("[data-custom-report-column]");
            if (!input) return;
            input.checked = !input.checked;
            input.dispatchEvent(new Event("change", { bubbles: true }));
          });
        });
        columnPicker.querySelectorAll("[data-custom-report-column]").forEach(input => input.addEventListener("change", () => {
          updateCustomReportColumnCount();
          renderReports();
        }));
        updateCustomReportColumnCount();
      }
    }

    function reportButtonLabel(report = {}) {
      const group = String(report.group || "").toLowerCase();
      const name = String(report.name || "Report");
      if (group.includes("renewal")) return "Open Renewal Report";
      if (group.includes("risk")) return "Open Risk Report";
      if (group.includes("spend") || group.includes("cost")) return "Open Cost Report";
      if (group.includes("invoice")) return "Open Invoice Report";
      if (group.includes("facility")) return "Open Facility Report";
      if (group.includes("vendor")) return "Open Vendor Report";
      if (group.includes("core")) return `Open ${name}`;
      return `Open ${name}`;
    }

    function reportBusinessQuestion(report = {}) {
      const id = String(report.id || "");
      const exact = {
        "custom-builder": "What exact report do these search filters and columns build?",
        "contract-inventory": "What contracts are loaded and searchable?",
        "current-contracts": "Which contract should we treat as the current agreement?",
        "approved-contracts": "Which contracts are approved and ready to rely on?",
        "needs-review": "What needs human review before it can be trusted?",
        "contract-history": "What older, archived, or replaced records do we still have?",
        "expiring-30": "What needs action in the next 30 days?",
        "expiring-90": "What needs action in the next 90 days?",
        "expiring-180": "What should we plan for over the next 180 days?",
        "auto-renewal": "How many contracts are confirmed auto-renewal?",
        "auto-renewal-action": "Which auto-renewal contracts need notice or renewal action?",
        "unknown-renewal-status": "Which contracts still need renewal status verified?",
        "termination-missing": "Which contracts are missing exit or notice language?",
        "spend-by-vendor": "How much do we spend with each vendor?",
        "spend-by-facility": "How much does each facility spend?",
        "spend-by-category": "How much do we spend by service type?",
        "spend-by-service-vendor": "Which vendors cost us money by service category?",
        "price-change-tracker": "Are prices going up or down over time?",
        "service-rate-benchmark": "What rates and units are being charged across vendors?",
        "possible-overpay": "Which contracts look high compared with peers?",
        "per-bed-ppd-finance": "What is the cost per bed and estimated PPD?",
        "missing-spend": "Which contracts are missing usable cost/rate data?",
        "payment-terms": "What payment terms are saved by contract?",
        "facility-coverage": "What does each facility have loaded and what is missing?",
        "category-coverage": "Which service categories have contracts?",
        "facility-vendor-matrix": "Which vendors serve each facility?",
        "facility-category-matrix": "Which services are covered at each facility?",
        "unknown-vendors": "Which contracts still need the vendor identified?",
        "unknown-facilities": "Which contracts still need the facility identified?",
        "unknown-categories": "Which contracts still need service type identified?",
        "invoice-matches": "Which invoices matched contracts and with what confidence?",
        "needs-correction": "Which records are most likely wrong or incomplete?",
        "contracts-without-ocr-text": "Which source files still need readable text?",
        "audit-trail": "Who changed what and when?"
      };
      if (exact[id]) return exact[id];
      const group = String(report.group || "").toLowerCase();
      const name = String(report.name || "this report").toLowerCase();
      if (group.includes("renewal")) return `What renewal or termination action is needed for ${name}?`;
      if (group.includes("finance")) return `What money, rate, cost, or spend issue does ${name} show?`;
      if (group.includes("vendor")) return `What vendor information is complete or missing in ${name}?`;
      if (group.includes("facility")) return `What facility coverage or facility data does ${name} show?`;
      if (group.includes("ocr")) return `What reading, OCR, or correction issue does ${name} show?`;
      if (group.includes("risk") || group.includes("legal")) return `What risk, clause, or proof issue does ${name} show?`;
      return `What records does ${report.name || "this report"} answer?`;
    }

    function reportDataRule(report = {}) {
      if (report.customConfig) return "Uses your saved report filters and columns against the current live records.";
      if (String(report.id || "") === "custom-builder") return "Uses the live records matched by the selected filters, search terms, source, date range, and chosen columns.";
      const group = String(report.group || "").toLowerCase();
      if (group.includes("finance")) return "Uses saved cost/rate fields, fee lines, beds, facility, vendor, and service.";
      if (group.includes("renewal")) return "Uses saved end dates, renewal dates, auto-renewal, notice period, and termination language.";
      if (group.includes("vendor")) return "Uses vendor master data plus contracts linked to each vendor.";
      if (group.includes("facility")) return "Uses facility master data, aliases, beds, and contracts linked to the facility.";
      if (group.includes("ocr")) return "Uses OCR job status, source text, confidence, and saved review fields.";
      if (group.includes("invoice")) return "Uses temporary invoice checks and matched contract metadata.";
      if (group.includes("legal") || group.includes("risk")) return "Uses OCR/source text plus saved review fields; legal should verify important clauses.";
      return "Uses the live contract index and saved review fields.";
    }

    let reportSettingsRequested = false;

    function ensureReportSettingsLoaded() {
      if (reportSettingsRequested || Object.keys(adminSettings || {}).length) return;
      reportSettingsRequested = true;
      apiJson("/api/admin-settings").then(settings => {
        adminSettings = settings || adminSettings || {};
        renderReports();
      }).catch(() => {});
    }

    function savedReportTemplates() {
      return Array.isArray(adminSettings.savedReports) ? adminSettings.savedReports : [];
    }

    function hiddenPremadeReportIds() {
      return new Set(Array.isArray(adminSettings.hiddenReportIds) ? adminSettings.hiddenReportIds : []);
    }

    function savedReportDefinition(template = {}) {
      const config = template.config || {};
      return {
        id: template.id || `saved-report-${Date.now()}`,
        name: template.name || "Saved Report",
        group: "Saved",
        description: template.description || customReportFilterLabel(config),
        customConfig: config,
        saved: true
      };
    }

    function availableReportDefinitions(includeHidden = false) {
      const hidden = hiddenPremadeReportIds();
      const builtIns = reportDefinitions.filter(report => includeHidden || !hidden.has(report.id));
      return [...builtIns, ...savedReportTemplates().map(savedReportDefinition)];
    }

    function findReportDefinition(reportId) {
      return availableReportDefinitions(true).find(report => report.id === reportId || report.name === reportId);
    }

    async function saveReportSettings(partial = {}) {
      if (!requireBackend("Saving report settings")) return false;
      try {
        adminSettings = await apiJson("/api/admin-settings", {
          method: "POST",
          body: JSON.stringify(partial)
        });
        return true;
      } catch (error) {
        showToast("Could not save report settings.");
        return false;
      }
    }

    function renderReports() {
      ensureReportSettingsLoaded();
      populateReportControls();
      refreshCustomReportPreview();
      const report = buildReport(activeReportId);
      const visibleRows = report.rows.slice(0, 200);
      document.getElementById("activeReportTitle").textContent = report.name;
      document.getElementById("activeReportCount").textContent = `${report.rows.length.toLocaleString()} row${report.rows.length === 1 ? "" : "s"}`;
      const reportSummary = [
        ["Question", reportBusinessQuestion(report), "Answers"],
        ["Data Used", reportDataRule(report), "Source"],
        ...report.summary
      ];
      document.getElementById("activeReportSummary").innerHTML = reportSummary.map(item => {
        const longContext = item[0] === "Question" || item[0] === "Data Used";
        return longContext
          ? `<div class="metric-row report-context-row"><div><strong>${escapeHtml(item[0])}</strong><span>${escapeHtml(item[1])}</span></div><span class="badge ${item[0] === "Question" ? "blue" : "gray"}">${escapeHtml(item[2])}</span></div>`
          : `<div class="metric-row"><div><strong>${escapeHtml(item[0])}</strong><span>${escapeHtml(item[2])}</span></div><span class="badge blue">${escapeHtml(item[1])}</span></div>`;
      }).join("");
      document.getElementById("reportTableHead").innerHTML = `<tr>${report.headers.map(header => `<th>${escapeHtml(header)}</th>`).join("")}</tr>`;
      document.getElementById("costReportRows").innerHTML = visibleRows.map(row => `
        <tr>${row.map((cell, index) => `<td>${index === 0 ? `<strong>${escapeHtml(cell)}</strong>` : escapeHtml(cell)}</td>`).join("")}</tr>
      `).join("") + (report.rows.length > visibleRows.length ? `<tr><td colspan="${report.headers.length}"><strong>Showing first ${visibleRows.length} rows.</strong> Export the report for the full list.</td></tr>` : "") || `<tr><td colspan="${report.headers.length}">No rows match this report yet.</td></tr>`;
      const reportCardSearch = String(document.getElementById("reportCardSearch")?.value || "").trim().toLowerCase();
      const pinnedReportIds = new Set([
        "contract-inventory",
        "current-contracts",
        "needs-review",
        "data-quality",
        "expiring-90",
        "auto-renewal",
        "auto-renewal-action",
        "unknown-renewal-status",
        "termination-missing",
        "spend-by-facility",
        "spend-by-vendor",
        "spend-by-service-vendor",
        "possible-overpay",
        "payment-terms",
        "invoice-matches",
        "missing-pdf",
        "contracts-without-ocr-text",
        "ocr-failed",
        "facility-category-matrix"
      ]);
      const allReports = availableReportDefinitions();
      const hiddenCount = hiddenPremadeReportIds().size;
      const visibleReports = allReports
        .filter(item => {
          const haystack = `${item.name} ${item.group} ${item.description} ${item.id} ${reportBusinessQuestion(item)} ${reportDataRule(item)}`.toLowerCase();
          return reportCardSearch ? haystack.includes(reportCardSearch) : (item.saved || pinnedReportIds.has(item.id));
        })
        .slice(0, reportCardSearch ? 80 : 18);
      const reportCardCount = document.getElementById("reportCardCount");
      if (reportCardCount) reportCardCount.textContent = reportCardSearch
        ? `${visibleReports.length} match${visibleReports.length === 1 ? "" : "es"}`
        : hiddenCount ? `${hiddenCount} hidden` : "Most used";
      const reportCardsHtml = visibleReports.map(item => `
        <article class="card tile clickable-row report-question-card" role="button" tabindex="0" onclick="openReport('${item.id}')">
          <div class="tile-title"><h3>${escapeHtml(item.name)}</h3><span class="badge blue">${escapeHtml(item.group)}</span></div>
          <p class="report-question">${escapeHtml(reportBusinessQuestion(item))}</p>
          <p class="report-data-rule">${escapeHtml(reportDataRule(item))}</p>
          <div class="table-actions">
            <button class="btn primary" onclick="event.stopPropagation(); downloadReportCsv('${item.id}')">Download Excel</button>
            <button class="btn" onclick="event.stopPropagation(); openReport('${item.id}')">Open</button>
            ${item.saved
              ? `<button class="btn danger" onclick="event.stopPropagation(); deleteSavedReport('${item.id}')">Delete</button>`
              : item.id === "custom-builder" ? "" : `<button class="btn ghost" onclick="event.stopPropagation(); hidePremadeReport('${item.id}')">Hide</button>`}
          </div>
        </article>
      `).join("");
      const restoreCard = hiddenCount ? `
        <article class="card tile report-question-card">
          <div class="tile-title"><h3>Hidden Reports</h3><span class="badge gray">${hiddenCount}</span></div>
          <p class="report-question">Restore the built-in report cards you hid.</p>
          <p class="report-data-rule">Saved reports are never removed by this action.</p>
          <div class="table-actions"><button class="btn" onclick="restorePremadeReports()">Restore Hidden</button></div>
        </article>
      ` : "";
      document.getElementById("reportCards").innerHTML = (reportCardsHtml + restoreCard) || `
        <article class="card" style="grid-column:1/-1">
          <div class="panel-body">No reports match that search.</div>
        </article>
      `;
    }

    function setReportView(view = "home") {
      const home = document.getElementById("reportHomeView");
      const detail = document.getElementById("reportDetailView");
      if (!home || !detail) return;
      const showDetail = view === "detail";
      home.classList.toggle("is-hidden", showDetail);
      detail.classList.toggle("is-hidden", !showDetail);
    }

    function showReportHome() {
      setReportView("home");
      showToast("Back to reports.");
    }

    function openReport(reportId) {
      activeReportId = findReportDefinition(reportId)?.id || "contract-inventory";
      switchSection("reports");
      setTimeout(() => {
        renderReports();
        setReportView("detail");
      }, 0);
      showToast("Report loaded with live rows.");
    }

    window.openReport = openReport;
    window.showReportHome = showReportHome;

    function openCustomReport() {
      activeReportId = "custom-builder";
      switchSection("reports");
      renderReports();
      setReportView("detail");
      showToast("Custom report built from current search.");
    }

    function downloadCustomReport() {
      const report = buildCustomReport();
      if (!report.rows.length) {
        refreshCustomReportPreview();
        showToast("No rows match this custom report yet.");
        return;
      }
      const rows = [
        ["Report", "Custom Report"],
        ["Created", new Date().toLocaleString()],
        ["Rows", report.rows.length],
        ["Filters", customReportFilterLabel()],
        ["Data Used", reportDataRule(report)],
        ...report.summary.map(item => [item[0], item[1], item[2]]),
        [],
        report.headers,
        ...report.rows
      ];
      const headerRowIndex = rows.findIndex(row => row === report.headers);
      saveExcelFile(rows, "custom-contract-report", "Downloaded custom report as styled Excel.", {
        title: "Custom Contract Report",
        subtitle: customReportFilterLabel(),
        headerRowIndex
      });
    }

    async function saveCurrentCustomReport() {
      const report = refreshCustomReportPreview();
      if (!report.headers.length) {
        showToast("Choose at least one column before saving this report.");
        return;
      }
      const suggestedName = customReportFilterLabel().slice(0, 80) || "Saved Report";
      const name = window.prompt("Name this saved report", suggestedName);
      if (!name || !name.trim()) return;
      const config = customReportConfigFromControls();
      const savedReports = savedReportTemplates();
      const id = `saved-report-${Date.now()}`;
      const nextSavedReports = [
        ...savedReports.filter(item => String(item.name || "").toLowerCase() !== name.trim().toLowerCase()),
        {
          id,
          name: name.trim(),
          description: customReportFilterLabel(config),
          config,
          createdAt: new Date().toISOString()
        }
      ];
      const saved = await saveReportSettings({ ...adminSettings, savedReports: nextSavedReports });
      if (!saved) return;
      activeReportId = id;
      renderReports();
      setReportView("detail");
      showToast("Saved report added to Reports.");
    }

    async function deleteSavedReport(reportId) {
      const report = findReportDefinition(reportId);
      if (!report?.saved) return;
      if (!window.confirm(`Delete saved report "${report.name}"?`)) return;
      const nextSavedReports = savedReportTemplates().filter(item => item.id !== reportId);
      const saved = await saveReportSettings({ ...adminSettings, savedReports: nextSavedReports });
      if (!saved) return;
      if (activeReportId === reportId) activeReportId = "custom-builder";
      renderReports();
      showToast("Saved report deleted.");
    }

    async function hidePremadeReport(reportId) {
      const report = findReportDefinition(reportId);
      if (!report || report.saved || report.id === "custom-builder") return;
      if (!window.confirm(`Hide "${report.name}" from the report cards? You can restore hidden reports later.`)) return;
      const hidden = hiddenPremadeReportIds();
      hidden.add(report.id);
      const saved = await saveReportSettings({ ...adminSettings, hiddenReportIds: [...hidden] });
      if (!saved) return;
      if (activeReportId === reportId) activeReportId = "contract-inventory";
      renderReports();
      showToast("Report card hidden.");
    }

    async function restorePremadeReports() {
      const saved = await saveReportSettings({ ...adminSettings, hiddenReportIds: [] });
      if (!saved) return;
      renderReports();
      showToast("Built-in report cards restored.");
    }

    window.openCustomReport = openCustomReport;
    window.downloadCustomReport = downloadCustomReport;
    window.saveCurrentCustomReport = saveCurrentCustomReport;
    window.deleteSavedReport = deleteSavedReport;
    window.hidePremadeReport = hidePremadeReport;
    window.restorePremadeReports = restorePremadeReports;

    function facilityEditorValue(id) {
      return document.getElementById(id)?.value?.trim() || "";
    }

    function openFacilityEditor(name = "") {
      const existing = facilityMasterOptions().find(item => sameMasterName(item.name, name))
        || (adminSettings.facilityProfiles || []).find(item => sameMasterName(item.name, name))
        || {};
      const aliases = Array.isArray(existing.aliases) ? existing.aliases.join(", ") : "";
      document.getElementById("modalTitle").textContent = existing.name ? "Edit Facility" : "Add Facility";
      document.getElementById("modalBody").innerHTML = `
        <form id="facilityEditorForm" onsubmit="event.preventDefault(); saveFacilityProfileFromModal('${jsArg(existing.name || "")}');">
          <div class="metric-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));align-items:start">
            <label class="field">Facility Name
              <input id="facilityEditorName" value="${escapeHtml(existing.name || "")}" placeholder="Facility name" required />
            </label>
            <label class="field">Record Type
              <select id="facilityEditorRecordType">
                <option ${facilityRecordType(existing) === "Active Facility" ? "selected" : ""}>Active Facility</option>
                <option ${facilityRecordType(existing) === "Historical / Record Only" ? "selected" : ""}>Historical / Record Only</option>
                <option ${facilityRecordType(existing) === "External Company / Not a Facility" ? "selected" : ""}>External Company / Not a Facility</option>
              </select>
            </label>
            <label class="field">Approved DBA
              <input id="facilityEditorDba" value="${escapeHtml(existing.dba || existing.approvedDba || "")}" placeholder="DBA name" />
            </label>
            <label class="field">Legal Name
              <input id="facilityEditorLegalName" value="${escapeHtml(existing.legalName || "")}" placeholder="Legal entity" />
            </label>
            <label class="field">Beds
              <input id="facilityEditorBeds" type="number" min="0" value="${escapeHtml(existing.beds || "")}" placeholder="Bed count" />
            </label>
            <label class="field">Building Square Feet
              <input id="facilityEditorSquareFeet" type="number" min="0" value="${escapeHtml(existing.squareFeet || "")}" placeholder="Total building square feet" />
            </label>
            <label class="field">Region / County
              <input id="facilityEditorRegion" value="${escapeHtml(existing.region || existing.county || "")}" placeholder="Region or county" />
            </label>
            <label class="field">Address
              <input id="facilityEditorAddress" value="${escapeHtml(existing.address || "")}" placeholder="Street address" />
            </label>
            <label class="field">City, State, Zip
              <input id="facilityEditorCityStateZip" value="${escapeHtml(existing.cityStateZip || "")}" placeholder="City, ST ZIP" />
            </label>
            <label class="field">Phone
              <input id="facilityEditorPhone" value="${escapeHtml(existing.phone || "")}" placeholder="Phone" />
            </label>
            <label class="field">Software
              <input id="facilityEditorSoftware" value="${escapeHtml(existing.software || "")}" placeholder="Software" />
            </label>
            <label class="field">AP Software
              <input id="facilityEditorApSoftware" value="${escapeHtml(existing.apSoftware || "")}" placeholder="AP software" />
            </label>
            <label class="field">Chart
              <input id="facilityEditorChart" value="${escapeHtml(existing.chart || "")}" placeholder="Chart system" />
            </label>
            <label class="field">Aliases
              <input id="facilityEditorAliases" value="${escapeHtml(aliases)}" placeholder="Other names, separated by commas" />
            </label>
          </div>
          <div class="modal-actions">
            <button class="btn primary" type="submit">Save Facility</button>
            ${existing.name ? `<button class="btn danger" type="button" onclick="deleteFacilityProfile('${jsArg(existing.name)}')">Delete Facility</button>` : ""}
            <button class="btn" type="button" onclick="closeModal()">Cancel</button>
          </div>
        </form>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    async function saveFacilityProfileFromModal(originalName = "") {
      const name = facilityEditorValue("facilityEditorName");
      if (!name) {
        showToast("Facility name is required.");
        return;
      }
      const aliases = facilityEditorValue("facilityEditorAliases").split(/[;|,]/).map(item => item.trim()).filter(Boolean);
      const existingProfile = (adminSettings.facilityProfiles || []).find(item =>
        sameMasterName(item.name, originalName || name)
      ) || {};
      const profile = {
        ...existingProfile,
        name,
        recordType: facilityEditorValue("facilityEditorRecordType") || "Active Facility",
        dba: facilityEditorValue("facilityEditorDba"),
        legalName: facilityEditorValue("facilityEditorLegalName"),
        beds: facilityEditorValue("facilityEditorBeds"),
        squareFeet: facilityEditorValue("facilityEditorSquareFeet"),
        region: facilityEditorValue("facilityEditorRegion"),
        address: facilityEditorValue("facilityEditorAddress"),
        cityStateZip: facilityEditorValue("facilityEditorCityStateZip"),
        phone: facilityEditorValue("facilityEditorPhone"),
        software: facilityEditorValue("facilityEditorSoftware"),
        apSoftware: facilityEditorValue("facilityEditorApSoftware"),
        chart: facilityEditorValue("facilityEditorChart"),
        aliases
      };
      const nextProfiles = (adminSettings.facilityProfiles || [])
        .filter(item => !sameMasterName(item.name, name) && !sameMasterName(item.name, originalName));
      const nextHidden = (adminSettings.hiddenFacilities || [])
        .filter(item => !sameMasterName(typeof item === "string" ? item : item?.name, name) && !sameMasterName(typeof item === "string" ? item : item?.name, originalName));
      await saveAdminSettings({
        ...collectAdminSettings(),
        facilityProfiles: [...nextProfiles, profile],
        hiddenFacilities: nextHidden,
        weatherCoordinates: adminSettings.weatherCoordinates || {}
      });
      closeModal();
      renderFacilities();
      showToast("Facility saved.");
    }

    async function deleteFacilityProfile(name) {
      const facility = facilityMasterOptions().find(item => sameMasterName(item.name, name)) || { name };
      if (!facility?.name) return;
      if (!confirm(`Remove ${facility.name} from facility dropdowns and the Facilities page? Contracts will not be deleted.`)) return;
      const nextProfiles = (adminSettings.facilityProfiles || []).filter(item => !sameMasterName(item.name, facility.name));
      const hiddenFacilities = dedupeRecords([
        ...(adminSettings.hiddenFacilities || []).map(item => typeof item === "string" ? { name: item } : item),
        {
          name: facility.name,
          dba: facility.dba || facility.approvedDba || "",
          legalName: facility.legalName || "",
          aliases: Array.isArray(facility.aliases) ? facility.aliases : []
        }
      ], "name");
      await saveAdminSettings({
        ...collectAdminSettings(),
        facilityProfiles: nextProfiles,
        hiddenFacilities,
        weatherCoordinates: adminSettings.weatherCoordinates || {}
      });
      closeModal();
      renderFacilities();
      showToast("Facility removed from active lists.");
    }

    const requiredFacilityContractTypes = ["Electric","Gas","Water/Sewer","Oxygen","Waste Removal","Laundry","Insurance","Pharmacy"];

    function facilityCategoryContracts(facilityName, categoryName) {
      const targetCategory = categoryCanonicalName(categoryName);
      return contracts.filter(contract =>
        sameMasterName(contract.facility, facilityName)
        && categoryCanonicalName(contract.services || contract.category || contract.contractType || "") === targetCategory
      );
    }

    function openFacilityMatrixCategory(facilityName, categoryName) {
      closeModal();
      const facilityFilter = document.getElementById("facilityFilter");
      const categoryFilter = document.getElementById("categoryFilter");
      const contractSearch = document.getElementById("contractSearch");
      if (facilityFilter) facilityFilter.value = facilityName;
      if (categoryFilter) {
        const target = categoryCanonicalName(categoryName);
        const match = [...categoryFilter.options].find(option => categoryCanonicalName(option.value) === target);
        categoryFilter.value = match ? match.value : "";
      }
      if (contractSearch) contractSearch.value = "";
      switchSection("contracts");
      showContractsView("filtered");
      renderContracts();
    }

    function openFacility(name) {
      const f = facilityMasterOptions().find(item => sameMasterName(item.name, name)) || facilityMasterOptions()[0];
      if (!f) {
        showToast("No live facility record is available yet.");
        return;
      }
      const facilityContracts = contracts.filter(c => sameMasterName(c.facility, f.name));
      const bedCount = Number(f.beds || 0);
      const averageCensus = Number(f.averageDailyCensus || f.currentCensus || 0);
      const costBed = costPerBed(f.spend, f.beds);
      const ppd = facilityPpd(f.spend, averageCensus);
      const squareFeet = Number(f.squareFeet || 0);
      const costSquareFoot = moneyToNumber(f.spend) > 0 && squareFeet > 0 ? reportMoney(moneyToNumber(f.spend) / squareFeet) : "Needs data";
      const aliases = Array.isArray(f.aliases) ? f.aliases.filter(Boolean).slice(0, 8) : [];
      const requiredRows = requiredFacilityContractTypes.map(cat => {
        const matches = facilityCategoryContracts(f.name, cat);
        const count = matches.length;
        const missing = count === 0;
        const spend = matches.reduce((sum, contract) => sum + moneyToNumber(contract.spend || contract.annualCost || contract.monthlyCost), 0);
        return { cat, count, missing, spend };
      });
      document.getElementById("modalTitle").textContent = f.name;
      document.getElementById("modalBody").innerHTML = `
        <div class="grid">
          <datalist id="vendorNameSuggestions">
            ${vendorMasterOptions().map(vendor => `<option value="${escapeHtml(vendor.name)}">${escapeHtml([vendor.category, vendor.mailingAddress, vendor.phone, vendor.email].filter(Boolean).join(" | "))}</option>`).join("")}
          </datalist>
          <div class="grid kpis">
            <article class="card kpi"><div class="label">Beds</div><div class="value">${bedCount ? bedCount.toLocaleString() : "Not set"}</div><div class="delta">${escapeHtml(f.dba || f.commonName || "Facility profile")}</div></article>
            <article class="card kpi"><div class="label">Building Size</div><div class="value">${squareFeet ? squareFeet.toLocaleString() : "Not set"}</div><div class="delta">Square feet</div></article>
            <article class="card kpi"><div class="label">Average Census</div><div class="value">${averageCensus ? averageCensus.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "Not set"}</div><div class="delta">${escapeHtml(f.censusMonth || "No census month")}</div></article>
            <article class="card kpi"><div class="label">Contracts</div><div class="value">${f.contracts}</div><div class="delta">${escapeHtml(f.region || f.county || "")}</div></article>
            <article class="card kpi"><div class="label">Annual Spend</div><div class="value">${f.spend}</div><div class="delta">Contracted portfolio spend</div></article>
            <article class="card kpi"><div class="label">Cost / Bed</div><div class="value">${costBed}</div><div class="delta">Uses saved spend and beds</div></article>
            <article class="card kpi"><div class="label">Estimated PPD</div><div class="value">${ppd}</div><div class="delta">Annual spend / census / 365</div></article>
            <article class="card kpi"><div class="label">Cost / Sq Ft</div><div class="value">${costSquareFoot}</div><div class="delta">Annual spend / building size</div></article>
          </div>
          <article class="card">
            <div class="panel-head"><h3>Facility Profile</h3><span class="badge blue">Master data</span></div>
            <div class="panel-body metric-list">
              <div class="metric-row"><div><strong>Approved DBA</strong><span>${escapeHtml(f.dba || "Not set")}</span></div><span class="badge ${f.dba ? "green" : "amber"}">${f.dba ? "Saved" : "Missing"}</span></div>
              <div class="metric-row"><div><strong>Legal name</strong><span>${escapeHtml(f.legalName || "Not set")}</span></div><span class="badge ${f.legalName ? "green" : "amber"}">${f.legalName ? "Saved" : "Missing"}</span></div>
              <div class="metric-row"><div><strong>Address</strong><span>${escapeHtml(f.address || "Not set")}</span></div><span class="badge ${f.address ? "green" : "amber"}">${f.address ? "Saved" : "Missing"}</span></div>
              <div class="metric-row"><div><strong>County / Region</strong><span>${escapeHtml([f.county, f.region].filter(Boolean).join(" / ") || "Not set")}</span></div><span class="badge gray">${escapeHtml(f.state || "Profile")}</span></div>
              <div class="metric-row"><div><strong>Bed count</strong><span>${bedCount ? bedCount.toLocaleString() : "Not set"}</span></div><span class="badge ${bedCount ? "green" : "amber"}">${bedCount ? "Saved" : "Missing"}</span></div>
              <div class="metric-row"><div><strong>Building square footage</strong><span>${squareFeet ? squareFeet.toLocaleString() + " sq ft" : "Not set"}</span></div><span class="badge ${squareFeet ? "green" : "amber"}">${squareFeet ? "Saved" : "Missing"}</span></div>
              <div class="metric-row"><div><strong>Average daily census</strong><span>${averageCensus ? averageCensus.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "Not set"}</span></div><span class="badge ${averageCensus ? "green" : "gray"}">${escapeHtml(f.censusMonth || "No data")}</span></div>
              <div class="metric-row"><div><strong>Systems</strong><span>${escapeHtml([f.software, f.apSoftware, f.chart].filter(Boolean).join(" / ") || "Not set")}</span></div><span class="badge gray">Facility</span></div>
              <div class="metric-row"><div><strong>Phone</strong><span>${escapeHtml(f.phone || "Not set")}</span></div><span class="badge ${f.phone ? "green" : "gray"}">${f.phone ? "Saved" : "Optional"}</span></div>
              <div class="metric-row"><div><strong>Aliases</strong><span>${escapeHtml(aliases.join(", ") || "No aliases saved")}</span></div><span class="badge gray">${aliases.length}</span></div>
            </div>
          </article>
          <article class="card">
            <div class="panel-head"><h3>Required Contract Matrix</h3><span class="badge ${requiredRows.some(row => row.missing) ? "amber" : "green"}">${requiredRows.filter(row => !row.missing).length}/${requiredRows.length}</span></div>
            <div class="panel-body metric-list">
              ${requiredRows.map(row => `
                <button class="metric-row matrix-row-button" type="button" onclick="openFacilityMatrixCategory('${jsArg(f.name)}', '${jsArg(row.cat)}')">
                  <div><strong>${escapeHtml(row.cat)}</strong><span>${row.count ? `${row.count} contract${row.count === 1 ? "" : "s"} loaded${row.spend ? ` | ${reportMoney(row.spend)}` : ""}` : "No contract loaded"}</span></div>
                  <span class="badge ${row.missing ? "red" : "green"}">${row.missing ? "Missing" : "Open"}</span>
                </button>
              `).join("")}
            </div>
          </article>
          <article class="card">
            <div class="panel-head"><h3>Contracts at This Facility</h3></div>
            <div class="panel-body table-wrap">
              <table><thead><tr><th>Contract</th><th>Vendor</th><th>Category</th><th>End Date</th><th>Spend</th><th></th></tr></thead>
              <tbody>${facilityContracts.map(c => `<tr><td><strong>${c.name}</strong></td><td>${c.vendor}</td><td>${c.category}</td><td>${endDateDisplay(c.end, c.autoRenewal)}</td><td>${c.spend}</td><td><div class="table-actions"><button class="btn ghost" onclick="openContractSafe('${jsArg(c.id)}', '${jsArg(c.name || c.vendor || "")}')">Open</button><button class="btn danger" onclick="deleteContractRecord('${jsArg(c.id)}')">Delete</button></div></td></tr>`).join("") || `<tr><td colspan="6">No contracts for this facility yet.</td></tr>`}</tbody></table>
            </div>
          </article>
          <div><button class="btn primary" onclick="downloadCsv('facility-${f.name}')">Download Excel</button><button class="btn" onclick="downloadPdf('${f.name} Facility Report')">Download PDF</button></div>
        </div>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    function vendorContractStatus(c = {}) {
      const raw = String(c.contractStatus || c.status || "").toLowerCase();
      if (/replaced|superseded/.test(raw)) return { label: "Replaced", tone: "gray", rank: 3 };
      if (/terminated|cancelled|canceled/.test(raw)) return { label: "Terminated", tone: "red", rank: 4 };
      if (/expired/.test(raw)) return { label: "Expired", tone: "amber", rank: 5 };
      if (/needs review|pending|ai reviewed/.test(raw)) return { label: "Needs Review", tone: "amber", rank: 2 };
      return { label: "Active", tone: "green", rank: 1 };
    }

    function contractSpendDisplay(c = {}) {
      return c.annualCost || c.spend || c.contractValue || c.monthlyCost || c.fee || c.rate || "Needs cost";
    }

    function contractHistorySort(a = {}, b = {}) {
      const statusDelta = vendorContractStatus(a).rank - vendorContractStatus(b).rank;
      if (statusDelta) return statusDelta;
      const dateA = Date.parse(a.startOfServices || a.effectiveDate || a.start || a.signatureDate || a.signedDate || "") || 0;
      const dateB = Date.parse(b.startOfServices || b.effectiveDate || b.start || b.signatureDate || b.signedDate || "") || 0;
      return dateB - dateA || String(a.name || "").localeCompare(String(b.name || ""));
    }

    function vendorHistoryChangeText(c = {}, prior = null) {
      if (!prior) return "Current record";
      const currentCost = contractSpendDisplay(c);
      const priorCost = contractSpendDisplay(prior);
      const changes = [];
      if (contractHasUsableValue(currentCost) && contractHasUsableValue(priorCost) && String(currentCost) !== String(priorCost)) changes.push(`Cost ${priorCost} -> ${currentCost}`);
      if (contractHasUsableValue(c.paymentTerms) && contractHasUsableValue(prior.paymentTerms) && c.paymentTerms !== prior.paymentTerms) changes.push(`Terms ${prior.paymentTerms} -> ${c.paymentTerms}`);
      if (contractHasUsableValue(c.noticePeriod || c.terminationClause) && contractHasUsableValue(prior.noticePeriod || prior.terminationClause) && (c.noticePeriod || c.terminationClause) !== (prior.noticePeriod || prior.terminationClause)) changes.push("Notice changed");
      return changes.length ? changes.join("; ") : "No major change found";
    }

    async function openVendor(name) {
      await ensureCompactContractIndex();
      const v = await ensureVendorCard(name);
      if (!v) {
        showToast("This contract does not have a confirmed vendor card yet. Save a valid vendor name first.");
        return;
      }
      const vendorContracts = [...new Map(contracts
        .filter(c => c?.id && contractHasUsableValue(c.vendor) && !isBadVendorReviewValue(c.vendor))
        .filter(c => sameVendorName(c.vendor, v.name))
        .map(c => [c.id, c])).values()].sort(contractHistorySort);
      const contractUtilityAccounts = vendorContracts
        .filter(contract => contract.utilityAccountNumber || contract.meterNumber || contract.serviceAddress)
        .map(contract => ({
          facility: contract.facility,
          vendor: contract.vendor,
          utilityType: contract.category,
          accountNumber: contract.utilityAccountNumber,
          meterNumber: contract.meterNumber,
          serviceAddress: contract.serviceAddress,
          source: contract.name || contract.uploadedFileName || "Contract OCR"
        }));
      const vendorUtilityAccounts = [
        ...utilityAccounts.filter(account => sameVendorName(account.vendor, v.name)),
        ...contractUtilityAccounts
      ];
      const vendorFacilities = [...new Set(vendorContracts.map(c => c.facility).filter(contractHasUsableValue))];
      const vendorPaymentTerms = [...new Set(vendorContracts.map(c => c.paymentTerms).filter(contractHasUsableValue))];
      const vendorRates = vendorContracts
        .map(c => c.fee || c.rate || c.spend || c.monthlyCost)
        .filter(contractHasUsableValue)
        .slice(0, 5);
      const vendorCategories = [...new Set(vendorContracts.map(c => c.category || c.services).filter(contractHasUsableValue))];
      const activeContracts = vendorContracts.filter(c => vendorContractStatus(c).label === "Active");
      const reviewContracts = vendorContracts.filter(c => vendorContractStatus(c).label === "Needs Review");
      const totalSpend = vendorContracts.reduce((sum, c) => sum + annualizedContractSpend(c), 0);
      const historyRows = vendorContracts.map((c, index) => {
        const status = vendorContractStatus(c);
        const prior = vendorContracts.find((other, otherIndex) =>
          otherIndex > index
          && sameMasterName(other.facility, c.facility)
          && sameMasterName(other.category || other.services, c.category || c.services)
        );
        return { c, status, prior, change: vendorHistoryChangeText(c, prior) };
      });
      document.getElementById("modalTitle").textContent = v.name;
      document.getElementById("modalBody").innerHTML = `
        <div class="grid">
          <div class="grid kpis">
            <article class="card kpi"><div class="label">Active</div><div class="value">${activeContracts.length}</div><div class="delta">${reviewContracts.length} need review</div></article>
            <article class="card kpi"><div class="label">Contracts</div><div class="value">${vendorContracts.length}</div><div class="delta">${vendorFacilities.length} facilities</div></article>
            <article class="card kpi"><div class="label">Annual Spend</div><div class="value">${totalSpend ? reportMoney(totalSpend) : "Needs cost"}</div><div class="delta">${vendorCategories.slice(0, 2).join(", ") || v.category || "No service set"}</div></article>
          </div>
          <article class="card">
            <div class="panel-head"><h3>Vendor Profile</h3><span class="badge blue">Editable</span></div>
            <div class="panel-body field-grid">
              <div class="field"><label>Vendor Name</label><input id="vendorProfileName" list="vendorNameSuggestions" value="${escapeHtml(v.name === "New Vendor" ? "" : v.name)}" oninput="handleVendorNameInput()" placeholder="Vendor name" /><span id="vendorAutofillHelper" style="color:var(--muted);font-size:12px">Search or create vendor.</span></div>
              <div class="field"><label>Legal Name</label><input id="vendorProfileLegalName" value="${escapeHtml(v.legalName || v.name)}" /></div>
              <div class="field"><label>DBA / Alias</label><input id="vendorProfileDba" value="${escapeHtml(v.dba || "")}" /></div>
              <div class="field"><label>Status</label><select id="vendorProfileStatus"><option ${v.status === "Active" ? "selected" : ""}>Active</option><option ${v.status === "Needs Review" ? "selected" : ""}>Needs Review</option><option ${v.status === "Inactive" ? "selected" : ""}>Inactive</option></select></div>
              <div class="field"><label>Category</label><input id="vendorProfileCategory" value="${escapeHtml(v.category || "")}" /></div>
              <div class="field"><label>Mailing Address</label><input id="vendorProfileMailingAddress" value="${escapeHtml(v.mailingAddress === "Needs Vendor Address" ? "" : v.mailingAddress || "")}" /></div>
              <div class="field"><label>Remit / Payment Address</label><input id="vendorProfileRemitAddress" value="${escapeHtml(v.remitAddress || "")}" /></div>
              <div class="field"><label>Primary Contact</label><input id="vendorProfileContact" value="${escapeHtml(v.primaryContact || "")}" /></div>
              <div class="field"><label>Phone</label><input id="vendorProfilePhone" value="${escapeHtml(v.phone || "")}" /></div>
              <div class="field"><label>Email</label><input id="vendorProfileEmail" value="${escapeHtml(v.email || "")}" /></div>
              <div class="field"><label>Website</label><input id="vendorProfileWebsite" value="${escapeHtml(v.website || "")}" /></div>
              <div class="field"><label>Tax ID / W-9</label><input id="vendorProfileTaxId" value="${escapeHtml(v.taxId || "")}" /></div>
              <div class="field"><label>Payment Terms</label><input id="vendorProfilePaymentTerms" value="${escapeHtml(v.paymentTerms || "")}" /></div>
              <div class="field"><label>Insurance Status</label><input id="vendorProfileInsurance" value="${escapeHtml(v.insuranceStatus || v.insurance || "")}" /></div>
              <div class="field"><label>Notes</label><input id="vendorProfileNotes" value="${escapeHtml(v.notes || "")}" /></div>
            </div>
            <div class="panel-body" style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn primary" onclick="saveVendorProfile('${jsArg(v.name)}')">Save Vendor Profile</button>
              <button class="btn danger" onclick="deleteVendorProfile('${jsArg(v.name)}')">Delete Vendor Profile</button>
            </div>
          </article>
          <article class="card">
            <div class="panel-head"><h3>Contracts by Facility</h3><span class="badge ${vendorContracts.length ? "green" : "gray"}">${vendorContracts.length} linked contracts</span></div>
            <div class="panel-body">
              <div class="grid kpis">
                <article class="card kpi"><div class="label">Facilities</div><div class="value">${vendorFacilities.length}</div><div class="delta">${vendorFacilities.slice(0, 2).join(", ") || "None linked"}</div></article>
                <article class="card kpi"><div class="label">Services</div><div class="value">${vendorCategories.length}</div><div class="delta">${vendorCategories.slice(0, 2).join(", ") || "Needs type"}</div></article>
                <article class="card kpi"><div class="label">Terms</div><div class="value">${vendorPaymentTerms.length}</div><div class="delta">${vendorPaymentTerms.slice(0, 1).join(", ") || "Needs terms"}</div></article>
              </div>
            </div>
            <div class="panel-body table-wrap">
              <table>
                <thead><tr><th>Status</th><th>Contract</th><th>Facility</th><th>Service</th><th>Dates</th><th>Money / Terms</th><th>History</th><th></th></tr></thead>
                <tbody>${historyRows.map(({ c, status, change }) => `
                  <tr>
                    <td><span class="badge ${status.tone}">${status.label}</span></td>
                    <td><strong>${escapeHtml(c.name || "Untitled contract")}</strong><br><span style="color:var(--muted);font-size:12px">${escapeHtml(c.id || "")}</span></td>
                    <td>${escapeHtml(c.facility || "Needs facility")}</td>
                    <td>${escapeHtml(c.category || c.services || "Needs type")}</td>
                    <td>${escapeHtml(c.startOfServices || c.effectiveDate || c.start || c.signatureDate || "Needs start")}<br><span style="color:var(--muted);font-size:12px">${escapeHtml(endDateDisplay(c.end || c.endDate, c.autoRenewal))}</span></td>
                    <td><strong>${escapeHtml(contractSpendDisplay(c))}</strong><br><span style="color:var(--muted);font-size:12px">${escapeHtml(c.paymentTerms || c.daysPayable || "Needs payment")}</span></td>
                    <td>${escapeHtml(change)}</td>
                    <td><div class="table-actions"><button class="btn primary" onclick="openContractSafe('${jsArg(c.id)}', '${jsArg(c.name || c.vendor || "")}')">Open</button><button class="btn ghost" onclick="window.open('/api/contracts/${encodeURIComponent(c.id)}/file', '_blank')">${escapeHtml(sourceKindLabel(contractSourceKind(c)))}</button></div></td>
                  </tr>
                `).join("") || `<tr><td colspan="8">No contracts linked to this vendor yet.</td></tr>`}</tbody>
              </table>
            </div>
          </article>
          <article class="card">
            <div class="panel-head"><h3>Accounts / IDs</h3><span class="badge ${vendorUtilityAccounts.length ? "green" : "gray"}">${vendorUtilityAccounts.length} linked</span></div>
            <div class="panel-body metric-list">
              <div class="metric-row"><div><strong>Accounts</strong><span>Account, meter, policy, site, or customer IDs.</span></div><span class="badge blue">IDs</span></div>
              <div class="field">
                <label for="utilityAccountFile">Import utility account CSV</label>
                <input type="file" id="utilityAccountFile" accept=".csv,.txt" />
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="btn primary" onclick="uploadUtilityAccounts()">Import Accounts</button>
                <button class="btn" onclick="downloadUtilityAccountTemplate()">CSV Template</button>
              </div>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Facility</th><th>Type</th><th>Account</th><th>Meter</th><th>Service Address</th><th>Source</th><th></th></tr></thead>
                  <tbody>${vendorUtilityAccounts.map(account => `
                    <tr>
                      <td><strong>${escapeHtml(account.facility || "Unknown facility")}</strong></td>
                      <td>${escapeHtml(account.utilityType || "Utility")}</td>
                      <td>${escapeHtml(account.accountNumber || "No account number")}</td>
                      <td>${escapeHtml(account.meterNumber || "")}</td>
                      <td>${escapeHtml(account.serviceAddress || "")}</td>
                      <td>${escapeHtml(account.source || "CSV / Vendor data")}</td>
                      <td>${account.id ? `<button class="btn danger" onclick="deleteUtilityAccount('${jsArg(account.id)}', '${jsArg(account.accountNumber || account.meterNumber || "this account")}')">Delete</button>` : `<button class="btn ghost" onclick="showToast('This account came from contract OCR. Open the contract to edit or delete it.')">From Contract</button>`}</td>
                    </tr>
                  `).join("") || `<tr><td colspan="7">No utility accounts linked to this vendor yet.</td></tr>`}</tbody>
                </table>
              </div>
            </div>
          </article>
          <div><button class="btn primary" onclick="downloadCsv('vendor-${v.name}')">Download Excel</button><button class="btn" onclick="downloadPdf('${v.name} Vendor Report')">Download PDF</button></div>
        </div>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    function openCategory(category) {
      const matches = contracts.filter(c => sameMasterName(c.category || c.services, category));
      const rows = matches;
      const totalSpendValue = matches.reduce((sum, c) => sum + moneyToNumber(c.annualCost || c.spend || c.contractValue || c.monthlyCost), 0);
      const totalSpend = totalSpendValue ? reportMoney(totalSpendValue) : "Needs cost";
      const missingCount = matches.filter(c => !contractHasUsableValue(c.vendor) || !contractHasUsableValue(c.facility) || !contractHasUsableValue(c.fee || c.spend || c.annualCost)).length;
      document.getElementById("modalTitle").textContent = `${category} Contracts`;
      document.getElementById("modalBody").innerHTML = `
        <div class="grid">
          <div class="grid kpis">
            <article class="card kpi"><div class="label">Contracts Found</div><div class="value">${rows.length}</div><div class="delta">${category} category</div></article>
            <article class="card kpi"><div class="label">Facilities</div><div class="value">${new Set(rows.map(r => r.facility)).size}</div><div class="delta">With this contract type</div></article>
            <article class="card kpi"><div class="label">Spend</div><div class="value" style="font-size:23px">${totalSpend}</div><div class="delta">Approved or pending cost data</div></article>
            <article class="card kpi"><div class="label">Missing Data</div><div class="value">${missingCount}</div><div class="delta">Vendor, facility, or cost gaps</div></article>
          </div>
          <article class="card">
              <div class="panel-head"><h3>Contracts</h3><span class="badge blue">${category}</span></div>
            <div class="panel-body table-wrap">
              <table>
                <thead><tr><th>Contract</th><th>Facility</th><th>Vendor</th><th>End Date</th><th>Spend</th><th>Status</th><th>Risk</th><th></th></tr></thead>
                <tbody>${rows.map(c => `<tr class="clickable-row" onclick="openContractSafe('${jsArg(c.id)}', '${jsArg(c.name || c.vendor || "")}')"><td><strong>${escapeHtml(c.name)}</strong></td><td>${escapeHtml(c.facility)}</td><td>${escapeHtml(c.vendor)}</td><td>${escapeHtml(endDateDisplay(c.end, c.autoRenewal))}</td><td>${escapeHtml(c.spend || c.annualCost || "")}</td><td><span class="badge ${badgeClass(c.status)}">${escapeHtml(c.status)}</span></td><td><span class="badge ${badgeClass(c.risk)}">${escapeHtml(c.risk)}</span></td><td><div class="table-actions"><button class="btn ghost" onclick="event.stopPropagation(); openContractSafe('${jsArg(c.id)}', '${jsArg(c.name || c.vendor || "")}')">Open</button><button class="btn danger" onclick="event.stopPropagation(); deleteContractRecord('${jsArg(c.id)}')">Delete</button></div></td></tr>`).join("") || `<tr><td colspan="8">No live contracts in this category yet.</td></tr>`}</tbody>
              </table>
            </div>
          </article>
          <div><button class="btn primary" onclick="downloadCsv('category-${category}')">Download Excel</button><button class="btn" onclick="downloadPdf('${category} Contracts Report')">Download PDF</button><button class="btn" onclick="closeModal(); openReport('spend-by-service-vendor')">Open Report</button></div>
        </div>
      `;
      document.getElementById("contractModal").classList.add("open");
    }

    function csvText(rows) {
      return rows.map(row => row.map(cell => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    }

    function excelCellText(value) {
      const text = String(value ?? "");
      return escapeHtml(/^[=+\-@]/.test(text) ? `'${text}` : text);
    }

    function excelCellClass(value) {
      const text = String(value ?? "").trim();
      if (/^\$?-?\d[\d,]*(?:\.\d+)?%?$/.test(text) || /^-?\d+(?:\.\d+)?$/.test(text)) return "number";
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(text) || /^\d{4}-\d{2}-\d{2}$/.test(text)) return "date";
      if (/needs|missing|review|unknown|not found|tbd/i.test(text)) return "needs";
      if (/approved|ready|linked|current|complete|yes/i.test(text)) return "ok";
      return "";
    }

    function xlsxEscape(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function xlsxColumnName(index) {
      let name = "";
      let n = index + 1;
      while (n > 0) {
        const mod = (n - 1) % 26;
        name = String.fromCharCode(65 + mod) + name;
        n = Math.floor((n - mod) / 26);
      }
      return name;
    }

    function xlsxCellStyle(value, rowIndex, headerRowIndex) {
      const text = String(value ?? "").trim();
      if (rowIndex === 1) return 1;
      if (rowIndex === 2) return 2;
      if (rowIndex === headerRowIndex + 4) return 3;
      if (/needs|missing|review|unknown|not found|tbd/i.test(text)) return 4;
      if (/approved|ready|linked|current|complete|yes/i.test(text)) return 5;
      if (/^\$-?\d[\d,]*(?:\.\d+)?$/.test(text)) return 7;
      if (/^\$?-?\d[\d,]*(?:\.\d+)?%?$/.test(text) || /^-?\d+(?:\.\d+)?$/.test(text)) return 6;
      return 0;
    }

    function xlsxWorksheetXml(rows = [], options = {}) {
      const safeRows = Array.isArray(rows) ? rows : [];
      const title = options.title || "Contract Operations Report";
      const subtitle = options.subtitle || "Live contract report";
      const headerRowIndex = Number.isFinite(options.headerRowIndex) ? options.headerRowIndex : safeRows.findIndex(row => Array.isArray(row) && row.length >= 3);
      const maxColumns = Math.max(1, ...safeRows.map(row => Array.isArray(row) ? row.length : 1));
      const fullRows = [[title], [subtitle], [], ...safeRows];
      const columnWidths = Array.from({ length: maxColumns }, (_, index) => {
        const longest = fullRows.reduce((max, row) => Math.max(max, String((Array.isArray(row) ? row[index] : "") ?? "").length), 0);
        return Math.min(Math.max(longest + 4, index === 0 ? 34 : 14), 55);
      });
      const cols = columnWidths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
      const mergeEnd = xlsxColumnName(maxColumns - 1);
      const sheetRows = fullRows.map((row, rowIndex) => {
        const cells = Array.isArray(row) ? row : [row];
        const rowNumber = rowIndex + 1;
        const filled = [...cells, ...Array(Math.max(0, maxColumns - cells.length)).fill("")];
        return `<row r="${rowNumber}">${filled.map((cell, cellIndex) => {
          const ref = `${xlsxColumnName(cellIndex)}${rowNumber}`;
          const style = xlsxCellStyle(cell, rowNumber, headerRowIndex);
          const text = /^[=+\-@]/.test(String(cell ?? "")) ? `'${cell}` : cell;
          if (style === 7) {
            const number = Number(String(cell).replace(/[$,]/g, ""));
            return `<c r="${ref}" s="${style}"><v>${Number.isFinite(number) ? number : 0}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr" s="${style}"><is><t>${xlsxEscape(text)}</t></is></c>`;
        }).join("")}</row>`;
      }).join("");
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="${Math.max(1, headerRowIndex + 4)}" topLeftCell="A${Math.max(2, headerRowIndex + 5)}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${cols}</cols>
  <sheetData>${sheetRows}</sheetData>
  <mergeCells count="2"><mergeCell ref="A1:${mergeEnd}1"/><mergeCell ref="A2:${mergeEnd}2"/></mergeCells>
</worksheet>`;
    }

    function xlsxStylesXml() {
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="$#,##0.00;[Red]-$#,##0.00"/></numFmts>
  <fonts count="4"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Cambria"/></font><font><b/><sz val="11"/><color rgb="FF374151"/><name val="Aptos"/></font><font><b/><sz val="10"/><color rgb="FF111827"/><name val="Aptos"/></font></fonts>
  <fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF111827"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF8E6"/></patternFill></fill></fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD7DDE8"/></left><right style="thin"><color rgb="FFD7DDE8"/></right><top style="thin"><color rgb="FFD7DDE8"/></top><bottom style="thin"><color rgb="FFD7DDE8"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf><xf numFmtId="164" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
    }

    function isMoneyColumnLabel(value = "") {
      return /\b(fee|rate|cost|spend|amount|price|charge|total|ppd|per bed|invoice)\b/i.test(String(value || ""));
    }

    function formatReportMoneyRows(rows = []) {
      let activeHeader = [];
      return (Array.isArray(rows) ? rows : []).map(row => {
        if (!Array.isArray(row)) return row;
        const headerLike = row.length >= 3 && row.some(cell => isMoneyColumnLabel(cell)) && row.every(cell => !String(cell || "").match(/\$\s*\d/));
        if (headerLike) {
          activeHeader = row;
          return row;
        }
        return row.map((cell, index) => {
          const header = activeHeader[index] || row[index - 1] || "";
          return isMoneyColumnLabel(header) ? formatMoneyText(cell) : cell;
        });
      });
    }

    function crc32(bytes) {
      const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
      }));
      let crc = 0xffffffff;
      for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
      return (crc ^ 0xffffffff) >>> 0;
    }

    function writeUint16(bytes, value) {
      bytes.push(value & 0xff, (value >>> 8) & 0xff);
    }

    function writeUint32(bytes, value) {
      bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
    }

    function createZipBlob(files = []) {
      const encoder = new TextEncoder();
      const output = [];
      const central = [];
      let offset = 0;
      files.forEach(file => {
        const nameBytes = encoder.encode(file.name);
        const data = encoder.encode(file.content);
        const crc = crc32(data);
        writeUint32(output, 0x04034b50);
        writeUint16(output, 20);
        writeUint16(output, 0);
        writeUint16(output, 0);
        writeUint16(output, 0);
        writeUint16(output, 0);
        writeUint32(output, crc);
        writeUint32(output, data.length);
        writeUint32(output, data.length);
        writeUint16(output, nameBytes.length);
        writeUint16(output, 0);
        output.push(...nameBytes, ...data);
        writeUint32(central, 0x02014b50);
        writeUint16(central, 20);
        writeUint16(central, 20);
        writeUint16(central, 0);
        writeUint16(central, 0);
        writeUint16(central, 0);
        writeUint16(central, 0);
        writeUint32(central, crc);
        writeUint32(central, data.length);
        writeUint32(central, data.length);
        writeUint16(central, nameBytes.length);
        writeUint16(central, 0);
        writeUint16(central, 0);
        writeUint16(central, 0);
        writeUint16(central, 0);
        writeUint32(central, 0);
        writeUint32(central, offset);
        central.push(...nameBytes);
        offset = output.length;
      });
      const centralOffset = output.length;
      output.push(...central);
      writeUint32(output, 0x06054b50);
      writeUint16(output, 0);
      writeUint16(output, 0);
      writeUint16(output, files.length);
      writeUint16(output, files.length);
      writeUint32(output, central.length);
      writeUint32(output, centralOffset);
      writeUint16(output, 0);
      return new Blob([new Uint8Array(output)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    }

    function excelWorkbookBlob(rows = [], options = {}) {
      const worksheet = xlsxWorksheetXml(rows, options);
      return createZipBlob([
        { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
        { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
        { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>` },
        { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
        { name: "xl/worksheets/sheet1.xml", content: worksheet },
        { name: "xl/styles.xml", content: xlsxStylesXml() }
      ]);
    }

    function excelWorksheetHtml(rows = [], options = {}) {
      const safeRows = Array.isArray(rows) ? rows : [];
      const title = options.title || "Contract Operations Report";
      const subtitle = options.subtitle || "Live contract report";
      const headerRowIndex = Number.isFinite(options.headerRowIndex) ? options.headerRowIndex : safeRows.findIndex(row => Array.isArray(row) && row.length >= 3);
      const maxColumns = Math.max(1, ...safeRows.map(row => Array.isArray(row) ? row.length : 1));
      const columnWidths = Array.from({ length: maxColumns }, (_, index) => {
        const longest = safeRows.reduce((max, row) => Math.max(max, String((Array.isArray(row) ? row[index] : "") ?? "").length), 0);
        return Math.min(Math.max(longest * 7.4, index === 0 ? 260 : 120), 420);
      });
      return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head>
  <meta charset="utf-8" />
  <!--[if gte mso 9]><xml>
    <x:ExcelWorkbook>
      <x:ExcelWorksheets>
        <x:ExcelWorksheet>
          <x:Name>Report</x:Name>
          <x:WorksheetOptions>
            <x:FreezePanes/>
            <x:FrozenNoSplit/>
            <x:SplitHorizontal>${Math.max(1, headerRowIndex + 2)}</x:SplitHorizontal>
            <x:TopRowBottomPane>${Math.max(1, headerRowIndex + 2)}</x:TopRowBottomPane>
            <x:ActivePane>2</x:ActivePane>
            <x:Panes><x:Pane><x:Number>3</x:Number></x:Pane><x:Pane><x:Number>2</x:Number></x:Pane></x:Panes>
            <x:ProtectContents>False</x:ProtectContents>
            <x:ProtectObjects>False</x:ProtectObjects>
            <x:ProtectScenarios>False</x:ProtectScenarios>
          </x:WorksheetOptions>
        </x:ExcelWorksheet>
      </x:ExcelWorksheets>
    </x:ExcelWorkbook>
  </xml><![endif]-->
  <style>
    body { font-family: Aptos, Calibri, Arial, sans-serif; color: #111827; background: #ffffff; }
    table { border-collapse: collapse; width: 100%; }
    col { mso-width-source: userset; }
    td, th { border: 1px solid #d7dde8; padding: 8px 10px; font-size: 11.5pt; vertical-align: top; mso-number-format: "\\@"; white-space: normal; line-height: 1.35; }
    .title td { background: #111827; color: #ffffff; font-family: "Times New Roman", Cambria, Georgia, serif; font-size: 18pt; font-weight: 700; border-color: #111827; padding: 14px 16px; letter-spacing: 0; }
    .subtitle td { background: #f3f4f6; color: #374151; font-size: 10.5pt; font-weight: 600; border-color: #d1d5db; padding: 9px 16px; }
    .meta-label { background: #f8fafc; color: #374151; font-weight: 700; width: 180px; }
    .meta-value { background: #ffffff; color: #111827; font-weight: 600; }
    .spacer td { border: 0; height: 14px; background: #ffffff; }
    .header th { background: #e5e7eb; color: #111827; font-weight: 700; text-transform: uppercase; font-size: 10pt; border-top: 2px solid #111827; border-bottom: 2px solid #111827; }
    .row-even td { background: #ffffff; }
    .row-odd td { background: #f9fafb; }
    .number { text-align: right; color: #0f172a; font-weight: 600; }
    .date { color: #334155; }
    .needs { color: #8f5b12; background: #fff8e6 !important; font-weight: 700; }
    .ok { color: #08724e; font-weight: 700; }
  </style>
</head>
<body>
  <table>
    <colgroup>${columnWidths.map(width => `<col style="width:${width}px" />`).join("")}</colgroup>
    <tr class="title"><td colspan="${maxColumns}">${excelCellText(title)}</td></tr>
    <tr class="subtitle"><td colspan="${maxColumns}">${excelCellText(subtitle)}</td></tr>
    ${safeRows.map((row, rowIndex) => {
      const cells = Array.isArray(row) ? row : [row];
      const filled = [...cells, ...Array(Math.max(0, maxColumns - cells.length)).fill("")];
      const isSpacer = filled.every(cell => String(cell ?? "").trim() === "");
      const isHeader = rowIndex === headerRowIndex;
      const isMeta = rowIndex < headerRowIndex && filled.filter(cell => String(cell ?? "").trim()).length <= 3 && !isSpacer;
      const className = isSpacer ? "spacer" : isMeta ? "meta" : isHeader ? "header" : rowIndex % 2 ? "row-odd" : "row-even";
      const tag = isHeader ? "th" : "td";
      return `<tr class="${className}">${filled.map((cell, cellIndex) => {
        const cellClass = isMeta ? (cellIndex === 0 ? "meta-label" : "meta-value") : excelCellClass(cell);
        return `<${tag} class="${cellClass}">${excelCellText(cell)}</${tag}>`;
      }).join("")}</tr>`;
    }).join("")}
  </table>
</body>
</html>`;
    }

    function saveExcelFile(rows, filename, message = "Excel download created.", options = {}) {
      const cleanFilename = filename.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
      const formattedRows = formatReportMoneyRows(rows);
      const blob = excelWorkbookBlob(formattedRows, {
        title: options.title || filename.replace(/[-_]+/g, " "),
        subtitle: options.subtitle || "Contract Operations report",
        headerRowIndex: options.headerRowIndex
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${cleanFilename}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast(message);
    }

    function saveCsvFile(rows, filename, message = "Excel download created as CSV.") {
      const csv = `\uFEFF${csvText(rows)}`;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${filename.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast(message);
    }

    function downloadAllReportsCsv() {
      const rows = [["Report Pack", "Contract Operations"], ["Created", new Date().toLocaleString()], ["Reports Included", reportDefinitions.length], []];
      reportDefinitions.forEach(reportDefinition => {
        const report = buildReport(reportDefinition.id, { applyFilters: false });
        rows.push([report.name], [reportBusinessQuestion(report)], [reportDataRule(report)], report.headers);
        rows.push(...report.rows);
        rows.push([], []);
      });
      saveExcelFile(rows, "all-contract-reports-excel-pack", `Downloaded ${reportDefinitions.length} styled reports for Excel.`, {
        title: "Contract Operations - All Reports Pack",
        subtitle: "Combined live export. Each report section has its own header."
      });
    }

    async function downloadReportCsv(reportId = activeReportId) {
      if (backendOnline) {
        showToast("Preparing live Excel report...");
        await loadReportsPageData({ force: true }).catch(error => {
          console.warn("Report refresh failed; using the latest loaded data.", error);
        });
      }
      const report = buildReport(reportId);
      if (!report.rows.length) {
        openReport(reportId);
        showToast("No rows to download yet. Opened the report so you can see what data is missing.");
        return;
      }
      const rows = [
        ["Report", report.name],
        ["Created", new Date().toLocaleString()],
        ["Rows", report.rows.length],
        ["Question", reportBusinessQuestion(report)],
        ["Data Used", reportDataRule(report)],
        ...report.summary.map(item => [item[0], item[1], item[2]]),
        [],
        report.headers,
        ...report.rows
      ];
      const headerRowIndex = rows.findIndex(row => row === report.headers);
      saveExcelFile(rows, `${report.name}-excel`, `Downloaded ${report.name} as a styled Excel file.`, {
        title: report.name,
        subtitle: reportBusinessQuestion(report),
        headerRowIndex
      });
    }

    function downloadCsv(type) {
      let rows;
      if (type === "reports") {
        return downloadReportCsv(activeReportId);
      } else if (type === "facilities" || type.startsWith("facility-")) {
        const selectedFacility = type.startsWith("facility-") ? type.replace("facility-", "") : "";
        const facilityRows = selectedFacility
          ? facilities.filter(f => sameMasterName(f.name, selectedFacility))
          : facilities;
        rows = [["Facility","Region","Beds","Contracts","Annual Spend","Cost Per Bed","Address","DBA","Legal Name","Aliases"], ...facilityRows.map(f => [
          f.name,
          f.region || f.county || "",
          f.beds || "",
          f.contracts || contracts.filter(c => sameMasterName(c.facility, f.name)).length,
          f.spend || reportMoney(contracts.filter(c => sameMasterName(c.facility, f.name)).reduce((sum, c) => sum + annualizedContractSpend(c), 0)),
          costPerBed(f.spend, f.beds),
          f.address || "",
          f.dba || f.approvedDba || "",
          f.legalName || "",
          Array.isArray(f.aliases) ? f.aliases.join("; ") : (f.aliases || "")
        ])];
      } else if (type === "vendors" || type.startsWith("vendor-")) {
        const selectedVendor = type.startsWith("vendor-") ? type.replace("vendor-", "") : "";
        const vendorRows = selectedVendor
          ? vendorsData.filter(v => sameMasterName(v.name, selectedVendor))
          : vendorsData;
        rows = [["Vendor","Legal Name","DBA","Status","Mailing Address","Remit Address","Contact","Phone","Email","Website","Tax ID","Payment Terms","Facilities","Contracts","Annual Spend","Insurance","Issues","Category"], ...vendorRows.map(v => [v.name, v.legalName || v.name, v.dba || "", v.status || "", v.mailingAddress || "Needs Vendor Address", v.remitAddress || "", v.primaryContact || "", v.phone || "", v.email || "", v.website || "", v.taxId || "", v.paymentTerms || "", v.facilities, v.contracts, v.spend, v.insurance, v.issues, v.category])];
      } else if (type === "categories") {
        rows = [["Category","Contracts","Contract","Facility"], ...categories.map(cat => {
          const match = contracts.find(c => c.category === cat);
          return [cat, contracts.filter(c => c.category === cat).length, match?.name || "None indexed yet", match?.facility || "Needs upload"];
        })];
      } else if (type.startsWith("category-")) {
        const cat = type.replace("category-", "");
        const matches = contracts.filter(c => c.category === cat);
        rows = [["Facility","Services","Vendor","Contract Status","Signature Date","Start of Services","Initial Contract Length","Termination","Auto Renewal","Payment Terms","Days Payable","Fee","Monthly Cost","Cost Bed/Month","Quantity of Services","Contract"], ...(matches.length ? matches : contracts).map(c => [c.facility, c.services || c.category, c.vendor, c.contractStatus || c.status, c.signatureDate || c.signedDate || "", c.startOfServices || c.start || "", c.initialContractLength || "", c.termination || c.terminationClause || "Unknown", c.autoRenewal || "Unknown", c.paymentTerms || "", c.daysPayable || "", c.fee || c.rate || c.spend || "", c.monthlyCost || "", c.costBedMonth || "", c.quantityOfServices || "", c.name])];
      } else if (type === "exceptions") {
        rows = [["Issue","Contract","Facility","Impact","Owner","Due Date","Status","Action"], ...exceptions.map(ex => [
          ex.issue || "Exception",
          ex.contract || "",
          ex.facility || "",
          ex.impact || "",
          ex.owner || "",
          ex.due || "",
          ex.status || "Open",
          ex.contractId ? "Open linked contract" : "Find contract"
        ])];
      } else if (type === "weather") {
        rows = [["Date","Facility","Weather","Snowfall","Precipitation","Temperature High","Temperature Low","Wind Max","Invoice","Contract Rule","Status","Source"], ...weatherChecks.map(w => [
          w.date || "",
          w.facility || "",
          w.weather || "",
          w.snowfall || "",
          w.precipitation || "",
          w.temperatureHigh ?? "",
          w.temperatureLow ?? "",
          w.windMaxMph ?? "",
          w.invoice || "",
          w.rule || "",
          w.status || "",
          w.source || "Open-Meteo"
        ])];
      } else if (type === "invoice-review") {
        const liveInvoiceRows = invoiceUploads.map(invoice => [
          invoice.name || invoice.uploadedFileName || "Uploaded invoice",
          invoice.vendor || "",
          invoice.facility || invoice.costPerBed?.facility || "",
          invoice.invoiceDate || "",
          invoice.total || "",
          invoice.status || "Checked",
          invoice.matchedContractName || "",
          invoice.matchConfidence || invoice.confidence || "",
          invoice.paymentTerms || "",
          invoice.contractRate || "",
          invoice.costPerBed?.beds || "",
          invoice.costPerBed?.costPerBedLabel || invoice.costPerBed?.source || "",
          invoice.reviewNotes || ""
        ]);
        const fallbackRows = invoiceComparison.map(row => [
          row.line || "",
          "",
          "",
          "",
          row.charge || "",
          row.status || "",
          row.rule || "",
          "",
          "",
          row.expected || "",
          "",
          row.variance || "",
          ""
        ]);
        rows = [["Invoice","Vendor","Facility","Invoice Date","Invoice Total","Status","Matched Contract","Confidence","Payment Terms","Contract Rate","Beds","Cost / Bed","Notes"], ...(liveInvoiceRows.length ? liveInvoiceRows : fallbackRows)];
      } else if (type === "clauses") {
        const term = String(document.getElementById("clauseSearch")?.value || "").toLowerCase().trim();
        const riskType = String(document.getElementById("clauseRiskType")?.value || "").toLowerCase().trim();
        const riskLevel = String(document.getElementById("clauseRiskLevel")?.value || "").toLowerCase().trim();
        const riskTokens = riskType.split(/\s+/).filter(Boolean);
        const filteredClauses = clauses.filter(c => {
          const haystack = Object.values(c).join(" ").toLowerCase();
          const typeOk = !riskTokens.length || riskTokens.some(token => haystack.includes(token));
          const levelOk = !riskLevel || String(c.risk || "").toLowerCase().includes(riskLevel) || (riskLevel === "review" && /review|medium|high|needs/i.test(String(c.risk || "")));
          const textOk = !term || haystack.includes(term);
          return typeOk && levelOk && textOk;
        });
        rows = [["Clause Type","Contract","Facility","Snippet","Risk","Source","Action"], ...filteredClauses.map(c => [
          c.type || "Clause",
          c.contract || "",
          c.facility || "",
          c.snippet || "",
          c.risk || "",
          c.source || "",
          "Verify source"
        ])];
      } else {
        rows = [["Facility","Services","Vendor","Contract Status","Signature Date","Start of Services","Initial Contract Length","Termination","Auto Renewal","Payment Terms","Days Payable","Fee","Monthly Cost","Cost Bed/Month","Quantity of Services","Contract"], ...contracts.map(c => [c.facility, c.services || c.category, c.vendor, c.contractStatus || c.status, c.signatureDate || c.signedDate || "", c.startOfServices || c.start || "", c.initialContractLength || "", c.termination || c.terminationClause || "Unknown", c.autoRenewal || "Unknown", c.paymentTerms || "", c.daysPayable || "", c.fee || c.rate || c.spend || "", c.monthlyCost || "", c.costBedMonth || "", c.quantityOfServices || "", c.name])];
      }
      saveExcelFile(rows, `${type}-report`, "Styled Excel report downloaded.", {
        title: `${type.replace(/[-_]+/g, " ")} report`,
        subtitle: "Contract Operations export",
        headerRowIndex: 0
      });
    }

    function downloadPdf(title) {
      document.title = title;
      window.print();
      showToast("PDF export uses the browser print/save dialog.");
      setTimeout(() => document.title = "Contract Operations", 250);
    }

    function runAiExample(question) {
      switchSection("ai");
      document.getElementById("aiSearchInput").value = question;
      renderAiAnswer(question);
    }

    async function submitContractRoomSearch(question = "") {
      const value = String(question || document.getElementById("globalSearch")?.value || "").trim();
      const finalQuestion = value || "";
      if (!finalQuestion) {
        switchSection("contracts");
        showToast("Contract Search is open. Type a vendor, facility, service, fee, date, or OCR word.");
        return;
      }
      const globalInput = document.getElementById("globalSearch");
      const contractInput = document.getElementById("contractSearch");
      const scopeInput = document.getElementById("contractSearchScope");
      if (globalInput) globalInput.value = finalQuestion;
      if (contractInput) contractInput.value = finalQuestion;
      if (scopeInput) scopeInput.value = "all";
      contractFinderShowAll = false;
      activeContractView = "search";
      currentPage = 1;
      switchSection("contracts");
      renderContracts();
      await refreshContractBackendSearch({ force: true });
      renderContracts();
      showToast("Contract search complete.");
    }

    function renderAiAnswer(question) {
      document.getElementById("aiAnswers").innerHTML = `
        <div class="metric-row"><div><strong>Answer for: ${question}</strong><span>No live contract records are loaded yet. Import Excel or upload PDFs to enable search answers.</span></div><span class="badge gray">Empty</span></div>
      `;
    }

    async function checkShareSyncStatus() {
      const badge = document.getElementById("shareSyncStatusBadge");
      const card = document.getElementById("shareSyncStatusCard");
      if (!badge || !card) return;
      badge.textContent = "Checking";
      badge.className = "badge gray";
      card.innerHTML = `<div class="metric-row"><div><strong>Checking ShareSync...</strong><span>Testing the configured folder now.</span></div><span class="badge gray">Wait</span></div>`;
      try {
        const health = await apiJson("/api/sharesync-health");
        const ok = health.configured && health.exists && health.readable && health.writable;
        badge.textContent = ok ? "Connected" : "Needs Check";
        badge.className = `badge ${ok ? "green" : "amber"}`;
        const detailsId = "shareSyncConnectionDetails";
        card.innerHTML = `
          <div class="metric-row">
            <div>
              <strong>${ok ? "Ready to save approved contracts" : "ShareSync needs attention"}</strong>
              <span>${ok ? `${(health.topLevelFolders || []).length} folders available for filing.` : escapeHtml(health.root || "Set the ShareSync folder in Admin Settings.")}</span>
            </div>
            <span class="badge ${ok ? "green" : "amber"}">${ok ? "Ready" : "Check"}</span>
          </div>
          <button class="btn ghost" type="button" onclick="toggleShareSyncDetails()">Show details</button>
          <div id="${detailsId}" style="display:none;margin-top:10px">
            <div class="metric-row"><div><strong>Folder</strong><span>${escapeHtml(health.root || "No ShareSync folder configured")}</span></div><span class="badge ${health.exists ? "green" : "red"}">${health.exists ? "Found" : "Missing"}</span></div>
            <div class="metric-row"><div><strong>Read</strong><span>${health.readable ? "Existing folders are visible." : "Folder read is blocked."}</span></div><span class="badge ${health.readable ? "green" : "red"}">${health.readable ? "OK" : "Blocked"}</span></div>
            <div class="metric-row"><div><strong>Save</strong><span>${health.writable ? "Approved PDFs can be filed." : "Saving into ShareSync is blocked."}</span></div><span class="badge ${health.writable ? "green" : "red"}">${health.writable ? "OK" : "Blocked"}</span></div>
            <div class="metric-row"><div><strong>Folders</strong><span>${(health.topLevelFolders || []).slice(0, 8).map(escapeHtml).join(", ") || "No folders listed yet."}</span></div><span class="badge blue">${(health.topLevelFolders || []).length}</span></div>
          </div>
        `;
      } catch (error) {
        badge.textContent = "Not Ready";
        badge.className = "badge red";
        card.innerHTML = `<div class="metric-row"><div><strong>ShareSync check failed</strong><span>Restart the black server window, then check again. The backend endpoint did not answer.</span></div><span class="badge red">Failed</span></div>`;
      }
    }

    window.checkShareSyncStatus = checkShareSyncStatus;
    window.toggleShareSyncDetails = function toggleShareSyncDetails() {
      const details = document.getElementById("shareSyncConnectionDetails");
      if (!details) return;
      details.style.display = details.style.display === "none" ? "" : "none";
    };

    async function repairPdfLinks() {
      const button = document.getElementById("repairPdfLinksButton");
      if (button) {
        button.disabled = true;
        button.textContent = "Repairing...";
      }
      try {
        const result = await apiJson("/api/contracts/repair-pdf-links", { method: "POST" });
        await loadBackendData();
        renderSectionContent(activeSectionId());
        showToast(`PDF links checked: ${result.alreadyLinked || 0} already linked, ${result.linked || 0} repaired, ${result.missing || 0} missing.`);
      } catch (error) {
        showToast(error.message || "PDF link repair failed.");
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = "Repair PDF Links";
        }
      }
    }

    async function refileShareSyncRecords() {
      const button = document.getElementById("refileShareSyncButton");
      const card = document.getElementById("shareSyncStatusCard");
      if (button) {
        button.disabled = true;
        button.textContent = "Refiling...";
      }
      try {
        const result = await apiJson("/api/contracts/refile-sharesync", { method: "POST" });
        markLiveDataDirty();
        await loadBackendData();
        renderSectionContent(activeSectionId());
        if (card) {
          card.insertAdjacentHTML("beforeend", `
            <div class="metric-row">
              <div>
                <strong>ShareSync filing cleanup</strong>
                <span>${escapeHtml(String(result.refiled || 0))} refiled, ${escapeHtml(String(result.skipped || 0))} skipped, ${escapeHtml(String(result.failed || 0))} failed. Original files are preserved.</span>
              </div>
              <span class="badge ${result.failed ? "amber" : "green"}">${result.failed ? "Review" : "Done"}</span>
            </div>
          `);
        }
        showToast(`ShareSync cleanup: ${result.refiled || 0} refiled, ${result.skipped || 0} skipped, ${result.failed || 0} failed.`);
      } catch (error) {
        showToast(error.message || "ShareSync filing cleanup failed.");
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = "Refile Clean Records";
        }
      }
    }

    async function runShareSyncProofTest() {
      const button = document.getElementById("shareSyncProofButton");
      const card = document.getElementById("shareSyncStatusCard");
      if (button) {
        button.disabled = true;
        button.textContent = "Checking...";
      }
      try {
        const result = await apiJson("/api/sharesync-proof");
        const ready = result.ready || (result.totalApproved && result.proven === result.totalApproved);
        if (card) {
          card.insertAdjacentHTML("beforeend", `
            <div class="metric-row">
              <div>
                <strong>Approved PDF proof</strong>
                <span>${escapeHtml(String(result.proven || 0))} proven in ShareSync, ${escapeHtml(String(result.missing || 0))} missing, ${escapeHtml(String(result.outsideRoot || 0))} outside ShareSync. Root: ${escapeHtml(result.shareSyncRoot || "Not configured")}</span>
              </div>
              <span class="badge ${ready ? "green" : "amber"}">${ready ? "Passed" : "Review"}</span>
            </div>
          `);
        }
        showToast(`ShareSync proof: ${result.proven || 0} proven, ${result.missing || 0} missing.`);
      } catch (error) {
        showToast(error.message || "ShareSync proof test failed.");
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = "Proof Test";
        }
      }
    }

    window.repairPdfLinks = repairPdfLinks;
    window.refileShareSyncRecords = refileShareSyncRecords;
    window.runShareSyncProofTest = runShareSyncProofTest;

    function initFilters(active = activeSectionId()) {
      const facilitySelect = document.getElementById("facilityFilter");
      const facilityOptions = facilityMasterOptions();
      if (facilitySelect && (active === "contracts" || active === "reports")) {
        const value = facilitySelect.value;
        facilitySelect.innerHTML = `<option value="">${facilityOptions.length ? "All facilities" : "No facility master loaded"}</option>` + facilityOptions.map(f => optionHtml(f.name, facilityDropdownLabel(f), sameMasterName(f.name, value))).join("");
        facilitySelect.value = value;
      }
      const financeFacilitySelect = document.getElementById("financeFacilityFilter");
      if (financeFacilitySelect && active === "finance") {
        const current = financeFacilitySelect.value || "";
        const scope = userFacilityScope();
        const financeSource = financeContractData.length ? financeContractData : dashboardContracts();
        const financeContractFacilities = financeSource
          .filter(contractInUserScope)
          .flatMap(contract => contractFacilityNames(contract))
          .filter(name => name && !/^(needs classification|unknown|not found|all facilities)$/i.test(name))
          .map(name => facilityRecordForName(name) || { name });
        const financeFacilityOptions = dedupeRecords([
          ...facilityOptions,
          ...financeContractFacilities
        ], "name")
          .filter(f => f.name)
          .filter(f => scope.all || scope.facilities.some(name => sameMasterName(name, f.name) || facilityNamesMatch(name, f.name)))
          .sort((a, b) => a.name.localeCompare(b.name));
        const hasCurrent = current && financeFacilityOptions.some(f => sameMasterName(f.name, current));
        financeFacilitySelect.innerHTML = `<option value="">${scope.all ? "All Facilities" : "Assigned Facilities"}</option>` + financeFacilityOptions.map(f => optionHtml(f.name, f.name, sameMasterName(f.name, current))).join("");
        if (hasCurrent) financeFacilitySelect.value = current;
      }
      const financeServiceSelect = document.getElementById("financeServiceFilter");
      if (financeServiceSelect && active === "finance") {
        const value = financeServiceSelect.value;
        financeServiceSelect.innerHTML = categoryOptionsHtml(value, "All Services");
        financeServiceSelect.value = value;
      }
      const financeVendorFilter = document.getElementById("financeVendorFilter");
      if (financeVendorFilter && active === "finance") {
        const value = financeVendorFilter.value;
        const financeVendorList = document.getElementById("financeVendorFilterList");
        const vendorOptions = vendorSuggestionOptions(value, value ? 80 : 60);
        if (financeVendorList) financeVendorList.innerHTML = vendorOptions.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml([v.category, v.mailingAddress, v.phone, v.email].filter(Boolean).join(" | "))}</option>`).join("");
        financeVendorFilter.value = value;
      }
      const vendorFilter = document.getElementById("vendorFilter");
      if (vendorFilter && (active === "contracts" || active === "reports")) {
        const value = vendorFilter.value;
        const vendorOptions = vendorSuggestionOptions(value, value ? 50 : 25);
        const vendorFilterList = document.getElementById("vendorFilterList");
        if (vendorFilterList) vendorFilterList.innerHTML = vendorOptions.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml([v.category, v.mailingAddress, v.phone, v.email].filter(Boolean).join(" | "))}</option>`).join("");
        vendorFilter.value = value;
      }
      const hintFacility = document.getElementById("hintFacility");
      if (hintFacility && active === "upload") {
        const value = hintFacility.value;
        hintFacility.innerHTML = `<option value="">${facilityOptions.length ? "Let OCR read it" : "Upload facility master first"}</option>` + facilityOptions.map(f => optionHtml(f.name, facilityDropdownLabel(f), sameMasterName(f.name, value))).join("");
        hintFacility.value = value;
      }
      const hintVendor = document.getElementById("hintVendor");
      if (hintVendor && active === "upload") {
        const value = hintVendor.value;
        const vendorOptions = vendorSuggestionOptions(value, value ? 50 : 25);
        const hintVendorList = document.getElementById("hintVendorList");
        if (hintVendorList) hintVendorList.innerHTML = vendorOptions.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml([v.category, v.mailingAddress, v.phone, v.email].filter(Boolean).join(" | "))}</option>`).join("");
        hintVendor.value = value;
      }
      const categoryFilter = document.getElementById("categoryFilter");
      const hintCategory = document.getElementById("hintCategory");
      if (categoryFilter && (active === "contracts" || active === "reports")) {
        const value = categoryFilter.value;
        categoryFilter.innerHTML = categoryOptionsHtml(value, "All categories");
        categoryFilter.value = value;
      }
      if (hintCategory && active === "upload") {
        const value = hintCategory.value;
        hintCategory.innerHTML = categoryOptionsHtml(value, "Optional");
        hintCategory.value = value;
      }
    }

    function refreshVendorSuggestions(inputId, datalistId) {
      const input = document.getElementById(inputId);
      const list = document.getElementById(datalistId);
      if (!input || !list) return;
      const value = input.value || "";
      const options = vendorSuggestionOptions(value, value ? 50 : 25);
      list.innerHTML = options.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml([v.category, v.mailingAddress, v.phone, v.email].filter(Boolean).join(" | "))}</option>`).join("");
    }

    window.refreshVendorSuggestions = refreshVendorSuggestions;

    try {
      Object.assign(window, {
        approveInvoiceCheck,
        approveReviewFields,
        appendTemplateTerm,
        applyPendingBuilderDraftToUploadForm,
        checkReviewFieldAgainstSource,
        closeModal,
        currentTemplateDraftValues,
        dashboardOpenAlert,
        dashboardOpenAttention,
        dashboardOpenContractTarget,
        dashboardOpenDataGap,
        dashboardOpenRenewals,
        handleReviewVendorInput,
        copySelectedOcrTextForCorrection,
        deleteContractRecord,
        deleteFacilityProfile,
        deleteReviewField,
        deleteUtilityAccount,
        deleteVendorProfile,
        downloadCsv,
        downloadPdf,
        downloadReportCsv,
        downloadTemplateContractWord,
        downloadUtilityAccountTemplate,
        markFeeLineApproved,
        openCategory,
        openContract,
        openContractSafe,
        openContractEmail,
        openTemplateContractModal,
        openFacility,
        openFacilityEditor,
        openInvoiceReviewModal,
        openAdjacentReviewField,
        openFirstIncompleteReviewField,
        openPdfCompareModal,
        openReviewJob,
        openVendor,
        renderCategories,
        renderContractBuilderPage,
        renderReports,
        runReviewOcrSearch,
        runOcrJob,
        resetFieldSourceSearch,
        resetReviewOcrSearch,
        applyTemplateDefaults,
        previewTemplateContractDraft,
        printTemplateContractPreview,
        refreshLiveDataNow,
        loadReviewQueuePage,
        refreshTemplateStandardLanguage,
        resetAdminUserForm,
        saveReviewCorrectionAndNext,
        saveReviewCorrectionFromModal,
        saveReviewServiceToMaster,
        saveTemplateContractDraft,
        saveTemplateContractPreview,
        saveTemplateContractPreviewAndUpload,
        requestPasswordReset,
        saveFacilityProfileFromModal,
        setAdminScopePreset,
        saveOcrTextCorrection,
        saveReviewFieldInline,
        sendUserInvite,
        saveVendorProfile,
        showContractFeeSource,
        showContractOcrFromInvoice,
        showForgotPasswordPanel,
        showFullOcrText,
        showInvoiceOcrText,
        showReviewFeeSource,
        showToast,
        syncAdminFacilityScopeFromChecks,
        syncTemplateFacilityProfile,
        switchSection,
        toggleReviewServiceOther,
        useSelectedOcrTextForField
      });
    } catch (error) {
      console.warn("Global action export skipped; app event handlers remain active.", error);
    }

    document.addEventListener("click", event => {
      const moreMenuAction = event.target.closest(".more-menu .btn");
      if (moreMenuAction) {
        const menu = moreMenuAction.closest("details.inline-more");
        setTimeout(() => { if (menu) menu.open = false; }, 0);
      } else if (!event.target.closest("details.inline-more")) {
        document.querySelectorAll("details.inline-more[open]").forEach(menu => { menu.open = false; });
      }
      const reviewJobButton = event.target.closest("[data-open-review-job]");
      if (reviewJobButton) {
        event.preventDefault();
        event.stopPropagation();
        if (reviewJobButton.dataset.closeModalBefore === "1") closeModal();
        openReviewJob(reviewJobButton.dataset.openReviewJob);
        return;
      }
      const pdfPreviewButton = event.target.closest("[data-load-contract-pdf-preview]");
      if (pdfPreviewButton) {
        event.preventDefault();
        event.stopPropagation();
        openPdfCompareModal(
          pdfPreviewButton.dataset.loadContractPdfPreview,
          pdfPreviewButton.dataset.pdfTitle || activeReviewContractName || "Original contract file",
          pdfPreviewButton.dataset.sourceKind || "pdf"
        );
        return;
      }
      const reviewOcrFindButton = event.target.closest("#reviewOcrFindButton");
      if (reviewOcrFindButton) {
        event.preventDefault();
        event.stopPropagation();
        runReviewOcrSearch();
        return;
      }
      const reviewOcrClearButton = event.target.closest("#reviewOcrClearButton");
      if (reviewOcrClearButton) {
        event.preventDefault();
        event.stopPropagation();
        resetReviewOcrSearch();
        return;
      }
      const reviewOcrPrompt = event.target.closest("[data-review-ocr-query]");
      if (reviewOcrPrompt) {
        event.preventDefault();
        event.stopPropagation();
        runReviewOcrSearch(reviewOcrPrompt.dataset.reviewOcrQuery || "");
        return;
      }
      const nextAction = event.target.closest("#nextActionButton");
      if (nextAction && /review queue/i.test(nextAction.textContent || "")) {
        event.preventDefault();
        event.stopPropagation();
        switchSection("review");
        refreshReviewQueueDirect();
        return;
      }
      const sectionButton = event.target.closest("[data-section]");
      if (sectionButton) {
        const scroller = document.querySelector("main");
        const keepY = scroller ? scroller.scrollTop : window.scrollY;
        event.preventDefault();
        sectionButton.blur();
        switchSection(sectionButton.dataset.section);
        setTimeout(() => { if (scroller) scroller.scrollTop = keepY; else window.scrollTo(0, keepY); }, 0);
        setTimeout(() => { if (scroller) scroller.scrollTop = keepY; else window.scrollTo(0, keepY); }, 60);
        return;
      }
      const jumpButton = event.target.closest("[data-section-jump]");
      if (jumpButton) {
        if (jumpButton.hasAttribute("onclick")) return;
        const scroller = document.querySelector("main");
        const keepY = scroller ? scroller.scrollTop : window.scrollY;
        event.preventDefault();
        jumpButton.blur();
        switchSection(jumpButton.dataset.sectionJump);
        setTimeout(() => { if (scroller) scroller.scrollTop = keepY; else window.scrollTo(0, keepY); }, 0);
        setTimeout(() => { if (scroller) scroller.scrollTop = keepY; else window.scrollTo(0, keepY); }, 60);
      }
    });
    document.addEventListener("keydown", event => {
      if (event.target?.id === "reviewOcrSearchInput" && event.key === "Enter") {
        event.preventDefault();
        runReviewOcrSearch();
        return;
      }
      const jumpButton = event.target.closest?.("[data-section-jump]");
      if (!jumpButton || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      jumpButton.click();
    });
    onElement("closeModal", "click", () => document.getElementById("contractModal")?.classList.remove("open"));
    onElement("contractModal", "click", event => { if (event.target.id === "contractModal") event.currentTarget.classList.remove("open"); });
    ["contractSearch", "contractSearchScope", "facilityFilter", "vendorFilter", "categoryFilter", "historyFilter", "statusFilter", "riskFilter"].forEach(id => onElement(id, "input", event => {
      if (event.target?.id === "vendorFilter") refreshVendorSuggestions("vendorFilter", "vendorFilterList");
      contractFinderShowAll = false;
      activeContractView = "search";
      currentPage = 1;
      if (event.target?.id === "contractSearch" || event.target?.id === "contractSearchScope") scheduleContractBackendSearch();
      renderContracts();
    }));
    document.getElementById("showAllContracts")?.addEventListener("click", async () => {
      contractFinderShowAll = true;
      activeContractView = "all";
      currentPage = 1;
      ["contractSearch", "facilityFilter", "vendorFilter", "categoryFilter", "statusFilter", "riskFilter"].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.value = "";
      });
      const searchScope = document.getElementById("contractSearchScope");
      if (searchScope) searchScope.value = "all";
      const history = document.getElementById("historyFilter");
      if (history) history.value = "all";
      showToast("Loading contracts A-Z...");
      await loadContractsAlphabetically().catch(() => false);
      renderContracts();
      showToast("Showing contracts A-Z, one page at a time.");
    });
    document.getElementById("clearContractFinder")?.addEventListener("click", () => {
      ["contractSearch", "facilityFilter", "vendorFilter", "categoryFilter", "statusFilter", "riskFilter"].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.value = "";
      });
      const searchScope = document.getElementById("contractSearchScope");
      if (searchScope) searchScope.value = "all";
      lastBackendContractSearch = "";
      contractSearchEngine = "";
      const history = document.getElementById("historyFilter");
      if (history) history.value = "current";
      contractFinderShowAll = false;
      activeContractView = "search";
      selectedContractIds.clear();
      currentPage = 1;
      renderContracts();
    });
    onElement("pageSize", "input", () => {
      currentPage = 1;
      renderContracts();
    });
    onElement("prevPage", "click", () => {
      currentPage -= 1;
      renderContracts();
    });
    onElement("nextPage", "click", () => {
      currentPage += 1;
      renderContracts();
    });
    document.getElementById("selectPageContracts")?.addEventListener("change", event => {
      toggleSelectPageContracts(event.target.checked);
    });
    document.getElementById("bulkDeleteContracts")?.addEventListener("click", bulkDeleteSelectedContracts);
    onElement("loadTest", "click", () => {
      loadBackendData();
      showToast("Live data refreshed.");
    });
    document.getElementById("reportTypeSelect")?.addEventListener("change", async event => {
      activeReportId = event.target.value;
      if (["ocr-complete", "ocr-failed"].includes(activeReportId)) {
        try {
          ocrJobs = await loadAllReportOcrJobs();
        } catch {
          showToast("OCR report data could not load. Try Refresh.");
        }
      }
      renderReports();
    });
    document.getElementById("vendorSearch")?.addEventListener("input", () => {
      clearTimeout(window.vendorSearchRenderTimer);
      window.vendorSearchRenderTimer = setTimeout(async () => {
        await loadVendorSearchResults(document.getElementById("vendorSearch")?.value || "");
        window.vendorDirectoryShowAll = false;
        vendorPage = 1;
        renderVendors();
      }, 220);
    });
    ["vendorCategoryFilter", "vendorFacilityFilter"].forEach(id => {
      document.getElementById(id)?.addEventListener("change", () => {
        window.vendorDirectoryShowAll = false;
        vendorPage = 1;
        renderVendors();
      });
    });
    onElement("prevVendorPage", "click", () => {
      vendorPage = Math.max(1, vendorPage - 1);
      renderVendors();
    });
    onElement("nextVendorPage", "click", () => {
      vendorPage += 1;
      renderVendors();
    });
    ["reportFacilityFilter", "reportCategoryFilter", "reportVendorFilter", "reportStatusFilter", "reportDateField", "reportDateFrom", "reportDateTo", "customReportSource", "reportSearchInput"].forEach(id => {
      document.getElementById(id)?.addEventListener("input", renderReports);
      document.getElementById(id)?.addEventListener("change", renderReports);
    });
    document.getElementById("runReportButton")?.addEventListener("click", () => {
      activeReportId = document.getElementById("reportTypeSelect")?.value || activeReportId;
      renderReports();
      setReportView("detail");
      showToast("Report opened.");
    });
    document.getElementById("buildCustomReportButton")?.addEventListener("click", openCustomReport);
    document.getElementById("downloadCustomReportButton")?.addEventListener("click", downloadCustomReport);
    document.getElementById("saveCustomReportButton")?.addEventListener("click", saveCurrentCustomReport);
    document.getElementById("customColumnsCore")?.addEventListener("click", () => setCustomReportColumns("core"));
    document.getElementById("customColumnsFinance")?.addEventListener("click", () => setCustomReportColumns("finance"));
    document.getElementById("customColumnsAll")?.addEventListener("click", () => setCustomReportColumns("all"));
    document.getElementById("customColumnsClear")?.addEventListener("click", () => setCustomReportColumns("clear"));
    document.getElementById("backToReportsButton")?.addEventListener("click", showReportHome);
    document.getElementById("exportReportCsv")?.addEventListener("click", () => downloadCsv("reports"));
    document.getElementById("exportAllReportsCsv")?.addEventListener("click", downloadAllReportsCsv);
    document.getElementById("printReportPdf")?.addEventListener("click", () => downloadPdf(`${buildReport(activeReportId).name} Report`));
    const contractDropZone = document.getElementById("contractDropZone");
    const fileInput = document.getElementById("fileInput");
    onElement("hintVendor", "input", () => {
      refreshVendorSuggestions("hintVendor", "hintVendorList");
      updateUploadShareSyncDestination();
    });
    ["hintFacility", "hintCategory", "hintDocumentType", "hintOwner", "shareSyncUrl", "localFilePath"].forEach(id => {
      document.getElementById(id)?.addEventListener("input", updateUploadShareSyncDestination);
      document.getElementById(id)?.addEventListener("change", updateUploadShareSyncDestination);
    });
    if (fileInput) {
      fileInput.addEventListener("change", event => {
        const count = event.target.files?.length || 0;
        const status = document.getElementById("bulkUploadStatus");
        if (status) status.textContent = count ? `${count} file${count === 1 ? "" : "s"} selected. Click Run OCR and Extraction.` : "No files selected yet.";
        updateUploadShareSyncDestination();
      });
    }
    if (contractDropZone) {
      ["dragenter", "dragover"].forEach(type => contractDropZone.addEventListener(type, event => {
        event.preventDefault();
        contractDropZone.classList.add("dragging");
      }));
      ["dragleave", "drop"].forEach(type => contractDropZone.addEventListener(type, event => {
        event.preventDefault();
        contractDropZone.classList.remove("dragging");
      }));
      contractDropZone.addEventListener("drop", event => {
        const files = [...(event.dataTransfer?.files || [])];
        uploadContractFiles(files).catch(() => showToast("One of the dropped files could not upload. Check the file type and try again."));
      });
    }
    onElement("checkWeather", "click", async () => {
      if (!requireBackend("Real weather lookup")) return;
      const facility = document.getElementById("weatherFacility").value;
      const date = document.getElementById("weatherDate").value;
      const endDate = document.getElementById("weatherEndDate").value || date;
      const latitude = document.getElementById("weatherLatitude").value.trim();
      const longitude = document.getElementById("weatherLongitude").value.trim();
      if (!latitude || !longitude) {
        showToast("Enter latitude and longitude for the facility first.");
        return;
      }
      try {
        const result = await apiJson("/api/weather-check", {
          method: "POST",
          body: JSON.stringify({
            facility,
            date,
            startDate: date,
            endDate,
            latitude,
            longitude,
            category: document.getElementById("weatherCategory").value,
            invoice: document.getElementById("weatherInvoice").value
          })
        });
        weatherChecks.unshift(result);
        renderWeather();
        showToast("Real weather data loaded from Open-Meteo.");
      } catch (error) {
        showToast("Weather lookup failed. Check coordinates/date and restart the local server if needed.");
      }
    });
    onElement("weatherFacility", "change", applyWeatherFacilityCoordinates);
    onElement("saveWeatherCoords", "click", () => {
      const facility = document.getElementById("weatherFacility").value;
      const latitude = document.getElementById("weatherLatitude").value.trim();
      const longitude = document.getElementById("weatherLongitude").value.trim();
      if (!facility || !latitude || !longitude) {
        showToast("Choose a facility and enter latitude/longitude first.");
        return;
      }
      facilityCoordinates[facility] = { latitude, longitude };
      saveFacilityCoordinates();
      showToast(`Saved weather coordinates for ${facility}.`);
    });
    onElement("matchInvoice", "click", () => {
      renderInvoiceResult();
      showToast("Invoice matched to contract and exceptions were flagged.");
    });
    onElement("invoiceFile", "change", event => {
      handleInvoiceFiles(event.target.files).catch(() => showToast("Invoice upload failed. Check the file type and try again."));
    });
    const invoiceDropZone = document.getElementById("invoiceDropZone");
    if (invoiceDropZone) {
      ["dragenter", "dragover"].forEach(type => invoiceDropZone.addEventListener(type, event => {
        event.preventDefault();
        invoiceDropZone.classList.add("dragging");
      }));
      ["dragleave", "drop"].forEach(type => invoiceDropZone.addEventListener(type, event => {
        event.preventDefault();
        invoiceDropZone.classList.remove("dragging");
      }));
      invoiceDropZone.addEventListener("drop", event => {
        handleInvoiceFiles(event.dataTransfer?.files).catch(() => showToast("Invoice upload failed. Check the file type and try again."));
      });
    }
    onElement("runClauseSearch", "click", () => {
      renderClauses(document.getElementById("clauseSearch")?.value || "");
      showToast("Risk check complete.");
    });
    document.getElementById("createBackupButton")?.addEventListener("click", createLocalBackup);
    document.getElementById("saveAdminSettingsButton")?.addEventListener("click", () => saveAdminSettings());
    document.getElementById("testSmtpButton")?.addEventListener("click", sendSmtpTest);
    document.getElementById("saveCategoriesButton")?.addEventListener("click", () => saveAdminSettings());
    document.getElementById("addFacilityProfileButton")?.addEventListener("click", addOrUpdateFacilityProfile);
    document.getElementById("importFacilitiesButton")?.addEventListener("click", importFacilityMasterData);
    document.getElementById("importVendorsButton")?.addEventListener("click", importVendorMasterData);
    document.getElementById("uploadFacilityExcelButton")?.addEventListener("click", () => uploadMasterExcel("facilityExcelInput", "/api/upload-facility-master", "facility"));
    document.getElementById("uploadCensusExcelButton")?.addEventListener("click", uploadCensusExcel);
    document.getElementById("uploadVendorExcelButton")?.addEventListener("click", () => uploadMasterExcel("vendorExcelInput", "/api/upload-vendor-master", "vendor"));
    document.getElementById("saveRolesButton")?.addEventListener("click", saveAdminRoles);
    document.getElementById("addUserButton")?.addEventListener("click", addOrUpdateUser);
    document.getElementById("refreshLiveDataButton")?.addEventListener("click", refreshLiveDataNow);
    onElement("helpQuestionButton", "click", () => renderHelpAnswer(document.getElementById("helpQuestionInput")?.value || ""));
    onElement("helpQuestionInput", "keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        renderHelpAnswer(event.target.value || "");
      }
    });
    onElement("adminUserScopePreset", "change", syncAdminScopeFromPreset);
    onElement("adminUserRole", "change", applyAdminRoleDefaults);
    setAdminScopePreset(document.getElementById("adminUserFacility")?.value || "All");
    onElement("loginButton", "click", signInUser);
    onElement("acceptInviteButton", "click", acceptInviteSetup);
    onElement("forgotPasswordButton", "click", () => showForgotPasswordPanel(true));
    onElement("cancelPasswordResetButton", "click", () => showForgotPasswordPanel(false));
    onElement("requestPasswordResetButton", "click", requestPasswordReset);
    onElement("loginPass", "keydown", event => {
      if (event.key === "Enter") document.getElementById("loginButton")?.click();
    });
    onElement("forgotPasswordEmail", "keydown", event => {
      if (event.key === "Enter") document.getElementById("requestPasswordResetButton")?.click();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") sendPresenceUpdate(activeWorkContext.action || "Viewing", { immediate: true });
    });
    onElement("logoutButton", "click", signOutUser);
    onElement("startOcr", "click", createShareSyncIntake);
    document.getElementById("importShareSyncFolder")?.addEventListener("click", importShareSyncFolder);
    document.getElementById("checkShareSyncButton")?.addEventListener("click", checkShareSyncStatus);
    document.getElementById("repairPdfLinksButton")?.addEventListener("click", repairPdfLinks);
    document.getElementById("refileShareSyncButton")?.addEventListener("click", refileShareSyncRecords);
    document.getElementById("shareSyncProofButton")?.addEventListener("click", runShareSyncProofTest);
    document.getElementById("readEmailContract")?.addEventListener("click", () => {
      uploadEmailContractText().catch(() => showToast("Could not read the pasted email. Check the text and try again."));
    });
    document.getElementById("askButton")?.addEventListener("click", () => {
      const question = document.getElementById("askInput")?.value || "Which contracts need action this week?";
      showToast(`Search ready for: ${question}`);
    });
    onElement("aiSearchButton", "click", () => {
      const question = document.getElementById("aiSearchInput")?.value || "Which contracts need action this week?";
      renderAiAnswer(question);
      showToast("Contract search completed with source-linked results.");
    });
    document.getElementById("askQuick")?.addEventListener("click", () => submitContractRoomSearch());
    document.getElementById("globalSearch")?.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        submitContractRoomSearch(event.target.value);
      }
    });
    document.addEventListener("click", event => {
      const previewButton = event.target.closest("[data-invoice-preview-id]");
      if (!previewButton) return;
      event.preventDefault();
      showInvoicePreview(previewButton.dataset.invoicePreviewId || "");
    });

    loadFacilityCoordinates();
    const initialSection = (location.hash || "").replace("#", "").trim();
    const requestedSection = initialSection && document.getElementById(initialSection)?.classList.contains("section")
      ? initialSection
      : "dashboard";
    const initialAppSection = requestedSection;
    history.replaceState({ appSection: initialAppSection }, "", `${location.pathname}${location.search}#${initialAppSection}`);
    setBackendStatus(true);
    if (initialAppSection !== "dashboard") {
      switchSection(initialAppSection, { replace: true });
    } else {
      renderSectionContent("dashboard");
    }
    checkAuthStatus().catch(error => {
      reportClientError("Auth status check failed", error?.stack || error || "");
    });
    const invoiceUploadStatus = document.getElementById("invoiceUploadStatus");
    if (invoiceUploadStatus) {
      invoiceUploadStatus.innerHTML = `
        <div class="metric-row"><div><strong>Waiting for invoice</strong><span>Upload an invoice to OCR, match to contract, and flag exceptions.</span></div><span class="badge gray">Ready</span></div>
      `;
    }
    window.addEventListener("hashchange", () => {
      const sectionId = (location.hash || "").replace("#", "").trim();
      if (sectionId && document.getElementById(sectionId)?.classList.contains("section")) {
        switchSection(sectionId, { fromHistory: true });
      }
    });
    window.addEventListener("popstate", event => {
      const sectionId = event.state?.appSection || (location.hash || "").replace("#", "").trim();
      if (sectionId && document.getElementById(sectionId)?.classList.contains("section")) {
        switchSection(sectionId, { fromHistory: true });
      }
    });
