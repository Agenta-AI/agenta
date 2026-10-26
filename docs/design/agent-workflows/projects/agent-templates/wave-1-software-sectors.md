# Wave 1: Marketing, Customer Success, Security & Compliance

Research date: 2026-10-26. This wave targets three functions inside software companies. It
narrows [marketplace-template-ideas.md](marketplace-template-ideas.md), which also covers
industries outside tech; those packs are on hold.

## Why these three sectors

- **Marketing.** Only three marketing templates ship today (`content-repurposer`,
  `newsletter-drafter`, `seo-content-agent`), and all three write content. None covers the
  operational work: lead handoff, email QA, request intake, brand review, paid media.
  Composio covers the marketing stack well.
- **Customer Success.** No CS template ships today. Paddle and Churnkey data put 16-40% of
  churn down to failed payments [Vv]. Mid- and low-touch CSMs carry 49-144 accounts each
  [Vv, Gainsight], which nobody can watch by hand. Every signal the agent needs sits in tools
  Composio covers (CRM, support desk, Stripe, product analytics).
- **Security & Compliance.** Almost every B2B SaaS company has to answer security
  questionnaires and pass SOC 2 audits, and the work blocks revenue. At startups one person
  often does all of it. The work is text and spreadsheet rows, so it is light.

## Rules for every template in this wave

1. **Light on compute.** One trigger, a few reads, one or two LLM calls, one write. No
   crawling. The only fetches are a fixed, short URL list (battlecards) or the links inside
   one email (email QA).
2. **Draft first.** Anything a customer, journalist, or auditor sees is a draft or a Slack
   approval. The agent never sends a customer email, publishes copy, or changes a budget by
   itself.
3. **Security templates are read-only on systems.** Give each one a read-only tool allowlist.
   Google Admin, 1Password, JumpCloud, and Rippling toolkits all have write tools; the agent
   must never use them. It writes only tickets, sheets, and messages.

Evidence tags: **[V]** a named survey or primary data, **[Vv]** a vendor source (directional
only), **[I]** inference. Check a number against its primary source before it goes on a public
card.

Composio column: **ok** means a composio.dev or docs.composio.dev toolkit page was found in
search; **verify** means one tool in the row was not found or its needed action was not
confirmed. The proxy blocked direct reads of the Composio catalog, so verify every row with
`composio tools list --toolkit <slug>` before shipping.

## Build first: 9 templates (3 per sector)

| Sector | Key | Template | Trigger | Why first |
|---|---|---|---|---|
| Marketing | `mql-sla-watchdog` | MQL follow-up SLA watchdog | Hourly + HubSpot lifecycle change | Clear money impact, one tool pair (HubSpot + Slack), trivial to verify. |
| Marketing | `email-preflight-qa` | Pre-send email QA | Campaign marked ready | Every marketing team sends email; every broken send is public. |
| Marketing | `creative-request-intake` | Marketing request intake | Slack mention or form | Uses the inbound-extractor pattern; works for any team size. |
| Customer Success | `failed-payment-rescue` | Failed payment rescue | Stripe `invoice.payment_failed` | Largest documented churn source; single webhook trigger. |
| Customer Success | `renewal-risk-digest` | Renewal risk digest | Weekly | The core CS chore; reads tools Composio already covers. |
| Customer Success | `detractor-close-loop` | Detractor close-the-loop | NPS/CSAT response of 6 or lower | Strongest independent evidence (Bain); one event, one draft. |
| Security | `security-questionnaire-answerer` | Security questionnaire answerer | File drop or mention | Blocks deals; 5-18 h saved per questionnaire. |
| Security | `access-review-packager` | Quarterly access review packager | Quarterly | Access control is the top SOC 2 exception area. |
| Security | `offboarding-checklist-runner` | Offboarding checklist runner | HRIS termination event | Security and audit need; clean event trigger. |

## Marketing

