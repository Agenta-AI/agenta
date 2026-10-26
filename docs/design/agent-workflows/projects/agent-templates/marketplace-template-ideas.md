# Marketplace template ideas: research and shortlist

Research date: 2026-10-26. This file proposes new templates for the marketplace catalog
(`api/oss/src/resources/agent_templates/catalog.json`). It does not repeat the 31 templates
that ship today (see [template-inventory.md](template-inventory.md) plus `job-hunt-research`,
`outbound-prospecting`, `seo-content-agent`).

## How the ideas were picked

Every idea passes four filters:

1. **Light on compute.** One trigger, a few tool reads, one or two LLM calls (classify,
   extract, compare, draft), one write. No research loops, no crawling, no media generation,
   no model training. The heaviest step allowed is reading one PDF per LLM call.
2. **A real workflow or a real headache.** Each idea replaces a recurring manual task or
   removes a pain point that a survey, a benchmark, or a marketplace gap backs up.
3. **Draft first.** The agent writes a draft, a sheet row, a ticket, or a Slack approval
   message. A human sends anything that touches money, legal terms, prices, health, or
   hiring decisions. Auto-send is allowed only for fixed, low-risk reminders.
4. **Buildable on today's platform.** Composio tools plus a schedule, an event subscription,
   a mention, or a manual run. When an industry's system of record is not in Composio (Clio,
   AppFolio, Applied Epic, Wealthbox, Karbon), the template works through email, Sheets, and
   Drive instead.

Evidence tags: **[V]** a named survey or benchmark, **[Vv]** a vendor source that sells a fix
(treat as directional), **[I]** inference. Check a number against its primary source before
it goes on a public card.

## What the market tells us

- **Competitor catalogs crowd around sales and support.** Lead management is about one third
  of 10,000 AI workflows Zapier analysed (March 2026) [V]. Agenta already covers that ground.
- **Finance back office is under-served.** Invoice intake and payment reminders appear in
  Relevance, Zapier, and n8n, but mostly as Sheets or webhook hacks, not native
  QuickBooks/Xero/Stripe agents [V].
- **Vertical small businesses get prompt guides, not templates.** Property managers,
  trades, law firms, clinics, nonprofits, and schools find paid Gumroad bundles (one law-firm
  n8n bundle sells for $499.99) or nothing at all [V]. This is the clearest open space.
- **Google Sheets, Slack, and Gmail dominate.** In an index of 13,113 n8n templates, Sheets
  appears in 5,471, Slack in 3,816, Gmail in 3,617 [V]. Templates that run on these three
  reach the most users.
- **Two shapes repeat in every industry.** See the next section.

## Two base patterns

Almost every idea below is one of two shapes. Build each shape once, well, and make most
templates a configuration of it. This keeps the playbooks short and the quality even.

| Pattern | Shape | Examples |
|---|---|---|
| **Inbound extractor** | An email, file, form, or webhook arrives. The agent classifies it, extracts fields, writes a structured row or ticket, and drafts a reply. | AP invoice intake, COI request triage, freight quote extractor, maintenance triage, legal intake |
| **Scheduled chaser** | On a schedule, the agent compares what is expected against what arrived, then drafts nudges that get firmer in steps and posts a digest. | Invoice chaser, document chaser, scorecard chaser, timesheet chaser, grant deadline tracker |

## Build first: the top 15

Ranked by pain size x how often it recurs x how many industries use it x ease to build.

