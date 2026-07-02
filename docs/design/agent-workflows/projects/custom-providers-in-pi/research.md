# Research: the five gaps, verified

All references re-verified on 2026-07-02 against the working tree. This doc records the exact
locations and the mechanism behind each gap, plus two path corrections and one appendix. It does
not repeat the sibling research; read `../model-config/research.md` for how Pi decides a model is
available, and `../provider-model-auth/design.md` for the resolver and capability contracts.

## Two corrections to prior docs

- **Runner path.** The runner TypeScript is at `services/runner/src/`, not `services/agent/src/`
  as the siblings cite. The rename is commit `b323a8516f`. The monolithic `sandbox_agent.ts` also
  split into `services/runner/src/engines/sandbox_agent/{model,daemon,daytona,pi-assets,errors}.ts`,
  so several functions moved. Every runner line below is the current location.
- **Frontend capability source.** The harness catalog reaches the frontend from
  `GET /workflows/catalog/harnesses/` (served from `capabilities.py` `harness_catalog_document`,
  via `api/oss/src/apis/fastapi/workflows/router.py`), not the `/inspect` `meta`. The
  `connectionUtils.ts` header comment still says `/inspect`; it is stale. The live query atom is
  `harnessCatalogQueryAtom` in
  `web/packages/agenta-entities/src/workflow/state/inspectMeta.ts`.

## Gap 1: the deployment gate blocks a known-direct custom provider

A `provider_key` always resolves with `deployment="direct"`
(`connections.py:258-271`, `_provider_key_candidate`, the value is hard-coded at `:269`). A
`custom_provider` echoes its raw kind:

```python
# sdks/python/agenta/sdk/agents/platform/connections.py:281
deployment = _stripped(data.get("kind")) or "custom"
```

`_custom_provider_candidate` (`:274-309`) already resolves the rest correctly. It sets
`provider = data_kind if data_kind in _PROVIDER_ENV_VARS else None` (`:295-296`), builds the
`Endpoint` from `settings.url`/`version` plus region (`:287-291`), and carries `model_slugs`
/`model_keys`. So a custom OpenRouter connection resolves with `provider="openrouter"`, a real
`endpoint.base_url`, the selected model id, and, from `resolved_env`, the right env var:

```python
# connections.py:238-245  _ConnectionCandidate.resolved_env
env_var = _provider_env_var(provider) or _provider_env_var(self.provider)
if self.api_key and env_var:
    env.setdefault(env_var, self.api_key)   # e.g. {"OPENROUTER_API_KEY": "<key>"}
```

The only wrong field is `deployment`, which becomes `"openrouter"` and rides into
`ResolvedConnection.deployment` verbatim (`connections.py:431-438`, `deployment=chosen.deployment`).
Then the post-resolve check rejects it:

```python
# services/oss/src/agent/app.py:110-125
if not harness_allows_deployment(harness, resolved.deployment):
    raise UnsupportedDeploymentError(deployment=resolved.deployment, harness=harness)
```

```python
# sdks/python/agenta/sdk/agents/capabilities.py:225-236
normalized = "vertex_ai" if deployment == "vertex" else deployment
return normalized in entry.deployments        # Pi: ["direct"] (capabilities.py:146, :152)
```

`"openrouter"` is not in `["direct"]`, so `UnsupportedDeploymentError` (a 422) fires before the
runner is ever called. This is exactly why "OpenRouter works as a `provider_key` but not as a
custom provider." Because `resolved_env` already emits `OPENROUTER_API_KEY` and the runner already
forwards `request.secrets` into the Pi daemon env, fixing only the deployment label makes a
built-in OpenRouter id settable through Pi's env-var channel with no other change. That is why
Gap 1 is the fastest unblock.

The classification the field should carry is worked out in [design.md](design.md).

## Gap 2: the runner never teaches Pi a custom provider

The runner writes no Pi `models.json`. A grep of `services/runner/src/` for `models.json` returns
zero matches. The per-run agent dir seed copies exactly two files:

```ts
// services/runner/src/engines/sandbox_agent/pi-assets.ts:184-191  prepareLocalAgentDir
for (const name of ["auth.json", "settings.json"]) {
  const src = join(sourceAgentDir, name);
  if (existsSync(src)) copyFileSync(src, join(dir, name));
}
```

A custom base URL is applied only for Claude:

```ts
// services/runner/src/engines/sandbox_agent.ts:162, :176-180  applyClaudeConnectionEnv
if (acpAgent !== "claude") return false;
...
const baseUrl = request.endpoint?.baseUrl;
if (baseUrl) { env.ANTHROPIC_BASE_URL = baseUrl; ... }
```

So Pi never sees `endpoint.baseUrl` and never learns a genuinely custom (non-built-in) model id.
This is `model-config` Part 1: write `auth.json` (provider keys as `"$ENV"` references) and
`models.json` (base URL override plus custom models) into `PI_CODING_AGENT_DIR`, local and
Daytona. The per-run agent dir is created today only when skills or a system prompt exist, so a
plain model override skips it:

```ts
// services/runner/src/engines/sandbox_agent/pi-assets.ts:224  prepareLocalPiAssets
if (plan.skillDirs.length > 0 || plan.hasSystemPrompt) {
  const runAgentDir = prepareLocalAgentDir(plan.sourcePiAgentDir, plan.skillDirs, log);
```

The Daytona uploaders that this write must mirror: `uploadPiAuthToSandbox`
(`services/runner/src/engines/sandbox_agent/daytona.ts:77-94`, into `DAYTONA_PI_DIR`),
`daytonaEnvVars` (`daytona.ts:31-46`), and the local daemon env forwarding in
`buildDaemonEnv` (`services/runner/src/engines/sandbox_agent/daemon.ts:132-162`).

