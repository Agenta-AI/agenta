# M2 `run-principal`: interfaces

Status: proposed, round 3 (after the Codex review of the M1 and M2 plans, 2026-10-22). Code read at `42ffe80bfe`. Paths are relative to `api/` unless they start with `services/` or `sdks/`.

This file follows CONTRACT.md v3 and the owner decisions of 2026-10-22: channel turns keep today's authority, M2 ships in one deploy, and edits keep the stored principal (the edit rule is M7). Section 8 lists the contract changes this file needs.

M2 depends on M1: `AccessService`, `Action`, `Decision`, `DecisionReason`, `MembershipsService.resolve`, `ProjectMembership`, `RbacEnforcementInterface`, `get_access_service()`, `entrypoints/access.py::bootstrap_access`, and `AccessError` in `core/access/types.py`.

## 1. Data

Two `core_oss` revisions in the same release, with the program's fixed ids (M1 `044`/`045`, M2 `046`/`047`): `oss000000046_add_run_principal_columns.py` (`down_revision = "oss000000045"`), a short schema expansion that commits before any data change, and `oss000000047_backfill_run_principal.py` (`down_revision = "oss000000046"`), the backfill. A backfill in the same transaction as the `ALTER TABLE`s would hold their locks until it commits and could block old pods on the session tables. Nothing goes in `core_ee`.

### 1.1 Columns (all nullable, no default, no FK, no check constraint)

| Table | Column | Type | Meaning |
| --- | --- | --- | --- |
| `session_turns` | `principal_kind`, `principal_id` | `VARCHAR`, `UUID` | `human` (users.id), `api_key` (api_keys.id), `installation` (channel_agents.id) |
| | `sender_user_id`, `sender_external_key` | `UUID`, `VARCHAR` | the human sender or the linked channel user; the channel sender key (attribution only) |
| | `origin`, `origin_id`, `parent_run_id` | `VARCHAR` | `RunContext` values |
| | `approved_by` | `JSONB` | `RunApproval` JSON, set only on a resumed turn |
| `session_inputs`, `session_interactions` | `run_envelope` | `JSONB` | `RunEnvelope` JSON (section 2.3) |
| `session_commands` | `run_envelope` | `JSONB` | set for `continue_input` and `continue_interaction` |
| `trigger_schedules`, `trigger_subscriptions` | `principal_kind`, `principal_id` | `VARCHAR`, `UUID` | the executing principal |
| | `artifact_id` | `UUID` | the target workflow artifact for direct references. `NULL` for environment references (resolved at each dispatch). Never cascades |
| `evaluation_runs` | `principal_kind`, `principal_id` | `VARCHAR`, `UUID` | the principal the run executes as |

Kinds and origins are validated by the DTO enums, so M6 adds `service_account` without a schema change.

Indexes, `CONCURRENTLY` inside `op.get_context().autocommit_block()`, `IF NOT EXISTS` with the validity check of `oss000000040`: `ix_trigger_schedules_project_id_artifact_id`, `ix_trigger_subscriptions_project_id_artifact_id`.

### 1.2 `upgrade()` steps

`oss000000046` (schema expansion):

1. `SET LOCAL lock_timeout = '5s'`, then `add_column` for every column in 1.1.
2. In `op.get_context().autocommit_block()`: create the two indexes.

`downgrade()` drops the indexes and the columns.

`oss000000047` (backfill). Every statement runs in `autocommit_block()` as its own transaction with `SET lock_timeout = '5s'` and `SET statement_timeout = '60s'`, in batches of 1,000 rows by primary key, and touches only rows whose value changes. A lock timeout fails the hook; re-running the deploy resumes the revision. `downgrade()` is a no-op.

1. Legacy principal backfill. This is the only place where M2 builds `human(created_by_id)`, and it copies `created_by_id` as it is, even when that id has no `users` row (it is the identity the row runs with today):
   ```sql
   UPDATE trigger_schedules     SET principal_kind='human', principal_id=created_by_id WHERE principal_id IS NULL AND created_by_id IS NOT NULL AND id IN (<batch>);
   UPDATE trigger_subscriptions SET principal_kind='human', principal_id=created_by_id WHERE principal_id IS NULL AND created_by_id IS NOT NULL AND id IN (<batch>);
   UPDATE evaluation_runs       SET principal_kind='human', principal_id=created_by_id WHERE principal_id IS NULL AND created_by_id IS NOT NULL AND id IN (<batch>);
   ```
2. Pause triggers that still have no principal. `flags` is JSONB and `meta` is JSON, and both can be SQL `NULL`:
   ```sql
   SET flags = COALESCE(flags, '{}'::jsonb) || '{"is_active": false}'::jsonb,
       meta  = (COALESCE(meta::jsonb, '{}'::jsonb) || '{"paused_reason": "missing_principal"}'::jsonb)::json
   WHERE principal_id IS NULL AND deleted_at IS NULL
     AND (COALESCE((flags->>'is_active')::boolean, true)
          OR (meta::jsonb->>'paused_reason') IS DISTINCT FROM 'missing_principal')
   ```
   A second run changes 0 rows. Print the count and the ids to the hook log.
3. Backfill `artifact_id` where it is `NULL`, from `(data::jsonb)->'references'`. If the references contain any `environment` or `environment_*` key, the row stays `NULL` and active: an environment reference takes precedence over every direct reference. Else the first match, for each prefix in `application`, `evaluator`, `workflow`: `{prefix}.id`, `{prefix}.slug`, `{prefix}_variant.id`, `{prefix}_variant.slug`, `{prefix}_revision.id`. Every lookup, ids included, is scoped by the row's `project_id`; an id of another project matches nothing. Print the count.

