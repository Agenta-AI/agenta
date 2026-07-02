# Claude on E2B — specs

## Scope

Two TypeScript changes + Dockerfile comment + tests. Python is unchanged (the Python harness
adapter already renders `harnessFiles` generically; it has no knowledge of sandbox provider).

## workspace.ts — add E2B arm

`PrepareWorkspaceInput.plan` gains `isE2b: boolean`. The remote branch becomes `isDaytona || isE2b`:
both providers expose the same sandbox fs API (`mkdirFs`, `writeFsFile`). The cleanup returned
for E2B is `async () => {}` (same as Daytona — sandbox teardown handles the remote cwd).

The local arm is unchanged.

```
if (plan.isDaytona || plan.isE2b) {
  // use sandbox.mkdirFs / sandbox.writeFsFile
  return { cleanup: async () => {} };
}
// local arm unchanged
```

No new public exports.

## e2b.ts — add prepareE2bClaudeAssets

New export:

```typescript
export interface PrepareE2bClaudeAssetsInput {
  sandbox: any;
  plan: Pick<RunPlan, "isClaude" | "credentialMode">;
  log?: Log;
}

export async function prepareE2bClaudeAssets({
  sandbox,
  plan,
  log = () => {},
}: PrepareE2bClaudeAssetsInput): Promise<void>
```

Guards on `plan.isClaude`. When `shouldUploadOwnLogin(plan)` is true (i.e. `credentialMode ===
"runtime_provided"` or back-compat no-key heuristic), uploads `~/.claude/` state files into the
E2B sandbox at `/root/.claude/`. Best-effort (log on failure, do not throw). When `credentialMode
=== "env"` the key arrives via `buildE2bCreate` envs — no file upload.

`RunPlan` gains `isClaude: boolean` (parallel to `isPi`).

## run-plan.ts — add isClaude

```typescript
const isClaude = acpAgent === "claude";
```

Carried on the plan. The existing `isPi` assertion (`isPi === (acpAgent === "pi")`) already covers
the negative case; add a parallel `assert` for Claude.

## sandbox_agent.ts — wire prepareE2bClaudeAssets

In the E2B asset-prep block (currently only `prepareE2bPiAssets`):

```typescript
} else if (plan.isE2b) {
  await (deps.prepareE2bPiAssets ?? prepareE2bPiAssets)({ sandbox, plan, log: logger });
  await (deps.prepareE2bClaudeAssets ?? prepareE2bClaudeAssets)({ sandbox, plan, log: logger });
}
```

`SandboxAgentDeps` gains `prepareE2bClaudeAssets?: typeof prepareE2bClaudeAssets`.

## Dockerfile / README

`sandbox-images/e2b/e2b.Dockerfile` — no new layer (daemon already installs Claude via
`install-agent claude` at `createSession`). Update the header comment to mention Claude.

`sandbox-images/e2b/README.md` — update "What is baked in" to clarify Claude is runtime-installed
by the daemon, not baked, and that Claude-on-E2B is now supported.

## Credential flow summary

```
credentialMode="env":
  ANTHROPIC_API_KEY in plan.secrets
  → merged into env by sandbox_agent.ts
  → carried into sandbox by buildE2bCreate({}, secrets).envs
  (no file upload)

credentialMode="runtime_provided":
  prepareE2bClaudeAssets uploads ~/.claude/ into /root/.claude/ in the sandbox
  (best-effort; same pattern as Pi auth.json upload)
```

## Security invariants

- Managed key never written to the sandbox filesystem (env-only, same as Pi-on-E2B).
- Own-login upload is gated by `shouldUploadOwnLogin` (same function as Pi), so it never fires
  when a resolved key is present.
- Restricted-network refusal already in `buildRunPlan` — unchanged.
- `autoPause: true` + `timeoutMs` backstop already in `buildE2bCreate` — unchanged.

## Foundation seam

When the non-Pi remote-bootstrap generalization lands, the `prepareE2bClaudeAssets` function
folds into a generic `prepareE2bHarnessAssets(plan)` dispatcher. The `isDaytona || isE2b`
workspace arm is already the generalized form.
