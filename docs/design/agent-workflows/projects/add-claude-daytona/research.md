# Claude on Daytona — investigation

## Goal

Make `harness="claude" sandbox="daytona"` work with both credential modes. This is the last
unbuilt cell of the harness x sandbox matrix (pi/codex/opencode x local/e2b/daytona, and
claude x local/e2b, all already exist on prior branches).

## How Pi-on-Daytona works today (the shape to clone)

Flow through `services/runner/src/engines/sandbox_agent.ts` for a Daytona run:

```
buildRunPlan           -> plan.isDaytona = true, plan.acpAgent = "claude"
buildSandboxProvider   -> daytona({ create: buildDaytonaCreate(piExtEnv, secrets, ...) })
SandboxAgent.start     -> creates the remote sandbox
prepareDaytonaPiAssets -> no-op for claude (guards on plan.isPi)
prepareWorkspace       -> mkdir cwd, relay dir, AGENTS.md, harnessFiles, skills
createSession({ agent: "claude", cwd })
```

Key files:
- `services/runner/src/engines/sandbox_agent/daytona.ts` -- `prepareDaytonaPiAssets`,
  `uploadPiAuthToSandbox`, `DAYTONA_PI_DIR`, `daytonaEnvVars`, `createCookieFetch`
- `services/runner/src/engines/sandbox_agent/provider.ts` -- `buildDaytonaCreate` seeds the
  create-time env from `daytonaEnvVars(piExtEnv, secrets)`