## Gap 3: a dropped model is silent

```ts
// services/runner/src/engines/sandbox_agent/model.ts:46-74  applyModel
try {
  await session.setModel(wanted);
  return wanted;
} catch (err) {
  if (options.strict) {
    throw new Error(`model '${wanted}' not settable (${(err as Error).message})`);
  }
  const allowed = allowedFromError(err);
  const fallbackAllowed = allowed.length ? allowed : await allowedModels(session);
  ...
  log(`model '${wanted}' not settable (...); using harness default`);
  return undefined;                         // silent fallback, HTTP 200 on the wrong model
}
```

`strict` is threaded for Claude only. `applyClaudeConnectionEnv` returns a strict flag
(`sandbox_agent.ts:193-200`), assigned at `:330`, passed at `applyModel(session, request.model,
logger, { strict: strictModel })` (`:582-587`). Pi runs never set strict.

`allowedModels` reads the wrong field:

```ts
// services/runner/src/engines/sandbox_agent/model.ts:19-30  allowedModels
const choices = modelOpt?.options ?? [];
return choices.map((c: any) => c.id).filter(Boolean);   // pi-acp options carry `value`, not `id`
```

pi-acp builds each model option as `{ value: model.modelId, name, description }`, so mapping `c.id`
returns `[]` and the fallback enumeration is blind. `model-config` Part 2 already specifies the
fix: read `c.value ?? c.id`, raise a typed `ModelNotSettableError` with the allowed set, and gate
strictness behind `AGENTA_AGENT_MODEL_STRICT` (default false first, flip later; the reason for the
staged rollout is the `gpt-5.5` advertised-default trap documented in `../model-config/proposal.md`).

## Gap 4: the picker never shows custom-provider models

```ts
// web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/connectionUtils.ts:239-256
export function buildModelOptionGroups(capabilities, harness, metadata) {
  const models = capsFor(capabilities, harness)?.models   // only the static harness catalog
  if (!models) return []
  ...
}
```

`capabilities[harness].models` comes from `_pi_models()` (`capabilities.py:97-116`), which lists
`supported_llm_models` for the static `PI_VAULT_PROVIDERS` (`capabilities.py:45-54`). The vault is
read on the same screen, but only for the Connection dropdown, and only three fields per secret:

```ts
// connectionUtils.ts:341-344  namedConnectionOptions (the only vault reader in the file)
if (secret.type !== "custom_provider") continue
const slug = secret.name?.trim()
...
const secretProvider = secret.provider?.toLowerCase() || null   // never reads `models`
```

The vault entry does carry the models. `transformSecret`
(`web/packages/agenta-entities/src/secret/core/transforms.ts:108`) sets
`models: data.models.map((m) => m.slug)` on the in-app `LlmProvider`. But `useModelHarness.tsx`
casts that to `VaultConnectionEntry` (`connectionUtils.ts:302-312`), whose type has no `models`
field, so the array is dropped at the type boundary. `buildModelOptionGroups` never receives the
vault at all. Surfacing these is an uncovered gap: `model-config` Part 3 sources choices from the
static catalog plus the runner, never from the vault. The contract for the merge is in
[design.md](design.md).

## Gap 5: the Together env var name is wrong

```python
# sdks/python/agenta/sdk/agents/platform/secrets.py:93-102  _PROVIDER_ENV_VARS
"together_ai": "TOGETHERAI_API_KEY",   # Pi reads TOGETHER_API_KEY (env-api-keys.js)
```

The same map is copied in three files and has already drifted:

- `platform/secrets.py:93-102`: 8 entries, no `minimax`. `together_ai -> TOGETHERAI_API_KEY`.
- `platform/connections.py:41-51`: 9 entries, includes `minimax -> MINIMAX_API_KEY`.
  `together_ai -> TOGETHERAI_API_KEY` (`:49`).
- `connections/resolver.py:31-40`: 8 entries, no `minimax`. `together_ai -> TOGETHERAI_API_KEY`.

`capabilities.py` `PI_VAULT_PROVIDERS` lists both `minimax` and `together_ai`, so a `minimax`
`provider_key` resolved through `secrets.py` or `resolver.py` today produces no env var at all
(the same silent-drop class, a second instance). One extra corroboration:
`connections.py` `_ALLOWED_EXTRA_ENV_KEYS` already lists both `TOGETHERAI_API_KEY` (`:116`) and
`TOGETHER_API_KEY` (`:117`), so an extras-supplied Together key with the right name already passes
through; only the mapped `provider_key` emit is wrong.

The Slice 0 audit: fix `together_ai -> TOGETHER_API_KEY` in all three maps, add the missing
`minimax` entry to the two that omit it, and confirm each entry against Pi's `getApiKeyEnvVars`.

## Appendix: the Pi startup-banner leak (related, separately shippable)

This is not one of the five gaps and it is not a slice here. `isBannerLine`
(`services/runner/src/tracing/otel.ts:699-713`) strips Pi's startup banner from replies, but its
section-heading regex matches only `Context` and `Skills` (`:706`) and its path regex requires a
`.md` suffix (`:708`). pi-acp's newer banner adds an `## Extensions` section with `.js` extension
paths. `stripStartupBanner` (`otel.ts:719-728`) strips only a leading contiguous run of banner
lines, so the first unmatched line (`## Extensions`) halts the strip, and the Extensions block
plus the trailing "New version available" notice leak into the reply. The fix is to extend
`isBannerLine` to match the `Extensions` heading and a `.js` path (or to strip the whole banner
block rather than a leading run). Track it on its own lane; it does not block the five gaps.
</content>