| # | Key | Template | Pattern | Who uses it | Trigger | Main tools | Why (evidence) |
|---|---|---|---|---|---|---|---|
| 1 | `invoice-chaser` | Invoice chaser | Chaser | Any business, accountants, agencies, freelancers, trades | Daily | QuickBooks/Xero/Stripe, Gmail, Slack | 85% of freelancers had a late payment [V]. UK small firms get paid 8.3 days late on average [V, Xero]. 35-44% of B2B invoices paid late in some regions [V, Atradius 2025]. |
| 2 | `ap-invoice-intake` | AP invoice intake | Extractor | Finance teams, bookkeepers | New email with PDF in AP inbox | Gmail/Outlook, QuickBooks/Xero, Drive | APQC median cost $5.83 per invoice, bottom quartile $10+ [V]. Duplicate payments are 0.1-0.5% of B2B payments [Vv]. |
| 3 | `inbox-triage` | Inbox triage | Extractor | Founders, execs, EAs, anyone | New email + twice-daily digest | Gmail/Outlook, Slack | Top theme in Lindy and Zapier catalogs [V]. Workers get about 117 emails a day [Vv, Microsoft WTI 2025]. |
| 4 | `review-reply-drafter` | Review reply drafter | Extractor | Restaurants, trades, clinics, salons, hotels | New Google review | Google Business Profile, Slack | 89% of consumers expect owners to reply to all reviews [V, BrightLocal 2025]. No marketplace template found [V]. |
| 5 | `document-chaser` | Client document chaser | Chaser | Accountants, lenders, insurance, HR, freight | Weekly + new email/file | Sheets/Drive, Gmail | 69% of accountants spend too much time gathering client documents [V, Canopy]. Late client documents are the #1 firm challenge [V, Wolters Kluwer]. |
| 6 | `contract-renewal-radar` | Contract renewal radar | Chaser | Finance, procurement, legal, ops | New contract in Drive + weekly | Drive/DocuSign, Sheets, Slack, Calendar | Companies lose about 9% of annual revenue to poor contract management [V, WorldCC 2025]. |
| 7 | `nda-triage` | NDA triage | Extractor | In-house legal, founders, private markets | Email or file with an NDA | Gmail/Outlook, Drive, DocuSign, Slack | 65% spend 6+ hours a week on NDAs [V, Ontra]. 56% take a week or more to close an NDA [V, SpotDraft 2025]. |
| 8 | `security-questionnaire` | Security questionnaire answerer | Extractor | B2B SaaS sales and security | New file in folder or mention | Drive/Notion/Confluence, Sheets, Slack | 12-40 hours per questionnaire [Vv]. Blocks revenue. Retrieval over a small corpus. |
| 9 | `inquiry-responder` | Speed-to-lead inquiry responder | Extractor | Law firms, real-estate agents, trades, agencies | New inquiry email or form | Gmail/Outlook, Calendar, Calendly, Sheets/CRM | Only 33% of law firms answered an email inquiry [V, Clio 2024]. 73% of buyers interview only one agent [V, NAR]. Differs from `lead-qualifier`: first reply in minutes for service businesses, not CRM enrichment. |
| 10 | `interview-coordinator` | Interview scheduler and scorecard chaser | Chaser | Recruiters, hiring managers | ATS stage change; 24 h after interview | Greenhouse/Lever, Calendar, Gmail, Slack | 67% of recruiters need 30 min to 2 h per interview to schedule [V, Yello]. Mean scorecard delay is 36 h [Vv, Metaview]. |
| 11 | `wismo-responder` | Order status responder | Extractor | Shopify and DTC brands | New support email or ticket | Gmail/Gorgias/Zendesk, Shopify | "Where is my order" is about 18% of e-commerce support volume [Vv, Gorgias data]. |
| 12 | `maintenance-triage` | Maintenance request triage | Extractor | Property managers, landlords, STR hosts | New tenant email or form | Gmail, Sheets, Slack, SMS | Maintenance is owners' #1 stress [V, Buildium 2026]. Repair delays are the #1 tenant complaint [V]. Only form or voice templates exist elsewhere [V]. |
| 13 | `saas-license-auditor` | SaaS license auditor | Chaser | IT, finance, ops | Monthly; 60 days before renewal | Google Workspace admin/Okta, Sheets, Slack | 46% of licenses unused in a 30-day window [Vv, Zylo 2025]. Read-only queries plus drafts. |
| 14 | `meeting-prep-brief` | Meeting prep brief | Chaser | Advisors, sales, CSMs, founders | 24-48 h before external meetings | Calendar, CRM, Gmail | Advisors spend 5.3 h a week on meeting prep [V, Kitces]. Common in Lindy and Zapier [V]. |
| 15 | `no-show-reducer` | No-show reducer and waitlist filler | Chaser | Clinics, dentists, salons, studios, tutors | 72 h and 24 h before; on cancel | Calendar or Sheets export, SMS/Gmail | Mean clinic no-show rate 18.8% [V, BMC HSR]. Reminders cut no-shows from 23.1% to 17.3% in a trial [V, Am J Med]. |

## Full catalog by area

Each row lists the key, what the agent does, the trigger, the human step, and the evidence.
Rows already in the top 15 are not repeated.

### Finance operations (any company)

| Key | Template | What it does | Trigger | Human step | Evidence |
|---|---|---|---|---|---|
| `expense-policy-checker` | Expense policy checker | Flags each expense line against the policy PDF (missing receipt, over limit, duplicate) and cites the clause. | New expense report (Brex/Ramp) or weekly batch | Approver decides | 19% of expense reports contain errors; each fix costs $52 [V, GBTA, old]. |
| `vendor-statement-reconciler` | Vendor statement reconciler | Matches a vendor statement against the ledger and lists missing invoices, unapplied payments, and credits. | Email with "statement"; monthly | Report only | Statements arrive in mixed formats that AP tools do not ingest [Vv]. |
| `close-chaser` | Month-end close chaser | Reads the close checklist, nudges owners on business days 1-6, posts a daily close status. | Close calendar | None (nudges only) | APQC median close is 6 days; bottom quartile 10+ [V]. |
| `po-invoice-matcher` | PO and invoice matcher | Matches an incoming invoice to the purchase order and receipt; flags price or quantity gaps. | New invoice in AP inbox | AP approves | Only beam.ai offers it as a template [V]. |
| `chargeback-packager` | Chargeback evidence packager | Gathers order, tracking, and customer-thread evidence for the dispute reason code; alerts before the deadline. | Stripe dispute created | Human submits | Response windows are 7-21 days; a missed one loses the dispute [Vv]. |

