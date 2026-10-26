# M5 `organization-credentials`: interfaces

Status: implemented in the backend. The web part is planned after the design review.

Normative names come from `docs/design/sharing-program/CONTRACT.md` (v3, sections 6, 8, 12) and the M2 design. This file adds only M5 names. Where this file and CONTRACT.md disagree, CONTRACT.md wins; the contract edits that M5 needs are in `technical-design.md` section 12. Where this file and `openspec/changes/organization-credentials/` disagree, this file is the newer reading of the code; the plan's Task 0b brings the OpenSpec files in line.

Owner decisions applied (DECISIONS.md, M5 lines):

- An agent uses exactly the connection it picked, by scope (`project` or `organization`) and slug. Nothing is inherited or overridden automatically; an agent with no connection keeps the project default (option B, 2026-10-26).
- Organization subscription logins (ChatGPT, Claude) are allowed (2026-10-26). An agent uses one only when it names it; it runs only on the `inprocess` engine (section 4.5). M7 owns personal logins.
- Organization credential values never reach a sandbox. An organization subscription login reaches the runner process only, never the sandbox.
- Legacy completion and chat apps cannot use organization credentials (2026-10-25). In the code this is every workflow that loads the vault through the SDK `VaultMiddleware`: completion and chat apps, the prompt playground, and LLM-as-a-judge and other AI evaluators. Only agents, through the LLM gateway, use organization credentials.
- Organization owners and admins manage organization credentials, in both editions, with one rule (2026-10-25).
- The EE project limit reuses the RBAC entitlement (`Flag.RBAC`). There is no new plan flag (2026-10-25).

Names reused without change: `VaultService`, `SecretsDAO`, `SecretResponseDTO`, `PublicSecretResponseDTO`, `project_secret_response`, `SECRET_RESOLVE_GRANT`, `request_has_grant`, `SecretsResolver`, `SecretsResolverInterface`, `ResolvedSecret`, `SecretMode`, `ProviderKeyRef`, `BoundSecretRef`, `NamedProviderConnection`, `LLMGatewayService`, `map_custom_provider_secret_to_endpoint`, `check_secret_is_owned_by_project`; from M2 `core/access/dtos.py`: `PrincipalKind`, `PrincipalRef`, `RequestAccess`, `RequestCredentialKind`, `Decision`, `DecisionReason`; `get_request_access()`; `request.state.principal`, `request.state.authority`, `request.state.credential_kind`, `request.state.run_envelope`, `request.state.organization_id`; from M1: `MembershipsService.fetch_organization_member`, `get_memberships_service()`.

---

## 1. Data

All schema changes go in one `core_oss` revision. EE runs the same chain. Nothing goes in `core_ee`.

### 1.1 `secrets` (MODIFIED, `SecretsDBE` in `oss/src/dbs/postgres/secrets/dbes.py`, `SecretsDBA` in `dbas.py`)

| Change | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `availability` (NEW column) | varchar | NOT NULL | `'all_projects'` | Read only for organization rows. Project rows keep the default. |
| `ck_secrets_availability` (NEW check) | | | | `availability IN ('all_projects','selected_projects')`. Added `NOT VALID`, then validated. |
| `ck_secrets_single_owner` (NEW check) | | | | `num_nonnulls(project_id, organization_id) = 1`. Added `NOT VALID`, then validated after the orphan cleanup. M7 replaces it when it adds `user_id`. |
| `uq_secrets_organization_id_slug` (NEW unique index) | | | | `(organization_id, slug) WHERE project_id IS NULL AND slug IS NOT NULL`. `CREATE UNIQUE INDEX CONCURRENTLY`. M7 adds `AND user_id IS NULL`. |
| `ix_secrets_organization_id` (NEW index) | | | | `(organization_id) WHERE project_id IS NULL`. `CREATE INDEX CONCURRENTLY`. Serves the organization list read. |

- Unchanged: `project_id` and `organization_id` stay nullable, each with its cascading foreign key. `uq_secrets_project_id_slug` stays.
- The `kind` column is the Postgres enum `secretkind_enum`. Its labels are the member NAMES (`PROVIDER_KEY`, `CUSTOM_PROVIDER`, `SSO_PROVIDER`), not the values. Raw SQL in the revision and in the DAO uses the names. Some rows have a NULL `kind` (seen on the local seed); every reader skips them, as today.

### 1.2 `secret_projects` (NEW table, `SecretProjectDBE` in `oss/src/dbs/postgres/secrets/dbes.py`)

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `secret_id` | uuid | NOT NULL | |
| `project_id` | uuid | NOT NULL | |
| `created_at` | timestamptz | NULL | `current_timestamp` |
| `created_by_id` | uuid | NULL | |
| `updated_at`, `deleted_at` | timestamptz | NULL | |
| `updated_by_id`, `deleted_by_id` | uuid | NULL | |

- PK `(secret_id, project_id)`. FK `secret_id` -> `secrets.id` ON DELETE CASCADE. FK `project_id` -> `projects.id` ON DELETE CASCADE. Index `ix_secret_projects_project_id (project_id)`.
- Only rows of an organization-owned `secrets` row with `availability = 'selected_projects'` are meaningful. The DAO writes them only for such a row, and only for projects of the same organization (section 3.1, `set_availability`). The database does not enforce the organization match; the DAO does it in the write statement.
- `selected_projects` with no rows means "no project". It never means "every project" (OpenSpec design D6).

### 1.3 Alembic revision (`oss/databases/postgres/migrations/core_oss/versions/`)

**`oss000000054_add_organization_credentials.py`** (NEW)

- `revision = "oss000000054"`, `down_revision = "oss000000052"` (the head of main at v0.125.0). Chain: `... 047 -> 050 -> 048 -> 049 -> 051 -> 052 -> 054`. If M4b step 2 (053) lands first, the later of the two re-points to the other, so there is one alembic head at every point.