The revision docstring holds the read-only count queries to run on a database copy before the deploy (technical design section 4).

**Migration gate: passes** for both. Only nullable `add_column`, guarded `UPDATE` and concurrent indexes. Run `uv run api/scripts/migration_gate.py <revision.py>`. No label. The gate does not prove lock safety; measure the backfill on a copy.

### 1.3 Mixed versions during the single rollout

The Helm hook migrates before new pods start. Old pods run on the new schema for a few minutes.

| Writer, then reader | Result |
| --- | --- |
| Old pod creates a trigger (no principal), new dispatcher reads it | Paused with `missing_principal` and a failed delivery. The user creates it again. |
| Old pod creates an evaluation run (no principal), new worker reads it | Failed with `missing_principal`. An explicit start sets the principal (section 3.7). |
| Old pod writes an input, command or interaction (no envelope), new consumer reads it | Cancelled with `missing_envelope`. The user resends. |
| Old pod mints a Secret (no `principal` claim), new pod verifies it | 401 `missing_principal`. The run fails once. |
| Old pod caches a Bearer or ApiKey state (no `principal`), new pod reads it | Cache miss; the new pod rebuilds the state. |
| Old pod changes a membership, new pod holds a `resolve_membership` entry | Cleared. M1's `invalidate_access_caches` already clears `resolve_membership`, so old pods invalidate it too. |
| New pod mints a Secret, old pod verifies it | Accepted; PyJWT ignores the new claims. |
| New pod writes columns, old pod reads them | Ignored. Old models do not select the new columns. |
| App rollback | Safe. Columns stay; old code ignores them. |

The dispatchers never rebuild a principal from `created_by_id`. The migration backfill (step 2) is bounded to rows that exist at migration time.

## 2. Core types

### 2.1 `oss/src/core/access/dtos.py` (M1 file, MODIFIED)

Pydantic, `model_config = ConfigDict(frozen=True, extra="forbid")`. `extra="forbid"` makes an older pod refuse a claim or a stored envelope with an unknown key, so it fails closed when a later change adds a field.

```python
class PrincipalKind(str, Enum):
    HUMAN = "human"
    API_KEY = "api_key"
    INSTALLATION = "installation"            # M6 adds SERVICE_ACCOUNT

class PrincipalRef(BaseModel):
    kind: PrincipalKind
    id: UUID                                 # users.id | api_keys.id | channel_agents.id

class AgentRef(BaseModel):
    id: UUID                                 # workflow artifact id

class RunRestrictions(BaseModel):
    agent: Optional[AgentRef] = None         # unsupported in M2: decide denies any non-null value (section 3.2)
                                             # M6 adds `doors`

class RunAuthority(BaseModel):
    principal: PrincipalRef
    organization_id: UUID
    project_id: UUID
    restrictions: RunRestrictions = RunRestrictions()
    linked_user_id: Optional[UUID] = None    # installation only: the user whose role the run uses
                                             # (linked channel user). None: the binding creator. Must be None for other kinds.

class RunOrigin(str, Enum):
    WEB = "web"
    API = "api"
    INSTALLATION = "installation"
    SCHEDULE = "schedule"
    SUBSCRIPTION = "subscription"
    EVALUATION = "evaluation"
    CHILD = "child"

class RunContext(BaseModel):
    run_id: Optional[str] = None             # runner turn id (meta.run_id); None for web, direct-API and batch runs
    parent_run_id: Optional[str] = None
    origin: RunOrigin
    origin_id: Optional[str] = None          # api: key id; installation: binding id; schedule/subscription: trigger id;
                                             # evaluation: evaluation run id; web, child: None

class RunSender(BaseModel):
    user_id: Optional[UUID] = None
    external_key: Optional[str] = None       # validator: at least one field is set

class RunApproval(BaseModel):
    principal: PrincipalRef                  # the approving principal (human, api_key or installation)
    user_id: Optional[UUID] = None           # acting user of the approver
    external_key: Optional[str] = None       # channel answer only

class RunEnvelope(BaseModel):                # one shape for token claims and run_envelope jsonb
    authority: RunAuthority
    context: RunContext
    sender: Optional[RunSender] = None
    approved_by: Optional[RunApproval] = None

class RequestCredentialKind(str, Enum):
    BEARER_SESSION = "bearer_session"
    API_KEY = "api_key"
    RUN_CREDENTIAL = "run_credential"

class ResourceKind(str, Enum):
    AGENT = "agent"
    SESSION = "session"

class ResourceRef(BaseModel):
    kind: ResourceKind
    id: str                                  # agent: artifact id; session: session id. M3 adds the policy.

class PrincipalRecord(BaseModel):
    principal: PrincipalRef
    project_id: Optional[UUID] = None        # None for human
    acting_user_id: Optional[UUID] = None    # human: itself; api_key: created_by_id; installation: channel_agents.created_by_id
    is_active: bool
    expires_at: Optional[datetime] = None    # api_key: expiration_date; decide compares it with now on every call

class RequestAccess(BaseModel):
    principal: PrincipalRef
    authority: RunAuthority
    credential_kind: RequestCredentialKind
    acting_user_id: UUID                     # == request.state.user_id
    envelope: Optional[RunEnvelope] = None   # run_credential only
```

