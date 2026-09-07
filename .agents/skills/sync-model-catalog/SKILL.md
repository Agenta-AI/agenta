---
name: sync-model-catalog
description: Refresh Agenta's harness catalogs, provider model lists, recommended defaults, and provider-supplied display names. Use for new OpenAI, Anthropic, Codex, Pi, or OpenRouter models and before releases that need current model choices.
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, WebSearch, WebFetch
user-invocable: true
---

# Sync model catalog

Keeps the agent model catalog honest. The catalog is the curated decoration over each harness's
accepted model set: clean labels, one-sentence descriptions, real pricing, and 1-5 ratings, keyed
by the id the harness accepts. It is published additively next to the ids-only `models` map on the
harness capability record (`capabilities.py`).

Design and rationale:
`docs/design/agent-workflows/projects/model-catalog-schema/{design.md,plan.md}`.

## What it owns

Four JSON data files under `sdks/python/agenta/sdk/agents/data/`, loaded by
`sdks/python/agenta/sdk/agents/model_catalog.py`:

- `pi_models.generated.json` — machine-generated from pi-ai. Objective facts only (name / pricing /
  context_window / modalities), `source: "pi_generated"`. **Never hand-edit.**
- `pi_models.curated.json` — human overlay for the generated file (id -> `{label?, description?,
  ratings?}`), merged onto the generated facts at load. Survives regeneration. Its `additions`
  list holds whole entries for models the pinned pi-ai release predates (see below).
- `claude_models.curated.json` — hand-curated Claude alias entries (facts + judgments),
  `source: "curated"`.
- `codex_models.curated.json` — hand-curated Codex entries (facts + judgments),
  `source: "curated"`.

It also updates the accepted subscription model ids and recommended provider defaults in
`capabilities.py`, plus the canonical API-key provider list in `sdk/utils/assets.py`.

## Refresh workflow

### 1. Regenerate the Pi file (on a pi-ai version bump)

The generator reads the pinned pi-ai `models.generated` for the providers Agenta reaches (the
vault-mapped providers plus `openai-codex`) and emits one entry per model. pi-ai provider names are
mapped to Agenta's vocabulary (`google`->`gemini`, `together`->`together_ai`); ids are
`<agenta-provider>/<pi-model-id>`.

```bash
# From repo root. Point at the pinned pi-ai in the runner's node_modules (the .pnpm path includes
# the version — resolve it with the glob).
MODELS=$(ls services/runner/node_modules/.pnpm/@earendil-works+pi-ai@*/node_modules/@earendil-works/pi-ai/dist/models.generated.js | head -1)
node .agents/skills/sync-model-catalog/generate_pi_models.mjs "$MODELS" \
  sdks/python/agenta/sdk/agents/data/pi_models.generated.json
```

Detect the bump from a lockfile diff on `@earendil-works+pi-ai@<version>`. The `_generator` field
in the output records the exact pi-ai version. The curated overlay is untouched — only the
`.generated.json` is rewritten, so the merge on load re-applies the human judgments.

#### Adding a model pi-ai does not carry yet

A model released after the pinned pi-ai snapshot has no generated entry, so it has no catalog entry
at all: the picker can only show its bare id, and `PROVIDER_DEFAULT_MODELS` drops it (a curated
default must exist in the catalog or the accepted set). The overlay cannot fix this, because an
overlay key only decorates an id the generated file already has.

Put the whole entry in the `additions` list of `pi_models.curated.json` instead, with
`source: "curated"` and every fact sourced from the vendor's own pages. Do not hand-edit the
generated file. A generated entry of the same id always wins at load, so the addition retires
itself the moment a regeneration carries the model. Prune superseded additions after job 1.

### 2. Sync Claude to the live accepted set (needs a running runner)

`claude_models.curated.json` must cover the stable request values the Claude picker can send.
Probe live sessions by reading the model config options (the same `getConfigOptions` call
`allowedModels` uses in `services/runner/src/engines/sandbox_agent/model.ts`), but do not copy one
session's set blindly. Account entitlements and promotions can add or remove context-hinted variants
such as `claude-fable-5[1m]` while keeping the same model family.