```python
def upgrade() -> None:
    conn = op.get_bind()
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("ALTER TABLE secrets ADD COLUMN IF NOT EXISTS availability VARCHAR NOT NULL DEFAULT 'all_projects'")
    op.execute("ALTER TABLE secrets ADD CONSTRAINT ck_secrets_availability "
               "CHECK (availability IN ('all_projects','selected_projects')) NOT VALID")   # guarded: skip if it exists
    op.create_table("secret_projects", ...)        # 1.2, with ix_secret_projects_project_id (new table, not flagged)
    deleted = conn.execute(sa.text(
        "DELETE FROM secrets WHERE project_id IS NULL AND organization_id IS NULL")).rowcount
    log("[secrets] deleted %s rows with no owner", deleted)
    both = conn.execute(sa.text(
        "SELECT count(*) FROM secrets WHERE project_id IS NOT NULL AND organization_id IS NOT NULL")).scalar()
    if both: raise RuntimeError(f"{both} secrets rows name a project and an organization. Fix them before this migration.")
    dupes = conn.execute(sa.text(
        "SELECT count(*) FROM (SELECT 1 FROM secrets WHERE project_id IS NULL AND slug IS NOT NULL "
        "GROUP BY organization_id, slug HAVING count(*) > 1) d")).scalar()
    if dupes: raise RuntimeError(f"{dupes} organization slugs are used twice. Rename them before this migration.")
    op.execute("ALTER TABLE secrets ADD CONSTRAINT ck_secrets_single_owner "
               "CHECK (num_nonnulls(project_id, organization_id) = 1) NOT VALID")             # guarded
    with op.get_context().autocommit_block():
        op.execute("CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_secrets_organization_id_slug "
                   "ON secrets (organization_id, slug) WHERE project_id IS NULL AND slug IS NOT NULL")
        op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_secrets_organization_id "
                   "ON secrets (organization_id) WHERE project_id IS NULL")
        # for each index: an INVALID leftover of an interrupted run is dropped CONCURRENTLY and
        # built again; a still-invalid index after the build stops the upgrade with the REINDEX instruction.
        op.execute("ALTER TABLE secrets VALIDATE CONSTRAINT ck_secrets_availability")
        op.execute("ALTER TABLE secrets VALIDATE CONSTRAINT ck_secrets_single_owner")
```

- `downgrade()` drops both indexes, both constraints, the table and the column.
- Migration gate: passes without the label. The `NOT NULL ... DEFAULT` column and the recovery `DROP INDEX` of an invalid index are "reported, do not fail" (`api/AGENTS.md`), and on Postgres 11 and later it is a metadata change with no table rewrite. `DELETE` is not flagged. The table is new.
- Every statement is rerun-safe (`IF NOT EXISTS`, guarded constraint adds through a `pg_constraint` lookup, `secret_projects` created only when `to_regclass('secret_projects') IS NULL`).
- Refusals roll back: the two guards run in the first transaction after the orphan `DELETE`, so a refusal rolls the delete back with everything else and changes nothing.
- Interrupted run: the first phase commits before the autocommit block, and `alembic_version` is written only at the end. A crash during an index build leaves the first phase committed, possibly an INVALID index, and the version unchanged. The rerun repeats the first phase as no-ops, then for each index: if it exists and `indisvalid` is false, `DROP INDEX CONCURRENTLY` it and build it again; then validate. Tested by killing the job after the first phase and with an index forced invalid.

### 1.4 Mixed versions

| Case | Behavior |
| --- | --- |
| Old API pods on the new schema (rolling deploy) | They ignore `availability` and `secret_projects`. They read organization rows only by id (EE SSO). They never list or return an organization credential. Their gateway resolves project rows only, so a run that an old pod serves can fail with "no key" for an organization credential until the rollout ends (accepted, OpenSpec design). Their writes of project rows invalidate every cache namespace of the project (pattern scan), so the new `effective_secrets` entry is cleared too (verified by test: an old-pod write after a new pod warmed the entry). |
| Old pods write a row | Project rows and EE SSO rows only, through the old DAO, which already requires exactly one owner. The server default fills `availability`. The new constraints accept these rows. |
| New pods on pre-M5 rows | Existing project rows and EE SSO rows stay. New pods read them with `availability` defaulted, `owner` mapped from the columns, and SSO rows never shared (tested on the restored pre-M5 dump). |
| New pods during the rollout | They read the new cache namespace only. The old `list_secrets` namespace stays for old pods and expires by TTL. |
| Old SDK, old runner, old `/w` | No change. Without `include_organization`, `GET /secrets/` answers today's rows. New responses carry the additive `owner` field; the SDK reads the vault response as plain dictionaries (`agents/platform/connections.py`, `middlewares/running/vault.py`), so extra keys are ignored. A services image older than M5 refuses an agent saved with an organization connection: it does not know the `organization` namespace (section 3.9). |
| Rollback of the app to pre-M5 code | Organization connections stop working. Nothing leaks: old code never returns organization rows to a project. The schema stays (the hook never runs `downgrade`). |

M5 adds no durable work type.

---

## 2. Core types

### 2.1 `oss/src/core/secrets/enums.py` (MODIFIED)

```python
class SecretOwnerKind(str, Enum):          # MOVED here from core/gateways/policy/dtos.py, + ORGANIZATION
    ORGANIZATION = "organization"
    PROJECT = "project"
    USER = "user"                          # M7; no rows in M5

class SecretAvailability(str, Enum):       # NEW
    ALL_PROJECTS = "all_projects"
    SELECTED_PROJECTS = "selected_projects"

ORGANIZATION_SECRET_KINDS = frozenset({SecretKind.PROVIDER_KEY, SecretKind.CUSTOM_PROVIDER, SecretKind.SUBSCRIPTION_PROVIDER})   # NEW
ORGANIZATION_GATEWAY_KINDS = frozenset({SecretKind.PROVIDER_KEY, SecretKind.CUSTOM_PROVIDER})   # NEW: what the LLM gateway serves
```

### 2.2 `oss/src/core/secrets/dtos.py` (MODIFIED)

```python
class SecretOwner(BaseModel):              # NEW. CONTRACT section 8. Frozen pydantic model, not a dataclass
    model_config = ConfigDict(frozen=True)
    kind: SecretOwnerKind
    id: UUID

class _SecretResponseBaseDTO(...):         # MODIFIED: fields, one validator, hidden inputs
    model_config = ConfigDict(hide_input_in_errors=True)       # NEW: a validation error never quotes a value
    owner: Optional[SecretOwner] = None    # set by every DAO mapping
    availability: Optional[SecretAvailability] = None          # organization rows only
    selected_project_ids: Optional[List[UUID]] = None          # organization rows with SELECTED_PROJECTS, management responses only

    @model_validator(mode="after")
    def force_write_only_on_organization_rows(self):           # NEW, fail closed, runs on cache rehydration too
        if self.owner is not None and self.owner.kind == SecretOwnerKind.ORGANIZATION:
            self.write_only = True
        return self

class CachedEffectiveSecrets(BaseModel):   # NEW cache value of `effective_secrets`
    model_config = ConfigDict(hide_input_in_errors=True)
    project_id: UUID                       # the FULL project id; a read whose id differs is a miss
    organization_id: Optional[UUID] = None # the project row's organization; None = project not found
    secrets: List[SecretResponseDTO] = []  # the project's own rows
    organization: List[SecretResponseDTO] = []  # shareable organization rows AVAILABLE to this project (availability applied in SQL);
                                                # no selected_project_ids stored here
```

