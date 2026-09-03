# Work package: Stop and recovery

> **AGENT-GENERATED, low weight.**

## What users see today

Stop can wait for a heartbeat and can destroy the sandbox. The desktop can show `stopped` before
the durable request succeeds. A dead runner can leave work without a terminal outcome, and the
sweep skips a pending command while the session still beats.

## User-visible result

Stop reaches current work quickly, preserves proven warm state, and never leaves the session stuck.
The client shows `stopping`, `stopped`, or `recovering` from durable server state. A second Send
receives a clear conflict without damaging active work.

## Scope

- #6502 record acknowledgement after Postgres commit.
- #6500 admission before sandbox mutation.
- Durable Stop through `POST /sessions/{session_id}/cancel`.
- Direct `deliver(command) -> receipt` and pending-command redelivery.
- Optional `expected_execution_id` and first-party idempotency keys.
- Harness cancellation, child cleanup, and safe warm parking.
- Database terminal compare-and-set for runner and watchdog.
- Atomic Postgres settlement and idempotent Redis reconciliation.
- Watchdog settlement, bounded sweep passes, and the 150-second recovery SLO.
- Late-record guard for every terminal cause. Final quarantine or rejection stays open.
- Desktop state restoration when Stop submission fails.
- Codex reap now, with the ACP pin comparison in a separate pull request if Mahmoud agrees.

Queue, Steer, shared reading, and durable replay remain outside this package.

## Flag and rollback

`AGENTA_SESSIONS_DURABLE_STOP` is an env-backed server switch read through `env.py`. Off routes
clients to the mounted old Stop path. The checkpoint must prove the flip in both directions.

## Pull request order and bases

1. #6502 starts on main.
2. #6500 starts on main.
3. #6496 starts on main.
4. #6503 starts on #6496.
5. #6501 starts on #6503.
6. #6504 starts on #6503.

The integration branch records evidence only. It is not a merge source.

## Recovery and settlement rules

A `pending` command for a beating session is redelivered with the same command ID and bounded
attempts. A `pending` command whose runner is gone settles `lost`. This corrects the current
`_session_is_beating` skip on #6503.

The execution row accepts terminal fields only while they are null. Runner and watchdog outcomes
use that compare-and-set. Late records consult the same row for every terminal cause.

Where state shares a database, one transaction settles the command, clears the stopping marker,
updates the session mirror, and cancels interactions. Redis liveness changes after commit through
an idempotent write. A sweep repairs a missed Redis write.

If the runner cannot settle, the watchdog writes the ending, clears `running`, releases `alive`,
and updates the mirror. Each sweep pass has a time bound and logs a timeout.

## Client and timing rules

- The desktop shows `stopping` until the API accepts Stop.
- It shows `stopped` only after the terminal event.
- A failed request restores `running` and reconnects or refreshes observation.
- The client shows `recovering` until an abandoned execution settles.
- Abandoned work settles within 150 seconds.
- Five seconds is the Stop alert threshold.
- Current evidence is below 300 milliseconds.
- A release above one second needs a written reason.

## Completion gate

- Every supported provider and harness passes its Stop rows in `../qa.md`.
- Safe Stop resumes the same sandbox and native harness session.
- A lost response and duplicate delivery create one command effect.
- API death after command commit still results in delivery or bounded `lost` settlement.
- Stop racing completion or approval response produces one terminal winner.
- One terminal outcome remains visible after runner and watchdog races.
- Every failure permits another message.
- The Stop flag rolls back to the mounted old path.
- Codex leaves no abandoned child process on local and Daytona.
