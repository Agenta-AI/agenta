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

### 0. Check the harness pins first

A harness offers only the models its pinned build knows. A catalog entry for a model the pinned
build does not offer publishes a picker option that fails at run time. So before you edit any
catalog, compare each pin with the latest release:

```bash
cd services/runner
grep -E '"@earendil-works/pi-coding-agent"|"@agentclientprotocol/(claude-agent-acp|codex-acp)"|"@openai/codex"' package.json
for p in @earendil-works/pi-coding-agent @agentclientprotocol/claude-agent-acp \
         @agentclientprotocol/codex-acp @openai/codex; do echo "$p $(npm view $p version)"; done
```

Then see which models each build offers, pinned and latest:

- Pi: run the generator (job 1) against the latest pi-ai into a scratch file, and diff the ids
  with the committed `pi_models.generated.json`.
- Claude: `node probe_claude_models.mjs <claude-agent-sdk>/sdk.mjs` lists the models a Claude Agent
  SDK build offers, with the local Claude login. The pinned copy is the one claude-agent-acp
  bundles (`services/runner/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@*`). For the latest
  copy, `npm i @anthropic-ai/claude-agent-sdk@latest` in a scratch folder.
- Codex: `python codex_bundled_models.py <codex binary>` reads the model presets inside a Codex
  build without running it (get the binary with `npm pack @openai/codex@<version>-linux-x64`).
  Do not run a downloaded Codex binary with the user's ChatGPT login.

When the new models need a newer build, the version bump is part of the job. Bump each harness on
its own branch so each can be tested and rolled back alone, and put the catalog change for that
harness in the same branch. Earlier examples: `git show 9e20fc4c5c` (Pi), `git show acba5707b1`
(Codex). Read "Harness bumps change the Daytona snapshot" below before you start.

Also check open PRs that touch the catalog files (`gh pr list --search "model"`), and leave the
lines they change alone.

### 1. Regenerate the Pi file (on a pi-ai version bump)

The generator reads the pinned pi-ai `models.generated` for the providers Agenta reaches (the
vault-mapped providers plus `openai-codex`) and emits one entry per model. pi-ai provider names are
mapped to Agenta's vocabulary (`google`->`gemini`, `together`->`together_ai`); ids are
`<agenta-provider>/<pi-model-id>`.

**Two copies of pi-ai are installed, and only one of them is the harness.** The runner declares
`@earendil-works/pi-ai` directly at an older version, while `@earendil-works/pi-coding-agent` — the
package that actually runs the agent — carries its own newer copy. Resolve the models file THROUGH
pi-coding-agent, so the catalog describes the models the harness really accepts:

```bash
# From repo root. `realpath` must do the resolving: the path crosses a pnpm symlink, and a `..`
# left in it would be normalized lexically by node's loader back onto the runner's older direct
# copy — silently regenerating against the wrong pi-ai.
MODELS=$(realpath services/runner/node_modules/@earendil-works/pi-coding-agent/../pi-ai/dist/models.generated.js)
node .agents/skills/sync-model-catalog/generate_pi_models.mjs "$MODELS" \
  sdks/python/agenta/sdk/agents/data/pi_models.generated.json
```

The generator prints the version it read, and records it in the output's `_generator.source`. Check
that line: a regeneration that reports an OLDER version than the file already carried has read the
wrong copy — discard it rather than committing a downgrade.

Detect the bump from a lockfile diff on `@earendil-works+pi-coding-agent@<version>`. The curated
overlay is untouched — only the `.generated.json` is rewritten, so the merge on load re-applies the
human judgments.

#### Adding a model pi-ai does not carry yet

A model released after the pinned pi-ai snapshot has no generated entry, so it has no catalog entry
at all: the picker can only show its bare id, and `PROVIDER_DEFAULT_MODELS` drops it (a curated
default must exist in the catalog or the accepted set). The overlay cannot fix this, because an
overlay key only decorates an id the generated file already has.

Put the whole entry in the `additions` list of `pi_models.curated.json` instead, with
`source: "curated"` and every fact sourced from the vendor's own pages. Do not hand-edit the
generated file. A generated entry of the same id always wins at load, so the addition retires
itself the moment a regeneration carries the model. Prune superseded additions after job 1.

