# Private command contract

> **AGENT-GENERATED, low weight.**

## Purpose

Commands preserve execution-changing intent independently from delivery. The public API accepts the
intent. A private adapter delivers it to the runner.

## Command shape

```text
command_id
session_id
type
target_execution_id
payload
status: pending | claimed | applied | obsolete
claimed_by
claim_expires_at
created_at
applied_at
result
```

The command ID is stable across delivery retries. The runner applies one command ID at most once.

## State transitions

```text
pending -> claimed -> applied
                   -> obsolete
```

`pending` and `claimed` describe private delivery. Public clients follow execution state.

## Version-one delivery

The API calls the owning runner through the existing authenticated direct route after the command
transaction commits. The session service depends on this port:

```text
deliver(command, runner_target)
recover(command_id)
settle(command_id, result)
```

The port prevents direct HTTP details from entering command admission or settlement logic.

## Failure rules

- A direct-call failure leaves the command recoverable.
- A delivery timeout has an unknown result. Recovery uses the same command ID.
- Duplicate delivery returns the existing result.
- A stale target execution makes the command obsolete.
- A missing runner leads to `lost`; it does not claim that Stop succeeded.
- Normal shutdown releases owned claims. Forced shutdown relies on lease expiry.

## Stop and interaction races

Postgres serializes Stop and interaction responses. The first transaction to commit wins. A winning
Stop cancels pending interactions for its execution. A winning response creates a new continuation
execution. An execution guard never follows from the old execution into the continuation.

## Future adapter

Runner-initiated long polling is specified in PR #6497 and parked in Linear AGE-4253. Adopting it
must not change public operations, command states, idempotency, or settlement.
