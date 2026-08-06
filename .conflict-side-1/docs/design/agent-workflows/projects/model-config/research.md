# Pi model configuration: research and root cause of the default-only ACP path

This doc explains how Pi configures providers and models, and why the sandbox-agent (ACP) path
exposes only the model value `default` while the in-process Pi path honors a requested
model. It backs the proposal in `proposal.md`. The finding it fixes is F-007 in
`../qa/findings.md`.

All claims here are traced to either the installed package source under
`services/agent/node_modules/` or to Pi's upstream docs. Inline citations give exact files
and line ranges so a future reader can re-derive every step.

## TL;DR

Pi knows every model for every provider it ships. It only marks a model **available** when
that provider has a configured credential. The credential can come from `auth.json`, an
environment variable, or `models.json`. On the in-process path we set the vault key into
`process.env` before Pi reads its registry, so the model resolves. On the ACP path the
requested provider often has no credential that Pi can see for the requested model's
provider, so Pi reports an empty available-model list, pi-acp emits no real model options,
and the only value the daemon can offer for the `model` category is its built-in `default`.
`applyModel` then catches the rejection and silently keeps the harness default.

The fix is to configure Pi's per-run agent dir so the requested model's provider always has
a credential Pi recognizes, then make `applyModel` fail loud when a model still cannot be
set.

## How Pi configures providers and models

### Providers and credentials

Pi ships a built-in model list per provider. The providers doc states it directly: "For
each provider, pi knows all available models. The list is updated with every pi release"
(`node_modules/@earendil-works/pi-coding-agent/docs/providers.md:3`; upstream
`https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md`).
The landing page advertises "15+ providers, hundreds of models" and "Authenticate via API
keys or OAuth" (`https://pi.dev/`).

A provider's credential can arrive four ways, in this resolution order
(`docs/providers.md:249-256`):

1. CLI `--api-key` flag.
2. An `auth.json` entry (API key or OAuth token).
3. An environment variable (for example `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`).
4. A custom provider key from `models.json`.

The env var to provider mapping lives in `@earendil-works/pi-ai`'s `getApiKeyEnvVars`
(`node_modules/.pnpm/@earendil-works+pi-ai@0.79.4_*/node_modules/@earendil-works/pi-ai/dist/env-api-keys.js:88-120`;
upstream `packages/ai/src/env-api-keys.ts`). The relevant rows:

- `openai` -> `OPENAI_API_KEY`
- `anthropic` -> `ANTHROPIC_OAUTH_TOKEN`, then `ANTHROPIC_API_KEY`
- `google` -> `GEMINI_API_KEY`, plus groq/xai/openrouter/mistral/deepseek/etc.
- `together` -> `TOGETHER_API_KEY`

Two provider-id facts matter for the fix. First, Pi's Codex models are a **separate
provider** `openai-codex` (backed by `chatgpt.com/backend-api`, OAuth), distinct from the
API-key `openai` provider. Pi has **no** `openai-codex -> OPENAI_API_KEY` mapping, so a vault
`OPENAI_API_KEY` unlocks `openai/gpt-5.5`, not `openai-codex/gpt-5.5`
(`pi-ai/dist/models.generated.js:7667` is the `openai-codex` block;
`env-api-keys.js:95` maps `openai`). Second, Agenta's secret resolver has an env-var name
mismatch for Together: `secrets.py:33` maps `together_ai -> TOGETHERAI_API_KEY`, but Pi reads
`TOGETHER_API_KEY` (`env-api-keys.js:117`). So a Together vault key never registers as
configured auth in Pi. This is the same silent-drop class as F-007, for a different provider.

### Config file locations

Pi reads its config from the agent dir, which defaults to `~/.pi/agent` and is overridable
with `PI_CODING_AGENT_DIR` (`docs/providers.md`; `dist/config.js:404-410`). Within that dir:

- `auth.json` from `getAuthPath()` (`dist/config.js:419-422`). Holds API keys and OAuth
  tokens. `{ "openai": { "type": "api_key", "key": "sk-..." } }`. Created `0600`
  (`docs/providers.md:83-105`).
- `settings.json` from `getSettingsPath()` (`dist/config.js:423-426`).
- `models.json` from `getModelsPath()` (`dist/config.js:415-418`). Custom providers and
  models, and overrides of built-in providers (`docs/models.md:1-3`, `docs/models.md:255-323`).

