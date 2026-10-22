# M3 `agent-session-sharing`: interfaces

Status: proposed, round 2. Code read on `main` at `42ffe80bfe`. Paths are relative to `api/` unless they start with `web/`. "NEW" marks a new file.

Normative names come from `docs/design/sharing-program/CONTRACT.md` (v3) and the M1 and M2 designs. This file adds only M3 names. Where this file and CONTRACT.md disagree, CONTRACT.md wins; the proposed contract edits are listed in `technical-design.md` section 13.

Owner decisions applied (2026-10-22):

- One release (decision 7, CONTRACT.md section 7). There is no rollout flag. An omitted visibility means `private` when the ownership rule gives an owner.
- Ownership (decision 8, option 1). Only a human owns. Every API key creates ownerless, project-visible items.
- Owner leaves (decision 9). Private items lock. Project-visible agents become ownerless, and an admin can take ownership.
- `/w` (decision 10). `/w` always creates project-visible chats and agents, until it is retired.
- Installations (decisions 3 and 6, CONTRACT.md section 4). Installations keep today's authority. M3 adds no installation restriction. For resource policy an `installation` principal is like every other non-human principal: it never owns, and it sees only project-visible items.

Names reused from M1 and M2 without change: `MembershipsService.is_member`, `MembershipsDAOInterface`, `AccessService.decide`, `Decision`, `DecisionReason`, `Action` (= `Permission | RoleRequirement`), `AccessDenied`, `AccessError`; from `core/access/dtos.py` (M2 DTOs): `PrincipalKind`, `PrincipalRef`, `RunAuthority`, `RunOrigin`, `RunContext`, `RunSender`, `RunEnvelope`, `ResourceKind`, `ResourceRef`, `RequestCredentialKind`; from `core/workflows/dtos.py` (M2): `ResolvedTarget`; `WorkflowsService.resolve_request_target` (M2); from `core/access/context.py`: `RequestAccess`, `get_request_access()`; the router helper `request_run_envelope(request)`; `request.state.principal`, `request.state.authority`, `request.state.credential_kind`, `request.state.run_envelope`. The M2 failure code for a deny at a run boundary is `access_denied` (M2 interfaces section 7).

---

## 1. Data

All in one `core_oss` chain. Nothing in `core_ee`. Owner columns have no foreign key, like every `created_by_id` column today: a deleted user is "not an active member", so the item locks (owner decision 9).

### 1.1 `agent_access` (NEW table, `AgentAccessDBE` in NEW `oss/src/dbs/postgres/sharing/dbes.py`)

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `project_id` | uuid | NOT NULL | | PK part |
| `artifact_id` | uuid | NOT NULL | | PK part |
| `visibility` | varchar | NOT NULL | | check `visibility IN ('private','project')` |
| `owner_user_id` | uuid | NOT NULL | | no FK |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | NULL | `created_at`: `current_timestamp` | `LifecycleDBA`; `deleted_at` unused |
| `created_by_id`, `updated_by_id`, `deleted_by_id` | uuid | NULL | | `LifecycleDBA` |

- PK `(project_id, artifact_id)`. FK `(project_id, artifact_id)` -> `workflow_artifacts (project_id, id)` ON DELETE CASCADE. FK `project_id` -> `projects.id` ON DELETE CASCADE.
- Index `ix_agent_access_project_id_owner_user_id (project_id, owner_user_id)`. Check `ck_agent_access_visibility`.
- Invariant (CONTRACT.md section 7): no row = project-visible and ownerless. An ownerless agent never gets a row.

### 1.2 `session_streams` (MODIFIED, `SessionStreamDBE` in `oss/src/dbs/postgres/sessions/streams/dbes.py`)

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `visibility` | varchar | NULL | none | `NULL` = written by pre-M3 code, policy not assigned yet (the legacy marker) |
| `owner_user_id` | uuid | NULL | none | no FK |

- Check `ck_session_streams_visibility_owner`: `(visibility IS NULL OR visibility IN ('private','project')) AND (visibility IS DISTINCT FROM 'private' OR owner_user_id IS NOT NULL)`. Added `NOT VALID`, then `VALIDATE CONSTRAINT` in the same revision.
- Index `ix_session_streams_project_id_owner_user_id (project_id, owner_user_id)`, `CREATE INDEX CONCURRENTLY`.
- The legacy marker is `visibility IS NULL`, never `owner_user_id IS NULL`. New code always writes a non-null `visibility`, also for ownerless rows. Only pre-M3 code (old pods during the rolling deploy) writes `NULL`.
- Writers: the four insert arms (section 3.5), `SharingDAO.set_session_sharing`, and `SharingDAO.assign_legacy_session_access` (section 3.2). `SessionStreamEdit`, `SessionStreamHeaderEdit` and `fill_missing` never carry these columns.

### 1.3 `session_grants` (NEW table, `SessionGrantDBE` in NEW `oss/src/dbs/postgres/sharing/dbes.py`)

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `project_id`, `stream_id`, `user_id` | uuid | NOT NULL | |
| `role` | varchar | NOT NULL | check `role IN ('viewer','participant')` |
| `created_at` | timestamptz | NULL | `current_timestamp` |
| `created_by_id` | uuid | NULL | |

- PK `(project_id, stream_id, user_id)`. FK `(project_id, stream_id)` -> `session_streams (project_id, id)` ON DELETE CASCADE. FK `user_id` -> `users.id` ON DELETE CASCADE (removing a grant only removes access).
- Index `ix_session_grants_project_id_user_id (project_id, user_id)`. The owner is never a grant (enforced in `SharingService`).

