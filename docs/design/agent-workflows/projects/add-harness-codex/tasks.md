# Add the Codex harness (local sandbox) — tasks

Ordered. Each task is independently verifiable. Decisions are LOCKED (see research.md / specs.md);
Phase 0 is now a quick re-verify, not open discovery.

## Phase 0 — re-verify daemon reality (no code)
> Reference first: the `vibes/sessions/demo` PoC already ran codex green across
> local/e2b/daytona/modal. Mine it before re-deriving. Known answers below — confirm, don't
> re-discover.
- [ ] T0.1 `createSession({ agent: "codex" })` on a local daemon; confirm auto-install +
      capture probed `AgentCapabilities` (expect mcpTools/toolCalls true; planMode/permissions
      per probe). Refresh the model id list (PoC: openai-locked `gpt-5.5, gpt-5.4, …`).
- [ ] T0.2 Confirm the codex auth-file path: `~/.codex/auth.json` = `{"OPENAI_API_KEY": "..."}`
      is read as a FILE (env alone insufficient), mode `agent-full-access`.

## Phase 1 — Python SDK plumbing
- [ ] T1.1 `dtos.py`: add `HarnessType.CODEX = "codex"`; add the `HARNESS_IDENTITIES` entry.
- [ ] T1.2 `capabilities.py`: add `HARNESS_CONNECTION_CAPABILITIES["codex"]` (openai family,
      `direct`, model ids from T0.2).
- [ ] T1.3 `dtos.py`: add `CodexAgentTemplate` (model on `ClaudeAgentTemplate`: tool_specs,
      tool_callback, mcp_servers, skills, sandbox_permission, harness_permissions,
      permission_policy). Add `wire_harness_files` ONLY if T0.3 says codex needs static files.
- [ ] T1.4 `adapters/harnesses.py`: add `CodexHarness` (`_to_harness_config` → `CodexAgentTemplate`,
      drop built-ins with a warning like Claude); register in `_HARNESSES`.
- [ ] T1.5 Credential — wire BOTH modes for codex:
      • managed (`env`): resolve `OPENAI_API_KEY` (already in the secrets path);
      • self-managed (`runtime_provided`): reuse the `shouldUploadOwnLogin` fallback-login path so
        the user's own `~/.codex/auth.json` is uploaded.
      Mark codex as auth-file-backed so BOTH modes WRITE `~/.codex/auth.json` (codex reads the
      file, not just env). Add `CODEX_API_KEY` to `KNOWN_PROVIDER_ENV_VARS` clear-set if adopted.
- [ ] T1.6 (deferred) `adapters/codex_settings.py` mirroring `claude_settings.py` — only when we
      add codex permissions (next increment); skip for v1.

## Phase 2 — Node runner
- [ ] T2.1 `run-plan.ts`: map `harness==="codex" → acpAgent "codex"`; relax the pi-identity
      assertion so it only constrains pi ids (keep it asserting `pi_*` ⇔ `pi`).
- [ ] T2.2 `capabilities.ts`: confirm the static fallback's non-pi branch is correct for codex
      (mcpTools/toolCalls true); adjust only if T0.1 disagrees.
- [ ] T2.3 Codex auth.json writer: in the LOCAL asset-prep path, write `~/.codex/auth.json`
      from the resolved key (managed) or the uploaded own-login (self-managed). No
      `applyCodexConnectionEnv` needed (no extra connection env surfaced).

## Phase 3 — contracts & tests
- [ ] T3.1 Add a codex `/run` golden fixture; update `test_wire_contract.py` and
      `wire-contract.test.ts`.
- [ ] T3.2 Unit: `make_harness("codex")` → `CodexHarness`; `run-plan` codex mapping; capability
      gate fires for a missing capability.
- [ ] T3.3 Integration (local): codex run returns output + trace; tool run delivers over MCP;
      managed run leaks only `OPENAI_API_KEY`. Ungated → both editions per test-account convention.

## Phase 4 — surface & docs
- [ ] T4.1 Verify the catalog-driven playground dropdown shows "Codex" (no bespoke FE expected;
      it reads `GET /catalog/harnesses`). Confirm; file a FE follow-up only if it does not.
- [ ] T4.2 Add `docs/design/agent-workflows/documentation/adapters/codex.md` mirroring the
      claude-code adapter doc (capabilities, tools, credentials, model mapping, what's deferred).

## Verify before merge
- [ ] `ruff format` + `ruff check` (SDK/api); `pnpm test` + `pnpm run typecheck` (services/agent).
- [ ] Diff scoped to this branch vs origin/main; drop anything also present on main.
