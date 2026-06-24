# Agent Workflow Interfaces

The agent workflow stack spans a Python service, a Node runner, a sandboxed harness, a
browser client, the vault, and the trace pipeline. A change in one of these places often
breaks a contract that lives in another. This folder names those contracts so a reviewer
can tell, before reading the diff, which boundary a change touches and what it can break.

Read it as review context, not as a tutorial. The code is still the source of truth. Each
page points at the files that own the contract and says what to check when it moves.

## How the inventory is organized

The split is by blast radius, because blast radius is what decides how careful a review
has to be.

- **[Public edge](public-edge/)** holds the contracts that browser and workflow clients
  depend on. Break one and you break callers you do not control, so these change most
  conservatively.
- **[Cross-service](cross-service/)** holds contracts that cross a process, container, or
  external service boundary. Each side deploys and fails on its own, so a field can change
  on one side and reach an older version on the other.
- **[In-service](in-service/)** holds contracts that stay inside one process or package.
  They are still contracts. They break adapters, tests, and extension points even when no
  wire field changes.

## How to read each page

Every page follows the same shape so you can scan it fast:

- One short statement of what crosses the boundary and why it matters.
- The concrete contract: the real types, fields, and shapes, not a list of names.
- The files that own it.
- What to check when you change it, including the tests that move with it.

## The interfaces at a glance

One row per interface, so a reviewer can find the boundary a diff touches before opening a
page. `Status` is read from each page's prose: **stable** (wired and unlikely to move),
**evolving** (wired but actively changing or only partly enforced), **declared-not-wired**
(the shape exists but nothing applies it yet).

