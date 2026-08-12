# Current provider connection behavior

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

## What users have today

Agenta stores standard provider keys and custom providers in the same project vault. They are two
record types in the same `secrets` table and use the same `/secrets/` API.

A standard `provider_key` stores a provider family and key. It does not store models, endpoint
settings, or harness choices. A `custom_provider` stores a name, provider or deployment kind,
endpoint settings, credentials, and models.

The agent Playground combines two sources:

1. A global harness catalog supplies built-in model lists per provider.
2. Custom-provider records supply their own saved model lists.

The global catalog is served by `GET /workflows/catalog/harnesses/`. It also states which provider
families and deployment kinds each harness supports.

## Current code constraints

### Multiple standard keys are not usable as named connections

The database permits multiple `provider_key` rows for one provider. The runtime connection resolver
currently identifies each standard key by provider family rather than its secret slug or name.
Two OpenAI keys therefore make an unnamed OpenAI selection ambiguous. A named model connection
cannot select one of them because the resolver assigns both the same logical slug, `openai`.

The frontend also finds an existing standard secret by environment-variable name and updates it.
This implements one standard key per provider in the current settings behavior.

### The two record types have different shapes

`StandardProviderDTO` contains only `kind` and `provider.key`. `CustomProviderDTO` contains provider
settings, `models`, `provider_slug`, and generated `model_keys`.

The encrypted `data` column holds serialized JSON text. We can add optional fields without changing
database columns or converting old records.

### Harness compatibility has two owners

Agenta's global harness catalog owns technical compatibility. It declares which provider families
and deployment kinds each harness can use. Server-side checks enforce that table.

A future per-connection harness field should express a user's narrower choice. It must not make a
technically unsupported provider and harness pair valid.

### Subscriptions are separate runtime state

The subscription-status design asks the runner to inspect mounted login files. A subscription may
appear beside stored provider connections in the frontend, but it is not a vault secret and should
not be introduced into the provider-connection persistence work.

### The prompt playground and LLM-as-a-judge resolve by provider family

The prompt playground (completion and chat) does not use the agent connection resolver. Its model
list comes from `supported_llm_models` in `sdks/python/agenta/sdk/utils/assets.py`, served through
the `model` catalog type in `sdks/python/agenta/sdk/utils/types.py`. At run time,
`SecretsManager.get_provider_settings_from_workflow` in
`sdks/python/agenta/sdk/managers/secrets.py` maps the chosen model string back to a provider
family through `model_to_provider_mapping` and returns the first matching `provider_key` secret's
key. Custom-provider records are matched by scanning their generated `model_keys`.

LLM-as-a-judge (`auto_ai_critique_v0` in `sdks/python/agenta/sdk/engines/running/handlers.py`)
uses exactly the same `SecretsManager` call and the same `model` catalog type, so the judge
dropdown and the prompt dropdown show the same grouped list, and both paths break the same way
with two keys for one provider: the family mapping cannot tell them apart.

Two further constraints matter for planning:

- The resolver logic is duplicated across the RoutingContext and RunningContext paths inside
  `secrets.py`, and a third provider_key-only path exists in `llm_v0`. Any slug-aware change must
  land in each.
- The prompt-side catalog is stale relative to the agent catalog. It has no `claude-fable-5`,
  no `claude-sonnet-5`, and an old OpenRouter list, while the agent catalog under
  `sdks/python/agenta/sdk/agents/data/` is current. The two catalogs have no shared source today.

### Structured-credential providers already exist as custom kinds

`CustomProviderKind` already includes `azure`, `bedrock`, `sagemaker`, and `vertex_ai`, and the
frontend field catalog `web/packages/agenta-entities/src/secret/core/providerFields.ts` already
declares their per-kind fields and auth rules. `LLMIconMap` in `@agenta/ui` already carries icons
for AWS Bedrock, Azure OpenAI, and Google Vertex AI. Presenting these providers in the main
catalog is a presentation change over existing storage, not a new record type. Note that the
credential extras vocabulary is declared three times (frontend transforms, prompt-path resolver,
agent-path env alias map) and one review must keep them consistent.

## Relevant files

- `api/oss/src/core/secrets/dtos.py`: vault record validation and response enrichment.
- `api/oss/src/core/secrets/enums.py`: secret record kinds.
- `api/oss/src/dbs/postgres/secrets/`: encrypted storage and DTO mapping.
- `sdks/python/agenta/sdk/agents/platform/connections.py`: vault records to runtime connections.
- `sdks/python/agenta/sdk/agents/capabilities.py`: global harness and model compatibility.
- `web/packages/agenta-entities/src/secret/`: vault API, transforms, and mutations.
- `web/packages/agenta-entity-ui/src/secretProvider/CustomProviderForm.tsx`: current custom-provider form.
- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useModelHarness.tsx`:
  current Playground model and connection composition.
- `sdks/python/agenta/sdk/utils/assets.py`: prompt-side model catalog (`supported_llm_models`).
- `sdks/python/agenta/sdk/managers/secrets.py`: prompt and judge credential resolution.
- `sdks/python/agenta/sdk/engines/running/handlers.py`: `completion_v0`, `auto_ai_critique_v0`.
- `web/packages/agenta-entities/src/secret/core/providerFields.ts`: per-kind credential fields.
- `web/oss/src/hooks/useLLMProviderConfig.tsx`: vault groups in the prompt model picker.