An addition also needs a runner entry. The pinned Pi refuses a model id it does not know, so the
runner registers it at run time from `PI_MODELS_AHEAD_OF_CATALOG` in
`services/runner/src/engines/sandbox_agent/pi-model-config.ts`. Without that entry the model runs
with no price, no reasoning and Pi's default context window. Its prices must match the SDK
addition; a runner unit test holds the two together. Remove both entries when a Pi bump carries
the model.

### 2. Sync Claude to the live accepted set (needs a running runner)

`claude_models.curated.json` must cover the stable request values the Claude picker can send.
Probe live sessions by reading the model config options (the same `getConfigOptions` call
`allowedModels` uses in `services/runner/src/engines/sandbox_agent/model.ts`), but do not copy one
session's set blindly. Account entitlements and promotions can add or remove context-hinted variants
such as `claude-fable-5-1[1m]` while keeping the same model family.

Publish the values that every session shape lists. claude-agent-acp 0.109.0 lists the tier
aliases `default`, `opus`, `fable`, `sonnet` and `haiku` for both an API key and a subscription
login, and a subscription login also lists older concrete ids (`claude-fable-5-1`,
`claude-haiku-4-5-20251001`). Neither lists the current concrete ids (`claude-fable-5-2`,
`claude-haiku-5-5`), so the catalog publishes the tier aliases and names the model each one
resolves to. The runner widens a bare alias to a `[1m]` option when that is the only variant on
offer, and runs a concrete id the build does not list on its tier alias (`CLAUDE_TIER_ALIASES` in
`services/runner/src/engines/sandbox_agent/model.ts`, mirrored by `MODEL_ID_ALIASES`). Do not
publish a value one shape lacks; it fails at run time with `ModelNotSettableError`, because the
daemon refuses a value the model option does not list before it reaches the adapter.

To probe without a runner, start the adapter over stdio, send `initialize` and `session/new`, and
read the `model` config option. Run it with a clean env (`env -i HOME=$HOME PATH=$PATH`) so an
outer Claude Code session's variables do not change the listed set. A placeholder
`ANTHROPIC_API_KEY` with an empty `HOME` gives the API-key shape, since the list is built
locally. Requires an authenticated Claude login for the subscription shape, so this is a
manual/periodic step, not a CI gate.

Without a running runner, `probe_claude_models.mjs` (job 0) shows which models the pinned build
offers. Its `value` column holds the SDK's names. claude-agent-acp 0.109.0 lists the tier aliases
under those same names, but an adapter build can rename a value (for example to a concrete id such
as `claude-fable-5-2`), so read the claude-agent-acp source for the exact values the picker sends.

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
live authenticated session. `codex_bundled_models.py` (job 0) lists the pinned build's presets;
publish the `list` ones in priority order. Their `context_window` is a Codex default, not the
model's limit, so take the catalog's context window from OpenAI's model page. Check the
`@openai/codex` range that codex-acp declares: on a 0.x version, `^0.170.0` stops below 0.171.0.
Add it to `CODEX_MODELS` and `codex_models.curated.json`. For Pi's
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
`supported_parameters=tools`, and `output_modalities=text`. Use the first 10 results for both
`supported_llm_models["openrouter"]` and `PROVIDER_DEFAULT_MODELS["openrouter"]`, preserving
response order. The endpoint's `name` field is
the human-readable label.

The ranking changes with usage. Review removals before applying them because a saved connection
may still use a model that fell out of the top 10.

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

## Harness bumps change the Daytona snapshot

A bump of a pinned harness version (Pi, Pi ACP, Codex ACP, Claude ACP) changes a Daytona snapshot
build input. In the same commit, bump `services/runner/config/sandbox-recipe.json` `version`,
regenerate `services/runner/images/sandbox/daytona/sandbox-recipe-fingerprint.json`, and run the
fingerprint test (steps in that folder's `README.md`, "Recipe version"). The new version is a new
snapshot name, which must be built in every Daytona account before the runner that asks for it
deploys.

When several harness bumps go out in one release, they all edit that same `version` line. Land
them one after another, and give the release one snapshot version: the second branch rebases on
the first and regenerates the fingerprint instead of bumping the version again.

## When to run

- Job 0 every time, before any other job.
- Job 1 on a pi-ai bump (automatable from a lockfile diff).
- Jobs 2 and 3 before a release or on demand (need a live session and a web lookup).
- Jobs 4 and 5 when OpenAI or Anthropic announce a model or deprecation.
- Job 6 weekly or before a release; it is safe to run without a credential.

The skill writes files and a proposal; a human reviews the curated changes and commits.
