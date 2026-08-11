# Context: why this work exists

## The incident in three sentences

During live QA of two parallel permission-gated shell commands (session `db58551b`,
2026-07-19), both commands executed exactly once and only after their approvals, but the
system misreported both, flipped an already-approved card back to "waiting", and then went
silent because the user's final approval was never sent to the runner. The root causes are
that the durable session record stores every approval request but never any approval answer,
that the post-pause cleanup invents tool results (a false "not executed" error for an
approved running call, and a false success for a call that never started), and that the
frontend only dispatches approvals once every visible card looks settled, a condition that
can never hold after a state rebuild. A seventh, unrelated defect found in the same logs
makes the new `session_turns` ingestion fail with HTTP 500 on every warm turn, because the
turn index is computed once per environment acquire instead of once per turn.

## Goals

1. Fix the session-turns counter so `turn_index` is a true conversation-turn counter, and
   make the API answer a duplicate append with 409 Conflict instead of 500.
2. Stop the pause cleanup from inventing tool results: an approved, executing call keeps its
   real result, and a never-started call is recorded as deferred, never as success.
3. Persist the answer half of every gate (a new `interaction_response` record event plus the
   allow/deny verdict in the interaction row's existing `resolution` field), and make
   frontend hydration overlay answers onto requests, so a rebuilt conversation shows
   answered cards as answered.
4. Dispatch each approval per card the moment the user answers it, and make the runner
   accept a resume that answers only part of the parked gates while remaining parked on the
   rest.
5. Add a regression test that reproduces the exact incident shape, then verify with live QA
   on the dev stack.

## Non-goals

Two related fixes are deliberately out of scope here.

- **Real turn cancellation** (the Zed-style cancel-then-restart when new user text arrives
  while gates are parked, which fixes defect 6 of the incident report) goes to Arda after
  JP's sessions PRs merge, because it depends on the session-streams control plane those PRs
  introduce and is partly a product decision.
- **Audit-hardening of record ids** (scoping stable record ids by turn so contradictory
  results append instead of overwriting, defect 5) is queued separately, because the answer
  persistence in this project already fixes the user-facing rebuild problem and the id
  rescope touches the record identity contract end to end.

## Constraints already decided

- Work lands in this order, on these lanes: the counter fix on the existing rebase lanes for
  PR #5376 (runner, branch `sessions-rebase/runner`) and PR #5375 (backend, branch
  `sessions-rebase/backend`), with a wipe of the wrongly numbered dev rows and an
  explanatory note for JP; everything else on the PR #5382 lane (branch
  `plan/concurrent-approvals`).
- `turn_index` is confirmed to be a true conversation-turn counter, not an acquire counter.
  The implementation must carry a code comment stating this invariant, and the PR body must
  explain what was done and what was assumed.
- The implementation will be done by an agent that has not read the incident conversation,
  so every step in `plan.md` is specified with exact files, behavioral contracts, and
  acceptance criteria.
