# Research appendix: personal-credentials-bindings (M7)

Code evidence checked on main at `42ffe80bfe` (worktree `pr-7663-specs-design-c53b35`), re-verified 2026-10-22. Paths are relative to the repository root. Line numbers are approximate pointers, not contracts.

## Credential storage

- `secrets` (`api/oss/src/dbs/postgres/secrets/dbes.py`, `dbas.py`): `project_id` and `organization_id` are both nullable, each with a cascading FK. Only index: `uq_secrets_project_id_slug` on `(project_id, slug) WHERE slug IS NOT NULL`. No `user_id` column today.
- `SecretKind` (`api/oss/src/core/secrets/enums.py`): `provider_key`, `custom_provider`, `sso_provider`, `webhook_provider`, `custom_secret`, `channel_secret`, `subscription_provider`, `oauth_provider`, `oauth_grant`. M7 user rows use `provider_key`, `subscription_provider`, `oauth_grant`.
- `gateway_connections` (`api/oss/src/dbs/postgres/gateway/connections/dbes.py`): primary key `(project_id, id)`, unique `uq_gateway_connections_project_provider_integration_slug`, FK to `projects` with cascade.
- `trigger_subscriptions` (`api/oss/src/dbs/postgres/triggers/dbes.py`): composite FK `(project_id, connection_id)` to `gateway_connections (project_id, id)`. M7 keeps a unique `(project_id, id)` for it.
- MCP endpoint grant: `mcps_endpoints.secret_id` is one nullable UUID (`api/oss/src/dbs/postgres/gateways/mcps/dbas.py`). `grant_slug(endpoint_id)` in `api/oss/src/core/gateways/mcps/oauth/storage.py` derives the grant slug. Attempts store project and user (`dbas.py`, `mcps_oauth_attempts`).

## Composio identity

- `api/oss/src/core/gateway/connections/service.py`: initiate and refresh send `user_id=str(project_id)` to Composio (about lines 174 and 339).
- `api/oss/src/core/tools/service.py`: tool runs read `connection.data.get("project_id")` as the Composio user (about line 888); discovery sends `user_id=str(project_id)` (about line 983).
- `api/oss/src/core/gateways/mcps/providers/composio/adapter.py`: the tool-router session reads `data["project_id"]` as `user_id` (about lines 168-177).
- The legacy `/tools/call` route in `api/oss/src/apis/fastapi/tools/router.py` does the same. The OAuth callback reads `project_id` from the signed state (`api/oss/src/core/gateway/connections/utils.py`).

## Secret modes

- `SecretMode` in `api/oss/src/core/gateways/policy/dtos.py`: `USER_OPTIONAL` (fallback), `USER_REQUIRED`, `PROJECT_ONLY`. The same file has a second `SecretOwner(kind: project | user, user_id)`, which M7 removes in favor of the M5 `SecretOwner(kind, id)`.
- `api/oss/src/core/gateways/policy/resolution.py`: every mode reads the project secret.
- All callers pass `PROJECT_ONLY`: `api/oss/src/core/gateways/llms/service.py` (one site) and `api/oss/src/core/gateways/mcps/service.py` (seven sites).

## Subscription logins

- `VaultService._name_and_slug_subscription_provider` in `api/oss/src/core/secrets/services.py`: refuses a second login for a provider in the project and sets the slug from the provider.

## Agent connection references (SDK)

- `Connection` (`sdks/python/agenta/sdk/agents/connections/models.py`): `mode: agenta | self_managed`, `slug`, `namespace`. No `model_config`, so unknown fields are ignored by old SDKs. `self_managed` without a slug means the runner operator's login.
- `GatewayConnectionRef` (`sdks/python/agenta/sdk/agents/tools/models.py`): `extra="forbid"`, `provider="composio"`, `integration`, `slug` (required, min length 1).
- `MCPGatewayConnection` (`sdks/python/agenta/sdk/agents/mcp/models.py`): `extra="forbid"`, `namespace`, `provider` or `slug`.
- Consequence: an old SDK rejects a revision that adds fields to the tool or MCP reference, and silently ignores new fields on the model reference. The rollout gate in design.md covers both.

## Run credential

- `WorkflowsService._prepare_invoke` (`api/oss/src/core/workflows/service.py`, about line 3184) signs the run credential. `inspect_workflow` (about line 3467) mints separately; M2 routes it through the trusted authority.
- `api/oss/src/apis/fastapi/gateways/credentials_router.py`: `issue_gateway_credentials` copies `gateway_tools` into the narrowed gateway credential. M7 copies `gateway_bindings` the same way.

## Other seams

- `OrganizationFlags` (`api/oss/src/models/shared_models.py`): only `is_demo` today.
- Channel agent bindings: `ChannelsService.create_agent` and `edit_agent` in `api/oss/src/core/channels/service.py` do not check the agent's connections.
- M3 sharing writes lock the session row with `SELECT ... FOR UPDATE` (M3 design). M7's guard uses the same row lock.
- M3 D2: an item with a human owner is private by default, so a schedule session with a human executing principal is private and can use personal credentials.
