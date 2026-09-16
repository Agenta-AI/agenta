"""Sales-category template playbooks (leads, CRM, outreach).

One entry per template in this category, following the changelog-writer exemplar and the
playbook skeleton (docs/design/agent-workflows/projects/agent-templates/playbook-spec.md).
See this package's ``__init__`` docstring for how to add an entry.

Two CRM-write templates here (crm-updater, meeting-followup) are CHECK rows in the inventory:
their "required to run" integration is gmail, not the CRM. The CRM (hubspot, salesforce, or
attio) is a pick-one write target the agent wires when connected, never a hard connect gate.
"""

from __future__ import annotations

from typing import List

from . import TemplateEntry

_LEAD_QUALIFIER_BODY = """\
# Lead qualifier playbook

## Match
The ask is "enrich and qualify new inbound leads" or "add qualified leads to HubSpot/Salesforce."
Card key lead-qualifier. Also matches free-text asks about scoring or triaging new leads.

## Required context (ask via one request_input form)
- CRM destination: which pipeline or list qualified leads get added to. The agent cannot
  proceed without it. Set the field default to the guess a prior read surfaced; leave no
  default otherwise.
- Qualification criteria: what makes a lead qualified (company size, industry, budget signal).
  Multiline. No default; this is the user's business judgment.

## Researchable context (do not ask; figure it out and state the assumption)
- Lead source: check what is connected, and take the inbox, form, or CRM that already receives
  leads. If more than one qualifies, assume the CRM, and say which source you wired.
- Enrichment depth: assume a quick domain lookup per lead, and deepen only for a borderline
  lead. State the assumption, because deeper research per lead costs run time.

## Explore first (read before proposing)
1. discover_tools for the CRM read/write tools (get contact, create contact) and, if the lead
   source is email, the Gmail read tool.
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries the
   full tools list), against one or two real recent leads. Show the user a sample qualification
   verdict before wiring the full setup.

## Defaults / priors table (lead source to proposed setup)
| Lead source | Trigger | Tools | Behavior default |
|---|---|---|---|
| CRM webhook (new contact/deal) | event: new HubSpot contact | get contact + create/update contact | enrich from domain, score, tag qualified |
| Inbound email | event: new Gmail message matching filter | Gmail read + CRM create contact | parse sender, enrich, create contact with notes |
| Signup form via CRM | event: new lead record | get contact + update contact | enrich and score in place |

## Connections
HubSpot (or Salesforce/Attio) required to write the qualified lead. Gmail only if the lead
source is inbound email. If either is missing, request_connection and stop.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: read the new lead's contact or email
record with the exact read tool, research the company from the lead's domain, score against the
pinned qualification criteria, and finish by creating or updating the CRM record with the score
and enrichment notes using the exact write tool. Pin the pipeline id.

Output shape (CRM note field):
    Qualified: <yes/no> - <one-line reason>
    Enrichment: <company size, industry, signal found>

## Offer a test
Tell the person the setup is committed and offer a test run. Run `test_run` only if they
ask. When you do, send one blunt task message, read `verdict`, `tools`, and `approvals`
rather than the HTTP status, and read back the real side effect (the CRM record with its
score and notes) before you call it verified. For a trigger, point them at the Test event
button of a subscription or the Run button of a schedule.

## Closing report
Tell the user what the agent became, what is connected, what is subscribed, what you verified,
and anything that still needs them.
"""

_CRM_UPDATER_BODY = """\
# CRM updater playbook

## Match
The ask is "keep CRM contacts in sync with my email" or "update contact records from my
threads each day." Card key crm-updater. Also matches free-text asks about stale CRM data.

## Required context (ask via one request_input form)
- CRM target and scope: which CRM (HubSpot, Salesforce, or Attio) and which list or pipeline of
  contacts to consider. No default; the agent cannot proceed without it.

## Researchable context (do not ask; figure it out and state the assumption)
- What counts as update-worthy: read the CRM's own contact fields and update the ones a thread
  can fill, such as a new title, a company change, or a mentioned next step. State which
  fields you write.
- Unknown senders: assume you flag a likely prospect for review and skip the rest, and state
  the assumption. Creating a contact per unknown sender fills the CRM with noise.

## Explore first (read before proposing)
1. discover_tools for the Gmail read tool and the CRM get/update-contact tools.
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries the
   full tools list), against yesterday's threads. Show the user a sample proposed-update list
   before wiring the full setup.

## Defaults / priors table (situation to proposed setup)
| Situation | Trigger | Tools | Behavior default |
|---|---|---|---|
| CRM connected, known senders | daily schedule 09:00 local | Gmail search threads + CRM get/update contact | propose field diffs, hold for approval, then apply |
| CRM connected, unknown sender | daily schedule 09:00 local | Gmail search threads + CRM find contact | flag as possible new contact in the digest, no auto-create |
| CRM not yet connected | daily schedule 09:00 local | Gmail search threads only | build a preview digest of proposed updates, request_connection before the first write |

## Connections
Gmail is required to read threads. The CRM (HubSpot, Salesforce, or Attio) is where updates
land; if not yet connected, still explore with Gmail alone and produce a proposed-updates
preview, then request_connection before the first live write.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: search Gmail threads touched since the
last run, resolve each thread's sender against an existing CRM contact, diff the proposed field
changes, and compile them into ONE batch summary. Present the summary, then apply the updates one
contact at a time with the exact update tool, which is approval-gated: the platform's approval
gate on that tool is the review stop, not a separate step. If the gate is not approved, the run
ends with the proposal posted and nothing written.

## Offer a test
Tell the person the setup is committed and offer a test run. Run `test_run` only if they
ask. When you do, send one blunt task message, read `verdict`, `tools`, and `approvals`
rather than the HTTP status, and read back the real side effect (one updated contact) before
you call it verified. For a trigger, point them at the Test event button of a subscription
or the Run button of a schedule.

## Closing report
Tell the user what the agent became, what is connected, what is scheduled, what you verified,
and anything that still needs them, including the CRM connection if it is still missing.
"""