Use the stable bare canonical id when the runner can safely widen it to the session's hinted option.
For Fable, publish `claude-fable-5`: it matches a bare live option exactly and the runner resolves it
to `claude-fable-5[1m]` when that is the only offered variant. Do not publish the friendly forms
`fable` or `fable[1m]`; the harness does not recognize that model family under those ids. Requires
an authenticated Claude session, so this is a manual/periodic step, not a CI gate.

### 3. Refresh curated metadata from current public sources (before a release / on demand)

Labels, descriptions, and ratings state a model's *current* standing, which a language model's
training data gets wrong (the Anthropic frontier is Fable 5, above Opus, as of mid-2026). Look up the
current lineup, pricing, and relative standing from the vendor's pages and announcements (WebSearch +
WebFetch), then propose updated descriptions and ratings for a human to confirm. Never write a rating
from memory. Validate the 1-5 range and flag any entry whose facts you could not verify. Ratings:
higher is better on every axis; `cost` is cost-efficiency (5 = cheapest).

### 4. Refresh Codex and OpenAI

Use OpenAI's official model pages for the current general-purpose lineup, ids, pricing, context,
and recommended starting models. Add a new model to `supported_llm_models["openai"]` and
`PROVIDER_DEFAULT_MODELS["openai"]` only when the official page identifies it as a current
general-purpose model.

For Codex subscription models, confirm the model is accepted by the pinned Codex app-server or a
live authenticated session. Add it to `CODEX_MODELS` and `codex_models.curated.json`. For Pi's
ChatGPT subscription path, update the Pi package first; regenerate the catalog, then make
`PI_SUBSCRIPTION_MODELS["openai-codex"]` exactly match the pinned package's catalog.

### 5. Refresh Anthropic API models

Use `GET https://api.anthropic.com/v1/models` with the user's key when available. The response is
newest-first and supplies `id`, `display_name`, capabilities, and token limits. Cross-check the
official models overview and deprecation page before changing recommendations or removing an id.
Keep the current four product tiers in `PROVIDER_DEFAULT_MODELS["anthropic"]`; do not remove a
deprecated model from the canonical list until Anthropic marks it retired.

### 6. Refresh OpenRouter by weekly usage

Run:

```bash
python .agents/skills/sync-model-catalog/audit_provider_models.py
```

The script calls OpenRouter's public `GET /api/v1/models` with `sort=most-popular`,
`supported_parameters=tools`, and `output_modalities=text`. Use the first 25 results for
`supported_llm_models["openrouter"]` and the first six for
`PROVIDER_DEFAULT_MODELS["openrouter"]`, preserving response order. The endpoint's `name` field is
the human-readable label.

The ranking changes with usage. Review removals before applying them because a saved connection
may still use a model that fell out of the top 25.

### 7. Preserve provider display names

Provider probes keep ids in `DiscoveryResult.models` for compatibility and return names in
`DiscoveryResult.model_names`. OpenRouter supplies `name`; Anthropic supplies `display_name`;
Gemini supplies `displayName`. Save selected names in each model's existing `extras.name` field so
the settings list and model picker still show the friendly name after reload. OpenAI's Models API
supplies ids only, so its friendly names come from the curated catalog.

## Validate

The pydantic loader enforces the schema (including the 1-5 rating range) on load, and the unit test
locks coverage and the overlay merge:

```bash
cd sdks/python && uv run --no-sync python -m pytest \
  oss/tests/pytest/unit/agents/connections/test_model_catalog.py -q
```

A malformed data file fails loud there (and at import in `capabilities.py`, which then publishes an
empty catalog rather than crashing `/inspect`).

## When to run

- Job 1 on a pi-ai bump (automatable from a lockfile diff).
- Jobs 2 and 3 before a release or on demand (need a live session and a web lookup).
- Jobs 4 and 5 when OpenAI or Anthropic announce a model or deprecation.
- Job 6 weekly or before a release; it is safe to run without a credential.

The skill writes files and a proposal; a human reviews the curated changes and commits.
