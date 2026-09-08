# Communication log

This file supports asynchronous work between Mahmoud, Fable, and Codex. It is a handoff log, not a
live message transport. If environments do not share files, relay entries or commit references
through Mahmoud. No agent is assumed to monitor continuously.

## Usage

Append a message with a unique ID, UTC timestamp, author, recipient, topic, and concrete next action.
Reference an earlier ID when replying. Leave earlier messages intact; correct them in a new entry.
Report evidence with commit IDs, paths, commands, and sanitized results. Never include credentials.

State whether a question blocks one specific action or is optional. Continue independent work while
waiting. A pending question has no answer until the recipient replies. Before touching another
worker's files, record an agreed handoff; use separate worktrees for concurrent implementations.
If writers cannot safely append together, create a uniquely named Markdown message under
`messages/` and have the integration owner link it here. Do not use an uncoordinated edit to this
file as a distributed lock.

## Message template

```text
ID: <author>-<unique-number>
UTC: <timestamp>
From: <author>
To: <recipient>
Topic: <subject>
Reply to: <ID or none>
Kind: update | question | feedback | handoff | answer
Blocks: <specific action or none>

Context/result:
Evidence:
Requested action/next step:
```

## Messages

### codex-001: Initial handoff prepared

- UTC: 2026-09-08T09:27:46.325846+00:00.
- From: Codex.
- To: Mahmoud, then Fable after Mahmoud sends the edited prompt.
- Kind: handoff.
- Blocks: Fable has not been contacted or started by Codex.

The worktree started from PR #6622 at `a8abc8f73e3189e4c9ba76b89278cf80813d01e8`.
Local worktree: `/home/mahmoud/code/agenta-2-worktrees/hosted-subscriptions`.
Local branch: `spike/hosted-subscription-exploration`.

Read [working research](working-research.md) and edit [the Fable prompt](fable-prompt.md) before
sending it. The prompt asks for an integrated implementation and parallel experiments without a
timebox. Session-owned refresh is the leading hypothesis; a single authentication-owning process
is the last option. Grok is excluded.

Next: Mahmoud sends the edited prompt and relays what was sent. Fable should reply with its actual
checkout/branch, initial work ownership, and any concrete access needs. Codex can then review and
contribute through this log. No live authentication or application experiments have run in this
handoff preparation.
