# Context

## Why this exists

A user selects a model and a provider for a Pi agent in the playground. The run should call that
model with that provider's credential. Today this works for a built-in provider once its
`provider_key` is stored. It does not work for a custom provider, and it can fail silently for a
built-in provider too. This project makes the full path work for Pi, custom providers included.

The concrete trigger: OpenRouter works when stored as a `provider_key` (Pi ships 253 built-in
OpenRouter models and reads `OPENROUTER_API_KEY`), but the same OpenRouter stored as a
`custom_provider` is rejected before the run even starts. That single inconsistency exposes four
more gaps around it. All five are diagnosed in [research.md](research.md) with verified file and
line references.

## What is already built (do not rebuild)

This project is deliberately small because two siblings already did the heavy lifting.

- **`provider-model-auth` (BUILT, PR #4815 to `big-agents`).** It replaced the whole-vault
  credential dump with a deterministic single-connection resolver built from the existing
  `GET /secrets/` catalog (`sdks/python/agenta/sdk/agents/platform/connections.py`). It added the
  `ResolvedConnection` contract (`provider`, `model`, `deployment`, `credential_mode`, `env`,
  `endpoint`), the harness capability table (`sdks/python/agenta/sdk/agents/capabilities.py`),
  the pre-resolve and post-resolve capability checks in `services/oss/src/agent/app.py`, and the
  runner clear-then-apply of provider env. Its Slice 4 already emits `resolved_connection` on the
  `/run` wire (`wire_resolved_connection()`), carrying `endpoint.baseUrl` and the exact selected
  model id. So the inputs this project needs already reach the runner.
- **`model-config` (DESIGNED, not built).** Its `proposal.md` specifies Part 1 (write
  `auth.json`/`models.json` into Pi's per-run agent dir), Part 2 (fail loud on an unsettable model,
  staged `AGENTA_AGENT_MODEL_STRICT`), and Part 3 (model choices in the schema per harness). This
  project implements Parts 1 and 2 in the runner and extends Part 3's choice surface.

## Current state, with citations

Every reference below was re-verified on 2026-07-02. Full snippets are in
[research.md](research.md). Two corrections to the prior docs came out of that pass:

- The runner TypeScript lives at `services/runner/src/`, not `services/agent/src/`. The rename
  landed in commit `b323a8516f` (`chore(runner): rename sandbox-agent -> runner`). Prior sibling
  docs still cite `services/agent/src/`; every runner path here uses `services/runner/src/`.
- The frontend reads the harness capability catalog from `GET /workflows/catalog/harnesses/`
  (served from `capabilities.py` `harness_catalog_document`), not from the `/inspect` response
  `meta`. The `connectionUtils.ts` file header still claims `/inspect`; that comment is stale.

The five gaps, each a one-line statement of the current behavior:

1. `_custom_provider_candidate` (`connections.py:274-309`) sets `deployment` to the raw vault
   `kind`, so a known-direct custom provider (OpenRouter, OpenAI) resolves with, for example,
   `deployment="openrouter"`. The post-resolve check (`app.py:110-125`,
   `harness_allows_deployment` at `capabilities.py:225-236`) rejects it because Pi advertises
   `deployments=["direct"]` (`capabilities.py:146`).
2. The runner never writes a Pi `models.json` (grep of `services/runner/src/` returns zero). It
   only copies the login's `auth.json`/`settings.json` (`pi-assets.ts:178-195`). A custom base URL
   and genuinely custom model ids never reach Pi.
3. `applyModel` (`model.ts:46-74`) silently falls back to the harness default when `setModel`
   fails. Strict is wired for Claude only (`sandbox_agent.ts:193-200`, `582-587`). A
   requested-but-unsettable model returns HTTP 200 on the wrong model.
4. The picker is built only from the static harness catalog. `buildModelOptionGroups`
   (`connectionUtils.ts:239-256`) reads only `capabilities[harness].models`; each vault
   custom-provider's `models` array is dropped at the `VaultConnectionEntry` type boundary.
5. The provider-to-env map emits `TOGETHERAI_API_KEY` for `together_ai`
   (`platform/secrets.py:100` and two sibling copies), but Pi reads `TOGETHER_API_KEY`.

## Goals

1. A custom provider whose kind is a known direct provider works on Pi, exactly like the same
   provider stored as a `provider_key`.
2. A custom base URL and genuinely custom model ids reach Pi through its per-run agent dir, local
   and Daytona alike, without a raw secret ever landing on disk.
3. A requested model that cannot be set fails loud with the allowed set, not a silent wrong-model
   HTTP 200.
4. The frontend picker shows a project's custom-provider models for the selected harness.
5. A Together key reaches Pi.

## Non-goals

- Bedrock, Vertex, and Azure consumption on Pi stays fail-loud, exactly as
  `provider-model-auth` and `model-config` already stage it. This project does not wire multi-var
  cloud credential delivery into Pi.
- No vault storage change: no new secret kind, no migration, no `/secrets` write path. This
  project reads the existing `provider_key` and `custom_provider` secrets.
- No new `/run` wire field. Every input already rides `resolved_connection` and `secrets`; the
  runner derives the Pi config from them.
- No change to the prompt/completion path. It keeps its own LiteLLM reader of the same vault.

## Constraints inherited from the codebase

- The Python service decides what to run; the runner runs it. The Pi `auth.json`/`models.json`
  write is derived inside the runner from `request.secrets` and `resolved_connection`, both
  already on the stable `/run` contract. Do not widen the wire (per `model-config` Part 3's
  boundary note and the `provider-model-auth` design).
- The provider-to-env map is duplicated across three files today
  (`platform/secrets.py`, `platform/connections.py`, `connections/resolver.py`) and has already
  drifted on `minimax`. Any map fix touches all copies and should note the drift.
</content>
