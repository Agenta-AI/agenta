# Work package: durable approvals

> **AGENT-GENERATED, low weight.**

## What users see today

An approval response uses a separate continuation path. If continuation delivery fails after the
answer is consumed, the approval can disappear without recoverable work.

## User-visible result

An accepted answer remains durable, and every client sees its continuation or explicit failure.
Stop and an approval response have one committed winner.

## Scope

- Typed interaction response and exact `expected_execution_id` guard.
- One transaction for answer acceptance, continuation execution, and private command.
- Shared lock order: execution row, then interaction row.
- Stop cancellation of pending interactions owned by its target execution.
- Idempotent response retries and duplicate delivery.
- Explicit continuation failure and a usable session after failure.
- Durable approval events added with this package.

## Dependencies

Reliable Stop and its terminal compare-and-set must pass first. The public snapshot must already
expose pending interactions.

## Flag and rollback

The package must add an env-backed server switch through `env.py` before implementation. Off keeps
the current response endpoint mounted. The exact switch name is a package contract decision.

## Implementation sequence

1. Freeze typed approval events, errors, idempotency, and the exact lock order.
2. Commit the answer, continuation execution, and private command in one transaction.
3. Route delivery through the command service and recover a lost response or delivery result.
4. Serialize Stop and response with exact state predicates.
5. Adopt the durable outcome in desktop and mobile.

## Completion gate

- A lost HTTP response returns the first stable IDs on retry.
- Duplicate delivery starts one continuation.
- API death after commit does not lose the answer.
- Stop and response in one window produce one winner and one clear loser.
- A permanent continuation failure remains visible and permits another action.
- Turning the flag off restores the mounted old response path.