| Interface | Blast radius | Owner file(s) | Status | Tests |
|---|---|---|---|---|
| [`/invoke`](public-edge/workflow-invoke.md) | public | `decorators/routing.py`, `models/workflows.py`, `agent/app.py` | stable | `unit/agent/`, `utils/test_messages_endpoint.py` |
| [`/inspect`](public-edge/workflow-inspect.md) | public | `agent/schemas.py`, `models/workflows.py`, `decorators/routing.py` | stable | `unit/agents/test_dtos_agent_config.py` |
| [`/messages`](public-edge/agent-messages.md) | public | `adapters/vercel/{routing,messages,stream}.py`, `agentRequest.ts` | evolving (create-or-resume not observable until storage lands) | `utils/test_messages_endpoint.py`, `unit/agents/test_ui_messages.py` |
| [Agent config schema](public-edge/agent-config-schema.md) | public | `agent/schemas.py`, `sdk/utils/types.py`, `agents/dtos.py` | stable | `unit/agents/test_dtos_agent_config.py` |
| [`/run`](cross-service/service-to-agent-runner.md) | cross-service (the spine) | `protocol.ts`, `utils/wire.py`, `utils/ts_runner.py`, `server.ts`/`cli.ts` | stable (pinned by golden) | `unit/agents/test_wire_contract.py` + `golden/`, `services/agent/tests/unit/wire-contract.test.ts` |
| [Runner to harness](cross-service/runner-to-harness.md) | cross-service (ACP) | `engines/sandbox_agent.ts` + `sandbox_agent/{run-plan,capabilities,permissions}.ts`, `engines/pi.ts` | evolving | `services/agent/tests/unit/sandbox-agent-*.test.ts` |
| [Runner to MCP server](cross-service/runner-to-mcp-server.md) | cross-service | `agents/mcp/`, `engines/sandbox_agent/mcp.ts`, `tools/{mcp-bridge,mcp-server,relay}.ts` | evolving (stdio wired; remote deferred) | `services/agent/tests/unit/mcp-servers.test.ts` |
| [Runner to tool callback](cross-service/runner-to-tool-callback.md) | cross-service | `tools/{callback,dispatch}.ts`, `apis/fastapi/tools/router.py`, `agent/tools/resolver.py` | stable | `services/agent/tests/unit/{code-tool,extension-tools}.test.ts` |
| [Service and runner trace export](cross-service/service-and-runner-trace-export.md) | cross-service | `agent/tracing.py`, `tracing/otel.ts`, `extensions/agenta.ts` | stable | `services/agent/tests/unit/` |
| [Service to vault and tool providers](cross-service/service-to-vault-and-tool-providers.md) | cross-service (external) | `agent/app.py`, `platform/{resolve,connections}.py`, `agents/capabilities.py`, `tools/router.py` | stable | `unit/agents/connections/`, `unit/agents/platform/`, `unit/agents/tools/` |
| [Agent service handler](in-service/agent-service-handler.md) | in-service | `services/oss/src/agent/app.py` | stable | `services/oss/tests/pytest/unit/agent/` |
| [Neutral runtime DTOs](in-service/neutral-runtime-dtos.md) | in-service | `agents/dtos.py` | stable | `unit/agents/test_dtos_*.py` |
| [Runtime ports](in-service/runtime-ports.md) | in-service | `agents/interfaces.py` | evolving (`SessionStore` noop, `LocalBackend` stub) | `unit/agents/test_environment_lifecycle.py`, `test_harness_adapters.py` |
| [Backend adapter](in-service/backend-adapter.md) | in-service | `agents/adapters/sandbox_agent.py` | stable | `unit/agents/test_runner_adapter_config.py`, `test_environment_lifecycle.py` |
| [Harness adapters](in-service/harness-adapters.md) | in-service | `agents/adapters/harnesses.py`, `agents/dtos.py` | stable | `unit/agents/test_harness_adapters.py`, `test_dtos_harness_configs.py` |
| [Browser protocol adapter](in-service/browser-protocol-adapter.md) | in-service | `agents/adapters/vercel/{routing,messages,stream,sse}.py` | stable | `unit/agents/test_ui_messages.py`, `utils/test_messages_endpoint.py` |
| [Tool models and resolution](in-service/tool-models-and-resolution.md) | in-service | `agents/tools/models.py`, `platform/gateway.py`, `agent/tools/resolver.py` | stable | `unit/agents/tools/` |
| [MCP models and resolution](in-service/mcp-models-and-resolution.md) | in-service | `agents/mcp/{models,resolver,wire}.py` | evolving (stdio wired; remote deferred; resolution feature-gated) | `unit/agents/mcp/` |
| [Model connection resolution](in-service/model-connection-resolution.md) | in-service | `agent/app.py`, `agents/connections/`, `platform/{resolve,connections}.py`, `agents/capabilities.py` | stable | `unit/agents/connections/` |
| [Runner engine internals](in-service/runner-engine-internals.md) | in-service (runner) | `server.ts`, `cli.ts`, `engines/{sandbox_agent,pi}.ts` | stable | `services/agent/tests/unit/{server,cli}.test.ts` |
| [Permission responder](in-service/permission-responder.md) | in-service (runner) | `responder.ts`, `engines/sandbox_agent/permissions.ts` | stable | `services/agent/tests/unit/{responder,sandbox-agent-permissions}.test.ts` |
| [Sandbox permission](in-service/sandbox-permission.md) | in-service (runner) | `agents/dtos.py`, `protocol.ts`, `engines/sandbox_agent/{provider,run-plan}.ts` | evolving (network enforced on Daytona only; local rejected; filesystem nowhere) | `services/agent/tests/unit/{sandbox-agent-provider,sandbox-agent-run-plan}.test.ts` |

Paths are relative to the owner package (`sdks/python/agenta/sdk/`, `services/agent/src/`,
`services/oss/src/`, `api/oss/src/`); test paths are relative to each package's pytest root
unless prefixed. The `/load-session` shell endpoint is intentionally omitted: it is being
removed in a sibling change, so it is not listed here.

## Source of truth

When a field changes, update the owner file, the tests, and the matching page here in the
same PR. A page that has drifted from the code is worse than no page. It reads as
authoritative while it is wrong.
