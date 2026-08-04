# Status

Updated: 2026-08-04, by team-lead.

## Where we are

Phase 1 (spikes). The planning workspace is being committed and the draft PR opened.
Both spike teammates are running in worktrees:

- engine-spike: prototyping the change-set engine (task #2).
- runner-spike: value_from proof, tools-discovery verdict, lifecycle characterization
  tests (task #3).

## Decisions taken (4 August review with Mahmoud)

- Edits: ordered operations with anchored text edits and named list entries (RFC Q1
  Option B; interface per `research/change-set-interface-codex.md`).
- Large content: the runner reads workspace files and inlines them before the API sees
  the call (RFC Q2 Option B).
- Config reads: a `read_config` tool with partial reads; no config file in the
  workspace (RFC Q3 Option B).
- Concurrency: base check on commit, no locks (RFC Q4 Option A).
- Sessions: update in place, rebuild only for harness and sandbox changes (RFC Q5
  Option B). Harnesses not re-reading files on their own is accepted behavior. Open
  question is tools only (Spike S2). The approval-path stale-config bug is fixed inside
  this work, not separately.
- US-6 (run without saving) is out of scope.
- New requirement R12: optional agent-written description on builder tool calls.
- Scope of the PR set: full runner lifecycle refactor included. Frontend minimal.

## Blockers

None.

## Waiting on

- Spike reports (tasks #2, #3), expected in `spikes/`.
- Mahmoud: none right now. Product calls surfaced by the spikes will be brought to him
  at the phase 1 exit gate (task #4).
