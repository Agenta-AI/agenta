# Claude on E2B — investigation

## Goal

Make `harness="claude"` + `sandbox="e2b"` a working combination. This worktree builds on the
`add-sandbox-e2b` base (Pi-on-E2B already works). The Claude harness is the second matrix
entry; Codex/opencode on E2B follow the same pattern.

## What exists on the base branch

### E2B provider

`services/agent/src/engines/sandbox_agent/provider.ts` — `buildE2bCreate` + `buildSandboxProvider`
E2B arm. Template defaults to `E2B_TEMPLATE` env or `"agenta-sandbox-agent"`. The daemon
(`sandbox-agent`) auto-installs Claude at `createSession` time via `install-agent claude` —
this is NOT baked into the template (Pi is baked; Claude is runtime-installed by the daemon).

### Claude harness

`sdks/python/agenta/sdk/agents/adapters/harnesses.py` — `ClaudeHarness` maps to `acpAgent="claude"`.

`sdks/python/agenta/sdk/agents/dtos.py` — `ClaudeAgentTemplate.wire_harness_files()` calls
`build_claude_settings_files` and returns `{"harnessFiles": [{"path": ".claude/settings.json",
"content": "..."}]}`. When permissions are empty, returns `{}` (no harnessFiles).

`sdks/python/agenta/sdk/agents/adapters/claude_settings.py` — `build_claude_settings_files`
merges author permissions, sandbox-derived deny rules, and MCP/tool permissions into a single
`.claude/settings.json` payload.

`services/agent/src/engines/sandbox_agent.ts` — `applyClaudeConnectionEnv` sets `ENABLE_TOOL_SEARCH=false`,
Bedrock/Vertex env, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`. This env is set in the local daemon
env dict; on E2B it reaches the daemon through the `buildE2bCreate` envs (plan secrets include
`ANTHROPIC_API_KEY`; `applyClaudeConnectionEnv` additional vars are merged into `env` before
`buildSandboxProvider` is called).

### `prepareE2bPiAssets` (Pi-only)

`services/agent/src/engines/sandbox_agent/e2b.ts` — guards on `plan.isPi` and returns early for
Claude. Pi-specific: uploads `auth.json` (OAuth fallback), `agenta.js` extension, skills,
system-prompt files.

Claude needs none of those Pi-specific assets. The daemon handles Claude install. What Claude
does need provisioned into the E2B sandbox:

- `harnessFiles` (`.claude/settings.json` etc.) written to `plan.cwd` inside the sandbox
- skills under `<cwd>/.claude/skills/<name>/` (project-local tree, same as Daytona)
- `ANTHROPIC_API_KEY` (or own-login credentials) in the daemon env

### `prepareWorkspace` (Daytona + local, no E2B arm)

`services/agent/src/engines/sandbox_agent/workspace.ts` — handles `isDaytona` (remote fs API)
or falls through to local. For E2B Claude, the cwd lives in the E2B sandbox (`/root/work/agenta-<hex>`),
not on the runner host. The local branch writes to the runner's filesystem — incorrect for E2B.

The Daytona arm uses `sandbox.mkdirFs` + `sandbox.writeFsFile`; the E2B provider exposes the
same API (same `sandbox-agent` package, same SandboxHandle interface).

## The two gaps

| Gap | Fix |
|---|---|
| `prepareWorkspace` falls through to local for E2B | Extend `PrepareWorkspaceInput` plan type with `isE2b`; add `isDaytona \|\| isE2b` arm that uses the sandbox fs API. The Daytona and E2B arms are identical in shape (both use `sandbox.mkdirFs` / `sandbox.writeFsFile`). |
| `prepareE2bPiAssets` returns early for Claude | Add `prepareE2bClaudeAssets` that uploads the Claude own-login from `~/.claude/` if `credentialMode === "runtime_provided"` (same gate as Pi's auth.json path). Wire it in `sandbox_agent.ts` next to the Pi call. |

## Credential modes

- `credentialMode="env"`: `ANTHROPIC_API_KEY` arrives in `plan.secrets`, merged into `env` before
  `buildSandboxProvider`, and carried into the sandbox through `buildE2bCreate({}, secrets).envs`.
  No file upload needed.
- `credentialMode="runtime_provided"`: the user's own Claude login (`~/.claude/` OAuth state).
  Upload `.claude/` credentials dir into the E2B sandbox — mirrors Pi's `uploadPiAuthToE2bSandbox`.
  Best-effort (same policy as Pi auth upload).
- `credentialMode="none"` / missing: no credential action.

## Teardown / leak parity

The per-run `finally` in `sandbox_agent.ts` calls `sandbox.destroySandbox()` on every path
(normal, error, signal). `buildE2bCreate` sets `autoPause: true` and `timeoutMs` (default 30 min)
as a backstop for process-KILL leaks. This is identical for Claude-on-E2B — no new teardown code.

## Restricted-network refusal

`buildRunPlan` already refuses any restricted-network E2B run before the harness is checked.
Claude-on-E2B inherits this gate unchanged; no new code needed.

## Foundation seam

A parallel worktree is generalizing non-Pi remote bootstrap. This branch implements the Claude
arm directly (clone + specialize), noting where the code would fold:

- `prepareWorkspace` E2B arm → folds onto a single `isDaytona || isE2b` branch (already done here).
- `prepareE2bClaudeAssets` own-login upload → folds onto a generic `prepareE2bHarnessAssets`
  that dispatches by `acpAgent`. The Pi arm stays separate (pi-specific: extension, skills-in-pi-dir,
  system-prompt).
- `buildE2bCreate` envs param already carries arbitrary secrets → no change needed.
