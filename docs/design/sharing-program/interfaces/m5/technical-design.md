# M5 `organization-credentials`: technical design

Status: implemented in the backend under option B (owner decision, 2026-10-26): an agent uses exactly the connection it picked, by scope and slug. Nothing is inherited or overridden automatically. The web UI is built separately from the approved design board.

Scope: backend first. OpenSpec `tasks.md` sections 1 (schema), 2 (core), 3 (access), 4 (routes, Fern included), 5 (gateway and SDK), the explicit-connection part of section 6, and the backend rows of section 7 (QA).

## 1. File-by-file plan

### 1.1 Data layer

| File | Change |
| --- | --- |
| `oss/databases/postgres/migrations/core_oss/versions/oss000000054_add_organization_credentials.py` (NEW) | Revision of interfaces 1.3. |
| `oss/src/dbs/postgres/secrets/dbas.py` | `availability = Column(String, nullable=False, server_default="all_projects")`. |
| `oss/src/dbs/postgres/secrets/dbes.py` | `SecretsDBE.__table_args__` gains the two checks and two partial indexes (metadata matches the revision); NEW `SecretProjectDBE`. |
| `oss/src/dbs/postgres/secrets/mappings.py` | `owner`, `availability`, `selected_project_ids` in `map_secrets_dbe_to_dto`. |
| `oss/src/dbs/postgres/secrets/dao.py` | Owner-based methods; `_owner_filter(owner)`; NEW `load_effective` (one statement), the organization operations (all `ORGANIZATION_SECRET_KINDS`-only, atomic), `list_organization_project_ids`; `DBAPIError` -> domain errors `from None`. Project writes keep today's statements. |

### 1.2 Core layer

| File | Change |
| --- | --- |
| `oss/src/core/secrets/enums.py` | `SecretOwnerKind` (moved, + `ORGANIZATION`), `SecretAvailability`, `ORGANIZATION_SECRET_KINDS`. |
| `oss/src/core/secrets/dtos.py` | `SecretOwner`; three response fields, the organization `write_only` validator, `hide_input_in_errors` on every value-holding model; `CachedEffectiveSecrets` (project rows and available organization rows). |
| `oss/src/core/secrets/types.py` | NEW exceptions (interfaces 2.3). |
| `oss/src/core/secrets/interfaces.py` | Owner-based `SecretsDAOInterface`; NEW `ProjectLimitsInterface`. |
| `oss/src/core/secrets/scopes.py` (NEW) | Pure functions: `organization_matches`, `available_organization_secrets`, `provider_candidates`, `is_llm_provider_family`. |
| `oss/src/core/secrets/limits.py` (NEW) | `NoProjectLimits`. |
| `oss/src/core/secrets/services.py` | Owner mapping; the one `effective_secrets` entry per project on today's `get_cache` path; scoped readers; organization management (default name with the owner); invalidation helpers; request memo use. |
| `oss/src/core/secrets/redaction.py` | No reveal and no preview for organization rows; `organization_connection_response`, `organization_secret_response`. |
| `ee/src/core/secrets/limits.py` (NEW) | `EntitlementProjectLimits(rbac)`. |
| `oss/src/core/access/organizations.py` (NEW) | `OrganizationAction`, `decide_organization`. |
| `oss/src/core/gateways/dtos.py` | `GatewayEndpointNamespace.ORGANIZATION`; `MIN_SCANNED_CREDENTIAL_LENGTH` public; NEW `secret_credential_values`. |
| `oss/src/core/gateways/policy/dtos.py` | Import `SecretOwnerKind`, `SecretOwner` from core secrets; `BoundSecretRef.owner_kind`. |
| `oss/src/core/gateways/policy/interfaces.py` | `NamedProviderConnection.owner_kind`; NEW `organization_connection` (default None). |
| `oss/src/core/gateways/policy/resolution.py` | `plane` constructor argument; every plane reads project rows; the LLM plane answers `organization_connection`. |
| `oss/src/core/gateways/llms/providers/passthrough/adapter.py` | Scans the organization secret's own values too. |
| `oss/src/core/gateways/llms/types.py` | `LLM_GATEWAY_SERVED_DEPLOYMENT_KINDS`; NEW `LLMNamedConnectionNotFoundError`, `LLMOrganizationConnectionSlugRequiredError`. |
| `oss/src/core/gateways/llms/service.py` | `_ResolvedLlmTarget.secret_owner_kind` and `resolved_secret`; `connection_scope` on `resolve_agent_connection`; `_organization_target`; `_resolve_slug_target` (one pass over project shapes). |
| `oss/src/core/workflows/service.py` | `_reject_unrunnable_agent_connection` at every agent commit. |
| `oss/src/core/agent_templates/compiler.py` | The explicit project default connection. |