### Procurement and vendor management

| Key | Template | What it does | Trigger | Human step | Evidence |
|---|---|---|---|---|---|
| `purchase-request-intake` | Purchase request intake | Turns a free-text Slack or email request into a structured request (vendor, cost, data risk, overlap with existing tools) and routes it to the approver. | Mention or form | Approver decides | About 40% of SaaS spend is unmonitored [Vv, Gartner via press]. |
| `vendor-onboarding-chaser` | Vendor onboarding chaser | Requests W-9, insurance certificate, and security answers; checks expiry dates; chases until complete. | New vendor row | Human enters bank details (fraud risk) | [I] Common AP pain; no hard stat found. |

### Legal operations and compliance

| Key | Template | What it does | Trigger | Human step | Evidence |
|---|---|---|---|---|---|
| `legal-request-router` | Legal request router | Classifies requests (contract, privacy, employment, IP), extracts deadline and counterparty, logs them, and answers FAQs from approved text. | Mention or email to legal@ | Counsel owns answers | 43% of corporate counsel say contracts are half their day [V, Bloomberg Law]. |
| `soc2-evidence-chaser` | Compliance evidence chaser | Opens a ticket per recurring evidence item, reminds the owner, checks the upload matches the request. | Control calendar | Human reviews the audit pack | First manual SOC 2 takes 400-600 h [Vv]. |
| `policy-attestation-tracker` | Policy attestation tracker | DMs staff to acknowledge updated policies, keeps the roster, escalates to managers. | Policy change; quarterly | None | [I] Standard audit requirement. |

### People operations and recruiting

| Key | Template | What it does | Trigger | Human step | Evidence |
|---|---|---|---|---|---|
| `resume-screen-summary` | Resume screen summary | Maps each application to the must-have criteria, lists evidence and gaps. Never rejects. | New application | Recruiter decides | Top theme in Lindy and Dust [V]. Must follow NYC LL 144 and EEOC guidance. |
| `hr-policy-answerer` | HR policy answerer | Answers PTO, payroll-date, and benefits questions from the handbook with citations; looks up balances; escalates sensitive topics. | Mention or DM | Escalates leave, medical, harassment | 47% of HR leaders spend 4+ h a day on repeat questions [Vv, isolved]. HR flavour of `knowledge-chatbot`. |
| `offboarding-runner` | Offboarding checklist runner | Drafts per-app deprovisioning tickets, the manager handover list, and the hardware-return email. | HRIS termination event | IT executes | 48% of former staff keep app access months later [Vv, CloudEagle]. |
| `timesheet-chaser` | Timesheet chaser (staffing) | Compares submitted timesheets with active placements, chases workers and client approvers, flags odd hours. | Weekly | None | Back offices spend about 12 h a week chasing timesheets [Vv, Avionte]. |
| `candidate-status-updater` | Candidate status updater | Drafts a status note to every candidate stuck in a stage for N days, so nobody gets ghosted. | Daily | Recruiter sends | Ghosting post on r/recruiting got 7,000+ upvotes [V]. |

### IT helpdesk

| Key | Template | What it does | Trigger | Human step | Evidence |
|---|---|---|---|---|---|
| `access-request-router` | Access request router | Classifies "I need access to X", finds the app owner, sends an approval DM, opens the ticket. | Mention or ticket | Approver clicks approve | Access requests are 30-40% of tickets [Vv]. |
| `password-reset-deflector` | Lockout and reset deflector | Replies with the right self-service reset steps; routes to a human when identity proof is needed. Never resets credentials. | New ticket or DM | Human for identity checks | Password issues are 20-50% of help-desk calls; about $70 each [Vv, Gartner/Forrester via press]. |

### Customer success

| Key | Template | What it does | Trigger | Human step | Evidence |
|---|---|---|---|---|---|
| `renewal-risk-digest` | Renewal risk digest | Lists accounts that renew in 90 days with a risk reason (ticket spikes, failed payments, champion left). | Weekly | Digest only | [I] Widely cited retention economics; primary source not found. |
| `qbr-prep-pack` | QBR prep pack | Builds a one-page brief (usage, tickets, open asks, expansion angle) before each QBR event. | Calendar event "QBR", 3 days ahead | CSM edits | [I] |
| `churn-signal-watcher` | Churn signal watcher | Alerts the owner on a cancel-intent ticket, downgrade, or low NPS, with context and a save draft. | Event | CSM sends | [I] |

