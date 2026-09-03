# Work-package coordination

> **AGENT-GENERATED, low weight.**

## Package rules

Each package owns one reviewable result and one pull request series. Its document defines current
behavior, required behavior, interfaces, files, dependencies, tests, and completion evidence.

Agents may work in parallel only when their packages do not share an unresolved contract or the
same implementation files. Every package starts from the contract-baseline commit recorded in
[`../status.md`](../status.md).

## Packages

| Package | Result | Depends on | Can start with |
|---|---|---|---|
| [Stop and recovery](stop-and-recovery.md) | Fast, warm, durable Stop and clean failure recovery | Contract baseline | Live relay |
| [Live relay](live-relay.md) | Every client can see temporary output live | Event contract | Stop and recovery |
| [Durable history](durable-history.md) | Ordered immutable history, snapshot, and replay | Persistence contract | Stop and recovery; early relay work |
| [Shared client reader](shared-client-reader.md) | Sender, desktop, and mobile use one read model | Live relay and durable history | None |
| [Queue, Steer, and approvals](queue-steer-approvals.md) | Pending work and continuation are durable and shared | Command contract; reliable Stop | Durable history after its contract settles |

## Shared files

The following files require coordination because several packages may touch them:

- Session API router and service composition.
- Runner turn lifecycle and frame emission.
- Session record DTOs and persistence service.
- Desktop and mobile session state types.
- Database migrations.

An integration branch resolves shared-file conflicts. Package branches do not silently copy fixes
from one another.

## Merge and checkpoint rules

1. Review and merge independent package changes into a milestone integration branch.
2. Run static checks and package tests after every merge.
3. Deploy only at a named milestone checkpoint.
4. Run the relevant [`../qa.md`](../qa.md) rows on the exact integrated commit.
5. Fix integration defects on the package that owns the violated contract.
6. Record the tested commit and evidence in [`../status.md`](../status.md).

A checkpoint is a deployed integration test. It is not automatically a production release.