| # | Key | Template | Headache | Trigger | Tools | Output | Human step | Evidence | Composio |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `mql-sla-watchdog` | MQL follow-up SLA watchdog | Inbound leads sit untouched for hours or days, and marketing cannot see it. | Hourly + lifecycle-change event | HubSpot, Slack | Ping to the owner for each MQL past the SLA; manager escalation at 2x SLA; daily breach list. | Rep acts | HBR audit of 2,241 firms: 37% replied within 1 h, 23% never; contact within 1 h gave about 7x the odds of qualifying [V, via secondary]. | ok |
| 2 | `email-preflight-qa` | Pre-send email QA | Broken links, bad merge tags, staging URLs, missing unsubscribe or preheader. | Campaign scheduled or marked ready; mention | HubSpot / Mailchimp / Klaviyo / Customer.io, Slack | Pass/fail checklist: link targets, token syntax against known fields, footer, subject and preheader length, risky claims, typos. | Owner fixes and approves the send | About 54% of marketers spend 1 h+ testing each email [Vv, Litmus, older]. | ok |
| 3 | `creative-request-intake` | Marketing request intake | Requests arrive in DMs with no goal, audience, deadline, or specs. | Mention, Typeform, new Asana task | Slack, Typeform, Asana, Notion | Brief-completeness score, follow-up questions, then a structured task routed to the owner. | Lead confirms priority | 60% of time goes to "work about work" [Vv, Asana 2021, n=13,123]. 58% of marketers go through 5+ revision rounds [Vv, Workfront]. | ok |
| 4 | `brand-voice-reviewer` | Brand and claims checker | Off-brand copy, banned terms, unapproved claims, wrong product names. | Mention on a doc; entry moves to "In review" | Notion, Contentful, Webflow, Slack | Redlines against the brand guide, terms list, and approved claims, each with a severity. | Writer accepts; brand signs off | 77% see off-brand content made at their company [Vv, Lucidpress 2021]. | ok |
| 5 | `ad-pacing-alert` | Paid budget pacing alert | Overspend or underspend found at month end. | Daily | Google Ads, Meta Ads, Slack | Month-to-date vs plan per campaign, projected month-end spend, CPA/CTR swings past a threshold. | Owner adjusts budgets | Paid media is 30.6% of marketing budgets, the largest line; budgets flat at 7.7% of revenue [V, Gartner CMO Spend 2025]. | ok |
| 6 | `search-term-sweeper` | Wasted-spend and negative keyword proposer | Weekly search-terms review is tedious; junk queries burn budget. | Weekly | Google Ads, Sheets, Slack | Irrelevant terms by intent and spend; proposed negatives per campaign. | PPC owner applies them | Same Gartner budget data [V]. | verify (search-terms report action) |
| 7 | `review-request-orchestrator` | G2 and Capterra review asks | Review asks come in random pushes and miss happy customers. | Promoter NPS, high-CSAT ticket close, renewal | HubSpot, Typeform, Slack, Gmail | Personal review-ask draft; "not asked in N days" check; CSM queue. | CSM sends | 84% of B2B buyers use review sites [Vv, G2 2023]. | ok |
| 8 | `launch-readiness-checker` | Launch readiness risk list | Status chased by hand; missing assets found the day before launch. | Daily from T-14; mention | Asana, Notion, Slack | Overdue tasks, unowned assets, missing approvals, ranked by days left. | Launch owner reassigns | Asana work-about-work data [Vv]. | ok |
| 9 | `battlecard-refresher` | Competitor change watch | Battlecards go stale, then reps stop using them. | Weekly | Gong, Notion, Slack; 3-5 fixed competitor URLs | What changed (pricing, changelog, positioning) plus new objections from calls; battlecard diff draft. | PMM approves | Under half of CI teams have KPIs [Vv, Crayon 2022]. Staleness is the top reason reps drop cards [I]. | ok |
| 10 | `feedback-consolidator` | Review comment consolidator | Feedback spread across Slack, Figma, and docs contradicts itself. | Mention on the review thread | Figma, Slack, Notion | One de-duplicated revision list with conflicts and open decisions. | Owner resolves conflicts | Workfront revision-round data [Vv]. | ok |
| 11 | `customer-quote-miner` | Customer proof finder | Marketing lacks fresh quotes while sales calls are full of them. | Weekly; closed-won call | Gong, HubSpot, Notion, Slack | Quotable lines with call links; quote-approval or case-study ask draft. | PMM picks; customer approves | 43% struggle to align content across sales and marketing [V, CMI 2025]. | ok |
| 12 | `media-pitch-tailor` | Journalist pitch tailor | Generic pitches get deleted. | Manual: announcement + journalist list | Airtable, Notion, Gmail drafts | Beat-fit score per journalist; tailored drafts for good fits only. | PR edits and sends | 86% of journalists delete irrelevant pitches at once [V, Muck Rack, via secondary]. | ok |