### Executive and personal productivity

| Key | Template | What it does | Trigger | Human step | Evidence |
|---|---|---|---|---|---|
| `calendar-guard` | Calendar conflict guard | Finds double bookings, missing agendas, and no travel buffer; proposes fixes. | Daily 07:00; new invite | EA moves meetings | Scheduling assistants appear in Retool, Zapier, Lindy [V]. |
| `investor-update-drafter` | Investor update drafter | Drafts the monthly investor or board update from the KPI sheet and CRM in the house format. | Monthly | CEO edits | [I] Recurring founder chore. |
| `daily-inbox-digest` | Daily inbox digest | Sends one morning summary: what needs a reply, what waits, what is FYI. | Daily | None | Zapier "Inbox Summarizer" [V]. Could ship as a mode of `inbox-triage`. |

### Product and marketing operations

| Key | Template | What it does | Trigger | Human step | Evidence |
|---|---|---|---|---|---|
| `prd-drafter` | PRD drafter | Turns a Slack thread or epic into a PRD skeleton (problem, evidence, scope, open questions) in Notion. | Mention or epic created | PM edits | [I] |
| `release-enablement-pack` | Release enablement pack | Writes the internal FAQ for sales and support plus a customer email for each release. | Cycle closed or release tag | Draft only | Differs from `changelog-writer`: audience is GTM teams. |
| `webinar-followup` | Webinar follow-up | Segments attendees (attended, asked a question, no-show), drafts emails per segment, sends hot leads to sales. | Attendee list lands | Drafts queued | About 56% of registrants attend [Vv, ON24]. |
| `campaign-digest` | Campaign performance digest | Writes a narrative of week-over-week campaign metrics from HubSpot or a metrics sheet. | Weekly | None | [I] |
| `kb-gap-finder` | Help-center gap finder | Reads resolved tickets, finds questions with no help article, drafts the missing articles. | Weekly | Support lead approves | HubSpot Knowledge Base Agent is one of its 4 GA agents [V]. |
| `crm-hygiene-auditor` | CRM hygiene auditor | Lists duplicates, missing fields, and bad formats; proposes merges. | Weekly | Ops applies fixes | HubSpot Data Agent [V]. |

### Sales operations (beyond today's sales templates)

| Key | Template | What it does | Trigger | Human step | Evidence |
|---|---|---|---|---|---|
| `rfp-drafter` | RFP response drafter | Gives a go/no-go summary (requirements, deadlines) and drafts answers per question from the answer library. | New RFP file | Proposal team owns final | 24-35 h per RFP [Vv, Loopio]. Long files: process one section per call. |
| `deal-desk-router` | Deal desk router | Detects non-standard discounts or terms and sends an approval request with context to the right approver. | CRM deal update | Approver decides | Reps spend only 28% of the week selling [V, Salesforce]. |
| `commission-explainer` | Commission explainer | Explains a rep's payout line by line from the comp sheet; opens a ticket when numbers do not match. | Mention | Sales ops resolves | 77% of sellers saw payout errors [Vv]. |
| `proposal-drafter` | Proposal drafter | Fills the proposal template from CRM fields at a deal stage change. | Deal stage | Rep sends | [I] |

## Industry packs (outside tech)

Each pack is a set of templates for one industry. Most are configurations of the two base
patterns, with the industry's words, fields, and compliance rules in the playbook.

### Accounting and bookkeeping firms

| Key | Template | What it does | Trigger | Evidence |
|---|---|---|---|---|
| `uncategorized-txn-asker` | Uncategorized transaction asker | Pulls "Ask My Accountant" lines, groups by vendor, suggests a category, drafts one plain question email to the client, reads the reply, proposes recategorizations. | Month-end | One firm sent about 350 such spreadsheets a month [V]. |
| `tax-notice-summarizer` | Tax notice summarizer | Extracts notice type, tax year, amount, and deadline from an IRS or state letter; creates the deadline and a client explanation draft. | New file in Notices folder | [I] |
| `engagement-letter-nudger` | Engagement letter nudger | Chases unsigned engagement letters before season starts. | Schedule | [I] |
| also | `document-chaser`, `invoice-chaser`, `inbox-triage` | | | |

Compliance: no tax advice; draft only; return data stays in approved storage (IRC 7216).

### Law firms and in-house legal

