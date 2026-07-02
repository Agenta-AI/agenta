# Tasks: Foundation Remote Bootstrap

## T1 — Create `remote-assets.ts`

File: `services/runner/src/engines/sandbox_agent/remote-assets.ts`

- Export `SandboxHandle` (minimal duck-typed interface: `mkdirFs`, `writeFsFile`).
- Export `PrepareRemoteHarnessAssetsInput`.
- Export `prepareRemoteHarnessAssets` (the main dispatch).
- Export `writeCodexAuthToSandbox` (testable unit).
- `pi` case delegates to `prepareDaytonaPiAssets`; all other Pi-specific plumbing
  (`installPiInSandbox` etc.) stays in `daytona.ts`.
- `codex` case: mkdir `~/.codex`, write `auth.json`.
- `claude`, `opencode`: no-op.
- Default: log unknown agent, return.

## T2 — Update `sandbox_agent.ts`

- Import `prepareRemoteHarnessAssets` from `./sandbox_agent/remote-assets.ts`.
- Replace the `if (plan.isDaytona) { await prepareDaytonaPiAssets(...) }` block with
  `if (plan.isDaytona) { await prepareRemoteHarnessAssets(...) }`.
- Remove the now-redundant `prepareDaytonaPiAssets` import (it is called via
  `prepareRemoteHarnessAssets`).
- Note: `isE2b` extension will widen the guard to `isDaytona || isE2b` in the sibling
  worktree; the seam is already ready.

## T3 — Add unit tests

File: `services/runner/tests/unit/sandbox-agent-remote-assets.test.ts`

Six tests (see specs.md). Each uses a minimal in-memory sandbox stub; no disk access.

## T4 — Typecheck + test

```
cd services/runner
pnpm run typecheck
pnpm test
```

Both must pass (zero type errors, all tests green).

## Dependencies

- T1 before T2, T3 (they import from `remote-assets.ts`).
- T4 after T1, T2, T3.

## Out of scope

- E2B sandbox provider integration (sibling worktree `chore/add-sandbox-e2b`).
- codex/opencode harness adapters (sibling worktrees `chore/add-harness-codex`,
  `chore/add-harness-opencode`).
- Pi install/auto-install on E2B (same sibling worktree).
- opencode provider-key selection (multiple providers supported; env already carries the
  right key from `plan.secrets`; no file write needed).