Deferred: `event-lead-router` (too close to `lead-qualifier` and `webinar-followup`) and
`social-mention-triage` (Composio LinkedIn tools post content; reading comments is not
confirmed).

## Customer Success

| # | Key | Template | Headache | Trigger | Tools | Output | Human step | Evidence | Composio |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `failed-payment-rescue` | Failed payment rescue | Billing dunning is generic; CSMs learn of a failed card on a key account too late. | Stripe `invoice.payment_failed` | Stripe, HubSpot/Salesforce, Slack, Gmail | Account tier and decline reason; for high tiers, a Slack alert and a personal email draft; low tiers only logged. | CSM sends | 16-40% of churn is involuntary [Vv, Paddle/Churnkey]. 61% of recoveries happen in 7 days [Vv]. | ok |
| 2 | `renewal-risk-digest` | Renewal risk digest | Forecasts live in spreadsheets and gut feel; risk shows up late. | Weekly | CRM, Zendesk/Intercom, Stripe, PostHog/Mixpanel/Amplitude, Slack | Renewals at 30/60/90 days, red/amber/green with three cited reasons and one next action each. | CS lead assigns actions | Private SaaS GRR near 90% [V, KeyBanc/Sapphire 2025]. Median NDR fell from 109% to 101% [I]. | ok |
| 3 | `detractor-close-loop` | Detractor close-the-loop | NPS and CSAT detractors get no reply. | Survey response with score of 6 or lower | Typeform/SurveyMonkey/Delighted, CRM, Zendesk, Slack, Gmail | Theme tag, account context (ARR, tickets, owner), reply draft, follow-up task due in 48 h. | CSM sends | 61% of top-NPS firms follow up with detractors in 48 h vs 34% of low-NPS firms [V, Bain]. | ok (Delighted: verify) |
| 4 | `champion-change-watch` | Champion change watch | The champion leaves and nobody notices until renewal. | Daily + Gmail events | Gmail, CRM, Product analytics, Slack | Alert on bounces, "no longer with" auto-replies, CRM title changes, main-user logins at zero; draft to the next stakeholder. | CSM confirms and sends | 20%+ of professionals change jobs each year [Vv, UserGems]. No LinkedIn scraping. | ok |
| 5 | `onboarding-stall-nudger` | Onboarding stall nudger | Implementations stall on customer-owned tasks. | Daily | Rocketlane/Asana, Gmail, Slack | Overdue customer tasks, a nudge draft per task, internal at-risk go-live summary. | CSM approves nudges | About 50% of teams do not automate reminders; 51% do not track time-to-value [Vv, Rocketlane]. | ok |
| 6 | `sales-to-cs-handoff` | Sales-to-CS handoff brief | Sales over-promises; the customer repeats context to CS. | Deal closed-won | HubSpot/Salesforce, Gong/Fireflies, Notion, Slack | One-page brief: goals, promised features and dates quoted from calls, stakeholders, risks. | AE and CSM confirm | Over-promising is the top onboarding complaint in CS communities [Vv/I]. | ok |
| 7 | `churn-signal-watcher` | Churn intent watcher | Cancel intent is hidden in tickets and email. | New ticket/email; daily rollup | Zendesk/Intercom, Gmail, CRM, Slack | Flags "evaluating alternatives", "budget cut", "cancel"; quote added to the account; alert for named accounts. | CSM acts | 74% of revenue comes from existing customers [Vv, ChurnZero]. | ok |
| 8 | `adoption-dip-alert` | Adoption dip alert | Usage falls weeks before churn; dashboards are checked by hand. | Weekly | PostHog/Mixpanel/Amplitude, CRM, Slack | Accounts with a week-over-week active-user drop past a threshold, features dropped, check-in draft. | CSM picks accounts | CSM book sizes of 49-144 accounts [Vv, Gainsight]. | ok |
| 9 | `renewal-outreach-drafter` | Renewal outreach drafter | Each renewal email needs a hand-built value recap. | 90 and 60 days before renewal | CRM, Stripe, PostHog, Zendesk, Gmail | Renewal email draft with usage highlights, tickets resolved, goals hit, terms. | CSM/AM edits and sends | About two thirds of CSM time is automatable [Vv, Bain via ChurnZero]. | ok |
| 10 | `expansion-signal-spotter` | Expansion signal spotter | Upsell moments get missed. | Weekly | Stripe, PostHog/Mixpanel, Gong, CRM, Slack | Accounts near seat or usage limits; "new team" mentions in calls; talking points. | AM decides | 49% of CSMs own upsell and renewal [Vv, Custify]. | ok |
| 11 | `qbr-prep-pack` | QBR prep pack | A QBR deck takes hours of data gathering. | Calendar event "QBR"/"EBR", 5 days ahead | Calendar/Zoom, CRM, analytics, Zendesk, Notion | Notion page: goals vs metrics, wins, open issues, requested roadmap items, asks. | CSM adds the story | Admin load data above [Vv/I]. | ok |
| 12 | `feature-request-closer` | "You asked for this" closer | Customers who asked for a feature never hear it shipped. | Release note posted; manual | Zendesk/Intercom, Gong, CRM, Gmail | Release matched to past requests; a personal note per account plus a short how-to tip. | CSM approves the batch | Closing the loop lifts loyalty [V, Bain]. | ok |
| 13 | `quiet-account-finder` | Quiet account finder | Long-tail accounts get no touch for months. | Monday | CRM, Gmail, Zoom, Slack | Per-CSM list of accounts with no two-way contact in 45+ days, by ARR, with a reason to reach out. | CSM picks | 144 accounts per low-touch CSM [Vv]. | ok |