| Key | Template | What it does | Trigger | Evidence |
|---|---|---|---|---|
| `docket-deadline-extractor` | Docket deadline extractor | Extracts hearing and response dates from court notices; creates calendar entries marked "verify". | New court notice | [I] Missed deadlines are a top malpractice cause. |
| `matter-status-updater` | Matter status updater | Drafts a plain-language update for each client from matter notes and recent email. | Bi-weekly | 79% of clients expect a reply within 24 h [V, Clio]. |
| also | `inquiry-responder` (with conflict-check fields), `nda-triage`, `legal-request-router` | | | |

Compliance: ABA Formal Opinion 512 (confidentiality, verification, supervision). No legal
advice to prospects. A model provider that does not train on client data.

### Insurance agencies, brokers, claims

| Key | Template | What it does | Trigger | Evidence |
|---|---|---|---|---|
| `coi-request-triage` | COI request triage | Extracts holder, additional-insured wording, and limits; compares with coverage; marks "ready to issue" or "needs CSR". | Email to certs@ | About 100 COIs a day take about 3.5 h [V, IA Magazine]. |
| `renewal-prep-packet` | Renewal prep packet | Drafts the "what changed?" client questionnaire 90/60/30 days out and reads replies into the renewal sheet. | Schedule | Manual renewal takes 45-60 min [Vv]. |
| `quote-comparison` | Quote comparison summarizer | Extracts premium, limits, deductibles, and exclusions from carrier PDFs into a side-by-side table and a client email draft. | Quote PDFs in folder | Brokers lose up to 30 min per packet finding forms [V, Indio]. |
| `fnol-intake` | Claim intake (FNOL) extractor | Extracts policy number, loss date, type, and parties; asks for missing fields. | New claim email or form | Automated FNOL cut entry from 25 to 4 min [Vv]. |

Compliance: no coverage opinions, no binding; a licensed person issues COIs (E&O exposure).

### Real estate and property management

| Key | Template | What it does | Trigger | Evidence |
|---|---|---|---|---|
| `contract-to-close-tracker` | Contract-to-close tracker | Extracts inspection, appraisal, loan, and closing dates from the signed agreement; reminds 3 and 1 days ahead; drafts weekly status to client and lender. | DocuSign envelope completed | A deal has 5-7+ critical dates; a miss can put the client in default [V]. |
| `rental-application-checker` | Rental application checker | Checks the file is complete and that stated income matches pay stubs; flags fraud signals. No accept/deny decision. | New application | 75% of managers saw more rental fraud [V, Buildium 2026]. |
| `lease-renewal-reminder` | Lease renewal and rent reminder | Drafts renewal notices and rent reminders on schedule. | Schedule | [I] |
| `str-guest-concierge` | Short-term rental guest concierge | Answers Wi-Fi, check-in, and parking questions from the property sheet; flags exceptions to the host. | New guest message | Superhost needs 90% replies within 24 h [V, Airbnb]. Hosts report 2-4 h a day on repeat questions [Vv]. |
| `turnover-scheduler` | Turnover scheduler | Creates the cleaning job from a new booking or cancellation and reminds the cleaner. | Booking email or calendar change | [I] |
| also | `inquiry-responder`, `maintenance-triage` | | | |

Compliance: Fair Housing (no screening decisions, no steering words); a human sends legal notices.

### Financial advisors and wealth management

| Key | Template | What it does | Trigger | Evidence |
|---|---|---|---|---|
| `nigo-checker` | Paperwork NIGO checker | Checks account forms for missing signatures, beneficiaries, and fields before they go to the custodian. | New form or envelope | [I] NIGO rework is a known custodian pain. |
| `annual-review-scheduler` | Annual review and RMD reminder | Drafts outreach with a booking link for reviews and required distributions that are due. | Schedule | [I] |
| `advisor-inbox-triage` | Advisor inbox triage | Routes money-movement, address-change, and question emails; sends money movement to verbal verification. | New email | Helps against wire fraud [I]. |
| also | `meeting-prep-brief`, `meeting-followup` (exists) | | | Advisors spend about 2 h of background work per meeting hour [V, Kitces]. |

Compliance: no investment advice; archive drafts and notes (SEC 204-2, FINRA 4511); human
verifies money movement.

### Agencies, consultants, freelancers

| Key | Template | What it does | Trigger | Evidence |
|---|---|---|---|---|
| `client-report-narrator` | Client report narrator | Reads the metrics sheet and writes the "what changed, why, next" narrative for each client. | Monthly | 2-5 h per client report [Vv, Coupler]. 58% of agencies need about 4 h per client to prep [Vv, Databox]. |
| `scope-creep-detector` | Scope creep detector | Compares a client request with the SOW and drafts a change-order reply when it is out of scope. | New client email | [I] |
| `brief-to-proposal` | Brief to proposal skeleton | Extracts budget, goals, and timeline from a new brief into a proposal outline and a CRM row. | New form | [I] |
| also | `invoice-chaser` | | | Freelancers spend about 30 h a year chasing payment [V, Upwork UK]. |