### 1.3 Router layer and wiring

| File | Change |
| --- | --- |
| `oss/src/apis/fastapi/organization_secrets/{__init__,router,models}.py` (NEW) | `OrganizationSecretsRouter`, request and response models, `handle_organization_secret_exceptions`. |
| `oss/src/apis/fastapi/vault/router.py` | `include_organization`. |
| `oss/src/apis/fastapi/gateways/llms/{models,router,proxy}.py`, `gateways/exceptions.py` | `connection_scope`; the `organization` relay routes; the two new error mappings. |
| `oss/src/apis/fastapi/providers/{models,router}.py` | `secret_scope` on the probe. |
| `entrypoints/routers.py` | `VaultService(..., project_limits=...)`; two resolvers (`plane=LLM` for the LLM gateway, `plane=MCP` for every other user); mount `OrganizationSecretsRouter` with `tags=["Organization Secrets"]`. |
| `utils/env.py` | NEW `AGENTA_RUNNER_REQUIRE_NAMED_SELF_MANAGED_CONNECTION` (default false; true on the cloud). |
| `web/packages/agenta-api-client/src/generated/**` | Fern regeneration. |

### 1.4 SDK and web

- SDK (`sdks/python/agenta/sdk/agents/**`): `Connection.scope`, the `organization` namespace, `connection_scope` on resolve, `OrganizationConnectionUnavailableError` on every plaintext path, `WireConnection.scope` (interfaces 3.9).
- Web (`web/packages/agenta-entities`, `agenta-entity-ui`): every save path writes the connection explicitly (`explicitAgentConnection`, `withExplicitAgentConnection`, `composeModelValue`).
- Runner: no change (it holds no provider key in gateway mode, and routing comes from the resolved base URL).

## 2. Key flows

### 2.1 An agent with no connection (`POST /gateways/llms/standard/openai/v1/chat/completions`)

`resolve(ProviderKeyRef("openai"))` reads the project's entry (warm: one `GET`, as today) and picks among the project's own rows with today's tie rule. An organization row is never a candidate, so agents saved before M5 run exactly as before.

### 2.2 An agent that names an organization connection

1. The SDK sends `POST /gateways/llms/resolve` with `connection_slug`, `connection_namespace = organization` and `connection_scope = organization`.
2. `_organization_target(scope, slug)`: `resolver.organization_connection` (one entry read) -> the row available to the project -> a standard-family target (`provider_key`) or a target built from the row (`custom_provider`), pinned to the row, carrying it. A miss: `connection_not_found` (404, scope and slug).
3. The harness calls `/gateways/llms/organization/{slug}/v1/...`. The relay resolves the same target (the memo makes the entry read free in the same request; a new request reads the entry once) and uses the carried row; audit has `secret_owner_kind=organization`.

### 2.3 An agent that names a project slug

`_resolve_slug_target(scope, slug)`: (1) the project endpoint row (one statement); (2) builtin; (3) a provider family (no read); (4) a project `provider_key` row with the slug (one entry read); (5) else `LLMEndpointNotFoundError(custom/<slug>)`, then the retired starter-credits fallback. It never reaches an organization row.

### 2.4 Project member lists connections (`GET /secrets/?include_organization=true`)