### 1.4 Alembic revisions (`oss/databases/postgres/migrations/core_oss/versions/`)

Revision ids are placeholders. `down_revision` is the `core_oss` head after M1 and M2 (today `oss000000043`; M1 adds `044` and `045`, M2 the next one). Allocate final ids at implementation.

**R-A `oss0000000NN_add_agent_session_sharing.py`** (NEW, schema)

```python
def upgrade() -> None:
    op.create_table("agent_access", ...)          # 1.1, with its index (new table)
    op.create_table("session_grants", ...)        # 1.3, with its index
    op.add_column("session_streams", sa.Column("visibility", sa.String(), nullable=True))
    op.add_column("session_streams", sa.Column("owner_user_id", PG_UUID(as_uuid=True), nullable=True))
    op.execute("ALTER TABLE session_streams ADD CONSTRAINT ck_session_streams_visibility_owner CHECK ("
               "(visibility IS NULL OR visibility IN ('private','project')) AND "
               "(visibility IS DISTINCT FROM 'private' OR owner_user_id IS NOT NULL)) NOT VALID")
    op.execute("ALTER TABLE session_streams VALIDATE CONSTRAINT ck_session_streams_visibility_owner")
    with op.get_context().autocommit_block():
        op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_session_streams_project_id_owner_user_id "
                   "ON session_streams (project_id, owner_user_id)")
        # same indisvalid check as oss000000040
```

Migration gate: passes. Two nullable `add_column` calls; no label needed.

**R-B `oss0000000NN+1_backfill_agent_session_sharing.py`** (NEW, data, runs once)

- Agents: one `project` row per artifact that has an `is_agent` revision and a non-null `created_by_id`, `ON CONFLICT DO NOTHING`.
- Sessions: keyset batches of 5,000 by `(project_id, id)` over `visibility IS NULL` rows, autocommit per batch, with the owner rule of technical-design.md section 5.
- The Helm hook runs R-B before any new pod starts, so every row it reads was written by pre-M3 code. It is never rerun. There is no post-rollout script.

Migration gate: passes (`INSERT` and `UPDATE` are not flagged).

### 1.5 Mixed versions

| Work type | Old pod on new schema (rolling deploy) | New pod on rows written by old pods |
| --- | --- | --- |
| Session insert (all four paths) | Writes `visibility NULL`, owner NULL. | Lists show the row as project-visible. The first direct access assigns its policy with the R-B rule (`assign_legacy_session_access`). |
| Agent create | No `agent_access` row. | Project-visible and ownerless (accepted, technical-design.md section 5.3). |
| Sharing writes | Not possible: old pods have no routes. | New pods write private rows from the first minute. |
| Reads | Old pods ignore the columns and show new private items to their project. Accepted risk (decision 7). | New pods enforce. |
| M2 durable work (schedules, subscriptions, queued inputs, approvals) | Unchanged. | Admission checks apply at dispatch and resume (section 3.4). |

---

## 2. Core types

### 2.1 NEW `oss/src/core/sharing/dtos.py`

```python
class Visibility(str, Enum):
    PRIVATE = "private"
    PROJECT = "project"

class SessionRole(str, Enum):
    VIEWER = "viewer"
    PARTICIPANT = "participant"

class SharedItemKind(str, Enum):        # input to initial_policy
    AGENT = "agent"
    SESSION = "session"
    CHANNEL_SESSION = "channel_session"

class EffectiveRole(str, Enum):         # computed, never stored
    OWNER = "owner"
    PARTICIPANT = "participant"
    VIEWER = "viewer"
    NONE = "none"

class AccessPolicy(BaseModel):
    visibility: Visibility
    owner_user_id: Optional[UUID] = None    # validator: PRIVATE requires an owner

class SessionGrant(BaseModel):
    stream_id: UUID
    user_id: UUID
    role: SessionRole
    created_at: Optional[datetime] = None
    created_by_id: Optional[UUID] = None

class UserSessionGrant(BaseModel):      # list_user_grants row
    stream_id: UUID
    owner_user_id: Optional[UUID]

class SessionPolicyState(BaseModel):    # one read of the session row
    stream_id: UUID
    session_id: str
    policy: AccessPolicy
    is_channel: bool                    # a channel_threads row names this session
    references_agent: bool              # session_streams.references names a workflow

class SessionGrantInput(BaseModel):
    user_id: UUID
    role: SessionRole

class SessionSharingChange(BaseModel):  # a delta, applied under the row lock
    visibility: Optional[Visibility] = None
    upsert_grants: List[SessionGrantInput] = []
    remove_user_ids: List[UUID] = []
    remove_all_grants: bool = False     # "Only me" = PRIVATE + remove_all_grants

class AgentReadScope(BaseModel):
    owner_user_id: Optional[UUID]       # principal.id for a human, else None

class SessionReadScope(BaseModel):
    owner_user_id: Optional[UUID]       # principal.id for a human, else None
    include_project: bool               # True for every principal kind in M3
    granted_stream_ids: List[UUID]      # grants whose owner is an active member

class DisclosedConnection(BaseModel):
    provider: str
    integration: str
    connection: str                     # connection slug from the revision's parameters["tools"]

class ShareDisclosure(BaseModel):
    connections: List[DisclosedConnection]
    turns_use_run_credentials: bool = True      # three fixed statements; the UI owns the text
    files_and_tool_results_shared: bool = True
    trace_readers_can_read: bool = True

class AgentSharingState(BaseModel):
    policy: AccessPolicy
    owner_is_active: bool
    my_role: EffectiveRole              # OWNER, VIEWER or NONE for agents
    can_take_ownership: bool

class SessionSharingState(BaseModel):
    policy: AccessPolicy
    owner_is_active: bool
    grants: List[SessionGrant]          # returned to the owner only; empty for others
    my_role: EffectiveRole
    can_send: bool
    shareable: bool                     # False for channel, ownerless and non-agent sessions
```

