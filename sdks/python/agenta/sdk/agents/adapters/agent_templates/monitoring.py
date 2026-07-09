"""Monitoring-category template playbooks (incidents, errors, uptime).

One entry per template in this category, following the changelog-writer exemplar and the
playbook skeleton (docs/design/agent-workflows/projects/agent-templates/playbook-spec.md).
See this package's ``__init__`` docstring for how to add an entry.

All four templates in this category require a live Sentry connection to run; Datadog, New
Relic, and PagerDuty are display-logo, CHECK-confidence integrations each playbook may use as
an optional context source but never hard-requires (docs/design/agent-workflows/projects/
agent-templates/template-inventory.md, "## Monitoring").
"""

from __future__ import annotations

from typing import List

from . import TemplateEntry

_INCIDENT_RESPONDER_BODY = """\
# Incident responder playbook

## Match
The ask is "gather context on new alerts and page on-call" or similar. Card key
incident-responder. Also matches free-text asks about incident response, alert triage, or
"who do I page for this."

## Required context (ask via one request_input form)
- Sentry project or org to watch: no default; the agent cannot proceed without it.
  Description: "press Enter to accept the project I found: <guess>" when a prior read
  surfaced one.
- Where to send alerts: the Slack channel to post to, and/or the PagerDuty escalation policy
  to page. No default; the agent cannot know who is on call or where the team looks for
  alerts without being told.

## Researchable context (ask, but the first option is "figure it out")
- Paging threshold: which severities actually page vs. just get logged. Enum first option:
  "Use your best judgment (page on fatal/error, log the rest)." Note in the description:
  handing this over is faster than the agent inferring it from issue history.

## Explore first (read before proposing)
1. discover_tools for the Sentry read tools (list issues, get an issue, list events).
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries
   the full tools list), against the real project, to see actual recent issues before
   committing. If the flow cannot carry the delta, commit the read tools, stop the turn, and
   ask the user to continue.

## Defaults / priors table (connected tools to proposed setup)
| Setup | Trigger | Tools | Behavior default |
|---|---|---|---|
| Sentry only | event: new Sentry issue | get issue + list events + Slack send | post a triage summary; treat "page" as posting to the channel |
| Sentry + PagerDuty | event: new Sentry issue | get issue + trigger PagerDuty incident + Slack send | trigger PagerDuty for fatal/error, always post the summary to Slack |
| Sentry + Datadog/New Relic (CHECK) | event: new Sentry issue | get issue + optional metric read + Slack send | same as above; use the extra signal to enrich the summary, never to gate it |

## Connections
Sentry is required to run: request_connection and stop if missing. Slack and/or PagerDuty are
required as the actual notify/page target (ask which in required context above). Datadog and
New Relic are optional context sources; mention them if connected, never block on them.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: get the Sentry issue that fired the
event (pin the project id), pull its severity, frequency, first-seen time, and affected users,
draft the incident summary below, page via the exact PagerDuty tool only if severity crosses
the threshold, and finish every run by posting the summary to the pinned Slack channel with
the exact send-message tool.

Output shape:
    ## Incident: <title>
    Severity: <level>  First seen: <time>
    Impact: <one line>
    Suspected cause: <one line, or "unknown, investigating">
    Paged: <yes/no, escalation policy>

## Verify
1. test_run with an artificial alert-shaped message ("New Sentry issue: NullPointerException
   in checkout-service, level=fatal, 40 events/min") and read the verdict and the tools line,
   not a 200. An incomplete verdict means rewrite the instructions blunter and re-test.
2. Fire an artificial trigger test message first. If that passes, ask the user to run the
   real trigger test: the Lightning "Test event" button on the Sentry event subscription.
3. Read back the posted Slack message (and the PagerDuty incident, if triggered) to confirm
   the write landed.

## Closing report
Tell the user what the agent became, what is connected, what is subscribed, what you
verified, and anything that still needs them (for example, PagerDuty not yet connected).
"""

