# Session rewind and branching

This workspace explains how rewind works in pull request 5860, why the current implementation
still has correctness gaps, what should change before that pull request merges, and how Agenta can
support durable branches later without making records mutable.

## Reading order

1. [context.md](context.md) starts with the user story and the behavior users see today.
2. [research.md](research.md) traces the current frontend, API, record, and runner behavior.
3. [data-model.md](data-model.md) compares the storage options and recommends session lineage.
4. [api-design.md](api-design.md) defines the proposed contracts and frontend state.
5. [performance-and-migration.md](performance-and-migration.md) counts requests and describes
   migrations, storage growth, and read costs.
6. [plan.md](plan.md) separates the requested PR changes from later backend work.
7. [status.md](status.md) records settled decisions, open decisions, and implementation status.

## Terms

- **Session:** The user-visible conversation identity. The runner also uses its ID to find native
  harness continuity.
- **Turn:** One user input and the agent execution it starts. A session contains ordered turns.
- **Record:** One append-only event inside a turn, such as user text, assistant text, a tool call,
  or a tool result.
- **Runner:** The service that executes one agent turn and persists its events.
- **Harness:** The underlying agent runtime, such as Pi, Claude Code, or Codex.
- **Hydration:** Rebuilding the browser transcript from durable server records.
- **Fork:** A new session that continues from a selected point in an older session.
- **Lineage:** Durable data saying which parent session a fork came from and how much of the parent
  transcript it inherits.
- **Effective transcript:** The ordered conversation a branch sees, including inherited parent
  turns and turns written directly to the branch.

## Recommendation in one paragraph

Pull request 5860 should remain a focused frontend bug fix. Before merge, it should persist the
complete fork bootstrap across reloads, including edit or rerun mode, restored draft, and history
replay state. It should clear that state only after a successful first request, preserve the source
title, and add the missing tests. It should state that the
inherited prefix is browser-local and therefore not a complete cross-device branch. A separate
backend project should add one lineage row per fork and a lineage-aware transcript read. Records
remain append-only and linear within each session. No parent field is needed on every record.
