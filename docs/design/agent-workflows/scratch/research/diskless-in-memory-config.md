# Pi agent harness: diskless / in-memory config

Research target: Pi coding agent (pi.dev, Earendil Inc.), npm
`@earendil-works/pi-coding-agent`, verified against version **0.79.4** (matches the
version installed by `npm view`). All signatures below are quoted from the published
package's TypeScript declaration files (`dist/**/*.d.ts`), the compiled JS
(`dist/**/*.js`), the bundled SDK examples (`examples/sdk/*.ts`), and the dependency
`@earendil-works/pi-ai@0.79.4`. Source URLs are in the Sources section.

## Summary / net answer

**Yes — Pi can run fully diskless with all invocation-specific data in process memory.**
Every invocation-specific input we care about has a confirmed in-memory path:

- **System prompt / AGENTS.md**: pass as in-memory strings via `DefaultResourceLoader`
  (`systemPrompt` / `systemPromptOverride`, `appendSystemPrompt` /
  `appendSystemPromptOverride`, `agentsFilesOverride`). No file required.
- **Skills**: register in-memory `Skill` objects via `skillsOverride`, or point at an
  arbitrary directory via `additionalSkillPaths`. No fixed disk convention required.
- **Provider auth**: `AuthStorage.inMemory()` + `setRuntimeApiKey(provider, key)` (not
  persisted), or per-provider env vars. Both confirmed disk-free.
- **Custom tools**: defined in-process via `customTools: ToolDefinition[]` /
  `defineTool(...)` or `pi.registerTool(...)` in an inline `extensionFactories` function.
  No file.
- **Sessions/state**: `SessionManager.inMemory()` writes nothing.
  `SettingsManager.inMemory()` and `ModelRegistry.inMemory()` likewise avoid disk.

The one thing that is **not** purely in-memory is bash/tool **output spillover**: when a
bash command (or a tool using the output accumulator) exceeds an in-memory byte
threshold, Pi spills the tail to a temp file under `os.tmpdir()`. This is the only
unavoidable write in a headless run that uses the bash/grep/find tools. Point `TMPDIR`
at a tmpfs (or make `/tmp` tmpfs) and it never touches a persistent volume.

If you drive Pi via the **SDK** (`createAgentSession`) rather than the CLI, you also avoid
startup migrations and the CLI's `agentDir` touches entirely. If you drive it via
`pi --mode rpc`/`--print` (the `main()` CLI entrypoint), redirect `agentDir` and
`sessionDir` to tmpfs and pass `--no-session`.

---

## Per-question findings

### 1. System prompt / AGENTS.md in memory — CONFIRMED in-memory

The system prompt and AGENTS.md content are supplied through the `ResourceLoader`, not
through top-level `createAgentSession` options. `DefaultResourceLoaderOptions` exposes
both direct values and override callbacks (quoted from
`dist/core/resource-loader.d.ts`):

```typescript
export interface DefaultResourceLoaderOptions {
    cwd: string;
    agentDir: string;
    ...
    noContextFiles?: boolean;          // disable AGENTS.md discovery from disk
    systemPrompt?: string;             // in-memory base system prompt
    appendSystemPrompt?: string[];     // in-memory appended instructions
    ...
    agentsFilesOverride?: (base: {
        agentsFiles: Array<{ path: string; content: string }>;
    }) => { agentsFiles: Array<{ path: string; content: string }> };
    systemPromptOverride?: (base: string | undefined) => string | undefined;
    appendSystemPromptOverride?: (base: string[]) => string[];
}
```

The `ResourceLoader` interface returns these to the session via
`getSystemPrompt(): string | undefined`, `getAppendSystemPrompt(): string[]`, and
`getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> }`.

**Replace the entire system prompt (in memory)** — from `examples/sdk/03-custom-prompt.ts`:

```typescript
const loader1 = new DefaultResourceLoader({
    cwd, agentDir,
    systemPromptOverride: () => `You are a helpful assistant that speaks like a pirate.