_OUTREACH_DRAFTER_BODY = """\
# Outreach drafter playbook

## Match
The ask is "draft personalized outreach emails for a list of contacts" or similar. Card key
outreach-drafter. Also matches free-text asks about cold email drafts or sequence copy.

## Required context (ask via one request_input form)
- Contact list or segment: which CRM view, list name, or filter to draft outreach for. No
  default; the agent cannot proceed without it.

## Researchable context (do not ask; figure it out and state the assumption)
- Angle or value prop: read each contact's company and role, and pick the angle from those.
  State the angle you used in the first draft you show.
- Draft destination: check what is connected. Write Gmail drafts when Gmail is connected, and
  otherwise return the text in the reply. Say which destination you used.

## Explore first (read before proposing)
1. discover_tools for the CRM list-contacts tool and, if connected, the Gmail create-draft tool.
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries the
   full tools list), against a few real contacts. Draft one sample email and show it to the user
   before drafting the full list.

## Defaults / priors table (situation to proposed setup)
| Situation | Trigger | Tools | Behavior default |
|---|---|---|---|
| Gmail connected | manual | CRM list-contacts + Gmail create-draft | one Gmail draft per contact, never sent |
| Gmail not connected | manual | CRM list-contacts only | return each draft as text in the reply |
| Contact has deal/notes history | manual | CRM get-contact detail | personalize with the noted context |

## Connections
HubSpot (or Salesforce/Attio) required to read the contact list. Gmail is optional: if
connected, drafts land in Gmail Drafts; otherwise the agent returns the drafts as text.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: read the pinned list or segment with
the exact list tool, pull each contact's firmographic and deal context, draft a personalized
email per contact in the shape below, and finish by creating a Gmail draft per contact with the
exact create-draft tool (or, if Gmail is not connected, returning all drafts as text). NEVER call
a send tool; this agent only drafts.

Output shape (per contact):
    To: <contact email>
    Subject: <subject>
    Body: <2-4 short paragraphs, one personalized hook>

## Offer a test
Tell the person the setup is committed and offer a test run. Run `test_run` only if they
ask. When you do, send one blunt task message, read `verdict`, `tools`, and `approvals`
rather than the HTTP status, and read back the real side effect (the Gmail draft for every
contact) before you call it verified. Confirm no send tool appears in `tools`.

## Closing report
Tell the user how many drafts were created, where they landed, what is connected, and remind
them the drafts wait for their review before sending.
"""

_MEETING_FOLLOWUP_BODY = """\
# Meeting follow-up playbook

## Match
The ask is "draft a follow-up email after each meeting and log notes to the CRM" or similar.
Card key meeting-followup. Also matches free-text asks about post-call recaps or meeting notes.

## Required context (ask via one request_input form)
- Meeting signal: how the agent should learn a meeting happened. Offer as an enum: a Google
  Calendar event ending, a recap or notes email landing in Gmail, or you mentioning a meeting by
  name. The trigger depends on it. Default to "recap email in Gmail" when no calendar is
  connected yet; otherwise leave no default.

## Researchable context (do not ask; figure it out and state the assumption)
- Follow-up depth: read the meeting notes and match their depth. Write a short thank-you with
  next steps when the notes are sparse, and a fuller recap when they are detailed. Say which
  shape you chose.

## Explore first (read before proposing)
1. discover_tools for the Gmail read and create-draft tools, plus Google Calendar and the CRM
   note/update tool if either is connected.
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries the
   full tools list), against one real recent meeting. Show the user a sample follow-up draft
   before wiring the full setup.

## Defaults / priors table (situation to proposed setup)
| Situation | Trigger | Tools | Behavior default |
|---|---|---|---|
| Calendar connected | event: calendar event ends | Calendar get-event + Gmail create-draft | draft follow-up to attendees; log CRM note if CRM connected |
| Only Gmail connected | event: new "notes" thread in Gmail | Gmail read + Gmail create-draft | draft follow-up referencing the notes; skip CRM logging |
| CRM connected | (same trigger as above) | + CRM add-note/update-deal tool | log meeting notes on the matching contact or deal |

## Connections
Gmail is required to draft the follow-up. Google Calendar and the CRM (HubSpot, Salesforce, or
Attio) are optional extensions: wire them when connected, but do not gate the build on them.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: identify the meeting's attendees and
agenda from the calendar event or notes thread, log a meeting note on the matching CRM record
with the exact note tool if the CRM is connected, then finish by creating a Gmail draft to the
attendees with the exact create-draft tool. NEVER call a send tool.

## Offer a test
Tell the person the setup is committed and offer a test run. Run `test_run` only if they
ask. When you do, send one blunt task message, read `verdict`, `tools`, and `approvals`
rather than the HTTP status, and read back the real side effect (the Gmail draft, and the
CRM note if the CRM is connected) before you call it verified. For a trigger, point them at
the Test event button of a subscription or the Run button of a schedule.

## Closing report
Tell the user what the agent became, what is connected, what is subscribed or scheduled, what
you verified, and anything that still needs them (for example, connecting the calendar or CRM).
"""