- `hide_input_in_errors=True` is set on every model that holds a value: `_SecretResponseBaseDTO` (so `SecretResponseDTO` and `PublicSecretResponseDTO`), `CachedEffectiveSecrets`, the organization response models, and the organization request models. Several data DTOs in `dtos.py` already set it (lines ~89, 235, 276, 295); the plan lists every class that holds a value and a unit test asserts the flag on each.
- Every nullable field of a cached model has an explicit `= None` default (`_serialize` dumps with `exclude_none=True`). `CachedEffectiveSecrets` is round-tripped through the real `_serialize` and `_deserialize` in a unit test.
- The organization `availability` and `selected_project_ids` are never stored in the cache entry: the fill statement applies availability, so a project's entry never lists other projects.

### 2.3 `oss/src/core/secrets/types.py` (MODIFIED, domain exceptions)

| Exception | Raised by | HTTP at the route |
| --- | --- | --- |
| `OrganizationSecretKindNotShareable(kind)` (NEW) | org create/update with a kind outside `ORGANIZATION_SECRET_KINDS`, or a `provider_key` whose provider family is not an `LLMStandardProviderKind` | 422 |
| `OrganizationSecretNotServed(deployment_kind)` (NEW) | org create/update of a `custom_provider` whose deployment kind is not in `LLM_GATEWAY_SERVED_DEPLOYMENT_KINDS` (today Bedrock and SageMaker are not) | 422 |
| `SecretSlugConflict(slug)` (existing) | a duplicate organization slug (`uq_secrets_organization_id_slug`), as for projects | 409 |
| `ProjectLimitNotAllowed()` (NEW) | `selected_projects` in OSS, or in EE without `Flag.RBAC` | 403 |
| `ProjectNotInOrganization(project_ids)` (NEW) | a limit that names a project of another organization or an unknown project | 422 |
| `OrganizationSecretNotFound()` (NEW) | an org route with an id that is not a SHAREABLE organization row of the request's organization (an SSO id answers this too) | 404 |
| `SecretStorageError()` (NEW) | an unexpected database error in a secrets write, raised `from None` with no parameters in its message | 500 through `intercept_exceptions` (its traceback then holds no bind values) |

### 2.4 `oss/src/core/gateways/policy/dtos.py` (MODIFIED)

```python
from oss.src.core.secrets.enums import SecretOwnerKind     # the local enum is deleted
from oss.src.core.secrets.dtos import SecretOwner          # the local SecretOwner(kind, user_id) is deleted

class BoundSecretRef(BaseModel):
    secret_id: UUID
    owner_kind: SecretOwnerKind = SecretOwnerKind.PROJECT   # NEW. PROJECT keeps today's lookup.

class ResolvedSecret(BaseModel):            # unchanged shape; `owner` is now the core SecretOwner
    secret: SecretResponseDTO
    owner: Optional[SecretOwner]            # None only for the platform's own credential
    origin: SecretOrigin
```

- The gateway `SecretOwner.user_id` field goes away. Nothing sets it today (user-owned secrets are not resolved). M7 uses `SecretOwner(kind=USER, id=user_id)`.
- `SecretNotFoundError(missing=...)` keeps `SecretOwnerKind.PROJECT` for a project miss and gains `SecretOwnerKind.ORGANIZATION` for an organization id reference that is gone or limited away.

---

## 3. Core interfaces

### 3.1 `SecretsDAOInterface` (`oss/src/core/secrets/interfaces.py`, MODIFIED)

Every existing method takes `owner: SecretOwner` instead of the `project_id` / `organization_id` pair. The DAO maps the kind to the column. A `USER` owner raises `ValueError` in M5. The existing methods with an `ORGANIZATION` owner stay for EE SSO only (any kind, as today).

```python
class SecretsDAOInterface:
    # existing, owner-based
    async def create(self, *, owner, create_secret_dto, management=None) -> SecretResponseDTO: ...
    async def get_by_id(self, *, owner, secret_id) -> Optional[SecretResponseDTO]: ...
    async def get_by_slug(self, *, owner, secret_slug) -> Optional[SecretResponseDTO]: ...
    async def list(self, *, owner) -> List[SecretResponseDTO]: ...
    async def update(self, *, owner, secret_id, update_secret_dto, user_id=None, resolve_update=None): ...
    async def delete(self, *, owner, secret_id, authorize_delete=None) -> None: ...

    # NEW reader for the cache fill
    async def load_effective(self, *, project_id: UUID) -> CachedEffectiveSecrets:
        """ONE statement: the project row's organization_id, the project's rows, and the
        ORGANIZATION_SECRET_KINDS organization rows of that organization that are available to this
        project (availability = 'all_projects' OR EXISTS secret_projects(secret_id, :project_id)).
        An unknown project answers organization_id None and no rows."""

    # NEW organization-credential operations. Every one filters kind IN ORGANIZATION_SECRET_KINDS
    # AND project_id IS NULL AND organization_id = :organization_id.
    async def list_organization_secrets(self, *, organization_id) -> List[SecretResponseDTO]: ...      # with selected_project_ids
    async def fetch_organization_secret(self, *, organization_id, secret_id) -> Optional[SecretResponseDTO]: ...
    async def create_organization_secret(self, *, organization_id, create_secret_dto, availability,
                                         project_ids, user_id) -> SecretResponseDTO: ...
    async def update_organization_secret(self, *, organization_id, secret_id, update_secret_dto,
                                         user_id, resolve_update) -> Optional[SecretResponseDTO]: ...
    async def delete_organization_secret(self, *, organization_id, secret_id) -> bool: ...
    async def set_organization_secret_availability(self, *, organization_id, secret_id, availability,
                                                   project_ids, user_id) -> Optional[SecretResponseDTO]: ...
    async def list_organization_project_ids(self, *, organization_id) -> List[UUID]: ...   # invalidation after an organization write
```

**Atomic organization writes.** `create_organization_secret` runs in ONE transaction: the `secrets` insert, the availability, and for `SELECTED_PROJECTS` the `secret_projects` rows through `INSERT ... SELECT id FROM projects WHERE id = ANY(:ids) AND organization_id = :org`, comparing the inserted count with the ids. Any refusal (`ProjectNotInOrganization`, `SecretSlugConflict`, a database error) rolls the whole transaction back: no row is left. `update_organization_secret` and `set_organization_secret_availability` lock the organization row `FOR UPDATE` and do the same in one transaction. Cache invalidation runs only after the commit, in the service. A concurrent reader cannot see an uncommitted row, so it can never cache a credential before its limit applies.

