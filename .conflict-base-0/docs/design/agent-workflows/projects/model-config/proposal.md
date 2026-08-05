# Proposal: make the requested model settable on the ACP path

This proposal fixes F-007 (`../qa/findings.md`): on the sandbox-agent (ACP) backend the requested
model is silently dropped and the run uses the harness default. The root cause is in
`research.md`: Pi only exposes a provider's models once it can see a credential for that
provider, and the ACP per-run agent dir does not give Pi that credential in a form its model
registry counts. So Pi reports no matching models, pi-acp offers only `default`, and
`applyModel` swallows the rejection.

The proposal has three parts:

1. Configure Pi correctly on the ACP path so a requested model is actually settable.
2. Fail loud, never silent, when a model still cannot be set.
3. Expose the valid model choices in the inspectable schema, per harness.

Parts 1 and 2 are the fix. Part 3 makes the choices discoverable so callers and the
frontend stop guessing.

## Part 1: configure Pi correctly on the ACP path

### Goal

Give Pi a credential it recognizes for the requested model's provider, inside the per-run
agent dir the runner already controls, so `get_available_models` returns that provider's
models and pi-acp surfaces them as real `provider/id` options. Then `applyModel` finds a
match and `setModel` succeeds.

### What to write, and where

The runner already creates a throwaway per-run agent dir and points the daemon at it via
`PI_CODING_AGENT_DIR` (`prepareLocalAgentDir`, `sandbox_agent.ts:287-302`; the sibling
SYSTEM.md/APPEND_SYSTEM.md fix writes into the same dir). That dir is exactly where Pi reads
`auth.json` and `models.json` (`config.js:404-422`). Write the provider credentials there in
the form Pi's registry counts as configured auth.

Two complementary writes, both into the per-run agent dir:

1. **`auth.json` from the resolved vault keys.** For each resolved provider key, write the
   `auth.json` entry Pi expects:

   ```json
   {
     "openai":    { "type": "api_key", "key": "$OPENAI_API_KEY" },
     "anthropic": { "type": "api_key", "key": "$ANTHROPIC_API_KEY" }
   }
   ```

   Pi resolves `"$OPENAI_API_KEY"` from the daemon env at request time
   (`docs/providers.md:107-127`), so the secret value itself never lands on disk: the runner
   already passes the key as launch env (`buildDaemonEnv`, `sandbox_agent.ts:380-391`), and the
   `auth.json` entry just tells Pi which providers are configured. This makes
   `authStorage.hasAuth(provider)` true for each keyed provider, so `getAvailable()` includes
   that provider's built-in models. Merge with the login's existing `auth.json` (OAuth) that
   `prepareLocalAgentDir` already copies, so subscription auth still works.

   Writing `auth.json` (not relying on env alone) is the robust choice: `auth.json` takes
   priority over env (`docs/providers.md:105`), it is the channel Pi's headless RPC path
   reads most reliably, and it keeps the credential channel identical to the in-process path
   in intent.

2. **`models.json` only when the requested model is not a built-in.** For a standard
   provider (OpenAI, Anthropic, ...) a built-in model id is enough once `auth.json` marks the
   provider configured: Pi already knows the model. Write `models.json` only to (a) point a
   built-in provider at a proxy `baseUrl`, or (b) register a genuinely custom model
   (Ollama/vLLM/gateway). Format per `docs/models.md:132-192`:

   ```json
   {
     "providers": {
       "openrouter": {
         "baseUrl": "https://openrouter.ai/api/v1",
         "api": "openai-completions",
         "apiKey": "$OPENROUTER_API_KEY",
         "models": [{ "id": "anthropic/claude-3.5-sonnet" }]
       }
     }
   }
   ```

   This keeps the common case (a built-in OpenAI/Anthropic id) to a single `auth.json` write
   and reserves `models.json` for the custom case.

### Daytona parity

The Daytona path uploads the agent dir through the sandbox FS API
(`uploadPiAuthToSandbox`, `uploadSystemPromptToSandbox`, `sandbox_agent.ts:223-253`,
`679-696`). Add an `auth.json`/`models.json` uploader the same way, into `DAYTONA_PI_DIR`,
so the remote Pi sees the same configured providers. The provider keys already flow to the
sandbox env via `daytonaEnvVars` (`sandbox_agent.ts:582-597`), so `"$OPENAI_API_KEY"` interpolation
resolves there too.

