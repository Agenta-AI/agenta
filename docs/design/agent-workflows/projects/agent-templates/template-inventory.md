# Template inventory: 28 templates

The catalog grows from 6 templates to 28, chosen for the three personas in
[context.md](context.md). Each row is a card (in `templates.ts`) plus a playbook (in the
skill). This file is the source of truth for the set; the card fields and the playbooks derive
from it.

Personas: **F** founding engineer or technical CEO, **J** junior engineer, **R** freelancer
building for clients.

Confidence: **SOLID** means the integration is in the current `PROVIDERS` list or confirmed in
the Composio catalog. **CHECK** means a plausible Composio toolkit that this pass did not
verify; each CHECK row falls back to the SOLID integration listed in its group.

Integrations are split into two columns because they mean two different things (see the
connect-gate finding in [research.md](research.md) Section 5 and
[open-questions.md](open-questions.md) #5):

- **Display logos** are the brand marks shown on the card. They can list every tool the use
  case might touch.
- **Required to run** is the integration the agent actually needs a live connection to before
  it can work. In the flag-off drawer this is a hard connect gate, so it must stay minimal.

The kept originals (do not renumber their keys): pr-reviewer, changelog-writer, support-triage,
incident-responder, standup-summarizer, docs-qa. Two are recategorized under the new set:
standup-summarizer stays Ops, docs-qa moves to Knowledge.

Seeds are written in the "Build a <X> that ..." form, which becomes the card `builderMessage`.

---

## Engineering (dev-workflow automation)

| Key | Name | Personas | Display logos | Required to run | Trigger | Confidence |
|---|---|---|---|---|---|---|
| pr-reviewer | PR reviewer | J, F | github, gitlab | github | event: PR opened | SOLID |
| changelog-writer | Changelog writer | F, J | github, gitlab, notion, linear | github | event: release | SOLID |
| issue-triage | Issue triage | J, F | github, gitlab, linear, jira | github | event: issue opened | SOLID |
| ci-failure-triage | CI failure triage | J, F | github, slack, discord | github | event: workflow run failed | CHECK |
| code-qa | Code Q&A | J, R | github, gitlab, slack | github | mention | SOLID |
| dependency-digest | Dependency digest | J, F | github, slack | github | schedule (weekly) | SOLID |

Seeds:
- pr-reviewer: "Build a PR reviewer that comments inline on risky changes and flags missing
  tests."
- changelog-writer: "Build a changelog writer that turns merged pull requests into release
  notes and publishes them."
- issue-triage: "Build an issue triager that labels new issues by area and priority and assigns
  an owner."
- ci-failure-triage: "Build an agent that reads the logs when CI fails, summarizes the likely
  cause, and pings the author."
- code-qa: "Build a code Q&A agent that answers questions about our repo when mentioned."
- dependency-digest: "Build an agent that weekly summarizes open dependency-update PRs and what
  changed."

## Support (customer support)

| Key | Name | Personas | Display logos | Required to run | Trigger | Confidence |
|---|---|---|---|---|---|---|
| support-triage | Support triage | F, R | slack, discord, intercom, zendesk | slack | event: new message/ticket | SOLID |
| support-reply-drafter | Support reply drafter | F, R | zendesk, intercom, notion, confluence, googledrive | zendesk | event: new ticket | CHECK |
| bug-report-router | Bug report router | F, J | slack, intercom, zendesk, linear, jira, github | slack | event/mention | SOLID |
| feedback-clusterer | Feedback clusterer | F, R | intercom, slack, notion | slack | schedule (daily) | SOLID |

Seeds:
- support-triage: "Build a support triager that reads new #support threads, tags urgency, and
  routes to owners."
- support-reply-drafter: "Build an agent that drafts replies to new support tickets using
  answers from our docs."
- bug-report-router: "Build an agent that turns support complaints into Linear bug tickets with
  repro steps."
- feedback-clusterer: "Build an agent that daily clusters new customer feedback into themes and
  logs them to Notion."

## Sales (leads, CRM, outreach)

| Key | Name | Personas | Display logos | Required to run | Trigger | Confidence |
|---|---|---|---|---|---|---|
| lead-qualifier | Lead qualifier | F, R | hubspot, salesforce, attio, gmail, slack | hubspot | event: new lead/email | SOLID |
| crm-updater | CRM updater | F, R | gmail, hubspot, salesforce, attio | gmail | schedule (daily) | CHECK |
| outreach-drafter | Outreach drafter | F, R | hubspot, salesforce, attio, gmail | hubspot | manual | SOLID |
| meeting-followup | Meeting follow-up | F, R | googlecalendar, gmail, hubspot, salesforce, attio | gmail | event/schedule | CHECK |
| pipeline-digest | Pipeline digest | F | hubspot, salesforce, attio, slack | hubspot | schedule (daily) | SOLID |

Seeds:
- lead-qualifier: "Build an agent that enriches each new inbound lead, qualifies it, and adds it
  to HubSpot."
- crm-updater: "Build an agent that updates CRM contact records from my recent email threads
  each day."
- outreach-drafter: "Build an agent that drafts personalized outreach emails for a list of CRM
  contacts."
- meeting-followup: "Build an agent that drafts a follow-up email after each meeting and logs
  notes to the CRM."
- pipeline-digest: "Build an agent that posts a daily digest of pipeline changes and stale deals
  to Slack."

## Monitoring (incidents, errors, uptime)

| Key | Name | Personas | Display logos | Required to run | Trigger | Confidence |
|---|---|---|---|---|---|---|
| incident-responder | Incident responder | F, J | sentry, datadog, newrelic, pagerduty, slack | sentry | event: alert | SOLID |
| error-triage | Error triage | F, J | sentry, linear, jira | sentry | event: new error | SOLID |
| uptime-reporter | Uptime reporter | F | datadog, newrelic, sentry, slack | sentry | schedule (daily) | CHECK |
| oncall-briefer | On-call briefer | F, J | pagerduty, sentry, slack | sentry | schedule | CHECK |

Seeds:
- incident-responder: "Build an incident responder that gathers context on new alerts and pages
  on-call."
- error-triage: "Build an agent that triages new Sentry errors by severity and files a ticket
  for real ones."
- uptime-reporter: "Build an agent that posts a daily uptime and error-rate summary to Slack."
- oncall-briefer: "Build an agent that briefs on-call at 09:00 with all open incidents and their
  status."

## Knowledge (Q&A bots, docs, content)

| Key | Name | Personas | Display logos | Required to run | Trigger | Confidence |
|---|---|---|---|---|---|---|
| docs-qa | Docs Q&A | R, F, J | notion, confluence, googledrive, slack | notion | mention | SOLID |
| knowledge-chatbot | Knowledge chatbot | R, F | notion, confluence, googledrive, slack, discord, telegram | notion | mention/event | SOLID |
| onboarding-buddy | Onboarding buddy | F, R | notion, confluence, slack | notion | mention | SOLID |
| content-repurposer | Content repurposer | F, R | notion, googledrive, slack | notion | manual | SOLID |
| newsletter-drafter | Newsletter drafter | F | github, notion, linear | notion | schedule (weekly) | SOLID |

Seeds:
- docs-qa: "Build a docs Q&A agent that answers questions from our workspace with cited answers."
- knowledge-chatbot: "Build a customer-facing chatbot that answers questions from our knowledge
  base."
- onboarding-buddy: "Build an onboarding buddy that answers new-hire questions from our internal
  wiki."
- content-repurposer: "Build an agent that turns a published doc into draft LinkedIn and X posts
  for review."
- newsletter-drafter: "Build an agent that drafts a weekly newsletter from our recent shipping
  activity."

## Ops (digests, reporting, cross-tool syncs)

| Key | Name | Personas | Display logos | Required to run | Trigger | Confidence |
|---|---|---|---|---|---|---|
| standup-summarizer | Standup summarizer | J, F | slack, discord | slack | schedule (daily 09:00) | SOLID |
| repo-slack-digest | Repo Slack digest | J, F | github, slack | github | schedule (2x/day) | SOLID |
| cross-tool-sync | Cross-tool sync | F, R | linear, jira, github, notion | linear | schedule/event | SOLID |
| weekly-report | Weekly report | F, R | github, linear, posthog, notion, slack | github | schedule (weekly) | CHECK |

Seeds:
- standup-summarizer: "Build an agent that posts a daily standup digest of yesterday's channel
  activity."
- repo-slack-digest: "Build an agent that twice a day posts a digest of new issues, commits, and
  PRs to Slack."
- cross-tool-sync: "Build an agent that mirrors new Linear issues into a Notion tracker every
  hour."
- weekly-report: "Build an agent that compiles a weekly report of shipping and product metrics
  to Notion."

---

## Coverage and confidence

F appears in 27 rows, J in 13, R in 14. The set is weighted to the founder while covering the
junior-engineer dev workflow (Engineering plus Ops) and the freelancer knowledge and CRM work
(Knowledge plus Sales). All 28 are buildable with Composio gateway tools plus schedules or
subscriptions; none need exotic infrastructure.

Seven rows are CHECK: ci-failure-triage, support-reply-drafter, crm-updater, meeting-followup,
uptime-reporter, oncall-briefer, and weekly-report. Each hinges on a specific Composio toolkit
existing (datadog, newrelic, pagerduty, intercom, confluence, gitlab, attio) or on a specific
access (a CI-run event, a calendar read). Confidence is set per template row, not per logo: the
datadog, newrelic, and pagerduty display logos that also appear on SOLID monitoring rows
(incident-responder, error-triage) are unverified but display-only there, so they do not make
those rows CHECK. Each CHECK row falls back to the SOLID integration in its group. Whether to
ship the CHECK rows before verifying their toolkits is [open-questions.md](open-questions.md) #3.

## The category-set trade-off

The inventory groups the 28 templates into six categories: Engineering, Support, Sales,
Monitoring, Knowledge, Ops. This replaces the current four (Engineering, Support, Ops, Docs):
Docs becomes the broader Knowledge, and Sales and Monitoring are new to serve the founder and
freelancer personas.

The strip category tabs do not wrap or scroll and the practical ceiling is about five categories
plus All inside the 880-pixel chat column ([research.md](research.md) Section 5). Six categories
plus All is seven tabs, over the ceiling. The options:

- **Five categories.** Merge two groups (for example fold Monitoring into Engineering, or fold
  Sales into Ops). Fits the strip today with no frontend work. Costs one axis of the persona
  story.
- **Six categories with an overflow treatment.** Keep all six and add scrollable tabs or a
  "More" menu to the strip header. Serves the personas fully but needs frontend work on the tab
  row.
- **Measure first.** Ship with fewer categories, watch which ones users click, and split later.
  Lowest risk, slowest to the full grouping.

The table above keeps the six-category grouping so that collapsing to five is a mechanical merge
of two columns, not a re-sort of the whole catalog. The decision is
[open-questions.md](open-questions.md) #1.

## Registry field notes

- `builderMessage` is the seed above. It is the live path in strip and builder modes and is
  verbatim-matched at create to attribute the template name.
- `seedMessage` is only functional in the flag-off drawer. Keep a short one for each template or
  fold it, per [open-questions.md](open-questions.md) #4.
- Every slug in either integration column must be added to `PROVIDERS` with the exact Composio
  key, or its logo silently drops. The Composio CDN never 404s, so verify spellings
  (`newrelic`, `googlesheets`, no hyphens).
