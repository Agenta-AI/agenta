# Ground Truth

This page maps what the agent-workflows code does, what is wired, and what is missing. It is
verified against the files it cites. If another design page disagrees with this page, treat
this page and the referenced code as the source of truth.

## Code Surface

| Area | Files | Active-stack role |
| --- | --- | --- |
| Agent service handler | `services/oss/src/agent/app.py` | Parses agent config, resolves secrets and tools, builds `SandboxAgentBackend`, runs batch or streaming turns. |
| Agent route wiring | `sdks/python/agenta/sdk/decorators/routing.py` | Registers `/invoke`, `/inspect`, and agent-only `/messages`. |
| Browser protocol adapter | `sdks/python/agenta/sdk/agents/adapters/vercel/` | Converts Vercel `UIMessage` input and emits Vercel UI Message Stream parts. |
| SDK runtime DTOs | `sdks/python/agenta/sdk/agents/dtos.py` | Defines `AgentConfig` (incl. the run-selection fields), `SessionConfig`, messages, events, capabilities, and harness configs. |
| SDK runtime ports | `sdks/python/agenta/sdk/agents/interfaces.py` | Defines `Backend`, `Environment`, `Sandbox`, `Session`, and `Harness`. |
| Backend adapters | `sdks/python/agenta/sdk/agents/adapters/sandbox_agent.py`, `local.py` | Implement the sandbox-agent backend. `LocalBackend` is a stub. |
| Harness adapters | `sdks/python/agenta/sdk/agents/adapters/harnesses.py` | Maps neutral session config into Pi, Claude, and Agenta harness-specific config. |
| Runner wire | `sdks/python/agenta/sdk/agents/utils/wire.py`, `services/agent/src/protocol.ts` | Keeps the Python and TypeScript `/run` payloads in sync. |
| Runner transports | `sdks/python/agenta/sdk/agents/utils/ts_runner.py`, `services/agent/src/server.ts`, `services/agent/src/cli.ts` | Send one-shot JSON or live NDJSON records to and from the runner. |
| Runner engine | `services/agent/src/engines/sandbox_agent.ts` | The one engine: runs a harness over ACP through sandbox-agent. |
| Tool execution | `sdks/python/agenta/sdk/agents/tools/`, `services/oss/src/agent/tools/`, `services/agent/src/tools/` | Parse tool config, resolve runnable specs, and execute callback, code, and MCP-delivered tools. |
| Tracing | `services/oss/src/agent/tracing.py`, `services/agent/src/tracing/otel.ts`, `services/agent/src/extensions/agenta.ts` | Thread trace context into the run and emit agent spans plus usage. |
| UI config controls | `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentConfigControl.tsx` | Edits the typed agent config shape in the playground. |

## Implemented

- The service exposes an agent workflow handler through `ag.create_app`, `ag.workflow`, and
  `ag.route`.
- `/invoke` runs one cold turn and returns the final assistant message.
- Agent routes register `/messages` when `flags={"is_agent": True}`.
- `/messages` validates or mints `session_id`, folds Vercel `UIMessage` input into neutral
  runtime messages, and supports JSON or Vercel SSE based on `Accept`.
- Streaming runs over a runner NDJSON stream internally. The browser edge projects those
  events into Vercel UI Message Stream parts and appends `[DONE]`.
- The deployed service always uses `SandboxAgentBackend` (`services/oss/src/agent/app.py:49`).
  It does not select a backend per harness.
- `SandboxAgentBackend` supports `pi_core`, `pi_agenta`, and `claude` on local or Daytona.
- The runner drives one engine, the sandbox-agent ACP path (`engines/sandbox_agent.ts`). The
  `harness` field selects the agent: `pi_core` and `pi_agenta` both drive the `pi` ACP agent,
  `claude` drives `claude`. There is no engine selector on the wire.
- `PiHarness`, `ClaudeHarness`, and `AgentaHarness` exist and validate backend support. The
  Python class names are unchanged; only the harness string values changed (`HarnessType.PI`
  is `"pi_core"`, `HarnessType.AGENTA` is `"pi_agenta"`, `HarnessType.CLAUDE` is `"claude"`).
- Pi `systemPrompt` and `appendSystemPrompt` overrides are delivered on the sandbox-agent Pi
  path. The engine writes `SYSTEM.md` / `APPEND_SYSTEM.md` into the per-run Pi agent dir,
  local and Daytona (`services/agent/src/engines/sandbox_agent/pi-assets.ts`).
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
- There is no durable session store. The runtime is cold and completed `/messages` turns are
  not persisted; there is no history-load endpoint.
- Harness session snapshots, such as sandbox-agent/ACP state save/load around cleanup/setup, are
  not represented by a production port yet.
- Warm daemon sessions, ACP `session/load`, and session fork are not wired.
- `AgentaHarness` ships placeholder Agenta preamble, persona, and skill set. It does run on
  sandbox-agent local and Daytona, verified by the QA matrix (`projects/qa/findings.md`, F-002).
- The live agent handler is bound to the builtin URI `agenta:builtin:agent:v0`:
  `create_agent_app()` (`services/oss/src/agent/app.py`) registers the instrumented `_agent` and the
  service interface under that URI, so `retrieve_handler` / `retrieve_interface` return the live
  handler and the same schemas `/inspect` advertises (the interface override is process-local to the
  agent service). The harness in the agent_config interface carries a versioned slug + display name
  per option (`HARNESS_IDENTITIES`); the stored/wire harness value stays the bare string.
- Per-request model override is not honored on the Pi ACP path. pi-acp accepts only its
  default model and silently falls back (`projects/qa/findings.md`, F-007).
- Remote (`http`) MCP servers are skipped by the runner path. Local stdio MCP is the path
  represented by the bridge.
- Trigger lifecycle, Compose.io trigger integration, and event-to-agent mapping are not
  implemented in the agent workflow code.
- A persisted agent template object that separates `AGENTS.md`, skills, tools,
  harness-specific config, and runtime infrastructure does not exist yet.

## Planned Or Blocked Work

- [SDK Local Tools](../projects/sdk-local-tools/) is a planned and partly implemented
  workspace for standalone SDK tool resolution. It remains blocked on `LocalBackend`.
- Durable server-owned sessions need a session store with a port and adapter, a write path
  from completed turns, a history-load endpoint, ownership checks, and a decision on platform
  versus local storage.
- Stateful session resume needs research into sandbox-agent/ACP session representation and a
  future save/load snapshot interface separate from chat history.
- Trigger integration needs a provider port, a Compose.io adapter, Agenta-owned trigger
  state, and event-to-agent mapping.
- The old streaming RFCs are archived in [../archive/old-rfcs/](../archive/old-rfcs/). They
  explain why the protocol exists but no longer describe the exact current state.

## Verification Pointers

- `/messages` routing tests live in
  `sdks/python/oss/tests/pytest/utils/test_messages_endpoint.py`.
- Agent service handler tests live in `services/oss/tests/pytest/unit/agent/`.
- Wire-contract tests live in `sdks/python/oss/tests/pytest/unit/agents/test_wire_contract.py`.
- Runner tests live in `services/agent/tests/unit/`.
