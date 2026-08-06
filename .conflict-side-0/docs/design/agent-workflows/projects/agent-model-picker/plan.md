# Plan

Five phases, backend-first so the frontend has real `/inspect` data to render. Each phase is
independently shippable and green on its tests. Decisions taken are in [context.md](context.md).

## Phase A — Backend: publish the per-provider model list in `/inspect`

Add a `models` map to the per-harness capability surface so the frontend can render the picker
straight from inspect.

- **A1.** Extend `HarnessConnectionCapabilities` with
  `models: Dict[str, List[str]] = {}` (provider family -> list of model ids/aliases), keeping the
  existing `providers`/`deployments`/`connection_modes`/`model_selection`
  (`sdks/python/agenta/sdk/agents/capabilities.py:57-73`).
- **A2.** Populate `models` in `HARNESS_CONNECTION_CAPABILITIES` (`:76-95`):
  - `pi_core` / `pi_agenta`: `{p: supported_llm_models[p] for p in PI_VAULT_PROVIDERS}` (import the
    catalog from `agenta.sdk.utils.assets`). Keep the import light; the SDK already imports assets.
  - `claude`: `{"anthropic": CLAUDE_MODEL_ALIASES}` — a new module constant
    (`default, sonnet, opus, haiku` + `[1m]` variants per the harness matrix).
- **A3.** Emit `models` from `harness_capabilities_document()` (`:98-108`) so `/inspect` `meta`
  carries it. Optionally attach per-model pricing as `x-ag-metadata` from `model_metadata`
  (nice-to-have; can defer to the FE looking it up). No `/run` wire change.
- **A4.** Keep the SDK as the single source; the agent service already imports the table
  (`services/oss/src/agent/app.py`). No service change beyond re-publishing.

**Tests (A).** Extend the capability-table contract test
(`sdks/python/oss/tests/pytest/unit/agents/connections/test_capabilities.py`): every harness has a
`models` map; Pi's providers ⊆ `supported_llm_models`; Claude's models are the alias set; the
document round-trips as a plain dict. Assert `model_selection` still matches per harness.

## Phase B — Frontend: consume `/inspect`, retire the static map

- **B1.** Find how the inspect/workflow-schema response reaches the playground (the atom/selector
  that holds `parameters` schema for `agent_config`) and surface `meta.harness_capabilities`
  alongside it. Add a selector (e.g. `harnessCapabilitiesAtom`) keyed to the current
  workflow/revision. (This is the main FE unknown — see research.md "Open question".)
- **B2.** Replace the static `HARNESS_CONNECTION_CAPABILITIES` in `connectionUtils.ts:146-202` with
  the inspect-fed map. Keep `allowedProviders`/`allowedConnectionModes`/`harnessAllowsProvider` as
  pure helpers but read from the passed-in capability object. Keep a **permissive fallback** (show
  everything) when `meta` is absent (older agents, standalone). Remove the
  `TODO(harness-capabilities)`.

**Tests (B).** Unit-test the helpers against an inspect-shaped capability object (filter providers,
modes; permissive fallback when missing).

## Phase C — Frontend: harness-filtered, unified provider+model picker

- **C1.** Build the grouped model options from `capabilities[harness].models` (provider -> ids) and
  pass them to `GroupedChoiceControl` / `SelectLLMProviderBase` instead of the full catalog from the
  schema's `choices`. Reuse `SelectLLMProviderBase`'s `ProviderGroup[]` shape; map pricing from
  `model_metadata`/`x-ag-metadata` if present.
- **C2.** Make the picker the single source of the provider: selecting a model sets both
  `model_ref.model` and `model_ref.provider`. **Remove the standalone Provider field**
  (`AgentConfigControl.tsx:355-380`) or render it read-only/derived. Honor `model_selection`:
  - `provider/id` (Pi): value is the prefixed id; derive `provider` from the group.
  - `alias` (Claude): value is the bare alias; `provider = "anthropic"`. Update
    `connectionUtils` `composeModelValue`/`modelIdFromConfig` accordingly.
- **C3.** On harness change, re-filter; if the current model is unreachable under the new harness,
  clear it (or surface an inline warning) rather than sending an unsupported model.

**Tests (C).** Extend the `connectionUtils` helper tests: option building from inspect models;
alias coercion for Claude; provider derived from the picked model; harness-switch clears an
unreachable model. (`web/packages/agenta-entity-ui/.../__tests__` per package practices.)

## Phase D — Frontend: authentication choice + connection picker

- **D1.** Replace the bare connection-mode `Select` with a clear **Authentication** control:
  *Agenta (managed)* vs *Self-managed*. Map to `connection.mode` (`agenta` / `self_managed`).
  Filter the options by `capabilities[harness].connection_modes`.
- **D2.** For *Agenta*, replace the free-text slug (`AgentConfigControl.tsx:400-421`) with a
  **connection picker**:
  - Option "Project default" -> `slug = null`.
  - Named connections -> from `vaultSecretsQueryAtom`
    (`web/packages/agenta-entities/src/secret/state/atoms.ts:78-100`), filtered to the selected
    provider and the harness's reachable providers. Show `header.name`; value = the slug.
  - Keep an inline guard when a named connection is required but missing (existing behavior at
    `AgentConfigControl.tsx:413-419`).
- **D3.** For *Self-managed*, show a short note ("the harness uses its own login; Agenta injects
  nothing") and send `connection: {mode: "self_managed"}`. Keep the raw-JSON escape hatch for power
  users.

**Tests (D).** Helper/unit tests: connection options filtered by provider + harness; "Project
default" yields `slug=null`; self-managed yields `{mode:"self_managed"}`. No new backend route; this
reuses `GET /secrets/`.

## Phase E — Verification, docs, landing

- **E1.** Live verification on the running stack (the agent feature-matrix), per the
  `agent-workflows-qa` skill: Pi + OpenAI default connection; Pi + a named OpenAI connection; Pi +
  Gemini; Claude alias (`opus`); a self-managed run. Confirm the picker filters per harness and the
  resolved connection matches what was picked.
- **E2.** Docs in the same PR via `keep-docs-in-sync`: update
  `../../documentation/agent-configuration.md` (model/provider/connection UX), the interface
  inventory entry for `/inspect` `meta` (now carries `models`), and this project's `status.md`.
- **E3.** Land as a GitButler stacked branch on `big-agents` (per the repo's GitButler rules), this
  feature's files only; coordinate shared-file edits (`capabilities.py`,
  `connectionUtils.ts`, `AgentConfigControl.tsx`) via `../../scratch/agent-coordination.md`.

## Test strategy summary

| Phase | Backend | Frontend | Live |
| --- | --- | --- | --- |
| A | capability-table contract (+`models`) | — | — |
| B | — | helper filter/fallback tests | — |
| C | — | option-build + alias coercion tests | — |
| D | — | connection-option tests | — |
| E | — | — | feature-matrix matrix run |

## Sequencing / dependencies

- A before C/D (the FE needs `models` + the inspect-fed map).
- B before C/D (both read the inspect-fed capability object).
- C and D are independent once B lands; can go in either order or together.
- E last.
