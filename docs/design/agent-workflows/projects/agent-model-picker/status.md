# Status

Source of truth for where this work stands. Keep it current.

## State

**Implemented (A-E); green; PR open on `big-agents`.** Built on the just-landed
contract-versioning (#4829) and wire-schema (#4830) work; this lane is stacked on
`feat/agent-wire-contract-schema-plan` (#4830). The parent
[../provider-model-auth/](../provider-model-auth/) (PR #4815) is **merged** and provides the
backend `ModelRef` + connection resolver + `/inspect` capability table + a minimal form.

**Phase F (connection-UX rework) — DEFERRED 2026-06-25.** Implemented + green + reviewer-clean,
but REVERTED to unblock a merge: a frontend engineer needed #4839 (`feat/agent-model-picker`)
in `big-agents` to land their playground work, so #4839 is merged at its last clean WORKING
picker state and Phase F resumes after. The rework was uncommitted working-tree only; reverting
left the lane untouched and mergeable. Resume notes below.

### Phase F resume notes (design is DECIDED — just re-apply)

Goal (user decision): align the agent credential UX with the completion/chat playground —
drop the user-facing "Project default", rename copy away from "connection", keep standard
provider keys implicit (resolved server-side by provider kind). FE sends a reference, never a
key (already true).

Codex (xhigh) BLESSED the plan with one correction, folded in:
- **Keep `ModelRef.connection {mode, slug}`** — the right agent abstraction (agents have the
  real extra axis Agenta-vault vs harness-own-login that completion/chat lacks). But stop using
  "connection" as a user-facing noun.
- **Rename UI copy:** Authentication / Agenta-managed / **Self-hosted** (was "Self-managed") /
  **"Provider key"** (was "Connection") for the optional selector.
- **Standard `provider_key` secrets stay IMPLICIT** — do NOT list `OPENAI_API_KEY` as a
  pickable value (invents vocabulary the product lacks). Keep `namedConnectionOptions`
  custom-provider-only (it already is). Show the picker only when `connectionOptions.length > 0`.
- **Keep `_choose_default`** as the implicit server fallback (no slug → resolve by provider
  kind). `connection.mode="agenta"` with omitted `slug` stays the implicit default — never a
  labeled UI value.
- **Smallest change = pure FE** (`AgentConfigControl.tsx` Authentication section +
  `connectionUtils.ts` comments). NO SDK / `/run` wire / resolver change. No new tests strictly
  required (the load-bearing logic — `composeModelValue` omitting the connection block for the
  default, the round-trip, custom-provider-only options — is already covered in
  `tests/unit/connectionUtils.test.ts`).

Exact edit that was verified green (entity-ui 126 tests + tsc + eslint + a reviewer pass, no
regressions): in `AgentConfigControl.tsx` replace the Authentication block's `__default__`
Select with a picker rendered only when `connectionOptions.length > 0` (label "Provider key",
`allowClear`, `value={connection.slug ?? undefined}`, placeholder, `onChange/onClear` →
`writeModel({slug: v ?? null})`), an empty-state note otherwise, and rename the Segmented
"Self-managed" label to "Self-hosted"; update the `connectionUtils.ts` doc comments to say the
default is the implicit server-side behaviour, not a UI value.

Last updated: 2026-06-25.

## What landed

- **Phase A (SDK).** `HarnessConnectionCapabilities` gained a `models: Dict[str, List[str]]`
  field; `HARNESS_CONNECTION_CAPABILITIES` populates it — Pi from `supported_llm_models` for each
  `PI_VAULT_PROVIDERS` entry (defensive `_pi_models()` skips a missing provider), Claude from a new
  `CLAUDE_MODEL_ALIASES` constant (`default`/`sonnet`/`opus`/`haiku` + `[1m]` variants) under
  `anthropic`. `harness_capabilities_document()` emits it (via `model_dump()`), so `/inspect`
  `meta.harness_capabilities` carries per-harness models. NOT a `/run` wire change. Contract test
  extended. (`sdks/python/agenta/sdk/agents/capabilities.py`.)
- **Phase B (FE plumbing).** New inspect-meta atom
  `harnessCapabilitiesAtomFamily(revisionId)` derives `meta.harness_capabilities` from
  `workflowInspectAtomFamily` (`web/packages/agenta-entities/src/workflow/state/inspectMeta.ts`,
  exported via the workflow barrel). `connectionUtils.ts` retired the static FE capability map; its
  helpers now take the inspect-fed `HarnessCapabilitiesMap` and stay permissive when absent.
- **Phase C (picker).** Unified harness-filtered provider + model picker
  (`buildModelOptionGroups` + `SelectLLMProviderBase`): selecting a model sets BOTH provider and
  model (`providerForModel` derives the provider from the group). The standalone Provider field is
  gone. Harness switch clears an unreachable model (`harnessAllowsModel`). Falls back to the schema
  catalog when inspect publishes no models.
- **Phase D (auth).** Authentication `Segmented` toggle (Agenta-managed vs Self-managed) + a
  connection picker (Project default / named connections from `vaultSecretsQueryAtom`,
  `namedConnectionOptions` filtered to provider + harness). Self-managed shows a note. Raw-JSON
  hatch kept.
- **model = ModelRef fold-in (#4821 c3469645457).** `composeModelValue` ALWAYS returns a structured
  ModelRef object — the bare-string path is dropped. `connectionFromConfig`/`modelIdFromConfig`
  still READ a legacy bare string so an old stored config populates the picker.
- **Phase E.** Docs synced: this status, the inspect interface inventory entry (now lists
  `models`), and `documentation/agent-configuration.md` (picker + auth UX).

## Decisions (taken with the user, 2026-06-24)

1. **Per-provider model list is published in `/inspect`** `meta.harness_capabilities` (not filtered
   client-side from the shared catalog). The backend builds it from `supported_llm_models` (Pi) and a
   Claude alias constant; the frontend renders straight from inspect.
2. **"Not Agenta auth" = self-managed login only.** No per-run pasted-key channel.
3. **Claude is an alias dropdown** (`default/sonnet/opus/haiku` + `[1m]`), matching
   `model_selection: "alias"`. Alias list added to `/inspect`.

## What this project does NOT change

- The `/run` wire contract and golden tests (the inspect-meta change is not a `/run` change).
- The connection resolver and the `GET /secrets/`-backed resolution (parent's work).
- Vault storage / routes. No `GET /vault/connections` (the parent reworked away from it).

## Key facts grounding the plan (verified)

- `/inspect` publishes `meta.harness_capabilities` (`services/oss/src/agent/app.py:294-300`); the
  table is `sdks/python/agenta/sdk/agents/capabilities.py:57-95`; it has **no `models`** field yet.
- The agent model picker is `GroupedChoiceControl` -> `SelectLLMProviderBase`
  (`AgentConfigControl.tsx:342-349`), fed by the **whole** `supported_llm_models` catalog
  (`types.py:1046-1055,1321`), **unfiltered by harness**.
- The FE capability map is a **static** copy with a TODO to consume inspect
  (`connectionUtils.ts:146-202`).
- The connection rides `model_ref.connection` already; slug is **free text** today
  (`AgentConfigControl.tsx:400-421`). Vault list available via `vaultSecretsQueryAtom`
  (`secret/state/atoms.ts:78-100`).

## Open items / risks

- **FE plumbing (RESOLVED).** `harnessCapabilitiesAtomFamily(revisionId)` (new
  `workflow/state/inspectMeta.ts`) derives `meta.harness_capabilities` from
  `workflowInspectAtomFamily`. `AgentConfigControl` reads the open revision id from the optional
  drill-in context (`useOptionalDrillIn().entityId`) and falls back permissively when absent
  (standalone control / no drill-in provider).
- **openai catalog ids are NOT provider-prefixed.** Contrary to the research note, `supported_llm_models["openai"]`
  lists bare ids (`gpt-5.5`, `gpt-5.4`, …) while other providers are prefixed
  (`anthropic/claude-...`). The picker (`buildModelOptionGroups`) uses the catalog id verbatim as
  the option `value` and the provider comes from the group key, so the mix is handled — but the
  contract test does NOT assert provider-prefixing for this reason. ModelRef carries provider
  separately, so a bare openai id round-trips fine.
- **Model freshness:** publishing the list in inspect duplicates it from the catalog; mitigated by
  sourcing from `supported_llm_models` on the backend so there is still one edit point. Note in
  the `update-llm-model-list` skill scope: editing the catalog also changes what `/inspect`
  publishes for Pi harnesses.
- **Claude alias list source:** `CLAUDE_MODEL_ALIASES` (`default`/`sonnet`/`opus`/`haiku` +
  `[1m]`) from the harness matrix; revisit if the runner's accepted alias set changes
  (`../model-config/`).
- **Pricing metadata:** the picker accepts an optional `ModelMetadataMap` but the control does not
  yet wire pricing into the inspect models (nice-to-have; the FE can look it up from the shared
  catalog). Deferred.

## Done

1. Phase A: `models` in the capability table + document + contract test. DONE (green).
2. Phase B: inspect `meta` threaded to the FE; static map retired. DONE.
3. Phase C/D: harness-filtered unified picker + authentication/connection picker. DONE.
4. Phase E: docs synced. DONE. Live feature-matrix verification is a follow-up (deferred).

To implement, run the `implement-feature` skill against this folder.
