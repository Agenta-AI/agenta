# Specs: Foundation Remote Bootstrap

## Seam: `prepareRemoteHarnessAssets`

File: `services/runner/src/engines/sandbox_agent/remote-assets.ts`

### Interface

```ts
export interface SandboxHandle {
  mkdirFs(opts: { path: string }): Promise<unknown>;
  writeFsFile(opts: { path: string }, content: string): Promise<unknown>;
}

export interface PrepareRemoteHarnessAssetsInput {
  sandbox: SandboxHandle;
  plan: Pick<RunPlan,
    | "acpAgent"
    | "secrets"
    | "credentialMode"
    | "hasApiKey"
    | "isPi"
    | "skillDirs"
    | "hasSystemPrompt"
    | "systemPrompt"
    | "appendSystemPrompt"
  >;
  log?: (message: string) => void;
}

export async function prepareRemoteHarnessAssets(
  input: PrepareRemoteHarnessAssetsInput,
): Promise<void>
```

### Dispatch

```
switch (plan.acpAgent) {
  case "pi":      → prepareDaytonaPiAssets (unchanged)
  case "codex":   → writeCodexAuthToSandbox
  case "claude":  → no-op
  case "opencode":→ no-op
  default:        → log warning
}
```

### `writeCodexAuthToSandbox`

Writes `~/.codex/auth.json`:

```json
{ "providers": [{ "name": "openai", "apiKey": "<OPENAI_API_KEY>" }] }
```

Source: `plan.secrets.OPENAI_API_KEY`. Best-effort: if the key is absent (empty string or
undefined), logs and skips. Always writes the file regardless of `credentialMode` (codex
always reads it from disk).

### Security

- The auth file content is derived solely from `plan.secrets`, which was already cleared-then-
  applied (Security rule 5). No extra clearing needed here.
- `shouldUploadOwnLogin` semantics do not apply to codex: codex has no OAuth login, only an
  API key. The file is written whenever the key is present.

## Call site change: `sandbox_agent.ts`

Replace the existing `if (plan.isDaytona)` block:

```diff
-   if (plan.isDaytona) {
-     await prepareDaytonaPiAssets({ sandbox, plan, log: logger });
-   }
+   if (plan.isDaytona || (plan as any).isE2b) {
+     await prepareRemoteHarnessAssets({ sandbox, plan, log: logger });
+   }
```

`plan.isE2b` is a future field (`chore/add-sandbox-e2b`); the cast avoids a compile error
until that field is added to `RunPlan`. Once E2B lands the cast drops.

## Tests

File: `services/runner/tests/unit/sandbox-agent-remote-assets.test.ts`

(Not `src/engines/sandbox_agent/__tests__/`: the vitest config includes only
`tests/unit/**/*.test.ts`; a `__tests__` dir inside `src/` would be silently skipped.)

### Coverage

1. Pi → delegates to `prepareDaytonaPiAssets` (calls `mkdirFs` / `writeFsFile` for Pi auth)
2. Codex → writes `~/.codex/auth.json` with the resolved key
3. Codex with no key → logs, skips the write
4. Claude → no writes (no-op)
5. Opencode → no writes (no-op)
6. Unknown acpAgent → no throw (log + return)