`VIEW_SECRET` check (unchanged). No `secret-resolve` grant -> `list_project_and_organization_secrets` (the same one entry read as `GET /secrets/`) -> project rows through `project_secret_response`, then each organization row through `organization_connection_response` (no values, no preview, no other project ids).

### 2.5 Owner adds a company key (`POST /organization-secrets/`)

`decide_organization` (one statement) -> kind, family, value and served-deployment checks (in memory) -> the default name "OpenAI (Organization)" when none is given -> ONE transaction: insert (unique organization slug index), availability (`all_projects` by default) and `secret_projects` with the organization check; any refusal rolls everything back -> after the commit: `list_organization_project_ids`, exact `DEL` of each project's entry, `clear_request_memo()`, the audit event -> response without value.

### 2.6 EE admin limits a key (`PUT /organization-secrets/{id}/projects`)

`decide_organization` -> `selected_projects`: `project_limits.allows_selected_projects` (EE: RBAC entitlement, 30 s memo; OSS: 403) -> ONE transaction: lock the organization row, set availability, replace `secret_projects` (organization-checked) -> after the commit, invalidate. An agent of a removed project that names the connection fails with `connection_not_found`; a pinned id fails with not-found.

### 2.7 A member tests an organization connection (`POST /providers/probe` with `secret_scope = organization`)

`VIEW_SECRET` check -> the organization row by id from the project's entry (never a project row) -> the probe with the stored value -> the answer and any error text are scanned for the stored values (an echo answers 502 without the result). Changed fields need `decide_organization`.

### 2.8 An agent that names an organization subscription login

1. The agent saves `{"mode": "self_managed", "scope": "organization", "namespace": "organization", "slug": "chatgpt"}`.
2. The SDK reads `GET /secrets/organization-subscriptions/chatgpt` with the run credential (`secret-resolve` grant). The API answers the row with its login only when it is an organization `subscription_provider` available to the run's project (one entry read). The SDK refuses a Claude login (`organization_subscription_not_supported`).
3. The SDK sends the login as `organizationSubscription`, with the fence marker in `subscription`. A runner older than M5 ignores `organizationSubscription` and refuses the fence as an unusable login, so it never runs the login and never uses an operator login. An M5 runner accepts it only on the `inprocess` engine for Pi with a ChatGPT login, and keeps it in its `SubscriptionCredentialStore`; any other engine is refused when the plan is built (`ORGANIZATION_SUBSCRIPTION_ENGINE_MESSAGE`).
4. Upkeep: refreshes and failures go to `/secrets/{id}/subscription-login[/failure]?scope=organization`, which writes the organization row after the availability check. A device login started from `/organization-secrets/{id}/login-attempts` carries `organizationId`, and its outcome names `organization_id`.

## 3. Request counts (every cache mode)

R = Redis round trips, S = Postgres statements, for the secrets part of each request. "Before" is `origin/main`. M5 keeps exactly today's cache mechanics for project vault reads: one `get_cache` on one key per project, so an entry read (U) costs the same before and after in every mode (warm 1 R; cold leader 4 R + 1 S; cold follower 3 R; cache disabled 1 S; Redis failing 2 failed R + 1 S; a second read in the same request 0).