Every `Optional` field of a model that is cached or put in a token has an explicit `= None` default. `oss/src/utils/caching._serialize` drops `None` fields (`exclude_none=True`), so a required `Optional` field fails validation on read, and `get_cache` returns a miss on every request.

`DecisionReason` gains `PRINCIPAL_INACTIVE = "principal_inactive"` and `RESTRICTED_BY_AUTHORITY = "restricted_by_authority"`. `RESOURCE_DENIED` is M3.

### 2.2 `oss/src/core/access/types.py` (M1 file, MODIFIED): exceptions

All derive from M1's `AccessError`.

```python
class DecisionInputMissing(AccessError): ...      # decide() got neither project_id nor authority
class RequestAccessMissing(AccessError): ...      # check_action_access() with no request access
class RequestAccessMismatch(AccessError): ...     # check_action_access(user_uid) != request acting user
class AccessDenied(AccessError):
    def __init__(self, *, decision: Decision): self.decision = decision
class MissingEnvelope(AccessError): ...           # durable row without run_envelope (code missing_envelope)
class MissingPrincipal(AccessError): ...          # trigger or evaluation run without principal (code missing_principal)
class InvalidRunClaims(AccessError): ...          # claim shape or value not valid
```

### 2.3 `oss/src/core/access/principals.py` (NEW): pure helpers, no I/O

```python
def envelope_to_claims(*, envelope: RunEnvelope) -> dict: ...
def envelope_from_claims(*, claims: dict) -> Optional[RunEnvelope]: ...  # None when "principal" is absent; raises InvalidRunClaims
def envelope_to_json(*, envelope: RunEnvelope) -> dict: ...              # claims shape plus "v": 1
def envelope_from_json(*, data: Optional[dict]) -> Optional[RunEnvelope]: ...
def child_envelope(*, parent: RunEnvelope) -> RunEnvelope: ...
    # same authority and sender; RunContext(run_id=None, parent_run_id=parent.context.run_id, origin=CHILD)
def resumed_envelope(*, asked: RunEnvelope, run_id: Optional[str], approved_by: RunApproval) -> RunEnvelope: ...
def stored_work_envelope(*, principal: PrincipalRef, organization_id: UUID, project_id: UUID,
                         origin: RunOrigin, origin_id: str, created_by_id: Optional[UUID]) -> RunEnvelope: ...
    # triggers and evaluation runs; linked_user_id=created_by_id only for an installation principal
```

Claim and jsonb shape:

```json
{
  "principal":    {"kind": "api_key", "id": "<uuid>"},
  "restrictions": {"agent": null},
  "authority":    {"organization_id": "<uuid>", "project_id": "<uuid>", "linked_user_id": null},
  "run":          {"run_id": null, "parent_run_id": null, "origin": "api", "origin_id": "<key id>"},
  "sender":       {"user_id": null, "external_key": null},
  "approved_by":  {"principal": {"kind": "human", "id": "<uuid>"}, "user_id": "<uuid>", "external_key": null}
}
```

In a token, `authority.organization_id` and `authority.project_id` must equal the existing scope claims; a mismatch is `invalid_token`. `sender` and `approved_by` are absent when `None`. The envelope holds identity only, never a secret value.

### 2.4 `oss/src/core/access/context.py` (NEW)

```python
def set_request_access(access: RequestAccess) -> Token: ...
def reset_request_access(token: Token) -> None: ...
def get_request_access() -> Optional[RequestAccess]: ...   # None outside an authenticated request
```

### 2.5 DTO field additions (MODIFIED)

| File | Class | New fields |
| --- | --- | --- |
| `core/sessions/turns/dtos.py` | `SessionTurn` | `principal`, `sender`, `context`, `approved_by` (read model; null for old turns) |
| | `SessionTurnCreate` | `envelope: Optional[RunEnvelope] = None` (server-set; not on `SessionTurnAppendRequest`) |
| `core/sessions/inputs/dtos.py`, `commands/dtos.py`, `interactions/dtos.py` | read and create DTOs | `run_envelope: Optional[RunEnvelope]` |
| `core/triggers/dtos.py` | `TriggerSchedule`, `TriggerSubscription` | `principal: Optional[PrincipalRef]`, `artifact_id: Optional[UUID]` (server-set, not in `*Create`/`*Edit`) |
| `core/evaluations/types.py` | `EvaluationRun` | `principal: Optional[PrincipalRef]` |

API response models expose `principal` and turn attribution read-only. No request body accepts them.

## 3. Core interfaces

### 3.1 `PrincipalsDAOInterface` (`core/access/interfaces.py`, M1 file, MODIFIED)

```python
class PrincipalsDAOInterface(ABC):
    @abstractmethod
    async def fetch_principal(self, *, principal: PrincipalRef) -> Optional[PrincipalRecord]: ...
```

Implementation: `oss/src/dbs/postgres/access/dao.py` (`PrincipalsDAO`) and `oss/src/dbs/postgres/access/mappings.py` (`map_user_dbe_to_principal_record`, `map_api_key_dbe_to_principal_record`, `map_channel_agent_dbe_to_principal_record`). It reads the existing ORM classes; there are no new DBEs.

| Kind | Active when |
| --- | --- |
| `human` | `users` row exists |
| `api_key` | row exists, `created_by_id IS NOT NULL`, and a `users` row with that id exists. `expires_at = expiration_date` (checked by `decide`). `deleted_at` is not read: keys are hard-deleted and today's key lookup ignores it |
| `installation` | `channel_agents` and its `channel_connections` row both exist, are not deleted and have `flags.is_active` |