Integration note: no CS platform (Gainsight, Vitally, Planhat, ChurnZero, Totango) and no
billing tool except Stripe (Chargebee, Recurly) was found in Composio. Build on CRM, support,
Stripe, and product analytics. Gainsight, Vitally, and Planhat reportedly ship their own MCP
servers, which could be a later add-on.

## Security & Compliance

| # | Key | Template | Headache | Trigger | Tools | Output | Human step | Evidence | Composio |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `security-questionnaire-answerer` | Security questionnaire answerer | SIG, CAIQ, and custom sheets with 200-800 questions, mostly answered before. | File drop, mention, or ticket with attachment | Drive, Notion/Confluence, Slack, Jira | Filled draft with a source and confidence per answer; unanswered rows listed for owners. | Security lead reviews and sends | 5-15 h per questionnaire [Vv, Vanta]; 16 h without an answer library vs 2.4 h with one [Vv]. | ok |
| 2 | `access-review-packager` | Quarterly access review packager | Spreadsheet access reviews; managers approve everything; auditors reject screenshots. | Quarterly | Google Admin, GitHub, JumpCloud, BambooHR, Sheets, Slack | Accounts vs HR roster (terminated, role changed, no owner); keep/remove list per manager; timestamped evidence file. | Managers decide; IT removes | 58% of identity leaders call their reviews ineffective [Vv, SailPoint 2024]. 71% of 75 SOC 2 exams had an exception, most in access control [V-small, Lazarus 2026]. | ok |
| 3 | `offboarding-checklist-runner` | Offboarding checklist runner | Turning off SSO misses local logins, OAuth grants, shared vault items, GitHub accounts, mail forwarding. | HRIS termination event; manual | BambooHR/Rippling, Google Admin (read), GitHub, 1Password (read), Jira/Freshservice, Slack | One ticket: each app with found / not found / unknown, credentials to rotate, files to transfer. | IT revokes each item | Half of IT pros kept access at a former employer [Vv, Nudge, n=375]. 70-88 OAuth grants per employee [Vv]. | ok |
| 4 | `soc2-evidence-chaser` | Audit evidence chaser | About 100 evidence requests; owners miss dates and the audit slips. | Weekly; daily in the last 30 days | Jira/Notion, Drive, Slack | Per request: file present and dated inside the audit period; owner reminders; weekly status. | GRC lead accepts evidence | About 100 requests, 85 controls [Vv, Secureframe]. Compliance takes 11 weeks a year [Vv, Vanta 2024]. | ok |
| 5 | `phishing-report-triager` | Reported phish triager | Most reported emails are not phishing, but each needs a check and a reply. | New email to phish@; Slack report | Gmail/Outlook, Slack, Jira | Spam / safe / simulation / likely phish from headers, domain, and link text (no URL fetch, no attachment open); reply to the reporter; ticket for likely phish. | Engineer confirms and purges | 60-70% of user reports are false positives [Vv, Agari]. Human element in about 60% of breaches [V, Verizon DBIR 2025]. | ok |
| 6 | `vendor-review-intake` | New vendor security review | Each new SaaS needs a review; SOC 2 reports and DPAs are read by hand. | "New tool" ticket; vendor DocuSign envelope | Jira, Drive, DocuSign, Slack | One-page memo: report type and period, exceptions, user-entity controls, data types, subprocessors, gaps vs your standard. | Security lead decides | Third-party involvement in breaches doubled to 30% [V, DBIR 2025]. 45% had a third-party business interruption [V, Gartner 2023]. | ok |
| 7 | `access-request-router` | Access request router | "I need access to X" in Slack with no owner or approval trail. | Mention | Slack, Sheet/Notion app-owner map, Jira/Freshservice/ServiceNow, BambooHR | Ticket with role, app owner, and fit with the role's default bundle; approval request to the owner. | Owner approves; admin provisions | Access control has the most audit exceptions [V-small]. | ok |
| 8 | `dsar-request-coordinator` | Privacy request coordinator | Access and deletion requests have legal deadlines (GDPR 30 days, CCPA 45). | New email or ticket | Gmail/Zendesk, Jira, Slack, Sheets | Type, jurisdiction, due date, identity-check status; subtasks per system owner; response draft. | DPO verifies identity and approves | Deletion requests up 82% year over year [Vv, DataGrail 2025]. | ok |
| 9 | `policy-attestation-tracker` | Policy review and attestation tracker | Policies need yearly review and staff acknowledgement; auditors check both. | Monthly | Notion/Confluence, DocuSign or Slack, BambooHR, Sheets (training export) | Overdue policy reviews; reminders for missing acknowledgements and training; evidence sheet. | Owners approve reviews | Annual SOC 2 / ISO control [I]. | ok (no KnowBe4: use export) |
| 10 | `lockout-deflector` | Lockout and MFA deflector | Password and MFA tickets crowd the help desk. | Mention; new ticket | Slack, Freshservice/Zendesk, Notion/Confluence | Self-service steps or link; correct ticket category; MFA resets sent to the identity-check path. | IT does any reset | 20-50% of help-desk calls [Vv, Gartner via secondary; primary not found]. | ok |
| 11 | `saas-license-auditor` | SaaS license and shadow app auditor | Unused seats and unknown paid apps. | Monthly | Sheets (card/expense rows), Google Admin, BambooHR/Gusto, Slack | New paid apps not in the inventory; seats held by departed or inactive users; renewals in 60 days. | IT/Finance decides | Average 275 apps; $21M a year wasted on unused licenses (large-company sample) [Vv, Zylo 2025]. | ok |
| 12 | `onboarding-access-prep` | New-hire IT prep | Day-one access is late or wrong, which makes later reviews messy. | HRIS new-hire event | BambooHR/Rippling, Jira/Freshservice, Slack, Sheet of role bundles | Ticket with the role's app bundle, device, and groups; day-one checklist to the manager. | IT provisions | Mirror of offboarding [I]. | ok |
| 13 | `vendor-advisory-matcher` | Vendor advisory matcher | 48k CVEs in 2025; most advisories are about products you do not use. | Advisory email; daily read of the CISA KEV feed | Gmail, Sheets (vendor inventory), Jira, Slack | Only advisories that match your inventory, as a ticket with severity and owner. | Owner checks the vendor fix | NVD backlog above 27k [V, Commerce IG 2026]. Covers SaaS and vendor products, not code dependencies (`dependency-digest` does that). | ok |