| # | Request | Before | After |
| --- | --- | --- | --- |
| A | Relay, standard by provider family (the common agent call) | 1 U | 1 U |
| B | Relay, standard by a project slug | 1 U + 1 S (id read) | 1 U + 1 S |
| C | Relay, organization key named by scope (new path) | n/a | 1 U |
| D | Relay, custom project endpoint row | 2 S | 2 S |
| E | Relay, organization custom provider named by scope (new path) | n/a | 1 U |
| E2 | Relay, unknown custom slug | 1 S, not found | 1 S, not found |
| F | Resolve, provider only | 0 | 0 |
| G | Resolve, project custom slug | 2 S | 1 S |
| H | Resolve, project standard slug (not a family name) | 1 S + 2 U | 1 S + 1 U |
| H2 | Resolve, provider-family slug (`openai`), with or without a project key | 1 S | 1 S |
| I | Resolve, organization key named by scope (new path) | n/a | 1 U |
| I2 | Resolve, organization custom provider named by scope (new path) | n/a | 1 U |
| I3 | Resolve, unknown project slug | 2 S + 2 U, not found | 1 S + 1 U, not found |
| J | `GET /secrets/` (vault fallback, `VaultMiddleware`, `/w`, `/m`) | 1 U | 1 U |
| K | `GET /secrets/?include_organization=true` (new path) | n/a | 1 U |
| L | `GET /gateways/llms/endpoints` | 1 U + 1 S | 1 U + 1 S |
| M1 to M3 | MCP endpoint list, relay standard, relay bound secret | today | the same (MCP plane, project rows) |
| P1 to P3 | Project secret create (derived slug, caller slug), user update | today's statements | the same statements, the same isolation |
| O | Organization management route (new path) | n/a | 1 S decision + the route's statements; writes add 1 S (the project list) + exact `DEL`s after the commit |

Every existing request is equal or lower in every cache mode. M5 adds no HTTP call between services. The count tests pin every row in all five modes on both editions.

## 4. Cache design

- One entry per project (`effective_secrets`), holding the project row's organization, the project's rows and the organization rows AVAILABLE to that project. Filled by one statement on today's `get_cache` lock path. An organization with no credentials stores an empty list in the same entry.
- Identity: the key holds the full project uuid (`_pack` truncates the `project_id` slot to 12 characters); the value holds `project_id`, and a read with another id is a miss. The `project_id` slot stays the project id, so today's project-wide pattern invalidation clears it, also from old pods.
- Invalidation: project writes as today; organization writes and availability changes delete each project entry of the organization (exact keys, batched) after the commit. A new project needs no invalidation. A deleted project's entry expires by TTL.
- Request memo: the entry lives for the rest of the request in M2's request memo; vault invalidation clears the memo.
- Serializer and logs: every nullable field has an explicit `= None`; the model round-trips through `_serialize` / `_deserialize`; `hide_input_in_errors=True` keeps values out of the `[cache]` warning.

## 5. Security properties and their tests