_PIPELINE_DIGEST_BODY = """\
# Pipeline digest playbook

## Match
The ask is "post a daily digest of pipeline changes and stale deals to Slack" or similar. Card
key pipeline-digest. Also matches free-text asks about a deals summary or pipeline health check.

## Required context (ask via one request_input form)
- Slack channel: where the digest posts. The agent cannot proceed without it. Set the field
  default to the guess a prior read surfaced; leave no default otherwise.
- Pipeline: which CRM pipeline to summarize, if the CRM has more than one. No default when more
  than one pipeline exists.

## Researchable context (do not ask; figure it out and state the assumption)
- Stale threshold: read the CRM's own deal ages to see how long a live deal usually sits. If
  that is inconclusive, assume 14 days without activity, and state the number you used.

## Explore first (read before proposing)
1. discover_tools for the CRM list-deals tool and the Slack post-message tool.
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries the
   full tools list), against the real pipeline. Draft one sample digest from real deals and show
   it to the user before scheduling it daily.

## Defaults / priors table (situation to proposed setup)
| Situation | Trigger | Tools | Behavior default |
|---|---|---|---|
| Single pipeline | daily schedule 09:00 local | CRM list-deals + Slack post | new, moved, won, lost, and stale deals since last run |
| Multiple pipelines, one primary | daily schedule 09:00 local | CRM list-deals (pinned pipeline id) + Slack post | same digest, scoped to the pinned pipeline |
| No changes since last run | daily schedule 09:00 local | CRM list-deals + Slack post | post a short "no pipeline changes" note, do not skip the run |

## Connections
HubSpot (or Salesforce/Attio) required to read deals; Slack required to post. If either is
missing, request_connection and stop until both are ready.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: list deals in the pinned pipeline
changed since the last run with the exact list tool, separately identify deals past the stale
threshold by last-activity date, group into new/moved/won/lost/stale, compose the digest in the
shape below, and finish by posting it to the pinned Slack channel with the exact post-message
tool. Pin the pipeline id and the channel id.

Output shape:
    *Pipeline digest - <date>*
    New: <count> | Moved: <count> | Won: <count> | Lost: <count>
    Stale (14+ days): <deal name> - <days since activity>

## Offer a test
Tell the person the setup is committed and offer a test run. Run `test_run` only if they
ask. When you do, send one blunt task message, read `verdict`, `tools`, and `approvals`
rather than the HTTP status, and read back the real side effect (the posted Slack message)
before you call it verified. For a trigger, point them at the Test event button of a
subscription or the Run button of a schedule.

## Closing report
Tell the user what the agent became, what is connected, what is scheduled, what you verified,
and anything that still needs them.
"""

ENTRIES: List[TemplateEntry] = [
    TemplateEntry(
        key="lead-qualifier",
        name="Lead qualifier",
        category="Sales",
        match=(
            "Enrich each new inbound lead, qualify it against my criteria, and add it "
            "to HubSpot or Salesforce"
        ),
        body=_LEAD_QUALIFIER_BODY,
    ),
    TemplateEntry(
        key="crm-updater",
        name="CRM updater",
        category="Sales",
        match="Update my CRM contact records from my recent email threads each day",
        body=_CRM_UPDATER_BODY,
    ),
    TemplateEntry(
        key="outreach-drafter",
        name="Outreach drafter",
        category="Sales",
        match="Draft personalized outreach emails for a list of CRM contacts",
        body=_OUTREACH_DRAFTER_BODY,
    ),
    TemplateEntry(
        key="meeting-followup",
        name="Meeting follow-up",
        category="Sales",
        match="Draft a follow-up email after each meeting and log notes to the CRM",
        body=_MEETING_FOLLOWUP_BODY,
    ),
    TemplateEntry(
        key="pipeline-digest",
        name="Pipeline digest",
        category="Sales",
        match="Post a daily digest of pipeline changes and stale deals to Slack",
        body=_PIPELINE_DIGEST_BODY,
    ),
]
