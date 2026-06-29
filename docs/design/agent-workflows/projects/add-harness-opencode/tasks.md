# Add the OpenCode harness (local sandbox) — tasks

Decisions are LOCKED (see research.md / specs.md); Phase 0 is a quick re-verify.

## Phase 0 — re-verify daemon reality (no code)
> Reference first: the `vibes/sessions/demo` PoC ran opencode green on local with a plain
> provider key (no Zen). Confirm, don't re-discover.
- [ ] T0.1 Local daemon `createSession({ agent: "opencode" })`: confirm auto-install and capture
      probed `AgentCapabilities` — confirm `mcpTools` and `planMode:false` (set_mode skipped).
- [ ] T0.2 Refresh the `provider/model` id list (both anthropic + openai) from session config
      options. NO OpenCode Zen — confirm a plain provider key drives a model.

## Phase 1 — Python SDK plumbing
- [ ] T1.1 `dtos.py`: `HarnessType.OPENCODE = "opencode"` + `HARNESS_IDENTITIES` entry.
- [ ] T1.2 `capabilities.py`: `HARNESS_CONNECTION_CAPABILITIES["opencode"]` (anthropic + openai
      families, `provider/id` model_selection, model ids from T0.2). No Zen.
- [ ] T1.3 `dtos.py`: `OpencodeAgentTemplate` (model on `ClaudeAgentTemplate`; MCP tools, no
      built-ins). `wire_harness_files` only if T0.x shows static config is needed.
- [ ] T1.4 `adapters/harnesses.py`: `OpencodeHarness` + register in `_HARNESSES` (drop built-ins
      with a warning).

## Phase 2 — Node runner
- [ ] T2.1 `run-plan.ts`: map `harness==="opencode" → acpAgent "opencode"`; keep pi assertion
      pi-only.
- [ ] T2.2 `capabilities.ts`: in the static fallback, set `planMode:false` for opencode (probe
      authoritative when present); confirm mcpTools per T0.1.
- [ ] T2.3 Credential: plain managed provider key via the generic secrets path
      (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) — already in `KNOWN_PROVIDER_ENV_VARS`. No new var,
      no Zen.

## Phase 3 — contracts & tests
- [ ] T3.1 opencode `/run` golden fixture; update `test_wire_contract.py` + `wire-contract.test.ts`.
- [ ] T3.2 Unit: `make_harness("opencode")` → `OpencodeHarness`; run-plan opencode map;
      capability gate on missing `mcpTools`.
- [ ] T3.3 Integration (local): opencode run returns output + trace; a `provider/model` honored;
      managed run leaks only the one provider key (no Zen). Both editions (ungated convention).

## Phase 4 — surface & docs
- [ ] T4.1 Confirm the catalog-driven dropdown shows "OpenCode"; FE follow-up only if not.
- [ ] T4.2 `documentation/adapters/opencode.md` (capabilities incl. no-plan-mode, native SSE,
      plain-provider-key credential, Zen-is-off, what's deferred incl. arch/node template gotchas).

## Verify before merge
- [ ] `ruff format`/`ruff check`; `pnpm test`/`pnpm run typecheck`.
- [ ] Diff scoped vs origin/main; drop findings also on main.
