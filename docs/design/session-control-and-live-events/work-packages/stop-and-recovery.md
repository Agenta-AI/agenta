# Work package: Stop and recovery

> **AGENT-GENERATED, low weight.**

## User-visible result

Stop reaches current work quickly, preserves safe warm state, and never leaves the session stuck.
A second Send receives a clear conflict without damaging the active execution.

## Current behavior

Stop can wait for a heartbeat and can destroy the sandbox. Concurrent sends can interfere before
the runner honors API admission. A dead runner or sandbox can leave work without a terminal record.

## Scope

- Admission before sandbox mutation.
- Durable Stop command and direct delivery.
- Optional execution guard.
- Harness cancellation and child-process cleanup.
- Approval cancellation.
- Post-Stop Redis and Postgres liveness.
- Runner shutdown ownership release.
- Watchdog settlement.
- Rejection of records after terminal settlement.
- Codex ACP version comparison.

Queue, Steer, shared token delivery, and durable replay remain outside this package.

## Dependencies

The package implements [`../contracts/commands.md`](../contracts/commands.md) and the Stop portion
of [`../contracts/public-api.md`](../contracts/public-api.md). It keeps current Redis ownership.

## Implementation sequence

1. Land record acknowledgement after Postgres commit and admission-before-sandbox fixes.
2. Select the smallest warm-cancel implementation for each harness.
3. Land durable Stop, direct delivery, execution guard, and client response handling.
4. Land watchdog recovery and terminal late-record rejection.
5. Integrate all slices and run the Stop and failure matrix.

## Completion gate

- Every supported provider and harness passes the applicable Stop rows in `qa.md`.
- Direct Stop reaches the runner within five seconds.
- Safe Stop resumes the same sandbox and native harness session.
- One terminal outcome remains visible.
- Every failure permits another message.
- Codex leaves no abandoned child process, through an upgraded adapter or a reviewed cleanup.
