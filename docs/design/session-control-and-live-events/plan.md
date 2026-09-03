# Session control and live events delivery plan

> **AGENT-GENERATED, low weight.**

## Planning terms

**Work package:** One result that a branch and pull request can implement and review independently.

**Integration merge:** A branch that combines completed packages and resolves shared-file conflicts.

**Checkpoint:** A deployed integration commit that runs a named subset of `qa.md`.

**Milestone:** A user-visible system capability accepted at a checkpoint.

## Milestones

| Milestone | Result | Required packages |
|---|---|---|
| Contract baseline | Reviewers agree on public operations, command delivery, events, persistence, and QA | Documentation only |
| Reliable session control | Fast warm Stop, clean failure recovery, and safe second-send rejection | Stop and recovery |
| Shared live output | Sender, second browser, and mobile receive the same temporary output | Live relay |
| Durable reconnect | Snapshot, ordered durable history, and replay survive disconnects | Durable history plus live relay |
| One reader model | The sender uses the same read path as every other client | Shared client reader |
| Durable pending work | Queue, Steer, and approval continuation use durable server state | Queue, Steer, and approvals |

## Dependencies

```text
Contract baseline
    |
    +----> Stop and recovery --------------------------+
    |                                                  |
    +----> Live relay ----> Durable history ----------+----> One reader model
    |                                                  |
    +--------------------------------------------------+----> Queue, Steer, approvals
```

Stop and recovery can run beside the live relay. Durable history can begin its producer work while
the relay runs, but snapshot and replay wait for the persistence contract. The sender migrates only
after live relay and durable reconnect pass.

## Checkpoints

### Reliable session control checkpoint

Deploy the selected Stop and recovery pull requests together. Run all control, failure, provider,
and harness rows in `qa.md`. Do not include Queue, Steer, or shared live output.

### Shared live output checkpoint

Deploy frame ingress, bounded Redis storage, SSE relay, and secondary-client rendering. Keep the
sender on its existing invoke stream. Run the multiple-reader, slow-reader, API-replica, and relay
failure rows.

### Durable reconnect checkpoint

Deploy complete record checkpoints, session sequence, snapshot, and replay. Run legacy-session,
Postgres outage, reconnect, duplicate, ordering, and replay-to-live rows.

### One reader checkpoint

Detach execution lifetime from the start request and move the sender to the shared event path. Run
browser close, refresh, sender/secondary parity, and desktop/mobile parity rows.

### Durable pending-work checkpoint

Deploy pending input, Queue, Steer, and durable approval continuation. Run idempotency, ordering,
removal, Stop pause, Steer failure, and interaction race rows.

## Pull request rules

- Each work package states the files it owns before implementation begins.
- Shared contract changes land before dependent implementation branches start.
- A package pull request carries package tests, migration notes, and its required QA rows.
- An integration branch combines packages. It does not hide package-specific changes.
- A checkpoint records the exact commit and evidence in `status.md`.
- No issue closes until the QA row that reproduces it passes on the integrated commit.

## First execution cycle

1. Review the contract baseline.
2. Compare the current and candidate Codex ACP versions.
3. Adapt the watchdog branch from quarantine to late-record rejection.
4. Review the independent Stop pull requests and select their merge order.
5. Build one Stop integration branch.
6. Deploy it on local and Daytona providers.
7. Run the reliable session control checkpoint.

The live-relay measurement and frame-envelope work can run at the same time.
