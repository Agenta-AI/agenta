# M5 `organization-credentials`: technical design

Status: implemented in the backend. The web part is planned after the design review.

Scope: backend first. OpenSpec `tasks.md` sections 1 (schema), 2 (core), 3 (access), 4 (routes, Fern included), 5 (gateway), and the backend rows of section 7 (QA). Section 6 (web) is an outline in `interfaces.md` section 7; it is planned after the design board is approved.

## 1. File-by-file plan

### 1.1 Data layer

| File | Change |
| --- | --- |
| `oss/databases/postgres/migrations/core_oss/versions/oss000000054_add_organization_credentials.py` (NEW) | Revision of interfaces 1.3. |
| `oss/src/dbs/postgres/secrets/dbas.py` | `availability = Column(String, nullable=False, server_default="all_projects")`. |
| `oss/src/dbs/postgres/secrets/dbes.py` | `SecretsDBE.__table_args__` gains the two checks and two partial indexes (metadata matches the revision); NEW `SecretProjectDBE`. |
| `oss/src/dbs/postgres/secrets/mappings.py` | `owner`, `availability`, `selected_project_ids` in `map_secrets_dbe_to_dto`; NEW `map_secret_row_with_projects`. |
| `oss/src/dbs/postgres/secrets/dao.py` | Owner-based methods; `_owner_filter(owner)`; NEW `load_effective` (one statement), the seven organization operations (all `INHERITABLE_KINDS`-only, atomic), `list_organization_project_ids`; the conflict rule folded into the explicit-slug project insert and the user-update lock read; `SERIALIZABLE` transactions with one retry; `DBAPIError` -> domain errors `from None`. SQL constants `_LOAD_EFFECTIVE_SQL`, `_INSERT_PROJECT_SECRET_CHECKED_SQL`, `_ORGANIZATION_CONFLICTS_SQL`, `_INSERT_SECRET_PROJECTS_SQL`. |

### 1.2 Core layer

| File | Change |
| --- | --- |
| `oss/src/core/secrets/enums.py` | `SecretOwnerKind` (moved, + `ORGANIZATION`), `SecretAvailability`, `INHERITABLE_KINDS`. |
| `oss/src/core/secrets/dtos.py` | `SecretOwner`; three response fields, the organization `write_only` validator, `hide_input_in_errors` on every value-holding model; `CachedEffectiveSecrets`. |
| `oss/src/core/secrets/types.py` | Eight NEW exceptions (interfaces 2.3). |
| `oss/src/core/secrets/interfaces.py` | Owner-based `SecretsDAOInterface`; NEW `ProjectLimitsInterface`. |
| `oss/src/core/secrets/inheritance.py` (NEW) | Pure read-side merge and candidate functions (the conflict rule lives in SQL). |
| `oss/src/core/secrets/limits.py` (NEW) | `NoProjectLimits`. |
| `oss/src/core/secrets/services.py` | Owner mapping; the one `effective_secrets` entry per project on today's `get_cache` path; effective readers; organization management; invalidation helpers; request memo use. |
| `oss/src/core/secrets/redaction.py` | No reveal and no preview for organization rows; `inherited_secret_response`, `organization_secret_response`. |
| `ee/src/core/secrets/limits.py` (NEW) | `EntitlementProjectLimits(rbac)`. |
| `oss/src/core/access/organizations.py` (NEW) | `OrganizationAction`, `decide_organization`. |
| `oss/src/core/gateways/policy/dtos.py` | Import `SecretOwnerKind`, `SecretOwner` from core secrets; `BoundSecretRef.owner_kind`. |
| `oss/src/core/gateways/policy/interfaces.py` | `NamedProviderConnection.owner_kind`; docstrings say "effective set". |
| `oss/src/dbs/postgres/gateways/llms/dao.py` | NEW `fetch_custom_target_by_slug` (one statement: project endpoint row, else the available, unshadowed inherited `custom_provider`), replacing `fetch_endpoint_by_slug` on the gateway target path. |
| `oss/src/core/gateways/dtos.py` | `MIN_SCANNED_CREDENTIAL_LENGTH` public; NEW `secret_credential_values`. |
| `oss/src/core/gateways/llms/providers/passthrough/adapter.py` | Scans the organization secret's own values too (~97). |
| `oss/src/core/gateways/policy/resolution.py` | `plane` constructor argument; LLM plane: effective reads, project-first default, owner-aware id references; MCP plane: today's code. |
| `oss/src/core/gateways/policy/types.py` | `SecretNotFoundError` accepts `ORGANIZATION`. |
| `oss/src/core/gateways/policy/audit.py` | `secret_owner_kind` attribute (section 7). |
| `oss/src/core/gateways/llms/types.py` | `LLM_GATEWAY_SERVED_DEPLOYMENT_KINDS` (explicit; Bedrock and SageMaker not served), pinned against `providers/passthrough/auth.py::_AUTH`. |
| `oss/src/core/gateways/llms/service.py` | `_ResolvedLlmTarget.secret_owner_kind`; inherited custom target in `_resolve_target`; `_resolve_slug_target` (provider-family names before any read); the Bedrock check reads the served set. |
| `oss/src/core/gateways/mcps/service.py` | Import paths only (`SecretOwnerKind`). No behavior change. |

