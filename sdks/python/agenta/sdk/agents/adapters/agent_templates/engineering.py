"""Engineering-category template playbooks (dev-workflow automation).

One entry per template in this category, following the changelog-writer exemplar and the
playbook skeleton (docs/design/agent-workflows/projects/agent-templates/playbook-spec.md).
See this package's ``__init__`` docstring for how to add an entry.
"""

from __future__ import annotations

from typing import List

from . import TemplateEntry

# The hand-written seed playbook. Body sourced from the workspace exemplar; it layers the
# changelog use case onto the generic build loop and never repeats the loop or the config
# schema. Keep it 1-2 KB: a bigger playbook hides what is relevant from a Sonnet-class model.
_CHANGELOG_WRITER_BODY = """\
# Changelog writer playbook

## Match
The ask is "turn merged pull requests into release notes" or similar. Card key
changelog-writer. Also matches free-text asks about release notes, changelogs, or "what
shipped" summaries from a repo.

## Required context (ask via one request_input form)
- Repository: which GitHub or GitLab repo to read merged PRs from. No default; the agent
  cannot proceed without it. Description: "press Enter to accept the repo I found: <guess>"
  when a prior read surfaced one.
- Where release notes are published: the docs page, a Notion database, or a Linear
  document. Offer these as an enum. First option: "Figure it out from what's connected."

## Researchable context (ask, but the first option is "figure it out")
- How the team releases: merge to main, GitHub releases, or release branches. The agent can
  discover this by reading the repo. Enum first option: "Use your best judgment (I'll read
  the repo)." Note in the description: handing this over is faster than the agent researching
  it.

## Explore first (read before proposing)
1. discover_tools for the GitHub read tools (list merged PRs, get a PR).
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries
   the full tools list), to read the real repo without committing. If the flow cannot carry
   the delta, commit the read tools, stop the turn, and ask the user to continue.
3. Draft one example release note from real merged PRs and show it to the user before wiring
   the full setup.

## Defaults / priors table (release process to proposed setup)
| Release process | Trigger | Tools | Behavior default |
|---|---|---|---|
| Merge to main | daily schedule 09:00 local | list merged PRs + get PR + publish | collect merges since last run, write notes, publish |
| GitHub releases | event: release published | get release + get PRs + publish | on a published release, write notes from its PRs |
| Release branches | event: release-branch merge | list merged PRs + publish | on a release-branch merge, write notes |

## Connections
GitHub (or GitLab) to read PRs, and the publish target (docs repo, Notion, or Linear). If any
is missing, request_connection and stop until it is ready.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: read the merged PRs since the last
run with the exact list tool, get each PR's title, body, and labels, group them by type
(features, fixes, chores), write the release note in the output shape below, and finish by
publishing it with the exact publish tool. Pin the repo and the publish target id.

Output shape:
    ## <version or date>
    ### Features
    - <PR title> (#<number>)
    ### Fixes
    - <PR title> (#<number>)

## Verify
1. test_run with a blunt message ("Draft release notes from the last 5 merged PRs") and read
   the verdict and the tools line, not a 200. An incomplete verdict means rewrite the
   instructions blunter and re-test.
2. Fire an artificial trigger test message first. If that passes, ask the user to run the real
   trigger test: the Lightning "Test event" button for a subscription, the Play "Run" button
   for a schedule.
3. Read back the published note to confirm the write landed.

## Closing report
Tell the user what the agent became, what is connected, what is scheduled or subscribed, what
you verified, and anything that still needs them (for example, a connection they must
authorize).
"""