Cache: `get_cache(namespace="fetch_principal", key={"k": kind, "id": id}, model=_CachedPrincipal)`, TTL `AGENTA_CACHE_TTL`, where `_CachedPrincipal(record: Optional[PrincipalRecord] = None)` makes absence a hit. Invalidated by `AccessService.invalidate_principal` (section 3.2), a direct delete by key.

Production note: some API keys have a `created_by_id` with no `users` row (users deleted while their keys stayed in another organization's project; `api_keys.created_by_id` has no foreign key). Today every request with such a key fails: `verify_apikey_token` reads `api_key_obj.user.email` on a `None` user and the middleware answers 500, uncached; the Agenta channel adapter refuses the key because its creator has no membership. M2 keeps both outcomes: the middleware path is unchanged up to that line, and `fetch_principal` returns such a key as inactive.

### 3.2 `AccessService` (`core/access/service.py`, M1 file, MODIFIED)

```python
class AccessService:
    def __init__(
        self,
        *,
        memberships: MembershipsService,
        rbac: RbacEnforcementInterface,
        principals: PrincipalsDAOInterface,
    ): ...

    async def decide(
        self,
        *,
        authority: Optional[RunAuthority],
        principal: PrincipalRef,
        action: Action,
        #
        project_id: Optional[UUID] = None,
        resource: Optional[ResourceRef] = None,
    ) -> Decision: ...                       # raises DecisionInputMissing

    async def check_eligibility(
        self,
        *,
        authority: Optional[RunAuthority],
        principal: PrincipalRef,
        project_id: UUID,                    # required: a Bearer exchange has no authority
    ) -> Decision: ...                       # decide steps 1 and 2 only; for credential exchanges with no permission

    async def check_request(
        self,
        *,
        access: RequestAccess,
        action: Action,
        project_id: UUID,                    # required; exchanges pass get_auth_scope().project_id
        #
        resource: Optional[ResourceRef] = None,
    ) -> Decision: ...
    # authority=None for bearer_session (a browser user may check another of their projects), else access.authority

    async def check_human(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
        action: Action,
    ) -> Decision: ...                       # explicit check about a named human, not a run

    async def require(
        self,
        *,
        envelope: RunEnvelope,
        action: Action,
        #
        resource: Optional[ResourceRef] = None,
    ) -> None: ...                           # decide(envelope.authority, envelope.authority.principal); raises AccessDenied

    async def invalidate_principal(self, *, principal: PrincipalRef) -> None: ...
```

M1's `check_capability(user_id, project_id, action)` becomes `check_human`. Its catalog step becomes a private pure function `_capability(*, membership: ProjectMembership, action: Action) -> Decision` (EE no-RBAC, organization owner, project owner, role catalog; no I/O except `rbac.is_enforced`, which has its own entitlement cache).

**`decide` steps.** The first denial wins.

1. **Eligibility.**
   1. `project = project_id or authority.project_id`; neither raises `DecisionInputMissing`.
   2. `record = await principals.fetch_principal(principal)`. Missing, inactive, or `expires_at <= now`: deny `principal_inactive`.
   3. `record.project_id` set and different from `project`: deny `not_member`.
   4. `role_user = authority.linked_user_id` for an installation with that field set, else `record.acting_user_id`.
   5. `membership = await memberships.resolve(user_id=role_user, project_id=project)`. The read goes through the membership cache (below). `None`: deny `not_member`.
2. **Restrictions** (when `authority` is given). Deny `restricted_by_authority` when `authority.principal != principal`, `authority.project_id != project`, or `restrictions.agent` is not `None`. M2 supports no agent restriction and never sets it; refusing every non-null value means a later writer cannot fail open on M2 pods, including at boundaries that pass no resource (child runs). The milestone that adds restrictions replaces this rule and passes the resolved target at every execution boundary.
3. **Capability.** `_capability(membership, action)`: allowed with M1's reason, or `missing_capability`. Not cached: it is computed on every call from the membership of step 1.5.
4. **Resource policy:** M3.

The tenant comes only from `project` and the principal record.

**Membership cache.** M2 modifies M1's `MembershipsService.resolve` (`core/memberships/service.py`) to read through Redis, so a decision costs Redis reads and no Postgres read on a warm cache. The cache stores a membership and the absence of a membership. Today `check_action_access` caches `False`, so repeated denied requests read only Redis; the membership cache keeps that cost.

```python
class CachedMembership(BaseModel):  # core/memberships/dtos.py (NEW): the cache entry, never returned
    membership: Optional[ProjectMembership] = None  # None = "membership absent"

async def resolve(self, *, user_id: UUID, project_id: UUID) -> Optional[ProjectMembership]:
    cached = await get_cache(
        namespace="resolve_membership",
        project_id=str(project_id),
        user_id=str(user_id),
        key="membership",
        model=CachedMembership,
    )
    if cached is not None:  # a hit, present or absent
        return cached.membership
    membership = ...  # M1's resolver body, unchanged
    await set_cache(
        namespace="resolve_membership",
        project_id=str(project_id),
        user_id=str(user_id),
        key="membership",
        value=CachedMembership(membership=membership),
    )  # ttl AGENTA_CACHE_TTL (default); written for a member and for a non-member
    return membership
```

- Key: one entry per (user, project), with the fixed `key="membership"`; `get_cache`, `set_cache` and `invalidate_cache` from `oss/src/utils/caching.py`. TTL `AGENTA_CACHE_TTL`. With a key, a per-(user, project) invalidation is one Redis `DELETE`; without one, `invalidate_cache` runs a keyspace `SCAN`. M2 changes the `resolve_membership` call in M1's `invalidate_access_caches` to pass the same key.
- Fan-out: a project-wide invalidation (all members of a project) is one pattern call per namespace per project, never one call per member. A loop over many users runs in pages of 500. An organization can have tens of thousands of members.
- Absence is cached as `CachedMembership(membership=None)`. A bare `None` cannot be the cached value: `get_cache` returns `None` for a miss and for a stored null, so a stored null would read as a miss. The wrapper makes a stored absence a hit. A warm denial reads Redis and no Postgres row.
- The absent entry uses the same key, TTL and invalidation as a present entry. A mutation that adds a member clears the absent entry, so the next decision reads Postgres and sees the new membership.
- `is_member` becomes `return await self.resolve(user_id=user_id, project_id=project_id) is not None`, so the Bearer `?project_id=` check uses the same cache. `list_for_user` is not cached.
- Invalidation: M1's `invalidate_access_caches` clears `resolve_membership` for each changed user in every project of the organization after every M1 membership mutation (M1 interfaces section 6). It is the only invalidation path. M2 adds no other writer of membership rows.

**Caches and invalidation.** M2 removes the two authorization caches that could return an allow without a fresh decision:

| Namespace | M2 change | Invalidated by |
| --- | --- | --- |
| `check_action_access` | Deleted. M1's invalidation calls for it are deleted. | none |
| `check_permissions` (exchange) | Deleted. | none |
| `fetch_principal` | NEW | `api_key_service.delete_api_key` and `AccountsService.delete_api_key` (admin); `ChannelsService.archive_connection`, `unarchive_connection`, `deactivate_connection`, `delete_agent`, `edit_agent`, and `edit_connection` / `install_connection` when they change `flags.is_active` or replace the installation (each affected binding, ids read before the write); user deletion (`AccountsService.delete_user`, `user_service.delete_user`): the user, their keys and the bindings they created, read before the delete, plus `invalidate_access_caches` for the user's projects |
| `resolve_membership` | NEW. `CachedMembership` per (user, project): a membership or its absence; no decision. | M1 membership mutations, through `invalidate_access_caches` |
| `verify_bearer_token` | Unchanged name. The cached state gains `principal`; a state without it is a miss. | M1 membership mutations (unchanged) |
| `verify_apikey_token` | Unchanged name. The cached state gains `api_key_id` and `principal`; a state without them is a miss. | Not invalidatable (keyed by the raw token). `decide` and `check_eligibility` deny a deleted key through `fetch_principal`. |

`decide` runs on every call. Membership removal, role change and a new membership take effect on the next decision, because the mutation clears the membership entry before the writer returns. Known limit: a read that started before the mutation committed can refill the old entry after the invalidation; that entry lives at most `AGENTA_CACHE_TTL` (technical design section 8). Do not add a cache that stores the decision.

### 3.3 Wrapper: `core/access/permissions/service.py::check_action_access` (MODIFIED, signature unchanged)

```python
async def check_action_access(
    user_uid: str,
    project_id: Optional[str] = None,
    permission: Optional[Permission] = None,
    role: Optional[Union[RequiredRole, str]] = None,
) -> bool:
    access = get_request_access()
    if access is None:
        raise RequestAccessMissing()
    if str(access.acting_user_id) != user_uid:
        raise RequestAccessMismatch()
    decision = await get_access_service().check_request(
        access=access,
        action=_action(permission=permission, role=role),
        project_id=_uuid(project_id),
    )
    return decision.allowed
```

There is no fallback to `human(user_uid)`. A caller that checks another human, or runs without request access, calls `check_human` explicitly. Known direct callers that change: `entrypoints/channel_adapters.py` (uses `decide(principal=api_key(key.id))`); `apis/fastapi/sessions/router.py` live stream recheck (captures `access` at handler entry and calls `check_request(access=..., project_id=...)` every recheck, so it does not depend on the ContextVar during streaming); `apis/fastapi/gateways/mcps/router.py::connect_callback`, which is exempt from the auth middleware and checks the stored attempt's user (`check_human(user_id=attempt.user_id, project_id=attempt.project_id, action=<today's permission>)` after its session and attempt checks). `GatewayPolicyService.authorize` runs inside the gateway request and keeps the wrapper.

### 3.4 Invoke prelude: `core/workflows/service.py` (MODIFIED)

```python
async def _prepare_invoke(self, *, project_id: UUID, user_id: UUID,
                          request: WorkflowServiceRequest, envelope: RunEnvelope) -> tuple[str, Optional[str]]: ...
    # context.run_id := request.meta["run_id"] when present; sign_secret_token(..., envelope=envelope)