Always end responses with "Arrr!"`,
    // Needed to avoid DefaultResourceLoader appending APPEND_SYSTEM.md from ~/.pi/agent or <cwd>/.pi.
    appendSystemPromptOverride: () => [],
});
await loader1.reload();
const { session } = await createAgentSession({
    resourceLoader: loader1,
    sessionManager: SessionManager.inMemory(),
});
```

**Inject AGENTS.md content in memory** — from `examples/sdk/07-context-files.ts`:

```typescript
const loader = new DefaultResourceLoader({
    cwd: process.cwd(), agentDir: getAgentDir(),
    agentsFilesOverride: (current) => ({
        agentsFiles: [
            ...current.agentsFiles,
            { path: "/virtual/AGENTS.md", content: `# Project Guidelines ...` },
        ],
    }),
});
```

Note the file comment: "Disable context files entirely by returning an empty list in
`agentsFilesOverride`." (return `{ agentsFiles: [] }`), or set `noContextFiles: true`.

**Where Pi reads AGENTS.md from disk by default** (so it can be pointed at tmpfs or
disabled): `loadProjectContextFiles({ cwd, agentDir })` walks from `cwd` upward and reads
the `agentDir`. CLI flag to disable: `--no-context-files` (`Args.noContextFiles`).
The CLI also exposes `--system-prompt` and `--append-system-prompt`
(`Args.systemPrompt?: string`, `Args.appendSystemPrompt?: string[]` in
`dist/cli/args.d.ts`), so over RPC/print mode you can pass the prompt as a process arg
(in memory, no file).

### 2. Skills in memory — CONFIRMED both in-memory registration and arbitrary path

Skills are normally a **directory-of-files** convention. From `dist/core/skills.d.ts`
(`loadSkillsFromDir` doc comment):

> Discovery rules:
> - if a directory contains SKILL.md, treat it as a skill root and do not recurse further
> - otherwise, load direct .md children in the root
> - recurse into subdirectories to find SKILL.md

Default discovery locations (from the docs and `DefaultResourceLoader`): `.pi/skills/`,
`.agents/skills/` (walking up), `~/.agents/skills/`, `~/.pi/agent/skills/`.

A `Skill` is a plain object, so it can be created **in memory** with no file:

```typescript
export interface Skill {
    name: string;
    description: string;
    filePath: string;
    baseDir: string;
    sourceInfo: SourceInfo;
    disableModelInvocation: boolean;
}
```

**Register an in-memory skill** — from `examples/sdk/04-skills.ts`:

```typescript
const customSkill: Skill = {
    name: "my-skill",
    description: "Custom project instructions",
    filePath: "/virtual/SKILL.md",
    baseDir: "/virtual",
    sourceInfo: createSyntheticSourceInfo("/virtual/SKILL.md", { source: "sdk" }),
    disableModelInvocation: false,
};
const loader = new DefaultResourceLoader({
    cwd: process.cwd(), agentDir: getAgentDir(),
    skillsOverride: (current) => ({
        skills: [...current.skills, customSkill],
        diagnostics: current.diagnostics,
    }),
});
```

**Point skills at an arbitrary path**: `DefaultResourceLoaderOptions.additionalSkillPaths?:
string[]` (and `noSkills?: boolean` to disable default discovery). CLI equivalents:
`--skills <paths>` (`Args.skills?: string[]`) and `--no-skills` (`Args.noSkills`).
The lower-level `loadSkills({ cwd, agentDir, skillPaths, includeDefaults })` confirms
`skillPaths` is an explicit list and `includeDefaults` can be turned off.

Caveat: the skill's `filePath`/`baseDir` only matter if the skill body is read lazily on
invocation. For a fully synthetic in-memory skill you must ensure the content is provided
up front; if Pi reads `filePath` on `/skill:name` invocation it would need that path to
exist. For pure "inject instructions into the system prompt" use, `formatSkillsForPrompt`
uses `name`/`description` and the prompt formatting only. UNVERIFIED whether explicit
`/skill:name` expansion re-reads `filePath` from disk for an SDK-injected synthetic skill;
to be safe, point synthetic skills at a tmpfs path or set
`disableModelInvocation`/use systemPrompt injection instead.

### 3. Provider / LLM auth in memory — CONFIRMED (three disk-free paths)

**(a) Environment variables.** `@earendil-works/pi-ai@0.79.4` `dist/env-api-keys.js`
contains the canonical provider→env-var map (`getApiKeyEnvVars`). Exact names:

- anthropic: `ANTHROPIC_OAUTH_TOKEN` (precedence) then `ANTHROPIC_API_KEY`
- openai: `OPENAI_API_KEY`
- google (Gemini): `GEMINI_API_KEY`
- google-vertex: `GOOGLE_CLOUD_API_KEY` (or ADC via `GOOGLE_APPLICATION_CREDENTIALS` +
  `GOOGLE_CLOUD_PROJECT`/`GCLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION`)
- amazon-bedrock: `AWS_PROFILE` | `AWS_ACCESS_KEY_ID`+`AWS_SECRET_ACCESS_KEY` |
  `AWS_BEARER_TOKEN_BEDROCK` | ECS/IRSA container creds
- azure-openai-responses: `AZURE_OPENAI_API_KEY`
- xai: `XAI_API_KEY`; groq: `GROQ_API_KEY`; cerebras: `CEREBRAS_API_KEY`;
  deepseek: `DEEPSEEK_API_KEY`; mistral: `MISTRAL_API_KEY`; nvidia: `NVIDIA_API_KEY`;
  openrouter: `OPENROUTER_API_KEY`; together: `TOGETHER_API_KEY`;
  fireworks: `FIREWORKS_API_KEY`; vercel-ai-gateway: `AI_GATEWAY_API_KEY`;
  github-copilot: `COPILOT_GITHUB_TOKEN`; huggingface: `HF_TOKEN`;
  moonshotai / moonshotai-cn: `MOONSHOT_API_KEY`; kimi-coding: `KIMI_API_KEY`;
  zai: `ZAI_API_KEY`; zai-coding-cn: `ZAI_CODING_CN_API_KEY`;
  minimax: `MINIMAX_API_KEY`; minimax-cn: `MINIMAX_CN_API_KEY`;
  opencode / opencode-go: `OPENCODE_API_KEY`; nvidia, etc.;
  cloudflare-workers-ai / cloudflare-ai-gateway: `CLOUDFLARE_API_KEY`;
  xiaomi family: `XIAOMI_API_KEY`, `XIAOMI_TOKEN_PLAN_{CN,AMS,SGP}_API_KEY`;
  ant-ling: `ANT_LING_API_KEY`.

**(b) Runtime in-memory setter — CONFIRMED.** `dist/core/auth-storage.d.ts`:

```typescript
export declare class AuthStorage {
    static create(authPath?: string): AuthStorage;
    static fromStorage(storage: AuthStorageBackend): AuthStorage;
    static inMemory(data?: AuthStorageData): AuthStorage;
    /** Set a runtime API key override (not persisted to disk). Used for CLI --api-key flag. */
    setRuntimeApiKey(provider: string, apiKey: string): void;
    removeRuntimeApiKey(provider: string): void;
    setFallbackResolver(resolver: (provider: string) => string | undefined): void;
    ...
}
export declare class InMemoryAuthStorageBackend implements AuthStorageBackend { ... }
```

So `setRuntimeApiKey(provider: string, apiKey: string): void` is real (UNVERIFIED in the
original brief — now CONFIRMED). Resolution priority in `getApiKey()`:
1. runtime override (`--api-key` / `setRuntimeApiKey`), 2. `auth.json` API key,
3. `auth.json` OAuth (auto-refreshed), 4. environment variable, 5. fallback resolver.

`AuthStorage.inMemory()` plus `InMemoryAuthStorageBackend` give a fully in-memory store.
Verified in the compiled `dist/core/auth-storage.js`: every `writeFileSync`/`mkdirSync`/
`chmodSync` call lives inside `FileAuthStorageBackend` (class starts line 17); the
`InMemoryAuthStorageBackend` class (line 127) performs no filesystem writes.

From `examples/sdk/09-api-keys-and-oauth.ts`:

```typescript
// Runtime API key override (not persisted to disk)
authStorage.setRuntimeApiKey("anthropic", "sk-my-temp-key");
// No models.json - only built-in models
const simpleRegistry = ModelRegistry.inMemory(authStorage);
```

**(c) RPC protocol credential message — NOT PRESENT.** The full `RpcCommand` union in
`dist/modes/rpc/rpc-types.d.ts` has no `set_api_key` / `set_credential` / auth message
(commands are: prompt, steer, follow_up, abort, new_session, get_state, set_model,
cycle_model, get_available_models, set_thinking_level, cycle_thinking_level,
set_steering_mode, set_follow_up_mode, compact, set_auto_compaction, set_auto_retry,
abort_retry, bash, abort_bash, get_session_stats, export_html, switch_session, fork,
clone, get_fork_messages, get_last_assistant_text, set_session_name, get_messages,
get_commands). **Implication:** in RPC mode, credentials must be supplied at process spawn
— via env vars or the `--api-key`/`--provider` CLI flags (`Args.apiKey`, `Args.provider`).
You cannot inject a key over the JSONL channel after spawn. If you need post-spawn,
in-memory key injection without env vars, drive Pi via the **SDK** and pass a custom
`AuthStorage` instead of RPC mode.

### 4. Tool auth / custom tools in memory — CONFIRMED in-process, no file

Custom tools are pure in-process definitions. Two confirmed paths:

**Via `customTools` on `createAgentSession`** (`dist/core/sdk.d.ts`):

```typescript
export interface CreateAgentSessionOptions {
    ...
    /** Custom tools to register (in addition to built-in tools). */
    customTools?: ToolDefinition[];
    ...
}
```

A `ToolDefinition` (`dist/core/extensions/types.d.ts`) carries its own `execute(...)`
function — so any auth/config the tool needs is closed over in code, no on-disk config:

```typescript
export interface ToolDefinition<TParams extends TSchema = TSchema, ...> {
    name: string; label: string; description: string;
    parameters: TParams;  // TypeBox schema
    execute(toolCallId, params, signal, onUpdate, ctx): Promise<AgentToolResult<TDetails>>;
    ...
}
export declare function defineTool<...>(tool: ToolDefinition<...>): ...;
```

**Via inline extension factory + `pi.registerTool`** (`examples/sdk/06-extensions.ts`):

```typescript
const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(), agentDir: getAgentDir(),
    extensionFactories: [
        (pi) => { pi.on("agent_start", () => { ... }); },
    ],
});
// inside an extension: pi.registerTool({ name: "my_tool", label: "My Tool", ... })
```

`ExtensionRunner.registerTool<...>(tool: ToolDefinition<...>): void` is in the type
surface. Both paths require no file: the extension can be an inline function passed in
`extensionFactories`, and tool auth is whatever the closure references (e.g. an HTTP
client back to your backend). Built-in tool selection is also code-only via
`tools`/`excludeTools`/`noTools` on `createAgentSession`.

### 5. Working directory / cwd and state files — what Pi writes, and how to redirect

**Path knobs (from `dist/config.js`):**

- `getAgentDir()` returns `process.env.PI_CODING_AGENT_DIR` (expanded) if set, else
  `~/.pi/agent`. The env var name is built as
  `` `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR` `` with `APP_NAME = "pi"`, i.e.
  **`PI_CODING_AGENT_DIR`**.
- Session dir env var **`PI_CODING_AGENT_SESSION_DIR`** (`ENV_SESSION_DIR`), read in
  `main.js`. Resolution order in CLI: `--session-dir` flag → `PI_CODING_AGENT_SESSION_DIR`
  → settings default. Default session dir:
  `getDefaultSessionDir(cwd, agentDir)` = `<agentDir>/sessions/--<encoded-cwd>--/`
  (it `mkdirSync`s the dir).
- All other config files hang off `agentDir`: `auth.json`, `models.json`, `settings.json`,
  `tools/`, `bin/`, `prompts/`, `themes/`, `sessions/`, and the debug log
  `<agentDir>/pi-debug.log`. Redirecting `PI_CODING_AGENT_DIR` moves all of them.

**SDK-level in-memory replacements (no disk):**

- `SessionManager.inMemory(cwd?)` — "Create an in-memory session (no file persistence)".
  Verified: `SessionManager` only `writeFileSync`s when `this.persist` is true; `inMemory`
  sets `persist=false`.
- `SettingsManager.inMemory(settings?)` — no `settings.json` read/write.
- `ModelRegistry.inMemory(authStorage)` — built-in models only, no `models.json`.
- `AuthStorage.inMemory()` / custom `AuthStorageBackend` — no `auth.json`.

**What Pi writes on its own during a run (headless), and how to neutralize it:**

| Writer (dist file) | Path | When | Redirect / avoid |
| --- | --- | --- | --- |
| `core/session-manager.js` | `<agentDir>/sessions/...*.jsonl` | every persisted session | `SessionManager.inMemory()` (SDK) or `--no-session` (CLI). Else `PI_CODING_AGENT_SESSION_DIR`→tmpfs. |
| `core/bash-executor.js` | `os.tmpdir()/pi-bash-<id>.log` | only when bash output exceeds `DEFAULT_MAX_BYTES` (spillover) | set `TMPDIR` to tmpfs / make `/tmp` tmpfs |
| `core/tools/output-accumulator.js` | `os.tmpdir()/<prefix>-<id>.log` | tool output spillover above threshold | same (`TMPDIR`→tmpfs) |
| `core/settings-manager.js` | `<agentDir>/settings.json`, `<cwd>/.pi/settings.json` | only on settings change with persistence | `SettingsManager.inMemory()` |
| `core/auth-storage.js` (`FileAuthStorageBackend`) | `<agentDir>/auth.json` | only with file-backed AuthStorage | `AuthStorage.inMemory()` / `setRuntimeApiKey` |
| `core/trust-manager.js` | project trust file under `<cwd>/.pi` / agentDir | only when project-trust resolution runs | avoid project `.pi` resources; SDK path skips trust prompts |
| `core/package-manager.js` | `<agentDir>/tmp/extensions/` | only when installing/loading extension packages | use inline `extensionFactories` (no package install) |
| `core/agent-session-runtime.js` | `<sessionDir>/<attached-file>` | only when attaching files + persistence | in-memory session; don't attach files |
| `core/agent-session.js` | export path | only on explicit `exportToHtml`/`exportToJsonl` | don't call exports |
| `utils/tools-manager.js` | `<agentDir>/bin/{rg,fd}` | only if `rg`/`fd` not found in PATH | pre-install ripgrep + fd in the sandbox image (it prefers system binaries in PATH) |
| `migrations.js` (CLI only) | `<agentDir>/auth.json`, `settings.json` | `main()` startup, only if legacy files present | SDK path doesn't call it; or point `PI_CODING_AGENT_DIR` at an empty tmpfs |

The interactive TUI also writes `pi-debug.log` and reads more of `agentDir`, but those
code paths (`modes/interactive/*`) do not run in `--mode rpc`, `--print`, or the SDK.

### 6. Net answer — concrete diskless recipe

**Recommended: drive Pi via the SDK (`createAgentSession`), not the RPC CLI**, because the
SDK lets you inject `AuthStorage`, system prompt, skills, AGENTS.md, and custom tools as
in-memory objects, and skips CLI startup migrations. Run many sessions in one shared
sandbox, one `createAgentSession` per invocation, each with its own in-memory loader and
auth.

Per invocation, in code (all in memory):

```typescript
const auth = AuthStorage.inMemory();
auth.setRuntimeApiKey("anthropic", perRunKey);     // never persisted

const loader = new DefaultResourceLoader({
  cwd: perRunWorkdir,                                 // a per-run tmpfs subdir
  agentDir: perRunAgentDir,                            // a per-run tmpfs subdir (or unused)
  noContextFiles: true,                                // ignore on-disk AGENTS.md
  systemPrompt: baseSystemPrompt,                      // in memory
  appendSystemPromptOverride: () => [extraInstructions],
  agentsFilesOverride: () => ({ agentsFiles: [{ path: "/virtual/AGENTS.md", content: agentsMd }] }),
  skillsOverride: (cur) => ({ skills: [...inMemorySkills], diagnostics: cur.diagnostics }),
  extensionFactories: [(pi) => { pi.registerTool(myProxyTool); }],
});
await loader.reload();

const { session } = await createAgentSession({
  cwd: perRunWorkdir,
  authStorage: auth,
  modelRegistry: ModelRegistry.inMemory(auth),
  settingsManager: SettingsManager.inMemory(),
  sessionManager: SessionManager.inMemory(perRunWorkdir),
  resourceLoader: loader,
  model: getModel("anthropic", "claude-..."),
  customTools: [/* or here instead of via extensionFactories */],
});
```

Environment for the sandbox process:

- `TMPDIR=/dev/shm/pi-tmp` (or any tmpfs) — captures bash/tool output spillover.
- Optionally `PI_CODING_AGENT_DIR=/dev/shm/pi-agent` and
  `PI_CODING_AGENT_SESSION_DIR=/dev/shm/pi-sessions` as a belt-and-suspenders redirect for
  any code path that still resolves `agentDir`/`sessionDir`.
- `PI_OFFLINE=1` to suppress version-check network/file activity (optional).
- Provider key via env var (e.g. `ANTHROPIC_API_KEY`) **only if** you use env-var auth
  instead of `setRuntimeApiKey`.
- Pre-install `ripgrep` (`rg`) and `fd` in the sandbox image so the `grep`/`find` tools
  never trigger a download to `<agentDir>/bin`.

**What must be a file (therefore tmpfs):** nothing strictly required for config. The only
forced writes are (a) bash/tool **output spillover** to `os.tmpdir()` (point `TMPDIR` at
tmpfs), and (b) any session/settings/auth persistence you opt into — all avoidable with
the `inMemory()` factories. If you instead use `pi --mode rpc`, sessions and `agentDir`
are file-based by default, so you must pass `--no-session` and redirect both env vars to
tmpfs, and you lose post-spawn in-memory key injection (RPC has no auth message).

**Verdict:** fully diskless (process memory + a tmpfs `TMPDIR`) is achievable via the SDK.
No persistent-volume write is required for prompts, skills, AGENTS.md, auth, tools, or
session state.

---

## Open questions / UNVERIFIED

- **Synthetic skill body re-read.** Whether an SDK-injected `Skill` whose `filePath` points
  at a non-existent `/virtual/SKILL.md` is safe when the model triggers `/skill:name`
  expansion (which may re-read `filePath`). The system-prompt listing only needs
  `name`/`description`, but explicit invocation might hit disk. Mitigation: put synthetic
  skills' `filePath`/`baseDir` on tmpfs, or rely on systemPrompt injection. Confirm by
  reading `_expandSkillCommand` in `dist/core/agent-session.js` or testing.
- **`os.tmpdir()` honoring `TMPDIR`.** Node's `os.tmpdir()` respects `TMPDIR` on Linux, so
  setting `TMPDIR` to a tmpfs path redirects the spillover files. This is standard Node
  behavior, not Pi-specific; verify the sandbox doesn't override `TMPDIR`.
- **OAuth refresh writes.** If you use OAuth credentials (not API keys), token refresh in
  `FileAuthStorageBackend` writes back to `auth.json`. With `AuthStorage.inMemory()` /
  `InMemoryAuthStorageBackend`, refreshed tokens stay in memory — confirm refresh path
  uses the injected backend (it goes through `withLock`/`withLockAsync`, which the
  in-memory backend implements).
- **`ModelRegistry` provider registration side effects.** `ModelRegistry.inMemory` avoids
  `models.json`, but custom provider registration (Bedrock/Vertex) may read other on-disk
  creds (`~/.aws`, ADC json). Out of scope if using API-key providers.
- Version drift: verified at 0.79.4. Re-check `rpc-types.d.ts` for an auth message and
  `resource-loader.d.ts` option names if upgrading.

---

## Sources

Primary (package source / types — inspected from the published tarball; equivalent files
on GitHub):

- `@earendil-works/pi-coding-agent@0.79.4` npm tarball, files:
  `dist/core/sdk.d.ts` (`CreateAgentSessionOptions`, `customTools`, `createAgentSession`),
  `dist/core/resource-loader.d.ts` (`DefaultResourceLoaderOptions`: `systemPrompt`,
  `appendSystemPrompt`, `systemPromptOverride`, `agentsFilesOverride`, `skillsOverride`,
  `additionalSkillPaths`, `noContextFiles`, `noSkills`),
  `dist/core/auth-storage.d.ts` + `dist/core/auth-storage.js` (`AuthStorage`,
  `setRuntimeApiKey`, `inMemory`, `InMemoryAuthStorageBackend`),
  `dist/core/session-manager.d.ts` + `.js` (`SessionManager.inMemory`, `getDefaultSessionDir`),
  `dist/core/settings-manager.js` (`inMemory`), `dist/core/model-registry.js` (`inMemory`),
  `dist/core/skills.d.ts` (`Skill`, `loadSkills`, `loadSkillsFromDir`),
  `dist/core/extensions/types.d.ts` (`ToolDefinition`, `defineTool`, `registerTool`),
  `dist/config.js` (`getAgentDir`, `ENV_AGENT_DIR=PI_CODING_AGENT_DIR`,
  `ENV_SESSION_DIR=PI_CODING_AGENT_SESSION_DIR`, session/auth/bin paths),
  `dist/cli/args.d.ts` (`--api-key`, `--system-prompt`, `--append-system-prompt`,
  `--no-session`, `--session-dir`, `--skills`, `--no-skills`, `--no-context-files`),
  `dist/modes/rpc/rpc-types.d.ts` (full `RpcCommand` union — no auth message),
  `dist/core/bash-executor.js` + `dist/core/tools/output-accumulator.js` (tmpdir spillover),
  `dist/utils/tools-manager.js` (rg/fd download, prefers system PATH binaries),
  `dist/main.js` (`runMigrations`, session-dir resolution),
  `examples/sdk/03-custom-prompt.ts`, `04-skills.ts`, `05-tools.ts`, `06-extensions.ts`,
  `07-context-files.ts`, `09-api-keys-and-oauth.ts`, `11-sessions.ts`.
- `@earendil-works/pi-ai@0.79.4` `dist/env-api-keys.js` — provider→env-var map
  (`getApiKeyEnvVars`, `getEnvApiKey`).

Docs / GitHub (corroborating):

- SDK reference: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md
- npm: https://www.npmjs.com/package/@earendil-works/pi-coding-agent
- Docs site: https://pi.dev/docs/latest/sdk
- DeepWiki overview: https://deepwiki.com/earendil-works/pi/7.1-pi-coding-agent-sdk
