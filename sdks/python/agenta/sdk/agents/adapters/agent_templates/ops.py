"""Ops-category template playbooks (digests, reporting, cross-tool syncs).

One entry per template in this category, following the changelog-writer exemplar and the
playbook skeleton (docs/design/agent-workflows/projects/agent-templates/playbook-spec.md).
See this package's ``__init__`` docstring for how to add an entry.
"""

from __future__ import annotations

from typing import List

from . import TemplateEntry

_STANDUP_SUMMARIZER_BODY = """\
# Standup summarizer playbook

## Match
The ask is "post a daily standup digest of channel activity" or similar. Card key
standup-summarizer. Also matches free-text asks for a daily summary of what happened in a
Slack or Discord channel since yesterday.

## Required context (ask via one request_input form)
- Source channel: which Slack (or Discord) channel to summarize. No default; the agent
  cannot proceed without it.

## Researchable context (ask, defaulting to "figure it out")
- Destination channel: post the digest back into the source channel, or to a separate
  #standup channel. Enum with default "Same channel as the one being summarized."
- Post time: local time to send the digest. Enum with default "09:00 local"; the built-in
  Other… option covers an exact custom time.
- Local timezone: needed to convert the daily post time into a UTC cron. Description:
  "e.g. America/New_York. Leave empty to use UTC."

## Explore first (read before proposing)
1. discover_tools for the channel-read tool (read channel messages) and the send-message
   tool.
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries
   the full tools list), reading yesterday's real messages from the source channel, before
   committing anything.
3. Draft one example digest from the real messages and show it to the user.

## Defaults / priors table (situation to proposed setup)
| Situation | Trigger | Tools | Behavior default |
|---|---|---|---|
| Single team channel | daily schedule 09:00 local -> UTC cron | read channel messages + send message | summarize the last 24h of messages into one bullet per active person |
| Multiple team channels | daily schedule, one run | read messages per channel + send message | loop channels, post one digest per channel |
| Thread-heavy channel | daily schedule | read channel messages + read thread + send message | expand threads with replies before summarizing |

## Connections
Slack (or Discord): the channel to read, and the channel to post to. If neither is
connected, request_connection and stop.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: read all messages posted in the
source channel in the last 24 hours with the exact read tool, group them by author, write one
bullet per person summarizing what they posted (skip channel noise like joins), and finish by
posting the digest with the exact send-message tool to the pinned destination channel.

Output shape:
    ## Standup - <date>
    - <person>: <what they did or asked>
    - <person>: <what they did or asked>

## Verify
1. test_run with a blunt message ("Summarize yesterday's activity in this channel") and read
   the verdict and the tools line, not a 200. An incomplete verdict means rewrite the
   instructions blunter and re-test.
2. Fire an artificial trigger test message first. If that passes, ask the user to run the
   real trigger test: the Play "Run" button on the schedule.
3. Read back the posted digest to confirm the write landed.

## Closing report
Tell the user what the agent became, which channel it reads and posts to, the schedule
(local time and its UTC cron), what you verified, and anything still needed (for example,
authorizing the connection).
"""