_PR_REVIEWER_BODY = """\
# PR reviewer playbook

## Match
The ask is "review pull requests," "comment on risky changes," or "flag missing tests." Card
key pr-reviewer. Also matches free-text asks for automated code review or PR feedback on a
repo.

## Required context (ask via one request_input form)
- Repository: which GitHub or GitLab repo to review PRs on. No default; the agent cannot
  proceed without it. Description: "press Enter to accept the repo I found: <guess>" when a
  prior read surfaced one.

## Researchable context (ask, but the first option is "figure it out")
- Review posture: comment only (advisory) or request changes when tests are missing
  (blocking). Enum first option: "Use your best judgment (advisory comments, no blocking)."
  Note the trade-off: blocking is stricter but can hold up a PR the agent misjudged.
- What counts as risky: the agent can discover this from the diff (auth, secrets, migrations,
  deletions). Enum first option: "Figure it out from the diff." Second option: a short list the
  user types themselves.

## Explore first (read before proposing)
1. discover_tools for the PR read tools (get PR diff, list changed files, list existing review
   comments) and the review-comment write tool.
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries the
   full tools list), against one real open PR. If the flow cannot carry the delta, commit the
   read tools, stop the turn, and ask the user to continue.
3. Draft one example inline comment from a real diff and show it to the user before wiring the
   full setup.

## Defaults / priors table (review posture to proposed setup)
| Situation | Trigger | Tools | Behavior default |
|---|---|---|---|
| Solo or small repo | event: PR opened + synchronize | get diff + list files + create review comment | inline comments, advisory only |
| Team wants gating | event: PR opened | get diff + list files + create review (request changes) | request changes when tests are missing for changed logic |
| Security-sensitive repo | event: PR opened | get diff + list files + create review comment | flag auth, secrets, and migration changes first |

## Connections
GitHub (or GitLab) to read the diff and post review comments. If missing, request_connection
and stop until it is ready.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: get the PR diff and the list of
changed files with the exact tools, check whether files with changed logic have a matching test
file changed alongside them, scan the diff for risky patterns (auth, secrets, migrations,
deletions), and finish by posting inline comments on the risky lines plus one summary comment
with the exact review tool. Pin the repo id.

Output shape (summary comment):
    ## Review summary
    - Risky: <file>:<line> - <why>
    - Missing tests: <file>

## Verify
1. test_run with a blunt message ("Review the latest open PR for risky changes and missing
   tests") and read the verdict and the tools line, not a 200.
2. Fire an artificial "PR opened" trigger test message first. If that passes, ask the user to
   run the real trigger test: the Lightning "Test event" button.
3. Read back the posted comments on the PR to confirm the write landed.

## Closing report
Tell the user what the agent became, what is connected, what is subscribed, what you verified,
and anything that still needs them.
"""

_ISSUE_TRIAGE_BODY = """\
# Issue triage playbook

## Match
The ask is "label new issues," "triage issues by area and priority," or "assign an owner to
issues." Card key issue-triage. Also matches free-text asks about issue routing or bug
labeling.

## Required context (ask via one request_input form)
- Repository: which GitHub or GitLab repo to triage issues on. No default; the agent cannot
  proceed without it. Description: "press Enter to accept the repo I found: <guess>" when a
  prior read surfaced one.

## Researchable context (ask, but the first option is "figure it out")
- Label taxonomy: which area and priority labels to use. Enum first option: "Figure it out
  from the repo's existing labels." Second option: the user types a short list.
- Owner assignment: how to pick who gets assigned. Enum first option: "Use your best judgment
  (read CODEOWNERS, or leave unassigned if there is none)." Note: handing over a mapping is
  faster than the agent researching it.

## Explore first (read before proposing)
1. discover_tools for the issue read tools (get issue, list labels) and the write tools (add
   label, assign issue).
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries the
   full tools list), against one real open issue. If the flow cannot carry the delta, commit the
   read tools, stop the turn, and ask the user to continue.
3. Draft one example labeling and, if a CODEOWNERS file exists, one assignment, and show both to
   the user before wiring the full setup.

## Defaults / priors table (repo state to proposed setup)
| Situation | Trigger | Tools | Behavior default |
|---|---|---|---|
| Has CODEOWNERS and area labels | event: issue opened | get issue + list labels + read CODEOWNERS + add label + assign | label by area and priority, assign the matched owner |
| Has area labels, no CODEOWNERS | event: issue opened | get issue + list labels + add label | label only, leave unassigned |
| No label taxonomy yet | event: issue opened | get issue + add label | propose a minimal area/priority label set before enabling |

## Connections
GitHub (or GitLab; Linear or Jira only if cross-posting is also wanted). If missing,
request_connection and stop until it is ready.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: read the new issue's title and body
with the exact tool, list the repo's existing labels, match an area label from the content,
infer a priority label from keyword patterns (data loss or crash implies the highest priority),
apply the labels with the exact label tool, and finish by assigning the matched owner (from
CODEOWNERS, if present) with the exact assign tool. Pin the repo id.

## Verify
1. test_run with a blunt message ("Triage the newest open issue") and read the verdict and the
   tools line, not a 200.
2. Fire an artificial "issue opened" trigger test message first. If that passes, ask the user to
   run the real trigger test: the Lightning "Test event" button.
3. Read back the issue's labels and assignee to confirm the write landed.

## Closing report
Tell the user what the agent became, what is connected, what is subscribed, what you verified,
and anything that still needs them (for example, no CODEOWNERS file was found).
"""

