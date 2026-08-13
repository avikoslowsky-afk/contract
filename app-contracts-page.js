window.CONTRACT_APP_CONTRACTS_PAGE = (() => {
  function contractWorkflow(c = {}) {
    const statusText = `${c.contractStatus || ""} ${c.status || ""} ${c.reviewStatus || ""}`.toLowerCase();
    if (c.status === "Archived" || c.archivedAt) {
      return { label: "Archived", detail: "History record", badge: "gray" };
    }
    if (/approved/.test(statusText)) {
      return { label: "Approved", detail: "Ready contract", badge: "green" };
    }
    if (/needs|pending|queued|ocr|uploaded|review|draft/.test(statusText)) {
      return { label: "Review Queue", detail: c.reviewStatus || c.status || "Needs review", badge: "amber" };
    }
    if (/active|renewal|terminated/.test(statusText)) {
      return { label: "Live Contract", detail: c.status || c.contractStatus || "Active record", badge: "blue" };
    }
    return { label: "Needs Review", detail: "Check record", badge: "amber" };
  }

  function renderContractsPage(ctx) {
    const started = performance.now();
    const {
      activeContractView,
      badgeClass,
      contractData,
      contractFileUrl,
      contractFinderShowAll,
      contractEndDateDisplay,
      contractListJoinedValue,
      contractListValue,
      contractSearchEngine,
      contractsTotalCount,
      contractViewMatches,
      currentPage,
      endDateDisplay,
      escapeHtml,
      formatMoneyText,
      jsArg,
      sameMasterName,
      selectedContractIds,
      setCurrentPage,
      updateBulkContractControls,
      updateContractViewButtons
    } = ctx;

    updateContractViewButtons();
    const facility = document.getElementById("facilityFilter").value;
    const vendor = document.getElementById("vendorFilter")?.value || "";
    const category = document.getElementById("categoryFilter").value;
    const history = document.getElementById("historyFilter")?.value || "current";
    const status = document.getElementById("statusFilter").value;
    const risk = document.getElementById("riskFilter").value;
    const search = document.getElementById("contractSearch").value.toLowerCase();
    const searchScope = document.getElementById("contractSearchScope")?.value || "all";
    const pageSize = Math.min(25, Math.max(5, Number(document.getElementById("pageSize")?.value || 10)));
    const hasFinderCriteria = Boolean(search || facility || vendor || category || status || risk || history === "archived" || history === "all" || (activeContractView && activeContractView !== "search" && activeContractView !== "all"));
    const shouldShowResults = contractFinderShowAll || hasFinderCriteria;
    const totalContracts = Math.max(Number(contractsTotalCount || 0), contractData.length);
    const countSummary = `${totalContracts.toLocaleString()} contract${totalContracts === 1 ? "" : "s"}`;

    if (!shouldShowResults) {
      document.getElementById("contractRows").innerHTML = `<tr><td colspan="6"><strong>Search or choose a filter.</strong><br><span style="color:var(--muted);font-size:12px">Search vendor, facility, service, contract name, dates, money terms, notice, renewal, or PDF text. Results open the Contract Card.</span></td></tr>`;
      document.getElementById("contractResultCount").textContent = countSummary;
      document.getElementById("pageInfo").textContent = "Search mode";
      document.getElementById("prevPage").disabled = true;
      document.getElementById("nextPage").disabled = true;
      document.getElementById("contractPerformanceNote").textContent = "Search first. Click a result to open its Contract Card.";
      updateBulkContractControls([]);
      return;
    }

    const rows = contractData.filter(c => {
      const ocrPreview = String(c.ocrTextPreview || "").slice(0, 2000);
      const extractedPreview = (c.extractedFields || [])
        .slice(0, 20)
        .map(field => `${field.label || ""} ${field.value || ""}`)
        .join(" ");
      const scopedHaystacks = {
        name: [c.name, c.uploadedFileName, c.originalFilename, c.shareSyncPath].join(" "),
        vendor: [c.vendor, c.vendorLegalName, c.vendorContact, c.vendorEmail, c.vendorPhone].join(" "),
        facility: [c.facility, c.facilities, c.facilityAddress].join(" "),
        service: [c.services, c.category, c.contractType, c.documentType].join(" "),
        ocr: [ocrPreview, c.summary, extractedPreview].join(" ")
      };
      const haystack = (searchScope === "all"
        ? Object.values(scopedHaystacks).join(" ")
        : scopedHaystacks[searchScope] || Object.values(scopedHaystacks).join(" ")
      ).toLowerCase();
      const isArchived = c.status === "Archived" || Boolean(c.archivedAt);
      return (!facility || sameMasterName(c.facility, facility))
        && (!vendor || sameMasterName(c.vendor, vendor))
        && (!category || sameMasterName(c.category, category) || sameMasterName(c.services, category))
        && (history === "all" || (history === "archived" ? isArchived : !isArchived))
        && (!status || c.status === status)
        && (!risk || c.risk === risk)
        && contractViewMatches(c)
        && (!search || haystack.includes(search));
    });

    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    const nextPage = Math.min(Math.max(currentPage, 1), pageCount);
    setCurrentPage(nextPage);
    const pageRows = rows.slice((nextPage - 1) * pageSize, nextPage * pageSize);

    document.getElementById("contractRows").innerHTML = pageRows.map(c => {
      const facilityText = contractListValue(c.facility, "Needs Review");
      const vendorText = contractListValue(c.vendor, "Needs Review");
      const serviceText = contractListJoinedValue([c.services, c.category], "Needs Review");
      const endText = contractListValue(contractEndDateDisplay ? contractEndDateDisplay(c) : endDateDisplay(c.end, c.autoRenewal), "Needs Review");
      const lengthText = contractListValue(c.initialContractLength, "Needs Review");
      const feeText = formatMoneyText
        ? contractListJoinedValue([formatMoneyText(c.fee), formatMoneyText(c.rate), formatMoneyText(c.spend)], "Needs Review")
        : contractListJoinedValue([c.fee, c.rate, c.spend], "Needs Review");
      const paymentText = contractListJoinedValue([c.paymentTerms, c.daysPayable], "Needs Review");
      const autoText = contractListValue(c.autoRenewal, "Unknown");
      const noticeText = contractListJoinedValue([c.terminationClause, c.noticePeriod], "Needs Review");
      const workflow = contractWorkflow(c);
      return `
        <tr class="contract-result-row" tabindex="0" title="Open Contract Card" onclick="openContract('${jsArg(c.id)}')" onkeydown="if(event.key==='Enter'){openContract('${jsArg(c.id)}')}">
          <td><input type="checkbox" data-contract-select value="${escapeHtml(c.id)}" ${selectedContractIds.has(c.id) ? "checked" : ""} onclick="event.stopPropagation(); setContractSelected('${jsArg(c.id)}', this.checked)" title="Select ${escapeHtml(c.name)}" /></td>
          <td class="contract-title-cell">
            <div class="contract-primary">
              <span class="contract-name-line">${escapeHtml(c.name)}</span>
              <span class="contract-subline">${escapeHtml(c.id)}</span>
              <div class="contract-chip-row">
                <span class="badge ${badgeClass(c.contractStatus || c.status)}">${escapeHtml(c.contractStatus || c.status || "Needs Review")}</span>
                <span class="badge gray">${escapeHtml(c.documentType || "Contract")}</span>
              </div>
            </div>
          </td>
          <td class="stacked-cell">
            <span class="cell-line"><b>Facility</b> ${escapeHtml(facilityText)}</span>
            <span class="cell-line"><b>Vendor</b> ${escapeHtml(vendorText)}</span>
            <span class="cell-line"><b>Service</b> ${escapeHtml(serviceText)}</span>
          </td>
          <td>
            <div class="contract-term-grid">
              <div class="term-mini"><b>End</b><span>${escapeHtml(endText)}</span></div>
              <div class="term-mini"><b>Length</b><span>${escapeHtml(lengthText)}</span></div>
              <div class="term-mini"><b>Fee</b><span>${escapeHtml(feeText)}</span></div>
              <div class="term-mini"><b>Payment</b><span>${escapeHtml(paymentText)}</span></div>
              <div class="term-mini"><b>Auto</b><span>${escapeHtml(autoText)}</span></div>
              <div class="term-mini"><b>Notice</b><span>${escapeHtml(noticeText)}</span></div>
            </div>
          </td>
          <td class="stacked-cell">
            <span class="badge ${workflow.badge}">${escapeHtml(workflow.label)}</span>
            <span class="cell-line">${escapeHtml(workflow.detail)}</span>
          </td>
          <td><div class="table-actions">
            <button class="btn primary" onclick="event.stopPropagation(); openContract('${jsArg(c.id)}')">Open Card</button>
            ${contractFileUrl(c) ? `<a class="btn ghost" href="${contractFileUrl(c)}" onclick="event.stopPropagation()" download>PDF</a>` : ""}
            <button class="btn ghost" onclick="event.stopPropagation(); setContractHistoryStatus('${jsArg(c.id)}', ${c.status === "Archived" ? "false" : "true"})">${c.status === "Archived" ? "Restore" : "Archive"}</button>
            <button class="btn danger" onclick="event.stopPropagation(); deleteContractRecord('${jsArg(c.id)}')">Delete</button>
          </div></td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="6"><strong>No matching contracts found.</strong><br><span style="color:var(--muted);font-size:12px">Try Search everywhere, Vendor, Facility, Service type, or Full text terms.</span></td></tr>`;

    const elapsed = Math.round(performance.now() - started);
    document.getElementById("contractResultCount").textContent = `${rows.length.toLocaleString()} shown${totalContracts > rows.length ? ` of ${totalContracts.toLocaleString()} total` : ""}${search && contractSearchEngine ? ` - ${contractSearchEngine}` : ""}`;
    document.getElementById("pageInfo").textContent = `Page ${nextPage} of ${pageCount}`;
    document.getElementById("prevPage").disabled = nextPage <= 1;
    document.getElementById("nextPage").disabled = nextPage >= pageCount;
    document.getElementById("contractPerformanceNote").textContent = search
      ? `Saved fields and PDF text searched. Click any result for the Contract Card. ${pageRows.length} shown.`
      : `${pageRows.length} shown. Click any result for the Contract Card.`;
    updateBulkContractControls(pageRows);
  }

  return { renderContractsPage };
})();
