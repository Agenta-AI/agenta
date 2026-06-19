# Plan: settled decisions and phased direction

The reviewer settled the four open decisions on 2026-06-19. This page records the answers,
then the phases that follow from them. Where a decision changed the prior framing, the
change is called out so the research and status pages stay consistent.

## Settled decisions

### Decision 1: Where does resolution live? Settled: split by tool kind.

Resolution splits on the executor `type` (`sdks/python/agenta/sdk/agents/tool_defs.py`).
Only one kind needs Agenta. The rest resolve locally.

- **`gateway` (Composio) stays in the backend.** Resolving a gateway tool validates a
  Composio connection and holds the provider key and OAuth, so it cannot move to the SDK.
  The call routes back through `/tools/call` and the key never leaves the server. This is the
  tool kind a user sometimes calls "the built-in Agenta tool," but in the taxonomy it is
  `gateway`, not `builtin`.
- **`builtin`, `code`, `client`, and MCP resolve locally.** A `builtin` is just a name. A
  `code` tool's spec is built from local data. A `client` tool is name plus schema. None of
  them needs Agenta to resolve. MCP is local too, but it ships later (Decision 2).

So we build both shapes behind one interface:

- An offline **`LocalToolResolver`** (the default) resolves `builtin` + `code` + `client`
  (and MCP later) from local data, with no network call.
- An opt-in **`AgentaToolResolver`** resolves `gateway` by posting refs to the Agenta public
  API. A user who needs a gateway tool opts into this and accepts the network call.

A user with only built-in and code tools stays fully offline. The goal the reviewer set is
plain: you should be able to run everything except gateway without Agenta, using your own
secrets.

One caveat on `client` tools. They resolve locally, but a headless standalone run has no
browser to fulfil them, and the in-process Pi engine skips them
(`services/agent/src/engines/pi.ts:165`). They are locally resolvable, not locally runnable,
unless the user supplies a fulfiller. We document this as a limitation, not a blocker.

**Dependency direction is fixed regardless: `service -> SDK`, never the reverse.** The
service already imports the SDK's tool vocabulary
(`services/oss/src/agent/tools.py:23`). When spec-building logic moves into the SDK, the
service consumes it. The sibling effort locks the same rule
([`../scratch/sdk-local-backend/status.md`](../scratch/sdk-local-backend/status.md),
"Dependency direction").

### Decision 2: How do code and MCP executors run locally? Settled: code reuses the Pi engine; MCP is out of scope, wired but flag-gated off.

`LocalBackend`'s Pi path is the bundled in-process Pi engine, which already executes `code`
and `callback` tools (`services/agent/src/engines/pi.ts:144`). So code execution needs no new
executor under Pi. It needs the bundle the sibling effort ships, plus a correctly filled code
spec from the resolver.

MCP is out of scope for the first releases. We keep the functions and flows in place (parse,
the `mcp_servers` field on `SessionConfig`, a resolver path) but keep them a no-op behind a
feature flag that defaults to off, for both Pi and Claude. This matches the code today: the
in-process Pi engine already hard-codes `mcpTools: false`
(`services/agent/src/engines/pi.ts:58`), so Pi is already a no-op for MCP. The flag
formalizes that and gives Claude the same off-by-default treatment. The business logic stays
dormant behind the flag until a later phase turns it on.

### Decision 3: How are secrets supplied locally? Settled: env by default, behind a pluggable `SecretResolver`. The vault is a later, connected path.

First, the secret model, because the prior framing called part of this a bug and it is not.

Secrets live in the project vault. One table, one CRUD stack
(`POST/GET/PUT/DELETE /secrets` under `/vault/v1`), encrypted at rest. A secret's `kind`
decides how it behaves at run time. Two kinds matter here:

- **`provider_key`**: a provider-indexed LLM credential. `data` is
  `{kind: "openai", provider: {key: "..."}}`, where the inner `kind` is a fixed provider
  enum. It is consumed today by `get_user_llm_providers_secrets()`
  (`api/oss/src/core/secrets/utils.py:54`), which maps each provider to a fixed env var
  (`openai -> OPENAI_API_KEY`). The user never names these. The identity is the provider.
- **`custom_secret`**: a free-text `name -> value` entry. `header.name` is the user-chosen
  name (for example `GITHUB_TOKEN`); `data` is `{secret: {key: "..."}}`, with no provider
  enum. It is storage-only this iteration by design. Nothing reads it, there is no env-var
  mapping, and it is not injected into completions or the agent runtime.

Same endpoint, same table, same encryption and CRUD. The only difference is the `kind` and
what consumes the value.

Now the problem this effort must solve. A `code` tool names the secrets it needs
(`secrets: ["GITHUB_TOKEN"]`), and an MCP server names an env-var-to-secret-name map. The
config stores only the name, never the value. At run time something must turn the name into a
value and inject it as an env var into the sandbox subprocess (code) or the server process
(MCP). On the Agenta server path that consumer would read the `custom_secret` rows by name,
but it is not built yet, because `custom_secret` is storage-only this iteration. So
`resolve_named_secrets` (`services/oss/src/agent/secrets.py:75`) anticipates a consumer that
does not exist; until it does, declared custom secrets resolve to `{}` and the tool runs
without those env vars. This is the expected current state given the storage-only design, not
a bug to fix in this effort.

