"""Support-category template playbooks (customer support).

One entry per template in this category, following the changelog-writer exemplar and the
playbook skeleton (docs/design/agent-workflows/projects/agent-templates/playbook-spec.md).
See this package's ``__init__`` docstring for how to add an entry.
"""

from __future__ import annotations

from typing import List

from . import TemplateEntry

# support-triage: kept original key, do not renumber. SOLID, required to run: slack.
_SUPPORT_TRIAGE_BODY = """\
# Support triage playbook

## Match
The ask is "triage new #support threads, tag urgency, and route to owners" or similar. Card
key support-triage. Also matches free-text asks about watching a support channel, tagging
ticket urgency, or routing threads to the right person.

## Required context (ask via one request_input form)
- Support channel: which Slack (or Discord) channel to watch. Description: "press Enter to
  accept the channel I found: <guess>" when a prior read surfaced one.
- Owners and their areas: who routes get sent to, and what each owns. No default; the agent
  cannot invent your team's routing.

## Researchable context (ask, but the first option is "figure it out")
- Urgency scale: how many tiers (for example urgent/normal/low) and what counts as urgent.
  Enum first option: "Use your best judgment (I'll propose a 3-tier scale)." Note in the
  description: handing this over is faster than the agent inferring it from past threads.

## Explore first (read before proposing)
1. discover_tools for the Slack read tools (read channel, read thread, list channel members).
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries
   the full tools list), to read recent real threads without committing. If the flow cannot
   carry the delta, commit the read tools, stop the turn, and ask the user to continue.
3. Draft one example triage (urgency tag plus routed owner) from a real thread and show it to
   the user before wiring the full setup.

## Defaults / priors table (situation to proposed setup)
| Situation | Trigger | Tools | Behavior default |
|---|---|---|---|
| Single support channel, few owners | event: new message in the channel | read thread + read user profile + send message | tag urgency, @-mention the owner in-thread, never close |
| Multiple product areas | event: new message in the channel | read thread + add reaction + send message | tag urgency and area, route by keyword match to the area's owner |
| No dedicated owners yet | event: new message in the channel | read thread + add reaction | tag urgency only, post a summary reaction, skip routing |

## Connections
Slack (or Discord) with read and post access to the support channel. If missing,
request_connection and stop until it is ready.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: read the new thread with the exact
read-thread tool, classify urgency against the agreed scale, match the topic to an owner from
the pinned routing list, and finish by posting the triage in-thread with the exact send-message
tool. Pin the channel id and the owner list. Never close or resolve a thread; only tag and
route.

Output shape:
    Urgency: <tier>
    Routed to: <owner>
    Why: <one line>

## Verify
1. test_run with a blunt test message shaped like a support thread ("Our export button is
   throwing a 500, can someone look?") and read the verdict and the tools line, not a 200. An
   incomplete verdict means rewrite the instructions blunter and re-test.
2. Fire an artificial trigger test message first. If that passes, ask the user to run the real
   trigger test: the Lightning "Test event" button for this event subscription.
3. Read back the posted triage reply to confirm the write landed.

## Closing report
Tell the user what the agent became, what channel and owners it is watching for, what you
verified, and anything that still needs them (for example, a Slack connection they must
authorize).
"""

