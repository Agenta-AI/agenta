# Add the Codex harness (on the local sandbox) — investigation

## Goal (this worktree only)

Make `harness="codex"` a selectable coding harness that runs on the **local** sandbox.
One new variable: the harness. Everything else (local sandbox, daemon auto-install, tool
delivery, tracing, model mapping) is held constant at its known-good state. Remote
(Daytona) codex and the non-Pi remote-bootstrap generalization are explicitly **out of
scope** — they belong to a later matrix-fill / foundation pass.

## How harness selection works today (the seam we extend)

Two orthogonal axes swap independently behind ports: the **harness** (`request.harness`)
and the **sandbox** (`request.sandbox`). The Node runner (`services/agent`) drives one
engine, `engines/sandbox_agent.ts`, over ACP through the `sandbox-agent` package + the
rivet daemon. The runner's own comment: "the choice of harness/sandbox is config, not new
code." Branching is on **probed capabilities**, not harness names.

Flow for a run:

```
AgentTemplate.harness (Python)
  └─ make_harness(harness, env)  sdks/python/.../adapters/harnesses.py  (validates; raises on unknown)
       └─ <Harness>._to_harness_config → <Harness>AgentTemplate (renders harness config + harnessFiles)
            └─ wire /run: { harness, sandbox, secrets, credentialMode, harnessFiles, ... }
                 └─ run-plan.ts: harness → acpAgent     (pi_core/pi_agenta→pi, claude→claude)
                      └─ sandbox_agent.ts: createSession({ agent: acpAgent, ... }) over ACP
```

## The big finding: the daemon already supports codex

`sandbox-agent@0.4.2` ships the rivet daemon (`rivetdev/sandbox-agent`). Its binary already
contains first-class codex support, with an `ensure_installed` mechanism that fetches the
agent on demand at `create_instance` time (locked, idempotent):

- **codex CLI**: downloaded from `github.com/openai/codex/releases/.../codex-<target>`
- **codex ACP bridge**: `@zed-industries/codex-acp` (npm, installed via the ACP registry
  `cdn.agentclientprotocol.com/registry/v1/latest/registry.json`)
- The daemon exposes `POST /agents/:agent/install` and a `sandbox-agent install-agent <id>`
  CLI for pre-baking, but on **local** the auto-install path means **no bootstrap work is
  required from us** — the first `createSession({ agent: "codex" })` triggers the install.

Consequence: this is overwhelmingly an Agenta integration-layer task. We are NOT building a
codex runtime; we are teaching the Agenta plumbing to *select* one the daemon already knows.

## What is harness-specific today and must gain a codex branch

| Concern | Today | Codex action |
|---|---|---|
| Harness enum | `HarnessType` = pi_core/claude/pi_agenta (`dtos.py`) | add `CODEX="codex"` |
| Identity / FE dropdown | `HARNESS_IDENTITIES` → `harnesses` catalog (`GET /catalog/harnesses`) | add a `HarnessIdentity` (FE control is catalog-driven, so this surfaces it) |
| Connection capabilities | `HARNESS_CONNECTION_CAPABILITIES` (`capabilities.py`): providers, deployments, models | add a `"codex"` entry (OpenAI provider family, codex model ids) |
| Harness adapter | `PiHarness` / `ClaudeHarness` / `AgentaHarness` + `_HARNESSES` | add `CodexHarness` (model on `ClaudeHarness`: MCP tools, settings files, no built-ins) |
| Harness template DTO | `PiAgentTemplate` / `ClaudeAgentTemplate` | add `CodexAgentTemplate` (+ `wire_harness_files` if codex needs static config) |
| acpAgent map | `run-plan.ts` line ~159 (`pi`/`claude`) | `harness==="codex" → acpAgent "codex"`; relax the Pi-identity assertion |
| Capabilities fallback | `capabilities.ts` static table keyed `pi`-vs-not | codex falls into the non-pi branch (mcpTools/toolCalls true) — verify the probe; static fallback already correct |
| Tool delivery | capability-driven MCP (`mcp.ts`), Pi=native | none — codex advertises `mcpTools`, routes over MCP automatically |
| Tracing | event-stream otel for non-Pi (`tracing/otel.ts`) | none — already harness-agnostic |
| Model mapping | session-config driven (`model.ts`), normalizes to harness ids | none in code; just publish codex model ids in capabilities |

