# Session control and live events status

> **AGENT-GENERATED, low weight.**

## Current milestone

The current RFC head is the contract-baseline candidate. This status does not approve an
implementation package or claim release proof on a future code commit.

## Settled contracts

- Send stays on the existing invoke operation with `on_busy` and `Idempotency-Key`.
- `POST /sessions/{session_id}/cancel` remains the version-one public Stop route.
- The durable command store stays private, and its transport is `deliver(command) -> receipt`.
- Direct authenticated delivery carries normal Stop. Heartbeats carry health and ownership.
- A pending Stop is redelivered with the same ID while the session beats and settles `lost` when the
  runner is gone.
- The execution row enforces one terminal winner with a compare-and-set used by runner and watchdog.
- Postgres settlement is atomic where state shares a database. Redis reconciliation follows commit.
- The watchdog is the second terminal writer, and each sweep pass is bounded.
- The desktop shows `stopping` until acceptance, terminal state from events, and `recovering` during
  watchdog recovery. A failed request restores `running`.
- Abandoned work settles within 150 seconds. Stop alerts at five seconds, and releases above one
  second need a written reason.
- Session retention separates from tracing policy before durable history writes turn on.
- A records-domain cursor table on the analytics database allocates each sequence in the same
  transaction as the record insert.
- Every durable write after migration receives a sequence, including compatibility endpoints.
- Temporary frames and durable events reuse the records ingest stream with explicit `kind`.
- Frames carry `frame_index`; durable events carry `sequence`.
- Version one freezes six durable events and ignores unknown event types.
- The snapshot groups `{session, execution, pending, read}` and pages its transcript.
- Shared client code has named package ownership, uses Fern for request and response calls, and
  treats SSE as the exception.
- Event connections bound authorization age, frame ingress checks owner claims, and logs contain no
  message content or tokens.
- Delivery uses seven increments with three named env-backed flags and mounted rollback paths.
- Each increment uses one global environment switch.
- Late output is quarantined and excluded from canonical reads.
- The runner shutdown grace period is 30 seconds.
- The Codex reap ships now. The Codex pin bump uses a separate pull request.
- Stop after teardown returns `not_running`.
- Durable approvals ship before Queue and Steer.

Mahmoud settled all seven open choices on 2026-09-04. No open design questions remain.

## Review record

- `reviews/fable-2026-09-03.md`
- `reviews/opus-practices-interfaces-2026-09-03.md`
- `reviews/codex-gpt-5.6-sol-2026-09-03.md`
- `reviews/qa-audit-2026-09-03.md`

The lead decision record is `reviews/decision-list-2026-09-03.md`. Track C measurement is
`live-frame-envelope.md`.

## Evidence confirmed so far

- Warm Stop passed with Pi and Claude Code on Daytona.
- Warm Stop passed with Pi, Claude Code, and Codex on the local provider.
- Output, active-tool, and pending-approval cases continued in the same warm sandbox and native
  harness session.
- Direct Stop reached the local runner in 72 to 248 milliseconds.
- Daytona Stop responses took 70 to 104 milliseconds.
- Record recovery after a Postgres outage passed on the integration tip.
- Thirteen control and recovery cells passed with the current quarantine behavior.
- Integrated head `3c9ce08a29` passed the full hook matrix on local Pi and the HTTP matrix on Pi
  Daytona. It also passed the local Claude Code and Daytona Codex HTTP cells.
- PR #6496 fixes Codex child reaping at `cce2b21bc35091`. The integration branch needs to re-merge
  that fix.

The `Proven` columns in `qa.md` distinguish full, partial, and missing evidence.

## Known gaps

Claude Code and Codex have no approval gate because their shell tools are not gated by `ask`.
Their frames go from `tool-input-available` straight to `tool-output-available`. Only Pi asks for
shell approval, as the Daytona run
`~/agenta-qa-evidence/20260903-233439-3632265-session-control` showed.

The local provider exposes one shared process table to all sandboxes. The Codex reap disabled
itself when it saw more than one Codex app-server. PR #6496 fixed this at `cce2b21bc35091` by
anchoring on the daemon port for that sandbox. Daytona was never affected. The integration branch still
needs that fix re-merged.

## Pull request roles and bases

| Pull request | Purpose | Base and role |
|---|---|---|
| #6502 | Acknowledge records after Postgres commit | Main; pure fix |
| #6500 | Reject concurrent execution before sandbox mutation | Main; pure fix |
| #6496 | Warm cancellation and child cleanup | Main; Stop stack root |
| #6503 | Durable Stop, direct delivery, and recovery | #6496 |
| #6501 | Terminal compare-and-set, watchdog, and late-record guard | #6503 |
| #6504 | Execution guard, approvals, and clients | #6503 |
| #6497 | Command and transport design | Evidence for parked polling only |
| #6498 | Current Stop path | Reference evidence |
| #6499 | Stable record semantics | Investigation evidence |
| #6505 | Overnight reports | Evidence only |
| #6506 | Combined integration branch | Evidence only, never a merge source |

## Implementation progress (2026-09-04)

- Increments 1 to 3 (pure fixes, the Stop package, the history producer) are on PRs #6496, #6503,
  #6501, #6517, #6504, and #6518. A merged head of these lanes runs on an integration stack. The
  final live matrix runs on it. Run 1 (Pi, local provider, last-message client shape, hook cells)
  passed 12 cells. It found two product defects: a Stop during a tool approval evicted the warm
  sandbox and reported failed when the harness cancel could not be sent (fix reviewed on #6501),
  and the watchdog did not complete a pass on that head (root cause in progress).
- Increment 4 (live relay, #6522) and increment 4b (durable reconnect, #6524) are reviewed and
  proven live: two readers, mobile, late joiner, reconnect, slow reader, flag off, snapshot then
  replay with sparse sequences, legacy session, and concurrent writes.
- Increments 5, 6, and 7 are in review rounds (#6531, #6530) or in build (queue then steer).

## Work before implementation

1. Add the exact Linear security issue URL for Claude Code shell permission behavior.
2. Record the contract-baseline candidate commit after these document changes are committed.
3. Land and test #6502 and #6500 on main.
4. Build the Stop stack in the listed base order.
5. Run all required `qa.md` rows, including rollback and missing failure injections.

## Design branch and baseline commit

Design branch `agent/session-execution-rfc`, draft pull request #6495. Record the exact baseline
commit here after the documents land.