async def invoke_workflow(self, *, project_id: UUID, user_id: UUID, request: WorkflowServiceRequest,
                          envelope: RunEnvelope, **kwargs) -> WorkflowServiceBatchResponse: ...
async def invoke_workflow_detached(self, *, project_id: UUID, user_id: UUID, request: WorkflowServiceRequest,
                                   envelope: RunEnvelope, run_id: Optional[str] = None,
                                   control_command_id: Optional[UUID] = None, strict_start: bool = False) -> Optional[str]: ...
async def resolve_request_target(self, *, project_id: UUID,
                                 request: WorkflowServiceRequest) -> ResolvedTarget: ...
    # runs the existing _ensure_request_revision and returns ResolvedTarget(artifact_id: UUID, revision_id: UUID);
    # the request then carries that revision, so the invoke runs the checked target
```

`user_id` stays the acting and audit user. `inspect_workflow` has no caller; delete it. `archive_workflow` calls `triggers_dao.pause_triggers_for_artifact(...)`. Every composition-root `dispatch_fn` in `entrypoints/routers.py` and `entrypoints/worker_queues.py` gains `envelope: RunEnvelope`.

### 3.5 Sessions (MODIFIED)

```python
SessionInputsService.admit(self, *, project_id: UUID, user_id: UUID, session_id: str, content, policy,
                           idempotency_key: Optional[str], envelope: RunEnvelope) -> PendingInputAdmission
