window.CONTRACT_APP_REVIEW_CONFIG = (() => {
  const reviewChecklistFields = [
    { label: "Contract type", aliases: ["Contract type", "Category", "Contract Type", "Agreement Type", "Service Type", "Services"] },
    { label: "Vendor Name", aliases: ["Vendor Name", "Vendor", "Provider", "Contractor", "Supplier"] },
    { label: "Effective date", aliases: ["Effective date", "Effective Date", "Start of Services", "Start Date", "Service Start Date", "Service Date", "Commencement Date", "Commencement", "Effective", "Signature Date", "Signed Date"] },
    { label: "Cost", aliases: ["Cost", "Fee", "Fees", "Rate / Fee", "Contract Value", "Contract Amount", "Contract Price", "Amount", "Charge", "Charges", "Rate", "Rates", "Price", "Pricing", "Service Charge", "Service Charges", "Service Fee", "Service Fees", "Monthly Cost", "Monthly Charge", "Monthly Recurring Charge", "MRC", "Non-Recurring Charge", "NRC", "Annual Cost", "Annual Charge", "Service Order Total", "Recurring Charge"] },
    { label: "Auto renew", aliases: ["Auto renew", "Auto Renewal", "Auto-Renewal", "Automatic Renewal", "Automatically Renew", "Renews", "Renewal", "Successive Terms"] },
    { label: "How to terminate", aliases: ["How to terminate", "Termination", "Termination Notice", "Notice Period", "Required Notice Days", "Termination Rights", "Cancellation", "Cancel", "Non-Renewal", "Notice to Terminate", "Written Notice"] }
  ];

  const financeSupportFields = [
    { label: "Quantity of Services", aliases: ["Quantity of Services", "Service Quantity", "Quantity", "Units", "Square Feet", "Sq Ft", "Miles", "Trips", "Pickups", "Boxes", "Containers", "Tests", "Meals", "Sessions"] },
    { label: "Billing Frequency", aliases: ["Billing Frequency", "Frequency", "Billing Cycle", "Recurring", "Monthly", "Annual", "Weekly", "Daily", "Quarterly", "One-time"] },
    { label: "Annual Spend", aliases: ["Annual Spend", "Annual Cost", "Annual Charge", "Annualized Spend", "Total Annual Spend"] }
  ];

  const primaryReviewLabels = [
    "contract type",
    "vendor name",
    "effective date",
    "cost",
    "auto renew",
    "how to terminate"
  ];

  const reviewSelectOptionsByLabel = {
    "auto renew": ["Yes", "No", "Ongoing", "Unknown", "Needs Review"],
    "auto renewal": ["Yes", "No", "Ongoing", "Unknown", "Needs Review"],
    "auto-renewal": ["Yes", "No", "Ongoing", "Unknown", "Needs Review"],
    "contract status": ["Active", "Pending", "Expired", "Terminated", "Replaced", "Do Not Use", "Needs Legal Review"],
    "risk": ["Low", "Medium", "High", "Critical", "Needs Review"],
    "insurance certificate": ["Received", "Missing", "Expired", "Not Required", "Needs Review"]
  };

  return { reviewChecklistFields, financeSupportFields, primaryReviewLabels, reviewSelectOptionsByLabel };
})();