- `services/runner/src/engines/sandbox_agent/workspace.ts` -- `prepareWorkspace`'s
  `isDaytona` branch writes `harnessFiles` (Claude's rendered `.claude/settings.json`) via
  `sandbox.writeFsFile`
- `services/runner/src/engines/sandbox_agent.ts` -- orchestration; the
  `if (plan.isDaytona)` block currently calls only `prepareDaytonaPiAssets`

## What already works for claude x daytona on this base

- **Managed credentials**: `ANTHROPIC_API_KEY` is in `plan.secrets` on a `credentialMode="env"`
  run. `daytonaEnvVars(piExtEnv, secrets)` spreads `secrets` into the Daytona create-time
  `envVars`, so the key reaches the sandbox daemon's environment with no extra code.
- **harnessFiles**: the Python `ClaudeHarness` adapter renders `.claude/settings.json` and
  sets it on `request.harnessFiles`. `prepareWorkspace`'s `isDaytona` branch already writes
  every `harnessFiles` entry into `plan.cwd` via the sandbox FS API, unconditionally of
  harness -- this needed no Claude-specific code.
- **The claude binary**: the sandbox-agent daemon auto-installs the harness CLI on
  `createSession({ agent: "claude" })`, the same auto-install Pi and codex get on Daytona
  (see `services/runner/src/engines/sandbox_agent/provider.ts`, `buildDaytonaCreate` comment
  on the image/snapshot needing "the daemon and harness CLI" -- auto-install covers the gap
  when the image lacks it, mirroring `DAYTONA_PI_INSTALL` for Pi). No install step is added
  here; the codex-daytona precedent made the same call.

## The one gap: own-login (`runtime_provided`) credentials

`prepareDaytonaPiAssets` early-returns for any non-Pi harness (`if (!plan.isPi) return;`).
There is no Daytona-side equivalent for Claude, so a self-managed
(`credentialMode="runtime_provided"`) Claude-on-Daytona run has no `.credentials.json` in the
sandbox -- the harness has no login and the run fails to authenticate. This mirrors exactly
the gap `prepareDaytonaCodexAssets` (codex-daytona worktree) closed for codex.

## Daemon user / home verification

`DAYTONA_PI_DIR` and `DAYTONA_CODEX_DIR` (both precedent constants in `daytona.ts`) default to
`/home/sandbox/.pi/agent` and `/home/sandbox/.codex` respectively, both documented inline as
"on common Daytona images (daemon runs as user `sandbox`)". `run-plan.ts`'s
`defaultDaytonaCwd` independently derives run cwds under `/home/sandbox/agenta-<hex>`, and the
runtime remount path in `sandbox_agent.ts` uses `/home/sandbox/agenta/<prefix>` for the durable
cwd. All three agree: the Daytona sandbox-agent image runs its daemon as the `sandbox` user
with home `/home/sandbox`. Claude's own-login dir follows the same convention:
`/home/sandbox/.claude`.

## What Claude needs provisioned remotely

| Item | Where | Mechanism |
|---|---|---|
| `.credentials.json` (own-login) | sandbox FS | write via `sandbox.writeFsFile`, allow-listed |
| `ANTHROPIC_API_KEY` (managed) | daemon env at create time | already in `secrets`, flows through `daytonaEnvVars` -> `buildDaytonaCreate` |
| `.claude/settings.json` | sandbox FS | already handled by `prepareWorkspace`'s `harnessFiles` loop |
| claude binary | auto-installed | daemon does this on `createSession({ agent: "claude" })`; no action needed |

The primary (only) blocker is `.credentials.json`. Per the E2B precedent
(`chore-add-claude-e2b`'s `e2b.ts`), the allow-list is deliberately narrow: only
`.credentials.json`, never `settings.json` (the run's own rendered `harnessFiles` copy must
win over the host user's settings) and never a directory scan (`readdirSync`) that would
over-share `.mcp.json` (other services' MCP tokens), `history.jsonl`, or caches.

## Credential modes

Same two modes as the E2B and codex-daytona precedents:

- **Managed (`credentialMode="env"`)**: `ANTHROPIC_API_KEY` already in `plan.secrets`, already
  in the Daytona create-time env via `daytonaEnvVars`. No file upload -- the daemon reads the
  key from its own environment.
- **Self-managed (`runtime_provided`)**: upload the runner's own `.credentials.json` into the
  sandbox, mirroring `uploadPiAuthToSandbox` / `uploadCodexAuthToSandbox` / the E2B
  `uploadClaudeAuthToE2BSandbox`.

The gate reuses `shouldUploadOwnLogin` from `run-plan.ts` (same rule already used by Pi,
codex, and E2B Claude): upload only when `credentialMode === "runtime_provided"`, or (back-compat)
when no `credentialMode` was sent and no api key is present.

## Env override precedent

`AGENTA_AGENT_SANDBOX_PI_DIR` / `AGENTA_AGENT_SANDBOX_CODEX_DIR` (Daytona) and
`AGENTA_AGENT_SANDBOX_CLAUDE_DIR` (already defined for E2B in `e2b.ts`) all follow the same
naming shape: `AGENTA_AGENT_SANDBOX_<HARNESS>_DIR`. This branch reuses the SAME env var name,
`AGENTA_AGENT_SANDBOX_CLAUDE_DIR`, for the Daytona destination override -- one override
controls both sandbox kinds' Claude dir, consistent with how each harness has exactly one
override var across sandbox types.

## Known limitation: gateway/custom tools on claude x daytona

The `gateway-tool-mcp` design (`docs/design/agent-workflows/projects/gateway-tool-mcp/`)
tracks that Claude runs carrying gateway/custom tools currently hit a hard failure
(`ok:false`) at delivery, not a silent drop -- a prior PR disabled the internal MCP channel
alongside the (correctly) disabled user-facing stdio MCP. This applies to Claude on ANY
sandbox, including Daytona, and is explicitly out of scope here: the real fix (an internal
HTTP MCP channel, open question #3 in that design's status.md, notes Daytona loopback
reachability as unresolved) is tracked separately. Tool-less Claude runs, and Pi runs (which
never routed tools through that channel), are unaffected. This own-login provisioning change
does not touch tool delivery at all.

## Foundation seam note

A separate "foundation" worktree is generalizing the non-Pi remote bootstrap. The
Claude-specific path added here (`prepareDaytonaClaudeAssets`, `uploadClaudeAuthToSandbox`) is
deliberately Claude-shaped and parallel to the Pi and codex shapes on THIS base -- it does not
block on the foundation, and does not merge with the sibling `chore-add-codex-daytona`
branch's `prepareDaytonaCodexAssets` (a stacked merge will place both calls side by side in
the `if (plan.isDaytona)` block). When the foundation lands, all three fold into a single
generic `prepareRemoteHarnessAssets` dispatch.

## Files to change

- `services/runner/src/engines/sandbox_agent/daytona.ts` -- add `DAYTONA_CLAUDE_DIR`,
  `uploadClaudeAuthToSandbox`, `prepareDaytonaClaudeAssets`
- `services/runner/src/engines/sandbox_agent.ts` -- call `prepareDaytonaClaudeAssets` in the
  `if (plan.isDaytona)` block, next to the existing `prepareDaytonaPiAssets` call
- Tests: extend `services/runner/tests/unit/sandbox-agent-daytona.test.ts`
- No Python SDK changes needed (the Daytona path is purely a runner concern)
