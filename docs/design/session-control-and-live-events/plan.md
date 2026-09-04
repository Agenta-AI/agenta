# Session control and live events delivery plan

> **AGENT-GENERATED, low weight.**

## What ships first

Two current bugs ship before new behavior: #6502 acknowledges records only after Postgres commits,
and #6500 rejects concurrent execution before sandbox mutation. The next increment makes Stop fast,
durable, warm, and recoverable.

## Planning terms

**Work package:** One result that a pull request series can implement and review independently.

**Checkpoint:** A deployed integration commit that runs a named subset of `qa.md`.

**Increment:** One ordered release step with an activation and rollback rule.

## Milestones

Milestone 1 contains increments 1 to 3. The history producer is already closed, so it is not part
of the remaining work. Reliable Stop and shared history make milestone 1 a complete stopping point.

Milestone 2 contains increments 4 and 5.

Milestone 3 contains increments 6 and 7. Increment 7 releases Queue, then Steer. Milestone 3 is
optional. Start it only when there is a concrete need to submit work while a turn runs. The
trade-off is no multi-message queueing and no atomic save-and-interrupt.

## Increments

| Increment | User or system result | Required package | Flag and rollback |
|---:|---|---|---|
| 1 | Record ack and admission bugs are fixed in #6502 and #6500 | Stop and recovery | None. These are pure fixes. |
| 2 | Stop is durable, direct, warm, and recoverable | Stop and recovery | `AGENTA_SESSIONS_DURABLE_STOP`; flip off and keep the old Stop path mounted |
| 3 | History writes are stable, ordered, and independent from tracing retention | Durable history | `AGENTA_SESSIONS_HISTORY_WRITES`; flip off and keep old writes mounted |
| 4 | Secondary readers share relay, sequence, snapshot, and one reducer | Live relay | `AGENTA_SESSIONS_SHARED_READER`; flip off to watch-and-refetch |
| 5 | The sender uses the shared path and no longer owns execution lifetime | Live relay | `AGENTA_SESSIONS_SHARED_READER`; flip off to invoke |
| 6 | Approval answers and continuation intent are durable | Durable approvals | Name the env switch and old response fallback before implementation |
| 7 | Pending input is shared; Queue ships before Steer | Queue and Steer | Name separate Queue and Steer switches before implementation |

The API reads switches through `api/oss/src/utils/env.py`, never `os.getenv`. Each increment uses
one global environment switch. Version one has no project allowlist or capability advertisement.

## Dependencies

```text
Contract baseline candidate
    |
    +-> Increment 1: pure fixes
            |
            +-> Increment 2: Stop and recovery
            |       |
            |       +-> Increment 6: durable approvals
            |       |       |
            |       |       +-> Increment 7: Queue, then Steer
            |       |
            |       +-> Increment 3: durable history and retention
            |               |
            |               +-> Increment 4: secondary shared reading
            |                       |
            |                       +-> Increment 5: sender shared reading
```

History producer preparation may run beside Stop work. Retention separation must pass before
history writes turn on. The analytics cursor decision unblocks the sequence work. The sender moves
only after secondary readers pass shared-reading and replay checks.

## Checkpoints

### Pure-fix checkpoint

Test #6502 and #6500 independently on main. Prove database outage recovery and simultaneous
admission without enabling a new client path.

### Stop and recovery checkpoint

Deploy #6496 on main, #6503 on #6496, #6501 on #6503, and #6504 on #6503 after the pure fixes.
Run control, failure, provider, harness, retry, settlement, and rollback rows in `qa.md`. A stopped
session parks warm for 600 seconds. The product owner settled this duration on 5 September 2026.

### Durable history checkpoint

First prove that tracing quota and retention cannot delete session history. Then deploy complete
checkpoints, analytics cursor allocation, sequenced legacy writes, snapshot, and replay in shadow.
Clients remain unchanged.

### Secondary shared-reading checkpoint

Deploy shared ingress, bounded Redis retention, SSE relay, snapshot, sequence, and one reducer.
Keep the sender on invoke. Run multi-reader, slow-reader, authorization, replica, and rollback rows.

### Sender checkpoint

Move the sender to the shared event path. Run browser close, refresh, sender parity, desktop parity,
mobile parity, and rollback rows.

### Durable approvals checkpoint

Deploy atomic answer acceptance and continuation command creation. Run delivery failure, Stop race,
duplicate response, and rollback rows. If a user sends a message while a continuation runs, the
client holds it and sends it after the continuation ends. The server refuses the message if it
arrives during the continuation. The product owner settled this behavior on 5 September 2026.

### Queue and Steer checkpoint

Deploy visible pending input and Queue first. Keep busy default `reject` until enabled clients show
the queue. Add Steer only after save-before-stop and priority-promotion races pass. Run this optional
checkpoint only after the product gate in the Milestones section passes.

## Pull request rules

- Each package states its files and contract before implementation.
- Shared contract changes land before dependent branches start.
- A package carries tests, migration notes, flag behavior, rollback behavior, and required QA rows.
- An integration branch records evidence. It is not a merge source for package changes.
- A checkpoint records the exact commit, provider, harness, and evidence path in `status.md`.
- No issue closes until its reproducing QA row passes on the integrated commit.

## First execution cycle

1. Record this RFC head as the contract-baseline candidate.
2. Land and test #6502 and #6500 on main.
3. Test the Codex reap from #6496 and test the pin bump in a separate pull request.
4. Build the Stop stack in the stated base order.
5. Deploy it on local and Daytona providers.
6. Run the Stop and recovery checkpoint, including flag rollback.