| # | Property | Enforced by | Tests |
| --- | --- | --- | --- |
| P1 | No HTTP response carries an organization credential value or a preview, for any caller, and no gateway relay echoes one back. | `write_only` validator for organization rows; `project_secret_response` refuses to reveal them; organization projections drop every credential field; the passthrough echo scan covers every organization value in the spellings JSON encoders produce. | `test_no_route_returns_an_organization_value`; echo refusals (header, body, split stream, extras, JSON-escaped forms); short and unscannable values refused; redaction unit tests. |
| P2 | Organization values never reach a sandbox or a plaintext path. | `GET /secrets/` never includes organization rows under the grant; the SDK refuses an organization connection on every plaintext path; the sandbox holds only a gateway-audience credential. | `test_the_run_credential_never_receives_an_organization_row`; `test_an_organization_connection_never_falls_back_to_the_vault`; `test_an_organization_connection_never_resolves_from_plaintext_rows`. |
| P3 | One organization access decision; only a browser-session human owner or admin manages; no project shortcut applies. | `decide_organization`, called first by every organization route and by a probe with changed fields. | Unit rule table; acceptance: EE hobby `editor` 403, owner API key 403, owner run credential 403, owner and admin 200. |
| P4 | Tenant isolation. | Entry keyed by the full project id and validated; the project row's organization pins organization rows; organization DAO statements filter by organization; `secret_projects` inserts only same-organization projects. | Mismatched organization gets no organization row; equal-suffix projects never share an entry; foreign project limit refused; cross-organization ids 404. |
| P5 | Project routes never read, change or delete an organization row. | Project-scoped DAO filters (unchanged). | `DELETE` with an organization id: 204, row stays; `PUT`: 404; `GET /secrets/{org slug}`: 404. |
| P6 | A reference never substitutes another row. | Scope on every named reference; owner-aware `BoundSecretRef`; organization rows answered only from the available list. | One slug in both scopes answers each scope's own row; an organization name miss is `connection_not_found`, never the project default; a pinned organization connection deleted or limited away: not found. |
| P7 | An agent with no connection never uses an organization row. | The provider scan reads project rows only. | `test_the_provider_scan_never_reads_an_organization_row`; acceptance: the unnamed call fails where only the organization has a key. |
| P8 | No secret value or token in logs or audit events. | Ids and kinds in logs; `hide_input_in_errors`; DAO errors raised `from None`; audit adds `secret_owner_kind` only. | Sentinel tests over every captured log record; stack log grep in QA. |
| P9 | Cache safety: no cached decision; bounded staleness. | Section 4. | Invalidation tests with the recording engine and real Redis; an old-pod write after a warmed new entry. |
| P10 | EE SSO secrets are never shared, listed in a project, or addressed by the organization routes. | `ORGANIZATION_SECRET_KINDS` in `load_effective` (SQL) and in every organization DAO operation. | An SSO id against all six routes: 404, row unchanged; SSO never in a project list. |
| P11 | The MCP plane never resolves an organization row. | The resolver's `plane` argument. | An organization `mock` key is absent from the MCP list and MCP resolution. |
| P12 | A deployment the gateway does not serve is refused at create, at update and at resolve. | `LLM_GATEWAY_SERVED_DEPLOYMENT_KINDS`, pinned against the passthrough auth table. | Bedrock and SageMaker create and update 422; a stored row answers not served. |
| P13 | OSS refuses the project limit; EE needs the RBAC entitlement. | `ProjectLimitsInterface`. | OSS 403; EE hobby 403; EE business 200. |
| P14 | An older runtime fails closed on an organization connection. | Namespace `organization` on every saved organization connection; the commit check. | `test_an_organization_connection_needs_scope_slug_and_its_namespace`; `test_an_incomplete_organization_connection_is_refused`. |
| P15 | An organization subscription login never reaches a sandbox, and only the run credential receives it. | The release route needs the `secret-resolve` grant and the availability check; the separate wire field `organizationSubscription` with the fence in `subscription`; the runner's `inprocess`-only check at plan build; Claude refused in the SDK. | `test_only_the_runs_credential_reads_an_organization_subscription_login`; `test_the_release_route_refuses_a_project_the_login_is_not_available_to`; `organization-subscription-run-plan.test.ts` (including the older-runner fence); `test_an_organization_claude_login_is_refused`. |

## 6. Migration

- Steps: interfaces 1.3. The first part (column, check, table, delete, guards, `NOT VALID` constraint) commits as one transaction under `lock_timeout = 5s`; the indexes and the two `VALIDATE CONSTRAINT` statements run in an autocommit block.
- Interrupted run: the first phase is committed and `alembic_version` is not; the rerun repeats the first phase as no-ops, drops an INVALID index `CONCURRENTLY` and builds it again, then validates.
- Rollback: the app rolls back; the schema stays. Old code works on the new schema.

## 7. Audit and observability

- Gateway audit (`gateways.called`): NEW attribute `secret_owner_kind` (`project` or `organization`) when a secret was resolved.
- Organization credential writes publish NEW `EventType.ORGANIZATION_SECRETS_CHANGED` (`organization_secrets.changed`) with `organization_id`, `secret_id`, `kind`, `action`, `availability`, project count, and the acting user id. No value, no name.
- Logs: `[access] organization decision denied` (info); `[secrets] organization mismatch` (warning); `[secrets] cache invalidation failed` (warning); `[secrets] include_organization ignored for a resolve grant` (info). Ids and kinds only.

## 8. Test plan

### 8.1 Unit

