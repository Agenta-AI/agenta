# Research

Findings from reading the merged code on `big-agents` (2026-06-24). Every claim cites `file:line`.
Grouped by the four questions the request raises.

## Q1. How model authentication works right now

The whole-vault dump is **gone**; PR #4815 replaced it with a least-privilege resolver.

- The agent config carries a structured `ModelRef` (`provider` + `model` + `params` +
  `connection`): `sdks/python/agenta/sdk/agents/connections/models.py` — `ModelRef` (`:108-158`),
  `Connection` (`mode` + `slug`, `:42-74`), `ResolvedConnection` (`provider`/`model`/`deployment`/
  `credential_mode`/`env`/`endpoint`, `:160-201`). A bare-string `model` still works: it is coerced
  in `dtos.py:_split_model_ref` (`:806-831`) and `_coerce_model_ref` (`:389-390`, `:506-507`).
- At run time the service builds a `ModelRef` + `RuntimeAuthContext`, calls the resolver, and feeds
  the result into `SessionConfig.secrets` / `resolved_connection`
  (`services/oss/src/agent/app.py:_agent()`, the resolve around `:83`).
- The resolver reads the **existing** `GET /secrets/`, builds an in-memory connection catalog, picks
  **one** connection by `ModelRef` (named slug, or unique project default), and returns only that
  connection's env: `sdks/python/agenta/sdk/agents/platform/connections.py` —
  `_resolve_from_secrets` (`:346-368`), `VaultConnectionResolver.resolve` (`:391-431`). No new route
  (`:4-9` header: "uses the existing `GET /secrets/` … connection is only a runtime read view").
- Modes: `agenta` (managed) and `self_managed` (`models.py` `Connection.mode`,
  `ConnectionMode = Literal["agenta","self_managed"]`). Project default = `agenta` with no slug.
  `self_managed` injects nothing (the harness uses its own login).
- The TS runner clears inherited provider env then applies only the resolved env (no cross-provider
  leak): the parent project's Slice 4 (`services/agent/src/engines/sandbox_agent/daemon.ts`,
  `pi.ts withRequestProviderEnv`). Out of scope to change here.

Prior whole-vault behavior (now replaced) is documented in
[../../scratch/notes-model-auth.md](../../scratch/notes-model-auth.md).

## Q2. What is inside `/inspect`

`/inspect` is published by the agent workflow decorator
(`services/oss/src/agent/app.py:294-300`). It returns:

- `inputs` / `parameters` / `outputs` JSON schemas (`services/oss/src/agent/schemas.py:105-109`);
  `parameters` carries `x-ag-type-ref: "agent_config"` (the form-driving catalog type).
- `meta.harness_capabilities` = `harness_capabilities_document()`
  (`app.py:296`; `sdks/python/agenta/sdk/agents/capabilities.py:98-108`).

The capability table (`capabilities.py`):

```
HarnessConnectionCapabilities (:57-73):
  providers: List[str]          # the provider families the harness reaches
  deployments: List[str]        # default ["direct"]
  connection_modes: List[str]   # default ["agenta","self_managed"]
  model_selection: str          # "provider/id" | "alias"

HARNESS_CONNECTION_CAPABILITIES (:76-95):
  pi_core / pi_agenta: providers = PI_VAULT_PROVIDERS (8), deployments=[direct],
                       modes=[agenta,self_managed], model_selection="provider/id"
  claude:              providers = ["anthropic"],
                       deployments=[direct,custom,bedrock,vertex_ai,vertex],
                       modes=[agenta,self_managed], model_selection="alias"
PI_VAULT_PROVIDERS (:41-50): openai, anthropic, gemini, mistral, groq, minimax,
                             together_ai, openrouter
```

**There is no `models` field.** That is the one inspect addition this project makes. The table is
also consumed server-side for the fail-loud reject: `harness_allows_provider/mode/deployment`
(`capabilities.py:111-147`), called pre/post resolve in `app.py:84-117`. There is a separate,
unrelated runtime probe `HarnessCapabilities` (boolean feature flags, `dtos.py:108-147`) that is
parsed but unused downstream — not relevant here.

## Q3. How completion/chat picks a provider + model (the pattern to match)

- Picker component: `web/packages/agenta-ui/src/SelectLLMProvider/SelectLLMProviderBase.tsx`
  (`:31-340`) — a grouped provider dropdown; options shape `ProviderGroup[] = {label, options:
  {label, value, metadata}[]}`. Cascading per-provider submenu when `showGroup` + model options.