### 1.3 Router layer and wiring

| File | Change |
| --- | --- |
| `oss/src/apis/fastapi/organization_secrets/{__init__,router,models}.py` (NEW) | `OrganizationSecretsRouter`, request and response models, `handle_organization_secret_exceptions`. |
| `oss/src/apis/fastapi/vault/router.py` | `include_inherited`; 409 shadow mapping; union response model. |
| `oss/src/apis/fastapi/vault/models.py` | `PublicInheritedSecretResponse`. |
| `entrypoints/routers.py` | `VaultService(..., project_limits=...)`; two resolvers (`plane=LLM` for the LLM gateway, `plane=MCP` for every other current user of `secrets_resolver`); mount `OrganizationSecretsRouter` with `tags=["Organization Secrets"]`. |
| `entrypoints/worker_streams.py`, `entrypoints/worker_queues.py` | No change (their `VaultService` reads project rows by id only; `project_limits=None`). |
| `web/packages/agenta-api-client/src/generated/**`, `web/packages/agenta-sdk/src/resources.ts` | Fern regeneration and `getOrganizationSecretsClient()` . |

### 1.4 Not changed (checked)

- SDK (`sdks/python/agenta/sdk/**`), services, runner: no change. In gateway mode the API chooses the connection; on the vault fallback the SDK reads `GET /secrets/` without `include_inherited`.
- `oss/src/core/secrets/utils.py::get_llm_providers_secrets` (no caller), webhooks, channels, MCP OAuth storage, the providers probe, subscription routes: project rows only, unchanged.
- EE SSO (`ee/src/core/organizations/service.py`): keeps `VaultService(..., organization_id=...)` calls; SSO rows are never inheritable and never listed by the organization routes.
- `hosting/`, Helm, Railway, `utils/env.py`: no new environment variable.

## 2. Key flows

### 2.1 Gateway relay with an inherited key (`POST /gateways/llms/standard/openai/v1/chat/completions`, the sandbox's gateway credential)

1. The auth middleware verifies the gateway-audience Secret token; `AuthScope(organization_id, project_id, user_id)` comes from its claims (minted after an access decision, M2).
2. `_resolve_target(STANDARD, "openai")` builds the generated endpoint (no read).
3. Allowlist, ceilings, `policy.authorize` (unchanged).
4. The LLM-plane resolver: `resolve(ProviderKeyRef("openai"))` -> `list_effective_secrets` -> one `get_cache` of the project's `effective_secrets` entry (warm: one `GET`, as today) -> in memory: project candidates for `openai`; if none, inherited candidates -> `ResolvedSecret(owner=SecretOwner(ORGANIZATION, org_id))`.
5. Relay, then audit with `secret_owner_kind=organization`.

### 2.2 Agent connection resolve with a slug (`POST /gateways/llms/resolve` from the SDK at run start)