Integration note: Vanta, Drata, Secureframe, Okta, Jamf, Kandji, Snyk, CrowdStrike, and
KnowBe4 were not found in Composio. Google Admin, JumpCloud, 1Password, Jira, Freshservice,
ServiceNow, BambooHR, Rippling, Gusto, DocuSign, Wiz, and GitHub were found. Drata ships its
own MCP server. Okta is the biggest gap for access reviews and offboarding; until it is
verified, read from Google Admin or JumpCloud.

## Cross-sector notes

- **Shared building blocks.** `review-request-orchestrator` (Marketing) and
  `detractor-close-loop` (CS) read the same survey event: promoters go to one, detractors to
  the other. `customer-quote-miner` and `sales-to-cs-handoff` both read Gong transcripts.
  `offboarding-checklist-runner`, `onboarding-access-prep`, and `access-review-packager` share
  one "app owner and role bundle" sheet. Write these sheet and field conventions once.
- **Categories.** The strip holds about five categories plus All
  ([template-inventory.md](template-inventory.md)). Adding Marketing, Customer Success, and
  Security means merging today's Monitoring into Engineering and Knowledge into Support, or
  adding the tab overflow menu.
- **Verification.** Most per-task hour figures are vendor numbers. The strongest independent
  data points in this wave are Gartner CMO Spend 2025, Bain on detractor follow-up,
  KeyBanc/Sapphire retention, Verizon DBIR 2025, and Gartner on third-party interruptions.