- Model list source (one catalog): `sdks/python/agenta/sdk/utils/assets.py` —
  `supported_llm_models` (`:6-193`, provider -> prefixed ids), `providers_list` (`:195`),
  `_build_model_metadata()` pricing (`:225-247`), `model_to_provider_mapping` (`:249-253`).
- Schema injection: `MCField()` (`sdks/python/agenta/sdk/utils/types.py:49-69`) injects
  `choices` + `x-ag-type: grouped_choice` + `x-ag-metadata` (pricing). The catalog model type is
  `_model_catalog_type()` (`:1046-1055`), registered `CATALOG_TYPES["model"]` (`:1321`); the prompt
  config references it via `x-ag-type-ref: "model"` (`:418`, `:571`).
- Schema -> UI options: `getOptionsFromSchema()`
  (`web/packages/agenta-shared/src/utils/schemaOptions.ts:17-54`) reads `choices` (grouped) or
  `enum` (flat) + `x-ag-metadata`.
- Credentials: resolved **server-side** from the vault; the completion request sends only the model
  string, no key (`sdks/python/agenta/sdk/managers/secrets.py:get_provider_settings` `:158-246`,
  model->provider via `model_to_provider_mapping`). **No per-request pasted-key override** — which is
  why decision #2 (self-managed only) keeps agent parity with completion.

The agent form already reuses this exact picker (`AgentConfigControl.tsx:342-349` ->
`GroupedChoiceControl` -> `SelectLLMProviderBase`). The gap is the **options source** (full catalog,
not harness-filtered) and the **redundant Provider field**.

## Q4. How the connection is chosen and sent

- The connection lives in `model_ref.connection` inside the config the playground already posts to
  `/invoke`; backend parse `AgentConfig.from_params` / `_parse_agent_fields`
  (`dtos.py:929-960`), structured-model coercion `_split_model_ref` (`:806-831`). **No new request
  field is needed** to "send the connection".
- Current form controls (`AgentConfigControl.tsx`): model picker (`:342-349`), a standalone Provider
  free-text/select (`:355-380`), a connection-mode `Select` (`:382-398`), a **free-text** slug
  (`:400-421`, with a `TODO` to become a picker), a raw-JSON escape hatch (`:423-464`).
- Listing connections for a picker: the existing `GET /vault/secrets/` -> `vaultSecretsQueryAtom`
  (`web/packages/agenta-entities/src/secret/state/atoms.ts:78-100`, fetched by `fetchVaultSecret`
  `secret/api/api.ts:29-36`). Secret shape: `SecretResponseDTO` with `kind`
  (`provider_key`/`custom_provider`), `header.name` (the connection name/slug), and the provider
  kind (`api/oss/src/core/secrets/dtos.py`, `enums.py StandardProviderKind`/`CustomProviderKind`).
  A named connection = a secret whose `header.name` is set; its provider is the standard kind or the
  custom `provider_slug`. **No `GET /vault/connections` route exists** (the parent reworked to use
  `GET /secrets/`); the design-doc reference to it is stale.
- The FE static capability map to be replaced: `connectionUtils.ts:146-202`
  (`HARNESS_CONNECTION_CAPABILITIES`, `allowedProviders`, `allowedConnectionModes`,
  `harnessAllowsProvider`), with the `TODO(harness-capabilities)` to feed it from `/inspect`.

## Source data for the new inspect `models` field

- **Pi (`pi_core`, `pi_agenta`)**: `{provider: supported_llm_models[provider]}` for each provider in
  `PI_VAULT_PROVIDERS`. All eight keys exist in `supported_llm_models` (verified: openai, anthropic,
  gemini, mistral, groq, minimax, together_ai, openrouter). Model ids are provider-prefixed
  (`openai/gpt-...`); the FE already handles that shape.
- **Claude (`claude`)**: `{"anthropic": CLAUDE_MODEL_ALIASES}` — a new small constant. The alias set
  per the harness facts: `default`, `sonnet`, `opus`, `haiku`, plus the `[1m]` long-context variants
  (`docs/design/agent-workflows/projects/provider-model-auth/harness-provider-matrix.md:84-88`).
- Pricing metadata (`model_metadata`, `assets.py:247`) can ride along per model as optional
  `x-ag-metadata`, or the FE can look it up from the shared catalog. Treat as nice-to-have.

## Open question to resolve in the plan

How the inspect/workflow-schema response surfaces `meta.harness_capabilities` to the
`AgentConfigControl` on the FE (which atom/selector carries the inspect `meta`). The control today
reads only the static map; the implementation must thread inspect `meta` to it. This is the main FE
plumbing unknown and is the first task of Phase B.
