# Work-package coordination

> **AGENT-GENERATED, low weight.**

## Current package shape

The delivery plan now has five packages. Shared-reader work belongs to the live-relay package.
Durable approvals ship before the separate Queue and Steer package.

Each package owns one reviewable result and one pull request series. Its document defines current
behavior, required behavior, interfaces, files, dependencies, flags, tests, and completion evidence.

## Packages

| Order | Package | Result | Depends on |
|---:|---|---|---|
| 1 and 2 | [Stop and recovery](stop-and-recovery.md) | Pure fixes, fast warm Stop, and bounded recovery | Contract baseline |
| 3 | [Durable history](durable-history.md) | Retention-safe, ordered history and replay | Sequence decision; pure fixes |
| 4 and 5 | [Live relay and shared reader](live-relay.md) | Secondary readers, then sender, use one live state model | Durable history contract |
| 6 | [Durable approvals](durable-approvals.md) | Accepted answers and continuations survive delivery failure | Reliable Stop |
| 7 | [Queue and Steer](queue-steer.md) | Every client sees pending input; Queue ships before Steer | Shared snapshot; reliable Stop |

## Client ownership

- `web/packages/agenta-entities/src/session` owns session API schemas and durable state.
- `web/packages/agenta-chat` owns transport-independent transcript projection and the reducer.
- `web/packages/agenta-sessions/src/watch` owns the current SSE connection and evolves into the
  shared event connection.
- New request and response calls use the Fern client. SSE is the explicit exception.

## Shared files

The following surfaces need coordination:

- Session API router and service composition.
- Command service, direct delivery adapter, and sweep.
- Runner cancellation and frame emission.
- Session record data access, worker, and migrations.
- Desktop and mobile session state and rendering.

Package branches do not copy fixes from one another. The integration branch records combined
proof, but it is not a merge source.

## Merge and checkpoint rules

1. Start each package from the contract-baseline candidate recorded in `../status.md`.
2. Follow the pull request bases stated in the package.
3. Run static checks and package tests after each merge.
4. Deploy only at a named checkpoint in `../plan.md`.
5. Run the relevant `../qa.md` rows on the exact integrated commit.
6. Record commit, provider, harness, and evidence path in `../status.md`.
7. Keep the old path mounted until the package rollback test passes.