## Sources

Marketing:
- https://www.gartner.com/en/newsroom/press-releases/2025-05-12-gartner-2025-cmo-spend-survey-reveals-marketing-budgets-have-flatlined-at-seven-percent-of-overall-company-revenue
- https://contentmarketinginstitute.com/b2b-research/b2b-content-marketing-trends-research-2025
- https://www.businesswire.com/news/home/20210114005374/en/Asana-Anatomy-of-Work-Index-2021-Work-About-Work-Is-Dominating-in-a-Distributed-World
- https://www.campaignlive.co.uk/article/meetings-kill-creativity-why-need-rethink-processes/1349786
- https://www.retellai.com/blog/speed-to-lead
- https://www.litmus.com/blog/how-to-streamline-your-email-testing-process-with-litmus
- https://www.agilitypr.com/?p=62262
- https://crayon.co/success/state-of-battlecards-report
- https://umarcomm.umn.edu/blog/2025/12/15/muck-racks-state-pr-2025
- https://learn.g2.com/joe-kevens-online-review-insights
- https://docs.composio.dev/kb/toolkit/googleads
- https://composio.dev/category/marketing-social-media

Customer Success:
- https://www.gainsight.com/blog/gainsight-horizon-ai-labs-what-is-the-right-csm-to-customer-ratio/
- https://www.stocktitan.net/news/KEY/private-saas-company-survey-reveals-ai-driven-transformation-and-hlzp1ug1t8z8.html
- https://churnzero.com/press-release/new-research-customer-revenue-leadership-study-2025-2026/
- https://churnkey.co/blog/involuntary-churn-benchmarks
- https://www.usergems.com/news/catalyst-usergems-partnership
- https://rocketlane.com/press/rocketlane-launches-the-customer-onboarding-maturity-report
- https://bain.com/insights/loyalty-insights-assessing-your-net-promoter-system
- https://www.valuecase.com/articles/customer-onboarding-challenges-reddit
- https://docs.composio.dev/kb/toolkit/rocketlane.md
- https://docs.composio.dev/kb/toolkit/posthog

Security & Compliance:
- https://www.vanta.com/resources/state-of-trust-report-2024-vantacon-agenda
- https://www.wolfia.com/blog/the-real-cost-of-manual-security-questionnaire-responses
- https://secureframe.com/hub/soc-2/audit-process.md
- https://lazarusalliance.com/2026-soc-2-audit-benchmark-report/
- https://www.asisonline.org/security-management-magazine/latest-news/today-in-security/2025/april/verizon-dbir-2025/
- https://www.gartner.com/en/newsroom/press-releases/2023-12-13-gartner-survey-finds-45-percent-of-organizations-experienced-third-party-related-business-interruptions-during-the-past-two-years
- https://www.datagrail.io/blog/data-privacy/datagrails-2025-data-privacy-report-surging-consumer-demands-and-rising-business-costs/
- https://zylo.com/news/2025-saas-management-index
- https://www.nudgesecurity.com/post/what-is-shadow-saas
- https://emailsecurity.fortra.com/blog/phishing-emails-false-positives
- https://www.nist.gov/news-events/news/2026/04/nist-updates-nvd-operations-address-record-cve-growth
- https://composio.dev/toolkits/google_admin
- https://docs.composio.dev/toolkits/jumpcloud
- https://drata.com/products/mcp-server