- `secrets/test_scopes.py`: two scopes, mismatched organization, SSO dropped, the tie rule.
- `secrets/test_secret_owner_dto.py`, `test_effective_reads.py`, `test_organization_secrets_service.py`, `test_redaction_organization.py`, `test_no_values_in_logs.py`, `test_services.py` (the default organization name).
- `gateways/test_gateways_resolution_scopes.py`: the provider scan and project slugs read project rows only; `organization_connection` by plane and availability.
- `gateways/test_gateways_llm_organization_targets.py`: organization targets (key and custom provider), typed misses, incomplete references, unserved kinds, one entry read per request, and `_resolve_slug_target` against the old two-step code for every project shape.
- `workflows/test_commit_connection_validation.py`, `agent_templates/test_compiler.py`, `providers/test_provider_probe.py` (organization probes).
- SDK: `agents/platform/test_connections_http.py`, `test_gateway_plane_fallbacks.py`.
- Web: `connectionUtils.test.ts`, `connectionPicker.test.ts`, `agent-creation-prefs.test.ts`.

### 8.2 Integration (real Postgres)

- `test_organization_credentials_migration.py`, `test_secrets_dao_owner.py`, `test_secrets_scopes.py` (two slug spaces; project writes keep today's statements and isolation), `test_organization_secrets_query_counts_postgres.py` (every row of section 3, five cache modes, both editions).

### 8.3 Acceptance (real stack, `acceptance/organization_secrets/`)

`test_organization_secrets_authorization`, `test_organization_secrets_scopes` (lists, project routes, named organization connections through the mock LLM, one slug in both scopes, custom providers, echo refusals, pinned references, the EE limit), `test_gateway_off_plaintext_paths`, `test_sso_unaffected`.

## 9. QA matrix

| Boundary | Check | Where |
| --- | --- | --- |
| Gateway run (OSS, EE) | An agent that names an organization connection runs on it; an agent with no connection, or a project slug, never uses it; one slug in both scopes answers each scope's own row (audit `secret_owner_kind`). | local stack, API and services |
| Plaintext paths | The run's `GET /secrets/` has no organization row; the sandbox env has no organization key; a named organization connection without the gateway fails. A completion app and an AI evaluator run on project keys only. | local stack |
| Redaction | Every project role and the organization owner: no response carries an organization value or preview. | local stack, both editions |
| Organization authorization | EE hobby org `editor` 403; owner API key 403; owner run credential 403; owner and admin 200. | local stack |
| Saved agents | Every save path and the template default write an explicit connection; an incomplete organization connection and, on the cloud, `self_managed` without a slug are refused at save. | local stack |
| EE limit | A limited connection is invisible to other projects (list and resolve); deleting the only selected project leaves it with no project; OSS gets 403. | local stack |
| Mixed versions | The migration runs while the pre-M5 API image serves; pre-M5 rows behave as before; an old services image refuses an organization connection. | local EE stack |

## 10. Docs and config

- OpenSpec `organization-credentials` (validated `--strict`), CONTRACT section 8, `api/AGENTS.md`, this folder.
- Config: `AGENTA_RUNNER_REQUIRE_NAMED_SELF_MANAGED_CONNECTION` (set to `true` on the cloud deployments).

## 11. Risks

- An agent must name an organization connection to use it. A team that wants every agent on the company key edits each agent or picks it when the agent is created.
- Prompts, completion and chat apps, and AI evaluators never use organization connections (owner decision 3).
- Old pods during the rollout do not serve organization connections (a short `connection_not_found` window).
- Renaming an organization connection's slug breaks the agents that name it (typed `connection_not_found`; the "needs configuration" state is designed separately).
- Organization writes in a large organization delete one cache key per project (batched, after the commit; admin path only).

## 12. Existing code findings, not widened into M5

- A. `utils/caching.py::_pack` keeps only the last 12 characters of `project_id` and `user_id` for every namespace. Two projects (or users) with the same suffix share today's entries. M5's own entry is safe (full id in the key, identity check). A general fix is a separate change.
- B. The transactions engine does not set `hide_parameters`, and `intercept_exceptions` logs `format_exc()`. M5 wraps every `SecretsDAO` write and raises domain errors `from None`; the general fix for other tables is a separate change.