_ERROR_TRIAGE_BODY = """\
# Error triage playbook

## Match
The ask is "triage new Sentry errors by severity and file a ticket for real ones" or similar.
Card key error-triage. Also matches free-text asks about error noise reduction or "should I
file a ticket for this error."

## Required context (ask via one request_input form)
- Sentry project or org to watch: no default; the agent cannot proceed without it.
  Description: "press Enter to accept the project I found: <guess>" when a prior read
  surfaced one.
- Where new tickets go: a Linear team or a Jira project. No default; the agent cannot guess
  the filing destination.

## Researchable context (ask, but the first option is "figure it out")
- What counts as noise vs. a real error: known third-party or expected exceptions to ignore,
  and the frequency that promotes an error to "file it." Enum first option: "Use your best
  judgment (ignore known-noisy exceptions, file anything crossing a frequency threshold)."

## Explore first (read before proposing)
1. discover_tools for the Sentry read tools (list issues, get an issue) and the ticket-create
   tool for the chosen destination (Linear or Jira), plus its search tool.
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries
   the full tools list), against real recent errors, before committing. If the flow cannot
   carry the delta, commit the read tools, stop the turn, and ask the user to continue.

## Defaults / priors table (ticket destination to proposed setup)
| Destination | Trigger | Tools | Behavior default |
|---|---|---|---|
| Linear | event: new Sentry issue | get issue + search Linear issues + create issue | dedupe by title/fingerprint, file if new and crosses the severity threshold |
| Jira | event: new Sentry issue | get issue + search Jira issues + create issue | same, filed as a Jira bug with a severity label |

## Connections
Sentry is required to run: request_connection and stop if missing. Linear or Jira (whichever
the user picked) is also required, since it is the filing destination, not an optional extra.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: get the Sentry issue that fired the
event (pin the project id), pull its level, frequency, and first-seen/last-seen times, search
the ticket tracker by the issue fingerprint or title to rule out a duplicate, compare against
the known-noisy patterns from the researchable context, and finish by creating the ticket with
the exact create-issue tool only when the error is new and real. If it is noise or a
duplicate, stop without filing.

Ticket shape:
    Title: [<severity>] <exception type> in <service>
    Body: First seen <time>, <n> events/<window>. <stack trace excerpt>. Sentry: <link>

## Verify
1. test_run with an artificial message ("New Sentry issue: TimeoutError in payment-worker,
   level=error, 12 events in 5m, first seen 3 min ago") and read the verdict and the tools
   line, not a 200. Confirm it either files or correctly skips as noise.
2. Fire an artificial trigger test message first. If that passes, ask the user to run the
   real trigger test: the Lightning "Test event" button on the Sentry event subscription.
3. Read back the created ticket to confirm the write landed.

## Closing report
Tell the user what the agent became, what is connected, what is subscribed, what you
verified, and anything that still needs them.
"""

_UPTIME_REPORTER_BODY = """\
# Uptime reporter playbook

## Match
The ask is "post a daily uptime and error-rate summary to Slack" or similar. Card key
uptime-reporter. Also matches free-text asks about a daily status digest or an SLA rollup.

## Required context (ask via one request_input form)
- Sentry project or org to summarize: no default; the agent cannot proceed without it.
  Description: "press Enter to accept the project I found: <guess>" when a prior read
  surfaced one.
- Slack channel to post the daily summary to: no default; the agent cannot guess where the
  team wants it.

## Researchable context (ask, but the first option is "figure it out")
- Whether to include an uptime percentage from Datadog or New Relic, if connected. Enum first
  option: "Use your best judgment (include it if connected, otherwise report error rate
  only)." Note in the description: this is a CHECK integration, so treat it as optional.

## Explore first (read before proposing)
1. discover_tools for the Sentry read tools (list issues/events over a time window) and, if
   connected, the Datadog or New Relic monitor-status tool.
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries
   the full tools list), over the last 24 hours of real data, before committing the schedule.

## Defaults / priors table (signals connected to proposed setup)
| Signals connected | Trigger | Tools | Behavior default |
|---|---|---|---|
| Sentry only | schedule, daily 09:00 local | list issues (24h window) + Slack send | error-rate and top-issues summary, no uptime line |
| Sentry + Datadog or New Relic (CHECK) | schedule, daily 09:00 local | list issues + monitor status + Slack send | same summary, prefixed with the uptime percentage |

## Connections
Sentry is required to run: request_connection and stop if missing. Datadog and New Relic are
optional context sources for the uptime percentage; mention them if connected, never block
the digest on them.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: list Sentry issues and events for
the pinned project over the last 24 hours, compute the error count, the new-vs-recurring
split, and the top three issues by volume, read the monitor status for the pinned service
only if Datadog or New Relic is connected and include the uptime line, and finish every run
by posting the digest to the pinned Slack channel with the exact send-message tool.

Output shape:
    ## Uptime & errors -- <date>
    Uptime: <pct>%  (omit if no uptime source connected)
    Errors (24h): <count> (<new> new)
    Top issues:
    - <title> (<count> events)

## Verify
1. test_run with an artificial message ("Summarize the last 24 hours") and read the verdict
   and the tools line, not a 200. An incomplete verdict means rewrite the instructions
   blunter and re-test.
2. Fire an artificial schedule-fire test message first. If that passes, ask the user to run
   the real trigger test: the Play "Run" button on the schedule.
3. Read back the posted Slack message to confirm the write landed.

## Closing report
Tell the user what the agent became, what is connected, what is scheduled, what you
verified, and anything that still needs them.
"""