### E-commerce and DTC

| Key | Template | What it does | Trigger | Evidence |
|---|---|---|---|---|
| `cart-recovery-writer` | Personal cart recovery | Writes a short email that names the cart items and answers the likely objection (often shipping cost). | Checkout abandoned | 70.19% abandonment; 47% cite extra costs [V, Baymard]. |
| `returns-exception-handler` | Returns and order exception handler | Classifies address changes, returns, and refund requests; tags the order; drafts the reply. | New support email | No marketplace template found [V]. |
| `product-review-triage` | Product review triage | Tags reviews (defect, sizing, shipping), drafts replies, posts a weekly theme digest. | New review | [I] |
| `fba-reimbursement-watch` | FBA reimbursement watch | Diffs the imported inventory report and drafts claim text for lost or short units. | Weekly | Claim windows expire [Vv]. No Seller Central tool: user imports the report. |
| also | `wismo-responder`, `chargeback-packager` | | | |

### Restaurants and hospitality

| Key | Template | What it does | Trigger | Evidence |
|---|---|---|---|---|
| `group-inquiry-router` | Catering and group inquiry router | Extracts date, headcount, and budget into a sheet and drafts a quote reply. | New inquiry | [I] |
| `shift-swap-board` | Shift swap and sick-call board | Posts the open shift, lists eligible staff, summarizes for the manager. | Staff message | Owners spend about 13 h a week on admin; 87% call staff management most stressful [V, Square/AmEx UK]. |
| `eod-sales-summary` | End-of-day sales summary | Writes a short summary from the POS export or sheet: sales, top items, low stock. | Daily close | [I] Gap in marketplaces. |
| also | `review-reply-drafter`, `str-guest-concierge` | | | 77% of travelers prefer hotels that reply personally to reviews [V, TripAdvisor]. |

### Healthcare and dental front office (non-clinical only)

| Key | Template | What it does | Trigger | Evidence |
|---|---|---|---|---|
| `prior-auth-packet` | Prior-auth packet assembler | Lists missing documents against payer criteria, drafts the cover letter, reminds on due dates. | New "PA needed" row | About 39-43 prior auths per physician per week, about 12-13 staff hours [V, AMA 2024]. |
| `intake-form-chaser` | Intake form chaser | Sends the intake link at booking, reminds 48 h before, lists incomplete forms for the desk. | Appointment booked | [I] |
| `front-desk-triage` | Front-desk inbox triage | Sorts email into billing, records, scheduling, insurance. | New email | Staffing is the top 2025 challenge for 62.2% of dentists [V, ADA HPI]. |
| also | `no-show-reducer`, `review-reply-drafter` (never confirm patient status) | | | |

Compliance: HIPAA. Reminders carry name, date, time, and callback number only. Every tool and
model in the chain needs a BAA (Composio publishes one [V]). No PHI in Slack without a BAA.

### Home services and trades

| Key | Template | What it does | Trigger | Evidence |
|---|---|---|---|---|
| `missed-call-textback` | Missed-call text-back | Texts the caller at once, extracts job type, address, and urgency into a lead row, alerts dispatch. | Missed-call webhook or voicemail email | Home services miss 14% of calls [V, CallRail 2025]. 78% of callers left a business after no answer [V]. |
| `quote-followup` | Quote follow-up chaser | Finds quotes with no answer after 2, 5, and 10 days and drafts follow-ups. | Daily | One firm closed $100K by texting 270 old quotes [V, anecdote]. |
| `job-review-request` | Post-job review request | Sends the review link when a job is complete or the invoice is paid. | Job done or paid | 51% of consumers leave a review when asked [V, BrightLocal]. |
| `maintenance-plan-reminder` | Seasonal maintenance reminder | Reminds customers about tune-ups and books them. | Seasonal schedule | [I] |
| also | `invoice-chaser`, `review-reply-drafter` | | | |

Compliance: TCPA for SMS (consent, STOP handling, quiet hours).

### Logistics and freight brokerage

| Key | Template | What it does | Trigger | Evidence |
|---|---|---|---|---|
| `freight-quote-extractor` | Freight quote extractor | Extracts lane, equipment, dates, and weight into a row; finds duplicates; drafts the reply skeleton. Broker sets the price. | New email in quotes inbox | About 200 of 800 daily emails need a real answer [Vv]. Fast quotes win about 30% more often [Vv]. |
| `shipper-status-digest` | Shipper status digest | Drafts a per-shipper status email from the tracking sheet and carrier replies. | Schedule | 7-8 check calls per load [Vv]. |
| `carrier-onboarding-chaser` | Carrier onboarding chaser | Requests W-9, insurance, and authority documents; chases until complete. | New carrier | [I] |
| `pod-invoice-matcher` | POD and invoice matcher | Matches the proof of delivery to the load and flags missing PODs before invoicing. | Email with POD | [I] |

