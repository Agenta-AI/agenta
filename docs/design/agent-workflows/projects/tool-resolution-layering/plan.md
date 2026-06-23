# Tool & secret resolution: the SDK / service / backend responsibility split

Status: v2, decisions folded in (2026-06-23). Branch: `feat/agent-service` (PR #4772).
v1 was the open-questions draft; this version records the decisions from the review with
Codex and the author's comments, so the open list is now small.

## What we want to change

Two related problems:

1. **Resolution lives in the service, not the SDK.** Today the Agenta service resolves
   gateway tools and secrets. The next consumer is an SDK user running a local backend (Pi or
   Claude on their machine). They need the same gateway-tool and secret resolution. So the
   resolution code must live in the SDK and be imported by the service, not the reverse.

2. **The layer boundaries are unclear.** We want a clean split:
   - The SDK / agent-to-service boundary **resolves information**. It turns neutral tool
     declarations into runnable tool specs and turns secret names into values, then hands
     those to the backend.
   - The backend **decides how to execute**: whether a tool becomes an HTTP callback, a file
     written into a sandbox, or something run in the cloud. That is a backend concern, not a
     resolver concern.

   Example: a local backend running Pi has no callbacks for code tools. A code tool gets
   written as a file in a folder Pi can run, or shipped to the cloud and handled there.
   Whether to use callbacks at all is the backend's call. The resolver just provides the
   resolved tool and its secrets.

## What the code looks like today (grounded)

Most of the resolution machinery is already in the SDK. The split that remains is small.

### Already in the SDK (`sdks/python/agenta/sdk/agents/`)

- **Config + spec models**, `tools/models.py`: `ToolConfig` (builtin/gateway/code/client),
  `ToolSpec` (`CallbackToolSpec`/`CodeToolSpec`/`ClientToolSpec`), `ResolvedToolSet`,
  `ToolCallback`, `GatewayToolResolution`.
- **The orchestrator**, `tools/resolver.py`: `ToolResolver` splits configs by type, resolves
  code-tool secrets through an injected `ToolSecretProvider`, builds code/client specs, and
  delegates gateway configs to an injected `GatewayToolResolver`. Default
  `EnvironmentToolSecretProvider` reads the process env (the offline default).
- **The ports**, `tools/interfaces.py`: `ToolSecretProvider.get_many(names)` and
  `GatewayToolResolver.resolve(tools)` (both Protocols).
- **MCP resolution**, `mcp/` (`MCPResolver`, `parse_mcp_server_configs`, `ResolvedMCPServer`).
- **The session/backend contracts**, `dtos.py` (`SessionConfig`, `HarnessAgentConfig`,
  `PiAgentConfig`/`ClaudeAgentConfig`/`AgentaAgentConfig`), `interfaces.py` (`Backend`,
  `Environment`, `Harness`, `Session`), harness adapters in `adapters/harnesses.py`.
- **The local backend seam**, `adapters/local.py`: `LocalBackend` exists but its methods
  raise `NotImplementedError` (Phase 3/4 work, out of scope here).

### Still in the service (`services/oss/src/agent/`), the platform-backed implementations

- `client.py`: `agenta_api_base()` + `request_authorization()` + `TOOLS_TIMEOUT`. Derives the
  base URL from `ag.tracing.otlp_url` (or env) and the auth from the tracing-propagation
  `inject({})` (or `AGENTA_API_KEY`).
- `tools/gateway.py`: `AgentaGatewayToolResolver`, the `GatewayToolResolver` impl that POSTs
  `/tools/resolve` and builds a `ToolCallback(endpoint=".../tools/call", auth)`.
- `tools/secrets.py`: `VaultToolSecretProvider` + `resolve_named_secrets`, the
  `ToolSecretProvider` impl that POSTs `/secrets/resolve`.
- `secrets.py`: `resolve_harness_secrets()`, which GETs `/secrets/` and maps `provider_key`
  vault entries to harness env vars (`OPENAI_API_KEY`, ...). This is the harness/model secret
  path (LLM provider keys), distinct from the tool/named-secret path above.
- `tools/resolver.py`: `resolve_agent_resources()`, the composition that wires the SDK
  `ToolResolver` + `MCPResolver` to the service providers, with the MCP flag gate
  (`AGENTA_AGENT_ENABLE_MCP`).

### Facts that shaped the plan

- **`client.py` already uses only SDK primitives** (otlp/env base URL, propagation/env auth),
  so moving the platform-backed resolvers into the SDK is mostly relocation.
- **The SDK already has a vault + API-client convention.** `middlewares/running/vault.py`
  fetches `/secrets/` provider keys (with caching, local-env keys, permission checks),
  sourcing the host from the singleton `api_url` and the credential from
  `RunningContext.credentials`. The agent service re-implements the same fetch by hand. There
  is a canonical pattern to align on, which answers the `gateway.py:54` "right patterns?"
  comment.
- **Named-secret resolution (`/secrets/resolve`) does not exist yet in the API.** We treat it
  as in-flight: the PSE-backed endpoint is being built per the vault-named-secrets design, so
  this plan assumes it exists and ships a real named-secret provider, not a no-op.
- **`ToolCallback` is currently runner wire transport.** The gateway resolver builds it,
  `ToolResolver` copies it into `ResolvedToolSet`, and Pi/Claude serialize it straight into
  the `/run` payload (`dtos.py` `wire_tools`). See the D2 decision for why we keep it there
  anyway.

## The credential rule (load-bearing, drives D4)

The Agenta service is one process serving many users with different projects, credentials,
and trace endpoints. So **per-user authorization can never come from a process-global** such
as `ag.DEFAULT_AGENTA_SINGLETON_INSTANCE`. A pure-singleton approach would leak one user's
auth into another's request.

The working split, already used by `vault.py`:

- **Base URL / host** comes from the singleton (or env). It is the same backend for everyone,
  so a global is correct.
- **The caller's credential** comes from per-request context: `RunningContext.credentials`,
  or the tracing-propagation `inject()` the agent uses today. Both are per-request, so each
  call carries its own auth.

This is the invariant the whole relocation must preserve. Before we rely on
`RunningContext`, we must confirm it is populated on the agent `/invoke` and `/messages`
routes (Codex traced that both call `wf.invoke(..., credentials=...)`, but the current
`secrets.py` docstring claims context does not reach the route). That confirmation is a
required route-level test, not an assumption (Phase E).

## Target architecture: two responsibilities

### Responsibility 1: Resolution (the SDK / boundary owns this)

Turn a neutral `AgentConfig` (tool declarations + secret names + MCP servers) into resolved,
runnable specs and secret values. It calls the Agenta platform when needed (`/tools/resolve`,
`/secrets/resolve`, `/secrets/`). It lives in the SDK so the service and a local-backend SDK
user run the same code.

Exposed as **three separate entrypoints** (no aggregate):

- `resolve_tools(tools)`: builtin names, code specs, client specs, and gateway callback specs.
  Code-tool named secrets are resolved inside this call via the injected `ToolSecretProvider`.
- `resolve_mcp(mcp_servers)`: resolved MCP servers. MCP named secrets are resolved inside this
  call via the same `ToolSecretProvider`. The SDK entrypoint is ungated; the
  `AGENTA_AGENT_ENABLE_MCP` deployment gate is applied service-side (the service's
  `resolve_mcp_servers` wrapper returns `[]` when disabled), since the flag is a service
  deployment concern, not an SDK one.
- `resolve_secrets()`: the harness/model provider keys, mapped to env vars. Optional by
  design (see D6).

### Responsibility 2: Execution wiring (the backend owns this)

Given the resolved specs, each backend decides how its runtime executes each tool:

- sandbox-agent backend (remote runner): gateway tools call back to `/tools/call`; code tools
  ship to the runner.
- local Pi backend: code tools are written as files Pi runs; gateway tools still call back to
  the platform when the env is connected (offline gateway is not possible, D1).
- a future cloud path: whatever that backend needs.

Gateway tools are intrinsically platform-executed: any backend that runs them calls
`/tools/call`. The "callback vs file" choice is real only for code tools, which already do
not use a callback. So this boundary is mostly already honored; the work is to make it
explicit and fix the one wire-contract bug (D2).

## The plan (phased)

A and B are pure relocation, behavior-preserving, shippable with no flag. C rewires the
service onto the new entrypoints. D, E, F are boundary cleanup and the leftover comments.

### Phase A: a `PlatformConnection` in the SDK
Create `agents/platform/` and move `client.py` there as an injected `PlatformConnection`
object (base URL + auth + timeout), not ambient globals. Resolution precedence: an explicit
connection, then per-request context (`RunningContext` / propagation), then the host fallback.
Per-user auth never from a global (the credential rule above). Access the singleton lazily, at
call time, never at import time (avoids the `agenta` import cycle). *Risk: low. Tests: both
credential sources plus a multi-user isolation test.*

### Phase B: move the platform-backed resolvers into `agents/platform/`
- `AgentaGatewayToolResolver` (from `tools/gateway.py`), implementing `GatewayToolResolver`.
- The named-secret provider (from `tools/secrets.py`), implementing `ToolSecretProvider`,
  backed by the PSE `/secrets/resolve` endpoint (assumed to exist).
- The provider-key fetch (from `secrets.py`), shared with `vault.py` so there is one client,
  one cache, one parser. Provider keys stay optional (D6).

All depend on the Phase A connection. The service deletes its copies and imports from the SDK.
*Risk: low to moderate. Tests: SDK unit tests with httpx mocked; existing service tests stay
green.*

### Phase C: expose the three entrypoints and rewire the service
Replace `resolve_agent_resources` with `resolve_tools` / `resolve_mcp` / `resolve_secrets` in
the SDK. The service `app.py` calls the three directly when building `SessionConfig`. The
service `tools/` package shrinks to nothing or thin re-exports. *Risk: moderate (touches
app.py wiring). Tests: golden wire-contract stays byte-identical.*

### Phase D: make the boundary explicit, fix the wire invariant
State and enforce the contract: resolution returns execution-neutral specs; the backend
assembles transport. **Keep `ToolCallback` in the gateway resolver** (D2): the gateway
callback endpoint is always the platform's `/tools/call`, intrinsic to a gateway tool, so
there is only one possible transport and no real choice to defer. Document code-tool delivery
(file vs callback) as the backend's choice. **Narrow the runner wire invariant**: change
`toolCallback` from "required when `customTools` is set" to "required only when a gateway
(callback) spec is present" (`services/agent/src/protocol.ts`), since code tools run without
`/tools/call`. *Risk: low.*

### Phase E: close the harness-secret duplication
Add a route-level test that proves `RunningContext.credentials` is populated on `/invoke` and
`/messages`. If it is, drop the hand-rolled re-fetch and read from context like other workflow
services, and correct the stale `secrets.py` docstring. If it is not, both paths share the one
SDK provider-key helper from Phase B. *Risk: gated on the test.*

### Phase F: the leftover architecture comments
- `app.py:100` (prompt vs stream asymmetry): unify so both paths own setup/cleanup the same
  way (the batch path collects from the same helper the stream path uses).
- `app.py:136` ("feels outdated"): verify the `agenta:builtin:agent:v0` "future work" note
  against the catalog-type work that landed; update or delete.
- `gateway.py:54` ("right patterns?"): resolved by A and B (align on the SDK client/vault
  convention).

## Decisions (resolved)

- **D1: local + gateway.** Gateway tools (Composio) require Agenta and only work connected.
  Code and builtin tools do not need Agenta. Offline gateway fails clearly rather than
  silently skipping. Local backend therefore has two documented modes: offline (builtin +
  code) and connected (adds gateway).
- **D2: callback assembly.** Keep it simple: the resolver builds the gateway `ToolCallback`.
  The endpoint is intrinsic to gateway tools, so there is nothing for the backend to decide.
  The only concrete fix is narrowing the runner wire invariant (Phase D).
- **D3: where resolution runs.** Explicit caller call. No hidden harness or environment magic.
  The service and local paths call the same functions.
- **D4: credential/host source of truth.** Host from the singleton or env (global, shared);
  per-user auth from per-request context (`RunningContext` / propagation), never from a
  global. Precedence: explicit connection, then request context, then host fallback. Verified
  by the Phase E route test.
- **D5: package layout.** Three separate resolvers, each in its own place, no aggregate. Pure
  models, ports, and the `ToolResolver` framework stay in `agents/tools`. The Agenta-platform
  HTTP adapters move to a new `agents/platform`. MCP stays in `agents/mcp`.
- **D6: provider keys are optional.** A user may run their own sidecar with a self-managed
  Codex or Claude Code subscription, so model auth does not always come from the vault.
  `resolve_secrets` fills provider keys when the vault has them and returns empty when it does
  not, and the harness falls back to its own login or OAuth. Provider-key fetching is shared
  with `vault.py` (one cache/parser). Tests must cover both paths: vault-provided keys, and
  the self-managed-subscription case where no key is injected.

## How this maps to the review comments

| Comment | Where it lands |
|---|---|
| `resolver.py:39` resolution should be in the SDK | Phases A to C |
| `resolver.py:75` MCP mixed in / wrong place | Phase C + D5 (separate `resolve_mcp`, flag-gated) |
| `gateway.py:54` right API patterns? | Phases A and B (align on the SDK client/vault convention) |
| `app.py:100` ugly prompt/stream split | Phase F |
| `app.py:136` feels outdated | Phase F |

## Non-goals

- Implementing `LocalBackend.create_session` (Phase 3/4 runner-delivery work). This plan makes
  resolution available to it, not the backend itself.
- Offline gateway-tool execution (D1).
- Changing the wire protocol beyond narrowing the `toolCallback` invariant (Phase D).

## Test & rollout

- SDK unit tests for each relocated piece (httpx mocked), mirroring the existing service tests.
  Run via `uv run python -m pytest ... -n0`.
- A multi-user isolation test for `PlatformConnection` (two callers, two credentials, no
  bleed).
- A route-level test for `RunningContext.credentials` on `/invoke` and `/messages` (gates
  Phase E).
- Provider-key tests for both the vault path and the self-managed-subscription path (D6).
- Keep the golden wire-contract test byte-identical through A to C (pure relocation).
- Land A and B first (behavior-preserving), then C, then D to F.
