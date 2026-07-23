# Status

## Current state

Implemented on lane `feat-event-driven-tool-relay`. Slices 0 to 2 are committed: the
relay-client/relay-protocol extraction (d078d1d), atomic publication plus the hop-1
in-sandbox response watch (2ed4253), and the flagged Daytona hop-2 watch (bc96aa9).
Slice 3 landed in two commits: the orphan-residue snapshot plus the `relay_pickup`
timing log (b857f07) and the docs sync (330efd7).

Live QA (2026-07-12, dev box, EE stack on 8280): one real Claude-local turn with a
workflow-reference tool (Exact Match) through the playground UI. The tool executed
through the relay and the runner logged
`[relay] stage=relay_pickup id=... pickup_ms=1.28 wake=activity`: event-driven pickup
at 1.3 ms against the 0-300 ms polling baseline, well under the 10 ms local target.
The local cell is green. The Daytona cell is PENDING live QA: the remote watch ships
default-off, the shared sidecar would need a container recreate to carry the flag, and
the capacity gates (held execs at peak concurrency) are rollout gates by design;
unit and integration coverage (fake daemon, real watch-script process runs) stands in
until the flag-on QA pass.

The moveFs atomicity spike (open question 2) resolved early, during slice 1: daemon
v0.4.2 implements `/v1/fs/move` as Rust `std::fs::rename`, which is `rename(2)` and
atomic for a same-directory move. `RelayHost.rename` uses `moveFs` directly; no
shell-`mv` fallback was needed.

Test coverage: 71 unit and integration tests across four suites, all green.
`relay-client.test.ts` (16: the writer, the golden byte-pinned request serialization,
the coalescing dir watch, the hop-1 wait), `relay-watch.test.ts` (31: both activity
sources, window clamping, jitter, demotion, the outer bound, close semantics),
`relay-loop.test.ts` (15: the runner loop with wake sources, safety-poll misses,
delete-on-pickup, the orphan snapshot, the pickup telemetry), and
`relay-atomic-publish.test.ts` (9: integration-style, writer and runner end to end over
a real temp dir).

## Post-draft review round (2026-07-12)

A seven-angle high-effort review ran on the draft PR; commit a1ec038 fixed the five
verified findings (the orphan-snapshot resume race, replaced by an engine-awaited
pre-loop sweep; nullish exec results counting as watch success; pickup completing
after the next window armed; mid-wait failures leaving the source windowless; the
safety poll's independence moved into the loop). The extension build now fails if
server-side relay symbols leak into the sandbox bundle.

Deferred follow-ups from the same review (cost or structure, not correctness):

- The watch exec wakes on the runner's own response publications (about two extra
  daemon calls per tool call). Option: pass ignorable names to the script.
- close() leaves the final in-sandbox watcher to die at its own window timer (up to
  window + grace). Option: a sentinel-file wake through the same sandbox handle.
- The Daytona source's waiter/sticky machinery shares shape with the writer's
  createRelayDirWatch; a shared coalescing primitive would remove the drift risk.
- The Pi client-tool browser-fulfilled flow on a warm continuation needs one QA pass:
  crash-redelivery by re-listing is gone, and that flow previously leaned on it.
- One relay env family now has three env-read disciplines (module-load, creation-time,
  call-time); unify when the config surface next changes.

## Deviations from the reviewed plan

- **`close()` abandons the in-flight watch exec instead of aborting it.** The
  sandbox-agent SDK's `runProcess` takes no per-call AbortSignal. The exec is bounded by
  the script's own window timer plus a runner-side generation-tagged outer bound (at
  window + grace + margin) the plan did not have; the outer bound replaces the promised
  AbortSignal mechanism and also feeds demotion when an exec request wedges.
- **Window jitter is downward-only (0.8x to 1.0x) instead of plus-or-minus 20 percent.**
  A jittered window then always completes before the 30 s safety wait, which removes a
  false-miss race where an upward draw read as a watch miss.
- **Delete-on-pickup was not in the plan; adopted from review.** A request file left on
  disk for the whole execution insta-completed every watch window and rearmed at network
  speed (measured ~66 daemon requests per second, versus ~3.3 today). The runner now
  removes each request file right after reading it. Consequences, on BOTH backends
  (local and Daytona): a request executes at most once per publication, and
  crash-redelivery-by-re-listing is deliberately gone. A runner crash after pickup but
  before the response write loses the request permanently; the writer times out at
  `AGENTA_AGENT_TOOLS_RELAY_TIMEOUT` (60 s default) and surfaces a tool error.
  Consistent with the orphan-residue decision.
- **Request-volume accounting correction.** The plan said the per-tool-call list, read,
  and write daemon calls were unchanged. Delete-on-pickup adds one daemon delete per
  executed tool call and the `relay_pickup` telemetry adds one stat, so the honest
  number is +2 daemon calls per executed tool call. Trivial next to the removed polling
  (~200/min down to ~4.4/min).
