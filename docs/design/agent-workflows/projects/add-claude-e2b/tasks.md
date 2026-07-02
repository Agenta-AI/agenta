# Claude on E2B — tasks

## Done

- [x] Research: understand Pi-on-E2B shape, Claude harness provisioning, and the two gaps.

## Implementation

- [x] `run-plan.ts`: add `isClaude: boolean` to `RunPlan`; derive from `acpAgent === "claude"`.
- [x] `workspace.ts`: extend `PrepareWorkspaceInput.plan` with `isE2b`; change `if (plan.isDaytona)`
      to `if (plan.isDaytona || plan.isE2b)` so E2B uses the sandbox fs API.
- [x] `e2b.ts`: add `prepareE2bClaudeAssets` — uploads `~/.claude/` on `runtime_provided` credential
      mode; export `PrepareE2bClaudeAssetsInput`.
- [x] `sandbox_agent.ts`: import and call `prepareE2bClaudeAssets` in the E2B block; add it to
      `SandboxAgentDeps`.
- [x] `sandbox-images/e2b/e2b.Dockerfile`: update header comment (Claude is runtime-installed).
- [x] `sandbox-images/e2b/README.md`: update scope section; Claude-on-E2B now supported.

## Tests (unit)

- [x] `tests/unit/sandbox-agent-workspace.test.ts`: E2B arm — harnessFiles written via sandbox fs
      API; skills uploaded; no .claude path touched on Pi-on-E2B.
- [x] `tests/unit/sandbox-agent-e2b-assets.test.ts`: `prepareE2bClaudeAssets` — own-login upload
      on `runtime_provided`; skipped on `env`; skipped on `none`; skipped when `isClaude=false`;
      best-effort (sandbox error logged, not thrown).
- [x] `tests/unit/sandbox-agent-e2b-run-plan.test.ts`: `isClaude` flag — claude harness sets
      `isClaude=true`, pi sets `isClaude=false`.
- [x] `tests/unit/sandbox-agent-orchestration.test.ts`: Claude-on-E2B flow — uses sandbox fs API
      for workspace; `prepareE2bClaudeAssets` injected and called; teardown fires.

## Tests (integration — requires live E2B account)

These are marked `@skip` / described with a comment — they verify the end-to-end:

- Claude-on-E2B returns a non-empty output and a trace ID.
- E2B sandbox is torn down after the run (no leaked sandbox ID).

## Not in scope

- Codex/opencode on E2B (later matrix entries).
- Baking Claude Code into the E2B template (daemon installs it at createSession via `install-agent claude`).
- Any Python changes (harnessFiles are already emitted generically by `ClaudeAgentTemplate.wire_harness_files`).