### 2.2 NEW `oss/src/core/sharing/types.py` (domain exceptions)

```python
class SharingError(Exception):              # code, message, details
class SharingConflict(SharingError):        # "sharing_conflict"; current: Optional[AccessPolicy]
class InvalidGrantee(SharingError):         # "invalid_grantee"; details.user_id, details.reason
class SessionNotShareable(SharingError):    # "session_not_shareable"; details.reason: channel | ownerless | no_agent
class OwnerStillActive(SharingError):       # "owner_active"
class InvalidTransferTarget(SharingError):  # "invalid_transfer_target"
class SharedItemNotFound(SharingError):     # "not_found"
class AgentCreationFailed(SharingError):    # "agent_creation_failed"; the transaction rolled back
```

### 2.3 MODIFIED DTOs

- `oss/src/core/access/dtos.py` (M1 file): `DecisionReason.RESOURCE_DENIED = "resource_denied"`. It is an internal reason; HTTP exposes `not_found` or `access_denied` (section 5).
- `oss/src/core/access/permissions/types.py`: `Permission.MANAGE_AGENT_OWNERSHIP = "manage_agent_ownership"`, in `ADMIN_PERMISSIONS` (the owner role has every permission already).
- `oss/src/core/sessions/streams/dtos.py`: `SessionStream` gets `visibility: Visibility = Visibility.PROJECT` (a stored `NULL` maps to `PROJECT`) and `owner_user_id: Optional[UUID] = None` (read only). `SessionStreamCreate` gets a required `access: AccessPolicy`. `SessionStreamEdit` and `SessionStreamHeaderEdit` do not change.
- `oss/src/core/workflows/dtos.py`: `Workflow.access` and `SimpleWorkflow.access: Optional[AccessPolicy] = None` (filled for agents on reads; the applied policy on create). `WorkflowCreate.visibility` and `SimpleWorkflowCreate.visibility: Optional[Visibility] = None`.
- `oss/src/core/sessions/dtos.py` `SessionListItem` carries `SessionStream`, so it gets both fields.
- `oss/src/core/memberships/dtos.py` (M1 file): NEW `ProjectMemberProfile(user_id: UUID, email: str, name: Optional[str], role: str)`.
- `oss/src/core/events/types.py`: `EventType.AGENTS_SHARING_CHANGED = "agents.sharing.changed"`, `EventType.SESSIONS_SHARING_CHANGED = "sessions.sharing.changed"`.

---

## 3. Core interfaces

### 3.1 `SharingService` (NEW `oss/src/core/sharing/service.py`)

Dependencies: `sharing_dao: SharingDAOInterface`, `memberships_service: MembershipsService` (M1). It implements `ResourcePolicyInterface` (3.3).

```python
class SharingService(ResourcePolicyInterface):

    def initial_policy(
        self,
        *,
        principal: PrincipalRef,
        origin: RunOrigin,                    # RunContext.origin; web (Bearer) or api (ApiKey) for a request
        sender_user_id: Optional[UUID],       # RunSender.user_id of the turn, for a run
        #
        kind: SharedItemKind,
        requested: Optional[Visibility] = None,
    ) -> AccessPolicy: ...                    # pure, never raises

    async def evaluate(                       # ResourcePolicyInterface, step 4 of decide
        self,
        *,
        principal: PrincipalRef,
        action: Action,
        project_id: UUID,
        resource: ResourceRef,
    ) -> Optional[DecisionReason]: ...        # None = allow; RESOURCE_DENIED = deny

    async def agent_read_scope(self, *, principal: PrincipalRef) -> AgentReadScope: ...
    async def session_read_scope(
        self, *, project_id: UUID, principal: PrincipalRef,
    ) -> SessionReadScope: ...

    async def fetch_agent_sharing(
        self, *, project_id: UUID, principal: PrincipalRef, artifact_id: UUID,
    ) -> AgentSharingState: ...
    async def set_agent_visibility(
        self, *, project_id: UUID, principal: PrincipalRef,
        #
        artifact_id: UUID, visibility: Visibility,
    ) -> AgentSharingState: ...
    async def transfer_agent(
        self, *, project_id: UUID, principal: PrincipalRef,
        #
        artifact_id: UUID, new_owner_user_id: UUID,
    ) -> AgentSharingState: ...
    async def take_agent_ownership(
        self, *, project_id: UUID, principal: PrincipalRef, artifact_id: UUID,
    ) -> AgentSharingState: ...
    # Raise SharedItemNotFound, OwnerStillActive, InvalidTransferTarget, SharingConflict (after one re-decide).

    async def fetch_session_sharing(
        self, *, project_id: UUID, principal: PrincipalRef, session_id: str,
    ) -> SessionSharingState: ...
    async def set_session_sharing(
        self, *, project_id: UUID, principal: PrincipalRef,
        #
        session_id: str, change: SessionSharingChange,
    ) -> SessionSharingState: ...
    # Raise SharedItemNotFound, SessionNotShareable, InvalidGrantee, SharingConflict (after one re-decide).

    async def share_disclosure(self, *, project_id: UUID, artifact_id: UUID) -> ShareDisclosure: ...
```

`initial_policy` (CONTRACT.md section 7):