- **Atomic publication landed in slice 1 for BOTH directions.** The plan had the
  Daytona-side rename in a later slice, but the hop-1 watch defaults on and would
  otherwise race a non-atomic Daytona response write.
- **moveFs atomicity spike resolved early.** See Current state; open question 2 is
  answered, no `RelayHost` shell-`mv` fallback exists.
- **Orphan residue (open question 4) accepted and fixed here.** The first successful
  list of each turn's relay loop is a snapshot: pre-existing request files are marked
  seen and best-effort deleted, never executed. A turn only executes requests created
  after it started.

## Timeline

- 2026-07-11: Workspace created (README, context, research, plan, open-questions). All
  research anchors verified against `gitbutler/workspace` on this date. Draft PR #5232
  opened for review.
- 2026-07-11 (later): Review round folded in. Codex (xhigh) raised three blocking
  defects, all adopted: atomic temp-plus-rename publication (plan.md decision 2), the
  coalesced single-flight activity source replacing the bare promise race (decision 3),
  and suspend-remote-polling-while-watch-healthy with honest request-volume numbers
  (decision 4). Codex P1s adopted: the relay-client/relay-protocol extraction as slice
  0 of this project, watcher hardening, per-hop flags, expanded test plan. CodeRabbit's
  four inline comments addressed: held-request abort on window end and relay stop,
  argv-safe script arguments, window validation and clamping, and the three-way latency
  definition with capacity assumptions as rollout gates. Owner framing points
  addressed: writer coverage (Pi, local Claude, the shim) stated up front; rejected
  alternatives moved into an explicit rejected subsection.
- 2026-07-12: Implemented on lane `feat-event-driven-tool-relay`. Slice 0 (d078d1d),
  slice 1 (2ed4253), and slice 2 (bc96aa9) committed; slice 3 pending commit. The
  moveFs spike resolved (question 2 answered), orphan residue fixed here (question 4
  answered). Deviations from the plan recorded above. Docs synced (documentation/
  tools.md, interfaces runner-to-mcp-server.md, the interfaces index). Live QA pending.

## Decisions recorded

- Owner (2026-07-11): API-hosted tool gateway rejected; sandbox talks only to the runner;
  relay polling latency addressed here as its own feature. Source:
  `../mcp-delivery-architecture/gateway-mcp-location.md` (decision section).
- Cross-project (2026-07-11): this project owns the `tools/relay-client.ts` and
  `tools/relay-protocol.ts` extraction as slice 0; #5234 consumes it.
- This plan (implemented on the lane, with the deviations recorded above): events are
  wake signals only (decision 1); publication is atomic via temp name plus rename
  (decision 2); the wake seam is a coalesced single-flight activity source (decision 3);
  Daytona hop 2 uses a re-issued bounded watch exec that suspends remote polling while
  healthy, with a 30 s safety poll kept deliberately (decision 4); the extraction is
  slice 0 (decision 5); idle backoff survives only in fallback mode (decision 6); three
  per-hop config variables with a validated, clamped window (decision 7).

## Verification notes

- The `runProcess` blocking semantics and `timeoutMs`/`timedOut` fields were verified
  against the installed sandbox-agent SDK type definitions. `runProcess` takes no
  per-call AbortSignal, which forced the close()-abandons deviation above.
- `moveFs` rename atomicity is now verified against the daemon v0.4.2 source
  (`router.rs`: `/v1/fs/move` is `std::fs::rename`). Open question 2 answered.
- Daytona-side limits on held execs are NOT verified (open question 1, a rollout gate
  for the `REMOTE_WATCH_ENABLED` default flip).
- Operator note: `AGENTA_AGENT_TOOLS_RELAY_REMOTE_WATCH_WINDOW_MS` clamps to
  [5000, 120000], but values at or above 30000 (the fixed safety-poll interval) degrade
  the design: safety waits time out while the window is in flight, safety-poll
  discoveries become the normal pickup path, and each one counts as a watch miss
  feeding demotion. Keep the window below 30 s; the 25 s default is deliberate.

## Blockers

None for landing with the Daytona watch flag off (its default). Open question 1 (Daytona
held-exec limits) gates only the default flip, via the QA capacity pass.

## Next steps

1. Commit slice 3 (orphan snapshot + `relay_pickup` telemetry) on the lane.
2. Live QA across the matrix (local Pi, local Claude, Daytona with
   `AGENTA_AGENT_TOOLS_RELAY_REMOTE_WATCH_ENABLED=true`); record `relay_pickup` numbers
   here.
3. Decide the timing-log fate after QA (open question 5).
4. Flip the `REMOTE_WATCH_ENABLED` default after the capacity gate (open question 1).