For a standalone run we do not want to depend on the vault at all. The SDK has no secret
resolution of any kind today. So a standalone agent has no way to supply `GITHUB_TOKEN` to
its code tool. The settled answer:

- **Env is the offline default.** A code tool's declared secret name reads from the process
  environment. `GITHUB_TOKEN` comes from `os.environ`. This is what "use your own secrets and
  run" means.
- **A pluggable `SecretResolver` is the interface env plugs into.** The user can back it with
  a `.env` file, a secret manager, or their own vault. Env is just the built-in default
  implementation. We ship the interface in the first slice.
- **The Agenta vault over HTTP is a later, connected path.** It reads `custom_secret` rows by
  name and depends on the future consumer endpoint being built. That work is tracked as an
  open issue ([../open-issues.md](../open-issues.md)) and is tied to the named-secrets effort
  (`docs/design/vault-named-secrets/`).

### Decision 4: What is the minimum first slice? Settled: `LocalBackend` (Pi) + built-in + code + env secrets, offline.

A standalone agent that reads files, runs bash, and runs its own code tools, with zero Agenta
calls. It excludes gateway (server-bound), client (needs a browser), and MCP (flag-gated
off). This implies building the `LocalBackend` Pi path, which the sibling effort owns as its
Phase 0.

## Phased direction

The phases assume the settled decisions above.

### Phase 0 (prerequisite, owned elsewhere): `LocalBackend` runs a tool-free agent

`LocalBackend` is a stub that raises (`sdks/python/agenta/sdk/agents/adapters/local.py:30`).
The sibling effort ([`../scratch/sdk-local-backend/status.md`](../scratch/sdk-local-backend/status.md))
must ship at least the Pi path (the bundled JS runner) before any tool work runs end to end.

### Phase 1: built-in tools, offline

The smallest real step. Built-in tools are just names that run in-harness
(`services/oss/src/agent/tools.py:183`). A standalone user lists built-in names on the
`AgentConfig`, and the harness runs them. This is mostly a wiring check that the names flow
onto `SessionConfig.builtin_tools` under `LocalBackend`.

### Phase 2: a local tool resolver, code tools, env secrets

Build the `LocalToolResolver`. It reuses the per-kind spec builders that
`services/oss/src/agent/tools.py` already has (`_resolve_code` at `:127`, `_client_spec` at
`:153`), moved into the SDK so the service and the standalone user call the same code, with
the dependency pointing `service -> SDK`. Add a `SecretResolver` with an env default. At the
end of this phase a standalone agent runs its code tools offline, because the in-process Pi
engine already executes them (`services/agent/src/engines/pi.ts:169`).

This is the first slice with real value. It is the phase to aim the first PR at.

### Phase 3: opt-in Agenta-backed resolver for gateway tools

Add `AgentaToolResolver`. It posts gateway refs to the Agenta public API and wires the
`/tools/call` callback, exactly as `_resolve_gateway` (`services/oss/src/agent/tools.py:67`)
does, but driven from the SDK. This is opt-in and network-gated, and it keeps the Composio key
server-side. It is connected-standalone: no sidecar, but a real Agenta API call. Client tools
surface here as a documented limitation (no browser to fulfil them in a headless local run).

### Phase 4: land the vault consumer for named secrets

Add the runtime consumer that resolves `custom_secret` rows by name, so the connected
resolver can read the vault and the server path stops resolving declared secrets to `{}`.
This is co-owned with the named-secrets effort (`docs/design/vault-named-secrets/`), whose
current iteration is storage-only by design. Tracked in
[../open-issues.md](../open-issues.md).

### Phase 5: MCP, and Claude locally

The last and least certain. Turning on local MCP needs an executor the in-process Pi engine
does not have (`services/agent/src/engines/pi.ts:58`); it stays flag-gated off until then.
Claude locally needs the `claude-agent-sdk` path the sibling effort owns, plus MCP-style tool
delivery on top. Both are real work and neither blocks the value in phases 1 and 2.

## Phase summary

| Phase | Delivers | Network | Blocked on |
| --- | --- | --- | --- |
| 0 | tool-free local Pi run | none | sibling effort (`LocalBackend`) |
| 1 | built-in tools | none | Phase 0 |
| 2 | code tools + env secrets | none | Phase 1; `LocalToolResolver`, `SecretResolver` |
| 3 | gateway tools (opt-in) | Agenta API | Phase 2; `AgentaToolResolver` |
| 4 | vault named-secret consumer | Agenta API | API work; named-secrets coordination |
| 5 | MCP + Claude locally | varies | Phases 2-4; new executor, MCP flag flipped on |
