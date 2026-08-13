window.CONTRACT_APP_BOOTSTRAP = (() => {
  const categories = [
    "Dialysis / Patient Transfer", "Dental Services", "Healthcare Services", "Medical Director", "Medical Practitioner", "Lab / Diagnostics",
    "Electric", "Gas", "Water/Sewer", "Oxygen", "Medical Gas", "Waste Removal",
    "Laundry", "Pest Control", "Maintenance", "Elevator", "HVAC", "IT/Software",
    "Internet/Telecom", "Insurance", "Staffing", "Therapy", "Pharmacy",
    "Transportation", "Food/Dietary", "Medical Supplies", "Legal/Compliance", "BAA / Data Privacy", "Other"
  ];

  const facilitySeedData = [
    "Amsterdam", "Bannister", "Beth Abraham", "Bishop", "Boro Park", "Bronx", "Brooklyn",
    "Buffalo", "Bushwick", "Carthage", "Concord", "Cooperstown", "Corning", "Delmar",
    "Deptford", "Ellicott", "Essex", "Far Rockaway", "Fulton", "Glens Falls",
    "Granville Center", "Hammonton", "Holliswood", "Hope Center", "Kingston", "Martine",
    "Mills Pond", "New Paltz", "Northern Manor", "Northern Metropolitan", "Northern Riverview",
    "Oak Hill", "Oneida Center", "Onondaga", "Ontario", "Richmond", "Rochester", "Sayville",
    "Schenectady", "Slate Valley", "St. Patrick", "Steuben County", "Topeka", "Triboro",
    "Troy", "University", "Warren", "Washington", "Wichita", "Williamsbridge", "Willow Point"
  ].map(name => ({ name, source: "starter facility master" }));

  const vendorSeedData = [
    { name: "Dentserv Dental Services", category: "Dental Services" },
    { name: "Patient Care Associates", category: "Radiology" },
    { name: "Primary Vascular Care", category: "Medical Practitioner / Vascular" },
    { name: "FirstLight Fiber", category: "Internet / Telecom" },
    { name: "HK Parking", category: "Rental / Parking" },
    { name: "Citi Security", category: "Security" },
    { name: "Constellation", category: "Electric" },
    { name: "Airgas USA LLC", category: "Medical Gas" },
    { name: "Advowaste Medical Services, LLC", category: "Medical Waste" },
    { name: "Scenic View Hardscapes, Inc.", category: "Snow Removal" }
  ];

  const contractTemplates = [
    {
      name: "Business Associate Agreement (BAA)",
      contractType: "Business Associate Agreement",
      category: "BAA / Data Privacy",
      length: "Ongoing while protected health information is shared",
      renewal: "Ongoing",
      renewalTerm: "No automatic renewal cycle; obligations continue while PHI is handled and as required after termination.",
      termination: "Either party may terminate for material breach if the breach is not cured. PHI must be returned or destroyed when feasible, and required privacy obligations survive termination.",
      notice: "As stated in the BAA or underlying service agreement",
      paymentTerms: "No payment - data sharing agreement",
      daysPayable: "Not applicable",
      terms: "Use when a vendor or other business associate creates, receives, maintains, or transmits protected health information for the Facility. A BAA governs permitted PHI use, safeguards, breach reporting, subcontractors, access/amendment/accounting support, return or destruction of PHI, and survival. It may stand alone or be attached to a service agreement. No money needs to change hands.",
      language: `BUSINESS ASSOCIATE AGREEMENT

This Business Associate Agreement is entered into between Facility, as Covered Entity, and Vendor/Provider, as Business Associate, under the Health Insurance Portability and Accountability Act of 1996, the HITECH Act, and their implementing regulations.

Business Associate may use or disclose Protected Health Information only as necessary to perform services for Facility, as permitted by the underlying agreement, or as required by law. Business Associate shall not use or disclose PHI in a manner that would violate applicable privacy requirements if done by Facility.

Business Associate shall maintain appropriate administrative, physical, and technical safeguards; comply with the Security Rule for electronic PHI; promptly report unauthorized use, disclosure, breach, or security incident; mitigate harmful effects; and provide information required for Facility's breach analysis and notification duties.

Business Associate shall ensure that subcontractors with access to PHI agree in writing to equivalent restrictions and safeguards. Business Associate shall support access, amendment, accounting of disclosures, regulatory inspection, and other individual-rights obligations as reasonably requested by Facility.

Upon termination, Business Associate shall return or destroy PHI when feasible. If return or destruction is infeasible, Business Associate shall continue to protect the PHI and limit further use or disclosure. These obligations survive termination. This BAA does not require either party to pay the other unless a separate service agreement states otherwise.`
    },
    {
      name: "Medical Director Service Agreement",
      contractType: "Medical Director Service Agreement",
      category: "Medical Director",
      length: "1 year",
      renewal: "Yes",
      renewalTerm: "Automatically renews for additional 1-year terms unless terminated under the agreement.",
      termination: "Facility may request removal/replacement of the Medical Director. Either party may terminate according to the written notice/cause provisions in the final agreement.",
      notice: "30 days",
      paymentTerms: "Net 30",
      daysPayable: "30 days",
      terms: "Use when the Facility engages an outside professional corporation/provider to supply a physician Medical Director. Fill in provider name/address, physician name if known, compensation, effective date, term, insurance, compliance requirements, and signature blocks.",
      language: `MEDICAL DIRECTOR SERVICE AGREEMENT TEMPLATE

Facility operates a skilled nursing facility and desires to engage Provider to provide a licensed physician to serve as Medical Director. Provider represents that it employs, retains, or otherwise engages qualified physicians who can render medical director services on behalf of Provider.

Provider shall provide Facility with a licensed physician to serve as Medical Director. If the assigned physician cannot serve, Provider shall provide a replacement physician reasonably acceptable to Facility. The Medical Director shall report to the Facility Administrator.

Medical Director duties shall include implementation and dissemination of resident medical care policies; coordination of physician services and medical care; review of physician, dentist, and podiatrist credentials before granting or renewing privileges; participation in quality assessment, incident review, grievance review, resident safety, infection control, and performance improvement activities; review of professional competence; participation in resident care conferences when requested; and other administrative services customarily furnished by a Medical Director of a skilled nursing facility in New York.

Provider shall ensure that the Medical Director holds and maintains a current unrestricted New York medical license, valid DEA certification where applicable, good standing under Medicare and Medicaid, required credentialing, professional liability coverage, and all other qualifications reasonably required by Facility.

Provider and Medical Director shall comply with Facility policies, medical staff bylaws, compliance program requirements, Public Health Law, 10 NYCRR Part 415, personnel/health requirements, privacy/HIPAA requirements, and all other applicable federal, state, and local laws.

Facility retains ultimate authority over operation, policies, books, records, assets, licenses, resident care operations, and compliance of the Facility. Provider and Medical Director are independent contractors and may not bind Facility except as expressly authorized in writing.

Facility may request removal or replacement of the assigned Medical Director at any time, with or without cause, without terminating the Agreement. Provider shall provide a substitute physician reasonably satisfactory to Facility.

Provider shall maintain records, documentation, reports, credentialing evidence, insurance evidence, and compliance materials reasonably requested by Facility or regulators. All Facility medical records, charts, reports, and resident records remain property of Facility.

Include final compensation terms, fair market value language, no-referral/no-kickback language, confidentiality, HIPAA/business associate language if applicable, insurance, indemnification, audit rights, term, renewal, termination, notice addresses, and signature blocks before sending.`
    },
    {
      name: "Physician Services Agreement - Billing Only",
      contractType: "Physician Services Agreement",
      category: "Medical Practitioner",
      length: "1 year",
      renewal: "Yes",
      renewalTerm: "Initial 1-year term, then automatic 1-year renewals unless terminated under the agreement.",
      termination: "Either party may terminate for cause or under the written notice provisions in the final agreement.",
      notice: "30 days",
      paymentTerms: "Net 30",
      daysPayable: "30 days",
      terms: "Use for outside physician/clinical professional services where Consultant bills residents, Medicare Part B, Medicaid, third-party insurance, or Facility only when required under global/capitated/all-inclusive payment rules. Fill in specialty, coverage schedule, billing rules, fee schedule, insurance, compliance, and termination.",
      language: `PHYSICIAN SERVICES AGREEMENT TEMPLATE

Facility is a residential health care facility operated pursuant to Article 28 of the Public Health Law of the State of New York. Consultant employs, retains, or otherwise engages licensed physicians or clinical professionals qualified to render the agreed services for long term care residents.

Facility engages Consultant to provide physician or clinical professional services to residents as mutually agreed by Consultant and Facility. Services shall be provided in accordance with all applicable federal and state laws, regulations, rules, Facility policies, credentialing requirements, payer requirements, and professional standards.

Facility retains ultimate authority over the overall policy, operation, assets, books, records, licenses, permits, resident care operations, and policies of the Facility. Facility does not delegate to Consultant any authority or responsibility not specifically allocated in the Agreement.

The parties are independent contractors. Neither party is the agent, employee, partner, or joint venturer of the other, and neither party may bind the other except as expressly stated in the Agreement.

Consultant responsibilities shall include providing services according to a mutually agreeable schedule; attending residents as needed or requested by Facility; documenting visits and services under Facility policies and applicable law; attending required meetings when requested; participating in care conferences when appropriate; maintaining required credentials; meeting personnel/health requirements; and promptly notifying Facility of license, privilege, exclusion, investigation, insurance, or program participation issues.

Consultant shall maintain medical, service, billing, and financial records required by law and reasonably requested by Facility. Facility records, resident records, medical charts, reports, and supporting documents prepared in connection with services remain the property of Facility.

Billing language should state whether Consultant bills residents, Medicare Part B, Medicaid, third-party payors, or Facility. Where services are included in a global, capitated, PPS, bundled, or all-inclusive rate payable to Facility, Consultant shall bill Facility only according to the approved fee schedule and shall not bill residents or other payors for those services. Consultant shall use appropriate HCPCS, ICD, CPT, and other required codes and submit invoices within the agreed deadline.

Compensation must be fair market value, commercially reasonable, and not intended as an inducement or payment for referrals. Include no-referral/no-kickback language, privacy/HIPAA, confidentiality, compliance, insurance, indemnification, audit rights, non-exclusivity, term, automatic renewal, termination, notice, and signature blocks before sending.`
    },
    {
      name: "Ambulance / Ambulette Transportation Agreement",
      contractType: "Transportation Agreement",
      category: "Transportation",
      length: "1 year",
      renewal: "Yes",
      renewalTerm: "Automatically renews for additional 1-year terms unless terminated.",
      termination: "Either party may terminate without cause upon 30 days written notice.",
      notice: "30 days",
      paymentTerms: "Net 30",
      daysPayable: "30 days",
      terms: "Use for ambulance, ambulette, and resident transportation. Fill in service hours, 24/7 ambulance availability if applicable, pickup/wait rules, mileage/base rates, no-show charges, private-pay rates, insurance, licenses, permits, Medicaid/LogistiCare status, evacuation support, and billing rules.",
      language: `AMBULANCE / AMBULETTE TRANSPORTATION AGREEMENT TEMPLATE

Facility operates a residential health care facility, assisted living program, adult day health care program, or similar facility licensed under applicable New York law and has patients, residents, or registrants who require ambulance and/or ambulette transportation services to and from Facility.

Facility engages Company as a provider of transportation services on an as-needed basis. Company shall provide ambulances, ambulettes, drivers, attendants, equipment, vehicles, supervision, and personnel that meet or exceed applicable legal and regulatory requirements.

The Agreement should commence on the Effective Date for an initial term of one (1) year and automatically renew for additional one (1) year renewal terms unless terminated. Either party may terminate without cause upon thirty (30) days written notice unless a different notice period is inserted.

Company shall provide ambulance services on a 24-hour basis, 365 days per year when specifically ordered by authorized Facility personnel. Ambulance services shall comply with Article 30 of the Public Health Law, Part 800 of Title 10 NYCRR, State Emergency Medical Service Code requirements, and all other applicable laws. Non-emergency ambulance transports shall require physician certification when required by law or payer rule.

Company shall provide ambulette services during the agreed service hours and at other times mutually agreed by the parties. Ambulette services shall comply with Article 19-A of the New York Vehicle and Traffic Law, applicable Department of Transportation rules, DMV requirements, Taxi and Limousine Commission requirements where applicable, and any other agency rules governing this transportation mode.

Company shall maintain vehicles and equipment in safe, clean, good mechanical condition and shall provide vehicle inspection, maintenance, registration, license, permit, and certificate records upon Facility request. Company shall maintain all required ambulance certificates, transportation permits, Medicaid provider status, transportation manager approvals, driver licenses, training records, background checks, drug testing records, and safety instruction records.

Company shall operate vehicles safely and professionally; ensure use of available safety equipment; never leave patients unattended; require proper identification and uniforms while on Facility property; notify Facility immediately of delays, safety concerns, accidents, patient refusal, or service issues; and deliver patients timely for appointments.

Timeliness terms should include delay notice, patient wait time, unscheduled service response time, inpatient discharge response time, emergency response expectations, and any facility-specific pickup rules.

Company shall comply with federal and state exclusion screening requirements, including OIG, SAM, OMIG, or successor databases, and shall promptly notify Facility if any employee, agent, subcontractor, or provider is excluded from participation in a federal or state health care program.

For evacuation events, Company should maintain mutual aid arrangements, provide an experienced on-scene coordinator when required, and coordinate transportation to nearby nursing, adult care, hospital, or other designated receiving facilities.

Billing language must clearly state Medicare, Medicaid, Part A/PPS, private-pay, facility-responsible, third-party payer, no-show, wait time, mileage, wheelchair, stretcher, ambulance, ambulette, and other rate schedule terms. Company shall not bill Facility, residents, or payors in a manner inconsistent with applicable law or the attached rate schedule.

Include insurance, indemnification, confidentiality, HIPAA where applicable, compliance hotline/manual acknowledgement if required, records/audit rights, notices, fee schedule exhibit, and signature blocks before sending.`
    },
    {
      name: "Standard Service Agreement",
      contractType: "Service Agreement",
      category: "Other",
      length: "1 year",
      renewal: "Yes",
      renewalTerm: "Automatically renews for additional 1-year terms unless terminated.",
      termination: "Either party may terminate with 30 days written notice.",
      notice: "30 days",
      paymentTerms: "Net 30",
      daysPayable: "30 days",
      terms: "Vendor will provide the services described in the contract schedule. Facility, fees, service levels, insurance, payment terms, and any special requirements must be reviewed before signature."
    },
    {
      name: "Maintenance / Service Agreement",
      contractType: "Maintenance Agreement",
      category: "Maintenance",
      length: "1 year",
      renewal: "Yes",
      renewalTerm: "Automatically renews for additional 1-year terms unless either party gives notice.",
      termination: "Either party may terminate with 30 days written notice.",
      notice: "30 days",
      paymentTerms: "Net 30",
      daysPayable: "30 days",
      terms: "Vendor will perform scheduled maintenance, emergency service if selected, and related repair work according to the attached service schedule and approved fee schedule."
    },
    {
      name: "Transportation Agreement",
      contractType: "Transportation Agreement",
      category: "Transportation",
      length: "1 year",
      renewal: "Yes",
      renewalTerm: "Automatically renews for additional 1-year terms unless terminated.",
      termination: "Either party may terminate with 30 days written notice.",
      notice: "30 days",
      paymentTerms: "Net 30",
      daysPayable: "30 days",
      terms: "Vendor will provide transportation services for residents or patients. Rates, mileage, waiting time, no-show rules, billing rules, insurance, and pickup requirements must be completed before signature."
    },
    {
      name: "Pharmacy Agreement",
      contractType: "Pharmacy Agreement",
      category: "Pharmacy",
      length: "1 year",
      renewal: "Yes",
      renewalTerm: "Renews unless terminated according to the notice period.",
      termination: "Either party may terminate with 60 days written notice.",
      notice: "60 days",
      paymentTerms: "Net 30",
      daysPayable: "30 days",
      terms: "Vendor will provide pharmacy services, medication supply, billing support, consulting support if selected, and compliance documentation according to the facility requirements."
    },
    {
      name: "Laundry / Linen Agreement",
      contractType: "Laundry Services Agreement",
      category: "Laundry",
      length: "1 year",
      renewal: "Yes",
      renewalTerm: "Automatically renews for additional 1-year terms unless terminated.",
      termination: "Either party may terminate with 60 days written notice.",
      notice: "60 days",
      paymentTerms: "Net 30",
      daysPayable: "30 days",
      terms: "Vendor will provide laundry or linen services. Price per pound, delivery schedule, replacement charges, minimums, surcharges, and service exceptions must be added before approval."
    },
    {
      name: "Oxygen / Medical Gas Agreement",
      contractType: "Medical Gas Agreement",
      category: "Oxygen",
      length: "1 year",
      renewal: "Yes",
      renewalTerm: "Automatically renews unless terminated according to the notice period.",
      termination: "Either party may terminate with 30 days written notice.",
      notice: "30 days",
      paymentTerms: "Net 30",
      daysPayable: "30 days",
      terms: "Vendor will provide oxygen, medical gas, equipment rental, delivery, tank exchange, and related services. Unit rates, rental rates, delivery fees, minimums, and compliance requirements must be reviewed."
    },
    {
      name: "Waste / Environmental Agreement",
      contractType: "Waste Services Agreement",
      category: "Waste Removal",
      length: "1 year",
      renewal: "Yes",
      renewalTerm: "Automatically renews unless terminated according to the notice period.",
      termination: "Either party may terminate with 60 days written notice.",
      notice: "60 days",
      paymentTerms: "Net 30",
      daysPayable: "30 days",
      terms: "Vendor will provide waste, recycling, regulated waste, grease trap, or environmental services. Container size, pickup schedule, disposal fees, fuel fees, overage fees, and special charges must be completed."
    },
    {
      name: "Addendum / Amendment",
      contractType: "Addendum",
      category: "Other",
      length: "Matches existing contract",
      renewal: "No",
      renewalTerm: "Uses the renewal terms of the existing contract unless changed here.",
      termination: "Uses the termination terms of the existing contract unless changed here.",
      notice: "Matches existing contract",
      paymentTerms: "Matches existing contract",
      daysPayable: "",
      terms: "This addendum amends the existing contract. List exactly what changes: fee, facility, service schedule, term, renewal, termination, insurance, or other special terms."
    }
  ];

  return { categories, facilitySeedData, vendorSeedData, contractTemplates };
})();
