# Tasks: Codex on E2B

## Status

All implementation tasks below are DONE on this branch (`chore/add-codex-e2b`).

---

## Task 1 — E2B provider wiring (DONE)

**Files changed:**
- `services/agent/src/engines/sandbox_agent/provider.ts` — add `import { e2b } from
  "sandbox-agent/e2b"`, `DEFAULT_E2B_TIMEOUT_MS`, `e2bTimeoutMs()`, `buildE2bCreate()`,
  and the `sandboxId === "e2b"` branch in `buildSandboxProvider`.

**Note:** duplicates work in the `chore-add-sandbox-e2b` sibling branch (identical diff).
Reconcile on merge.

---

## Task 2 — Run-plan E2B additions (DONE)

**Files changed:**
- `services/agent/src/engines/sandbox_agent/run-plan.ts` — add `E2B_NETWORK_UNSUPPORTED_MESSAGE`,
  `isE2b` field on `RunPlan`, `createE2bCwd` dep on `BuildRunPlanDeps`, `defaultE2bCwd()`,
  `isE2b` derivation, network-restriction gate for E2B, `isE2b` in cwd selection, `isE2b`
  on the returned plan.

**Note:** duplicates work in the `chore-add-sandbox-e2b` sibling branch (identical diff).
Reconcile on merge.

---

## Task 3 — E2B assets file (DONE)

**Files changed:**
- `services/agent/src/engines/sandbox_agent/e2b.ts` — new file. Adds `E2B_PI_DIR`,
  `e2bEnvVars`, `uploadPiAuthToE2bSandbox`, `uploadCodexAuthToE2bSandbox` (codex-specific
  addition not in sibling branch), `prepareE2bPiAssets`.

**Note:** partially overlaps the `chore-add-sandbox-e2b` sibling branch. The sibling adds
all functions except `uploadCodexAuthToE2bSandbox`. Merge: add the codex function to the
sibling's version.

---

## Task 4 — Orchestration wiring (DONE)

**Files changed:**
- `services/agent/src/engines/sandbox_agent.ts` — import `prepareE2bPiAssets` and
  `uploadCodexAuthToE2bSandbox` from `./sandbox_agent/e2b.ts`; add
  `prepareE2bPiAssets` to `SandboxAgentDeps`; pass `createE2bCwd` to `buildRunPlan`; gate
  local codex auth write on `!plan.isE2b`; skip workspace cleanup for E2B; add E2B branch
  in the Daytona asset-prep section (calls `prepareE2bPiAssets` then
  `uploadCodexAuthToE2bSandbox` for codex); pass `isE2b` to `buildSessionMcpServers`;
  update `emitSpans` and tool-relay host to include `plan.isE2b`; pass `isE2b` to
  `resolveRunUsage`; exclude E2B from swallowed-Pi-error check.
- `services/agent/src/engines/sandbox_agent/usage.ts` — rename `isDaytona` → `isRemote`
  in `readRunUsage`; add `isE2b?` to `resolveRunUsage` (combines with `isDaytona` for the
  remote read).

**Note:** usage.ts change and most sandbox_agent.ts changes duplicate the sibling branch.
The codex auth upload block is unique to this branch.

---

## Task 5 — Python env config (DONE)

**Files changed:**
- `api/oss/src/utils/env.py` — add `E2bConfig` class (`E2B_API_KEY`, `E2B_TEMPLATE`) and
  `e2b: E2bConfig = E2bConfig()` on `EnvironSettings`.

**Note:** identical to the `chore-add-sandbox-e2b` sibling branch. Reconcile on merge.

---

## Task 6 — Tests (DONE)

**Files added:**
- `services/agent/tests/unit/sandbox-agent-e2b-run-plan.test.ts` — unit tests for E2B
  run-plan: `isE2b` and E2B cwd, `isE2b=false` on local/daytona, restricted-network refusal
  (strict and best_effort), E2B_NETWORK_UNSUPPORTED_MESSAGE constant, unrestricted/no-perm
  allows, **codex-on-E2B plan fields**.
- `services/agent/tests/unit/sandbox-agent-e2b-provider.test.ts` — unit tests for E2B
  provider: `e2bTimeoutMs` clamping/defaults, `buildE2bCreate` fields (timeoutMs, autoPause,
  envs merge).
- `services/agent/tests/unit/sandbox-agent-codex-e2b.test.ts` — codex-specific E2B tests:
  auth.json upload into sandbox, daemon env carries only OPENAI_API_KEY, local auth write
  gated on `!isE2b`.

**Note:** the run-plan and provider test files are identical to the sibling branch's versions
plus the codex-on-E2B run-plan case. The codex-specific test file is unique to this branch.

---

## Open decisions

1. **Codex binary in template**: confirm whether `agenta-sandbox-agent` template bakes the
   codex binary or relies on auto-install. If auto-install, document the node >= 22.19
   requirement and the first-run latency.
2. **`CODEX_API_KEY` passthrough**: the daemon's `KNOWN_PROVIDER_ENV_VARS` already includes
   `CODEX_API_KEY`. Confirm whether the auth.json upload should prefer `CODEX_API_KEY` over
   `OPENAI_API_KEY` when both are present. Current implementation uses `OPENAI_API_KEY`.
3. **Merge sequencing**: `chore-add-sandbox-e2b` should land first so this branch's
   duplicate diffs become no-ops. After merge, remove the duplicate code and keep only the
   codex-specific additions (`uploadCodexAuthToE2bSandbox` and its call site).