### Create the per-run agent dir for a model override, not only for skills

Today the local Pi path only creates a per-run agent dir (and points
`PI_CODING_AGENT_DIR` at it) when forced skills or a system prompt exist
(`sandbox_agent.ts:916-929`: `if (skillDirs.length > 0 || hasSystemPrompt)`). A plain `model`
override takes the `else` branch and leaves the shared login dir in place. So the Part 1
write has to make "a model/provider config is needed" a third reason to create and point at
the per-run dir, or the fix never runs for the exact failing case (a model override with no
skills and no system prompt). Extend that condition to include "the run carries resolved
provider secrets" (or always, for Pi local), and write `auth.json` into the per-run dir
there. Without this the auth.json write lands nowhere the daemon reads.

### Fix the secret env-var name mismatch (one-line, separate from the agent dir)

Independent of the agent-dir writes, the Python secret resolver maps one provider to the
wrong env var: `secrets.py:33` emits `TOGETHERAI_API_KEY` for `together_ai`, but Pi reads
`TOGETHER_API_KEY` (`pi-ai env-api-keys.js:117`). So a Together vault key never unlocks
Together models on either path. Fix the mapping to `TOGETHER_API_KEY`. This belongs in the
Python resolver (it owns the vault-kind to env-var map), and it is the one Part 1 change that
is correctly placed in Python rather than the runner. Audit the rest of `_PROVIDER_ENV_VARS`
against Pi's `getApiKeyEnvVars` while here.

### Provider-id caveat: openai vs openai-codex

Pi's Codex models live under the `openai-codex` provider (OAuth, the ChatGPT/Codex login),
while a vault `OPENAI_API_KEY` maps to the `openai` provider (`getApiKeyEnvVars`:
`openai -> OPENAI_API_KEY`). So writing an `openai` `auth.json` entry unlocks the `openai`
provider's `gpt-*` ids (for example `openai/gpt-5.5`), not `openai-codex/gpt-5.5`. The
default Pi login on the runner is often the Codex OAuth, whose ids are `openai-codex/...`.
The fix must therefore (a) write the `openai` entry from the vault key so `openai/gpt-5.5`
becomes settable, and (b) keep the requested model id provider-agnostic in matching: the
existing `pickModel` suffix match (`sandbox_agent.ts:513-522`) already resolves a bare `gpt-5.5`
against either `openai/gpt-5.5` or `openai-codex/gpt-5.5`, so a caller passing `gpt-5.5`
lands on whichever provider is authed. Document that a fully provider-qualified id
(`openai-codex/...`) only works when that provider's auth is present.

### Why this is the core fix

It removes the cause, not the symptom. Once Pi can see the credential for the requested
model's provider, `getAvailable()` returns that provider's models, pi-acp surfaces them as
`provider/id` options, the sandbox-agent daemon's `model` category carries them, and
`applyModel(session, "gpt-5.5")` matches `openai/gpt-5.5` (the existing `pickModel` suffix
match at `sandbox_agent.ts:513-522` already handles the `provider/` prefix). No silent fallback,
because the value is genuinely settable.

### Tests

- Unit: given resolved secrets `{OPENAI_API_KEY: ...}`, `prepareLocalAgentDir` writes an
  `auth.json` with an `openai` entry whose key is `"$OPENAI_API_KEY"`, merged with any copied
  login `auth.json`. Never writes a raw secret value.
- Integration (httpx-mocked resolvers, fake runner): a run with `model: "gpt-5.5"` and an
  OpenAI key resolves `model` to `openai/gpt-5.5`, not `undefined`.
- Live acceptance (llm_required): the F-007 repro on sandbox-agent local with a real OpenAI key now
  applies the requested model (assert via the "not settable" log absence and the returned
  `model` field).

## Part 2: fail loud, never silent

After Part 1, a requested model can still be genuinely unsettable: the provider has no key,
the model id is wrong, or the harness (for example Claude Code over ACP) only accepts its own
aliases. Today `applyModel` logs and returns `undefined`, and the run proceeds on the harness
default. That is the cost trap. Make it an error the caller sees.

### sandbox-agent path

Change `applyModel` (`sandbox_agent.ts:555-575`) to distinguish two outcomes:

- A model was requested and resolved to a settable value -> return it.
- A model was requested and cannot be set after the retry -> raise a typed error
  (`ModelNotSettableError`) carrying the requested model and the allowed values parsed from
  the daemon error (`allowedFromError`, `sandbox_agent.ts:538-546`).

Fix the allowed-set enumeration while here. `allowedModels(session)`
(`sandbox_agent.ts:524-536`) maps each option to `c.id`, but pi-acp builds the model option's
entries as `{ value: model.modelId, name, description }` and sandbox-agent reads
`entry.value` (`extractConfigValues`). So `allowedModels()` returns `[]` today, and the
fallback enumeration in `applyModel` is blind: only `allowedFromError()` (parsing the daemon
error string) currently surfaces the allowed set. Change `allowedModels` to read
`c.value ?? c.id` so the error message and any pre-validation have the real list.

`runSandboxAgent`'s catch already turns thrown errors into one clear caller line via `conciseError`
(`sandbox_agent.ts:763-775`, `1136-1139`). Add a branch so the message reads, for example:

```
pi: model 'gpt-4o-mini' is not available on this run. The OpenAI provider has no key in the
project vault, or the model id is unknown. Available: openai/gpt-5.5, openai/gpt-5.5-codex.
```

Gate the strictness so an empty/absent request still uses the harness default (no model
requested is not an error). Only a requested-but-unsettable model fails.

Roll strict out as opt-in first, then flip the default. The reason is a real trap: the
advertised agent config default model is `gpt-5.5` (`schemas.py:15`,
`AgentConfigSchema.model` default). The playground sends that default back on every run, so
strict mode would treat `gpt-5.5` as an intentional choice on runs that never made one. On a
backend where `gpt-5.5` is not settable (for example a project whose only login is a Codex
OAuth exposing `openai-codex/gpt-5.5`, where a bare `gpt-5.5` may or may not resolve
depending on the suffix match), strict would start failing runs that pass today. So:
`AGENTA_AGENT_MODEL_STRICT` defaults to `false` (warn-and-fallback, the current behavior) in
the first release; ship Part 1 and the louder warning, confirm via the QA matrix that the
common models are settable, then flip the default to strict. Reconciling the advertised
default with the per-harness settable set (Part 3) removes the trap entirely.

### In-process path, consistently

`engines/pi.ts` is lenient in the other direction: `pickModel` falls back to `gpt-5.5`, then
to any non-mini model, then to `available[0]` (`pi.ts:101-110`). So a wrong requested model
silently runs a different one. Make it consistent: when `request.model` is set but does not
match any available model, raise the same `ModelNotSettableError` with the available ids,
rather than falling through to a default. Keep the no-model-requested fallback (the service
default) unchanged.

This gives both backends one rule: a requested model that cannot run is an error with the
available set; no requested model uses the documented default.

### Tests

- sandbox-agent: a requested model with no provider key raises, and `conciseError` renders the
  available-set message. No model requested still runs on the default.
- In-process: `request.model` not in `available` raises with the available ids; absent
  `request.model` still falls back to the service default.

## Part 3: expose the choices in the schema and `inspect`

A caller cannot know which model values are valid without trying one and reading the error.
Surface the valid `model` values in the inspectable config schema, the way the platform
already surfaces the `model` catalog type, so the playground and any caller discover them up
front.

### Boundary note: derive in the runner, do not widen the wire

The model/provider auth config is derived inside the TS runner from `request.secrets` and
`request.model` (both already on the stable `/run` wire contract, `protocol.ts:210-211`).
Do not add a Pi-specific auth-config field to the wire or push the write into the Python
service. The runner already owns the per-run agent dir and the secret-to-env mapping; the
Python service stays thin (it decides what to run, the runner runs it, per
`services/agent/CLAUDE.md`). Part 3's schema work is the one piece that does belong in Python
(the SDK `AgentConfigSchema` and the service `/inspect`), because that is where the
inspectable catalog type lives.

### The existing pattern