_CI_FAILURE_TRIAGE_BODY = """\
# CI failure triage playbook

## Match
The ask is "summarize why CI failed," "read the logs when a build breaks," or "ping the author
of a failing run." Card key ci-failure-triage. Also matches free-text asks about failed
workflow runs or broken builds.

## Required context (ask via one request_input form)
- Repository: which GitHub repo's workflow runs to watch. No default; the agent cannot proceed
  without it. Description: "press Enter to accept the repo I found: <guess>" when a prior read
  surfaced one.

## Researchable context (ask, but the first option is "figure it out")
- Where to notify: a comment on the PR or commit tagging the author, or also a Slack channel if
  Slack is connected. Enum first option: "Use your best judgment (comment on the PR or commit;
  add Slack only if it's already connected)." Slack and Discord are optional extensions here,
  not requirements: GitHub alone is enough to run.

## Explore first (read before proposing)
1. discover_tools for the run read tools (get workflow run, list jobs, get job logs) and the
   comment write tool (plus a Slack send tool only if Slack is connected).
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries the
   full tools list), against one real failed run's logs. If the flow cannot carry the delta,
   commit the read tools, stop the turn, and ask the user to continue.
3. Draft one example failure summary from real logs and show it to the user before wiring the
   full setup.

## Defaults / priors table (failure kind to proposed setup)
| Situation | Trigger | Tools | Behavior default |
|---|---|---|---|
| Single test failure | event: workflow run failed | get run + list jobs + get logs + comment | note the failing test, suggest a rerun if it looks flaky |
| Compile or lint error | event: workflow run failed | get run + list jobs + get logs + comment | pinpoint the file and line from the log |
| Timeout or infra error | event: workflow run failed | get run + list jobs + get logs + comment | note it looks like infra, suggest a rerun |
| Slack connected | (as above) | (as above) + Slack send | also post the summary to the channel |

## Connections
GitHub is required to read runs and post comments. Slack or Discord are optional: only wire the
notify-to-channel step if one is already connected; otherwise skip it, do not request it.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: on a failed run, get the run and list
its failed jobs with the exact tools, get the failing job's log tail, identify the likely cause
from the log (test failure, compile error, timeout, or infra), write a concise summary, and
finish by posting it as a comment on the PR or commit tagging the author with the exact comment
tool (and, only if Slack is connected, also sending it to the channel). Pin the repo id.

## Verify
1. test_run with a blunt message ("Summarize why the last CI run failed") and read the verdict
   and the tools line, not a 200.
2. Fire an artificial "workflow run failed" trigger test message first. If that passes, ask the
   user to run the real trigger test: the Lightning "Test event" button.
3. Read back the posted comment to confirm the write landed.

## Closing report
Tell the user what the agent became, what is connected (note whether Slack is wired or
skipped), what is subscribed, what you verified, and anything that still needs them.
"""

_CODE_QA_BODY = """\
# Code Q&A playbook

## Match
The ask is "answer questions about our repo," "explain how this code works," or a mention-driven
code Q&A bot. Card key code-qa. Also matches free-text asks for a repo-grounded assistant.

## Required context (ask via one request_input form)
- Repository: which GitHub or GitLab repo to answer questions about. No default; the agent
  cannot proceed without it. Description: "press Enter to accept the repo I found: <guess>"
  when a prior read surfaced one.

## Researchable context (ask, but the first option is "figure it out")
- Where questions come in: a Slack channel mention or a GitHub issue/PR comment mention. Enum
  first option: "Figure it out from what's connected." Note: handing this over is faster than
  the agent researching it.
- Answer depth: cite exact files and lines, or give a higher-level summary. Enum first option:
  "Use your best judgment (cite file paths and line numbers by default)."

## Explore first (read before proposing)
1. discover_tools for the code search tool and the file read tool.
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries the
   full tools list), asking one real question about the repo. If the flow cannot carry the
   delta, commit the read tools, stop the turn, and ask the user to continue.
3. Draft one example answer with citations and show it to the user before wiring the full
   setup.

## Defaults / priors table (repo shape to proposed setup)
| Situation | Trigger | Tools | Behavior default |
|---|---|---|---|
| Small, single repo | mention | search code + read file + reply | answer with file:line citations |
| Monorepo, multiple services | mention | search code + read file + reply | if the question is ambiguous, ask which service first |
| Docs live in the repo too | mention | search code + read file + reply | also read README or docs for higher-level questions |

## Connections
GitHub (or GitLab) to read the code. Slack is optional and only needed for the Slack-mention
surface; a GitHub-comment mention needs no extra connection beyond GitHub.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: when mentioned with a question, search
the repo for the relevant files or symbols with the exact search tool, read the matching file
or files for context, compose an answer that cites exact file paths and line numbers, and
finish by replying in the same thread or comment with the exact reply tool. Pin the repo id.

Output shape:
    <answer>

    Sources: <path>:<line>, <path>:<line>

## Verify
1. test_run with a blunt message ("What does <a real function or module> do?") and read the
   verdict and the tools line, not a 200.
2. Fire an artificial mention trigger test message first. If that passes, ask the user to run
   the real trigger test: the Lightning "Test event" button.
3. Read back the reply to confirm it landed in the right thread.

## Closing report
Tell the user what the agent became, what is connected, what is subscribed, what you verified,
and anything that still needs them.
"""

