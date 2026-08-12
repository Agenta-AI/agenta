# Implementation plan

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

## Recommended order

### Pull request 1: make both vault formats usable as connections

This pull request changes contracts and backend behavior. It does not change which models the
Playground shows.

1. Add optional `models` and `harnesses` fields to `StandardProviderDTO`.
2. Add optional `harnesses` to `CustomProviderDTO`.
3. Give newly created standard provider records a stable slug. When the name is empty, assign the
   provider display name to the first connection, then append `2`, `3`, and so on.
4. Preserve old records. Missing model and harness fields use current defaults.
5. Update the connection resolver so a slug can select either a standard or custom connection.
6. Keep provider-only selection compatible when one matching standard connection exists.
7. Return the saved fields through create, read, list, and update operations.
8. Regenerate the API client and update transforms so callers can round-trip both shapes without
   losing optional fields.
9. Do not use saved models or harnesses to filter the Playground yet.
10. Define default-active model lists in the versioned harness catalog. Apply them only when a
    connection has no saved `models` field.

Primary files:

- `api/oss/src/core/secrets/dtos.py`
- `api/oss/src/core/secrets/services.py`
- `api/oss/tests/pytest/unit/secrets/test_dtos.py`
- `api/oss/tests/legacy/vault_router/test_vault_secrets_apis.py`
- OpenAPI and generated client outputs
- `sdks/python/agenta/sdk/agents/platform/connections.py`
- `sdks/python/oss/tests/pytest/unit/agents/platform/test_connections_http.py`
- `web/packages/agenta-entities/src/secret/core/types.ts`
- `web/packages/agenta-entities/src/secret/core/transforms.ts`
- `web/packages/agenta-entities/src/secret/state/atoms.ts`

Acceptance checks:

- Existing standard and custom records still read and resolve.
- New standard and custom records round-trip models and harness choices.
- Two OpenAI keys can be saved and selected independently by slug.
- Unnamed OpenAI connections receive the display names `OpenAI`, `OpenAI 2`, and so on.
- Updating one connection does not overwrite the other.
- Existing agents that reference provider-only defaults continue to run when unambiguous.
- The current Playground model menu remains unchanged.

### Pull request 2: add the settings experience

This pull request lets users manage the stored connection fields. It still does not change agent
execution or the Playground picker.

1. Show standard and custom records in one Model providers drawer.
2. Let users add several connections for one provider.
3. Let users name a connection. Leaving the name empty shows the API-assigned provider name, such as
   `OpenAI` or `OpenAI 2`. Generate a stable slug independently from the name.
4. Test credentials and fetch available models where the provider supports discovery.
5. Return credential status separately from model-discovery status. Never use a paid generation
   request as the default credential test.
6. Let users save active models. Support manual model IDs for every provider, including standard
   providers and providers with discovery.
7. Let users save an allowed harness subset. Disable technically incompatible harnesses using the
   global harness catalog.
8. Reopen saved connections with their model and harness choices intact.

Primary areas:

- `web/packages/agenta-entities/src/secret/`
- `web/packages/agenta-entity-ui/src/secretProvider/`
- Settings page or drawer entry points that currently manage vault providers
- Provider test and discovery API owned by the main API

Acceptance checks:

- The screenshots' connected list and connection card can be rendered from saved data.
- Refreshing the page preserves connection name, active models, and harness choices.
- Two connections for the same provider remain distinct.
- Settings clearly distinguishes fetched models from active models.
- A public model catalog never produces a false `Key valid` message.
- A provider without discovery keeps Agenta's existing catalog and permits manual model IDs.
- Refreshing models does not silently change the saved active list.
- Subscription cards may be displayed as separate runtime items but are not edited or persisted by
  this flow.

### Pull request 3: make the Playground connection-first

This pull request changes selection and agent propagation.

1. Build picker rows from stored provider connections rather than provider families alone. Existing
   unnamed standard connections appear under their provider display name.
2. For each connection, show its saved models or provider defaults when no list was saved.
3. Intersect the connection's allowed harnesses with Agenta's technical compatibility.
4. Save the exact connection slug, provider, model, and harness in the agent configuration.
5. Update runtime validation to reject a connection, model, and harness combination that is outside
   the effective set.
6. Keep a compatibility path for existing agents without a connection slug.

Primary files:

- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useModelHarness.tsx`
- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/connectionUtils.ts`
- `web/packages/agenta-entities/src/workflow/state/inspectMeta.ts`
- `sdks/python/agenta/sdk/agents/handler.py`
- `sdks/python/agenta/sdk/agents/platform/connections.py`
- Runner model configuration adapters where a saved model must be registered before selection

Acceptance checks:

- Picker rows represent connections, including two connections for one provider.
- Selecting a row and model persists the exact connection slug.
- Only saved active models appear when a connection has an explicit model list.
- Harness filtering matches settings and server validation.
- Existing agents continue to resolve through the compatibility path.

### Later work: runtime registration and richer discovery

Some provider APIs return models that a selected harness cannot use without extra runtime
configuration. Pi can register custom models through its model configuration file. Claude Code and
Codex use their own accepted sets. Add runtime registration per harness only after the connection,
model, and harness contract is stable.

## Main challenges

1. Connection identity must stop depending on provider family.
2. Missing models use default-active models. An empty saved list means show no models.
3. Saved harness choices are user policy. The global harness catalog remains the technical limit.
4. Provider discovery results may include models unsuitable for the agent use case or selected
   harness.
5. The API must preserve optional fields during read and update before the settings interface uses
   them.
6. Existing agents may not name a connection. Compatibility must remain deterministic.
7. Model discovery and credential validation need separate statuses because some catalogs are
   public and OpenAI-compatible servers do not always implement `GET /models`.