SessionInputsService.claim_for_execution(self, *, ..., envelope: RunEnvelope) -> ...   # existing keywords + envelope
SessionCommandsService.respond_interaction(self, *, ..., approved_by: RunApproval) -> ...
SessionCommandsService.respond_interactions(self, *, ..., approved_by: RunApproval) -> ...
    # resumed_envelope(asked=interaction.run_envelope, run_id=<continuation id>, approved_by) on the
    # continue_interaction command; asked None -> the interaction is cancelled in its own committed
    # transaction, then MissingEnvelope (409)
SessionInteractionsService.create_interaction(self, *, ..., envelope: RunEnvelope) -> ...
InteractionsDispatcher.respond_many(self, *, project_id: UUID, user_id: UUID, interaction_answers,
                                    envelope: RunEnvelope, control_command_id=None, continuation_execution_id=None) -> ...
InteractionsDispatcher.respond(self, *, ...) -> ...
    # taskiq path: rebuilds the envelope from the interaction row with approved_by from the task user;
    # row without envelope -> MissingEnvelope
SessionStreamsService.heartbeat(self, *, project_id: UUID, request, runner_verified: bool = False,
                                envelope: Optional[RunEnvelope]) -> SessionHeartbeatResult
    # creating a row with envelope None raises SessionCreationRequiresRunCredential (core/sessions/types.py)
SessionStartsService.start_once(self, *, ..., envelope: RunEnvelope) -> ...
SessionTurnsService.append_turn(self, *, project_id: UUID, user_id: UUID, turn: SessionTurnCreate) -> SessionTurn
SessionTurnsService.complete_turn(self, *, project_id: UUID, turn: SessionTurnComplete,
                                  envelope: Optional[RunEnvelope] = None) -> ...
    # writes all eight attribution columns as one group only when the row has principal_kind IS NULL;
    # otherwise keeps every column, including nulls (an API-key turn keeps its null sender)
```

`_promote_next_input` copies `pending_input.run_envelope` onto the `continue_input` command.

Delivery refusals are terminal. `SessionCommandsService._deliver` catches `MissingEnvelope` and `AccessDenied` before its generic `except` (which turns a failure into an `unreachable` transport retry) and calls `_settle_refused_continuation(command, error: AgentError)`: in the command-settlement transaction the command becomes `obsolete` with outcome `failed`, the execution stores the `AgentError` (`set_state(state=terminal, error=...)`, `retryable` false), and the execution is settled with `settle(terminal_outcome="failed", settled_by="access_refusal")`. Without `terminal_outcome`, `SessionInputsDAO.fetch_active_successor` keeps treating the promoted input as active and blocks the next input. `_settle_exhausted_continuation` is not used for this: it marks the execution recoverable with a retryable error.

### 3.6 Triggers (MODIFIED)

```python
# core/triggers/interfaces.py (TriggersDAOInterface)
async def create_schedule(self, *, project_id: UUID, user_id: UUID, schedule: TriggerScheduleCreate,
                          principal: PrincipalRef, artifact_id: Optional[UUID]) -> TriggerSchedule: ...
async def create_subscription(self, *, project_id: UUID, user_id: UUID, subscription: TriggerSubscriptionCreate,
                              trigger_id: UUID, principal: PrincipalRef, artifact_id: Optional[UUID]) -> TriggerSubscription: ...
async def edit_schedule(self, *, ..., artifact_id: Optional[UUID]) -> TriggerSchedule: ...          # principal unchanged
async def edit_subscription(self, *, ..., artifact_id: Optional[UUID]) -> TriggerSubscription: ...  # principal unchanged
async def pause_trigger(self, *, project_id: UUID, schedule_id: Optional[UUID] = None,
                        subscription_id: Optional[UUID] = None, reason: str) -> None: ...
    # flags.is_active=false, meta.paused_reason=reason; no provider sync
async def pause_triggers_for_artifact(self, *, project_id: UUID, artifact_id: UUID, reason: str) -> int: ...
async def refuse_delivery(self, *, project_id: UUID, user_id: Optional[UUID], delivery: TriggerDeliveryCreate,
                          reason: str) -> Optional[TriggerDelivery]: ...
    # one transaction: insert the failed delivery (ON CONFLICT on the existing dedup key DO NOTHING),
    # then pause the schedule or subscription (flags.is_active=false, meta.paused_reason=reason); no session.
    # write_subscription_delivery_if_live cannot do this: it needs is_active=true and refuses schedules.

