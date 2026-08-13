window.CONTRACT_APP_QUEUES_PAGE = (() => {
  const checkHelp = {
    "Vendor": "Confirm the vendor/legal name from the PDF. If OCR is unsure, leave it blank or correct it.",
    "Facility": "Confirm which facility or facilities this contract belongs to.",
    "Service type": "Confirm the contract type, such as laundry, pest control, pharmacy, transportation, or maintenance.",
    "Start of services": "Find the effective date, commencement date, service start, or agreement start.",
    "Contract term": "Find the contract length, initial term, or whether it continues until terminated.",
    "Payment terms": "Find Net 30, Net 45, due on receipt, monthly invoice language, or payment schedule.",
    "Fee / rate": "Find pricing, monthly charge, annual cost, unit rate, schedule, or fee language.",
    "Auto-renewal": "Check whether the contract renews automatically or has no fixed end date.",
    "Termination": "Find how to terminate, notice days, cancellation rights, and whether there is a penalty.",
    "Insurance": "Find insurance limits, certificates, liability, workers comp, or professional coverage."
  };

  function checkTitle(item = "") {
    return checkHelp[item] || "Open Review Fields and verify this item against the PDF/OCR source.";
  }

  function documentKindLabel(type = "") {
    const text = String(type || "Contract").trim();
    if (/amend|addendum|change/i.test(text)) return "Amendment";
    if (/proposal|quote/i.test(text)) return "Proposal";
    return "Contract";
  }

  function renderReviewQueuePage(ctx) {
    const {
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
      reviewQueueItems,
      reviewQueuePage,
      reviewQueuePageSize,
      reviewQueueTotal,
      reviewQueueTotalPages
    } = ctx;

    const queue = document.getElementById("ocrJobRows");
    if (!queue) return;
    const allJobsToShow = reviewQueueItems();
    const jobsToShow = allJobsToShow.slice(0, reviewQueuePageSize);
    const readyCount = allJobsToShow.filter(job => job.status === "Complete").length;
    const issueCount = allJobsToShow.filter(job => job.error).length;
    const overviewHtml = allJobsToShow.length ? `
      <div class="review-queue-overview">
        <div>
          <strong>${reviewQueueTotal} waiting</strong>
          <span>${issueCount ? `${issueCount} OCR issue${issueCount === 1 ? "" : "s"}` : "Contracts needing review"}</span>
        </div>
        <button class="btn ghost" type="button" onclick="refreshReviewQueueDirect()">Refresh</button>
      </div>
    ` : "";
    queue.innerHTML = overviewHtml + jobsToShow.map(job => {
      try {
        const contract = contractForJob(job);
        const vendor = cleanQueueText(reviewFieldFromJob(job, "Vendor") || contract.vendor, "Vendor not confirmed", 54);
        const facility = cleanQueueText(reviewFieldFromJob(job, "Facility") || contract.facility, "Facility not confirmed", 46);
        const category = cleanQueueServiceType(reviewFieldFromJob(job, ["Category", "Contract Type"]) || contract.category);
        const suggestedCategory = cleanQueueServiceType(contract.suggestedCategory || job.suggestedCategory || "");
        const parentHint = contract.suggestedParentContractName || job.suggestedParentContractName || "";
        const endDate = reviewFieldFromJob(job, "End Date") || contract.end || "";
        const endDateText = cleanQueueText(endDateDisplay(endDate, autoRenewalForJob(job)), "Needs review", 56);
        const rate = cleanQueueMoney(reviewFieldFromJob(job, ["Rate / Fee", "Contract Value"]) || contract.rate || contract.spend);
        const paymentTerms = cleanQueueText(reviewFieldFromJob(job, "Payment Terms") || contract.paymentTerms, "Not found", 62);
        const daysPayable = cleanQueueText(reviewFieldFromJob(job, "Days Payable") || contract.daysPayable, "", 24);
        const notice = cleanQueueNotice(reviewFieldFromJob(job, "Notice Period") || contract.terminationClause);
        const documentType = documentKindLabel(contract.documentType || job.documentType || job.relatedDocument?.type || "Contract");
        const linkedParent = contract.parentContractName || job.relatedDocument?.parentContractName || "";
        const missing = reviewMissingItems(job);
        const title = queueContractTitle(job, contract);
        const reviewStatusLabel = job.reviewStatus || contract.reviewStatus || job.aiAgentReview?.status || contract.aiAgentReview?.status || job.status || "Waiting to read";
        const displayStatus = job.status === "Complete" ? reviewStatusLabel : job.status || reviewStatusLabel;
        const cleanDisplayStatus = /human|needs/i.test(displayStatus) ? "Needs review" : /complete|ready|draft/i.test(displayStatus) ? "Ready" : displayStatus;
        const ocrScore = job.aiAgentReview?.score || contract.aiAgentReview?.score || "";
        return `
          <article class="review-queue-item review-queue-item-clean ${job.id === activeReviewJobId ? "selected-review-row" : ""}">
            <div class="review-queue-primary">
              <span class="review-queue-label">Contract / Vendor</span>
              <strong class="review-contract-name">${escapeHtml(title)}</strong>
              <div class="review-subline">
                <span class="badge ${documentType === "Contract" ? "blue" : "amber"}">${escapeHtml(documentType)}</span>
                <span class="badge ${badgeClass(cleanDisplayStatus)}">${escapeHtml(cleanDisplayStatus)}</span>
              </div>
              <span class="review-vendor-line">${escapeHtml(vendor)}</span>
              ${linkedParent ? `<span class="review-muted">Linked to: ${escapeHtml(cleanQueueText(linkedParent, "Parent contract", 50))}</span>` : ""}
            </div>
            <div class="review-queue-meta">
              <span class="review-queue-label">Facility / Type</span>
              <div class="review-meta-card">
                <strong>${escapeHtml(facility)}</strong>
                <span class="badge blue">${escapeHtml(category)}</span>
              </div>
              ${suggestedCategory && /^needs classification$/i.test(String(category || "")) ? `<span class="review-muted">Suggested: ${escapeHtml(suggestedCategory)}</span>` : ""}
              ${parentHint ? `<span class="review-muted">Possible parent: ${escapeHtml(cleanQueueText(parentHint, "Parent contract", 52))}</span>` : ""}
            </div>
            <div class="review-queue-terms">
              <span class="review-queue-label">Key Terms</span>
              <div class="review-known">
                <div class="review-term-lines">
                  <div class="review-term-pill"><b>End</b><span title="${escapeHtml(endDate ? endDateText : "No fixed end date")}">${escapeHtml(endDate ? endDateText : "No fixed end date")}</span></div>
                  <div class="review-term-pill"><b>Fee</b><span title="${escapeHtml(rate)}">${escapeHtml(rate)}</span></div>
                  <div class="review-term-pill"><b>Payment</b><span title="${escapeHtml(paymentTerms)}">${escapeHtml(paymentTerms)}${daysPayable ? ` (${escapeHtml(daysPayable)})` : ""}</span></div>
                  <div class="review-term-pill"><b>Notice</b><span title="${escapeHtml(notice)}">${escapeHtml(notice)}</span></div>
                </div>
                <div class="review-status-line">
                  ${ocrScore ? `<span class="badge blue">${escapeHtml(String(ocrScore))}% read</span>` : ""}
                  ${job.error ? `<span class="badge red">OCR issue</span>` : ""}
                </div>
              </div>
            </div>
            <div class="review-queue-checks">
              <span class="review-queue-label">Check</span>
              <div class="review-badge-stack">${missing.length ? missing.slice(0, 5).map(item => `<span class="badge amber review-check-chip" title="${escapeHtml(checkTitle(item))}">${escapeHtml(item)}</span>`).join("") : `<span class="badge green">Core fields found</span>`}</div>
              ${missing.length > 5 ? `<span class="review-muted">+${missing.length - 5} more checks</span>` : ""}
            </div>
            <div class="review-queue-action-col">
              <span class="review-queue-label">Actions</span>
              <div class="review-queue-actions">
                 <button class="btn primary" data-open-review-job="${escapeHtml(job.id)}">Review</button>
                 ${job.contractId ? `<button class="btn ghost" onclick="openContract('${jsArg(job.contractId)}')">Card</button>` : ""}
                ${job.contractId ? `<button class="btn danger" onclick="deleteContractRecord('${jsArg(job.contractId)}')">Delete</button>` : ""}
              </div>
            </div>
          </article>
        `;
      } catch (error) {
        const contract = contractForJob(job);
        const title = cleanQueueText(contract.name || job.contractId || job.id, "Pending contract", 64);
        return `
          <article class="review-queue-item">
            <div><span class="review-queue-label">Contract</span><strong class="review-contract-name">${escapeHtml(title)}</strong><br><span class="badge blue">Contract</span></div>
            <div><span class="review-queue-label">Facility</span>${escapeHtml(contract.facility || "Facility not confirmed")}</div>
            <div><span class="review-queue-label">Status</span><span class="badge amber">Needs review</span></div>
            <div><span class="review-queue-label">Check</span><span class="badge amber">Open fields</span></div>
            <div><span class="review-queue-label">Actions</span><button class="btn primary" data-open-review-job="${escapeHtml(job.id)}">Review fields</button></div>
          </article>
        `;
      }
    }).join("") + (reviewQueueTotal > reviewQueuePageSize ? `
      <div class="review-queue-pagination">
        <span>Showing ${((reviewQueuePage - 1) * reviewQueuePageSize) + 1}-${Math.min(reviewQueuePage * reviewQueuePageSize, reviewQueueTotal)} of ${reviewQueueTotal}</span>
        <div class="table-actions">
          <button class="btn ghost" type="button" ${reviewQueuePage <= 1 ? "disabled" : ""} onclick="loadReviewQueuePage(${Math.max(1, reviewQueuePage - 1)})">Previous</button>
          <span class="badge blue">Page ${reviewQueuePage} of ${reviewQueueTotalPages}</span>
          <button class="btn primary" type="button" ${reviewQueuePage >= reviewQueueTotalPages ? "disabled" : ""} onclick="loadReviewQueuePage(${Math.min(reviewQueueTotalPages, reviewQueuePage + 1)})">Next</button>
        </div>
      </div>
    ` : "") || `<div class="metric-row"><div><strong>No contracts are waiting for review.</strong><span>Upload a contract or import from ShareSync to start.</span></div><span class="badge green">Clear</span></div>`;
  }

  function renderOcrQueuePage(ctx) {
    const {
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
    } = ctx;

    const rows = document.getElementById("ocrQueueRows");
    if (!rows) return;
    const counts = { waiting: 0, reading: 0, completed: 0, failed: 0 };
    const writeText = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    };
    ocrJobs.forEach(job => { counts[ocrJobStatusGroup(job)] += 1; });
    const totalJobs = ocrQueueTotal || ocrJobs.length;
    const maxPage = Math.max(1, Math.ceil(totalJobs / ocrQueuePageSize));
    writeText("ocrQueueWaitingCount", counts.waiting);
    writeText("ocrQueueReadingCount", counts.reading);
    writeText("ocrQueueCompleteCount", counts.completed);
    writeText("ocrQueueFailedCount", counts.failed);
    writeText("ocrQueueTotalBadge", `${totalJobs} job${totalJobs === 1 ? "" : "s"}`);
    const visibleJobs = ocrJobs.slice(0, ocrQueuePageSize);
    rows.innerHTML = visibleJobs.map(job => {
      const group = ocrJobStatusGroup(job);
      const contract = contractForJob(job);
      const started = ocrJobStartedAt(job);
      const finished = group === "completed" || group === "failed" ? ocrJobFinishedAt(job) : "";
      const fileText = queuePathName(job.localFilePath || job.shareSyncLocalPath || contract.shareSyncLocalPath || job.shareSyncUrl || contract.shareSyncUrl || "");
      const errorText = job.error || job.progress?.error || "";
      return `
        <tr>
          <td><span class="badge ${group === "completed" ? "green" : group === "failed" ? "red" : group === "reading" ? "blue" : "amber"}">${escapeHtml(group === "completed" ? "Completed" : group === "failed" ? "Failed" : group === "reading" ? "Reading now" : "Waiting")}</span></td>
          <td><strong>${escapeHtml(ocrJobContractName(job))}</strong>${fileText ? `<br><span style="color:var(--muted);font-size:12px">${escapeHtml(fileText)}</span>` : ""}${errorText ? `<br><span style="color:#b42318;font-size:12px">${escapeHtml(cleanQueueText(errorText, "OCR error", 110))}</span>` : ""}</td>
          <td>${escapeHtml(ocrJobUploadedBy(job))}</td>
          <td>${escapeHtml(String(ocrJobPageCount(job)))}</td>
          <td>${escapeHtml(started ? shortDateTime(started) : "Not started")}</td>
          <td>${escapeHtml(finished ? shortDateTime(finished) : group === "reading" ? "Running" : "Not finished")}</td>
          <td>
            <div class="table-actions">
              ${group === "completed" ? `<button class="btn primary" data-open-review-job="${escapeHtml(job.id)}">Review</button>` : `<button class="btn primary" onclick="runOcrJob('${jsArg(job.id)}')">${group === "failed" ? "Retry" : "Run"}</button>`}
              ${job.contractId ? `<button class="btn ghost" onclick="openContract('${jsArg(job.contractId)}')">Contract Card</button>` : ""}
            </div>
          </td>
        </tr>
      `;
    }).join("") + (totalJobs > ocrQueuePageSize ? `
      <tr>
        <td colspan="7">
          <div class="table-actions" style="justify-content:space-between">
            <span class="muted">Page ${escapeHtml(String(ocrQueuePage))} of ${escapeHtml(String(maxPage))}. Showing ${escapeHtml(String(visibleJobs.length))} of ${escapeHtml(String(totalJobs))} OCR jobs.</span>
            <span class="table-actions">
              <button class="btn ghost" ${ocrQueuePage <= 1 ? "disabled" : ""} onclick="loadOcrQueuePage(${Math.max(1, ocrQueuePage - 1)})">Previous</button>
              <button class="btn ghost" ${ocrQueuePage >= maxPage ? "disabled" : ""} onclick="loadOcrQueuePage(${Math.min(maxPage, ocrQueuePage + 1)})">Next</button>
            </span>
          </div>
        </td>
      </tr>
    ` : "") || `<tr><td colspan="7">No OCR jobs yet. Upload a contract to start reading.</td></tr>`;
  }

  return {
    renderOcrQueuePage,
    renderReviewQueuePage
  };
})();
