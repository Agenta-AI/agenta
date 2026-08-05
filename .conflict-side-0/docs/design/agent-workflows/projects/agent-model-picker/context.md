# Context

## Why this exists

The agent (harness) playground should let a user pick a **provider + model** like the completion and
chat playgrounds do, but the agent case has an extra constraint the prompt case does not: **each
harness can only reach some providers and models**. Claude Code reaches Anthropic only and selects by
alias; Pi reaches eight vault-mapped providers and selects by `provider/id`. The picker must filter
to the selected harness, and that per-harness reach must come from the agent itself (`/inspect`), not
a list hardcoded in the frontend. The user also needs to choose **whether Agenta supplies the
credential** (managed) or the **harness brings its own login** (self-managed), and when managed, to
pick *which* stored connection.

## Current state (merged on `big-agents`, PR #4815)

The backend and a minimal form already landed. The remaining work is UX + one inspect addition.

### Model selection
- The agent config model field renders through the **same grouped picker** as completion/chat:
  `AgentConfigControl` -> `GroupedChoiceControl` -> `SelectLLMProviderBase`
  (`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentConfigControl.tsx:342-349`).
- The picker's choices come from the **whole** shared LiteLLM catalog, **unfiltered by harness**:
  `_model_catalog_type()` deep-copies `supported_llm_models` as grouped `choices`
  (`sdks/python/agenta/sdk/utils/types.py:1046-1055`), registered as `CATALOG_TYPES["model"]`
  (`types.py:1321`). The agent field declares `x-parameter: "grouped_choice"`
  (`types.py:1088-1093`). Catalog source: `sdks/python/agenta/sdk/utils/assets.py:6-193`
  (`supported_llm_models`, provider -> prefixed ids like `anthropic/claude-opus-4-7`).
- A **second, redundant** free-text/select "Provider" field sits in the connection section
  (`AgentConfigControl.tsx:355-380`), disjoint from the model picker.

### Per-harness reach is already in `/inspect`
- `/inspect` publishes `meta.harness_capabilities` via `harness_capabilities_document()`
  (`services/oss/src/agent/app.py:294-300`). The table is
  `sdks/python/agenta/sdk/agents/capabilities.py` with, per harness:
  `providers`, `deployments`, `connection_modes`, `model_selection`
  (`capabilities.py:57-95`). It has **no `models`** field.
- Harness types: `pi_core`, `pi_agenta` (both reach the 8 `PI_VAULT_PROVIDERS`, `model_selection
  "provider/id"`), `claude` (anthropic only, `model_selection "alias"`)
  (`capabilities.py:41-50,76-95`; `HarnessType` `dtos.py:42-58`).
- The agent service uses the same table for a server-side fail-loud reject
  (`app.py:84-117`).

### The frontend ignores inspect and uses a static copy
- `connectionUtils.ts` holds a **hardcoded** `HARNESS_CONNECTION_CAPABILITIES`
  (`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/connectionUtils.ts:146-202`) with a
  `TODO(harness-capabilities)` to consume `/inspect` `meta.harness_capabilities`. The form filters
  the **Provider** select with `allowedProviders(harness)` but never filters the **model** picker.

### Credential (connection)
- The connection rides in the config as `model_ref.connection = {mode, slug}`; the backend coerces a
  structured `model` into `ModelRef` (`sdks/python/agenta/sdk/agents/dtos.py:806-831`,
  `_parse_agent_fields` `:929-960`). So "the frontend sends the connection" already works.
- Modes: `agenta` (managed) and `self_managed` (`connections/models.py` `Connection.mode`); the
  project default is `agenta` with no slug. The form has a mode `Select` and a **free-text** slug
  field with a `TODO(provider-model-auth)` to become a picker once a connections endpoint exists
  (`AgentConfigControl.tsx:382-421`).
- Resolution reads the existing `GET /secrets/` (no new route): `VaultConnectionResolver`
  (`sdks/python/agenta/sdk/agents/platform/connections.py:380-431`). The FE can list connections from
  the existing `vaultSecretsQueryAtom` (`web/packages/agenta-entities/src/secret/state/atoms.ts:78-100`).

## Goals

1. Publish a **per-provider model list per harness** in `/inspect` `meta.harness_capabilities`
   (Pi: vault-reachable providers' ids; Claude: its aliases). The frontend renders from it.
2. Make the frontend **consume `/inspect`** for the capability map (providers, models, modes),
   replacing the static hardcoded copy.
3. **Filter the model picker to the selected harness** and unify it: selecting a model sets both
   `provider` and `model`; drop the redundant standalone Provider field.
4. Present a clear **Authentication** choice — *Agenta* (managed) vs *Self-managed* — and, for
   Agenta, a **connection picker** (project default or a named connection) fed by the existing vault
   list, filtered to the chosen provider.
5. Keep the wire contract and the resolver unchanged; the connection still rides `model_ref.connection`.

## Decisions taken (2026-06-24, with the user)

1. **The per-provider model list is published in `/inspect`.** The backend builds and publishes the
   exact per-harness, per-provider model list in `meta.harness_capabilities`; the frontend renders
   straight from inspect. (Chosen over filtering the shared catalog client-side. Trade-off: the
   model list is duplicated into the capability surface and must be kept fresh; mitigated by sourcing
   it from the same `supported_llm_models` catalog on the backend.)
2. **"Not Agenta authentication" means self-managed login only.** The harness uses its own credential
   in the sandbox (env var or prior OAuth login); Agenta injects nothing. No per-run pasted-key
   channel is added (matches the connection design and completion/chat).
3. **Claude is presented as an alias dropdown** (default, sonnet, opus, haiku, and `[1m]` variants),
   matching `model_selection: "alias"`. The alias list is added to `/inspect`.

## Non-goals (v1)

- A new vault storage model, write path, CRUD, or a new connections route. v1 reads `GET /secrets/`.
- A per-run pasted API key / inline-secret channel.
- Where a deployed agent's durable per-environment default connection lives (a parent open
  decision; the config-stored path is unaffected).
- Migrating the completion/prompt path onto the agent resolver. Completions keep their reader.
- Pi consuming custom endpoints / cloud deployments (Azure/Bedrock/Vertex) — owned by
  [../model-config/](../model-config/); v1 stays `direct`/fail-loud.

## Constraints inherited from the codebase

- `/inspect` `meta.harness_capabilities` must stay a plain JSON-able dict (no model import on the
  consumer side) — `harness_capabilities_document()` (`capabilities.py:98-108`).
- The SDK owns the capability table; the agent service imports it; the SDK must not import the
  service (`../../documentation/ports-and-adapters.md`).
- Frontend API calls go through the Fern client + a zod boundary (`web/CLAUDE.md`). The capability
  map arrives inside the inspect/workflow schema response, not a new endpoint.
- Any wire change updates Python (`utils/wire.py`) and TypeScript (`services/agent/src/protocol.ts`)
  with the golden tests in one PR. This project's inspect-meta change is **not** a `/run` wire change.
