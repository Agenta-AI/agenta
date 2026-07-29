---
name: sync-model-catalog
description: Regenerate and refresh the curated agent model catalog (the label/description/pricing/ratings behind the agent model picker). Use when the pinned @earendil-works/pi-ai version bumps, when a Claude Code build changes its accepted alias set, or before a release when the curated Claude/Pi facts (lineup, pricing, ratings) need refreshing from current public sources. Owns the data files under sdks/python/agenta/sdk/agents/data/; never edits capabilities.py logic.
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

Three JSON data files under `sdks/python/agenta/sdk/agents/data/`, loaded by
`sdks/python/agenta/sdk/agents/model_catalog.py`:

- `pi_models.generated.json` — machine-generated from pi-ai. Objective facts only (name / pricing /
  context_window / modalities), `source: "pi_generated"`. **Never hand-edit.**
- `pi_models.curated.json` — human overlay for the generated file (id -> `{label?, description?,
  ratings?}`), merged onto the generated facts at load. Survives regeneration.
- `claude_models.curated.json` — hand-curated Claude alias entries (facts + judgments),
  `source: "curated"`.

It never edits `capabilities.py` logic — only these data files.

## The three jobs

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

The skill writes files and a proposal; a human reviews the curated changes and commits.
