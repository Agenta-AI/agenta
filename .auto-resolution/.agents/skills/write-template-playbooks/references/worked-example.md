# Worked example: the changelog-writer playbook

Copy from this. It is the seed playbook, already corrected against the runtime: `test_run`
explores uncommitted tools through its delta, the trigger test is the Lightning "Test event"
button (Play "Run" for schedules), and proposals ride each field's `default` so the form is
one-click acceptable. Notice how each section is short, names exact tools, and ends the
instructions on the terminal side effect.

The fenced block below is the file that ships as `references/agent-templates/changelog-writer.md`.

```markdown
# Changelog writer playbook

## Match
The ask is "turn merged pull requests into release notes" or similar. Card key
changelog-writer. Also matches free-text asks about release notes, changelogs, or "what
shipped" summaries from a repo.

## Required context (ask via one request_input form)
- Repository: which GitHub or GitLab repo to read merged PRs from; the agent cannot proceed
  without it. Set the field default to the guess a prior read surfaced; no default otherwise.
- Where release notes are published: the docs page, a Notion database, or a Linear
  document. Offer these as an enum with default "Figure it out from what's connected."

## Researchable context (ask, defaulting to "figure it out")
- How the team releases: merge to main, GitHub releases, or release branches. The agent can
  discover this by reading the repo. Enum with default "Use your best judgment (I'll read
  the repo)"; the built-in Other… covers anything else. Note in the description: handing
  this over is faster than the agent researching it.

## Explore first (read before proposing)
1. discover_tools for the GitHub read tools (list merged PRs, get a PR).
2. test_run with those tools passed in the delta (delta.set.parameters.agent.tools carries
   the full tools list), to read the real repo without committing. Only if the flow cannot
   carry the delta, commit the read tools, stop the turn, and ask the user to continue.
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
```

## What this example demonstrates

- **Required vs researchable is explicit.** The repo and publish target are required (the agent
  cannot proceed without them). The release process is researchable, so its enum leads with
  "Use your best judgment."
- **Proposals ride the `default` field.** The repo guess becomes the field `default` when a
  prior read surfaces one; the recommended enum choice is set as the `default`, and the
  built-in Other… covers off-list answers.
- **The priors table proposes a setup** per release process, so the agent does not interrogate
  the user about the trigger and tools.
- **The instructions template ends on the publish tool** and names each tool in order. It does
  not repeat the generic build loop or the config schema.
- **Verify reads the verdict and the tools line**, two-phases the trigger test, and reads the
  side effect back. The trigger affordance copy is the corrected Lightning "Test event" / Play
  "Run", never a flask.
