# Agent-workflows dead-code report

Date: 2026-06-23. Read-only investigation. No code changed.

## Actions taken (2026-06-23, after review)

Mahmoud reviewed this report inline. Done in this pass:

- Deleted: `shutdownTracing` (otel.ts), `is_import_safe` (running/sandbox.py),
  `engines/running/registry.py` (whole file), `tools/wire.py` (`tool_spec_to_wire` /
  `tool_specs_to_wire`, whole file), `parse_tool_configs` (parsing.py),
  `agents/ui_messages.py` (whole file), and `services/oss/src/agent/client.py` (whole file).
  All `__init__` re-exports for these were removed too.
- `InProcessPiBackend`: removed from the public SDK (it was a confusing POC "reference
  backend"). The class moved to a test-only helper
  (`sdks/python/oss/tests/pytest/integration/agents/_in_process_backend.py`) so the transport
  round-trip integration test still runs. Public exports, the two unit tests, and the design
  docs were updated. If you want it gone entirely (dropping that integration test), say so.
- Kept on request: the `engines/sandbox_agent.ts:74-75` test re-exports, `LocalBackend`,
  `ClaudeHarness` / `AgentaHarness`.
- Left for later (your question, not a delete): the service re-export shims `secrets.py`,
  `tools/secrets.py`, `tools/gateway.py`. Confirmed the agent does NOT use them at runtime
  (`app.py` resolves via `agenta.sdk.agents.platform` and `tools/resolver`); they are
  backward-compat shims used only by tests. Deletable once those tests repoint.
- Not touched (unmarked low/cosmetic): `mcp_server_to_wire` singular, `MessageContent`,
  the `coerce_tool_configs` diagnostics surface.

The original report follows.

## What "the code is not really doing anything" means here

The premise is partly true and partly false. The live runtime path is wired and
reached. The service (`services/oss/src/agent/app.py`) always selects
`SandboxAgentBackend` + the `pi` harness, resolves tools/MCP/secrets through the SDK
`platform` package, and streams through the vercel adapter. That whole spine is alive.

What is genuinely dead is the scaffolding left around the spine: leftover re-export shims
from the PR #4772 refactor, compat wrappers that duplicate a canonical name, two backend
adapters that only tests or nothing reach, and one broken module that cannot even import.
The breadth of files (31 TS, ~40 SDK) makes it look like a large system. Most of those
files are live; a focused minority is dead.

## Counts

- High confidence (delete): 7 findings.
- Medium confidence (reachable only via a non-default flag, tests, or unimplemented): 6 findings.
- Low confidence (cosmetic / public-surface-only orphans): 3 findings.

## How I checked (shared method)

For each symbol I ran `git grep -n "<symbol>"` across `services/`, `sdks/`, `api/`, `web/`
excluding `.pyc`, then classified the hits: only-definition, only-`__init__`-re-export,
only-tests, or live caller. For files I grepped inbound imports of the basename. The live
entry points are `app.py` (service), `cli.ts`/`server.ts` (runner), and the public SDK
surface `agenta/__init__.py`.

---

## SERVICE - `services/oss/src/agent/`

### DEAD (high): `client.py` whole file [[[delete]]]

- File: `services/oss/src/agent/client.py` (`agenta_api_base`, `request_authorization`,
  `TOOLS_TIMEOUT`).
- Verdict: dead. Zero importers anywhere.
- How I checked: `git grep -n "agent.client\|agenta_api_base\|request_authorization"` over
  `services/oss/src/` returns only the definitions in this file. `app.py` imports
  `config`, `schemas`, `tools`, `tracing` only. The backend base-URL and authorization
  logic now lives in `agenta.sdk.agents.platform.connection` (`PlatformConnection`,
  `DEFAULT_TOOLS_TIMEOUT`). The conftest references to `agenta_api_base` /
  `request_authorization` patch the SDK platform module passed into `_install`, not this
  file.
- Action: delete.

### DEAD (medium): `secrets.py` and `tools/secrets.py` and `tools/gateway.py` shims (tests-only)  [[[doesnt the agent use these?]]]

- Files: `services/oss/src/agent/secrets.py` (`resolve_harness_secrets`,
  `_PROVIDER_ENV_VARS`), `services/oss/src/agent/tools/secrets.py`
  (`VaultToolSecretProvider`, `resolve_named_secrets`), `services/oss/src/agent/tools/gateway.py`
  (`AgentaGatewayToolResolver`, `_to_gateway_reference`, `_normalize_reference`).
- Verdict: thin re-export shims of the SDK `platform` package. No LIVE importer. `app.py`
  imports none of them. The only non-shim importers are tests.
- How I checked: `git grep -n` for each symbol. `resolve_harness_secrets` and
  `_PROVIDER_ENV_VARS`: only `secrets.py` + two test files. `VaultToolSecretProvider`:
  only the shim + `tools/__init__.py` re-export, never constructed (`VaultToolSecretProvider(`
  returns nothing). `_to_gateway_reference`/`AgentaGatewayToolResolver` via
  `tools/__init__`: only `test_gateway_mapping.py`. `app.py` resolves via
  `agenta.sdk.agents.platform` (`resolve_secrets`) and `oss.src.agent.tools`
  (`resolve_tools`/`resolve_mcp_servers`), which themselves call the SDK platform, not
  these shims.
- Nuance: `tools/__init__.py` re-exports `AgentaGatewayToolResolver` and
  `VaultToolSecretProvider` in `__all__`, but nothing imports those names from it at
  runtime. `_gateway_ref = _to_gateway_reference` in `tools/__init__.py:7` is assigned and
  never read.
- Action: needs-human-decision. These keep test imports green and preserve a
  backward-compatible import path. If the tests are repointed at
  `agenta.sdk.agents.platform`, all four shim files plus the `__init__` re-exports can go.
  `resolver.py` and the `resolve_tools`/`resolve_mcp_servers` it exposes are LIVE; keep them.

### NOT DEAD (checked): `config.py`, `schemas.py`, `tracing.py`, `tools/resolver.py`

- `config.py`: all three `AgentConfig` fields (`agents_md`, `model`, `tools`) are read by
  `app.py` `_default_agent_config`. No decorative config.
- `schemas.py`: `AGENT_SCHEMAS` consumed by `app.py:144`; harness default is `"pi"`
  (`schemas.py:50`), matching the live selection.
- `tracing.py`: `record_usage`, `trace_context` imported by `app.py:36`.
- `tools/resolver.py`: `resolve_tools`, `resolve_mcp_servers` imported by `app.py:35`. The
  MCP gate `AGENTA_AGENT_ENABLE_MCP` defaults off, so MCP resolution is gated-but-reachable,
  not dead.

---

## RUNNER - `services/agent/src/` (TypeScript sandbox-agent) 

Entry points confirmed via `package.json`: `cli.ts` (`run:cli`) and `server.ts` (`serve`).
Engine dispatch is `backend === "pi" ? runPi(...) : runSandboxAgent(...)` at
`server.ts:47-50` and `cli.ts:31-34`, default `sandbox-agent`. Both engines are live: the
SDK `InProcessPiBackend` sets `AGENT_BACKEND=pi`, `SandboxAgentBackend` sets
`sandbox-agent`. Keep both engines, both tool executors, all of `tools/`, `protocol.ts`,
`responder.ts`.

### DEAD (high): `shutdownTracing`  [[[delete]]]

- File: `services/agent/src/tracing/otel.ts:179`, function `shutdownTracing`.
- Verdict: dead. Zero callers in `src`, `tests`, or the Python side.
- How I checked: `grep -rn "shutdownTracing" services/agent` returns only the definition.
  The runner flushes per-run via `flushTrace` (`otel.ts:583,1020`); there is no
  process-level shutdown-flush path. The only other repo hit is an archived POC under
  `docs/.../archive/wp-1-pi-tracing/poc/`, a different file.
- Action: delete.

### DEAD (medium): test-only re-export aliases on the engine surface  [[dont delete]]

- File: `services/agent/src/engines/sandbox_agent.ts:74-75`. Re-exports `buildTurnText`,
  `messageTranscript` (from `./sandbox_agent/transcript.ts`) and `toAcpMcpServers` (from
  `./sandbox_agent/mcp.ts`).
- Verdict: the underlying functions are LIVE (production imports them directly from their
  defining modules). The re-export aliases on the engine are consumed only by
  `tests/unit/continuation.test.ts` and `tests/unit/mcp-servers.test.ts`.
- How I checked: grep for each name scoped to `sandbox_agent.ts` import source; only the
  two test files import through the engine.
- Action: needs-human-decision. Either delete the three re-exports and repoint the two
  tests at the defining modules, or keep them as an intentional "test through the engine's
  public surface" seam. Not runtime-dead.

### NOT DEAD (checked, do not re-investigate)

- `tools/mcp-server.ts`: looks orphaned (no static import) but is spawned as a `tsx`
  subprocess by `mcp-bridge.ts:26`. Live.
- `extensions/agenta.ts`: no static import, but esbuild-bundled to
  `dist/extensions/agenta.js` and loaded by Pi at runtime (`pi-assets.ts:24`, Dockerfiles
  run `build:extension`). Live.
- `engines/sandbox_agent.ts` (file) is NOT superseded by `engines/sandbox_agent/` (folder).
  The file is the orchestrator that imports the folder modules.
- `version.ts` (`PROTOCOL_VERSION`/`RUNNER_VERSION`/`ENGINES`/`HARNESSES`): served by
  `/health` via `runnerInfo()`.
- `provider.ts`, `transcript.ts`, `usage.ts`, `model.ts`, `daytona.ts`, `pi-assets.ts`,
  `public-spec.ts`, `workspace.ts`: all reached through their orchestrators.

---

## SDK - `sdks/python/agenta/sdk/agents/` and `sdk/engines/running/`

### DEAD (high): broken `engines/running/registry.py`  [[[check who added it and why]]]

- File: `sdks/python/agenta/sdk/engines/running/registry.py` (only symbol
  `exact_match_v1`).
- Verdict: dead and unimportable. Line 5 does
  `from agenta.sdk.engines.running.types import Data`, but `running/types.py` does not
  exist, so importing the module raises `ModuleNotFoundError`.
- How I checked: `ls running/types.py` (no such file). `git grep "running.registry\|from .registry import exact_match_v1"`
  finds no importer of THIS module. The `exact_match_v1` hits elsewhere are an unrelated
  function in `sdk.workflows.handlers` and in manual test scripts. Note: `running/` is the
  OLDER workflow-engine subsystem, separate from the agent path; the agent code never
  imports `engines.running`.
- Action: delete file.

### DEAD (high): `is_import_safe` [[[delete]]]

- File: `sdks/python/agenta/sdk/engines/running/sandbox.py:9`, function `is_import_safe`.
- Verdict: dead. Zero callers.
- How I checked: `git grep "is_import_safe"` returns only the definition. The live member
  in that file is `execute_code_safely` (called from `handlers.py`).
- Action: delete function.

### DEAD (high): `tool_spec_to_wire` and `tool_specs_to_wire`  [[[[deelete]]]]

- File: `sdks/python/agenta/sdk/agents/tools/wire.py:10,14`.
- Verdict: dead standalone functions. The live serialization path uses the
  `ToolSpec.to_wire()` METHOD (`dtos.py:479,484`), not these module functions.
- How I checked: `git grep "tool_specs\?_to_wire"` returns only the defs plus their
  re-export in `tools/__init__.py:38,65-66`. No real caller.
- Action: delete the functions and the `__init__` re-exports.

### DEAD (high): `ui_messages.py` whole module  [[[this is strange i thought this was our internal represenation]]]

- File: `sdks/python/agenta/sdk/agents/ui_messages.py`.
- Verdict: dead compat shim re-exporting `from_ui_messages`/`to_ui_message`/
  `ui_message_stream` from `adapters.vercel`. Zero importers of the module.
- How I checked: `git grep "agents.ui_messages\|from .ui_messages\|from agenta.sdk.agents.ui_messages"`
  returns nothing. The live service imports the canonical `agent_run_to_vercel_parts`
  directly (`app.py:29`).
- Action: delete file. The flat aliases `from_ui_messages`, `to_ui_message`,
  `ui_message_stream = agent_run_to_vercel_parts` in `adapters/vercel/messages.py:218-219`
  and `adapters/vercel/stream.py:216` have no real callers either and can go with it.

### DEAD (high): `parse_tool_configs` (plural-of-the-wrong-name)  [[[[double check but then delete if so ]]]]

- File: `sdks/python/agenta/sdk/agents/tools/parsing.py`.
- Verdict: dead. Zero references anywhere, not even tests.
- How I checked: `git grep "parse_tool_configs"` finds only the def. The live parse path
  uses `coerce_tool_configs` (`dtos.py:331`, `platform/resolve.py:52`,
  `api/oss/.../tools/models.py:113`).
- Action: delete. Note the siblings `coerce_tool_config` (singular) and `parse_tool_config`
  (singular) are tests-only plus internal `compat.py` use; keep for now or fold into test
  fixtures (medium, human call).

### DEAD-ish (medium): `InProcessPiBackend` (tests-only, but a public export)  [[[lets remove that part of the code it was a poc and it is now confusing]]]

- File: `sdks/python/agenta/sdk/agents/adapters/in_process.py`, class `InProcessPiBackend`.
- Verdict: never selected by the service. Constructed only in tests
  (`test_transport_roundtrip.py`, `test_harness_adapters.py`, `test_runner_adapter_config.py`).
  It is a near-duplicate of `SandboxAgentBackend`.
- How I checked: `git grep "InProcessPiBackend\|InProcessPi"` excluding tests finds only
  its definition plus public-API re-exports in `agenta/__init__.py:63` and
  `agents/__init__.py`. `select_backend` in `app.py` always returns `SandboxAgentBackend`.
- Action: needs-human-decision. It is exported as public SDK API ("the reference backend")
  but only tests and explicit non-default callers reach it. Keep as a documented reference
  backend or demote to a test fixture.

### DEAD (medium): `LocalBackend` (never instantiated, unimplemented) [[[keep]]]

- File: `sdks/python/agenta/sdk/agents/adapters/local.py`, class `LocalBackend`.
- Verdict: never instantiated anywhere; every method raises `NotImplementedError`.
- How I checked: `git grep "LocalBackend("` finds only the class definition. Methods at
  `local.py:35,50` raise `NotImplementedError`.
- Action: keep-but-wire (a tracked Phase 3/4 stub) or delete if no longer planned. Dead
  today by design.

### REACHABLE-BUT-NEVER-DEFAULT (medium): `ClaudeHarness`, `AgentaHarness` (+ `agenta_builtins.py`) [[[keeep]]]

- File: `sdks/python/agenta/sdk/agents/adapters/harnesses.py:77,105`, plus the forced
  tools/skills machinery in `adapters/agenta_builtins.py`.
- Verdict: registered in the harness registry (`harnesses.py:127-129`) and listed in
  `SandboxAgentBackend.supported_harnesses` (`sandbox_agent.py:121-122`), so they ARE
  reachable if a user sets `harness: "claude"` or `harness: "agenta"` in playground config.
  The default everywhere is `"pi"` (`schemas.py:50`, `dtos.py:369,378`). Outside explicit
  config they run only in unit tests.
- Action: keep (config-gated feature). Flag that AGENTA/CLAUDE are exercised only via tests
  plus explicit non-default config, so they are easy to break unnoticed.

### LOW / cosmetic

- `mcp_server_to_wire` (singular) in `mcp/wire.py`: no non-test, non-`__init__` caller
  (live path uses plural `mcp_servers_to_wire`, `dtos.py:439`). Delete singular helper.
- `MCPSecretProvider` in `mcp/interfaces.py`: Protocol/typing surface, no constructor.
  Keep.
- `MessageContent` type alias `dtos.py:179`: used only in-file, not in `__all__`. Cosmetic.
- `ToolConfigDiagnostic` / `ToolConfigParseResult` / `coerce_tool_configs(on_error="collect")`
  in `tools/compat.py:20,27`: the diagnostics/collect branch is tests-only (live callers
  use the default `on_error="raise"`). Public structured-error surface; human call.

### NOT DEAD (checked, do not re-investigate)

- `platform.resolve` does NOT supersede `tools.resolver` / `mcp.resolver`. It WRAPS them:
  `platform/resolve.py:48,62` constructs `ToolResolver(...)` and `MCPResolver(...)`. One
  resolution stack, not two. All of `tools/resolver.py`, `mcp/resolver.py`,
  `platform/{gateway,secrets,connection}.py` are live.
- `engines/running/` is a separate, OLDER workflow/evaluator engine
  (`completion_v0`/`chat_v0`/`echo_v0`, code runners, catalog, templates). The agent path
  never imports it. It is heavily used by `api/`, the completion/chat services, SDK
  decorators, and DB migrations. Out of scope for agent-workflows but mostly live; the only
  dead spots inside it are `registry.py` and `is_import_safe` above. `DaytonaRunner`
  (`runners/daytona.py`) is env-gated (`AGENTA_SERVICES_CODE_SANDBOX_RUNNER=daytona`), not
  dead; `LocalRunner` is the default.
- `dtos.py`, `interfaces.py`, `streaming.py` (`AgentRun`), `_runner_config.py`,
  `utils/ts_runner.py` (all `deliver_*`), `utils/wire.py`: all have live callers in the
  service or adapters.
- vercel adapter `routing.py`/`sse.py`/`stream.py`/`messages.py`: reached via
  `decorators/routing.py:518` (`register_agent_message_routes`), gated by the `is_agent`
  flag that `app.py:146` sets. The FE `AgentChatSlice` consumes `/messages` through
  `NEXT_PUBLIC_AGENT_CHAT_API`.

---

## Suggested cleanup order (lowest risk first)

1. `shutdownTracing` (otel.ts), `is_import_safe` (sandbox.py), `running/registry.py`,
   `tool_spec(s)_to_wire`, `parse_tool_configs`, `ui_messages.py` + flat vercel aliases,
   `mcp_server_to_wire` singular. All zero-caller, high confidence.
2. Service shims (`client.py` then, after repointing tests, `secrets.py`,
   `tools/secrets.py`, `tools/gateway.py` + `__init__` re-exports).
3. The runner test-only re-exports (`sandbox_agent.ts:74-75`) once tests are repointed.
4. Human decisions: `InProcessPiBackend`, `LocalBackend`, `ClaudeHarness`/`AgentaHarness`,
   the `coerce_tool_configs` diagnostics surface.
