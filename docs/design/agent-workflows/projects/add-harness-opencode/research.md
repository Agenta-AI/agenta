# Add the OpenCode harness (on the local sandbox) — investigation

## Goal (this worktree only)

Make `harness="opencode"` a selectable coding harness that runs on the **local** sandbox.
One new variable: the harness. Local sandbox + daemon auto-install + capability-driven tool
delivery + tracing are held constant. Remote (Daytona) opencode and the non-Pi remote
bootstrap generalization are out of scope (later matrix-fill).

## The seam (same as codex)

Harness and sandbox are two orthogonal axes behind ports. The runner drives one engine
(`engines/sandbox_agent.ts`) over ACP via `sandbox-agent` + the rivet daemon; branching is on
probed capabilities, not names. Flow:

```
AgentTemplate.harness → make_harness() → <Harness>AgentTemplate → wire /run
   → run-plan.ts harness→acpAgent → createSession({ agent: "opencode" })
```

## The big finding: the daemon already supports opencode (specially)

`sandbox-agent@0.4.2`'s rivet daemon has first-class opencode support with `ensure_installed`
auto-install on the local path. But opencode is handled **differently** from the `-acp` shim
harnesses, and these differences shape the spec:

- **Acquisition**: opencode is downloaded as a GitHub release **binary zip**
  (`.../opencode-<target>.zip`) — `agent_manager.install_opencode` / `install_zip_binary`.
  The release source is **`anomalyco/opencode`, which is the OFFICIAL OpenCode** (anomaly.co is
  the company behind OpenCode) — NOT a fork. We do not fork opencode.
- **Native ACP-over-SSE, not a stdio `-acp` adapter**: the daemon has dedicated
  `_sandboxagent/opencode/status` and `_sandboxagent/opencode/message` JSON-RPC methods + an
  "ACP SSE translation" task.
- **No `session/set_mode`**: VERIFIED in the daemon binary —
  `const te = k==="opencode"; if(!te && O.agentMode) … session/set_mode`. opencode is excluded
  from mode-setting, so **planMode is off** for it. (The `!te` guard is only on set_mode; the
  model IS still applied to opencode.)
- **OpenCode Zen is NOT the live path.** The daemon's `opencode/*` ids (`OpenCode Zen/...`) and
  the `OPENCODE_COMPAT_PROXY_URL` / `/v1/opencode` compat layer are gated behind an
  **EXPERIMENTAL flag, "disabled until ACP Phase 7"** (verified string in the binary). Zen is a
  third-party hosted gateway and we are **not** using it. opencode runs through its normal ACP
  adapter with **plain provider keys** — which is exactly how the `vibes/sessions/demo` PoC ran
  opencode green (its `.env` had only `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, no Zen key). Per the
  PoC, opencode (like pi) accepts BOTH providers with `provider/model`-prefixed ids.

Consequence: integration-layer only. opencode's credential story is the SAME as the others
(plain provider key) once Zen is off the table; the real differences are planMode-off and the
arch/node gotchas below (which bite on the SANDBOX/template side, deferred for the local-first v1).

## PoC gotchas relevant later (remote/template — out of scope for local v1)

- **opencode arch bug**: `install-agent opencode` fetches the linux-**x64** Bun binary even on
  arm64 → SIGTRAP (`rosetta error … ld-linux-x86-64.so.2`). Fix (PoC): after install-agent
  (fail-soft on its verify crash) overwrite the binary with the correct-arch build from official
  opencode releases (`opencode-linux-arm64.tar.gz`) at BOTH `bin/opencode` and
  `bin/agent_processes/opencode/opencode`. On real-x64 cloud the default download is correct. On
  **local** (this worktree), the host daemon's auto-install picks the host arch — verify on the
  dev machine; only the remote/template path needs the override.

## What gains an opencode branch

Same matrix as codex (enum, identity/catalog, capabilities, adapter, template DTO, acpAgent
map, fallback). Opencode-specific notes:

| Concern | Opencode specifics |
|---|---|
| Connection capabilities | Zen OFF → opencode accepts **both** provider families (anthropic + openai) with `provider/model` ids (PoC: 60+ each); deployments `["direct"]`; model_selection `provider/id` |
| Credential | **plain provider key** (managed `env`: `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`), same as the others. No Zen key. No new clear-set var. |
| Capabilities fallback | `capabilities.ts` non-pi branch sets planMode true; opencode is the one exception → set planMode **false** for opencode in the static fallback (probe authoritative when present) |
| Tools | over MCP if the probe reports `mcpTools`; confirm via probe |
| Model ids | `provider/model`-prefixed; `model.ts` suffix-matching already maps a bare id by suffix |

## Resolved (Phase 0 confirmed — daemon binary + the green PoC matrix)

1. **Credential — plain managed provider key, NO Zen.** Zen is a third-party gateway and the
   daemon's Zen layer is experimental/disabled anyway. Same shape as codex/claude managed mode;
   nothing new in `KNOWN_PROVIDER_ENV_VARS`.
2. **Model list — `provider/model` ids for both providers** (PoC probe; 60+ each). Re-probe at
   impl time to refresh; publish in `HARNESS_CONNECTION_CAPABILITIES["opencode"]`.
3. **planMode = false** — VERIFIED in the daemon (set_mode skipped for opencode). Reflect in the
   static fallback.
4. **anomalyco = official OpenCode**, not a fork. No fork, ever. The arch/node gotchas above are
   remote/template concerns, deferred for the local-first v1.

## Files

Same set as the codex worktree, under the opencode names: `HarnessType.OPENCODE`,
`OpencodeHarness`, `OpencodeAgentTemplate`, `run-plan.ts` map `opencode→opencode`,
`capabilities.ts` opencode static fallback (planMode **false**).
