# Plan: curated model catalog, from data file to picker

This plan slices the work, designs the curated data files and the skill that maintains them,
maps the migration so no reader breaks, and sequences everything against the in-flight
capabilities.py / connections.py work. It is design only. No production code changes in this pass.

## The curated data files

Two files, one per data discipline, both consumed by `capabilities.py`.

- Pi: `sdks/python/agenta/sdk/agents/data/pi_models.generated.json`. Fully generated from the
  pinned `@earendil-works/pi-ai` catalog. Header comment says "generated, do not hand-edit; run
  the sync-model-catalog skill." One `ModelCatalogEntry` per model, `source: "pi_generated"`,
  curated fields (`label`/`description`/`ratings`) absent until a human adds them in the sibling
  overlay (below).
- Claude: `sdks/python/agenta/sdk/agents/data/claude_models.curated.json`. Hand-written,
  `source: "curated"`. Facts seeded from pi-ai's `anthropic` block by the skill, then reviewed;
  `label`/`description`/`ratings`/`advertised` written by a human.

Curated overlay for Pi. Ratings and descriptions for Pi models are human judgments and must
survive a regeneration that overwrites the generated file. Keep them in a small separate overlay
`pi_models.curated.json` (id -> `{label?, description?, ratings?, advertised?}`), merged onto the
generated facts at load time. The generator only ever writes the `.generated.json`; the human only
ever edits the `.curated.json` overlay. Regeneration is then safe and idempotent.

Format choice: JSON, not YAML or TS. It is Python-native for the SDK loader, it diffs cleanly for
the generated file, and it needs no new dependency. The generated file is machine-written so
readability loses to a stable diff; the curated files are small enough that JSON is fine to
hand-edit. A short JSON Schema (or the pydantic models themselves) validates both on load and in a
unit test.

Location rationale: under `sdks/python/agenta/sdk/agents/data/` so `capabilities.py` imports them
without a network call and they ship with the SDK, exactly as `CLAUDE_MODEL_ALIASES` ships in code
today. They are data, not code, so they move out of `capabilities.py` into files a skill owns.

## The skill: sync-model-catalog

A skill under `.agents/skills/sync-model-catalog/` that keeps the data honest. It has three jobs.

1. Generate the Pi file. Read the pinned pi-ai `dist/models.generated.js` for the providers Agenta
   reaches (`PI_VAULT_PROVIDERS` plus `openai-codex`). For each model, emit `id`, `name`, `provider`,
   `pricing` (from `cost.input`/`cost.output`/`cacheRead`/`cacheWrite`), `context_window`
   (`contextWindow`), and `modalities` (`input`). Write `pi_models.generated.json`. Run this on a
   pi-ai version bump, which the skill detects from a lockfile diff on
   `@earendil-works+pi-ai@<version>`.

2. Seed and validate Claude. Seed Claude facts from pi-ai's `anthropic` block (name, pricing,
   context window per `claude-*` id), then validate the curated file against the live accepted set:
   start a Claude session on a running runner, read the model config options
   (`getConfigOptions`, the same call `allowedModels` uses in `model.ts:62`), and diff the reported
   ids against the curated file. This probe is how the skill learns the real Fable id spelling and
   any id a new Claude Code build adds. It needs an authenticated Claude session, so it is a manual
   or periodic step, not a CI gate.

3. Report drift. Compare the three sets from `design.md`: advertised (what `capabilities.py`
   publishes), curated (the data files), accepted (the live probe). Emit the three-way diff
   (advertised-not-accepted, accepted-not-catalogued, catalogued-not-accepted) so a human acts on it.
   The over-advertised `default[1m]` and `haiku[1m]`, and the accepted-but-missing Fable, are the
   first findings this report should surface.

When it runs: on a pi-ai bump (jobs 1 and 3, automatable), and before a release or on demand (job 2,
needs a live session). The skill writes files and a report; a human reviews the curated changes and
commits. The skill never edits `capabilities.py` logic, only the data files.

## The migration: additive field, then cut over

The field to change is the harness capability record's `models` map, served through the harnesses
catalog (`GET /workflows/catalog/harnesses/` and `/{ag_harness}`). It is loosely typed at the Fern
layer (`WorkflowCatalogHarness.capabilities` is `Record<string, unknown>`), so adding a field does
not break the generated client. Migrate additively in three steps so no reader breaks at any point.

Step 1, backend adds the new field. `HarnessConnectionCapabilities` keeps `models: Dict[str, List[str]]`
(unchanged, still the ids-only map) and gains `model_catalog: List[ModelCatalogEntry]` built from the
data files. Both are published. Every current reader keeps working because `models` is untouched.

Step 2, frontend reads the new field. The picker switches from `models` to `model_catalog`:

- `web/packages/agenta-entities/src/workflow/state/inspectMeta.ts:24-38`: add `model_catalog?: ModelCatalogEntry[]`
  to the `HarnessCapabilities` type (keep `models` for one release).
