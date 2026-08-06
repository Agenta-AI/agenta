# Browser page titles

This workspace plans a frontend-only change that makes the browser tab describe the page or chat session a user is viewing.

## Reading order

1. [context.md](context.md) explains the user-visible behavior and scope.
2. [research.md](research.md) records the relevant frontend ownership and routing facts.
3. [plan.md](plan.md) defines the implementation slice and its acceptance checks.
4. [status.md](status.md) is the current source of truth for progress and blockers.

## Terms

- **Page title**: the text shown in the browser tab and written through `next/head`.
- **Project page**: a page scoped to a project but not to one agent.
- **Agent page**: a page scoped to one workflow artifact. The artifact provides the agent's display name.
- **Empty session**: an agent chat session before the user sends its first message.
- **Session title**: the persisted title derived from the first user message, capped at 60 characters by the existing chat state.

