# Tonight handoff

> AGENT-GENERATED, low weight. Draft execution handoff. Mahmoud makes final decisions.

> **UPDATE, 2026-09-03:** This pre-spike handoff is historical. Direct authenticated delivery is
> now the confirmed version-one adapter. Runner-initiated long polling remains parked in Linear
> AGE-4253. Current status and release coverage live in [status.md](status.md) and
> [qa.md](qa.md).

## Fixed direction

- Keep current Redis execution ownership for version one.
- Add durable commands with `pending`, `claimed`, `applied`, and `obsolete` states.
- Use direct authenticated delivery behind a replaceable control-delivery port.
- Keep `expected_execution_id` optional on public Stop.
- Keep the Redis ownership lock until Stop settles.
- Keep accepted commands durable when direct delivery fails. Use the watchdog and ownership lease
  for recovery. Do not make heartbeat polling the normal Stop path.
- Require Stop followed by warm resume of the same sandbox and native harness session.
- Keep live-frame work independent from Stop work.
- Park the repaired-records versus separate-event-table decision for review.

## Work package A: sandbox cancellation spike

**Goal:** Prove how to cancel current work while preserving warm resume.

Answer:

1. Which request cancels a prompt in each supported harness?
2. Does it preserve the native harness session?
3. What happens to a running tool and partial message?
4. Does the runner park or destroy the sandbox on every cancellation path?
5. Is a sandbox-agent patch required?
6. Does Daytona need a rebuilt snapshot?

Deliver a code-traced report, a characterization test, the smallest patch proposal, and a live test
plan for start, Stop, and resume in the same sandbox and native session. Do not redesign ownership,
commands, or public endpoints.

## Work package B: durable command and long-poll design

**Goal:** Produce an implementation-ready design for reliable API-to-runner commands.

Define the command schema, claim lease, idempotency, long-poll claim and acknowledgement behavior,
heartbeat fallback, failure recovery, adapter boundary, and how Redis ownership remains held until
Stop settles. Deliver a short design and migration sequence. Do not implement a new execution
ownership model.

## Work package C: current Stop implementation map

**Goal:** Remove uncertainty before changing Stop.

Trace the browser request, API stream mutation, Redis key changes, heartbeat response, runner abort,
sandbox cleanup, records, interactions, and frontend refresh. List every branch that means cancel,
kill, steer, or approval interruption. Deliver a sequence diagram and file-by-file change map. Do
not implement changes.

## Work package D: stable record-ID spike

**Goal:** Make the later immutable-history decision safe.

Inventory every stable `record_id` producer and classify repeated IDs as exact retries,
progressive updates, or resume re-emissions. Add or propose regression tests for final tool state,
interaction responses, terminal events, and harness reconstruction. Do not select repaired records
or a separate event table.

## First implementation after the spikes

1. Add the durable command repository and service behind interfaces.
2. Add the runner long-poll claim loop and API adapter.
3. Let Stop create a durable command with an optional expected-execution guard.
4. Let the runner apply Stop through its active abort controller.
5. Preserve Redis ownership until cancellation settles.
6. Make heartbeat discover pending Stop as fallback.
7. Emit the durable cancellation outcome and publish the existing watch notification.
8. Prove Stop delivery within five seconds and warm resume on the live stack.

## Deferred explicitly

- Postgres execution authority.
- Ownership generations and full fencing.
- Multiple-runner routing guarantees.
- User-operated runner requirements.
- Final records versus event-table selection.
- Final public endpoint naming.
- WebSocket or gRPC control transport.
