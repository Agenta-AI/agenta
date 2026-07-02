# Add the Codex harness (local sandbox) — specs

## Scope

In: `harness="codex"` runs on the **local** sandbox, with **both** credential modes —
managed (`credentialMode="env"`, Agenta injects `OPENAI_API_KEY`) and self-managed
(`runtime_provided`, the user's own `~/.codex/auth.json`, like the Claude Code login path);
tools over MCP, event-stream tracing, model selection from a published codex model list. Out:
Daytona/remote codex, non-Pi remote bootstrap (deferred to matrix-fill).

## Behavior

- Selecting Codex in the playground (catalog-driven dropdown) and running a prompt drives the
  `codex` ACP agent inside the local sandbox daemon, which auto-installs codex on first use.
- Resolved gateway tools reach codex over the internal `agenta-tools` MCP channel (loopback
  HTTP), the same path Claude uses. Built-in (Pi) tool names are dropped with a warning.
- A managed run injects only `OPENAI_API_KEY` (clear-then-apply); no other provider key leaks.
  Because the codex CLI reads `~/.codex/auth.json` as a FILE (not just env), BOTH modes write
  that auth file: managed writes it from the resolved key; self-managed uploads the user's own
  (the `shouldUploadOwnLogin` fallback-login pattern). Codex runs mode `agent-full-access`.
- The run is traced end-to-end from the ACP event stream under the caller's invoke span, with
  the resolved codex model on the chat span (or `chat` if codex rejected the requested model).
- A run that carries a capability codex lacks (per probe) fails loud with a specific message,
  never silently drops behavior.

## Contracts

- Wire (`protocol.ts` / `wire.py`) unchanged: `harness` is a free string. The golden fixtures
  gain a codex example; both contract tests assert it.
- `HARNESS_IDENTITIES` gains `{value:"codex", slug:"agenta:harness:codex:v0", name:"Codex"}`.
- `HARNESS_CONNECTION_CAPABILITIES["codex"]` published: provider family `openai`,
  deployments `["direct"]`, model ids sourced from the daemon catalog. `harness_allows_provider`
  already returns permissive for absent entries, so the entry tightens rather than enables.

## Decisions — LOCKED (see research.md for evidence)

1. **Credential: BOTH managed (`env`, `OPENAI_API_KEY`) AND self-managed (`runtime_provided`,
   `~/.codex/auth.json`)** in v1. Both write the auth file (codex reads it as a file). No
   `applyCodexConnectionEnv` needed.
2. **Static config/permission files: skip in v1**, follow the Claude `.claude/settings.json`
   model as the next increment once the probe confirms codex's runtime gating.
3. **Model ids: openai-locked**, list from the PoC probe (`gpt-5.5, gpt-5.4, …`); re-probe at
   impl time to refresh.

## Non-goals / invariants preserved

- No change to the local-sandbox provider, the relay, or the tracing state machine.
- `CodexHarness` carries no codex-specific parsing into the runner; any config files are
  rendered Python-side and shipped as generic `harnessFiles`, written blind by `prepareWorkspace`.
- Capability branching stays name-free; the only name-keyed addition is the `harness→acpAgent` map.

## Acceptance

- Unit: wire-contract golden (Python + TS), `make_harness("codex")` returns `CodexHarness`,
  `run-plan` maps `codex→codex` and keeps the Pi assertion intact for pi ids.
- Integration: a local codex run returns `ok:true` with output and a trace; a tool-carrying run
  delivers tools over MCP; a managed run shows only `OPENAI_API_KEY` in the daemon env.
- Both editions where the endpoint is ungated (per repo test-account convention).
