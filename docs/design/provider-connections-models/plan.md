# Implementation plan

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

The target interface is the founder-provided design in [experience.md](experience.md). This plan
splits the work into three dependent pull requests that end at that design.

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
10. Define recommended model lists per provider in the versioned harness catalog. Apply them only
    when a connection has no saved `models` field.

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

This pull request builds the drawer, the connection card, and the Settings page from
[experience.md](experience.md). It still does not change agent execution or the Playground picker.

1. Rename the Settings tab from "LLMs" to "Model providers"
   (`web/oss/src/components/pages/settings/assets/navigation.ts`).
2. Build the Settings page as a table of connected providers with the columns Provider, Credential,
   Active models, and Connected. A row click opens the connection card. One primary "Add provider"
   button opens the catalog drawer. The empty state sits inside the table with the same button. A
   footnote explains runner-detected subscriptions.
3. Build one drawer component with two entry contexts. From Settings it shows the catalog only,
   with a footer note that subscriptions are configured in the deployment. The playground context
   (Connected section, subscriptions section, "Manage in Settings" footer) ships with pull
   request 3 but the component must support it now.
4. Render the catalog from the full standard provider list in
   `web/packages/agenta-shared/src/utils/llmProviders.ts`, in code order, with logos from
   `LLMIconMap`, searchable, with "OpenAI-compatible endpoint" as the last row. Never truncate the
   list. Connected providers still offer "Add" because several connections per provider are
   allowed.
5. Build the connection card as a pushed level inside the drawer. No modals, no toasts. Follow the
   card structure in experience.md: key with Test, optional name, active models after a valid key,
   collapsed harnesses with Pi as the API-key default, Cancel and Done footer.
6. Make Test one action that validates the credential and fetches models together, backed by two
   separate API statuses. Never use a paid generation request as the credential test. Never let a
   public model catalog produce a false key-valid message.
7. Show the error path inline: red text naming the provider and status code, an editable key field,
   a Retry button, Done disabled, and the reminder that nothing has been saved.
8. Pre-check recommended models on first fetch and tag them "recommended", never "default". Show
   the active count as "x of N", inline search, Select all, Clear, and a timestamped re-fetch line.
9. Support manual model IDs for every provider, including standard providers and providers with
   discovery.
10. Save an allowed harness subset. Disable technically incompatible harnesses using the global
    harness catalog.
11. Put "Remove key" in the Settings row actions, not on the card.
12. Reopen saved connections with their name, active models, and harness choices intact.

Primary areas:

- `web/packages/agenta-entities/src/secret/`
- `web/packages/agenta-entity-ui/src/secretProvider/`
- `web/oss/src/components/pages/settings/` navigation and the vault provider page
- Provider test and discovery API owned by the main API

Acceptance checks:

- The Settings table and connection card render from saved data and match experience.md.
- Refreshing the page preserves connection name, active models, and harness choices.
- Two connections for the same provider remain distinct.
- Settings clearly distinguishes fetched models from active models.
- A public model catalog never produces a false key-valid message.
- A provider without discovery keeps Agenta's existing catalog and permits manual model IDs.
- Refreshing models does not silently change the saved active list.
- No modal or toast appears anywhere in the flow.
- Subscription cards may be displayed as separate runtime items but are not edited or persisted by
  this flow until the open decisions in [status.md](status.md) are resolved.

### Pull request 3: make the Playground connection-first

This pull request changes selection and agent propagation, and ships the picker and playground
drawer context from [experience.md](experience.md).

1. Build picker rows from stored provider connections rather than provider families alone. Existing
   unnamed standard connections appear under their provider display name. Subscriptions appear as
   their own entries beside API-key connections.
2. Give each connection row a side flyout listing models flat, one row per model and harness pair,
   with the harness as a neutral tag. When the same model is reachable through several connections
   or harnesses, add the one-line cost hint from experience.md.
3. For each connection, show its saved models, or the recommended defaults when no list was saved.
4. Intersect the connection's allowed harnesses with Agenta's technical compatibility.
5. Add the picker search across all connections, the footer rows (effort, "Add provider"), the
   dashed first-run pill "Set up model providers", and the dismissible harness-tag explainer.
6. Open the drawer in its playground context: Connected section, catalog, subscriptions section,
   and the footer with the connected count and "Manage in Settings".
7. Save the exact connection slug, provider, model, and harness in the agent configuration.
8. Update runtime validation to reject a connection, model, and harness combination that is outside
   the effective set.
9. Keep a compatibility path for existing agents without a connection slug.

Primary files:

- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useModelHarness.tsx`
- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/connectionUtils.ts`
- `web/packages/agenta-entities/src/workflow/state/inspectMeta.ts`
- `sdks/python/agenta/sdk/agents/handler.py`
- `sdks/python/agenta/sdk/agents/platform/connections.py`
- Runner model configuration adapters where a saved model must be registered before selection

Acceptance checks:

- Picker rows represent connections, including two connections for one provider.
- The flyout shows one row per model and harness pair and the cost hint when a model is reachable
  twice.
- Selecting a row and model persists the exact connection slug.
- Only saved active models appear when a connection has an explicit model list.
- Harness filtering matches settings and server validation.
- Search returns models across all connections with the connection as a subtitle.
- Existing agents continue to resolve through the compatibility path.

### Later work: runtime registration and richer discovery

Some provider APIs return models that a selected harness cannot use without extra runtime
configuration. Pi can register custom models through its model configuration file. Claude Code and
Codex use their own accepted sets. Add runtime registration per harness only after the connection,
model, and harness contract is stable.

## Main challenges

1. Connection identity must stop depending on provider family.
2. Missing models use recommended defaults. An empty saved list means show no models.
3. Saved harness choices are user policy. The global harness catalog remains the technical limit.
4. Provider discovery results may include models unsuitable for the agent use case or selected
   harness.
5. The API must preserve optional fields during read and update before the settings interface uses
   them.
6. Existing agents may not name a connection. Compatibility must remain deterministic.
7. Model discovery and credential validation need separate statuses because some catalogs are
   public and OpenAI-compatible servers do not always implement `GET /models`. The card still
   exposes both through one Test action.
8. The design gates Done on a valid key, but some providers offer no free credential test. This
   needs a founder decision before pull request 2. See [status.md](status.md).