# core/triggers/service.py
TriggersService.create_schedule(self, *, project_id, user_id, schedule, principal: PrincipalRef) -> TriggerSchedule
TriggersService.create_subscription(self, *, project_id, user_id, subscription, principal: PrincipalRef) -> TriggerSubscription
    # _validate_references returns the artifact id for direct references, None for environment references
```

`TriggerDeliveryData.error` stays `Optional[str]` (the `AgentError.message`), so existing readers keep working; NEW `TriggerDeliveryData.error_details: Optional[AgentError] = None` carries the envelope.

`TriggersDispatcher.__init__` gains `access_service: AccessService` and `workflows_service` (for `resolve_request_target`). `_run` order: technical design flow F6.

### 3.7 Evaluations (MODIFIED)

```python
# core/evaluations/interfaces.py (EvaluationsDAOInterface)
async def create_run(self, *, ..., principal: PrincipalRef) -> EvaluationRun: ...
async def create_runs(self, *, ..., principal: PrincipalRef) -> List[EvaluationRun]: ...
async def set_run_principal(self, *, project_id: UUID, run_id: UUID, principal: PrincipalRef) -> None: ...
```

The principal changes only on an explicit new start or rerun:

| Route (operation id) | Principal |
| --- | --- |
| `POST /evaluations/runs/` (`create_runs`), `POST /simple/evaluations/` (`create_simple_evaluation`) | set to the caller |
| `POST /simple/evaluations/{evaluation_id}/start` (`start_simple_evaluation`) | set to the caller |
| `POST /simple/evaluations/{evaluation_id}/process` (`process_slice`, the rerun through `process_rerun`) | set to the caller |
| `PATCH /simple/evaluations/{evaluation_id}` (`edit_simple_evaluation`, including its internal restart), `PATCH /evaluations/runs/...`, `populate_slice`, `probe`, `prune`, `refresh_slice`, `stop`, `close`, `open`, scenario, step and repeat routes, `POST /evaluations/runs/refresh` (live tick) | unchanged |

`SimpleEvaluationsService.start(..., principal: Optional[PrincipalRef] = None)`: the start route passes the caller; `edit` passes `None`, which keeps the stored principal. `dispatch_run_slice(..., principal: PrincipalRef)` is required. The worker processor (`core/evaluations/tasks/processor.py`) builds `stored_work_envelope(origin=EVALUATION, origin_id=str(run_id))` from the run row, calls `require(envelope, EDIT_EVALUATION_RUNS)` and passes the envelope to `_BoundRunner` and `APIWorkflowRunner._execute_one`. A row with no principal fails with `missing_principal`. Taskiq payloads do not change.

### 3.8 Channels (MODIFIED)

```python
InboxDispatcher._installation_envelope(self, *, resolution: ChannelResolution, organization_id: UUID,
        linked_user_id: Optional[UUID], external_user_key: str, run_id: Optional[str]) -> RunEnvelope
    # principal installation(resolution.agent.id); origin INSTALLATION, origin_id=str(resolution.agent.id);
    # sender RunSender(user_id=linked_user_id, external_key=external_user_key)
