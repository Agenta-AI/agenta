# Agent self-naming tools

Two new platform tools that let an agent name and describe the session it is running in
(`rename_session`) and name and describe itself (`rename_agent`), plus the live-refresh
mechanism that makes those renames show up in an open browser tab.

## Reading order

| File | The question it answers |
| --- | --- |
| [context.md](context.md) | Why this work exists, what counts as done, what is out of scope, and which decisions are already made. |
| [research.md](research.md) | How agent tools, sessions, workflow artifacts, and the live-update relay work in the code today, and the two hazards found while reading them. |
| [api-design.md](api-design.md) | The exact contract of both tools, the tool descriptions the model reads, and the watch-event payload. |
| [plan.md](plan.md) | The implementation steps, in dependency order, with files per step. |
| [qa.md](qa.md) | Tests, the one-shot benchmark scenarios, and the live verification script. |
| [status.md](status.md) | Current progress, open decisions, and history. |

## Glossary

Terms used across these files, defined once here.

- **Agent**: what a user builds and talks to in the product. It is stored as a **workflow
  artifact** (the row the agents list reads) with variants and revisions under it. Its display
  name lives on the artifact.
- **Session**: one conversation. Stored as a `session_streams` row carrying `name` and
  `description`. `name` is the session title; there is no separate title column.
- **Runner**: the Node service that drives a turn, dispatches tool calls from the host, and holds
  the run's credential. The sandbox never holds a credential.
- **Sandbox**: the isolated process the harness runs in. It sends a tool name plus arguments and
  nothing else.
- **Harness**: the coding-agent program the runner drives (Claude Code, Pi, Codex).
- **Platform tool**: an Agenta endpoint exposed to the model as a tool. The author writes
  `{"type": "platform", "op": "<op>"}`; the description, schema, endpoint, and hidden bindings all
  come from a code-defined catalog.
- **Run context**: a blob of the run's own identity (project, workflow, trace) delivered on the
  `/run` request. A tool binds a field from it server-side so the model never sees or sets that
  field.
- **Context binding**: a map from a request-body path to a `$ctx.<dotted.path>` token. The runner
  fills it at dispatch, after the model's arguments, so a bound field always wins.
- **Build kit**: the tool set injected into every playground agent by default
  (`DEFAULT_BUILD_KIT_OPS`).
- **Watch relay**: a server-to-browser notification path. The server publishes a small frame on
  Redis, an endpoint streams it as Server-Sent Events, and the browser refetches through its
  normal endpoints. The frame carries ids only, never entity data.