## Resolved (Phase 0 confirmed — daemon binary + the green PoC matrix)

The `vibes/sessions/demo` PoC already ran **codex green across local/daytona/modal/e2b**
(full 16-cell harness×sandbox matrix), so the answers below are observed, not theoretical.

1. **Credential mode — BOTH managed key AND self-managed `auth.json`, in v1.** Both modes are
   implemented via `prepareLocalCodexAssets` (local) and `prepareDaytonaCodexAssets` (remote).
   - **Managed (`credentialMode="env"`)**: Agenta resolves the credential from the vault. The
     source key is `OPENAI_API_KEY` (preferred) or `CODEX_API_KEY` (fallback). The runner writes
     `~/.codex/auth.json = {"OPENAI_API_KEY": "<value>"}` before the daemon starts — the auth.json
     field is always `OPENAI_API_KEY` regardless of which env var supplied the value.
   - **Self-managed (`runtime_provided`)**: the user's own `~/.codex/auth.json` is already present
     on the host. For local runs the daemon inherits HOME and reads it directly; `prepareLocalCodexAssets`
     verifies the file exists and warns if absent. The `shouldUploadOwnLogin` gate controls both modes.
   **GOTCHA (PoC, applies to BOTH modes):** the codex CLI reads `~/.codex/auth.json` as a FILE,
   not only the env var — so even the managed path must WRITE the auth file (env alone is not
   enough). `CODEX_API_KEY` is in `KNOWN_PROVIDER_ENV_VARS` as a clear-set entry; it is never
   written to auth.json — only used as a fallback source for the managed credential value.
2. **Static permission/config files — skip in v1, but expect to follow the Claude model next.**
   The probe did not surface a required codex config file for a basic managed run; defer
   until the probe (T0.1) shows codex gating tools at runtime. When we DO add permissions, mirror
   `claude_settings.py` (`.claude/settings.json`-style) via `wire_harness_files`. Likely next
   increment.
3. **Model ids — openai-LOCKED, captured from the PoC probe.** codex publishes its own ids via
   session configOptions: `gpt-5.5, gpt-5.4, gpt-5.4-mini, ...` (PoC: codex→openai locked, like
   claude→anthropic). Re-probe (T0.2) to refresh the exact list at impl time (ids churn); publish
   in `HARNESS_CONNECTION_CAPABILITIES["codex"]`. No `applyCodexConnectionEnv` needed (no
   base-url/model-override env surfaced); the generic secrets path injects the key.

## Files (verified)

- `sdks/python/agenta/sdk/agents/dtos.py` — `HarnessType` (42), `HARNESS_IDENTITIES` (89), harness template DTOs
- `sdks/python/agenta/sdk/agents/capabilities.py` — `HARNESS_CONNECTION_CAPABILITIES` (113)
- `sdks/python/agenta/sdk/agents/adapters/harnesses.py` — adapters + `_HARNESSES` + `make_harness`
- `sdks/python/agenta/sdk/agents/adapters/claude_settings.py` — the settings-file template (mirror if codex needs files)
- `sdks/python/agenta/sdk/agents/utils/wire.py` — `request_to_wire` (no change; passes harness value through)
- `services/agent/src/engines/sandbox_agent/run-plan.ts` — acpAgent map (~159) + assertion (~165)
- `services/agent/src/engines/sandbox_agent/capabilities.ts` — static fallback (verify probe)
- `services/agent/src/protocol.ts` — wire types (harness is a free string; no change)
- Tests: `sdks/python/oss/tests/pytest/unit/agents/golden/` + `test_wire_contract.py`, `services/agent/tests/unit/wire-contract.test.ts`
