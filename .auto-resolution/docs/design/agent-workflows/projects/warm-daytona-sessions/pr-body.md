# PR title

[feat] Reuse Daytona sandboxes across turns instead of deleting them every turn

Base: big-agents. Labels: needs-review. Implements the approved plan PR #5214.

# PR body (paste below this line)

## Context

Every turn of a Daytona-backed agent conversation waited about 15 seconds, because the runner
deleted the sandbox at every turn end and rebuilt everything on the next turn. The warm-reuse
plumbing already existed (park at turn end, a stored sandbox id, native session reload), but
the Daytona provider had no pause or reconnect function, so "park" silently fell through to
delete. The plan and measurements behind this change are in PR #5214.

## What this adds

The two reuse levels from the plan, plus the correctness work that makes reuse safe:

- **Park-to-running.** After a clean turn, the sandbox stays running with its live harness
  session for a short window (`AGENTA_RUNNER_DAYTONA_SESSION_IDLE_TTL_MS`, default 120000 ms;
  0 disables it, there is no separate flag). A second turn inside the window continues the
  live session. Measured on the dev stack: 1.39 s against 12.5 s cold.
- **Park-to-stopped.** When the window expires (or the warm cap is full, or the runner drains
  on SIGTERM while idle), the sandbox is stopped, not deleted. The next turn restarts the
  same instance and reloads the harness session natively. Measured: 7.7 s against 12.5 s
  cold, because `session/load` (1.2 s) replaces the 5.2 s session create.
- **A hard cap on idle warm sandboxes** (`AGENTA_RUNNER_DAYTONA_SESSION_MAX_WARM`, default
  20). It bounds idle spend only; an active turn is never blocked. On overflow a finishing
  turn parks to stopped. The Daytona pool frees a warm slot only after a stop is confirmed,
  so an in-flight stop cannot let the billed count overshoot.

The correctness base underneath:

- The vendored Daytona provider gets real `pause` and `reconnect` functions (a runner-side
  wrapper over `sandbox-agent`): stop only from a running state, wait out Daytona's
  transitional states with a bound, resume stopped or archived instances, and fail cleanly on
  error states. Two teardown bugs in the vendored package are fixed in the package patch: a
  failed pause used to clear the provider handle so the delete fallback silently did nothing
  (a leaked billed sandbox), and a reconnected sandbox that failed later attach steps leaked.
- The sandbox pointer (`session_states.sandbox_id`) is trusted. A resumed turn reconnects the
  parked instance by id. Snapshot, image, and target drift is accepted as per-conversation
  version pinning, like a rolling deploy: an old parked sandbox keeps serving its conversation
  until an idle gap hits the delete ladder.
- Network policy is converged at reconnect. The reconnect step reads the live sandbox's
  `networkBlockAll` and `networkAllowList` and calls Daytona's `updateNetworkSettings` only
  when they differ from the run's plan. That call applies the same runner-side iptables
  mechanism as create, so a parked sandbox picks up a policy change without a rebuild. A failed
  convergence logs and leaves the prior policy rather than aborting the reconnect.
- The pointer write is awaited and guarded. The API applies it only when the writer's turn
  index is not older than the row's `latest_turn_index` (a compare-and-set; tokenless writes
  keep today's behavior). The guard uses only pre-existing columns, so this feature adds no
  migration.
- Teardown takes a typed reason instead of a `keepWarm` boolean. Kill, failed, and aborted
  delete; a clean resumable turn and idle shutdown stop; in-flight shutdown deletes. The
  keepalive pool passes its eviction reason through the same mapping.
- Auto-archive is removed entirely (create field, env override, compose and helm forwarding):
  restoring from archive measured slower than creating fresh. The ladder is stop after 15
  idle minutes (was 5), delete after 30.
- One `SessionPool` per provider. Local behavior and env vars are unchanged; the local pool
  keeps its fire-and-forget eviction, the Daytona pool gets strict awaited capacity.
- Acquire now logs per-stage `[timing]` lines (create, install, mounts, workspace, probe,
  session), so the next latency investigation reads the logs instead of hand-instrumenting.

## Environment sync is deferred

