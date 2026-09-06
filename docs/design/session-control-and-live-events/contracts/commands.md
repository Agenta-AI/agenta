# Private command contract

> **AGENT-GENERATED, low weight.**

## Purpose

Commands preserve execution-changing intent independently from delivery. Public routes accept
operations, while a private command store and adapter deliver them to the runner.

## Command shape

```text
command_id
session_id
type
expected_execution_id
payload: typed by command type
status: pending | claimed | applied | obsolete | lost
claimed_by
claim_expires_at
attempt_count
next_attempt_at
created_at
applied_at
result
```

`expected_execution_id` has the same name and meaning at the public and private boundaries. Each
command type defines its payload. A free-form payload is not part of the contract.

The command ID remains stable across retries. The runner applies one command ID at most once.

## Delivery port

The commands domain owns this transport port:

```text
deliver(command) -> receipt
```

The receipt reports whether the runner accepted, duplicated, or refused delivery. It does not
settle the command. The command service owns settlement, retry scheduling, and recovery.

## State transitions

```text
pending -> claimed -> applied
                   -> obsolete
                   -> lost
```

`pending` and `claimed` describe private delivery. Public clients follow execution state and
durable terminal events.

## Continuation admission

A continuation command owns the next Send while its execution is `pending_delivery` or
`recoverable`. Once it is `applied/started`, Send admission depends on the continuation phase:

- **EXECUTING:** the client holds a Send and delivers it after the continuation ends. If a client
  sends it anyway, the server refuses it so it cannot supersede the executing continuation.
- **PARKED:** the server accepts a Send as a steer, just as it does for an initial execution parked
  for human input.

If the watchdog moves the execution to `recoverable`, preflight may reopen and redeliver it before
accepting a new message. The client hold is an ordering guarantee; the server refusal is the race
backstop for stale or non-conforming clients.

## Recovery rules

- A delivery failure leaves the command `pending`.
- A delivery timeout has an unknown result, so recovery reuses the same command ID.
- A `pending` command whose session still beats is redelivered with bounded attempts.
- A `pending` command whose runner is gone settles `lost`.
- Duplicate delivery returns the existing receipt and applies no second effect.
- Normal shutdown releases claims. Forced shutdown relies on lease expiry and the sweep.
- Each sweep pass has a time bound. A timeout is logged and does not stop later passes.

## Settlement rules

The execution row chooses one terminal winner through a compare-and-set. The runner and watchdog
call the same settlement service. Only the winner writes the effective terminal event.

Where the data shares a database, one transaction settles the command, clears the stopping marker,
updates the session mirror, and cancels pending interactions for the target execution. Redis
liveness changes after commit through an idempotent write. A sweep repairs a missed Redis write.

## Stop and interaction races

Both transactions lock the execution row first and the interaction row second. Each update checks
the exact expected state. A winning Stop cancels only interactions owned by its target execution.
A winning response creates one continuation execution and command.
