# Ground Truth

This page is the current implementation map. If another design page disagrees with this
page, treat this page and the referenced code as the source of truth.

## Code Surface

| Area | Files | Current role |
| --- | --- | --- |
| Agent service handler | `services/oss/src/agent/app.py` | Parses agent config, resolves secrets and tools, chooses a backend, runs batch or streaming turns. |
| Agent route wiring | `sdks/python/agenta/sdk/decorators/routing.py` | Registers `/invoke`, `/inspect`, and agent-only `/messages` plus `/load-session`. |
| Browser protocol adapter | `sdks/python/agenta/sdk/agents/adapters/vercel/` | Converts Vercel `UIMessage` input and emits Vercel UI Message Stream parts. |
| SDK runtime DTOs | `sdks/python/agenta/sdk/agents/dtos.py` | Defines `AgentConfig`, `RunSelection`, `SessionConfig`, messages, events, capabilities, and harness configs. |
| SDK runtime ports | `sdks/python/agenta/sdk/agents/interfaces.py` | Defines `Backend`, `Environment`, `Sandbox`, `Session`, `Harness`, `SessionStore`, and `NoopSessionStore`. |
| Backend adapters | `sdks/python/agenta/sdk/agents/adapters/in_process.py`, `rivet.py`, `local.py` | Implement in-process Pi and rivet backends. `LocalBackend` is a stub. |
| Harness adapters | `sdks/python/agenta/sdk/agents/adapters/harnesses.py` | Maps neutral session config into Pi, Claude, and Agenta harness-specific config. |
| Runner wire | `sdks/python/agenta/sdk/agents/utils/wire.py`, `services/agent/src/protocol.ts` | Keeps the Python and TypeScript `/run` payloads in sync. |
| Runner transports | `sdks/python/agenta/sdk/agents/utils/ts_runner.py`, `services/agent/src/server.ts`, `services/agent/src/cli.ts` | Send one-shot JSON or live NDJSON records to and from the runner. |
| Runner engines | `services/agent/src/engines/pi.ts`, `services/agent/src/engines/rivet.ts` | Run Pi in process or run a harness over ACP through rivet. |
| Tool execution | `sdks/python/agenta/sdk/agents/tools/`, `services/oss/src/agent/tools/`, `services/agent/src/tools/` | Parse tool config, resolve runnable specs, and execute callback, code, and MCP-delivered tools. |
| Tracing | `services/oss/src/agent/tracing.py`, `services/agent/src/tracing/otel.ts`, `services/agent/src/extensions/agenta.ts` | Thread trace context into the run and emit agent spans plus usage. |
| UI config controls | `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentConfigControl.tsx` | Edits the typed agent config shape in the playground. |

## Implemented

- The service exposes an agent workflow handler through `ag.create_app`, `ag.workflow`, and
  `ag.route`.
- `/invoke` runs one cold turn and returns the final assistant message.
- Agent routes register `/messages` and `/load-session` when `flags={"is_agent": True}`.
- `/messages` validates or mints `session_id`, folds Vercel `UIMessage` input into neutral
  runtime messages, and supports JSON or Vercel SSE based on `Accept`.
- Streaming runs over a runner NDJSON stream internally. The browser edge projects those
  events into Vercel UI Message Stream parts and appends `[DONE]`.
- `InProcessPiBackend` supports `pi` and `agenta` on local.
- `RivetBackend` supports `pi` and `claude` on local or Daytona.
- `PiHarness`, `ClaudeHarness`, and `AgentaHarness` exist and validate backend support.
- The tool resolver package exists in the SDK. The service composes SDK tool and MCP
  resolvers with service-owned gateway and vault adapters.
- Code tools execute in a subprocess with a minimal allowlisted environment plus scoped
  tool secrets.
- Callback tools route through `/tools/call`. On Daytona, Pi tool calls use the runner file
  relay.
- MCP delivery exists for non-Pi harnesses through the stdio MCP bridge, but service-side
  MCP resolution is feature-gated.

## Not Implemented

- `LocalBackend` does not run Pi or Claude. It raises `NotImplementedError`.
- `SessionStore` has no production adapter. The default `NoopSessionStore` returns empty
  history and discards writes.
- Completed `/messages` turns are not persisted to a session store by default.
- Harness session snapshots, such as Rivet/ACP state save/load around cleanup/setup, are
  not represented by a production port yet.
- Warm daemon sessions, ACP `session/load`, and session fork are not wired.
- `AgentaHarness` does not run on rivet or Daytona.
- `AgentaHarness` ships placeholder Agenta preamble, persona, and skill set.
- The agent is not registered as a first-class built-in workflow type.
- Pi `systemPrompt` and `appendSystemPrompt` are not delivered on the rivet ACP path.
- Remote MCP servers are skipped by the current runner path. Local stdio MCP is the path
  represented by the bridge.
- Trigger lifecycle, Compose.io trigger integration, and event-to-agent mapping are not
  implemented in the agent workflow code.
- A persisted agent template object that separates `AGENTS.md`, skills, tools,
  harness-specific config, and runtime infrastructure does not exist yet.

## Planned Or Blocked Work

- [SDK Local Tools](sdk-local-tools/) is a planned and partly implemented workspace for
  standalone SDK tool resolution. It remains blocked on `LocalBackend`.
- Durable server-owned sessions need a real `SessionStore`, a write path from completed
  turns, ownership checks, and a decision on platform versus local storage.
- Stateful session resume needs research into Rivet/ACP session representation and a
  future save/load snapshot interface separate from chat history.
- Trigger integration needs a provider port, a Compose.io adapter, Agenta-owned trigger
  state, and event-to-agent mapping.
- The old streaming RFCs are archived in [trash/old-rfcs/](trash/old-rfcs/). They explain
  why the protocol exists but no longer describe the exact current state.

## Verification Pointers

- `/messages` and `/load-session` routing tests live in
  `sdks/python/oss/tests/pytest/utils/test_messages_endpoint.py`.
- Agent service handler tests live in `services/oss/tests/pytest/unit/agent/`.
- Wire-contract tests live in `sdks/python/oss/tests/pytest/unit/agents/test_wire_contract.py`.
- Runner tool tests live in `services/agent/test/`.
