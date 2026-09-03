# Session control and live events status

> **AGENT-GENERATED, low weight.**

## Current milestone

The RFC head after this edit is the contract-baseline candidate. This status does not approve an
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
- Sequence allocation belongs to the records domain and commits with its record. Its exact engine
  choice remains open.
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
- Durable approvals ship before Queue and Steer.

Late output disposition, sequence engine, Codex cleanup release order, rollout granularity, Stop
spelling, shutdown grace, and teardown result remain open in `open-questions.md`.

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

The `Proven` columns in `qa.md` distinguish full, partial, and missing evidence.

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

## Work before implementation

1. Mahmoud resolves the seven choices in `open-questions.md` as their packages need them.
2. Add the exact Linear security issue URL for Claude Code shell permission behavior.
3. Record the contract-baseline candidate commit after these document changes are committed.
4. Land and test #6502 and #6500 on main.
5. Build the Stop stack in the listed base order.
6. Run all required `qa.md` rows, including rollback and missing failure injections.

## Current branch record

The prior document named `agent/session-execution-rfc`, draft PR #6495. This edit did not run Git,
so it does not assert a current branch name or commit hash.