### Education

| Key | Template | What it does | Trigger | Evidence |
|---|---|---|---|---|
| `parent-email-assistant` | Parent email assistant | Sorts parent email (grades, absence, behaviour, logistics) and drafts replies. | New email | Teachers work about 53 h a week, 15 outside contract [V, RAND 2024]. No template found [V]. |
| `class-newsletter` | Weekly class newsletter | Drafts the Friday update for families from the calendar and lesson notes. | Weekly | [I] |
| `missing-work-nudge` | Missing assignment nudge | Drafts notes to students or parents from the gradebook export. | Weekly | [I] |
| `form-response-summary` | Form response summary | Summarizes permission slips or surveys and lists who has not replied. | Form response | [I] |

Compliance: FERPA. School accounts only; teacher sends.

### Nonprofits

| Key | Template | What it does | Trigger | Evidence |
|---|---|---|---|---|
| `donor-thank-you` | Donor thank-you drafter | Drafts a personal thank-you within 24 h with the receipt note. | New donation | First-time donor retention is about 19.4% [Vv, FEP 2024]. |
| `lapsed-donor-reengage` | Lapsed donor re-engagement | Finds donors with no gift in 11 months and drafts outreach. | Monthly | Overall retention about 42.9% [Vv]. |
| `grant-deadline-tracker` | Grant deadline tracker | Reminds at 30, 14, and 3 days; lists required attachments; drafts report sections from past reports. | Schedule | 75% of grant writers spend 10+ h per application [Vv, Instrumentl]. |
| `volunteer-shift-filler` | Volunteer shift filler | Reminds volunteers and fills gaps after a cancellation. | Schedule or cancel | [I] |

### Events, fitness studios, salons

| Key | Template | What it does | Trigger | Evidence |
|---|---|---|---|---|
| `rsvp-chaser` | RSVP tracker and chaser | Keeps the headcount and dietary sheet; chases non-replies. | Form response; schedule | [I] Weak data. |
| `event-vendor-confirmer` | Event vendor confirmer | Drafts confirmations for load-in time, insurance, and final counts. | Schedule | [I] |
| `new-member-checkin` | New member 90-day check-in | Drafts personal notes to new members with fewer than 4 visits. | Weekly | 45% of new members quit within 90 days [Vv]. |
| `cancellation-saver` | Cancellation save responder | Classifies the reason and drafts a pause or downgrade offer. | Cancel email | [I] |

## Ideas we left out (too heavy or too risky)

- Deep research agents, competitor crawlers, web scrapers (long loops, heavy browsing).
  Exception: a competitor digest that reads only RSS or news feeds stays light.
- Video, image, or voice generation (AI receptionist voice bots, UGC video).
- Spreadsheet analysts that run open-ended analysis over large data.
- Anything that decides on credit, hiring, tenancy, coverage, or clinical care.
- Agents that move money, bind coverage, file with a court or a payer, or reset credentials.

## Integrations to verify before we ship

Many ideas depend on a toolkit that this pass did not verify in Composio. Check each before a
card goes live, and give each a fallback through Gmail, Sheets, or Drive.

- Verify: Google Business Profile, Twilio (SMS and missed calls), Brex, Ramp, Greenhouse,
  Lever, BambooHR, Okta, Google Workspace admin, Gorgias, Klaviyo, PandaDoc.
- Not available, work through email or Sheets: Clio, MyCase, Applied Epic, AMS360, AppFolio,
  Buildium, Wealthbox, Redtail, Karbon, TaxDome, Mindbody, Amazon Seller Central, school SIS.

## Suggested rollout

1. **Wave 1, horizontal (top 15).** Biggest reach, mostly Gmail, Sheets, Slack, and accounting
   tools. Build the two base patterns here.
2. **Wave 2, three vertical packs.** Property management, home services, and accounting firms.
   These have the strongest pain evidence, the weakest competitor coverage, and few
   compliance limits.
3. **Wave 3, regulated packs.** Clinics (HIPAA), law firms (ABA 512), insurance (E&O),
   advisors (SEC/FINRA), education (FERPA). Ship only with draft-only defaults and a
   compliance note on the card.

## Sources

