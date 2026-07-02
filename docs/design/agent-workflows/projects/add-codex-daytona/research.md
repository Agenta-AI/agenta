# Codex harness on Daytona — investigation

## Goal

Make `harness="codex" sandbox="daytona"` work. The codex-local branch already ships
`CodexHarness`, `HarnessType.CODEX`, `CodexAgentTemplate`, the `codex` ACP agent mapping in
`run-plan.ts`, `CODEX_API_KEY` in `KNOWN_PROVIDER_ENV_VARS`, and `writeCodexAuthFile()` for
local runs. This worktree extends that to the remote (Daytona) sandbox axis.

## How Pi-on-Daytona works today (the shape to clone)

Flow through `sandbox_agent.ts` for a Daytona run:

```
buildRunPlan          → plan.isDaytona = true
buildSandboxProvider  → daytona({ create: buildDaytonaCreate(piExtEnv, secrets, ...) })
SandboxAgent.start    → creates the remote sandbox
prepareDaytonaPiAssets → uploads Pi login, extension, skills, system prompts; installs pi CLI
prepareWorkspace      → mkdir cwd, relay dir, AGENTS.md, harnessFiles
createSession({ agent: "pi"|"claude", cwd })
```

Key files:
- `services/agent/src/engines/sandbox_agent/daytona.ts` — `prepareDaytonaPiAssets`,
  `uploadPiAuthToSandbox`, `DAYTONA_PI_DIR`, `daytonaEnvVars`, `createCookieFetch`
- `services/agent/src/engines/sandbox_agent/provider.ts` — `buildDaytonaCreate`,
  `daytonaEnvVars` used to seed the create-time env
- `services/agent/src/engines/sandbox_agent/sandbox_agent.ts` — orchestration;
  the `if (plan.isDaytona)` block that calls `prepareDaytonaPiAssets`

## Why `prepareDaytonaPiAssets` early-returns for non-Pi

Line 120: `if (!plan.isPi) return;`. The Pi path is the only remote-bootstrap case that
existed before the codex-local worktree; a codex Daytona run silently does nothing here
because `isPi` is false for codex. The local path writes `~/.codex/auth.json` via
`writeCodexAuthFile`, but that branch is guarded `!plan.isDaytona`, so a codex-on-Daytona
run receives no credentials at all.

## What codex needs provisioned remotely

| Item | Where | Mechanism |
|---|---|---|
| `~/.codex/auth.json` | sandbox FS | write via `sandbox.writeFsFile` |
| `OPENAI_API_KEY` (managed) | daemon env at create time | already in `secrets`, flows through `daytonaEnvVars` → `buildDaytonaCreate` |
| codex binary | auto-installed | daemon does this on `createSession({ agent: "codex" })`; no action needed |

The primary blocker is `~/.codex/auth.json`. The codex CLI reads it as a FILE, not just the
env var — confirmed in the PoC matrix (codex/sessions/demo). The sandbox user is `sandbox`
so the path is `/home/sandbox/.codex/auth.json`.

## Credential modes

Same two modes as local (per the codex-local specs):

- **Managed (`credentialMode="env"`)**: `OPENAI_API_KEY` already in `plan.secrets`, already
  in the Daytona create-time env via `daytonaEnvVars`. Still need to write `auth.json`
  from that key INTO the sandbox.
- **Self-managed (`runtime_provided`)**: upload the runner's own `~/.codex/auth.json` into
  the sandbox, mirroring `uploadPiAuthToSandbox`.

The gate logic reuses `shouldUploadOwnLogin` (same rule as Pi, defined in `run-plan.ts`).

## Foundation seam note

A separate "foundation" worktree is generalizing the non-Pi remote bootstrap. The codex-
specific path added here (`prepareDaytonaCodexAssets`, `uploadCodexAuthToSandbox`) is
deliberately codex-shaped and parallel to the Pi shape — it does NOT block on the foundation.
When the foundation lands, this code folds into the generic remote-bootstrap seam:
`prepareDaytonaCodexAssets` becomes a call into the foundation's `prepareRemoteHarnessAssets`
with a codex-flavored credential writer.

## Files to change

- `services/agent/src/engines/sandbox_agent/daytona.ts` — add `DAYTONA_CODEX_DIR`,
  `uploadCodexAuthToSandbox`, `prepareDaytonaCodexAssets`
- `services/agent/src/engines/sandbox_agent/sandbox_agent.ts` — call
  `prepareDaytonaCodexAssets` in the `if (plan.isDaytona)` block
- Tests: extend `sandbox-agent-daytona.test.ts`
- No Python SDK changes needed (the Daytona path is purely a runner concern)