The agent advertises its config schema through `AGENT_SCHEMAS` on `/inspect`
(`services/oss/src/agent/schemas.py`, wired at `app.py:156`). The `agent` element is the
`agent_config` catalog type (`AgentConfigSchema`, `sdk/utils/types.py:1065-1129`), resolved
by the playground against `/workflows/catalog/types/agent_config`
(`api/oss/src/resources/workflows/catalog.py`). Its `model` field is a plain string with
`x-parameter: grouped_choice` but **no choices**
(`sdk/utils/types.py:1087-1092`). The standalone `model` catalog type, by contrast, carries
`choices: supported_llm_models` and `x-ag-type: grouped_choice`
(`sdk/utils/types.py:1045-1054`). The agent's model field should carry choices the same way,
but the valid set is per-harness, so the choices must be harness-aware.

### Proposal

Populate the agent `model` field's choices with the available models, grouped by provider,
and keyed by harness. Two layers:

1. **Static, schema-time (harness-neutral baseline).** Give `AgentConfigSchema.model` a
   `choices`/`x-ag-metadata` like the `model` catalog type, sourced from the same
   `supported_llm_models` list, so the playground renders a real grouped picker instead of a
   free-text box. This is the cheap win and needs no runtime probe. Note per harness that the
   effective set is constrained at run time (Pi: any provider with a vault key; Claude: its
   own aliases).

2. **Dynamic, run-time (the accurate set).** Add the available models to the `inspect`
   response so a caller sees the true per-harness set for the current project. The runner
   already knows them: pi-acp returns the `model` config option's `options`
   (`allowedModels(session)`, `sandbox_agent.ts:524-536`), and the in-process path has
   `modelRegistry.getAvailable()`. Expose a small read path so the service can answer "for
   harness H in this project, the valid model values are ..." and fold it into the inspect
   schema's choices. This is the harness-neutral surface with per-harness data:

   - **Pi / agenta**: the built-in models of every provider that has a vault key
     (`provider/id` ids), plus any `models.json` custom models.
   - **Claude**: Claude Code's aliases (`default`, `sonnet[1m]`, `opus[1m]`, `haiku`) as the
     adapter reports them.

Keep the schema shape harness-neutral (one `model` string field with grouped choices and
metadata); the *contents* differ by harness. Document the difference in the field
description so a reader of the schema alone understands why Pi and Claude show different sets.

### Scope note

Part 3 layer 1 (static choices) is small and independent; do it with Parts 1-2. Layer 2
(runtime available-models in inspect) is a larger surface (a new read path plus a frontend
that requests it per harness/project) and can follow once Parts 1-2 land and are verified.

## Recommendation and order

Implement in this order:

0. **Pre-fix (one line, do first):** correct the Together env-var mapping in `secrets.py`
   (`TOGETHERAI_API_KEY` -> `TOGETHER_API_KEY`) and audit the rest of `_PROVIDER_ENV_VARS`
   against Pi's `getApiKeyEnvVars`. This is an independent silent-drop bug and a trivial fix.
1. **Part 1** (write `auth.json` from resolved keys into the per-run agent dir, local and
   Daytona; `models.json` only for custom/proxy models). This removes the root cause and
   makes the common requested-model case work on sandbox-agent. Highest value, contained to
   `sandbox_agent.ts` plus its tests. Must include the two prerequisites: create the per-run agent
   dir for a model override (not only for skills/system-prompt), and fix `allowedModels` to
   read `c.value`. Mind the `openai` vs `openai-codex` provider-id distinction.
2. **Part 2a** (louder warning + `allowedModels` fix + `AGENTA_AGENT_MODEL_STRICT` flag
   defaulting to `false`). Ship the typed error path and the better message, but keep the
   current warn-and-fallback default so nothing that passes today starts failing. This is the
   safe half of the cost-trap fix.
3. **Part 3 layer 1** (static grouped choices on the agent `model` field) plus reconciling
   the advertised default with the per-harness settable set. Cheap, and it removes the
   `gpt-5.5`-default trap that blocks flipping strict on.
4. **Part 2b** (flip `AGENTA_AGENT_MODEL_STRICT` to default strict) once the QA matrix
   confirms the common models are settable on every backend and the default is reconciled.
   This is the final close of the cost trap.
5. **Part 3 layer 2** (runtime available-models in `inspect`). Defer to a follow-up; larger
   surface, not blocking the fix.

Part 1 plus Part 2a resolve the silent-drop symptom of F-007 safely; Part 2b closes the cost
trap fully once it is safe to fail loud by default. Part 3 prevents the next caller from
hitting it blind.
