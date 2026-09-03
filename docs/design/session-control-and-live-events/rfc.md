# RFC: Session control and shared live events

> **AGENT-GENERATED, low weight.**

## Purpose

Agenta currently ties live execution output to the browser request that starts a turn. Other
clients receive change notices and reload completed records. Stop can wait for a heartbeat, and a
failed runner can leave a session looking active.

This RFC makes control durable and lets every authorized client read the same session state. The
runner remains private. Exact interfaces live under [`contracts/`](contracts/), implementation
boundaries live under [`work-packages/`](work-packages/), and release proof lives in
[`qa.md`](qa.md).

## What users see today

1. Only the browser that starts an execution receives its original live stream.
2. Other clients reload completed records after a change notice.
3. Stop can arrive late and can destroy warm state.
4. Pending messages live in one browser and are invisible elsewhere.
5. Clients infer execution state from sources that update at different times.
6. The records worker drops over-quota records, so tracing policy can remove session history.

## Proposed behavior

- The existing invoke operation accepts input with `on_busy` and `Idempotency-Key`.
- `POST /sessions/{session_id}/cancel` remains the public Stop route in version one.
- The command table and delivery protocol remain private.
- Direct authenticated delivery carries Stop from the API to the runner.
- Heartbeats prove runner health and refresh ownership. They do not carry normal Stop delivery.
- Stop ends current work, records one terminal outcome, and preserves a safe warm sandbox.
- A recovery sweep redelivers an accepted Stop while the runner still beats.
- A watchdog settles an abandoned execution within 150 seconds.
- Every authorized client can receive the same live text and tool progress.
- Postgres stores durable session history. Redis holds ownership and temporary frames.
- A snapshot and event connection let clients recover committed state and follow new activity.
- Closing, refreshing, or changing clients does not stop execution after sender migration.
- Every failure leaves committed history readable and the session able to accept another message.

## System shape

```text
Input          Client -> existing invoke -> API and agent service -> Runner
Stop           Client -> API -> Postgres command -> delivery adapter -> Runner
Live output    Runner -> records ingest stream -> relay -> API SSE -> Clients
History        Runner or API -> Postgres records plus per-session sequence
Ownership      Runner <-> API heartbeat -> Redis lease and Postgres mirror
```

The paths have separate responsibilities. A failed live connection cannot stop the runner. A
missed notification cannot erase committed history. A heartbeat failure can expire ownership, but
it does not define the browser stream.

## Settled design

- Keep current Redis ownership for version one.
- Use direct API-to-runner Stop delivery behind `deliver(command) -> receipt`.
- Keep runner-initiated long polling parked in Linear AGE-4253.
- Keep `expected_execution_id` optional. First-party clients send it when known.
- Reject a second Send by default until every client displays the server queue.
- Clear `running` after Stop settles. Keep `alive` only while the sandbox is safely parked.
- Enforce one terminal winner with a database compare-and-set on the execution row.
- Guard every later record with that execution row, regardless of who wrote the terminal outcome.
- Keep temporary frames in the existing bounded records ingest stream.
- Give frames a producer `frame_index` and durable events a database `sequence`.
- Use repaired records as durable history only after retention separates from tracing policy.
- Allocate new durable sequences in the records domain. The exact database choice remains open.
- Reload a snapshot after disconnect, then follow from its sequence.
- Pause queued input after manual Stop. Steer saves input before it interrupts current work.

Late output disposition remains open. The current code quarantines it behind the history flag until
Mahmoud chooses quarantine or rejection. Both choices exclude late output from canonical reads.

## Delivery increments

1. **Pure fixes.** Land record acknowledgement after commit in #6502 and admission before sandbox
   mutation in #6500.
2. **Stop and recovery.** Ship durable direct Stop, warm cancellation, recovery, terminal
   compare-and-set, and correct client state behind `AGENTA_SESSIONS_DURABLE_STOP`.
3. **History producer and retention.** Separate session retention first, then add stable records,
   complete checkpoints, and ordered writes behind `AGENTA_SESSIONS_HISTORY_WRITES`. Clients do
   not change in this increment.
4. **Shared reading for secondary readers.** Add the relay, sequence, snapshot, and one reducer
   behind `AGENTA_SESSIONS_SHARED_READER`. The sender remains on invoke.
5. **Sender on the shared path.** Move the sender to the proven shared reader and detach execution
   lifetime from the invoke response.
6. **Durable approvals.** Make interaction answers and continuation intent atomic and recoverable.
7. **Queue, then Steer.** Add server-visible pending input, then interrupt and priority promotion.

Each increment starts after its dependencies pass the named checkpoint in [`plan.md`](plan.md).

## Flags and rollback

The API reads server switches from `api/oss/src/utils/env.py`. Application code never reads these
values with `os.getenv`.

| Increment | Switch | Off behavior and rollback |
|---|---|---|
| 2 | `AGENTA_SESSIONS_DURABLE_STOP` | Flip off. The old Stop path stays mounted. |
| 3 | `AGENTA_SESSIONS_HISTORY_WRITES` | Flip off. Nullable fields remain and old record writes stay mounted. |
| 4 and 5 | `AGENTA_SESSIONS_SHARED_READER` | Flip off. Clients return to invoke or watch-and-refetch. |

Project allowlists and capability advertisement are an open rollout choice. Durable approvals,
Queue, and Steer must name their switches and rollback paths before implementation starts.

## Compatibility

Existing invoke, records, interaction, cancel, and watch endpoints remain available during
migration. New database fields and cursor rows are additive. Existing records remain readable.
Every durable write after the sequence migration receives a sequence, including writes through old
endpoints. A legacy write path that cannot allocate one stays off behind the history flag.

## Scope limits

Version one defers Postgres execution ownership, ownership generations, multi-runner guarantees,
and permanent token storage.

## Operational release contract

The release exports counters for commands admitted, delivered, applied, obsolete, and lost. It
also exports a Stop delivery latency histogram, harness cancel latency, watchdog settlements,
quarantined or rejected late records, and sweep pass duration. Metrics do not use session or
execution IDs as labels.

Normal Stop alerts at five seconds. Current runs measured less than 300 milliseconds. A release
that exceeds one second needs a written reason in its release notes. An abandoned execution must
settle within 150 seconds, based on a 90-second stale threshold and a 60-second sweep interval.

## What remains to decide

[`open-questions.md`](open-questions.md) presents seven choices: sequence storage, late output,
Codex child cleanup, rollout granularity, Stop spelling, shutdown grace, and teardown semantics.

## Release rule

An increment completes only when its automated tests pass, its integrated stack passes the
relevant rows in [`qa.md`](qa.md), and [`status.md`](status.md) records the exact tested commit.
