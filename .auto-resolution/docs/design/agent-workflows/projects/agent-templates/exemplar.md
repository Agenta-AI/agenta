# Exemplar: the changelog-writer playbook

This is the seed playbook. Mahmoud wrote the first draft by hand to show what "encode the
thinking so a Sonnet-class model can execute it" looks like in practice. Two factual errors in
that first draft are corrected here (see the note at the end): `test_run` can exercise
uncommitted tools through a delta, and the trigger-test affordance is the Lightning "Test event"
button (or Play "Run" for schedules), not a flask icon.

Every other playbook is written to match this one. The canonical file format is in
[playbook-spec.md](playbook-spec.md); this file is a filled-in instance of that format plus the
meta-principles a playbook must encode.

---

## The playbook (canonical form)

```markdown
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
```

---

## What every playbook must encode (the meta-principles)

These are Mahmoud's stated principles, generalized from the changelog case. A playbook that
skips one of these fails on a Sonnet-class model.

1. **Get the context that lets the agent solve the problem while making the user's life as easy
   as possible.** The point of the elicitation is not to fill a form; it is to gather exactly
   what the agent cannot proceed without, and nothing more.
2. **The agent should have priors.** It should know what a good solution and best practice look
   like for this use case. It should not ask about every small decision. Take the best call for
   obvious things and summarize what you will do before doing it. The priors table encodes
   those priors.
3. **Prefer forms with sensible recommendations over prose questions.** The user should rarely
   need to change what the agent proposes, but can. Because the form has no prefilled default
   (see the correction below), the recommendation lives in the field description and in the
   first enum option, not in a prefilled value.
4. **For things the agent cannot know but could research, ask, but make "figure it out" the
   first option.** If the agent has the context to self-research (a connected repo, a readable
   workspace), do the research rather than interrogating the user.
5. **For things the user truly must specify, use required fields.** Minimize the user's work
   with quick enum choices while still showing what you will do, so they can check and correct
   it.
6. **Surface the speed trade-off.** Handing information over is faster than "figure it out,"
   because research takes time. Say so in the field description, so the user can choose to save
   the agent the round trip.
7. **Encode the thinking, not just the outcome.** Write the problem decomposition and the access
   the use case needs into the playbook, so a less capable model (Sonnet-class) can still
   execute it. This is the whole reason the playbook exists and the card prompt does not carry
   this weight.

---

## Corrections to the first hand-written draft

Two facts in Mahmoud's original draft were wrong against the runtime and are fixed above and in
the rest of this workspace. See [research.md](research.md) Section 4 for the code anchors.

- **Exploring uncommitted tools does not require commit-and-stop.** `test_run` accepts a `delta`
  that applies uncommitted tools in memory (`platform_handlers.py:218-230`), so the agent can
  explore the real repo with new tools before committing anything. Pass the full tools list in
  `delta.set.parameters.agent.tools`. Keep commit-and-stop only as a fallback for when the flow
  cannot carry the delta.
- **The trigger-test affordance is not a flask.** The flask icon is for Evaluations. The trigger
  test is the Lightning "Test event" button for an event subscription (or "Run in playground")
  and the Play "Run" button for a schedule
  (`TriggerSubscriptionDrawer.tsx:1753`, `TriggerScheduleDrawer.tsx:959`).

One more reality the draft assumed but that the runtime forbids: `request_input` cannot prefill
a field. Principle 3 is written above to reflect that. Recommendations go in the description and
the first enum option.