**Two slug spaces.** Project rows (`uq_secrets_project_id_slug`) and organization rows (`uq_secrets_organization_id_slug`) never constrain each other: a project row may use an organization row's slug with any kind or family. An agent names the one it uses by scope, so no write checks the other scope and no write needs a `SERIALIZABLE` transaction. Project writes send the same statements as before M5.

**Errors without values.** `SecretsDAO` catches `DBAPIError` on every secrets write and raises a domain error (`SecretSlugConflict`, else `SecretStorageError`) with `raise ... from None`, so no traceback carries the SQL parameters (the plaintext JSON is a bind parameter of `pgp_sym_encrypt`).

`map_secrets_dbe_to_dto` sets `owner` from the columns.

### 3.2 `VaultService` (`oss/src/core/secrets/services.py`, MODIFIED)

The public keyword arguments of the existing methods do not change (`project_id`, `organization_id`), so EE SSO callers, webhooks, channels, MCP OAuth storage and the providers probe keep their calls. The service maps them to `SecretOwner` for the DAO.

```python
class VaultService:
    def __init__(self, secrets_dao, *, llm_endpoint_registrar=None,
                 project_limits: Optional[ProjectLimitsInterface] = None): ...   # NEW kwarg; None = refuse every limit

    # existing reader, project rows only, unchanged meaning
    async def list_secrets(self, *, project_id=None, organization_id=None): ...
    #   project_id: reads the NEW `effective_secrets` entry and returns its `.secrets` (same Redis and SQL
    #   sequence as today's `list_secrets` entry, section 6). organization_id: uncached DAO list, as today (EE SSO only).

    # NEW scoped readers (CR "scope and slug"); LLM gateway, the providers probe and GET /secrets/?include_organization only
    async def get_organization_connection(self, *, organization_id, project_id, slug) -> Optional[SecretResponseDTO]: ...
    async def get_connection_secret_by_id(self, *, organization_id, project_id, secret_id,
                                          owner_kind: SecretOwnerKind) -> Optional[SecretResponseDTO]: ...
    async def list_project_and_organization_secrets(self, *, organization_id, project_id
                                                    ) -> Tuple[List[SecretResponseDTO], List[SecretResponseDTO]]: ...

    # NEW organization management (OC "shareable kinds", "EE limits"); every one is ORGANIZATION_SECRET_KINDS-only
    async def list_organization_secrets(self, *, organization_id) -> List[SecretResponseDTO]: ...
    async def fetch_organization_secret(self, *, organization_id, secret_id) -> Optional[SecretResponseDTO]: ...
    async def create_organization_secret(self, *, organization_id, create_secret_dto, user_id,
                                         availability=ALL_PROJECTS, project_ids=()) -> SecretResponseDTO: ...
    async def update_organization_secret(self, *, organization_id, secret_id, update_secret_dto, user_id) -> Optional[SecretResponseDTO]: ...
    async def delete_organization_secret(self, *, organization_id, secret_id) -> bool: ...
    async def set_organization_secret_availability(self, *, organization_id, secret_id,
                                                   availability, project_ids, user_id) -> Optional[SecretResponseDTO]: ...
```

- **One cache entry per project.** Namespace `effective_secrets`, `project_id` slot = the project id (so today's project-wide pattern invalidation clears it, old pods included), `key = {"p": "<full project uuid>"}` (so two projects whose ids share the last 12 characters, which `_pack` keeps, never share an entry). Value `CachedEffectiveSecrets`. On a read, `value.project_id != project_id` is treated as a miss (defense in depth; logged at warning).
- **Same Redis and SQL sequence as today.** The entry read calls `get_cache` on that one key, exactly as today's `list_secrets` does: warm 1 `GET`; cold leader `GET`, lock `SET NX`, ONE `load_effective` statement, `set_cache` (`SET` + lock `DEL`); cold follower `GET`, lock `SET NX` refused, backoff, `GET`; cache disabled 0 Redis + 1 statement; Redis down: the failed `GET`, 1 statement, the failed `SET`. No `MGET`, no second entry, no extra `get_cache`. An organization with no credentials stores an empty `organization` list inside the same entry, so it costs nothing extra.
- **Request memo.** The entry stays in M2's request memo (`get_request_memo()`, key `("secrets_effective", project_id)`) for the rest of the request; a second read in the same request makes no Redis call and, with the cache disabled, no SQL. Outside a request (workers) there is no memo. Every vault invalidation calls `clear_request_memo()`.
- **Tenancy pin.** The entry carries the project row's `organization_id`. When it differs from the `organization_id` argument (the request's organization), no organization row is answered and `[secrets] organization mismatch` is logged at warning with both ids. Organization rows never cross organizations.
- `get_connection_secret_by_id(owner_kind=PROJECT)` is today's DAO read by id (one statement), unchanged. `owner_kind=ORGANIZATION` answers only an id in the entry's `organization` list (already filtered by availability); it never answers a project row, and a project row never substitutes. `get_organization_connection` answers the organization row with that slug the same way.
- **Writes and invalidation.** Project writes keep `invalidate_cache(project_id=...)` (every namespace of the project). Every organization-credential write, after its commit: `list_organization_project_ids` (one statement) and an exact `DEL` of each project's `effective_secrets` key, in batches of `AGENTA_CACHE_DELETE_BATCH_SIZE`; then `clear_request_memo()`. A failed invalidation logs `[secrets] cache invalidation failed` and never fails the writer. EE SSO writes (not shareable) invalidate nothing new.
- The `custom_provider` endpoint registration stays project-only (`project_id is None` returns early), so organization writes register no endpoint row (OpenSpec design D5).
- Organization create and update refuse: a kind outside `ORGANIZATION_SECRET_KINDS`; a credential value shorter than `MIN_SCANNED_CREDENTIAL_LENGTH`; a `provider_key` whose `data.kind` is not an `LLMStandardProviderKind`; a `custom_provider` whose deployment kind is not in `LLM_GATEWAY_SERVED_DEPLOYMENT_KINDS` (section 3.7). The organization routes do not accept `management`. A new connection starts with `ALL_PROJECTS`; an unnamed `provider_key` is named after its provider with the owner ("OpenAI (Organization)", then "OpenAI (Organization) 2").

### 3.3 NEW `oss/src/core/secrets/scopes.py` (pure functions, no I/O)

