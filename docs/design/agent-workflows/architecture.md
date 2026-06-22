# Architecture

This page explains how the active-stack agent workflow runs. It describes the code carried
by the sibling implementation PRs, not only the docs PR commit and not the older
work-package plans in [trash/](trash/).

## The Model

Agenta already runs prompt workflows that call a model once and return one answer. An
agent workflow runs a coding harness instead. The harness reads instructions, calls a
model, calls tools, observes the results, and loops until it has an answer.

The implementation keeps two choices configurable:

- **Harness:** which agent runs. Supported values are `pi`, `claude`, and experimental
  `agenta`.
- **Sandbox:** where the run happens. Supported values are `local` and `daytona` on the
  sandbox-agent path. The in-process Pi path is local only.

The platform still exposes the agent through normal workflow routing. `/invoke` remains the
batch contract. Agent routes also register `/messages` and `/load-session` for the browser
chat protocol.

## Runtime Shape

The deployed local stack uses two containers.

```
browser / playground
    |
    | POST /invoke or POST /messages
    v
services container
    Python workflow handler
    services/oss/src/agent/app.py
    |
    | POST /run, or spawn the runner CLI in local checkout mode
    v
agent runner sidecar
    compose service: sandbox-agent
    Node HTTP server
    services/agent/src/server.ts
    |
    +-- in-process Pi engine
    |   services/agent/src/engines/pi.ts
    |
    +-- sandbox-agent engine
        services/agent/src/engines/sandbox_agent.ts
        |
        +-- sandbox-agent daemon
            |
            +-- ACP adapter: pi-acp or claude-agent-acp
                |
                +-- harness CLI: pi or claude
```

The `services` container owns Agenta concerns: workflow routing, config parsing, provider
secret resolution, tool resolution, and trace context. The agent runner sidecar owns the
agent run: it drives Pi directly or drives a harness over ACP through sandbox-agent. In Docker
Compose this service is still named `sandbox-agent`, and the service reaches it through
`AGENTA_AGENT_RUNNER_URL`.

The sidecar deliberately does not inherit the full stack environment. Provider keys and
tool credentials are resolved by the service and passed only in the scoped run payloads
that need them.

## Backends

The SDK runtime models engines as `Backend` adapters.

| Backend | Status | Harnesses | Sandbox support | Notes |
| --- | --- | --- | --- | --- |
| `InProcessPiBackend` | Implemented | `pi`, `agenta` | `local` only | Drives `services/agent/src/engines/pi.ts`. This is the simple local Pi path. |
| `SandboxAgentBackend` | Implemented | `pi`, `claude` | `local`, `daytona` | Drives `services/agent/src/engines/sandbox_agent.ts`, which starts `sandbox-agent` and an ACP adapter. |
| `LocalBackend` | Not implemented | Intended: `pi`, `claude` | Local machine | Public class exists, but `create_sandbox` and `create_session` raise `NotImplementedError`. |

`services/oss/src/agent/app.py` uses `SandboxAgentBackend` for the deployed service path.
`AGENTA_AGENT_RUNNER_URL` selects the HTTP runner transport when set; otherwise a source
checkout uses the local TypeScript runner CLI. `InProcessPiBackend` remains a local/example
contrast path.

## Harnesses

The SDK runtime models agent-specific behavior as `Harness` adapters.

| Harness | Status | Backend path | Notes |
| --- | --- | --- | --- |
| `PiHarness` | Implemented | In-process Pi or sandbox-agent | Native Pi tools, Pi prompt overrides, Pi tracing extension. |
| `ClaudeHarness` | Implemented | sandbox-agent only | MCP tools, permission policy, runner-built tracing. |
| `AgentaHarness` | Experimental | In-process Pi only | Pi with forced tools, forced skill names, and placeholder Agenta prompt layers. |

`AgentaHarness` with `daytona` or any sandbox-agent path is intentionally unsupported today. It
raises through the normal harness/backend compatibility check instead of silently running
without its forced skills.

## Request Flow

Batch `/invoke` follows this path:

1. The workflow route calls `_agent` in `services/oss/src/agent/app.py`.
2. `_agent` parses `AgentConfig` and `RunSelection` from request parameters.
3. The service resolves provider keys, tools, and MCP servers. MCP resolution is gated by
   `AGENTA_AGENT_ENABLE_MCP`.
4. The service builds `SessionConfig` and creates a harness over an environment and backend.
5. The harness opens a cold session, sends one `/run` request to the TypeScript runner, and
   destroys the session.
6. The service records usage on the workflow span and returns one assistant message.

Agent `/messages` follows the same runtime path after a browser-protocol adapter step:

1. `sdks/python/agenta/sdk/agents/adapters/vercel/routing.py` validates or mints
   `session_id`.
2. It converts Vercel `UIMessage` parts into neutral agent `Message` objects.
3. It sets `data.stream` from the `Accept` header.
4. `_agent` either returns a batch message or streams an `AgentRun`.
5. The Vercel adapter converts live `AgentEvent` objects into Vercel UI Message Stream
   parts and the routing layer frames them as SSE.

`/load-session` is registered for agent routes, but the default store is
`NoopSessionStore`. It returns an empty message list unless a real `SessionStore` is
injected.

## Lifecycle

The runtime is still cold. Each turn creates a fresh session and tears it down after the
turn. Multi-turn context comes from replaying message history, not from a warm daemon or a
persisted model session.

This cold model keeps isolation simple and makes `/invoke` and `/messages` share the same
runtime. It also means durable server-owned history and warm `session/load` are still future
work.

## Active-Stack Gaps

- `LocalBackend` is a public adapter shape but does not run anything yet.
- `/load-session` has the route contract but no default persistent store and no write path
  from completed turns.
- `AgentaHarness` uses placeholder preamble, persona, and skill content.
- `AgentaHarness` is local in-process only.
- Pi system prompt overrides are not delivered on the sandbox-agent ACP path.
- The agent is still registered as a custom workflow handler, not as a first-class builtin
  URI such as `agenta:builtin:agent:v0`.
- Historical work-package labels remain in several sibling code comments. They should be
  cleaned in a documentation and comment hygiene PR.
