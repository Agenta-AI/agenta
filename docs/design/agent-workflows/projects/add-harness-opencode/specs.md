# Add the OpenCode harness (local sandbox) — specs

## Scope

In: `harness="opencode"` on the **local** sandbox; tools over MCP (if probed); event-stream
tracing; model selection by `provider/model` (both anthropic + openai); **plain managed
provider key, NO OpenCode Zen** (Zen is third-party and the daemon's Zen layer is
experimental/disabled). Out: Daytona/remote opencode, non-Pi remote bootstrap, the opencode
arch/node-version template gotchas (deferred to matrix-fill).

## Behavior

- Selecting OpenCode in the catalog-driven playground dropdown and running a prompt drives the
  `opencode` ACP agent in the local daemon, which auto-installs opencode (GitHub binary zip) on
  first use and serves it over its native ACP-over-SSE compat layer.
- Resolved tools reach opencode over the internal `agenta-tools` MCP channel **iff** the probe
  reports `mcpTools`; otherwise the capability gate fails the run loud (no silent drop).
- The run injects only the managed provider key (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`,
  clear-then-apply); no other key leaks. No Zen key.
- Tracing is built from the ACP event stream under the caller's invoke span; the chat span
  carries the resolved `provider/model` (or `chat` if rejected).
- planMode is **off** for opencode (the daemon skips `session/set_mode` for it); the reported
  capabilities reflect this so the FE never offers a mode opencode cannot honor.

## Contracts

- Wire unchanged (`harness` free string); golden fixtures gain an opencode example asserted by
  both contract tests.
- `HARNESS_IDENTITIES` gains `{value:"opencode", slug:"agenta:harness:opencode:v0", name:"OpenCode"}`.
- `HARNESS_CONNECTION_CAPABILITIES["opencode"]`: model_selection `provider/id`, provider
  families anthropic + openai, model ids from the probe. (No Zen catalog.)

## Decisions — LOCKED (see research.md for evidence)

1. **Credential: plain managed provider key, no Zen.** Same shape as codex/claude managed mode;
   no new `KNOWN_PROVIDER_ENV_VARS` entry.
2. **Model list: `provider/model` ids, both providers** (PoC probe; 60+ each); re-probe to refresh.
3. **planMode = false** (verified in the daemon) — set in the static fallback.
4. **anomalyco = official OpenCode, not a fork.** No fork.

## Non-goals / invariants preserved

- No change to the local provider, relay, or tracing state machine.
- `OpencodeHarness` carries no opencode-specific parsing into the runner; any files ship as
  generic `harnessFiles`.
- The only name-keyed addition in the runner is `harness→acpAgent`; everything else stays
  capability-driven. The one defensible opencode special-case is planMode in the **static**
  fallback (the probe is authoritative when available).

## Acceptance

- Unit: wire golden (Python+TS); `make_harness("opencode")` → `OpencodeHarness`; run-plan maps
  `opencode→opencode`; capability gate fires when `mcpTools` absent and tools are present.
- Integration (local): opencode run returns output + trace; a `provider/model` is honored;
  managed run leaks only the one provider key; no Zen key present.
- Ungated endpoint → both editions per test-account convention.