Competitor catalogs:
- https://businesswire.com/news/home/20260311671260/en/Zapier-Analysis-of-10000-AI-Powered-Workflows-Reveals-Lead-Management-as-the-Top-Use-Case-for-AI-Automation
- https://community.n8n.io/t/i-indexed-13-113-n8n-workflow-templates-heres-what-people-actually-automate/323360
- https://www.lindy.ai/templates/meeting-notetaker
- https://marketplace.relevanceai.com/agents/ai-invoice-processing
- https://www.blakeoliver.com/blog/xero-bill-data-entry-zapier-ai-agent-free-template
- https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/explore-agents-pre-built-for-you-in-microsoft-copilot-studio/
- https://www.eesel.ai/blog/breeze-agents
- https://docs.retool.com/agents/guides/create-agent-from-template
- https://ismailsaleem.gumroad.com/l/Paralegal-Task-Automation-Suite-for-Lawyers-n8n-Workflow-JSON
- https://jotform.com/agent-templates/property-maintenance-request-ai-agent
- https://beam.ai/agentic-insights/5-ready-to-use-ai-agent-templates-that-save-40-hours-per-week

Back office:
- https://www.cfo.com/news/metric-of-the-month-accounts-payable-cost/659393/
- https://www.cfo.com/news/metric-of-the-month-cycle-time-for-monthly-close/659297/
- https://blog.xero.com/data-insights/small-business-insights-data-late-payment-results/
- https://www.gbta.org/new-study-reveals-pain-points-in-expense-reporting/
- https://info.worldcc.com/contract-management-aug-2025
- https://www.legaldive.com/news/nda-pain-points-non-disclosure-agreements-ontra-survey-private-markets-contracts/650007/
- https://www.wolfia.com/blog/security-questionnaires-complete-guide
- https://www.marketingprofs.com/charts/2025/42512/rfp-benchmarks-how-much-time-and-staff-firms-devote-to-proposals
- https://zylo.com/news/2025-saas-management-index
- https://www.metaview.ai/resources/blog/ai-scorecard-completion-rate-study
- https://www.cloudeagle.ai/newsroom/48-of-former-employees-still-have-saas-access-months-after-leaving-cloudeagles-own-iga-report
- https://www.salesforce.com/news/stories/sales-research-2023/
- https://www.on24.com/blog/how-to-optimize-webinar-attendance-for-lead-acquisition/

Professional services:
- https://www.accountingtoday.com/how-to-cut-tax-season-intake-chaos-and-get-client-documents-in-faster
- https://insightfulaccountant.com/podcastsvideo/uncat-quickbooks-connect-2022/
- https://www.clio.com/about/press/clios-legal-trends-report-reveals-law-firms-struggle-to-respond-to-client-inquiries/
- https://www.businesswire.com/news/home/20250820510824/en
- https://technologylaw.fkks.com/post/102jwnl/aba-issues-comprehensive-formal-ethics-opinion-on-lawyers-use-of-generative-ai
- https://coverager.com/2021-indio-state-of-insurance-renewals-report-finds-that-current-renewal-process-decreases-productivity-weakens-customer-experiences/
- https://www.iamagazine.com/?p=32073
- https://www.nar.realtor/blogs/economists-outlook/nar-profile-of-home-buyers-and-sellers-home-buyers-and-the-real-estate-agent
- https://www.buildium.com/resource/2026-property-management-industry-report/
- https://yello.co/blog/interview-scheduling-statistics
- https://www.kitces.com/blog/how-do-financial-advisors-spend-time-research-study-productivity-capacity-efficiency/
- https://blog.coupler.io/marketing-agency-reporting/

Small and local business:
- https://baymard.com/lists/cart-abandonment-rate
- https://www.ringly.io/blog/wismo-tickets
- https://www.brightlocal.com/research/local-consumer-review-survey-2025/
- https://www.airbnb.ca/help/article/2414
- https://pmc.ncbi.nlm.nih.gov/articles/PMC4714455/
- https://pubmed.ncbi.nlm.nih.gov/20569761/
- https://ama-assn.org/practice-management/prior-authorization/fixing-prior-auth-nearly-40-prior-authorizations-week-way
- https://adanews.ada.org/new-dentist/2025/march/staffing-shortages-top-expected-challenges-this-year
- https://composio.dev/legal/baa
- https://www.signpost.com/blog/how-much-business-do-contractors-lose-from-missed-calls/
- https://freightcaviar.com/stories/800-freight-emails-a-day-youre-counting-your-inbox-wrong
- https://localnewsmatters.org/2024/06/24/high-stress-low-pay-survey-finds-teachers-burning-out-from-long-hours-admin-tasks/
- https://neonone.com/resources/blog/donor-retention/
- https://www.instrumentl.com/blog/how-long-do-grants-take-to-write
- https://www.manatt.com/insights/newsletters/tcpa-connect/fcc-adopts-revocation-rules
