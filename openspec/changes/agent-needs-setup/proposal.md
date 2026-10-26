# Agent needs setup

## Why

An agent names the exact model, model key, subscription login, MCP server, custom secret or connected app (Composio connection) it uses. Since M5 option B (owner decision, 2026-10-26), nothing is inherited and nothing is replaced by name. So an agent can name an item that does not exist where it runs: an admin deleted it, turned it off or stopped sharing it, a model left the catalog, or, later, the agent was moved or copied.

Today each kind fails in its own way. A missing model key, subscription login, custom secret or new-style connected app fails the run, each with its own error. A missing MCP server lets the run continue without its tools. An old-style connected-app tool whose connection was deleted is dropped with only a log line. In the editor, a missing named model key and a deleted MCP server show nothing on their row, and at least eight different labels exist for the same problem. Schedules retry a configuration error five times, and nobody is told.

## What Changes

All nine design questions were decided by the owner on 2026-10-26.

- One server check finds every reference in an agent that names a missing item and returns a list of requirements (item, kind, reason, where it is used, and what the caller can do).
- `/m` calls the check when it opens an agent, in parallel with its other requests, so it adds no wait.
- Every item card that names a missing item shows the tag "Needs setup", with the reason on a second line. The agent list shows no tag.
- Only model items block a run: the model, its model key, or its subscription login. Then the config pane and the chat show a banner, the composer is blocked, and a run fails before the sandbox starts with one error, `agent_needs_setup`.
- Every other missing item (tools, MCP servers, MCP sign-ins, custom secrets, connected apps) does not block. The run starts without it. The only sign is the tag on the item's own card: no banner, no card, no blocker and no new chat notice.
- Saving is always allowed. No check runs at save time.
- A schedule or trigger that fires while a model item needs setup is skipped, not retried. The schedule stays on, and the automation shows the skip.
- One fix sheet per item: pick an existing item, connect a new one, sign in again, or remove the item from the agent. A fix writes every place that uses the item, as one new revision. The sheet never applies a replacement on its own.
- Templates keep their own setup step. Slack and other channels keep today's reply.

## Capabilities

### New Capabilities

- `agent-needs-setup`: the requirements check, the query route, the run error, the skipped automation delivery, and the "Needs setup" UI state and fix sheet.

### Modified Capabilities

None.

## Non-goals

- Template slots. Templates keep their own setup step (question 7).
- A "Used by N agents" warning before delete or unshare (question 8).
- A new reply in Slack or other channels (question 9).
- Any automatic rebinding, including a fallback to the project default for an agent that named a key.
- A background scan of all agents when an item is deleted.
- Email or push notifications.
- The classic `/w` app.
- A check at save time.

## Dependencies

- The project scope ships alone.
- The reason `not_shared` ships with M5 (`organization-credentials`). The reason `needs_your_account` ships with M7 (`personal-credentials-bindings`).
- The move and copy review step ships when move and copy exist (M6c).