`_resolve_slug_target(scope, slug)`: (1) `fetch_custom_target_by_slug` (one statement) -> custom target from the project endpoint row or from an inherited `custom_provider`; (2) builtin provider of that name -> builtin target; (3) a provider-family name (`standard_llm_endpoint`) -> standard target, no read; (4) one effective read: a `provider_key` row with the slug (project first) -> standard target pinned with its owner kind; (5) else `LLMEndpointNotFoundError(custom/<slug>)` as today, then the existing retired starter-credits fallback (its `has_connection` reads the memo).

### 2.3 Project member lists credentials (`GET /secrets/?include_inherited=true`)

`VIEW_SECRET` check (unchanged). No `secret-resolve` grant -> `list_inherited_secrets` (the same one entry read as `GET /secrets/`) -> project rows through `project_secret_response`, then each inherited row through `inherited_secret_response` (no values, no other project ids, override marker).

### 2.4 Owner adds a company key (`POST /organization-secrets/`)

`decide_organization` (one statement) -> kind, family and served-deployment checks (in memory) -> ONE `SERIALIZABLE` transaction: conflict check against project rows (`FOR SHARE`), insert (unique organization slug index), availability and `secret_projects` with the organization check; any refusal rolls everything back -> after the commit: `list_organization_project_ids`, exact `DEL` of each project's entry, `clear_request_memo()`, the audit event -> response without value.

### 2.5 EE admin limits a key (`PUT /organization-secrets/{id}/projects`)

`decide_organization` -> `selected_projects`: `project_limits.allows_selected_projects` (EE: RBAC entitlement, 30 s memo; OSS: 403) -> ONE `SERIALIZABLE` transaction: lock the organization row, conflict check for the projects that gain access, organization-checked insert, delete of the rest -> after the commit, invalidate. The next relay of a removed project misses the key: a pinned id fails with not-found, an unnamed call falls back to the project's own key or fails "no key".

### 2.6 Project overrides an inherited slug (`POST /secrets/` with the inherited slug)

`EDIT_SECRET` check -> ONE `SERIALIZABLE` statement: insert unless an available organization row with that slug has another kind or family (409 then) -> project invalidation. From now on a slug reference in this project resolves the project row; other projects keep the organization row. For a `custom_provider`, the registrar writes the project endpoint row, which wins over the inherited target.

## 3. Request counts (every cache mode)

R = Redis round trips, S = Postgres statements, for the secrets part of each request (the access decision, the policy check and the relay are unchanged). "Before" is `origin/main`. M5 keeps exactly today's cache mechanics for project vault reads: one `get_cache` on one key per project. So an "entry read" costs the same before and after in every mode:

| Mode of one entry read | Before (`list_secrets` entry) | After (`effective_secrets` entry) |
| --- | --- | --- |
| Warm | 1 R (`GET`) | 1 R (`GET`) |
| Cold, lock leader | `GET`, `SET NX`, 1 S, `SET`, `DEL` = 4 R + 1 S | the same 4 R + 1 S (`load_effective` is one statement) |
| Cold, lock follower | `GET`, `SET NX` refused, backoff, `GET` = 3 R | the same 3 R |
| Cache disabled | 0 R + 1 S | 0 R + 1 S |
| Redis failing | failed `GET` + 1 S + failed `SET` | the same |
| Second read in the same request | another entry read | 0 (request memo) |

Per request (in entry reads, U, plus other statements):

