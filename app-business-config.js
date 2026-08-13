window.CONTRACT_APP_BUSINESS_CONFIG = (() => {
  const categoryGroupOrder = ["Utilities", "Clinical / Healthcare", "Facility Services", "Business / Admin", "Other Services"];

  const categorySynonymGroups = [
    ["healthcare", "health", "medical", "clinical", "clinic", "physician", "doctor", "provider", "patient", "care", "vascular", "radiology", "diagnostic", "nursing", "therapy"],
    ["dental", "dentserv", "dentserve", "dentist", "dentistry", "oral", "dentures", "denture", "hygienist"],
    ["transportation", "transport", "ambulette", "ambulance", "van", "mileage", "trip", "pickup"],
    ["pharmacy", "pharma", "rx", "medication", "drug"],
    ["oxygen", "medicalgas", "gas", "airgas", "respiratory"],
    ["waste", "garbage", "refuse", "recycling", "shred", "grease", "trap", "environmental"],
    ["maintenance", "repair", "service", "landscape", "lawn", "snow", "hvac", "elevator", "fire", "sprinkler", "ansul", "alarm"],
    ["internet", "telecom", "fiber", "phone", "network", "software", "it", "license", "saas"],
    ["security", "guard", "surveillance", "camera"],
    ["laundry", "linen", "uniform"],
    ["food", "dietary", "nutrition", "meal"],
    ["insurance", "policy", "coverage", "liability"]
  ];

  const learnedRequirementCatalog = [
    { label: "Vendor Contact", aliases: ["Vendor Contact", "Primary Contact"], keys: ["vendorContact", "primaryContact"] },
    { label: "Vendor Address", aliases: ["Vendor Mailing Address", "Vendor Address"], keys: ["vendorMailingAddress", "vendorAddress", "mailingAddress"] },
    { label: "Vendor Email", aliases: ["Vendor Email"], keys: ["vendorEmail", "email"] },
    { label: "Vendor Phone", aliases: ["Vendor Phone"], keys: ["vendorPhone", "phone"] },
    { label: "Account / meter / service address", aliases: ["Account Number", "Utility Account Number", "Meter Number", "Service Address"], keys: ["utilityAccountNumber", "meterNumber", "serviceAddress"] },
    { label: "Service detail / frequency", aliases: ["Quantity of Services", "Service Pricing Detail", "Pickup / Service Detail"], keys: ["quantityOfServices", "servicePricingDetail", "pickupServiceDetail"] },
    { label: "Service Pricing Detail", aliases: ["Service Pricing Detail", "Rate / Fee", "Fee"], keys: ["servicePricingDetail", "labTestPricing", "fee", "rate"] },
    { label: "Monthly Cost", aliases: ["Monthly Cost"], keys: ["monthlyCost"] },
    { label: "Cost Bed/Month", aliases: ["Cost Bed/Month"], keys: ["costBedMonth"] },
    { label: "Insurance", aliases: ["Insurance Requirement", "Insurance Certificate"], keys: ["insuranceRequirement", "insuranceCertificate", "insuranceStatus"] },
    { label: "Indemnification", aliases: ["Indemnification"], keys: ["indemnification"] }
  ];

  const contractLifecycleStatuses = ["Uploaded", "OCR Read", "Needs Review", "Approved", "Active", "Renewal Review", "Terminated", "Archived"];

  const customReportColumns = [
    ["sourceType", "Source"],
    ["facility", "Facility"],
    ["vendor", "Vendor"],
    ["category", "Service / Category"],
    ["name", "Contract / Invoice"],
    ["status", "Status"],
    ["signatureDate", "Signature Date"],
    ["start", "Start Date"],
    ["end", "End Date"],
    ["renewal", "Renewal Date"],
    ["invoiceDate", "Invoice Date"],
    ["initialContractLength", "Term Length"],
    ["autoRenewal", "Auto Renewal"],
    ["termination", "Termination / Notice"],
    ["paymentTerms", "Payment Terms"],
    ["daysPayable", "Days Payable"],
    ["fee", "Fee / Rate"],
    ["annualizedSpend", "Annualized Spend"],
    ["monthlyCost", "Monthly Cost"],
    ["costBedMonth", "Contract Cost/Bed"],
    ["estimatedPpd", "Estimated PPD"],
    ["beds", "Beds"],
    ["invoiceTotal", "Invoice Total"],
    ["invoiceCostPerBed", "Invoice Cost/Bed"],
    ["risk", "Risk"],
    ["owner", "Owner"],
    ["matchedContractName", "Matched Contract"]
  ];

  const defaultCustomColumns = ["sourceType", "facility", "vendor", "category", "name", "status", "annualizedSpend", "monthlyCost", "costBedMonth", "estimatedPpd", "beds", "end", "autoRenewal", "termination", "paymentTerms", "fee", "invoiceTotal", "invoiceCostPerBed"];

  return {
    categoryGroupOrder,
    categorySynonymGroups,
    learnedRequirementCatalog,
    contractLifecycleStatuses,
    customReportColumns,
    defaultCustomColumns
  };
})();
