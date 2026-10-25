# Research appendix: organization-credentials (M5)

Code facts that the M5 design relies on. Paths are relative to the repository root. Read on main at `42ffe80bfe`. Line numbers are hints, not contracts.

## Storage today

- `secrets.project_id` and `secrets.organization_id` are both nullable (`api/oss/src/dbs/postgres/secrets/dbas.py`), each with a cascading foreign key (`dbes.py`). `SecretsDAO._validate_scope` requires exactly one of them on every call (`api/oss/src/dbs/postgres/secrets/dao.py`). The database has no matching check constraint.
- Slug uniqueness is per project only: `uq_secrets_project_id_slug` on `(project_id, slug) WHERE slug IS NOT NULL`. Organization rows have `project_id IS NULL`, so two organization rows can hold the same slug today.
- EE SSO providers store their client secret as an organization-owned `sso_provider` row with no slug and `write_only=True`, read by id (`api/ee/src/core/organizations/service.py`).
- The EE lifecycle migration set an owner column to NULL when the parent was missing (`api/ee/databases/postgres/migrations/core/versions/5a6b7c8d9e0f_lifecycle_and_fk_cleanup.py`). Rows with both columns NULL can exist. No reader can resolve them.
- The `secrets` table is shared schema. A new revision belongs in `core_oss` only; EE runs that chain (`api/AGENTS.md`).

## Readers today

- `VaultService.list_secrets(project_id)` caches per project (`api/oss/src/core/secrets/services.py`). `GET /secrets/` lists the caller's project; `GET /secrets/{id_or_slug}` reads one row in the project (`api/oss/src/apis/fastapi/vault/router.py`).
- `_for_caller` reveals write-only values only to a request with the `secret-resolve` grant (`vault/router.py`; `api/oss/src/core/secrets/redaction.py`, `project_secret_response`). `write_only` lives in the encrypted data; `force_write_only_on_unreadable_kinds` forces it for some kinds (`api/oss/src/core/secrets/dtos.py`, `enums.py` `ALWAYS_WRITE_ONLY_KINDS`).
- The grant: `sign_secret_token` adds `secret-resolve` only for a revision URL under `AGENTA_SERVICES_URL` (`api/oss/src/core/workflows/service.py`, `_service_grants`), and the access router hands it only to the platform runtime or to a caller that already holds it (`api/oss/src/apis/fastapi/access/router.py`, `_run_credential_grants`).
- LLM gateway: `SecretsResolver` reads `list_secrets(project_id=scope.project_id)` for provider keys and named connections, and `get_secret_by_id(project_id=...)` for a `BoundSecretRef` (`api/oss/src/core/gateways/policy/resolution.py`). Results are labelled `SecretOwnerKind.PROJECT`. `SecretOwnerKind` has `project` and `user` (`api/oss/src/core/gateways/policy/dtos.py`). `BoundSecretRef(secret_id)` is the existing in-process id reference.
- Custom providers: a write to a `custom_provider` registers an LLM endpoint row in the project (`services.py`; `api/oss/src/core/gateways/llms/registrar.py`); registration is skipped when `project_id` is None. `map_custom_provider_secret_to_endpoint` in the registrar is a pure function. The gateway resolves a custom slug from the endpoint row (`api/oss/src/core/gateways/llms/service.py`, `_namespace_of_slug`, `_resolve_target`).
- `check_secret_is_owned_by_project` refuses an endpoint row whose `secret_id` is not a row of the project (`api/oss/src/dbs/postgres/gateways/tenancy.py`).
- The gateway does not serve Bedrock: `_resolve_target` raises `LLMGatewayConnectionNotServedError` for `LLMDeploymentKind.BEDROCK` (`api/oss/src/core/gateways/llms/service.py`).

## Plaintext paths (where a value leaves the API)

1. SDK agent resolution, vault fallback. `VaultConnectionResolver.resolve` posts to `/gateways/llms/resolve`. When the API answers `llm_gateway_disabled` (gateway switched off, or a connection the gateway does not serve, such as Bedrock) or an old API has no such route, `_resolve_from_vault` reads `GET /secrets/` with the run credential and `_resolve_from_secrets` returns `credential_mode="env"`: the provider key goes into the sandbox environment (`sdks/python/agenta/sdk/agents/platform/connections.py`). An agent can print it.
2. SDK vault middleware. For non-agent workflows (completion, chat, evaluators), `VaultMiddleware` loads the whole project vault from `GET /secrets/` into the service process (`sdks/python/agenta/sdk/middlewares/running/vault.py`). Custom code evaluators run through `execute_code_safely` with a local or Daytona runner (`sdks/python/agenta/sdk/engines/running/sandbox.py`), so user code can share that process. `_split_write_only_redacted` already drops redacted write-only entries.
3. Subscription login upkeep routes return the stored login in plaintext to the platform runtime (`vault/router.py`, `_require_platform_runtime`). Not relevant: subscription kinds are not inheritable.

Gateway mode keeps the value in the API: `VaultConnectionResolver` sends a gateway-audience credential to the sandbox, not the provider key. In gateway mode the API selects the connection; the SDK `_choose_default` runs only on the vault fallback and on the static test resolver.

## Authorization today

- Project RBAC (`api/oss/src/core/access/permissions/service.py`): EE without the `Flag.RBAC` entitlement allows everything (the "historic bypass"), then the organization owner is allowed, then project-owner rows. This is project-scoped.
- `check_user_org_access(kwargs, organization_id, check_owner)` checks owner by `organizations.owner_id` or membership by id list (same file).
- Role slugs are the same in all scopes. In the organization-scope catalog, `viewer` has no permissions (`api/oss/src/core/access/permissions/controls.py`).

## Composio and MCP

- The Composio adapter sends `user_id = project_id` (`api/oss/src/core/gateways/mcps/providers/composio/adapter.py`). An organization connection needs an organization entity. Out of scope.
- An MCP endpoint row binds a project secret, and its OAuth grant is a project row. Out of scope.