| # | Request | Before | After |
| --- | --- | --- | --- |
| A | Relay, standard by provider family (the common agent call) | 1 U | 1 U |
| B | Relay, standard by a project slug | 1 U + 1 S (id read) | 1 U + 1 S |
| C | Relay, standard by an organization slug (fails today: no such slug) | 1 U, then not found | 1 U (the id read uses the memo) |
| D | Relay, custom project endpoint row | 2 S | 2 S |
| E | Relay, inherited custom provider (fails today: not found after 1 S) | 1 S | 1 S (`fetch_custom_target_by_slug` returns the row; the relay uses it) |
| E2 | Relay, unknown custom slug, organization with or without credentials | 1 S, not found | 1 S, not found |
| F | Resolve, provider only | 0 | 0 |
| G | Resolve, project custom slug | 2 S | 1 S |
| H | Resolve, project standard slug (not a family name) | 1 S + 2 U | 1 S + 1 U |
| H2 | Resolve, provider-family slug (`openai`), with or without a project key | 1 S | 1 S |
| I | Resolve, organization `provider_key` slug (fails today after 2 S + 2 U) | 2 S + 2 U | 1 S + 1 U |
| I2 | Resolve, inherited custom slug (fails today after 2 S + 2 U) | 2 S + 2 U | 1 S |
| I3 | Resolve, unknown slug, organization with or without credentials | 2 S + 2 U, not found | 1 S + 1 U, not found |
| J | `GET /secrets/` (vault fallback, `VaultMiddleware`, `/w`, `/m`) | 1 U | 1 U |
| K | `GET /secrets/?include_inherited=true` | today the parameter is ignored: 1 U | 1 U |
| L | `GET /gateways/llms/endpoints` | 1 U + 1 S | 1 U + 1 S |
| M1 | MCP endpoint list (`available_provider_keys`) | 1 U + its statements | the same (MCP plane, today's code) |
| M2 | MCP relay, standard (`ProviderKeyRef`) | 1 U | 1 U |
| M3 | MCP relay, bound secret | 1 S | 1 S |
| P1 | Project secret create, server-derived slug | today's statements | the same |
| P2 | Project secret create, caller-given slug | 1 S insert | 1 S (the check is folded into the insert, `SERIALIZABLE` on `BEGIN`) |
| P3 | Project secret user update | `SELECT ... FOR UPDATE` + `UPDATE` | the same 2 S (the check is folded into the lock read, `SERIALIZABLE`) |
| O | Organization management route (did not exist) | n/a | 1 S decision + the route's statements; writes add 1 S + exact `DEL`s for invalidation after the commit |

Every existing request is equal or lower in every cache mode. Network round trips between services: M5 adds no HTTP call. The isolation option of P2 and P3 rides the `BEGIN` and adds no statement; the count tests pin every row.

## 4. Cache design

- One entry per project (`effective_secrets`), holding the project row's organization, the project's rows and the inherited rows AVAILABLE to that project. Filled by one statement on today's `get_cache` lock path. An organization with no credentials stores an empty list in the same entry.
- Identity: the key holds the full project uuid (`_pack` truncates the `project_id` slot to 12 characters, so the slot alone is not unique); the value holds `project_id` and a read with another id is a miss. The `project_id` slot stays the project id, so today's project-wide pattern invalidation (`invalidate_cache(project_id=...)`) clears it, also from old pods. Two projects with the same 12-character suffix over-invalidate each other (harmless) and never share an entry.
- Invalidation: project writes as today; organization-credential writes and availability changes delete each project entry of the organization (exact keys, batched) after the commit. A new project needs no invalidation (its first read fills the entry). A deleted project's entry expires by TTL.
- Request memo: the entry lives for the rest of the request in M2's request memo; vault invalidation clears the memo.
- Serializer and logs: every nullable field has an explicit `= None`; the model round-trips through `_serialize` / `_deserialize`; `hide_input_in_errors=True` keeps values out of the `[cache]` warning that logs a deserialization error.
- Old `list_secrets` namespace: new code never reads or writes it; old pods do until the rollout ends.

## 5. Security properties and their tests

| # | Property | Enforced by | Tests  |
| --- | --- | --- | --- |
| P1 | No HTTP response carries an organization credential value, for any caller (every project role, the organization owner, a run credential with the `secret-resolve` grant), and no gateway relay echoes one back to the sandbox. | `write_only` validator for organization rows; `project_secret_response` refuses to reveal them; organization and inherited projections drop every credential field; no preview; the passthrough echo scan covers every organization value (at least 8 characters by the write rule). | `test_no_route_returns_an_organization_value` (every secrets-returning route and role, Task 13); gateway echo: a mock upstream that echoes the organization key in a response header, in a non-streaming body and split across two streamed chunks gets the `upstream_echoed_credential` refusal and the key never reaches the client, also for a key carried in a custom-provider extras field (Task 13); create and update with a 7-character value: 422 (Task 5); `test_resolve_grant_never_reveals_organization_rows` (Task 8); redaction unit tests over every `CREDENTIAL_FIELDS` kind (Task 8). |
| P2 | Organization values never reach a sandbox or a plaintext path. | `GET /secrets/` never includes inherited rows under the grant; no endpoint row for organization custom providers; the sandbox holds only a gateway-audience credential. | Gateway off: run credential `GET /secrets/?include_inherited=true` has no inherited row and the sandbox env has no key (Tasks 13, 16); completion app and AI evaluator see project rows only (Task 16). |
| P3 | One organization access decision; only a browser-session human owner or admin passes; no project shortcut applies. | `decide_organization`, called first by every organization route. | Unit rule table (Task 6); acceptance EE hobby `editor` 403, owner API key 403, owner run credential 403, owner and admin 200, both editions (Task 13). |
| P4 | Tenant isolation: no organization row reaches a project of another organization, and no project reads another project's entry. | Entry keyed by the full project id and validated; the project row's organization pins inheritance; organization DAO statements filter by organization; `secret_projects` inserts only same-organization projects. | `test_mismatched_organization_inherits_nothing`, `test_equal_suffix_projects_never_share_an_entry` (same organization and two organizations, Task 4); `test_foreign_project_limit_refused` (Tasks 3, 13); cross-organization ids on every organization route 404 (Task 7). |
| P5 | Project routes never read, change or delete an organization row. | Project-scoped DAO filters (unchanged). | Project editor `DELETE` and `PUT` with an organization id: 404, row stays; `GET /secrets/{org slug}`: 404 (Task 8). |
| P6 | An id reference never substitutes another row. | Owner-aware `BoundSecretRef`; organization ids answered only from the available inherited list. | Pinned organization credential deleted, and limited away: not-found, no project key used (Tasks 9, 13). |
| P7 | A project row and an available organization row never share a slug with another kind or family. | The conflict rule in SQL on every write that can create the pair, `SERIALIZABLE`, against the database, never the shadow-filtered view. | Override kind change, family change, availability widening, organization create over an existing project slug, stale caches (entry warmed before the conflicting write), two concurrent conflicting writes on two connections (one 409) (Tasks 3, 5, 8). |
| P8 | No secret value or token in logs or audit events. | Ids and kinds in logs; `hide_input_in_errors` on every value-holding model; DAO errors raised `from None` with no parameters; audit adds `secret_owner_kind` only. | Sentinel tests: a sentinel credential in a malformed cache entry, a malformed stored row, a failed insert and an unexpected DAO error; every captured log record (including `[cache]` and `[INTERCEPTED]`) is searched for the sentinel (Tasks 4, 7, 8); stack log grep in QA (Task 16). |
| P9 | Cache safety: no cached decision; bounded staleness; Redis holds decrypted values as it does for project rows today. | Section 4. | Invalidation tests with `FakeCache` and real Redis, an old-pod write after a warmed new entry (Tasks 4, 16). |
| P10 | EE SSO secrets are never inherited, never listed in a project, never addressed by the organization routes. | `INHERITABLE_KINDS` in `load_effective` (SQL), in the merge, and in all seven organization DAO operations. | `test_sso_secret_stays_out` (Task 4); an SSO id against all six organization routes: 404, row unchanged (Task 7); SSO login acceptance (Task 16). |
| P11 | The MCP plane never resolves an organization row. | The resolver's `plane` argument; the MCP instance runs today's code. | Organization `provider_key` of family `mock` (a name in both catalogs): absent from the MCP endpoint list and from MCP `ProviderKeyRef("mock")` resolution, with the mock gateways on (Task 9); MCP rows M1 to M3 in the count tests (Task 12). |
| P12 | A deployment the gateway does not serve is refused at create, at update and at resolve. | `LLM_GATEWAY_SERVED_DEPLOYMENT_KINDS`, pinned against the passthrough auth table. | Bedrock and SageMaker create 422 and update 422 (Task 5); a stored inherited Bedrock or SageMaker row (inserted by SQL) answers `LLMGatewayConnectionNotServedError` (Task 10); the set-vs-`_AUTH` pin test (Task 5). |
| P13 | OSS refuses the project limit; EE needs the RBAC entitlement. | `ProjectLimitsInterface`. | OSS 403; EE hobby 403; EE business 200 (Tasks 7, 13). |

## 6. Migration

- Steps: interfaces 1.3. `core_oss/env.py` runs with `transaction_per_migration=True`; the first part (column, check, table, delete, guards, `NOT VALID` constraint) commits as one transaction under `lock_timeout = 5s`; the indexes and the two `VALIDATE CONSTRAINT` statements run in an autocommit block, so the `ACCESS EXCLUSIVE` phase is short and validation takes only `SHARE UPDATE EXCLUSIVE`.
- Interrupted run: the first phase is committed and `alembic_version` is not; the rerun repeats the first phase as no-ops, drops an INVALID index `CONCURRENTLY` and builds it again, then validates (interfaces 1.3).
- Rollback: the app rolls back; the schema stays. Old code works on the new schema (section 1.4 of interfaces).

## 7. Audit and observability

- Gateway audit (`gateways.called`): NEW attribute `secret_owner_kind` (`project` or `organization`) when a secret was resolved (`GatewayOutcome.owner`). The organization id is already on the event. No secret id is added (unchanged rule: names and ids of targets only).
- Organization credential writes publish NEW `EventType.ORGANIZATION_SECRETS_CHANGED` (`organization_secrets.changed`) with `organization_id`, `secret_id`, `kind`, `action` (`created`, `updated`, `deleted`, `availability_changed`), `availability`, project count, and the acting user id. No value, no name. This gives the "audit trail" the authorization checklist asks for; M3 added `EventType` values the same way. If `core/events/types.py` conflicts with M3 at the rebase, keep both values.
- Logs: `[access] organization decision denied` (info); `[secrets] organization mismatch` (warning); `[secrets] cache invalidation failed` (warning); `[secrets] include_inherited ignored for a resolve grant` (info). Ids and kinds only.

## 8. Test plan

### 8.1 Unit (`api/oss/tests/pytest/unit/secrets/`, `unit/access/`, `unit/gateways/`, `unit/migrations/`)

- `secrets/test_inheritance.py`: merge order, override by slug, mismatched organization, SSO and non-inheritable kinds dropped, `provider_candidates` tie rule inside each group.
- `secrets/test_secret_owner_dto.py`: `SecretOwner` frozen; organization rows forced `write_only`; `CachedEffectiveSecrets` round-trips `_serialize` / `_deserialize`; `hide_input_in_errors` is set on every value-holding model (a list of classes in the test, so a new model without it fails).
- `secrets/test_effective_reads.py` (FakeCache recording commands, fake DAO): the entry-read sequence of section 3 in all five modes (warm, cold leader, cold follower, disabled, Redis failing); full-uuid key; identity mismatch is a miss; equal 12-character suffixes in one and in two organizations never share an entry and project-wide invalidation still clears both; memo serves the second read; organization write deletes exactly the organization's project keys and clears the memo; failed invalidation logs and does not raise.
- `secrets/test_organization_secrets_service.py`: kind, family, Bedrock and SageMaker refusals on create and update; limit allowed and refused per edition; keep-on-omit update; one audit event per write.
- `secrets/test_redaction_organization.py`: no reveal with the flag, no preview, inherited projection drops credential fields and project ids, for every `CREDENTIAL_FIELDS` kind of `INHERITABLE_KINDS`.
- `secrets/test_no_values_in_logs.py`: sentinel credential in a malformed cache entry (`get_cache` and the memo path), a malformed stored row, an unexpected DAO error through `intercept_exceptions`; every captured record (including `[cache]` and `[INTERCEPTED]`) is free of the sentinel.
- `gateways/test_served_deployments.py`: `LLM_GATEWAY_SERVED_DEPLOYMENT_KINDS` matches `providers/passthrough/auth.py::_AUTH` (Bedrock and SageMaker not served).
- `access/test_decide_organization.py`: the rule table of interfaces 3.5.
- `gateways/test_gateways_resolution.py` (MODIFIED) and NEW `test_gateways_resolution_inheritance.py`: LLM plane project-first default, slug project then organization, id references by owner kind, real owner; MCP plane: an organization `mock` key is never listed or resolved.
- `gateways/test_gateways_llm_service.py` (MODIFIED): `_resolve_slug_target` gives today's answers for every project shape, provider-family slugs with and without a project key included (table test against the old two-step code captured in the test); inherited custom target; unserved kinds.
- `migrations/test_organization_credentials_migration_gate.py`: `migration_gate.scan_files` on `oss000000054`: no failing finding.

### 8.2 Integration (real Postgres, `api/oss/tests/pytest/integration/secrets/`)

- `test_organization_credentials_migration.py`: upgrade on a scratch copy with orphan rows (deleted, count logged); a both-owner row and duplicate organization slugs (each stops, AND the orphan rows are still there: the delete rolled back); rerun after a completed run; an interrupted run (first phase committed, the job killed before the index phase) then a rerun; an index forced INVALID then a rerun (dropped and rebuilt); the constraint rejects a new orphan; the unique index rejects a duplicate organization slug.
- `test_secrets_dao_owner.py`: owner-based CRUD; `load_effective` is one statement (with and without rows, unknown project, availability applied, SSO excluded); every organization operation refuses an SSO id; atomic create (a foreign project id, a forced failure after the insert: no row left; a concurrent reader on a second connection never sees the row before its limit); the conflict rule on two connections for each write pair (explicit-slug project create vs organization create, project kind change vs organization create, availability widening vs project create): exactly one succeeds, the other gets 409, the invariant holds; stale cache: the entry warmed before a conflicting organization write does not let a conflicting project write pass (the check reads the database).
- `test_organization_secrets_query_counts_postgres.py`: rows A to P3 and M1 to M3 of section 3, both licenses, real Redis, in all five cache modes for the rows that read the entry (cache disabled through `env.agenta.api.caching.enabled` patched off; Redis failing through a client that raises).

### 8.3 Acceptance (real stack, `api/oss/tests/pytest/acceptance/organization_secrets/`)

`test_organization_secrets_authorization`, `test_organization_secrets_crud`, `test_organization_secrets_limits` (EE plans, OSS refusal), `test_inherited_list_redaction`, `test_project_routes_do_not_touch_organization_rows`, `test_override_by_slug`, `test_gateway_uses_inherited_key` (mock LLM gateway), `test_gateway_off_plaintext_paths`, `test_inherited_custom_provider` (mock LLM as a `custom` provider), `test_pinned_reference_never_substitutes`, `test_sso_unaffected` (EE, SSO id against all six routes).

### 8.4 Compatibility

- Pre-M5 rows with the new API: on the restored pre-M5 dump plus `054`, every existing project secret lists, reads, updates and resolves as before (response diff against the pre-M5 API on the same dump: only the additive `owner` field); SSO login works.
- Old-pod write after a warm new entry: a new pod warms `effective_secrets`; the pre-M5 API container writes a project secret; the next new-pod read misses and shows the change.

## 9. QA matrix (backend rows of OpenSpec tasks.md section 7)

| Boundary | Check | Where |
| --- | --- | --- |
| Gateway run (OSS, EE) | An organization OpenAI key  serves an agent in an old and a new project; a slug override wins only in its project; with both keys and no name, the project key is used (audit `secret_owner_kind`). | local stack, `/m` agent chat and API |
| Plaintext paths | Gateway off (`AGENTA_LLM_GATEWAY_ENABLED=false`): the run's `GET /secrets/` has no inherited row; the sandbox env has no organization key; a named organization slug fails "connection not found". A completion app and an AI evaluator run on project keys only. | local stack with the flag off |
| Redaction | Every project role and the organization owner: no response carries an organization value (route sweep script). | local stack, both editions |
| Organization authorization | EE hobby org `editor` 403; owner API key 403; owner run credential 403; owner and admin 200, both editions. | local stack |
| Id reference | A pinned organization credential deleted, then limited away: the run fails and uses nothing else. | local EE stack |
| Custom provider | An organization `custom` provider pointing at the mock LLM serves an agent by slug with no endpoint row (SQL: `llm_endpoints` unchanged); a project endpoint row with that slug wins. | local stack |
| EE limit | A limited credential is invisible to other projects (list and resolve); deleting the only selected project leaves no inheritor; OSS gets 403. | local stack |
| SSO | EE SSO login works; SSO secrets never appear in a project list. | local EE stack (SSO provider fixture) |
| Mixed versions | The migration runs while the pre-M5 API image serves (local EE stack, old image, `alembic upgrade head` from the lane); old pods keep serving project keys; an old-pod write clears a new pod's warmed entry; the pinned pre-M5 SDK and runner resolve as before; pre-M5 rows behave as before on the new API (section 8.4). | local EE stack |

## 10. Docs and config

- `openspec/changes/organization-credentials/{design,tasks}.md` and `specs/*/spec.md`: the deviations ; `openspec validate organization-credentials --strict`.
- `docs/design/sharing-program/CONTRACT.md` section 8: one line for the tenancy pin and one for the MCP rule (section 12).
- `api/AGENTS.md`: access section ("organization-scoped decisions go through `decide_organization`; project RBAC shortcuts never apply"), secrets section ("in-process readers use the effective set; HTTP project routes stay project-only").
- Self-host and user docs: with the UI phase (they describe screens). The backend PR body states the API and the gateway requirement.
- Config: no new environment variable (evidence: diff of `utils/env.py`, `hosting/` empty).

## 11. Risks

- A project that adds its own key for a provider stops using the organization key for unnamed calls (the intended override).
- Most self-hosted OSS deployments run with the gateway off (default `false`); organization credentials do nothing there. The UI phase shows this (board C4).
- Prompts, completion and chat apps, and AI evaluators never use organization credentials (owner decision 3). Teams can be surprised; the UI phase explains it.
- Old pods during the rollout do not serve organization credentials (short "no key" window).
- `_resolve_slug_target` replaces two functions on the resolve path. Mitigation: a table test that compares its answers with the captured old code for every project shape, provider-family slugs included.
- `SERIALIZABLE` writes can abort with `40001` under concurrency; one internal retry, then 409. Only explicit-slug project creates, project user updates and organization writes run at that level.
- Organization writes in a large organization delete one cache key per project (batched, after the commit; admin path only).
- Merge overlaps with other open changes: `entrypoints/routers.py` (M3), `core/gateways/policy/audit.py` and `AuthScope` (M4b step 2), `api/AGENTS.md`, `core/events/types.py` (M3), Fern generated files (M3).

## 12. Contract changes and open items

Contract edits (applied in Task 0b with the spec files):

1. CONTRACT section 8, add: "Inheritance uses the organization that the project row names; a request whose organization differs from it inherits nothing."
2. CONTRACT section 8, add: "Organization credentials serve the LLM plane only. The resolver is built per plane; the MCP plane never reads organization rows."
3. CONTRACT section 6, wording: "Organization-scoped decisions (M5) accept only a browser-session human with no run envelope."

Existing code findings, not widened into M5:

- A. `utils/caching.py::_pack` keeps only the last 12 characters of `project_id` and `user_id` for every namespace. Two projects (or users) with the same suffix share today's entries, for example `list_secrets` and the auth and membership caches: a cross-project read on a collision. M5's own entry is safe (full id in the key, identity check). A general fix is a separate change.
- B. The transactions engine does not set `hide_parameters`, and `intercept_exceptions` logs `format_exc()`. An unmapped database error in today's project secret writes can log the plaintext JSON bound to `pgp_sym_encrypt`. M5 wraps every `SecretsDAO` write (today's project writes included) and raises domain errors `from None`, so the secrets table is covered; the general fix for other tables (engine `hide_parameters=True`) is a separate change.

Open items, none blocking the backend build:

- Board question G3 (key preview on organization rows). The plan shows no preview. Allowing it is a security property change that only the owner can accept.
- Board items F1 and F5 (gateway-off status and a reason code) are small backend additions for the UI phase.
- Clarification for the owner (not a security change): "legacy completion and chat apps" covers the prompt playground and AI evaluators too, because they share the `VaultMiddleware` path.
