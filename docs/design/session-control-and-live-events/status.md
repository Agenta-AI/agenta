# Session control and live events status

> **AGENT-GENERATED, low weight.**

## Current milestone

The project is preparing the contract baseline for independent review. No implementation package is
approved by this document alone.

## Settled contracts

- Direct authenticated API-to-runner delivery is the version-one Stop adapter.
- Runner-initiated long polling is parked in Linear AGE-4253.
- Heartbeats prove health and ownership. They do not carry normal Stop delivery.
- `expected_execution_id` is optional. First-party clients send it when known.
- Stop clears `running`, preserves `alive` during a safe park, and updates the Postgres mirror.
- Late output receives non-retryable `execution_terminal` and is not stored.
- New durable facts receive a database-assigned per-session sequence.
- Existing records are not backfilled or rewritten.
- Temporary frames use bounded Redis storage and do not advance the durable sequence.
- Disconnect recovery reloads a snapshot and follows from its sequence.
- Manual Stop pauses pending input. Steer saves before stopping and runs before older queued input.

## Evidence confirmed so far

- Warm Stop passed with Pi and Claude Code on Daytona.
- Warm Stop passed with Pi, Claude Code, and Codex on the local provider.
- Output, active-tool, and pending-approval Stop cases continued in the same warm sandbox and native
  harness session.
- Direct Stop reached the local runner in 72 to 82 milliseconds.
- The Daytona Stop response took 70 to 104 milliseconds.
- Record acknowledgement after Postgres commit passed a database-outage test.
- The integration branch passed thirteen control and recovery scenarios using its implemented
  quarantine behavior. Version one still requires rejection instead of quarantine.

## Pull requests under review

| Pull request | Purpose | Current role |
|---|---|---|
| #6496 | Warm cancellation and continuity | Candidate implementation; Codex Daytona check remains |
| #6497 | Command and transport design | Evidence for direct and parked long-poll adapters |
| #6498 | Current Stop path | Reference evidence |
| #6499 | Stable record semantics | Investigation; producer changes remain |
| #6500 | Reject concurrent execution before sandbox mutation | Independent candidate |
| #6501 | Watchdog and stale-tail handling | Candidate; replace quarantine with rejection |
| #6502 | Acknowledge records after Postgres commit | Independent candidate |
| #6503 | Durable Stop and direct delivery | Candidate stacked on warm cancellation |
| #6504 | Execution guard, approvals, and clients | Candidate; interaction overlap needs review |
| #6505 | Overnight reports | Evidence only |
| #6506 | Combined branch | Integration evidence, not the source for package review |

## Work before implementation starts

1. Review requirements and all four contract documents.
2. Resolve the blocking questions in `open-questions.md`.
3. Compare the current Codex ACP pin with a current version on the full Codex matrix.
4. Assign one owner and one branch to each work package.
5. Record the contract-baseline commit here.

## Current branch

`agent/session-execution-rfc`, draft PR #6495.
