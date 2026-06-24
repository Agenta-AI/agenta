# Ports And Adapters

The agent runtime uses the same hexagonal vocabulary as the rest of Agenta. The SDK owns
the neutral ports and data contracts. The service and runner plug adapters into them.

For the per-seam review lens (which boundary a diff touches and what it can break), see the
[in-service interfaces](../interfaces/in-service/) inventory. This page owns the layering
narrative.

## Runtime Package

The SDK runtime lives under `sdks/python/agenta/sdk/agents/`.

| Layer | Files | Role |
| --- | --- | --- |
| DTOs | `dtos.py` | `AgentConfig`, `RunSelection`, `SessionConfig`, messages, events, capabilities, and harness-specific config models. |
| Ports | `interfaces.py` | `Backend`, `Environment`, `Sandbox`, `Session`, `Harness`. |
| Backend adapters | `adapters/sandbox_agent.py`, `adapters/local.py` | Engines that can run a harness. |
| Harness adapters | `adapters/harnesses.py` | Per-harness mapping from neutral session config to harness-specific config. |
| Browser adapter | `adapters/vercel/` | Vercel `UIMessage` input and Vercel UI Message Stream output. |
| Runner plumbing | `utils/wire.py`, `utils/ts_runner.py` | `/run` serialization and runner transports. |
| Tools and MCP | `tools/`, `mcp/` | Canonical tool and MCP config, resolution, wire models, and errors. |

The service imports this package. The SDK must not import the service.

## Core Ports

### Backend

A `Backend` is the engine. It declares `supported_harnesses`, creates sandboxes, and opens
sessions. It does not know how Pi or Claude wants tools shaped.

Current backends:

- `SandboxAgentBackend`: implemented, supports `pi`, `claude`, and `agenta`, local or Daytona.
  This is the backend the deployed service always uses (`services/oss/src/agent/app.py`).
- `LocalBackend`: planned, public class exists, methods raise.

The sidecar's in-process `pi` engine (`engines/pi.ts`) is still reachable with `backend: "pi"`,
but the SDK no longer ships a backend adapter for it; a test-only helper drives it in the
transport round-trip test.

### Environment

`Environment` wraps a backend and owns sandbox policy. The default is one sandbox per
session. That is the cold isolation model.

### Harness

A `Harness` wraps an environment for one harness type. It validates that the backend can
drive it, maps `SessionConfig` into a harness-specific config, provisions files, and runs a
turn.

Current harnesses:

- `PiHarness` keeps built-in tool names, resolved tool specs, Pi prompt overrides (`system`
  and `append_system` from `harness_options.pi`), and Pi native tool delivery.
- `ClaudeHarness` drops Pi built-ins, carries MCP-delivered specs, and carries the
  permission policy.
- `AgentaHarness` is Pi with forced Agenta policy layered on top: a base AGENTS.md preamble,
  a forced persona, forced tools, and forced skills (`adapters/agenta_builtins.py`). It runs
  on `SandboxAgentBackend`.

### Session

`Session` represents one conversation from the SDK point of view. Today it is a cold
wrapper around one `/run` call. It exposes both:

- `prompt(...)`: one-shot path returning `AgentResult`.
- `stream(...)`: live path returning `AgentRun`.

`AgentRun` yields live `AgentEvent` objects and exposes the terminal `AgentResult` after
the stream drains.

### Session persistence

There is no durable-history port. The runtime is cold: the client sends the full
conversation on every turn. Server-owned session history is not implemented, so completed
turns are not persisted and there is no load path.

A future port for harness session snapshots is still open. Durable message history could
reload a transcript, but it cannot necessarily restore sandbox-agent/ACP session state,
tool state, or setup artifacts. That port should be designed after we inspect the actual
session representation and storage size.

## Config Ownership

`AgentConfig` describes the agent itself: instructions, model, tool references, MCP server
config, and per-harness option bags. It does not choose a backend.

`RunSelection` describes runtime choices: harness, sandbox, and permission policy.

This is the current POC shape. The long-term split should be stricter:

- Generic agent identity: `AGENTS.md`, skills, tool references, and metadata.
- Harness-specific config: harness id, model, option bags, and harness-specific
  permissions.
- Runtime infrastructure: local versus Daytona, runner sidecar URL, filesystem isolation,
  and secret channels.

Sandbox is currently selectable through `RunSelection` so the POC can exercise local and
Daytona paths. It should not become durable agent template identity unless product
requirements explicitly need portable per-template runtime selection.

`SessionConfig` describes one run: the neutral agent config plus resolved secrets, resolved
tools, resolved MCP servers, trace context, and the session id.

## Service Composition

`services/oss/src/agent/app.py` is a thin consumer of the SDK ports:

1. Parse `AgentConfig` and `RunSelection`.
2. Resolve provider secrets.
3. Resolve tools and, when enabled, MCP servers.
4. Build `SessionConfig`.
5. Build the backend. The service always builds `SandboxAgentBackend`, passing the run's
   sandbox (`local` or `daytona`) and the runner transport. It does not branch on harness.
6. Build the harness over an `Environment` wrapping that backend. The harness validates that
   the backend supports it.
7. Run `prompt` or `stream`.

Tool and MCP resolution are split cleanly:

- The SDK owns canonical models, parsing, local secret provider interfaces, and generic
  resolver behavior.
- The service owns Agenta-specific HTTP adapters for gateway tools and vault secrets.
- The TypeScript runner owns actual execution for callback, code, and MCP-delivered tools.

## Browser Protocol Adapter

The Vercel adapter is not part of the generic workflow route. It is registered only for
agent routes and lives in `sdks/python/agenta/sdk/agents/adapters/vercel/`.

It owns:

- Vercel `UIMessage` to neutral `Message` conversion.
- `session_id` validation and minting.
- `/messages` stream negotiation.
- Vercel stream-part encoding.

This keeps Vercel-specific names out of the runtime ports.

## The `/run` Boundary

Runner-backed backends send the same `/run` wire shape whether they use HTTP or spawn the
CLI. The Python and TypeScript sides intentionally duplicate the contract:

- Python: `sdks/python/agenta/sdk/agents/utils/wire.py`
- TypeScript: `services/agent/src/protocol.ts`

Golden tests pin this boundary. Any change to request fields, event kinds, capabilities, or
result fields should update both sides and the wire tests in the same PR.

## Known Weak Points

- `LocalBackend` appears in public exports but is not usable yet.
- Session history is not persisted: the runtime is cold and completed `/messages` turns are
  not stored.
- `AgentaHarness` policy content is placeholder product copy.
- MCP server resolution is disabled unless `AGENTA_AGENT_ENABLE_MCP` is truthy.
- The code still has historical WP labels in some comments. Those labels should not guide new
  design decisions.
