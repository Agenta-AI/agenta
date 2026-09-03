# RFC: Session control and shared live events

> **AGENT-GENERATED, low weight.**

## Purpose

Agenta will make session execution independent from the browser request that starts it. Clients
will submit durable work to the API and read the same session state and live output from the API.
The runner remains private.

This RFC is the high-level design. Exact interfaces live under [`contracts/`](contracts/), work
boundaries live under [`work-packages/`](work-packages/), and release proof lives in
[`qa.md`](qa.md).

## Problems

The current system has five related problems:

1. Only the browser that starts an execution receives its original live stream.
2. Other clients receive change notices and reload completed records.
3. Stop normally reaches the runner through a later heartbeat and can destroy warm state.
4. Pending messages live in one browser and are invisible elsewhere.
5. Clients infer execution state from several sources that update at different times.

## Target behavior

- The API durably accepts Send, Stop, Queue, Steer, and interaction responses.
- Direct authenticated delivery carries Stop from the API to the runner in version one.
- Heartbeats prove runner health and refresh ownership. They do not carry normal Stop delivery.
- Stop ends current work, records one terminal outcome, and preserves a safe warm sandbox.
- Every authorized client receives the same live text and tool progress.
- Postgres stores durable session history. Redis holds temporary live frames and current ownership.
- A snapshot returns current durable state and its numeric per-session sequence.
- An event connection replays committed facts after that sequence and then follows new activity.
- Closing, refreshing, or changing clients does not stop execution.
- Every failure leaves committed history readable and the session able to accept another message.

## System boundaries

```text
Commands       Client -> API -> Postgres -> delivery adapter -> Runner
Live output    Runner -> API -> bounded Redis Stream -> API SSE -> Clients
History        Runner/API -> Postgres records and per-session sequence
Ownership      Runner <-> API heartbeat -> Redis lease and Postgres mirror
```

The four paths have separate responsibilities. A failed live connection cannot stop the runner.
A missed notification cannot erase committed history. A heartbeat failure can expire ownership,
but it does not define the browser stream.

## Main decisions

- Keep current Redis ownership for the first release.
- Use direct API-to-runner Stop delivery behind a replaceable adapter.
- Keep runner-initiated long polling as parked work in Linear AGE-4253.
- Keep `expected_execution_id` optional. First-party clients send it when they know the current
  execution.
- Reject a second Send by default until every client displays the server queue.
- Clear `running` after Stop settles. Keep `alive` only while the sandbox is safely parked.
- Reject output after terminal settlement with non-retryable `execution_terminal`.
- Keep temporary frames in bounded Redis storage. Do not store every token permanently.
- Use repaired records as durable history unless the remaining record investigation proves that
  unsafe.
- Add a database-assigned per-session sequence to new durable records. Do not rewrite old rows.
- On disconnect, reload a snapshot and follow from its sequence.
- Manual Stop pauses queued input. Steer saves its input, stops current work, and promotes that
  input before older queued messages.

The reasoning and replaced alternatives are in [`decisions.md`](decisions.md).

## Delivery milestones

1. **Contract baseline.** Agree on public operations, command delivery, events, persistence, and
   validation before implementation branches diverge.
2. **Reliable session control.** Ship guarded durable Stop, warm continuation, honest terminal
   outcomes, recovery, and late-output rejection.
3. **Shared live output.** Let the sender, another browser, and mobile receive the same temporary
   output while the sender still keeps its existing invoke stream.
4. **Durable reconnect.** Add immutable checkpoints, per-session sequence, snapshot, and replay.
5. **One reader model.** Move the sender to the shared event path and remove execution ownership
   from the browser request.
6. **Durable pending work.** Move Queue, Steer, and approval continuation onto durable commands.

Reliable session control and shared live output can start in parallel after the contract baseline.
The complete dependency graph is in [`plan.md`](plan.md).

## Compatibility

Existing invoke, records, interaction, and watch endpoints remain available during migration. New
contracts are additive. Existing records remain readable and resumable. Clients migrate before an
old endpoint is removed.

## Scope limits

The first version does not add Postgres execution ownership, ownership generations, multiple-runner
guarantees, permanent token storage, queue reordering, or a new messaging product. Final public URL
spelling remains an API review item.

## Release rule

A milestone completes only when its automated tests pass, its integrated stack passes the relevant
rows in [`qa.md`](qa.md), and [`status.md`](status.md) records the exact tested commit.
