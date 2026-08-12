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
