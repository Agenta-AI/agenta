# Wave 1 template specs

Full build specs for the nine top-scored templates in [wave 1](../wave-1-software-sectors.md):
three for Marketing, three for Customer Success, three for Security & Compliance. Each spec is
written for a builder who does not know the sector. It explains the sector words first, then
the problem, the apps, the automations, the run procedure, the outputs, the guardrails, and
how to test the template.

## How the nine were picked

Each idea from the research got three scores from 1 to 5:

- **Pain**: how much time or money the problem costs, from the evidence.
- **Recurrence**: how often the job runs. Hourly or per event = 5, daily = 4, weekly = 3,
  monthly = 2, quarterly = 1-2.
- **Ease**: how easy it is to build on today's platform. All apps confirmed in Composio, one
  trigger, simple output = 5.

Score = Pain x Recurrence x Ease (maximum 125). The top three in each sector are the specs here.

### Marketing

| Template | Pain | Recurrence | Ease | Score | Picked |
|---|---|---|---|---|---|
| MQL follow-up SLA watchdog | 4 | 5 | 5 | **100** | yes |
| Pre-send email QA | 4 | 5 | 4 | **80** | yes |
| Marketing request intake | 3 | 5 | 5 | **75** | yes |
| Paid budget pacing alert | 4 | 5 | 3 | 60 | |
| Brand and claims checker | 3 | 4 | 4 | 48 | |
| Launch readiness risk list | 3 | 3 | 5 | 45 | |
| Search-term sweeper, review asks, battlecards, feedback consolidator, quote miner | 3 | 3-4 | 3-4 | 36 | |
| Journalist pitch tailor | 2 | 2 | 4 | 16 | |

### Customer Success

| Template | Pain | Recurrence | Ease | Score | Picked |
|---|---|---|---|---|---|
| Failed payment rescue | 5 | 5 | 5 | **125** | yes |
| Renewal risk digest | 5 | 4 | 4 | **80** | yes |
| Detractor close-the-loop | 4 | 4 | 5 | **80** | yes |
| Onboarding stall nudger | 4 | 4 | 4 | 64 | |
| Churn intent watcher | 4 | 4 | 4 | 64 | |
| Quiet account finder | 3 | 4 | 5 | 60 | |
| Adoption dip alert | 4 | 4 | 3 | 48 | |
| Champion change watch, handoff brief, renewal outreach | 3-4 | 3 | 3-4 | 36 | |
| Expansion spotter, QBR prep, feature-request closer | 3 | 2-3 | 3-4 | 18-27 | |

### Security & Compliance

| Template | Pain | Recurrence | Ease | Score | Picked |
|---|---|---|---|---|---|
| Security questionnaire answerer | 5 | 4 | 4 | **80** | yes |
| Offboarding checklist runner | 5 | 4 | 4 | **80** | yes |
| Reported phish triager | 3 | 5 | 5 | **75** | yes |
| Audit evidence chaser | 4 | 4 | 4 | 64 | |
| Lockout and MFA deflector | 3 | 5 | 4 | 60 | |
| Access request router | 3 | 5 | 4 | 60 | |
| New vendor security review | 4 | 3 | 4 | 48 | |
| Vendor advisory matcher | 3 | 5 | 3 | 45 | |
| Quarterly access review packager | 5 | 2 | 4 | 40 | |
| Privacy request coordinator, new-hire IT prep | 3-4 | 2-3 | 4 | 32-36 | |
| License auditor, policy attestation | 2-3 | 2 | 4-5 | 20-24 | |

Change from the wave 1 document: the phishing triager (75) replaces the quarterly access
review (40). The access review has high pain but runs only four times a year.

## The nine specs

| Sector | Spec | One line |
|---|---|---|
| Marketing | [mql-sla-watchdog](mql-sla-watchdog.md) | Pings sales when a hot lead waits too long for a first touch. |
| Marketing | [email-preflight-qa](email-preflight-qa.md) | Checks a marketing email for broken links, bad merge tags and missing parts before it goes out. |
| Marketing | [creative-request-intake](creative-request-intake.md) | Turns messy requests to the marketing team into complete, routed briefs. |
| Customer Success | [failed-payment-rescue](failed-payment-rescue.md) | Tells the account owner when a valuable customer's payment fails and drafts a personal note. |
| Customer Success | [renewal-risk-digest](renewal-risk-digest.md) | Every Monday, lists upcoming renewals with a risk color, the reasons, and a next step. |
| Customer Success | [detractor-close-loop](detractor-close-loop.md) | When a customer gives a low survey score, drafts a reply and creates a 48-hour follow-up. |
| Security | [security-questionnaire-answerer](security-questionnaire-answerer.md) | Fills a customer's security questionnaire from your approved answers, with a source and confidence per row. |
| Security | [offboarding-checklist-runner](offboarding-checklist-runner.md) | When someone leaves, checks every app for leftover access and opens one tracked checklist for IT. |
| Security | [phishing-report-triager](phishing-report-triager.md) | Classifies emails staff report as phishing, answers the reporter, and escalates real threats. |

## How every spec maps to the platform

A template is a package (see `api/oss/src/resources/agent_templates/CONTRIBUTING.md`). Every
spec ends with a package sketch in that format:

| Spec section | Package part |
|---|---|
| Apps | `connections` in `ai.agenta/agents.json`: one entry per app role, with Composio options and a permission `policy` (`allow`, `ask`, `deny`, `allow_reads`). |
| Setup and seed files | `SETUP.md` and `workspace.entries` (config files the user edits). |
| Automations | `automations`: a `schedule` (five-field cron, UTC) or a `subscription` (a Composio trigger `event_key`). Automations are never active on load; the user turns them on. |
| How one run works | `AGENTS.md`: the numbered procedure, ending on the final write. |
| Catalog card | The record in `catalog.json` (`summary`, `category`, `display`, `example`). |

Three platform facts shape every design:

1. **Event triggers come from Composio.** Every trigger slug in these specs is a candidate.
   Confirm it with `discover_triggers` before writing the package. Every event template also
   has a schedule fallback, so it works when the event is missing.
2. **Keep state outside the agent.** Agent working files are not guaranteed to persist across
   scheduled runs. Each spec keeps its "already handled" log in a Google Sheet or in the
   source app, so a run never alerts twice.
3. **Unattended runs cannot wait for a click.** A tool set to `ask` stalls a scheduled run.
   Each spec allows only the safe write tools it needs (create a draft, post a message, add a
   row) and denies the risky ones (send email to customers, delete, change access).

Every tool slug in a package sketch (for example `GMAIL_CREATE_EMAIL_DRAFT`) is a candidate.
Confirm the real slug with `discover_tools` and `composio tools list --toolkit <slug>`.