# support-reply-drafter: CHECK confidence. Required to run stays zendesk only; notion,
# confluence, and googledrive are display-only knowledge-source extensions, not hard gates.
_SUPPORT_REPLY_DRAFTER_BODY = """\
# Support reply drafter playbook

## Match
The ask is "draft replies to new support tickets using our docs" or similar. Card key
support-reply-drafter. Also matches free-text asks about auto-drafting ticket responses or
answering tickets from a knowledge base.

## Required context (ask via one request_input form)
- Ticket source: which Zendesk (or Intercom) instance to watch for new tickets. Description:
  "press Enter to accept the instance I found: <guess>" when a prior read surfaced one.

## Researchable context (ask, but the first option is "figure it out")
- Knowledge source: where answers come from (Notion, Confluence, Google Drive, or the ticket
  system's own help center). Enum first option: "Figure it out from what's connected." These
  are optional extensions, not required to run; without one the agent drafts from ticket
  history alone and says so.
- Draft posture: draft-only for review, or auto-send for high-confidence matches. Enum first
  option: "Use your best judgment (draft-only until you say otherwise)."

## Explore first (read before proposing)
1. discover_tools for the ticket read tools (get ticket, list tickets) and, if connected, the
   knowledge-source search tool (Notion/Confluence/Drive search).
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries
   the full tools list), against one real recent ticket. If the flow cannot carry the delta,
   commit the read tools, stop the turn, and ask the user to continue.
3. Draft one example reply from a real ticket and show it to the user before wiring the full
   setup.

## Defaults / priors table (situation to proposed setup)
| Situation | Trigger | Tools | Behavior default |
|---|---|---|---|
| Knowledge source connected | event: new ticket | get ticket + search knowledge source + add internal comment | draft a reply citing the source, post as an internal (unsent) comment |
| No knowledge source connected | event: new ticket | get ticket + list tickets (find similar) + add internal comment | draft from ticket history and past resolutions, flag low confidence |
| Auto-send approved | event: new ticket | get ticket + search knowledge source + reply to ticket | draft, then send directly for matches above the agreed confidence bar |

## Connections
Zendesk (or Intercom) is required to run; request_connection and stop if it is missing. A
knowledge source (Notion, Confluence, or Google Drive) is optional: if none is connected,
proceed without it and note the gap in the reply draft rather than blocking setup.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: read the new ticket with the exact
get-ticket tool, search the connected knowledge source for a matching answer (skip this step
if none is connected), draft a reply in the customer's tone, and finish by posting it with the
exact comment or reply tool per the agreed draft posture. Pin the ticket-system instance id and
the knowledge-source location.

Output shape:
    Subject: <ticket subject>
    Draft reply: <text>
    Cited from: <source, or "ticket history only">
    Confidence: <high/low>

## Verify
1. test_run with a blunt test message shaped like a new ticket ("Customer asks how to export
   their data to CSV") and read the verdict and the tools line, not a 200. An incomplete
   verdict means rewrite the instructions blunter and re-test.
2. Fire an artificial trigger test message first. If that passes, ask the user to run the real
   trigger test: the Lightning "Test event" button for this event subscription.
3. Read back the posted draft (or comment) to confirm the write landed.

## Closing report
Tell the user what the agent became, what ticket system and knowledge source it uses (or that
none is connected), what you verified, and anything that still needs them.
"""

# bug-report-router: SOLID, required to run: slack.
_BUG_REPORT_ROUTER_BODY = """\
# Bug report router playbook

## Match
The ask is "turn support complaints into Linear (or Jira/GitHub) bug tickets with repro
steps" or similar. Card key bug-report-router. Also matches free-text asks about converting
Slack or Intercom messages into filed bugs, or being mentioned to file one.

## Required context (ask via one request_input form)
- Bug tracker and project: which Linear team, Jira project, or GitHub repo new tickets go to.
  Description: "press Enter to accept: <guess>" when a prior read surfaced one.

## Researchable context (ask, but the first option is "figure it out")
- Repro-steps extraction: whether to ask the reporter follow-up questions when steps are
  missing, or file with what is given. Enum first option: "Use your best judgment (ask once
  if repro steps are missing, then file anyway)."

## Explore first (read before proposing)
1. discover_tools for the Slack (or Intercom) read tools (read thread, read message) and the
   tracker's create-issue tool.
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries
   the full tools list), against one real complaint thread. If the flow cannot carry the
   delta, commit the read tools, stop the turn, and ask the user to continue.
3. Draft one example bug ticket from a real thread and show it to the user before wiring the
   full setup.

## Defaults / priors table (situation to proposed setup)
| Situation | Trigger | Tools | Behavior default |
|---|---|---|---|
| Watching a channel | event: new message matching a bug pattern | read thread + create issue + send message | file the ticket, reply in-thread with the link |
| Mention-triggered | mention | read thread + create issue + send message | file the ticket from the mentioned message, confirm with a link |
| Cross-posted from multiple sources | event/mention | read thread + search issues (dedupe) + create issue | check for an existing ticket on the same bug before filing a new one |

## Connections
Slack (or Intercom) to read the report, and the bug tracker (Linear, Jira, or GitHub) to file
it. If either is missing, request_connection and stop until it is ready.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: read the reported message with the
exact read tool, extract the symptom and any repro steps, search the tracker for an existing
matching ticket, and finish by creating the ticket with the exact create-issue tool
(or replying in-thread with the existing ticket's link if a duplicate was found). Pin the
tracker project or team id.

Output shape:
    Title: <short bug title>
    Repro steps: <numbered list, or "not provided">
    Reported by: <name/handle>
    Ticket: <link>

## Verify
1. test_run with a blunt test message shaped like a bug report ("The app crashes when I
   upload a file over 10MB") and read the verdict and the tools line, not a 200. An incomplete
   verdict means rewrite the instructions blunter and re-test.
2. Fire an artificial trigger test message first. If that passes, ask the user to run the real
   trigger test: the Lightning "Test event" button for this event subscription (or send a real
   mention if mention-triggered).
3. Read back the created ticket to confirm the write landed.

## Closing report
Tell the user what the agent became, what channel and tracker it is wired to, what you
verified, and anything that still needs them.
"""