ChannelSessionQueue.admit(self, *, ..., envelope: RunEnvelope) -> ...
```

The acting `user_id` passed to invoke stays the linked user, else `resolution.agent.created_by_id` (today's value).

## 4. API surface

No route is added; no path changes; permissions are unchanged.

### 4.1 Auth middleware (`oss/src/middlewares/auth.py`)

| `request.state` field | Bearer | ApiKey | Secret |
| --- | --- | --- | --- |
| `principal` | `human(user_id)` | `api_key(api_key_obj.id)` | the `principal` claim |
| `authority` | `RunAuthority(human, org, project)` | `RunAuthority(api_key, key org, key project)` | from the claims |
| `credential_kind` | `bearer_session` | `api_key` | `run_credential` |
| `run_envelope` | `None` | `None` | the parsed `RunEnvelope` |
| `user_id` | unchanged | unchanged (key creator) | unchanged (claim) |

- A Secret without a `principal` claim: 401 `missing_principal` (section 6). Unknown kind or origin, an extra key, or an authority that differs from the scope claims: 401 `invalid_token` (existing `DecodeError` branch).
- `auth_middleware` calls `set_request_access(...)` after authentication and resets it in `finally`, next to `set_auth_context`.
- `request_run_envelope(request) -> RunEnvelope`: Secret: `request.state.run_envelope`. Bearer: `RunContext(origin=WEB)`, `sender=RunSender(user_id)`. ApiKey: `RunContext(origin=API, origin_id=str(key id))`, no sender. It is the only producer-side envelope source in routers.
- `sign_secret_token(..., envelope: RunEnvelope)`: required keyword. Mints: `auth.py` Bearer mint, the exchange, `_prepare_invoke`, `credentials_router.py`, `mcps/router.py`. `inspect_workflow` is deleted.

### 4.2 Routes whose behavior changes

| Route | Change |
| --- | --- |
| `GET /access/permissions/check` (`check_permissions`) | No cache. Order: parameters, scope, `check_request(access, Permission(action), project_id=get_auth_scope().project_id)`, resource check (unchanged, including the EE `local_secrets` meter adjustment), then mint with `request_run_envelope(request)`. The token is minted only after allowance. A deny returns the existing `Deny` response. |
| `POST /gateways/credentials` (`issue_gateway_credentials`) | `check_eligibility(authority=None for bearer_session else access.authority, principal, project_id=get_auth_scope().project_id)` before the mint. Deny: 403 `access_denied`. Mints with `request_run_envelope(request)`. |
| `POST /gateways/mcps/...` Agenta credential (`issue_agenta_credential`) | Mints with `request_run_envelope(request)`. Its `USE_MCP_ENDPOINTS` check now runs `decide`. |
| `POST /sessions/turns/` (`append_turn`), `POST /sessions/turns/complete` | Attribution from `request_run_envelope(request)`; body fields ignored; complete fills only nulls. |
| `POST /sessions/streams/heartbeat` | Passes `request.state.run_envelope`. A create without a run credential: 403 `session_requires_run_credential`. |
| `GET` live session stream | Recheck every `AGENTA_SESSIONS_LIVE_AUTH_RECHECK_SECONDS` with the captured `RequestAccess`. |
| `POST /sessions/control/inputs/admit`, `POST /sessions/interactions/` | Store `request_run_envelope(request)`. |
| `POST /sessions/interactions/{interaction_id}/respond`, `POST /sessions/{session_id}/continuations/resume` | `approved_by = RunApproval(principal=request.state.principal, user_id=request.state.user_id)`. No envelope: 409 `missing_envelope`. |
| `POST /tools/call` (`_call_workflow_tool`, `handle_test_run`) | Child envelope; `require(child, RUN_WORKFLOWS)`; deny: tool result `AgentError(code="access_denied")`. |
| `POST /triggers/schedules/`, `POST /triggers/subscriptions/` | Store `request.state.principal` and the direct `artifact_id`. `/subscriptions/test` dispatches with `request_run_envelope(request)` and stores nothing. |
| `PUT /triggers/schedules/{id}`, `PUT /triggers/subscriptions/{id}` | Recompute `artifact_id`; principal unchanged. |
| Evaluation routes | Section 3.7 table. |
| `POST /workflows/{id}/archive` (and application and evaluator archive through `archive_workflow`) | Pauses triggers with that `artifact_id` (`agent_deleted`). |

Response models that gain read-only fields: the session turn, trigger schedule, trigger subscription and evaluation run responses. Regenerate the Fern client from an EE spec.

## 5. Runner and SDK surface

No change in `services/runner` or `sdks/python`. Neither reads the new claims; both refresh through `/access/permissions/check`, which copies the envelope. `meta.run_id` already reaches the runner as `turnId`. The wire golden fixtures do not change.

## 6. Errors

New failures that an agent or a client can see use the `AgentError` shape (`core/tools/dtos.py`): `{code, message, retryable, next_step?, details?}`. On HTTP it is the `detail` object. Diagnostic reasons go in `details.reason`. Existing 403 bodies from `check_action_access` routes (`FORBIDDEN_EXCEPTION`) do not change.

| Code | Where | Carrier | `retryable` | `next_step` |
| --- | --- | --- | --- | --- |
| `missing_principal` | Secret without `principal`; trigger or evaluation run without principal | 401; refused delivery (`refuse_delivery`) and `meta.paused_reason`; evaluation failure | false | "Start the run again." / "Create the schedule again." |
| `missing_envelope` | input, command or approval without `run_envelope` | 409 on respond; terminal command settlement | false | "Send the message again." / "Ask for the approval again." |
| `access_denied` | `decide` deny at a new check point: durable work recheck, child run, gateway credential exchange | failed delivery, failed command, evaluation failure, channel reply, tool result, 403 | false | "Ask a project admin for access." |
| `session_requires_run_credential` | heartbeat create without a run credential | 403 | false | none |
| `invalid_token` | bad claims | 401 (existing body) | n/a | n/a |

`details` for `access_denied`: `{reason, principal_kind, project_id}` with `reason` in `principal_inactive`, `not_member`, `restricted_by_authority`, `missing_capability`. Internal pause reasons in `meta.paused_reason`: `missing_principal`, `access_denied`, `agent_deleted`.

## 7. Lifetimes

| Item | Lifetime | Source | Revocation in M2 |
| --- | --- | --- | --- |
| Run token (Secret) | 15 min | `_SECRET_EXP`, `middlewares/auth.py` | Each refresh through the exchange runs `decide`. Routes that call `check_action_access` deny at once. A replayed token works on routes with no check until it expires; it is not single-use. |
| Gateway credential | 12 h | `AGENTA_GATEWAYS_CREDENTIALS_TTL_SECONDS` (43200) | Eligibility at mint; the relay authorizes every call through the wrapper. |
| Mount credential (storage STS) | 12 h | `AGENTA_MOUNTS_CREDENTIALS_TTL_SECONDS` (43200) | `USE_MOUNTS` decision at mint. The storage backend cannot revoke it. Unchanged. |
| Live stream authorization | 60 s recheck | `AGENTA_SESSIONS_LIVE_AUTH_RECHECK_SECONDS` | Recheck through `check_request`. |
| Membership, principal and middleware caches | 300 s | `AGENTA_CACHE_TTL`, `utils/caching.py` | `resolve_membership` (membership or absence) invalidated by every M1 membership mutation; `fetch_principal` invalidated on change; key expiry is exact (`decide` reads `expires_at`); 300 s when Redis invalidation fails or when a concurrent read refills the old entry (known limit). The ApiKey state cache cannot be invalidated; `decide` covers checked routes. |

## 8. Contract changes needed

None. CONTRACT v3 already holds every change this milestone needed.