`models.json` keys (`docs/models.md:132-192`): a `providers` map; each provider has
`baseUrl`, `api` (one of `openai-completions`, `anthropic-messages`,
`google-generative-ai`, ...), `apiKey`, and a `models` array. The `apiKey` field supports
env interpolation: `"$OPENAI_API_KEY"` or `"${OPENAI_API_KEY}"` reads that env var
(`docs/models.md:144-167`). You can also override a built-in provider's `baseUrl`/`apiKey`
without redefining its models, and "All built-in Anthropic models remain available"
(`docs/models.md:255-269`). The file "reloads each time you open `/model`"
(`docs/models.md:92`).

### How Pi decides a model is "available"

`ModelRegistry.getAvailable()` is the gate. It returns only models whose provider has
configured auth:

```js
// node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.js:477-492
getAvailable() {
  return this.models.filter((m) => this.hasConfiguredAuth(m));
}
hasConfiguredAuth(model) {
  const providerApiKey = this.providerRequestConfigs.get(model.provider)?.apiKey;
  return (this.authStorage.hasAuth(model.provider) ||
    (providerApiKey !== undefined && isConfigValueConfigured(providerApiKey)));
}
```

`authStorage.hasAuth(provider)` is true when the provider has a runtime override, an
`auth.json` entry, an env var key, or a `models.json` fallback resolver:

```js
// node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js:274-284
hasAuth(provider) {
  if (this.runtimeOverrides.has(provider)) return true;
  if (this.data[provider]) return true;        // auth.json
  if (getEnvApiKey(provider)) return true;     // env var (OPENAI_API_KEY, ...)
  if (this.fallbackResolver?.(provider)) return true;  // models.json custom provider
  return false;
}
```

So a model becomes available the moment Pi can see a credential for its provider, through
any of the four channels. No per-model config is needed for a built-in provider. This is the
single fact the whole root cause turns on.

## How the two Agenta paths drive Pi

### In-process path (works)

`engines/pi.ts` runs Pi in the runner process. Before it reads the registry it applies the
request's vault secrets to `process.env`:

- `runPi` wraps the whole run in `withRequestProviderEnv(request.secrets, ...)`, which sets
  `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/etc. into `process.env` for the duration and restores
  them after (`engines/pi.ts:72-99`, `200-205`).
- It then builds `ModelRegistry.create(authStorage)` and calls
  `modelRegistry.getAvailable()` (`engines/pi.ts:219-228`). Because the env is set,
  `hasConfiguredAuth` is true for the keyed provider, so that provider's models are in the
  available list.
- `pickModel(available, request.model)` matches the requested model by `id` or
  `provider/id` and falls back to `gpt-5.5` (`engines/pi.ts:101-110`, `230`).

Result: the requested model resolves, because the env credential makes the registry expose
that provider's models. If the requested model's provider has no key, Pi falls back to a
default it can actually run, not to nothing.

### ACP path (default-only)

`engines/sandbox_agent.ts` drives Pi over ACP through the sandbox-agent `sandbox-agent` daemon and the
`pi-acp` adapter. The model is applied after the session is created:

- The daemon is launched with provider keys in its env (`buildDaemonEnv` forwards
  `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/... at `sandbox_agent.ts:380-391`; `runSandboxAgent` also does
  `Object.assign(env, secrets)` at `sandbox_agent.ts:879-880`).
- pi-acp spawns the `pi --mode rpc` child with `env: process.env`
  (`node_modules/pi-acp/dist/index.js:133-140`), so the daemon's env does reach the `pi`
  process.
- On `newSession`, pi-acp probes `get_available_models` and builds the `model` config
  category only when there is a non-empty available-model list:

```js
// node_modules/pi-acp/dist/index.js:2442-2457 (buildConfigOptions)
if (state.models?.availableModels.length) {
  configOptions.unshift({
    id: "model", category: "model", type: "select",
    options: state.models.availableModels.map((model) => ({ value: model.modelId, ... }))
  });
}
```

- pi-acp's `getModelState` maps each available model to `value: "${provider}/${id}"`
  (`pi-acp/dist/index.js:2459-2480`). So when real models exist, the allowed values are
  `provider/id` strings, never the literal `default`.
- sandbox-agent stores that `newSession` response on the session record
  (`createSession` -> `configOptions: cloneConfigOptions(response.configOptions)` at
  `node_modules/sandbox-agent/dist/chunk-TVCDKGSM.js:1289-1299`).
- `applyModel` -> `setModel` -> `setSessionCategoryValue("model", wanted)` reads the
  option's allowed values and throws `UnsupportedSessionValueError` when the requested value
  is not among them (`chunk-TVCDKGSM.js:1465-1477`). The error string is exactly the one in
  the QA log: "does not support value '...' for category 'model' (configId='model'). Allowed
  values: ..." (`chunk-TVCDKGSM.js:601-611`).