# feedback-clusterer: SOLID, required to run: slack.
_FEEDBACK_CLUSTERER_BODY = """\
# Feedback clusterer playbook

## Match
The ask is "daily cluster new customer feedback into themes and log them to Notion" or
similar. Card key feedback-clusterer. Also matches free-text asks about summarizing feedback
trends or grouping complaints by topic.

## Required context (ask via one request_input form)
- Feedback source: which Slack channel (or Intercom inbox) to read feedback from.
  Description: "press Enter to accept the channel I found: <guess>" when a prior read
  surfaced one.
- Where clusters are logged: a Notion database or page. No default; the agent cannot invent
  where you track this.

## Researchable context (ask, but the first option is "figure it out")
- Clustering granularity: broad themes (3-5) or fine-grained topics. Enum first option: "Use
  your best judgment (I'll propose 3-5 themes from a sample day)." Note in the description:
  handing this over is faster than the agent researching your past feedback volume.

## Explore first (read before proposing)
1. discover_tools for the Slack (or Intercom) read tools (read channel, read thread) and the
   Notion write tool (create page or update database).
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries
   the full tools list), against a real day of messages. If the flow cannot carry the delta,
   commit the read tools, stop the turn, and ask the user to continue.
3. Draft one example cluster summary from real messages and show it to the user before wiring
   the full setup.

## Defaults / priors table (situation to proposed setup)
| Situation | Trigger | Tools | Behavior default |
|---|---|---|---|
| Single feedback channel | schedule (daily) | read channel + create Notion page | cluster the day's messages into themes, log one page per day |
| Feedback spread across channels | schedule (daily) | read channel (per channel) + create Notion page | merge all channels' messages before clustering |
| Ongoing tracker preferred | schedule (daily) | read channel + update Notion database | append the day's themes as rows to an existing tracker database |

## Connections
Slack (or Intercom) to read feedback, and Notion to log clusters. If either is missing,
request_connection and stop until it is ready.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: read the prior day's messages with
the exact read-channel tool, group them into themes by topic, count mentions per theme, and
finish by logging the clusters with the exact Notion write tool. Pin the channel id and the
Notion database or page id.

Output shape:
    ## <date>
    ### <theme>
    - <count> mentions
    - Example: "<quoted message>"

## Verify
1. test_run with a blunt test message ("Cluster today's feedback from #feedback") and read
   the verdict and the tools line, not a 200. An incomplete verdict means rewrite the
   instructions blunter and re-test.
2. Fire an artificial trigger test message first. If that passes, ask the user to run the real
   trigger test: the Play "Run" button for this schedule.
3. Read back the logged Notion entry to confirm the write landed.

## Closing report
Tell the user what the agent became, what is connected, what is scheduled, what you verified,
and anything that still needs them.
"""

ENTRIES: List[TemplateEntry] = [
    TemplateEntry(
        key="support-triage",
        name="Support triage",
        category="Support",
        match=(
            "Watch a support channel, tag urgency on new threads, and route them to the "
            "right owner"
        ),
        body=_SUPPORT_TRIAGE_BODY,
    ),
    TemplateEntry(
        key="support-reply-drafter",
        name="Support reply drafter",
        category="Support",
        match="Draft replies to new support tickets using answers from our docs",
        body=_SUPPORT_REPLY_DRAFTER_BODY,
    ),
    TemplateEntry(
        key="bug-report-router",
        name="Bug report router",
        category="Support",
        match="Turn support complaints into bug tickets with repro steps",
        body=_BUG_REPORT_ROUTER_BODY,
    ),
    TemplateEntry(
        key="feedback-clusterer",
        name="Feedback clusterer",
        category="Support",
        match="Cluster new customer feedback into themes on a schedule and log them",
        body=_FEEDBACK_CLUSTERER_BODY,
    ),
]
