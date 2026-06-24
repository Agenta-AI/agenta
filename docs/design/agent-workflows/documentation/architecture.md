# Architecture

This page explains how an agent workflow runs today. It describes the code on disk, verified
against the files cited. Where the doc states a future intent, it says so plainly.

## The Model

Agenta already runs prompt workflows that call a model once and return one answer. An agent
workflow runs a coding harness instead. The harness reads instructions, calls a model, calls
tools, observes the results, and loops until it has an answer.

The runtime keeps two run choices configurable
(`sdks/python/agenta/sdk/agents/dtos.py:364`, `RunSelection`):

- **Harness:** which agent runs. Supported values are `pi`, `claude`, and experimental
  `agenta`. Default `pi`.
- **Sandbox:** where the run happens. Supported values are `local` and `daytona`. Default
  `local`.

The platform exposes the agent through normal workflow routing. `/invoke` is the batch
contract. Agent routes also register `/messages` and `/load-session` for the browser chat
protocol.

## Runtime Shape

The deployed stack uses two containers: the Python services container and the Node agent
runner sidecar.

```
browser / playground
    |
    | POST /invoke or POST /messages
    v
services container (Python)
    agent workflow handler
    services/oss/src/agent/app.py
    |
    | POST /run over HTTP (AGENTA_AGENT_RUNNER_URL set)
    | or spawn the runner CLI in a source checkout
    v
agent runner sidecar (Node)
    compose service: sandbox-agent
    HTTP server on :8765
    services/agent/src/server.ts
    |
    +-- pi engine (in-process Pi)
    |   services/agent/src/engines/pi.ts
    |
    +-- sandbox-agent engine (default)
        services/agent/src/engines/sandbox_agent.ts
        |
        +-- sandbox-agent daemon
            |
            +-- ACP adapter: pi or claude
                |
                +-- harness CLI: Pi or Claude Code
```

The services container owns Agenta concerns: workflow routing, config parsing, provider
secret resolution, tool resolution, and trace context. The sidecar owns the agent run. It
drives Pi in-process or drives a harness over ACP through the sandbox-agent daemon. In Docker
Compose the sidecar is named `sandbox-agent`, and the service reaches it through
`AGENTA_AGENT_RUNNER_URL` (`services/oss/src/agent/config.py:46`).

The sidecar does not inherit the full stack environment. The service resolves provider keys
and tool credentials and passes them only in the scoped `/run` payloads that need them.

## What The Deployed Service Actually Runs

The deployed handler always uses `SandboxAgentBackend`. `select_backend` in
`services/oss/src/agent/app.py:49` constructs `SandboxAgentBackend` for every run, regardless
of harness. So `pi`, `claude`, and `agenta` all run through the sandbox-agent daemon over ACP
on the deployed path.

The sidecar still has an in-process `pi` engine (`services/agent/src/engines/pi.ts`): a
`/run` request with `backend: "pi"` runs Pi in-process inside the sidecar without the daemon.
The deployed Python service never sends that. The SDK used to ship an `InProcessPiBackend`
adapter that drove this engine, presented as a "reference backend", but it was a confusing
POC and was removed. A test-only helper
(`sdks/python/oss/tests/pytest/integration/agents/_in_process_backend.py`) still drives the
`pi` engine in the transport round-trip test.

This split matters when reading the code. There are two `pi` paths:

- The `pi` engine in the sidecar (`engines/pi.ts`), reached only with `backend: "pi"`.
- The `pi` harness over the sandbox-agent daemon (`engines/sandbox_agent.ts` with `harness:
  "pi"`), which is what the deployed service sends.

## Backends

The SDK runtime models engines as `Backend` adapters
(`sdks/python/agenta/sdk/agents/interfaces.py:133`).

| Backend | Status | Harnesses | Sandbox support | Notes |
| --- | --- | --- | --- | --- |
| `SandboxAgentBackend` | Implemented | `pi`, `claude`, `agenta` | `local`, `daytona` | The deployed path. Drives `engines/sandbox_agent.ts`: starts the sandbox-agent daemon and an ACP adapter. `supported_harnesses` is `{pi, claude, agenta}` (`adapters/sandbox_agent.py:121`). |
| `LocalBackend` | Not implemented | Intended: `pi`, `claude` | Local machine | Public class exists; `create_sandbox` and `create_session` raise `NotImplementedError` (`adapters/local.py:34`). |

The sidecar's in-process `pi` engine (`engines/pi.ts`) is still reachable with
`backend: "pi"`, but the SDK no longer ships a backend adapter for it. A test-only helper
drives it in the transport round-trip test.

## Harnesses

The SDK runtime models agent-specific behavior as `Harness` adapters
(`sdks/python/agenta/sdk/agents/adapters/harnesses.py`).

| Harness | Status | Where it runs | Notes |
| --- | --- | --- | --- |
| `PiHarness` | Implemented | sandbox-agent (deployed) or in-process Pi | Native Pi tools, Pi prompt overrides, Pi tracing extension. |
| `ClaudeHarness` | Implemented | sandbox-agent only | MCP-delivered tools, permission policy, runner-built tracing. No Pi built-in tools. |
| `AgentaHarness` | Experimental | sandbox-agent (`local` and `daytona`) or in-process Pi | Pi with forced tools, forced skills, a base AGENTS.md preamble, and a persona. The harness maps to the `pi` ACP agent plus forced extras. Content is still placeholder. |

The `agenta` harness runs on the sandbox-agent path. The runner treats it as the `pi` ACP
agent and layers the forced skills and prompt extras on top
(`services/agent/src/engines/sandbox_agent/run-plan.ts:78`). The QA matrix verified it on
sandbox-agent local and Daytona (`projects/qa/findings.md`, F-002). An earlier claim that
`agenta` was in-process-only was stale.