```python
owner = (
    None if kind is SharedItemKind.CHANNEL_SESSION or origin is RunOrigin.INSTALLATION
    else sender_user_id if sender_user_id is not None and origin in (RunOrigin.WEB, RunOrigin.API)
    else principal.id if principal.kind is PrincipalKind.HUMAN and origin in (RunOrigin.WEB, RunOrigin.SCHEDULE)
    else None                     # api_key, installation, subscription, child, evaluation
)
if owner is None:
    return AccessPolicy(visibility=Visibility.PROJECT, owner_user_id=None)   # a requested PRIVATE is dropped
return AccessPolicy(visibility=requested or Visibility.PRIVATE, owner_user_id=owner)
```

`evaluate` rules. Only `ResourceKind.AGENT` and `ResourceKind.SESSION` are evaluated; another kind returns `None`. "Owner active" = `MembershipsService.is_member(project_id=..., user_id=owner_user_id)`. A missing row returns `None` (the caller's not-found path answers).

| Id | Resource | Action | Allow when |
| --- | --- | --- | --- |
| A1 | agent | any | no row, or `visibility = project` |
| A2 | agent | any | `private`, principal is `human`, `principal.id = owner_user_id` |
| S1 | session | `VIEW_SESSIONS`, `USE_MOUNTS`, `VIEW_MOUNTS` | `project`; or `private`, owner active, and principal is the human owner or has a grant |
| S2 | session | `RUN_SESSIONS` (send, steer, cancel, answer an approval) | owner active and principal is the human owner or a `participant`; or owner NULL and principal is not `human` |
| S3 | session | `RUN_SESSIONS` | owner NULL and principal is `human`: deny (humans only read ownerless sessions) |
| S4 | session | `EDIT_SESSIONS` (rename, archive, unarchive, delete) | owner set: principal is the active human owner; owner NULL: any principal (today's behavior) |

`fetch_session_policy` assigns the policy of a legacy row (`visibility IS NULL`) before `evaluate` reads it, so the rules never see `NULL`.

### 3.2 `SharingDAOInterface` (NEW `oss/src/core/sharing/interfaces.py`)

Every method is `@abstractmethod` and returns DTOs from 2.1.

```python
class SharingDAOInterface(ABC):
    # agents
    @abstractmethod
    async def fetch_agent_policy(self, *, project_id: UUID, artifact_id: UUID) -> Optional[AccessPolicy]: ...
    @abstractmethod
    async def set_agent_policy(
        self, *, project_id: UUID, artifact_id: UUID,
        #
        expected: Optional[AccessPolicy],       # None = "no row"
        policy: AccessPolicy,
        #
        user_id: UUID,
    ) -> AccessPolicy: ...
    # Locks workflow_artifacts (project_id, id) FOR UPDATE, compares agent_access with expected,
    # raises SharingConflict(current) on mismatch, upserts. PRIVATE also deactivates the
    # artifact's channel agents (technical-design.md section 4.6) in the same transaction.
    @abstractmethod
    async def ensure_first_agent_access(
        self, *, project_id: UUID, artifact_id: UUID, revision_id: UUID, owner_user_id: UUID,
    ) -> bool: ...

    # sessions
    @abstractmethod
    async def fetch_session_policy(self, *, project_id: UUID, session_id: str) -> Optional[SessionPolicyState]: ...
    # A legacy row (visibility NULL) first goes through assign_legacy_session_access.
    @abstractmethod
    async def assign_legacy_session_access(self, *, project_id: UUID, session_id: str) -> None: ...
    # One UPDATE ... WHERE visibility IS NULL with the R-B owner rule. Idempotent.
    @abstractmethod
    async def list_session_grants(self, *, project_id: UUID, stream_id: UUID) -> List[SessionGrant]: ...
    @abstractmethod
    async def list_user_grants(self, *, project_id: UUID, user_id: UUID) -> List[UserSessionGrant]: ...
    @abstractmethod
    async def set_session_sharing(
        self, *, project_id: UUID, session_id: str,
        #
        expected: AccessPolicy,
        change: SessionSharingChange,
        #
        user_id: UUID,
    ) -> SessionPolicyState: ...
    # Locks the session_streams row FOR UPDATE, compares (visibility, owner) with expected,
    # raises SharingConflict(current) on mismatch, applies the delta in one transaction.
```

Implementation: NEW `oss/src/dbs/postgres/sharing/dao.py` `SharingDAO(SharingDAOInterface)`, NEW `mappings.py` (`map_agent_access_dbe_to_dto`, `map_session_grant_dbe_to_dto`).

**Policy read caches.** `evaluate` adds no uncached read to a request. `SharingService` reads agent and session policy through Redis (`get_cache`, `set_cache`, `invalidate_cache` from `oss/src/utils/caching.py`, TTL `AGENTA_CACHE_TTL`), as M2 does for membership. The DAO stays uncached. Cache entries are DTOs in `core/sharing/dtos.py`, never returned to callers:

```python
class CachedAgentAccess(BaseModel):     # namespace "sharing_agent_access", key (project_id, artifact_id)
    policy: Optional[AccessPolicy] = None   # None = "no agent_access row" (A1 allows); a hit, not a miss

class CachedSessionAccess(BaseModel):   # namespace "sharing_session_access", key (project_id, session_id)
    stream_id: UUID
    policy: AccessPolicy                    # never NULL: a legacy row is assigned before the write
    grants: List[SessionGrant]              # every grant of the session; [] when none
```

- Agent: a miss calls `fetch_agent_policy` and stores `CachedAgentAccess`, also for "no row", because most agents have no row. A warm agent decision reads no Postgres row.
- Session: a miss calls `fetch_session_policy` and `list_session_grants` and stores one `CachedSessionAccess`. Grant lookups read the cached list, so `fetch_session_grant` is deleted from the DAO. A missing session row is not cached: the caller answers 404, and the next request reads Postgres. So no insertion path (P1 to P4) needs an invalidation.
- "Owner active" uses `MembershipsService.is_member`, which reads the M2 membership cache (membership or absence). An owner who leaves is seen through M1's membership invalidation; the sharing caches do not change.
- Invalidation: one helper, `invalidate_sharing_caches(*, project_id, artifact_ids=(), session_ids=())` in `core/sharing/service.py`, awaited after each commit: `SharingService` after `set_agent_policy` (visibility, transfer, take ownership) and `set_session_sharing` (visibility, grants, "Only me"); `WorkflowsService` after `create_agent_artifact` and `ensure_first_agent_access`; `SessionStreamsService` after a session delete. `assign_legacy_session_access` needs none, because a `NULL` policy is never cached. A failure is logged and does not fail the writer.
- Known limit, as for membership: a read that started before a sharing write committed can refill the old entry after the invalidation; it lives at most `AGENTA_CACHE_TTL`.
- Sharing writes read the current policy from the DAO under the row lock, never from the cache, so `expected` is always the committed value.

### 3.3 `ResourcePolicyInterface` (`oss/src/core/access/interfaces.py`, the M1 file)

```python
class ResourcePolicyInterface(ABC):
    @abstractmethod
    async def evaluate(
        self, *, principal: PrincipalRef, action: Action, project_id: UUID, resource: ResourceRef,
    ) -> Optional[DecisionReason]: ...
```

- `AccessService.__init__` gains a required `resource_policy: ResourcePolicyInterface`, with no default. Every composition root that builds `AccessService` passes `SharingService`: `entrypoints/routers.py`, `entrypoints/worker_queues.py`, `entrypoints/worker_streams.py`, and every other root that builds it. A missing argument fails at startup with `TypeError`. A test builds each root (technical-design.md section 8).
- `decide` calls it as step 4, only when `resource` is given and steps 1 to 3 allowed. The EE no-RBAC, organization-owner and project-owner shortcuts stay in step 3, so they cannot open a private item.

### 3.4 Execution admission (NEW `oss/src/core/sharing/admission.py`)

One function checks the session and the resolved agent at every point where work starts or resumes.

```python
class RunAdmission:
    def __init__(self, *, access_service: AccessService, workflows_service: WorkflowsService): ...

    async def admit(
        self,
        *,
        envelope: RunEnvelope,
        session_id: Optional[str],            # None: no existing session to check
        agent_artifact_id: Optional[UUID],    # the execution target of THIS turn; None = draft run
    ) -> None: ...
    # 1. session_id set: decide(envelope.authority, principal, RUN_SESSIONS, resource=session(session_id)).
    # 2. agent_artifact_id set: decide(..., RUN_WORKFLOWS, resource=agent(agent_artifact_id)).
    # Any deny raises AccessDenied(decision). admit never reads session_streams.references.
```

Callers pass the execution target, never the session's stored references (technical-design.md section 2):

- Server paths (queued dispatch, approval resume, channel turn, child invocation): `_prepare_invoke` resolves the revision as today (M2 `resolve_request_target`) and passes `ResolvedTarget.artifact_id`; a request with no workflow reference (inline configuration) passes `None`. An unresolved reference keeps `_ensure_request_revision`'s existing failure, before `admit`.
- Trigger dispatch: M2 F6 `resolve_request_target` on every tick, then `ResolvedTarget.artifact_id`. The stored `trigger_*.artifact_id` is never passed.
- Heartbeat (every beat without verified continuity, section 3.5 P4): `resolve_agent_artifact_id(references=request.references)`, the beat's references for the current turn.

- NEW `WorkflowsService.resolve_agent_artifact_id(*, project_id: UUID, references: Optional[List[SessionReference]]) -> Optional[UUID]`: resolves the most specific reference of `AGENT_REFERENCE_KEYS` (NEW, `core/workflows/dtos.py`: the `workflow` and `application` families, each with `_variant` and `_revision`, and `environment`, which resolves to its current revision; a superset of `RESOLVABLE_AGENT_REFERENCE_KEYS`), by id or slug, to its artifact id without a read scope (an internal lookup, one indexed read). It returns `None` only when `references` holds none of these keys (a draft run). When such a reference is present and nothing resolves (unknown, deleted, archived, or in another project), it raises NEW `AgentReferenceUnresolved`. Channel bindings use the adapter NEW `core/channels/dtos.py::channel_agent_references(references: Dict[str, Reference]) -> List[SessionReference]`; a binding whose references contain no agent key is refused, never treated as "no agent". (`core/workflows/types.py`), which the heartbeat route answers as 404 `not_found`. It never returns `None` for an unresolved reference.
- Call sites (technical-design.md section 2): the heartbeat (every beat without verified continuity), queued dispatch (M2 F5), approval resume (M2 F7), channel turn (M2 F8), trigger dispatch (M2 F6, agent only, the target is resolved before the check), and child invocation (M2 F10, agent only).

### 3.5 Session insertion paths (MODIFIED)

`SessionStreamsDAOInterface.create(*, project_id, user_id, stream: SessionStreamCreate)` keeps its signature; `stream.access` is required and `map_stream_dto_to_dbe_create` writes it.

| Path | Symbol | Change |
| --- | --- | --- |
| P1 turn start | `SessionStreamsService._start_turn` (`core/sessions/streams/service.py` ~1131) and `command(...)` | new required kwarg `access: AccessPolicy`. Callers: router `set_session_stream`, `core/channels/commands.py` (channel session). |
| P2 rename before the first turn | `SessionStreamsService.set_header` create arm (~978) | new required kwarg `access: AccessPolicy`, used only in the create arm. The `SessionStreamAlreadyExists` arm writes no access field. |
| P3 trigger claim | `SessionStreamsDAO.claim_trigger_delivery` (`dbs/postgres/sessions/streams/dao.py` ~163) and `TriggerSessionClaimsDAOInterface.claim_trigger_delivery` | new required kwarg `access: AccessPolicy`; the `from_select` column list adds both columns. `on_conflict_do_update` stays tags-only. Caller `TriggersDispatcher._run` passes `initial_policy(principal=<trigger principal>, origin=schedule or subscription, sender_user_id=None, kind=SESSION)`. |
| P4 heartbeat | `SessionStreamsService.heartbeat` and `_heartbeat_locked` | new required kwargs `access: AccessPolicy` (used only in the `prior_stream is None` create), `run_admission: RunAdmission`, `admission_envelope: RunEnvelope`. `_heartbeat_locked` reads `prior_stream` once, at the top, before the supersession check (its branch reuses the row). Then it authorizes: row absent → `admit_turn(session_id=None)`, then insert the row (initial flags, `turn_id`, `access`) before any liveness lock; on `SessionStreamAlreadyExists` read the winning row and authorize it as below before any lock, update or response; row present and verified continuity (`request.is_running`, `request.turn_id == prior_stream.turn_id`, and `get_turn_admission(...)`, a `GETEX` that renews the TTL, equals `admission_envelope.authority.principal`; a Redis error counts as no record) → no check; otherwise → `admit_turn(session_id=request.session_id)` for a running beat, `admit(session_id, agent_artifact_id=None)` for any other beat. After a successful check of a running beat with a `turn_id`, for the row actually used, `record_turn_admission(...)` (a write error is logged; the next beat is checked again) (Redis, NEW in `core/sessions/streams/locks` next to `bind_turn`, same TTL as the binding). A refusal raises before any lock, row write or response. Router `heartbeat_session_stream` computes `access` and `admission_envelope = request_run_envelope(request)`; it reads no session row. |

### 3.6 Workflows (MODIFIED and NEW)

```python
class WorkflowsDAOInterface(GitDAOInterface):          # oss/src/core/workflows/interfaces.py
    @abstractmethod
    async def create_agent_artifact(
        self, *, project_id: UUID, user_id: UUID,
        #
        artifact_create: ArtifactCreate,
        access: AccessPolicy,                  # has an owner; ownerless agents use create_artifact
        #
        artifact_id: Optional[UUID] = None,
        platform_meta: bool = False,
    ) -> Artifact: ...                         # raises EntityCreationConflict or AgentCreationFailed
    @abstractmethod
    async def ensure_first_agent_access(
        self, *, project_id: UUID, artifact_id: UUID, revision_id: UUID, owner_user_id: UUID,
    ) -> bool: ...
    # query_artifacts, query_variants, query_revisions, query_head_revisions: the existing
    # GitDAO keyword arguments plus a required read_scope: AgentReadScope.
```

- `GitDAO.create_artifact` (`dbs/postgres/git/dao.py` ~101): extract `_insert_artifact(self, *, session, project_id, user_id, artifact_create, artifact_id, platform_meta) -> Artifact` (adds and flushes, never commits). `create_artifact` calls it, then commits. No behavior change.
- NEW `oss/src/dbs/postgres/workflows/dao.py` `WorkflowsDAO(GitDAO, WorkflowsDAOInterface)`. `create_agent_artifact` opens one transaction, calls `_insert_artifact`, inserts `AgentAccessDBE`, commits once. It has no `@suppress_exceptions`: `EntityCreationConflict` passes through, and any other database error becomes `AgentCreationFailed` after the rollback. The four query overrides add the agent predicate (technical-design.md section 4.3) before windowing.
- `WorkflowsService.__init__` takes `workflows_dao: WorkflowsDAOInterface`. `create_workflow(..., access: Optional[AccessPolicy] = None)` calls `create_agent_artifact` when the request declares an agent (`flags.is_agent`) and `access.owner_user_id` is set, else `create_artifact`, and sets `Workflow.access`. `commit_workflow_revision(..., first_agent_owner_user_id: Optional[UUID] = None)` calls `ensure_first_agent_access` after a committed `is_agent` revision when the owner is given. The four query methods take a required `read_scope`.
- `SimpleWorkflowsService.create` and `create_idempotent` forward `access` and `first_agent_owner_user_id`. `core/agent_templates/loader.py` forwards both from the route.

### 3.7 Session lists (MODIFIED)

- `SessionStreamsDAOInterface.query` and `count`, `SessionStreamsDAO._apply_filters`, `SessionStreamsService.query_streams` and `count_streams`, `SessionsService.query_sessions_page` (`core/sessions/service.py` ~115): new required kwarg `read_scope: SessionReadScope`, applied in SQL before ordering, count and windowing.
- A legacy row (`visibility IS NULL`) matches the project branch of the predicate.

### 3.8 Channels (MODIFIED)

- `ChannelsService.create_agent` and `edit_agent` (`core/channels/service.py` ~1156, ~1191): when the result is active, resolve `channel_agent_references(data.references)` with `resolve_agent_artifact_id`, then pass `guard_artifact_id` to the channels DAO write, which locks the artifact row, reads `agent_access` without a cache (`dbs/postgres/sharing/dao.py::lock_agent_policy(session, *, project_id, artifact_id)`) and refuses a private agent in the same transaction. A private agent, or a reference that raises `AgentReferenceUnresolved`, is refused with `SharedItemNotFound`.
- `SharingDAO.set_agent_policy` deactivates the channel agents whose `data.references` name the artifact: by artifact id or slug, or by the id of any of its variants or revisions (`RESOLVABLE_AGENT_REFERENCE_KEYS`, `core/channels/dtos.py` ~383).

### 3.9 Project members for the picker (MODIFIED, M1 domain)

```python
# oss/src/core/memberships/interfaces.py (M1)
@abstractmethod
async def query_project_member_profiles(
    self, *, project_id: UUID, policy: MembershipPolicy,
    #
    search: Optional[str] = None,           # case-insensitive prefix on email or name
    windowing: Optional[Windowing] = None,  # core/shared/dtos.py; cursor = user_id, order by email
) -> List[ProjectMemberProfile]: ...

# oss/src/core/memberships/service.py (M1)
async def query_project_members(
    self, *, project_id: UUID, search: Optional[str] = None, windowing: Optional[Windowing] = None,
) -> List[ProjectMemberProfile]: ...
```

It applies the M1 resolver policy: OSS lists the organization members, EE lists the `project_members` rows. It never reads workspace members.

### 3.10 Sharing audit (NEW `oss/src/core/sharing/audit.py`)

```python
async def publish_sharing_event(
    *, organization_id: UUID, project_id: UUID, access: RequestAccess,
    #
    resource: ResourceRef, before: Optional[AccessPolicy], after: AccessPolicy,
    grants_added: List[SessionGrantInput] = [], grants_removed: List[UUID] = [],
) -> None: ...   # never raises; follows core/gateways/policy/audit.py
```

---

## 4. API surface

NEW router `oss/src/apis/fastapi/sharing/router.py` `SharingRouter`, models in NEW `models.py`, mounted with no prefix in `entrypoints/routers.py`. All routes use `@intercept_exceptions()` and `handle_sharing_exceptions()`. Every route calls `AccessService.decide` with `request.state.principal`, `request.state.authority` and the resource. Responses carry `count` (1 for a singleton) and a named payload.

| Method, path | `operation_id` | Request | Response | Permission (step 3), policy (step 4) |
| --- | --- | --- | --- | --- |
| `GET /workflows/{workflow_id}/sharing` | `fetch_agent_sharing` | | `AgentSharingResponse {count, sharing: AgentSharingState, disclosure: ShareDisclosure}` | `VIEW_WORKFLOWS`; A1/A2 |
| `POST /workflows/{workflow_id}/sharing/visibility` | `set_agent_visibility` | `AgentVisibilityRequest {visibility}` | `AgentSharingResponse` | `EDIT_WORKFLOWS`; caller is the active owner |
| `POST /workflows/{workflow_id}/sharing/transfer` | `transfer_agent` | `AgentTransferRequest {user_id}` | `AgentSharingResponse` | `EDIT_WORKFLOWS`; caller is the owner; target is an active human member |
| `POST /workflows/{workflow_id}/sharing/take-ownership` | `take_agent_ownership` | | `AgentSharingResponse` | `MANAGE_AGENT_OWNERSHIP`; project-visible, no active owner |
| `GET /sessions/{session_id}/sharing` | `fetch_session_sharing` | | `SessionSharingResponse {count, sharing: SessionSharingState, disclosure: Optional[ShareDisclosure]}` | `VIEW_SESSIONS`; S1 |
| `POST /sessions/{session_id}/sharing/grants` | `upsert_session_grant` | `SessionGrantRequest {user_id, role}` | `SessionSharingResponse` | `EDIT_SESSIONS`; caller is the active owner |
| `DELETE /sessions/{session_id}/sharing/grants/{user_id}` | `revoke_session_grant` | | `SessionSharingResponse` | same |
| `POST /sessions/{session_id}/sharing/visibility` | `set_session_visibility` | `SessionVisibilityRequest {visibility}` | `SessionSharingResponse` | same |
| `POST /sessions/{session_id}/sharing/only-me` | `restrict_session_to_owner` | | `SessionSharingResponse` | same; private and every grant removed in one transaction |
| `POST /sharing/members/query` | `query_sharing_members` | `SharingMembersQueryRequest {search?, windowing?}`, merged with query params | `SharingMembersResponse {count, members: List[ProjectMemberProfile], windowing?}` | `VIEW_SESSIONS`; no resource |

`/workflows/{workflow_id}/sharing` sits beside `WorkflowsRouter` (`prefix="/workflows"`), and `/sessions/{session_id}/sharing` beside `SessionsRouter.root`. No path collides.

Changed routes:

| Route | Change |
| --- | --- |
| `POST /workflows/` (`create_workflow`), `POST /simple/workflows/` (`create_simple_workflow`), `POST /agent-templates/load` | body accepts `workflow.visibility`; the router computes `initial_policy(kind=AGENT)`; response `workflow.access` is the applied policy. |
| `POST /workflows/revisions/commit` and every commit route | pass `first_agent_owner_user_id = initial_policy(kind=AGENT).owner_user_id`. |
| `POST /workflows/query`, `/workflows/variants/query`, `/workflows/revisions/query`, `/simple/workflows/query`, and `/applications` queries that read `workflow_artifacts` | pass `read_scope=await sharing.agent_read_scope(principal=request.state.principal)`. |
| `GET /workflows/{id}`, `/workflows/variants/{id}`, `/workflows/revisions/{id}`, `/workflows/revisions/retrieve`, `/simple/workflows/{id}`, invoke, inspect | `decide(..., resource=agent)`. |
| `POST /sessions/query`, `POST /sessions/streams/query` | pass `read_scope`; rows include `visibility`, `owner_user_id`. |
| `GET /sessions/{session_id}`, `GET /sessions/streams/`, watch routes and `session_events` `authorized()`, records, turns, interactions, attachments, mounts (including `sign_session_mount_credentials`) | `decide(<route permission>, resource=session)`. The live recheck (`env.sessions.live_auth_recheck_seconds`) reuses `authorized()`. |
| `POST /sessions/streams/` (`set_session_stream`), queued input routes, `POST /sessions/interactions/{id}/respond` | `decide(RUN_SESSIONS, resource=session)` (S2, S3). The send path also checks the agent for the sender (M2). |
| `PUT /sessions/streams/header` (`set_session_stream_header`) | `decide(EDIT_SESSIONS, resource=session)` on an existing row (S4). NEW query parameter `visibility: Optional[Visibility]`, read only by the create arm as `requested`. On an existing row it is ignored: sharing routes own changes. It is a query parameter for the same reason as `name_source`: the `rename_session` tool fills only the body. |
| `/sessions/archive`, `/sessions/unarchive`, `DELETE /sessions/` | `decide(EDIT_SESSIONS, resource=session)` (S4). |
| `POST /sessions/streams/heartbeat` | computes `access` and `admission_envelope` for P4 and passes `run_admission`; the service authorizes every beat that lacks verified continuity before any lock, write or response (section 3.5). A hiding refusal (`AdmissionDenied` with `readable` false, or `AgentReferenceUnresolved`) answers the one canonical body `NOT_FOUND_ERROR` (404, `{code: "not_found", message: "Not found.", retryable: false}`, defined once in `apis/fastapi/sharing/utils.py`); a readable refusal answers 403 `access_denied`. |
| `/channels/agents/` create and edit | an active result: resolve the binding's references through `channel_agent_references` and `resolve_agent_artifact_id`, then in the channel-agent write transaction lock `workflow_artifacts (project_id, id) FOR UPDATE`, read `agent_access` uncached, refuse a private agent, write the binding, commit (same lock order as `set_agent_policy`). |

Auth middleware and `request.state`: no change beyond M2. Runner and SDK: no change. The runner already treats a 4xx on the first beat as a refused admission (`admissionRejectedStatus`, `services/runner/src/sessions/alive.ts`). Env: none.

---

## 5. Error codes

Envelope `{code, message, retryable, next_step?, details?}` (api/AGENTS.md). `resource_denied` stays an internal `DecisionReason`; it appears only in `details.reason`.

| Code | HTTP | Retryable | Raised by | When |
| --- | --- | --- | --- | --- |
| `not_found` | 404 | no | `SharedItemNotFound`; a `resource_denied` decision when the caller fails S1 or A1/A2; `AgentReferenceUnresolved` | no row, or a private item the caller cannot read. New routes and the heartbeat answer one canonical body `NOT_FOUND_ERROR`; existing routes answer exactly what they answer for an unknown id |
| `access_denied` | 403 | no | a `resource_denied` decision on an item the caller can read | a Viewer sends; a non-owner changes sharing; `details.reason = "resource_denied"` |
| `sharing_conflict` | 409 | yes; `next_step`: "Reload the sharing state and retry." | `SharingConflict` after one re-decide | the policy changed under the lock |
| `invalid_grantee` | 422 | no | `InvalidGrantee` | not an active human member, the owner, or a duplicate |
| `session_not_shareable` | 409 | no | `SessionNotShareable` | channel, ownerless, or no agent reference |
| `owner_active` | 409 | no | `OwnerStillActive` | take-ownership while the owner is a member |
| `invalid_transfer_target` | 422 | no | `InvalidTransferTarget` | target is not an active human member |
| `agent_creation_failed` | 500 | yes | `AgentCreationFailed` | the artifact and access insert rolled back |
| `missing_capability`, `not_member`, `principal_inactive` | 403 / 401 | no | M1, M2 | unchanged |

M3 produces no `restricted_by_authority` (no installation restriction) and no rollout-flag code.

---

## 6. Web contract

- Fern: regenerate the client after the API lands (`bash ./clients/scripts/generate.sh --language typescript`, from an EE spec), then `pnpm --filter @agentaai/api-client build`. Add `getSharingClient()` to `web/packages/agenta-sdk/src/resources.ts`. The new `header` query parameter and the session row fields arrive through the same regeneration.
- `@agenta/entities`: NEW subpath export `"./sharing": "./src/sharing/index.ts"` in `package.json`. `sharing/api.ts` calls only `getSharingClient()` and validates with zod schemas in `sharing/core/schema.ts`.
- Query keys are project-scoped: `["sharing", "agent", workflowId, projectId]`, `["sharing", "session", sessionId, projectId]`, `["sharing", "members", projectId, search]`.
- Mutations update through `getHostQueryClient()` (`@agenta/shared/api`): set the sharing key from the response, then invalidate the session list and the workflow list keys of the same project.
- UI components live in `@agenta/entity-ui` and `@agenta/sessions-ui`. Each new component has a Storybook story in `web/storybook/stories/entity-ui/`, covering empty grants, read-only (Viewer), locked (owner left), conflict error and Slack notice states.
- Package tests live under each package's `tests/unit/`.
- `/w` (`web/oss`): an explicit exception to `web/AGENTS.md`, which forbids edits there. The only edits are those that keep `/w` chats and agents project-visible (owner decision 10). They are listed in technical-design.md section 1.4.