When the requested model's provider has a credential Pi can see, `availableModels` is
non-empty, the allowed values are real `provider/id` ids, and the matching `setModel`
succeeds.

The precise failure mode (not "empty `getAvailable()`"). pi-acp throws auth-required when
the **raw** model list is empty (`rawModelsCount === 0`, `pi-acp/dist/index.js:1742`). So a
totally empty registry would fail the session, not silently fall back. The `default`-only
case is narrower: Pi returns some models, but **none whose provider/id matches the requested
model**, so there is no selectable option for what the caller asked. pi-acp's `getModelState`
then carries `currentModelId: availableModels[0]?.modelId ?? "default"`
(`pi-acp/dist/index.js:2495,2498`), and the daemon's `model` category ends up with a value
set the requested id is not in. `applyModel` catches the `UnsupportedSessionValueError` and
returns `undefined` (`sandbox_agent.ts:555-575`), so the harness keeps its own default. The net
result is the same (a requested model is silently dropped), but the cause is "no settable
option matching the requested id," which can be: the provider has no key, the env var is
misnamed (see the Together mismatch below), or the requested bare id is ambiguous across
`openai` and `openai-codex`.

## Why the allowed set was only `default` (root cause)

The available-model list Pi reports over ACP was empty (or did not include the requested
model's provider) because Pi could not see a credential for that provider in the ACP run's
agent dir or env. Concretely, on the Pi (Codex) ACP path:

- The requested ids in F-007 were OpenAI ids (`gpt-5.5`, `gpt-4o-mini`). For those to be
  available Pi needs the `openai` (or `openai-codex`) provider credential visible through
  `auth.json`, an env var, or `models.json`.
- The per-run agent dir is seeded only from the login's `auth.json`/`settings.json`
  (`prepareLocalAgentDir` at `sandbox_agent.ts:287-302`). If that login is a Codex OAuth token for a
  different provider id, or if the project vault only carried a non-OpenAI key, Pi has no
  credential for the requested OpenAI provider, so those models are filtered out of
  `getAvailable()`.
- With no available models that match, pi-acp does not surface them, and the daemon's only
  selectable model value collapses to `default`. `applyModel` logs "not settable ... using
  harness default" and returns `undefined` (`sandbox_agent.ts:555-575`).

For the Claude harness the allowed set `default, sonnet[1m], opus[1m], haiku` comes from the
separate `@zed-industries/claude-agent-acp` adapter, which exposes Claude Code's own model
aliases (the `[1m]` suffix is Claude Code's 1M-context alias naming). That path accepts the
aliases but rejects a full model id like `claude-haiku-4-5-20251001`, falling back to the
default (Sonnet). That is the cost trap in F-007.

So the behavior is not "Pi only supports default." It is "our ACP run did not give Pi a
credential it recognizes for the requested model's provider in the agent dir, so Pi reported
no matching models, and `applyModel` silently fell back." The product owner's prior is
correct: our setup is wrong, not Pi.

## What is missing, in one line

The ACP per-run agent dir carries `auth.json` and `settings.json` but no `models.json`, and
the provider credential for the requested model is not reliably present in a form Pi's
registry counts as configured auth for that provider. Pi reads `models.json` and `auth.json`
from `PI_CODING_AGENT_DIR` (`config.js:404-422`); the runner already controls that dir
(`prepareLocalAgentDir`), so it is the natural place to write the provider/model config.

## Sources

Installed packages (authoritative for the running behavior):

- `services/agent/node_modules/@earendil-works/pi-coding-agent` v0.79.4: `dist/config.js`,
  `dist/core/model-registry.js`, `dist/core/auth-storage.js`, `docs/providers.md`,
  `docs/models.md`, `docs/custom-provider.md`.
- `services/agent/node_modules/.pnpm/@earendil-works+pi-ai@0.79.4_*/.../pi-ai/dist/env-api-keys.js`.
- `services/agent/node_modules/pi-acp` v0.0.29: `dist/index.js`.
- `services/agent/node_modules/sandbox-agent` v0.4.2: `dist/chunk-TVCDKGSM.js`.

Agenta code:

- `services/agent/src/engines/pi.ts`, `services/agent/src/engines/sandbox_agent.ts`.
- `services/oss/src/agent/secrets.py`, `services/oss/src/agent/schemas.py`.

Upstream docs (the repo is `earendil-works/pi`; `pi.dev/docs/*` paths 404, cite the repo):

- `https://pi.dev/`
- `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md`
- `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md`
- `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md`
- `https://github.com/earendil-works/pi/blob/main/packages/ai/src/env-api-keys.ts`
- `https://github.com/svkozak/pi-acp`