_ONCALL_BRIEFER_BODY = """\
# On-call briefer playbook

## Match
The ask is "brief on-call at 09:00 with all open incidents and their status" or similar. Card
key oncall-briefer. Also matches free-text asks about an on-call handoff briefing or a daily
incident standup.

## Required context (ask via one request_input form)
- Sentry project or org to watch: no default; the agent cannot proceed without it.
  Description: "press Enter to accept the project I found: <guess>" when a prior read
  surfaced one.
- Where to post the briefing: a Slack channel or DM, and, if PagerDuty is connected, which
  escalation policy to read on-call from. No default; the agent cannot guess either.

## Researchable context (ask, but the first option is "figure it out")
- How far back "open" reaches: all unresolved Sentry issues, or only ones touched in the last
  24 hours. Enum first option: "Use your best judgment (all unresolved issues, plus any open
  PagerDuty incidents if connected)."

## Explore first (read before proposing)
1. discover_tools for the Sentry read tools (list unresolved issues) and, if connected, the
   PagerDuty on-call and open-incidents tools.
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries
   the full tools list), against real open issues, before committing the schedule.

## Defaults / priors table (on-call source to proposed setup)
| Setup | Trigger | Tools | Behavior default |
|---|---|---|---|
| Sentry only | schedule, daily 09:00 local | list unresolved issues + Slack send | list unresolved issues by severity, no named on-call |
| Sentry + PagerDuty (CHECK) | schedule, daily 09:00 local | list unresolved issues + get on-call + list open incidents + Slack send | same list, prefixed with who is on-call and any open PagerDuty incidents |

## Connections
Sentry is required to run: request_connection and stop if missing. PagerDuty is an optional
extension for naming the on-call engineer and cross-checking open incidents; mention it if
connected, never block the briefing on it.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: list unresolved Sentry issues for
the pinned project sorted by severity, get the current on-call and list open PagerDuty
incidents only if PagerDuty is connected, group issues into new-since-yesterday vs.
still-open with a one-line status each, and finish every run by posting the briefing to the
pinned Slack channel with the exact send-message tool.

Output shape:
    ## On-call briefing -- <date>
    On-call: <name>  (omit if PagerDuty not connected)
    New since yesterday: <n>
    - <title> (<severity>)
    Still open: <n>
    - <title> (<days open>d)

## Verify
1. test_run with an artificial message ("Brief on-call with today's open incidents") and read
   the verdict and the tools line, not a 200. An incomplete verdict means rewrite the
   instructions blunter and re-test.
2. Fire an artificial schedule-fire test message first. If that passes, ask the user to run
   the real trigger test: the Play "Run" button on the schedule.
3. Read back the posted Slack message to confirm the write landed.

## Closing report
Tell the user what the agent became, what is connected, what is scheduled, what you
verified, and anything that still needs them.
"""

ENTRIES: List[TemplateEntry] = [
    TemplateEntry(
        key="incident-responder",
        name="Incident responder",
        category="Monitoring",
        match=(
            "Gather context on a new alert and page on-call, or triage an incident as it fires"
        ),
        body=_INCIDENT_RESPONDER_BODY,
    ),
    TemplateEntry(
        key="error-triage",
        name="Error triage",
        category="Monitoring",
        match=(
            "Triage new Sentry errors by severity and file a ticket for the real ones, "
            "skipping known noise"
        ),
        body=_ERROR_TRIAGE_BODY,
    ),
    TemplateEntry(
        key="uptime-reporter",
        name="Uptime reporter",
        category="Monitoring",
        match="Post a daily uptime and error-rate summary to Slack",
        body=_UPTIME_REPORTER_BODY,
    ),
    TemplateEntry(
        key="oncall-briefer",
        name="On-call briefer",
        category="Monitoring",
        match=(
            "Brief on-call at the start of the day with all open incidents and their status"
        ),
        body=_ONCALL_BRIEFER_BODY,
    ),
]