```python
def organization_matches(*, entry: CachedEffectiveSecrets, organization_id) -> bool: ...
def available_organization_secrets(*, entry, organization_id) -> List[SecretResponseDTO]: ...
    # the organization rows an agent of this project may name; none on an organization mismatch
def provider_candidates(*, secrets, provider_key) -> List[SecretResponseDTO]: ...   # today's tie rule over project rows
def is_llm_provider_family(data) -> bool: ...                                   # create-time rule for organization provider_key rows
```

There is no merge: a project row and an organization row with the same slug never stand in for each other.

### 3.4 NEW `ProjectLimitsInterface` (`oss/src/core/secrets/interfaces.py`)

```python
class ProjectLimitsInterface(ABC):
    @abstractmethod
    async def allows_selected_projects(self, *, organization_id: UUID) -> bool: ...

# oss/src/core/secrets/limits.py (NEW): class NoProjectLimits -> False (OSS)
# ee/src/core/secrets/limits.py (NEW):  class EntitlementProjectLimits(rbac: RbacEnforcementInterface)
#     -> await rbac.is_enforced(organization_id=...), the EE RBAC entitlement check with its 30 s memo
```

The composition root (`entrypoints/routers.py`) passes `EntitlementProjectLimits(rbac=get_access_service().rbac)` when `is_ee()`, else `NoProjectLimits()`. Setting `ALL_PROJECTS` is always allowed, so an EE organization that lost the entitlement can still widen a limited credential.

### 3.5 Organization access decision (NEW `oss/src/core/access/organizations.py`)

```python
class OrganizationAction(str, Enum):
    MANAGE_ORGANIZATION_SECRETS = "manage_organization_secrets"

async def decide_organization(*, access: Optional[RequestAccess], organization_id: UUID,
                              action: OrganizationAction) -> Decision: ...
```

Rule, in order (CONTRACT section 6; OpenSpec design D8, read against the M2 code, deviation 2):

1. `access` is not None, `access.credential_kind == BEARER_SESSION`, `access.envelope is None`, `access.principal.kind == HUMAN` and `access.principal.id == access.acting_user_id`. Else `MISSING_CAPABILITY`. This refuses every API key (also an M6 personal key, whose principal is a human), every run credential and gateway credential (`RUN_CREDENTIAL`), an admin `Access` request (no principal), and an unknown credential kind.
2. The human has an `organization_members` row in `organization_id` (`MembershipsService.fetch_organization_member`, uncached, one statement), else `NOT_MEMBER`.
3. The row's role is `owner` or `admin`, else `MISSING_CAPABILITY`. Allowed reason: `ROLE`.

It reads no entitlement, project row, project role or custom role, in OSS and EE. The EE no-RBAC bypass and the organization-owner shortcut of project RBAC never apply. A denial logs `[access] organization decision denied` (info) with `principal_kind`, `principal_id`, `organization_id`, `action`, `reason`. No result is cached, so a role change applies to the next request. M2's spec text "authority is None" does not match the code: a Bearer request carries an authority built from the session (`middlewares/auth.py::_set_principal_state`). The run marker is the envelope, so rule 1 checks `envelope is None`.

### 3.6 `SecretsResolver` (`oss/src/core/gateways/policy/resolution.py`, MODIFIED) and its interface

**Explicit plane.** The resolver takes the plane at construction: `SecretsResolver(*, vault_service, plane: GatewayPlane)`. The composition roots build two instances: `llm_secrets_resolver = SecretsResolver(vault_service=..., plane=GatewayPlane.LLM)` for `LLMGatewayService`, and `mcp_secrets_resolver = SecretsResolver(vault_service=..., plane=GatewayPlane.MCP)` for `MCPGatewayService` and the shared policy service. Every plane reads the project's own rows for a provider scan and a project slug. Only `plane == LLM` answers an organization connection, and only one an agent named.