Per-turn environment-variable delivery and value rotation are out of scope here. That is
per-turn delivery work and follows the daytona-secret-delivery direction (#5223). Create-time
env baking is unchanged in this PR.

## Assumptions from the two open plan questions

- Pointer-write guard: compare-and-set on the existing `latest_turn_index` turn counter (the
  plan's default wording; no schema migration). Two truly concurrent turns of the same
  conversation carry the same index and still race; the guard closes the older-write-lands-last
  window. The Redis owner claim remains the stronger future mechanism.
- Shutdown split: delete when a turn is in flight, stop when idle, `/kill` stays a hard
  delete (the plan's proposal).

## Tests

- Runner unit suite: 877 passing (vitest).
- API: session_states acceptance tests cover the guarded write (apply at latest turn, stale
  reject, tokenless unconditional, missing-row create).
- Network convergence verified against a live Daytona sandbox: `updateNetworkSettings` took
  effect on a running sandbox (an allow-list blocked a public curl, then an open update
  restored it), the settings survived a stop and restart, and a second update on the restarted
  sandbox re-applied the block. Created 1 sandbox, deleted 1, final count 0.
- Live E3 verification on the dev stack (one credit-controlled pass, zero sandbox leaks,
  leftovers deleted, final Daytona sandbox count 0): cold 12.5 s, live-warm 1.39 s,
  stopped-restart 7.7 s; one instance served all three turns; window expiry observed as a
  stop; SIGTERM drain observed stopping the idle parked sandbox; guarded pointer writes
  observed applied.
- QA smoke: `run_matrix.py` smoke_chat_pi PASS on E2 local and E3 daytona after the change.

## What to QA

- Playground, Daytona sandbox: send two chat turns in one conversation within two minutes.
  The second reply should arrive in about 1 to 3 seconds instead of 10 or more.
- Wait three minutes after a turn, send another. It should take about 7 to 8 seconds (the
  stopped restart) and the conversation context should be intact.
- Regression: local-sandbox conversations behave exactly as before (same env vars, same
  latency); `/kill` still deletes the sandbox immediately.

Session: https://claude.ai/code/session_018MaXPNpvzN22kngHno3VMj

# Inline PR comments to add (reading order, one orientation comment first)

Orientation comment: read the diff in this order. 1) teardown.ts (the reason model, small),
2) daytona-provider.ts (pause/reconnect state machine + network convergence), 3) the package
patch (the two vendored teardown fixes), 4) sandbox-reconnect.ts + the sessions API (the
guarded pointer), 5) sandbox_agent.ts acquire flow (trusted reconnect, pointer write
placement, teardown), 6) session-pool.ts + server.ts (per-provider pools, strict capacity),
7) hosting and docs.

Planned inline comments (add at PR-open time):
- teardown.ts: why a typed reason instead of the keepWarm boolean; TS note for Mahmoud: the
  union type is the TS equivalent of a Python Literal enum, and the mapping function is
  exhaustive by construction.
- daytona-provider.ts reconnect: the transitional-state wait bound; why timeout is transient
  (pointer retained) while error states are terminal (pointer cleared); the network-policy
  convergence that reads live fields and calls updateNetworkSettings only on a difference.
- patch file: gap A in one sentence (finally-cleared handles) and the paused=true placement;
  note the patch is regenerated canonically with pnpm patch-commit.
- dao.py: the CASE-based CAS inside ON CONFLICT DO UPDATE; the insert path applies
  unconditionally; TS/SQL note: table-qualified column = existing row, excluded = proposed.
- sandbox_agent.ts: pointer write moved after continuity hydrate (cold-restart token
  correctness); a stored pointer is trusted and reconnected by id, with no compatibility check.
- session-pool.ts: strictCapacity seat lifecycle (seat freed only on confirmed stop) and the
  nonNegativeIntEnv off-switch fix (0 must disable, not fall back to the default).
- server.ts: dispatch fails closed for unknown providers; local pool untouched.
- hosting: DAYTONA_AUTOARCHIVE removed everywhere; the two new vars forwarded.

Then comment `@coderabbitai review` after marking the PR ready.