## Request Flow

Batch `/invoke` follows this path:

1. The workflow route calls `_agent` in `services/oss/src/agent/app.py:63`.
2. `_agent` parses `AgentConfig` and `RunSelection` from request parameters.
3. The service resolves three things independently: tools, MCP servers, and provider-key
   secrets. MCP resolution is gated by `AGENTA_AGENT_ENABLE_MCP`
   (`services/oss/src/agent/tools/resolver.py:23`, off by default).
4. The service builds `SessionConfig` and constructs a harness over an `Environment` and
   `SandboxAgentBackend`.
5. The harness opens a cold session, sends one `/run` request to the sidecar, and tears the
   session down.
6. The service records usage on the workflow span and returns one assistant message.

Agent `/messages` follows the same runtime path after a browser-protocol adapter step:

1. `sdks/python/agenta/sdk/agents/adapters/vercel/routing.py` validates or mints `session_id`.
2. It converts Vercel `UIMessage` parts into neutral agent `Message` objects.
3. It sets `data.stream` from the `Accept` header.
4. `_agent` returns a batch message or streams an `AgentRun`.
5. The Vercel adapter converts live `AgentEvent` objects into Vercel UI Message Stream parts
   and the routing layer frames them as SSE.

`/load-session` is registered for agent routes, but no durable store is wired. It returns an
empty message list. See [Sessions](sessions.md).

## Lifecycle

The runtime is cold. Each turn creates a fresh session and tears it down after the turn.
Multi-turn context comes from replaying message history, not from a warm daemon or a persisted
model session. The sandbox-agent engine does keep an in-process `InMemorySessionPersistDriver`
(`services/agent/src/engines/sandbox_agent.ts:150`), but it lives only for the duration of one
`/run` process, so it does not survive across turns.

This cold model keeps isolation simple and lets `/invoke` and `/messages` share one runtime.
It also means durable server-owned history and warm session reload are still future work. See
[Sessions](sessions.md).

## The Sidecar

The sidecar is a standalone Node package under `services/agent/`. It is not part of the `web/`
pnpm workspace. It builds its own Docker image and runs through `tsx` with no app compile step.
The only build is the Pi extension bundle.

The sidecar serves one contract on two entrypoints (`services/agent/README.md`):

- `src/server.ts`: a long-lived HTTP server on `:8765` with `GET /health` and `POST /run`.
  This is the dockerized sidecar the service calls over HTTP.
- `src/cli.ts`: one JSON request on stdin, one result on stdout. The SDK adapters use this
  subprocess transport when `AGENTA_AGENT_RUNNER_URL` is unset (a source checkout).

Both route to an engine by the request's `backend` field. The default is `sandbox-agent`
(`services/agent/src/server.ts:38`).

### Licensing and images

Two image files live under `services/agent/docker/`
(`services/agent/docker/README.md`):

- `Dockerfile`: production. Source baked in, no watcher.
- `Dockerfile.dev`: dev. `tsx watch`, source bind-mounted, hot reload.

The rule that shapes every image: ship build recipes, not Claude-containing images, and never
bake a credential into any image.

- Pi (`@earendil-works/pi-coding-agent`, MIT) is baked via npm dependencies.
- Claude Code is proprietary. It is never baked into an image Agenta builds and distributes.
  The sandbox-agent daemon installs it from Anthropic at runtime over HTTPS, which is why the
  image installs `ca-certificates`.
- No credential is baked. Provider keys arrive as request secrets or `ANTHROPIC_API_KEY` /
  `OPENAI_API_KEY`. OAuth subscription login is a self-host, mount-only opt-in, never for
  multi-tenant serving.

The production image also installs `python3`, because `code` tools with `runtime: "python"`
run in the sidecar by spawning `python3` (`services/agent/docker/Dockerfile:27`).

### Daytona sandbox

For the `daytona` sandbox, the runner starts a remote Daytona VM and pushes the harness login,
the Pi extension, AGENTS.md, skills, and any system-prompt files into it over the Daytona
filesystem API (`services/agent/src/engines/sandbox_agent/daytona.ts`). Agenta ships a build
recipe, not a built snapshot. The operator runs it in their own Daytona account
(`services/agent/sandbox-images/daytona/`). The runner reads `SANDBOX_AGENT_PROVIDER` and the
`SANDBOX_AGENT_DAYTONA_*` env vars to find the snapshot.

## Tracing

When the `/run` request carries a `trace` block, the run is exported to Agenta as
OpenTelemetry spans nested under the caller's `/invoke` span. The Pi path self-instruments via
the bundled Agenta extension. Other harnesses are traced by the runner from the ACP event
stream (`services/agent/src/tracing/otel.ts`). The Python `tracing` module
(`services/oss/src/agent/tracing.py`) fills the `trace` block from the live workflow span and
rolls run usage back onto it.

## Gaps

- `LocalBackend` is a public adapter shape but does not run anything yet.
- No durable session store is wired. `/load-session` returns empty history and completed turns
  are not persisted. See [Sessions](sessions.md).
- `AgentaHarness` uses placeholder preamble, persona, and skill content.
- The agent is registered as a custom workflow handler, not as a first-class builtin URI such
  as `agenta:builtin:agent:v0`. The builtin interface exists in the SDK, but the handler is
  still bound directly (`services/oss/src/agent/app.py:138`).
- Per-request model override is not honored on the Pi-over-sandbox-agent ACP path; pi-acp
  accepts only its default model (`projects/qa/findings.md`, F-007).
- For the full reconciliation of what is wired and what is missing, see
  [Ground Truth](ground-truth.md).