_DEPENDENCY_DIGEST_BODY = """\
# Dependency digest playbook

## Match
The ask is "summarize open dependency-update PRs," "weekly dependency digest," or similar. Card
key dependency-digest. Also matches free-text asks about tracking Dependabot or Renovate PRs.

## Required context (ask via one request_input form)
- Repository: which GitHub or GitLab repo to scan for dependency PRs. No default; the agent
  cannot proceed without it. Description: "press Enter to accept the repo I found: <guess>"
  when a prior read surfaced one.

## Researchable context (ask, but the first option is "figure it out")
- Where to post the digest: a Slack channel if connected, or a comment on a pinned tracking
  issue otherwise. Enum first option: "Figure it out from what's connected." Slack is an
  optional extension here, not a requirement.
- Which PRs count as dependency updates: detect by author (dependabot[bot], renovate[bot]) or by
  label. Enum first option: "Use your best judgment (detect by author, then by label)."

## Explore first (read before proposing)
1. discover_tools for the PR list tool (filterable by author or label) and the get-PR tool.
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries the
   full tools list), listing the repo's real open dependency PRs. If the flow cannot carry the
   delta, commit the read tools, stop the turn, and ask the user to continue.
3. Draft one example digest from real PRs and show it to the user before wiring the full setup.

## Defaults / priors table (bot in use to proposed setup)
| Situation | Trigger | Tools | Behavior default |
|---|---|---|---|
| Dependabot | schedule weekly | list PRs (author dependabot[bot]) + get PR + post | group by ecosystem, list old to new version |
| Renovate | schedule weekly | list PRs (author renovate[bot] or label) + get PR + post | group by ecosystem, list old to new version |
| Mixed or none detected | schedule weekly | list PRs (label "dependencies") + get PR + post | if none found, report zero PRs rather than skip silently |

## Connections
GitHub (or GitLab) to list and read PRs. Slack is optional: only wire it as the post target if
already connected; otherwise post to a pinned tracking issue or PR comment.

## Instructions template (what to commit)
A numbered per-run procedure for instructions.agents_md: list open PRs matching the
dependency-bot filter with the exact list tool, get each matched PR's title and body for the
old and new version, group them by ecosystem, write the digest in the output shape below, and
finish by posting it with the exact post tool (Slack message if connected, otherwise a comment
on the tracking issue). Pin the repo id and the post target id.

Output shape:
    ## Dependency digest - <date>
    ### <ecosystem>
    - <package> <old version> -> <new version> (#<PR number>)

## Verify
1. test_run with a blunt message ("Summarize the open dependency-update PRs") and read the
   verdict and the tools line, not a 200.
2. Fire an artificial schedule-fired test message first. If that passes, ask the user to run
   the real trigger test: the Play "Run" button.
3. Read back the posted digest to confirm the write landed.

## Closing report
Tell the user what the agent became, what is connected, what is scheduled, what you verified,
and anything that still needs them.
"""

ENTRIES: List[TemplateEntry] = [
    TemplateEntry(
        key="changelog-writer",
        name="Changelog writer",
        category="Engineering",
        match=(
            "Turn merged pull requests into release notes, changelogs, or "
            '"what shipped" summaries from a repo'
        ),
        body=_CHANGELOG_WRITER_BODY,
    ),
    TemplateEntry(
        key="pr-reviewer",
        name="PR reviewer",
        category="Engineering",
        match="Comment inline on risky pull-request changes and flag missing tests",
        body=_PR_REVIEWER_BODY,
    ),
    TemplateEntry(
        key="issue-triage",
        name="Issue triage",
        category="Engineering",
        match="Label new issues by area and priority and assign an owner",
        body=_ISSUE_TRIAGE_BODY,
    ),
    TemplateEntry(
        key="ci-failure-triage",
        name="CI failure triage",
        category="Engineering",
        match="Read the logs when CI fails, summarize the likely cause, and ping the author",
        body=_CI_FAILURE_TRIAGE_BODY,
    ),
    TemplateEntry(
        key="code-qa",
        name="Code Q&A",
        category="Engineering",
        match="Answer questions about our repo when mentioned",
        body=_CODE_QA_BODY,
    ),
    TemplateEntry(
        key="dependency-digest",
        name="Dependency digest",
        category="Engineering",
        match="Weekly summary of open dependency-update PRs and what changed",
        body=_DEPENDENCY_DIGEST_BODY,
    ),
]
