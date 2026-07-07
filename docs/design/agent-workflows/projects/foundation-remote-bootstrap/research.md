# Research: Foundation Remote Bootstrap

## Problem

Non-Pi harnesses (codex, opencode, claude) on remote sandboxes (Daytona, E2B) have no credential
provisioning. `prepareDaytonaPiAssets` returns early for non-Pi. The daemon image has no
harness auth files.

## Existing paths

### Local (any harness)

Credentials live on the host already: `ANTHROPIC_API_KEY` et al in env, `~/.codex/auth.json`
on disk. `buildDaemonEnv` inherits them. No upload step needed.

### Daytona + Pi

`prepareDaytonaPiAssets` handles Pi only (returns early when `!plan.isPi`). It uploads
`auth.json`, the Agenta extension, skills, and system prompts into the sandbox via
`sandbox.writeFsFile` / `sandbox.mkdirFs`.

### Daytona + Claude

Key rides `envVars` in `buildDaytonaCreate` via `daytonaEnvVars → secrets`. The daemon
launches with those env vars in scope. No file write needed.

### E2B + Pi (proposed, sibling worktree)

Same shape as Daytona. Asset-prep must work with the E2B sandbox handle (same duck-typed API).

## Sandbox handle interface

Daytona and E2B sandbox handles both expose `mkdirFs` / `writeFsFile` through the
`sandbox-agent` npm package. The runner types this `any`; asset-prep functions use duck-typing.
A minimal `SandboxHandle` interface formalises the two methods needed for uploads.

## Per-harness credential requirements (verified vs daemon binary)

| Harness | Env key | File required | File path |
| ------- | ------- | ------------- | --------- |
| pi      | via env OR file | `auth.json` | `~/.pi/agent/auth.json` |
| claude  | `ANTHROPIC_API_KEY` in env | None | — |
| codex   | `OPENAI_API_KEY` in env | ALWAYS `~/.codex/auth.json` | `~/.codex/auth.json` |
| opencode | provider key in env | None | — |

Critical: codex reads `~/.codex/auth.json` as a file, not just env. Both `credentialMode=env`
(managed key) and `credentialMode=runtime_provided` (own login) must write that file.

## Dispatch design

`prepareRemoteHarnessAssets(plan, sandbox)`:

- `pi` → delegate to existing `prepareDaytonaPiAssets` (no change to Pi path).
- `codex` → write `~/.codex/auth.json` with the resolved `OPENAI_API_KEY`.
- `claude` → no-op (key already in env via daemon envVars).
- `opencode` → no-op (key in env).

## Call site

`sandbox_agent.ts` currently gates on `plan.isDaytona`. The call is:

```
if (plan.isDaytona) {
  await prepareDaytonaPiAssets({ sandbox, plan, log: logger });
}
```

Replace with:

```
if (plan.isDaytona || plan.isE2B) {
  await prepareRemoteHarnessAssets({ sandbox, plan, log: logger });
}
```

`plan.isE2B` lands in `chore/add-sandbox-e2b`; the seam is designed to accept it without
signature changes. Once merged, the derived `isRemoteSandbox` flag added by the E2B
branches is the eventual gate here, replacing this `isDaytona || isE2B` pair.

## No provider class hierarchy

Functions, not classes. Dispatch is a switch on `plan.acpAgent`. Same idiom as every other
helper in this directory.