_REPO_SLACK_DIGEST_BODY = """\
# Repo Slack digest playbook

## Match
The ask is "post a digest of new issues, commits, and PRs to Slack" twice a day, or similar.
Card key repo-slack-digest. Also matches free-text asks for a periodic repo activity summary
sent to a channel.

## Required context (ask via one request_input form)
- Repository: which GitHub (or GitLab) repo to read activity from. The agent cannot proceed
  without it. Set the field default to the guess a prior read surfaced; leave no default
  otherwise.
- Destination channel: which Slack (or Discord) channel to post the digest to. No default.

## Researchable context (ask, defaulting to "figure it out")
- What to include: new issues, commits, and PRs, or a subset. A multi-pick, so use
  multi-select ({type: "array", items: {type: "string", enum: ["issues", "commits", "PRs"]}})
  with default ["issues", "commits", "PRs"] (all three).
- Digest times: local times to post, twice a day. Enum with default "09:00 and 17:00 local";
  the built-in Other… option covers exact custom times.

## Explore first (read before proposing)
1. discover_tools for the repo-read tools (list issues, list commits, list pull requests)
   and the send-message tool.
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries
   the full tools list), reading the real repo's recent activity, before committing anything.
3. Draft one example digest from real repo activity and show it to the user.

## Defaults / priors table (situation to proposed setup)
| Situation | Trigger | Tools | Behavior default |
|---|---|---|---|
| Active repo, twice daily | two schedules, 09:00 & 17:00 local -> two UTC crons | list issues + list commits + list PRs + send message | since the last run, list new issues, commits, and PRs and post one grouped digest |
| Low-traffic repo | one daily schedule | same tools | same grouping, once a day |
| Multiple repos | twice daily, one run | same tools per repo | loop repos, post one digest per repo or a merged digest |

## Connections
GitHub (or GitLab) to read activity, and Slack (or Discord) to post to. If either is
missing, request_connection and stop.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: list issues opened, commits pushed,
and PRs opened or merged since the last run with the exact list tools, group them under three
headings, and finish by posting the digest with the exact send-message tool to the pinned
channel. Pin the repo and the channel id.

Output shape:
    ## Repo digest - <date> <AM/PM>
    ### New issues
    - <title> (#<number>)
    ### New PRs
    - <title> (#<number>)
    ### Commits
    - <message> (<sha>)

## Verify
1. test_run with a blunt message ("Post a digest of today's repo activity") and read the
   verdict and the tools line, not a 200.
2. This template needs two schedules (morning and evening). Fire an artificial trigger test
   message for each, then ask the user to run the real trigger test: the Play "Run" button on
   each schedule.
3. Read back the posted digest to confirm the write landed.

## Closing report
Tell the user what the agent became, the repo and channel it is wired to, both schedules
(local time and UTC cron), what you verified, and anything still needed.
"""

_CROSS_TOOL_SYNC_BODY = """\
# Cross-tool sync playbook

## Match
The ask is "mirror new Linear issues into a Notion tracker" or similar, keeping two tools in
sync on a schedule or event. Card key cross-tool-sync. Also matches free-text asks about
mirroring issues, tickets, or records between two systems.

## Required context (ask via one request_input form)
- Source: which tool and identifier to read new records from (for example, a Linear team, a
  Jira project). No default; the agent cannot proceed without it.
- Destination: which tool and identifier to write mirrored records to (for example, a Notion
  database URL, a Confluence space). No default.

## Researchable context (ask, defaulting to "figure it out")
- Sync cadence: polling on a schedule, or event-driven if the source supports a webhook.
  Enum with default "Use your best judgment (hourly schedule is simplest and most
  reliable)."
- Field mapping: which source fields map to which destination properties. Enum with
  default "Use your best judgment based on the destination's existing schema."

## Explore first (read before proposing)
1. discover_tools for the source-read tool (list issues) and the destination-write tool
   (create or update a record).
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries
   the full tools list): list a few real source records, and read the destination's actual
   schema (for example, the Notion database's properties).
3. Draft one mapped example record and show it to the user before committing the full setup.

## Defaults / priors table (situation to proposed setup)
| Situation | Trigger | Tools | Behavior default |
|---|---|---|---|
| Linear -> Notion | schedule hourly -> UTC cron | list Linear issues updated since last run + create/update Notion page | upsert one Notion row per issue, keyed by the Linear issue id |
| Jira -> Notion | schedule hourly | list Jira issues + create/update Notion page | same, keyed by the Jira issue key |
| Linear -> GitHub | schedule hourly (or event: issue created, if wired) | list Linear issues + create GitHub issue | mirror open issues only, skip ones already mirrored |

Gotcha: polling re-reads the same window every run, so the write step must be an upsert keyed
by the source id (check for an existing destination record before creating one), not a blind
create, or every run duplicates rows.

## Connections
Source tool (Linear or Jira) and destination tool (Notion, Confluence, or GitHub). If either
is missing, request_connection and stop.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: list source records updated since
the last run with the exact list tool, for each one check the destination for an existing
mirrored record by the source id, then create it if missing or update it if changed with the
exact write tool. Pin the source id and destination id.

## Verify
1. test_run with a blunt message ("Sync the latest issues now") and read the verdict and the
   tools line, not a 200.
2. Fire an artificial trigger test message first. If that passes, ask the user to run the
   real trigger test: the Play "Run" button for a schedule, or the Lightning "Test event"
   button if wired to a source webhook.
3. Read back the destination record to confirm the write landed and was not duplicated.

## Closing report
Tell the user what the agent became, the source and destination it syncs, the schedule or
event it runs on, what you verified, and anything still needed.
"""

