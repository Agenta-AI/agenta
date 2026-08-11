# Status

The source of truth for this effort. Update this page as the work moves.

## Where this stands (2026-06-19)

**Stage: organization refactor implemented and review findings resolved.** The SDK tool
runtime now uses `agenta.sdk.agents.tools`; MCP is a sibling `agenta.sdk.agents.mcp`
subsystem; the service owns HTTP/vault adapters under `services/oss/src/agent/tools/`.
Persisted discriminator values remain unchanged. The former flat `tool_defs.py` and
`tool_resolution.py` modules were removed because this API had not shipped; legacy persisted
configuration shapes are handled only at the explicit compatibility boundary in
`agents/tools/compat.py`.

The prerequisite is also not done: `LocalBackend` is a stub that raises
(`sdks/python/agenta/sdk/agents/adapters/local.py:30`). The sibling effort owns it
([`../trash/sdk-local-backend/status.md`](../trash/sdk-local-backend/status.md)).

## Organization review (2026-06-19)

- Canonical declarations use `*Config`; runnable values use `*Spec`.
- Strict parsing and legacy compatibility are separate.
- Missing secrets, unsupported providers, duplicate names, and invalid gateway responses use
  typed errors.
- API core reuses SDK-owned neutral tool config classes.
- Gateway metadata correlation uses `call_ref`, not response position.
- Pre-stream `/messages` failures preserve JSON error responses.
- TypeScript files are named `callback.ts` and `dispatch.ts`.

## Behavior decisions retained (2026-06-19)

The earlier review settled these product and dependency decisions. They remain useful, but
class names such as `LocalToolResolver` and `SecretResolver` below are historical placeholders;
the organization proposal recommends better public names.

1. **Where resolution lives.** Both, behind one interface: an offline `LocalToolResolver`
   (built-in, code, client, MCP later) and an opt-in `AgentaToolResolver` for gateway.
   Gateway is the only kind that stays in the backend. Dependency direction `service -> SDK`.
2. **Code and MCP executors.** Code reuses the bundled in-process Pi engine. MCP is out of
   scope for the first releases: wired but a no-op behind a feature flag that defaults to off,
   for both Pi and Claude.
3. **Secrets.** Env by default, behind a pluggable `SecretResolver`. The vault is a later,
   connected path that reads `custom_secret` rows by name once the consumer is built
   ([open-issues.md](../open-issues.md)). Custom secrets are storage-only today by design.
4. **First slice.** `LocalBackend` (Pi) + built-in + code + env secrets, offline.

## Validation

- SDK agent/routing tests: 146 passed.
- Service agent tests: 34 passed.
- API unit tests: 859 passed.
- TypeScript tool tests: 3 passed.
- TypeScript extension bundle: built successfully.

## Remaining prerequisite

`LocalBackend` is still a separate prerequisite. End-to-end standalone execution remains
blocked on that sibling effort, not on tool organization or resolution.

## Key files (the map for whoever continues)

**SDK (where the new work lands):**
- `sdks/python/agenta/sdk/agents/tools/`: tool configuration, runtime specs, parsing,
  compatibility conversion, resolution, wire serialization, and errors.
- `sdks/python/agenta/sdk/agents/mcp/`: the sibling MCP configuration and resolution domain.
- `sdks/python/agenta/sdk/agents/dtos.py`: `SessionConfig` and its tool fields (the delivery
  contract, `:498`).
- `sdks/python/agenta/sdk/agents/adapters/harnesses.py`: the harness adapters that shape
  already-resolved specs (`:65`).
- `sdks/python/agenta/sdk/agents/adapters/local.py`: `LocalBackend`, the stub
  (`:24`, prerequisite).

**Service (the reference resolver to share from, never to depend back on):**
- `services/oss/src/agent/tools/resolver.py`: service composition of SDK tool and MCP
  resolvers.
- `services/oss/src/agent/tools/gateway.py`: Agenta gateway HTTP adapter.
- `services/oss/src/agent/tools/secrets.py`: named-secret HTTP adapter for tools and MCP.
- `services/oss/src/agent/secrets.py`: provider-key resolution for harness authentication.
- `services/oss/src/agent/app.py`: where the service builds `SessionConfig` (`:91`).

**Runner (execution; already handles code/callback in-process):**
- `services/agent/src/engines/pi.ts`: the in-process Pi engine, `mcpTools: false` (`:58`),
  branches on tool `kind` (`:144`).
- `services/agent/src/tools/code.ts`, `dispatch.ts`, `callback.ts`, `mcp-server.ts`: the
  executors and callback adapter.

**API (the future named-secret consumer):**
- `api/oss/src/apis/fastapi/vault/router.py`: CRUD only, no name-based resolve route yet
  (lines 36 to 74).
- `docs/design/vault-named-secrets/context.md`: the named-secrets effort,
  runtime-consumption out of scope this iteration (`:23`).

## Known traps

- **The vault named-secret consumer is not built.** Declared code/MCP custom secrets resolve
  to `{}` today, server path included. This is the storage-only design this iteration, not a
  bug (research.md, stage 3). The offline slice supplies secrets from env via `SecretResolver`
  instead of the vault.
- **The in-process Pi engine has no MCP.** Do not assume bundling the Pi runner brings MCP;
  it does not (`services/agent/src/engines/pi.ts:58`).
- **Client tools need a browser.** A headless local run cannot fulfil them; the in-process Pi
  engine skips them (`services/agent/src/engines/pi.ts:165`).
- **Dependency direction.** The SDK must never call the service. Share spec-building logic by
  moving it into the SDK, not by importing the service from the SDK.
