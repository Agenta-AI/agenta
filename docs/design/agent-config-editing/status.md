# Status

Updated: 2026-08-04 evening, by team-lead.

## Where we are

Phase 1 exit review. Both spikes are complete and green:

- engine-spike: the pure engine works, 120 tests, legacy parity proven against the real
  service code. Report: `spikes/engine-spike.md`.
- runner-spike: value_from proven end to end (34 tests), the tools-discovery verdict is
  in (Pi and Claude are blocked by our own delivery, not by the harness; Codex needs a
  session reopen), and 15 characterization tests pin today's lifecycle behavior.
  Report: `spikes/runner-spike.md`.

The consolidated decisions are in `decisions.md`. Seven product calls wait on Mahmoud
(listed there). A Codex design review of the finalized design is running. Slices start
when it returns. Draft PR: https://github.com/Agenta-AI/agenta/pull/5733.

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