_WEEKLY_REPORT_BODY = """\
# Weekly report playbook

## Match
The ask is "compile a weekly report of shipping and product metrics" or similar. Card key
weekly-report. Also matches free-text asks for a weekly summary of what shipped, sent to a
doc or channel.

## Required context (ask via one request_input form)
- Repository (and team, if Linear is used): which GitHub repo to read shipped PRs from. No
  default; the agent cannot proceed without it.
- Destination: which Notion page or database (or Slack channel) to publish the report to.
  No default.

## Researchable context (ask, defaulting to "figure it out")
- Metrics scope: shipping activity only, or shipping plus product metrics from PostHog.
  Enum with default "Use your best judgment: include PostHog only if it's connected,
  otherwise shipping activity only."
- Report time: enum with default "Monday 09:00 local"; the built-in Other… option covers a
  custom time.

## Explore first (read before proposing)
1. discover_tools for the GitHub read tools (list merged PRs, list commits), the Linear read
   tool if connected, the PostHog read tool if connected, and the destination write tool.
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries
   the full tools list), reading the real week's shipped PRs, before committing anything.
3. Draft one example report section from real data and show it to the user.

## Defaults / priors table (situation to proposed setup)
| Situation | Trigger | Tools | Behavior default |
|---|---|---|---|
| GitHub only | weekly schedule Monday 09:00 local -> UTC cron | list merged PRs/commits + write to destination | summarize the week's shipped PRs into a "Shipped" section, publish |
| GitHub + PostHog connected | same | + PostHog read | add a "Product metrics" section; if the PostHog read fails, publish the GitHub-only report rather than blocking |
| GitHub + Linear connected | same | + list closed Linear issues | add a "Delivered issues" section |

## Connections
GitHub is required to run: it reads the shipped work every report depends on. Notion (or
Slack) is the required publish target. PostHog is optional: if it is not connected, skip the
product-metrics section instead of requesting a connection or stopping the build.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: list PRs merged (and commits pushed)
since the last run with the exact list tool, list closed Linear issues if that tool is wired,
read PostHog's key metrics if that tool is wired, and finish by publishing the report in the
output shape below with the exact write tool. Pin the repo, team, and destination ids.

Output shape:
    ## Weekly report - week of <date>
    ### Shipped
    - <PR title> (#<number>)
    ### Product metrics (if connected)
    - <metric>: <value>

## Verify
1. test_run with a blunt message ("Compile this week's report now") and read the verdict and
   the tools line, not a 200. Confirm it works both with and without the PostHog tool
   present.
2. Fire an artificial trigger test message first. If that passes, ask the user to run the
   real trigger test: the Play "Run" button on the schedule.
3. Read back the published report to confirm the write landed.

## Closing report
Tell the user what the agent became, what is connected (and which PostHog-based section is
skipped if not), the schedule, what you verified, and anything still needed.
"""

ENTRIES: List[TemplateEntry] = [
    TemplateEntry(
        key="standup-summarizer",
        name="Standup summarizer",
        category="Ops",
        match=(
            "Post a daily standup digest of yesterday's Slack or Discord channel activity"
        ),
        body=_STANDUP_SUMMARIZER_BODY,
    ),
    TemplateEntry(
        key="repo-slack-digest",
        name="Repo Slack digest",
        category="Ops",
        match=(
            "Post a twice-a-day digest of new issues, commits, and PRs from a repo to Slack"
        ),
        body=_REPO_SLACK_DIGEST_BODY,
    ),
    TemplateEntry(
        key="cross-tool-sync",
        name="Cross-tool sync",
        category="Ops",
        match=(
            "Mirror new records from one tool into another on a schedule, "
            "such as Linear issues into a Notion tracker"
        ),
        body=_CROSS_TOOL_SYNC_BODY,
    ),
    TemplateEntry(
        key="weekly-report",
        name="Weekly report",
        category="Ops",
        match=(
            "Compile a weekly report of shipping activity and product metrics "
            "and publish it to Notion or Slack"
        ),
        body=_WEEKLY_REPORT_BODY,
    ),
]