- `web/packages/.../SchemaControls/connectionUtils.ts`: `buildModelOptionGroups` (`:252-269`) reads
  `model_catalog` when present, grouping by `entry.provider` and mapping each entry to
  `{ label: entry.label ?? entry.name ?? entry.id, value: entry.id, description: entry.description }`.
  This is exactly the empty seam that already exists: the function takes an optional
  `metadata?: ModelMetadataMap` (`:239`, `:255`) that `useModelHarness` calls without data (`:228`).
  The catalog fills that seam. `providerForModel` (`:276-288`) still keys off the provider group.
- The description renders in the option tooltip (`SelectLLMProviderBase`). Ratings render nothing in
  this slice; they ship in the data and wait for a later UI slice.
- Fallback: when `model_catalog` is absent (an older backend), the picker uses `models` exactly as
  today. So the two sides can deploy in any order.

Step 3, drop the old field. Once the frontend reads `model_catalog` everywhere and the compat window
passes, remove `models` from the capability record and the SDK tests that assert it
(`test_capabilities.py:116`, `:135`, `:144`). `models` can also be kept as a derived, deprecated view
(the ids of the advertised entries) if any external reader needs it; decide at cut-over.

Readers to update in lockstep, from `research.md`:

- `capabilities.py:126-194` (build both fields from the data files).
- `connections.py:23-52` and `:109` (the server-side capability check imports `CLAUDE_MODEL_ALIASES`;
  point it at the catalog's advertised Claude ids instead, or keep the constant as a thin derived view).
- `utils/types.py:1082-1084` (default-harness schema).
- `test_capabilities.py`, `test_builtin_uri_binding.py:75` (assert the new field; keep the old
  assertions until step 3).
- Frontend: `inspectMeta.ts`, `connectionUtils.ts`, `useModelHarness.tsx` (steps above).

Do not touch: the prompt-playground path (`ModelConfigEditor.tsx`, `_model_catalog_type()`,
`supported_llm_models`, `model_metadata` in `assets.py`). `provider-model-auth` declares that path an
invariant, and the agent path is a different consumer.

## Work packages

WP1, schema and data files. Add the pydantic models (`ModelCatalogEntry`, `ModelPricing`,
`ModelRatings`, `ModelCatalog`), the three JSON files (Pi generated, Pi curated overlay, Claude
curated), and the loader in `capabilities.py` that merges overlay onto generated and publishes
`model_catalog` alongside `models`. Unit test: the files load, validate, and every advertised id has
an entry. This is the standalone, non-breaking core.

WP2, the skill. `sync-model-catalog` with the three jobs above. Includes the pi-ai generator, the
live Claude probe, and the drift report. Independent of the frontend; can land before or after WP3.

WP3, frontend cutover. Steps 2 above: read `model_catalog`, show label and description, keep selection
working, keep the `models` fallback. Ratings deferred.

WP4 (deferred), ratings UI and the runtime accepted-set source. Render the ratings meter in the
picker, and switch the picker's source of truth from the static advertised set to the runtime accepted
set (building on `model-config` Part 3 layer 2), decorated by this catalog. Both are follow-ons, not
needed for the first value.

## What is cut or deferred

- Ratings rendering in the UI. The data ships; the meter waits for WP4.
- The runtime accepted-set inspect surface. Owned by `model-config` Part 3 layer 2; this project
  consumes it later, does not build it.
- Auto-curation of ratings or descriptions. Those stay human. The skill seeds facts, never judgments.
- The prompt-playground path. Untouched by design.
- Per-field provenance. One `source` per entry; the data file is the provenance unit.

## Coordination and sequencing

An active `root-codex` / provider-model-auth session is reworking `capabilities.py` and
`connections.py` in this exact area (coordination board, and the INTENT note this project posted).
Three overlaps, and how this plan avoids a collision:

- `capabilities.py` is owned by the open `agent-model-picker` PR (it added `models` and
  `CLAUDE_MODEL_ALIASES`) and touched by the in-flight connection rework. This plan is additive on
  that file: it adds `model_catalog` and a loader, and it does not rewrite `_pi_models()` or
  `CLAUDE_MODEL_ALIASES` in place. Sequence WP1 after the `agent-model-picker` PR lands, so the new
  field stacks on the merged `models` field rather than conflicting with it.
- `connections.py` is owned by `provider-model-auth` and is being changed by `custom-providers-in-pi`
  (a deployment-enum tightening and a resolver change). This plan's only touch there is repointing the
  `CLAUDE_MODEL_ALIASES` import to the catalog's advertised Claude ids, and even that can be deferred
  to step 3 or kept as a thin derived view. Do that repoint after the `custom-providers-in-pi` resolver
  change lands, not concurrently.
- `custom-providers-in-pi` adds a second picker source (the vault's custom-provider models,
  `vaultModelGroups` in `connectionUtils.ts`). That is a different source joined under the same
  reachability filter; the catalog decorates the static harness source and does not touch the vault
  source. They compose: a later slice can decorate vault models too, once both have landed.

Net sequencing: land the two open PRs (`agent-model-picker`, and the `provider-model-auth` /
`custom-providers-in-pi` connection changes) first; then WP1 additive on `capabilities.py`; WP2 skill
in parallel; WP3 frontend once WP1 publishes the field; WP4 after `model-config` Part 3 layer 2.

Keep the INTENT note on the coordination board current, and ping `root-codex` before WP1 touches
`capabilities.py`, so the additive change stacks cleanly on their rework rather than racing it.
</content>