| Method | `plane == LLM` | `plane == MCP` |
| --- | --- | --- |
| `available_provider_keys(scope)` | project rows (today) | project rows (today) |
| `provider_connection_by_slug(scope, slug)` | project `provider_key` row with that slug (today); `NamedProviderConnection` gains `owner_kind: SecretOwnerKind = PROJECT` | today |
| `has_connection(scope, slug)` | project rows (today) | today |
| NEW `organization_connection(scope, slug)` | the organization row with that slug available to the project, else None | None, without a read |
| `resolve(ProviderKeyRef)` | project candidates for the provider (today's tie rule); never an organization row | today |
| `resolve(BoundSecretRef)` | `owner_kind=PROJECT`: today's `get_secret_by_id(project_id)`; `owner_kind=ORGANIZATION`: `get_connection_secret_by_id(owner_kind=ORGANIZATION)`; a miss raises `SecretNotFoundError(missing=<owner_kind>)` and tries nothing else | `owner_kind=ORGANIZATION` raises `SecretNotFoundError(ORGANIZATION)` without a read |

### 3.7 `LLMGatewayService` (`oss/src/core/gateways/llms/service.py`, MODIFIED)

- NEW `LLM_GATEWAY_SERVED_DEPLOYMENT_KINDS` in `core/gateways/llms/types.py`: the explicit set of deployment kinds the gateway serves, written next to the passthrough auth table (`providers/passthrough/auth.py::_AUTH`). Today it excludes `BEDROCK` (refused in `resolve_agent_connection`) and `SAGEMAKER` (`_sagemaker_auth` raises "not reachable through the gateway"). A unit test pins the set against `_AUTH` (every served kind has an auth entry that does not raise; Bedrock and SageMaker are not served), so adding or removing a deployment forces a deliberate edit. Organization create and update, and the resolution of an existing organization row, all use it; `resolve_agent_connection`'s inline Bedrock check reads it too (same behavior for project rows: Bedrock still refused there; SageMaker keeps today's failure at the upstream auth step).
- `_ResolvedLlmTarget` gains `secret_owner_kind: SecretOwnerKind = PROJECT`. `secret_ref()` returns `BoundSecretRef(secret_id, owner_kind=secret_owner_kind)`.
- NEW gateway namespace `GatewayEndpointNamespace.ORGANIZATION` (`"organization"`) and relay routes `/gateways/llms/organization/{slug}/v1/{chat/completions,responses,messages,models}`.
- `resolve_agent_connection` gains `connection_scope: SecretOwnerKind = PROJECT` (the resolve request's `connection_scope: "project" | "organization"`). Scope `organization` needs a slug and, when sent, namespace `organization` (else `LLMOrganizationConnectionSlugRequiredError`, 422 `organization_connection_slug_required`); it resolves in the `organization` namespace. The response gains `custom_provider` (set only for an organization connection, so the SDK can mark a custom-provider route for tracing); the route excludes `None` fields, so a project resolution answers as before.
- NEW `_organization_target(scope, slug)`: `resolver.organization_connection` (one entry read, free from the request memo). A `provider_key` routes like `standard_llm_endpoint(provider_key=<family>)`; a `custom_provider` builds its target with `map_custom_provider_secret_to_endpoint(secret)` (no row written). Both are pinned (`secret_id`, `secret_owner_kind = ORGANIZATION`), carry the row as `resolved_secret` (in process only), and refuse an unserved deployment (`LLMGatewayConnectionNotServedError`). A miss raises NEW `LLMNamedConnectionNotFoundError(scope, slug)`: 404 `connection_not_found` with `details: {scope, slug}` on the control plane, and an OpenAI-shaped 404 `connection_not_found` on the relay.
- `_resolve_target(CUSTOM)` and the project slug path keep today's `fetch_endpoint_by_slug` (one statement); `_standard_connection` keeps today's order and reads project rows only.
- `relay_chat_completion`: uses `target.resolved_secret` when set (an organization target) and makes no second read; otherwise unchanged.
- `_resolve_slug_target(scope, slug)` replaces `_namespace_of_slug` + `_resolve_target` in `resolve_agent_connection` for a bare project slug, in today's order: (1) the project endpoint row (one statement); (2) builtin provider of that name (no read); (3) a provider family (no read); (4) a project `provider_key` row with the slug (one entry read); (5) else `LLMEndpointNotFoundError(custom/<slug>)` as today, then the existing retired starter-credits fallback. It never reaches an organization row, and it reads less than the old two-step code.
- Echo scan: `core/gateways/dtos.py` makes the minimum public (`MIN_SCANNED_CREDENTIAL_LENGTH = 8`) and adds `secret_credential_values(secret: SecretResponseDTO) -> Tuple[bytes, ...]` (the primary value and every non-empty `CREDENTIAL_EXTRAS_KEYS` string value). The passthrough adapter (`providers/passthrough/adapter.py` ~97) scans `injected_credential_values(auth_headers)` PLUS `secret_credential_values(secret.secret)` when `secret.owner.kind == ORGANIZATION`, so every organization value the gateway uses is scanned in the response headers, the non-streaming body and the streamed body (`CredentialEchoRelay`), whatever header carried it. Every such value is at least 8 characters by the create and update rule, so none falls under the scan minimum. Project secrets keep today's scan.
- `list_endpoints` is unchanged (project rows only). Organization connections are listed by `GET /secrets/?include_organization=true`.

### 3.8 Redaction (`oss/src/core/secrets/redaction.py`, MODIFIED)

- `project_secret_response(secret, *, reveal_write_only)` never reveals a value when `secret.owner.kind == ORGANIZATION`, whatever `reveal_write_only` says. It also leaves `value_status.preview` empty for organization rows (no partial value; the design board's question G3 is open, see technical design section 12).
- NEW `organization_connection_response(secret) -> PublicSecretResponseDTO`: an organization row as a member of a project it is available to sees it: owner, kind, slug, header, provider family, the non-credential `data` fields (for example the base URL and models of a custom provider), `value_status.configured`, no preview. It drops `availability` and `selected_project_ids` (other projects' ids never reach a project member) and every credential field, through the same `CREDENTIAL_FIELDS` / `CREDENTIAL_MAP_FIELDS` tables.
- NEW `organization_secret_response(secret) -> PublicOrganizationSecretResponse`: the public projection without values, plus `availability` and `selected_project_ids`.
- NEW `organization_subscription_for_runtime(secret) -> PublicSecretResponseDTO`: an organization `subscription_provider` row with its login, for the release route of section 4.5 only. Raises `ValueError` for any other row.

### 3.9 SDK connection (`sdks/python/agenta/sdk/agents/connections/models.py`, `platform/connections.py`, `wire_models.py`, MODIFIED)

- `Connection.scope: Optional["project" | "organization"]` (omitted means project). `ConnectionNamespace` gains `"organization"`. Scope `organization` needs mode `agenta` and a slug; the model fills namespace `organization` when it is omitted and refuses another namespace. Namespace `organization` needs scope `organization`.
- Fail closed across versions: a services image older than M5 has no `organization` namespace in its `Literal`, so it refuses the saved connection instead of reading the slug as a project connection. The runner holds no provider key in gateway mode, so its version does not matter.
- `VaultConnectionResolver.resolve` sends `connection_scope` with `connection_slug` and `connection_namespace`. When the gateway does not serve the run (`llm_gateway_disabled`), an organization connection raises `OrganizationConnectionUnavailableError` (`organization_connection_unavailable`, 422) and the vault is not read. The plaintext path `_resolve_from_secrets` and `EnvConnectionResolver` refuse an organization connection the same way.
- An organization subscription login (`{"mode": "self_managed", "scope": "organization", "slug": ...}`) is read from `GET /secrets/organization-subscriptions/{slug}`, never from `GET /secrets/`. `ResolvedSubscription.owner` is `organization`, and `ResolvedConnection.to_wire()` puts it under `organizationSubscription`, never `subscription`. An organization Claude login raises `OrganizationSubscriptionNotSupportedError` (`organization_subscription_not_supported`, 422).
- `WireConnection.scope` (omitted for the project) and `HarnessAgentTemplate.wire_connection_ref` carry it to the runner; routing does not depend on it, because the resolved route already points at the `organization` namespace. `custom_connection` comes from the resolution's `custom_provider` for an organization route.

---

## 4. API surface

### 4.1 NEW `OrganizationSecretsRouter` (`oss/src/apis/fastapi/organization_secrets/{__init__,router,models}.py`), mounted at the root with `tags=["Organization Secrets"]`

Every route calls `decide_organization(access=get_request_access(), organization_id=UUID(request.state.organization_id), action=MANAGE_ORGANIZATION_SECRETS)` first and answers 403 on a denial. The organization is the request's organization (from the session's selected project or workspace parameter); every DAO statement filters by it. The router uses `SecretSafeRoute` (validation errors never echo the body).

| Method | Path | `operation_id` | Body | Response |
| --- | --- | --- | --- | --- |
| POST | `/organization-secrets/` | `create_organization_secret` | `OrganizationSecretCreateRequest` | `PublicOrganizationSecretResponse`, 200 |
| GET | `/organization-secrets/` | `list_organization_secrets` | none | `PublicOrganizationSecretsResponse {count, secrets}` |
| GET | `/organization-secrets/{secret_id}` | `fetch_organization_secret` | none | `PublicOrganizationSecretResponse` |
| PUT | `/organization-secrets/{secret_id}` | `edit_organization_secret` | `OrganizationSecretEditRequest` (keeps the value when omitted) | `PublicOrganizationSecretResponse` |
| DELETE | `/organization-secrets/{secret_id}` | `delete_organization_secret` | none | 204 |
| PUT | `/organization-secrets/{secret_id}/projects` | `set_organization_secret_projects` | `OrganizationSecretProjectsRequest {availability, project_ids}` | `PublicOrganizationSecretResponse` |
| PUT | `/organization-secrets/{secret_id}/subscription-token` | `set_organization_subscription_token` | the project route's token body | `PublicOrganizationSecretResponse` |
| POST | `/organization-secrets/{secret_id}/login-attempts` | `start_organization_subscription_login` | none | `SubscriptionLoginAttemptResponse` |
| GET | `/organization-secrets/{secret_id}/login-attempts/{attempt_id}` | `read_organization_subscription_login` | none | `SubscriptionLoginAttemptResponse` |
| POST | `/organization-secrets/{secret_id}/login-attempts/{attempt_id}/cancel` | `cancel_organization_subscription_login` | none | `SubscriptionLoginAttemptResponse` |

- `OrganizationSecretCreateRequest` = `CreateSecretDTO` without `management` (`extra="forbid"`). An optional `slug` is accepted (OpenSpec scenario "duplicate organization slug"); without one the server derives `<name>-<12 hex>` as for projects. `availability` and `project_ids` are optional on create (default all projects) and go through the same limit checks as the projects route.
- `OrganizationSecretEditRequest` = `UpdateSecretDTO` (header and secret; the same keep-on-omit merge under the row lock).
- `PublicOrganizationSecretResponse` = public projection, no value, `owner`, `availability`, `selected_project_ids`.
- Every organization route addresses shareable organization rows only: list, fetch, edit, delete and the projects route filter `kind IN ORGANIZATION_SECRET_KINDS`, so an EE SSO id answers 404 and its row is unchanged on all six routes. SSO keeps its own service in `ee/src/core/organizations/service.py`.

### 4.2 `VaultRouter` (`oss/src/apis/fastapi/vault/router.py`, MODIFIED)

| Route | Change |
| --- | --- |
| `GET /secrets/` | NEW query parameter `include_organization: bool = False`. With `true` and no `secret-resolve` grant, the response adds the organization rows available to the project after the project rows, without values. With the grant, the parameter is ignored and the response is today's project rows (logged at info `[secrets] include_organization ignored for a resolve grant`). Without the parameter, today's response, plus the additive `owner` field. Same `VIEW_SECRET` check. |
| `GET /secrets/{id_or_slug}` | Project rows only (unchanged lookup). An organization id or slug answers 404. |
| `POST /secrets/` | Project row, unchanged. A project row may use an organization row's slug. |
| `PUT /secrets/{id}` | Project row, unchanged. An organization id answers 404. |
| `DELETE /secrets/{id}` | Project row. An organization id answers 204, as an unknown id does today, and the row stays. |
| `GET /secrets/organization-subscriptions/{slug}` | NEW, not in the OpenAPI schema. Section 4.5. |
| `POST /secrets/{id}/subscription-login`, `.../failure` | NEW query parameter `scope: "project" \| "organization" = "project"`. With `organization`, the row is the organization's and must be available to the run's project; otherwise 404. |
| `POST /secrets/subscription-login/attempts/{attempt_id}/outcome` | The body names exactly one of `project_id` and `organization_id` (422 otherwise). |
| Other subscription routes | Unchanged. |

The response model of `GET /secrets/` stays `List[PublicSecretResponseDTO]`; `owner.kind` tells the scope. The Fern client is regenerated from an EE spec served over HTTP.

### 4.3 `ProvidersRouter` (`oss/src/apis/fastapi/providers/router.py`, MODIFIED)

`POST /providers/probe` gains `secret_scope: "project" | "organization"`. With `organization`, it tests the organization row available to the project (`get_connection_secret_by_id`), never a project row; the check is `VIEW_SECRET`, so any member may test the connection as saved. A probe that also changes a stored field (key, URL, version, extras, kind) needs `decide_organization` (403 otherwise). The value goes from the API to the provider only; the answer carries no value.

### 4.4 Agent commit check (`oss/src/core/workflows/service.py`, MODIFIED)

`_reject_unrunnable_agent_connection(data)` runs where the instructions check runs (every revision commit and the simple workflow writes). It refuses with 422 `invalid_agent_connection` (`details.reason`): an organization connection without scope `organization`, namespace `organization` and a slug (`organization_connection_incomplete`); and, with `AGENTA_RUNNER_REQUIRE_NAMED_SELF_MANAGED_CONNECTION=true` (the cloud), a `self_managed` connection without a slug (`self_managed_without_slug`). The template compiler writes `{"mode": "agenta", "scope": "project"}` when the base revision names no connection.

### 4.5 Organization subscription logins (2026-10-26)

- Create and sign-in: `/organization-secrets/` with kind `subscription_provider`, then the `login-attempts` or `subscription-token` routes of section 4.1, all behind the organization decision. The default name is "ChatGPT (Organization)" or "Claude (Organization)"; the slug is the provider id; availability starts at all projects.
- Release: `GET /secrets/organization-subscriptions/{slug}` answers the row with its login only to the `secret-resolve` grant (403 otherwise) with `VIEW_SECRET`, and only when the row is an organization `subscription_provider` available to the run's project (404 otherwise). It logs the project and secret ids only.
- Runner (`services/runner/src/engines/sandbox_agent/run-plan.ts`): the request field `organizationSubscription` is used only when `sandboxId === "inprocess"`, the harness is Pi with a ChatGPT login, the credential mode is `runtime_provided`, and the run carries no project `subscription`. Otherwise the plan build refuses with `ORGANIZATION_SUBSCRIPTION_ENGINE_MESSAGE`. A runner older than M5 ignores the field.
- Upkeep: the publisher appends `?scope=organization` to the push and failure URLs; device login attempts carry `organizationId` (start body: exactly one of `projectId` and `organizationId`) and report `organization_id`.

---

## 5. Error codes

Bodies keep the vault router's existing shape (`{"detail": <message>}` through `HTTPException`), so existing clients read them the same way. Messages are server text for API users; the UI copy is the design board's.

| Case | HTTP | `detail` |
| --- | --- | --- |
| Organization decision denied (any reason) | 403 | "Only owners and admins of the organization, signed in to the app, can manage organization credentials." |
| Not a shareable kind, or a non-LLM provider family | 422 | "This kind of credential cannot be shared with projects." |
| Organization credential value shorter than 8 characters | 422 | "This credential is too short to be shared. Use a value of at least 8 characters." |
| Gateway does not serve the deployment (Bedrock, SageMaker) | 422 | "The LLM gateway does not serve this deployment, so it cannot be shared with projects." |
| Duplicate organization slug | 409 | today's `SecretSlugConflict` message |
| Named organization connection missing or not available (resolve, relay) | 404 | `connection_not_found` envelope with `details: {scope, slug}` |
| Organization scope without a slug, or with another namespace (resolve) | 422 | `organization_connection_slug_required` envelope |
| Agent saved with an incomplete organization connection, or `self_managed` without a slug on the cloud | 422 | `invalid_agent_connection` envelope with `details.reason` |
| Organization Claude login named by an agent (SDK) | 422 | `organization_subscription_not_supported` |
| Organization subscription login on the `daytona` or `local` engine (runner) | run error | `ORGANIZATION_SUBSCRIPTION_ENGINE_MESSAGE` |
| Limit not allowed (OSS, or EE without RBAC) | 403 | "Limiting a credential to selected projects is not available for this organization." |
| Foreign or unknown project in a limit | 422 | "Every project must belong to this organization." |
| Unknown organization credential id | 404 | "Secret not found" (today's text) |

---

## 6. Caches

| Namespace | Key | Value | TTL | Written | Invalidated |
| --- | --- | --- | --- | --- | --- |
| `effective_secrets` (NEW) | `project_id` slot = project id; `key = {"p": "<full project uuid>"}` | `CachedEffectiveSecrets` (validated: `project_id` must equal the requested id) | `AGENTA_CACHE_TTL` | on a miss, through today's `get_cache` lock path, by ONE `load_effective` statement | every project write (`invalidate_cache(project_id=...)`, all namespaces of the project, old pods included); every organization-credential write and availability change (exact `DEL` of each project key of the organization, after the commit) |
| `list_secrets` (existing) | project slot, key `{}` | `List[SecretResponseDTO]` | | old pods only during the rollout | as today; expires by TTL after the rollout |

- No cache stores an access decision. The organization decision reads the organization member row on every management request.
- Staleness bound, wording for docs and PR text: an organization credential change takes effect at the next gateway call; it can take up to `AGENTA_CACHE_TTL` (300 s) when the Redis invalidation fails or when a read that started before the write committed refills the old entry. Issued gateway credentials carry no provider key, so a deleted or limited-away credential stops at the next relay call under the same bound.
- Values: like the project list today, the entry holds decrypted values in Redis, which is inside the API's trust boundary. M5 does not change this posture (technical design section 5, P9).
- Logs: the cache helpers log exceptions with `log.warn(e)`; every cached model sets `hide_input_in_errors=True`, so a malformed entry's `ValidationError` names fields, never values. A sentinel test covers it (technical design section 5, P8).
- Existing behavior, not changed by M5: `_pack` keeps only the last 12 characters of `project_id` and `user_id` for EVERY namespace, so two projects (or users) with the same suffix share today's entries (`list_secrets`, membership and auth caches). M5's own entry avoids it with the full id in the key and an identity check.

## 7. Web contract (the design is approved; the UI is built separately)

- `/m` organization settings: the Organization tab of AI providers on `/organization-secrets/`, with "Projects that can use it" (`PUT .../projects`, "All projects" by default). Owners and admins edit; other members read the connections their project may use (`GET /secrets/?include_organization=true`) and may test one as saved (`POST /providers/probe` with `secret_scope = organization`).
- `/m` connection picker: organization connections their project may use, saved as `{"mode": "agenta", "scope": "organization", "namespace": "organization", "slug": ...}`. Every save path writes the picked or default connection explicitly (already in this change: `explicitAgentConnection`, `withExplicitAgentConnection`).
- No key preview on organization connections, for anyone.
- A connection an agent names that does not exist where it runs answers `connection_not_found` with the scope and slug; the "needs configuration" state is designed separately.

## Implementation notes (backend build)

These points were settled while the backend was built. They extend the sections above.

- `secret_projects` carries the six lifecycle columns of the table convention (`created_at`, `updated_at`, `deleted_at`, `created_by_id`, `updated_by_id`, `deleted_by_id`). Only `created_at` and `created_by_id` are written.
- `load_effective` skips rows whose `kind` is NULL and returns rows oldest first (`created_at`, then `id`), so the provider tie rule picks the oldest matching row.
- Organization writes invalidate each project entry with one batched `DEL` (`utils/caching.py::invalidate_cache_entries`, no `SCAN`).
- The audit event `organization_secrets.changed` is published on the organization's default project, because the event store is keyed by project. The project list read for invalidation provides it, so no statement is added.
- Organization credential values that the gateway puts in a header (the primary `key` and every credential extras value except the `vertex_ai_credentials` document) are stripped of surrounding whitespace, must be at least 8 characters long, and may hold only printable ASCII characters that JSON encoders do not escape. A value with a quote, a backslash, `<`, `>`, `&`, a space or a non-ASCII character is refused with 422 ("This credential holds characters that cannot be shared. Use letters, digits and common symbols only."). A non-text extras value is refused too.
- The relay scans every organization value in its raw spelling and in the spellings JSON encoders produce (quotes and backslashes escaped, `\uXXXX` for non-ASCII, Go's escapes of `<`, `>`, `&`, U+2028 and U+2029, the .NET `System.Text.Json` escapes of `"`, `'`, `+`, `` ` ``, `<`, `>` and `&` in upper-case and lower-case hex, and `\/`). An upstream that escapes plain ASCII characters on purpose is not detected by any substring scan; project secrets have the same limit.
- A non-streaming echo refusal reaches the caller as the existing generic upstream failure (424, `upstream_error`). The value never reaches the caller.
- `DELETE /secrets/{id}` keeps today's answer: an id that is not a row of the project, an organization credential's id included, answers 204 and changes nothing. The answer does not tell a project caller that an organization row exists. Only the organization routes delete organization rows.
- `GET /secrets/?include_organization=true` returns the organization rows (`PublicSecretResponseDTO` with `owner.kind = organization`) after the project rows.
- `PUT /organization-secrets/{id}/projects` answers 404 for an id that is not a shareable credential of the organization, before it checks whether the organization may limit credentials (403).
- Every `organization_secrets.changed` event carries `kind`, `availability` and `project_count`, the delete event included (read by the delete statement). The event is published even when the cache invalidation fails; it is skipped, with a warning log, only when the organization's project list cannot be read or the organization has no project.
