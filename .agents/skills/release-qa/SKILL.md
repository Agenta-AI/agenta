---
name: release-qa
description: >-
  Orchestrate pre-release QA for a release branch or any large integration branch:
  map what the branch actually ships, write a QA plan with an execution log, then run
  layered QA (build + migration gate, wire-level release gate across flag states,
  REST-surface probes, acceptance suites, recorded browser pass) with parallel
  subagents. Use when the ask is "QA this branch pre-release", "review what this
  branch does and QA it", or before merging a long-lived feature train. Complements
  the agent-release-gate skill (the wire harness this skill drives).
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, Agent
user-invocable: true
---

# Release QA

QA for a release branch is not one test run. It is: understand what ships, split it by
risk, test each risk class with the cheapest tool that produces hard evidence, and leave
a written trail someone else can audit.

Everything this skill needs ships with it. Load the extras only when you reach the step
that uses them (progressive disclosure):

- `resources/plan-template.md` — the plan-doc skeleton. Read when you start Phase B.
- `resources/example-sessions-rework.md` — a sanitized worked example of a full run,
  with the lessons it generated. Read before your first-ever run, or when unsure how
  much evidence a log row needs.

## Phase A — map the branch before planning anything

Delegate two investigations in parallel (subagents; you only need the conclusions):

1. **Branch map.** `git log --first-parent origin/main..HEAD` for the merged PRs, diff
   stats by top-level dir for weight, then read the design docs the branch itself added
   and the key changed files. Deliverable: one section per feature cluster with (a)
   user-visible behavior, (b) gating flags and their defaults AND parsing rules per
   layer, (c) layers touched, (d) riskiest interactions grounded in the code read, not
   generic checklists, (e) migrations. The flags table and migration list are
   load-bearing: get exact env var names, defaults, and truthiness parsing per layer
   (layers disagree; a flag set to `1` can be a silent no-op in one layer and on in
   another).
2. **Harness audit.** Read the QA harness you plan to use (for agent-runtime work:
   the `agent-release-gate` skill) end to end and diff its assumptions against the
   branch map. Two outputs: stale content to fix before trusting it, and coverage gaps
   to fill. A green harness that only tests the flags-off legacy path proves nothing
   about the branch's headline feature.

Also check who else is QA-ing. If a teammate has a scope, get it and weight your plan
toward what their scope does not cover; write the division of labor into the plan.

## Phase B — write the plan as a repo doc, not a chat message

Create the plan doc from `resources/plan-template.md`, in the repo location your team
uses for QA records (in this repo: `docs/design/agent-workflows/projects/qa/`). The two
structural rules that matter: split what ships into **always-on** versus **flag-gated**
(always-on is where release risk lives, because every customer gets it on upgrade day
regardless of flags), and keep an **execution log** table you fill in as runs complete,
with dates, verdicts, and one-paragraph evidence summaries. Commit it with the QA
changes and open a draft PR against the branch under test — the PR is where recordings
and findings land.

## Phase C — execute in layers, parallel where independent

Run these as parallel subagents; only stack-state-mutating steps need to be serial.

1. **Release mechanics (cheap, first).** Production build of the frontend (build gates
   change; a type-error gate that fails builds is a release blocker found in minutes).
   New required env vars / deployment couplings (grep compose for new `:?` requirements).
2. **Migration upgrade-in-place.** Scratch database container, run main's migration
   chain, seed realistic rows for every table the branch drops or backfills, run the
   branch's chain over it. Assert: clean run, data fate matches intent, destructive
   migrations round-trip on downgrade. Before declaring a data-loss finding, verify the
   seeded shape matches what main's code actually wrote (a synthetic seed can invent a
   loss that cannot occur). Note untested load behavior of table-wide backfills.
3. **Wire-level gate across flag states.** Flags-off run (the default customer path),
   flags-on run, and — when the branch changes client/server protocol behavior — a
   **differential** pair: two runs against one stack changing only the client behavior,
   dumping the exact messages sent per turn, and diffing. Defects live in the diff even
   when every journey verdict is PASS. Ground warm/cold and drop assertions in the
   runner log, not latency or API responses (the runtime fails open; `ok: true` does
   not mean persisted).
4. **Flag-mismatch cells.** Test the broken pairings, not just all-on and all-off.
   Characterize what actually happens; code analysis over-predicts. Distinguish "fails
   loudly" (acceptable hazard) from "silently wrong" (release blocker).
5. **REST surface + acceptance suites.** New/changed endpoints get a scripted lifecycle
   journey (create, query, mutate, delete, revive) and the area's existing pytest
   acceptance suite pointed at the live stack.
6. **Depth probes** when the branch touches history/session/context handling: a
   long-conversation flood (plant a token, ~12 filler turns, recall at depth, latency
   per turn to catch unbounded growth), a concurrent-sessions leak check, and a
   two-writer race on one session.
7. **Recorded browser pass, last.** One scenario list, ordered, each scenario short and
   focused, recorded (GIF/MP4). Cover what only a browser shows: dock/batch flows,
   drawer behavior, refresh/cold-replay fidelity, cross-tab sync. Post the recording on
   the PR, listed first (house rule). Do this after all stack mutations are restored.
   **Always use an isolated browser profile** (a DevTools-launched instance, a dedicated
   profile, or incognito) — never the developer's real browser. Cookies are scoped by
   hostname without the port, so a QA login on one deployment silently logs the
   developer out of every other deployment they have open on the same host.

**Stack-state discipline:** flag toggles and container recreates run in ONE serial
chain, never parallel with other stack users. Back up the env file first, diff it back
to byte-identical at the end, and prove restoration with a smoke run. If a teammate
shares the stack, check it is idle (request logs) before mutating.

## Evidence rules

- Assert on frames, records read back, DB rows, and runner logs. Never on model prose.
- Every "nothing was dropped" claim needs a readback query plus a log grep, because
  ingest paths return success unconditionally.
- A finding is not a finding until reproduced against the live stack with the exact
  request captured. File real product bugs as GitHub issues immediately (tooling bugs
  too); note known/already-filed bugs in the plan so browser agents do not re-file them.
- Record environment facts the next run needs (stack name, creds file location, minted
  account ids, teardown list) in a session HANDOFF file, not in the committed plan doc.
  Machine-specific details (hosts, ports, key locations) belong in agent memory or
  wherever your team records its environments, never in this skill or the plan doc.

## Orchestration notes

- Fan out: branch map, harness audit, build check, migration test, and creds-prep can
  all run as parallel subagents on day one. Serialize only stack mutations.
- Prep agents mint throwaway accounts via the admin endpoint (see
  `api/oss/tests/pytest/utils/accounts.py`) and write a creds env file other agents
  source. Vault keys copied from local env files are teardown debt: track and delete.
- Give every agent explicit "report what IS" instructions for hazard cells; expected
  failures are findings, not QA failures.
- Update the harness skill (stale refs, new journeys, new lessons) as part of the QA
  PR, so the next release starts from a truthful harness.
