# Private command contract

> **AGENT-GENERATED, low weight.**

## What exists today

The command service stores Stop intent and calls a direct delivery interface. Settlement already
belongs to the service. The recovery sweep currently skips a pending command while its session
still beats, so an API failure after commit can strand an accepted Stop.

The stream runner client has a different contract. It swallows failures by design and must not
carry durable Stop.

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

The direct HTTP adapter lives with the command interfaces and is wired at the API entrypoint. It
records delivery failure and returns it to the service. It does not reuse
`streams/runner_client.py`.

## State transitions

```text
pending -> claimed -> applied
                   -> obsolete
                   -> lost
```

`pending` and `claimed` describe private delivery. Public clients follow execution state and
durable terminal events.

## Recovery rules

- A delivery failure leaves the command `pending`.
- A delivery timeout has an unknown result, so recovery reuses the same command ID.
- A `pending` command whose session still beats is redelivered with bounded attempts.
- A `pending` command whose runner is gone settles `lost`.
- Duplicate delivery returns the existing receipt and applies no second effect.
- A target execution that already settled makes the command `obsolete` or `lost` according to the
  open teardown decision, O7 in [`../open-questions.md`](../open-questions.md).
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

## Future adapters

Runner-initiated long polling remains parked in Linear AGE-4253. Adding it must not change public
operations, command identity, idempotency, settlement, or the delivery port.
