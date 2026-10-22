# M1 `project-membership-resolver`: interfaces

Status: proposed, round 3 (plan review 2026-10-22: single-statement readers, write results, null project roles, `--apply` order, one implementation PR). Code read at `42ffe80bfe`. Paths are relative to `api/`. NEW marks a new file or symbol. Normative rules: `docs/design/sharing-program/CONTRACT.md` sections 1, 2, 6 and 12. Owner decisions (2026-10-22) applied here: P3 and P4 are reported only, only duplicate rows (P5) block; the demo feature is deleted; one release; project create, update and delete check a permission.

## 1. Data

### 1.1 Table changes

| Table | Change |
| --- | --- |
| `project_members` | NEW unique index `ux_project_members_project_id_user_id` on `(project_id, user_id)`. No column change. Rows with `is_demo = true` are deleted by `oss000000044`. The `is_demo` column stays, unused (no code reads or writes it); M4 drops it with the workspace columns. The indexes from `oss000000040` stay. |
| `organization_members` | Data only: owner rows added (P1), `role` copied from `workspace_members.role` (P6). |
| `workspace_members`, `projects`, `organizations`, `project_invitations` | No change. |

Columns used (existing, `oss/src/models/db_models.py`): `organization_members(id, user_id, organization_id, role, created_at, updated_at, deleted_at)`, `workspace_members(id, user_id, workspace_id, role, ...)`, `project_members(id, user_id, project_id, role, is_demo, created_at, updated_at, deleted_at)` (`id` has no database default; `role` and `created_at` are nullable), `projects(id, organization_id, workspace_id, project_name, is_default)`, `organizations(id, name, owner_id NOT NULL)`, `workspaces(id, name, organization_id)`.

Soft-deleted rows (`deleted_at IS NOT NULL`) keep counting as members in M1, as today. M4 decides on them.

### 1.2 Alembic revisions (chain `core_oss`, both editions run it)

Current head: `oss000000043`. Take the next free ids at implementation time. M2 adds its revisions after these.

| Revision (NEW) | `upgrade()`, in this order, in the hook transaction | `downgrade()` | Migration gate |
| --- | --- | --- | --- |
| `oss000000044_repair_memberships_for_resolver` | 0. Delete the organization and workspace rows of demo-only users (not the owner; every project row of the user in the organization is a demo row). 1. `DELETE FROM project_members WHERE is_demo IS TRUE` (demo rows). 2. P1: insert an `owner` organization row for each `organizations.owner_id` without one. 3. P2a: insert an `owner` project row for the organization owner in every project of the organization that has no row for the owner. 4. P6: copy the workspace role into the organization role (technical design section 3.2). Idempotent. | No-op. | Passes: `DELETE`, `INSERT`, `UPDATE` are not in the scanned list. |
| `oss000000045_add_project_members_unique_index` | In `op.get_context().autocommit_block()`: count duplicate `(project_id, user_id)` groups; not 0 → `RuntimeError` that names `python -m entrypoints.memberships_check --apply`. Then `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_project_members_project_id_user_id ON project_members (project_id, user_id)`, the `pg_index.indisvalid` check copied from `oss000000040`, `ANALYZE project_members`. | `DROP INDEX CONCURRENTLY IF EXISTS ux_project_members_project_id_user_id` in an autocommit block. | Passes: concurrent `CREATE UNIQUE INDEX` is not flagged. |

The P2a and P1 inserts use `WHERE NOT EXISTS`, because the unique index does not exist yet at that point. P2a rows are harmless in OSS (OSS does not read project rows for decisions). P2b (EE members who pass today only by the no-RBAC shortcut) needs the RBAC entitlement, which a migration cannot read, so it stays in the script (section 7). No `core_ee` revision: OSS to EE uses `--materialize`, because a `core_ee` revision also runs on existing EE databases.

### 1.3 Mixed-version behavior (one release)

- The Helm pre-upgrade hook runs both revisions before any new pod starts. A duplicate group fails `oss000000045`, the hook fails, and no new pod starts.
- Old pods on the new schema: they do not read `organization_members.role` for project decisions, so P1 and P6 do not change their decisions. P2a rows give an organization owner a row; old pods allow the owner anyway. Deleted demo rows: old pods stop giving demo access at once.
- Old pod inserts that the unique index can reject: `db_manager.add_user_to_project` from demo enrollment adds a new signup only, so no duplicate. Accepted.
- Rollout window (minutes, cloud only; docker-compose has one API process): an old pod can still add a demo row for a new signup. That row becomes a plain `viewer` membership. Accepted. An OSS role change on an old pod writes workspace and project rows but not the organization row; new pods do not see it. Accepted: OSS self-hosting runs one API process, so the window does not exist there.
- Rollback to old code: rows written by M1 (P1, P2a, seeded rows, organization-wide role changes) are valid rows for the old code. The unique index stays. Demo rows do not come back.

## 2. Core types

### 2.1 `oss/src/core/memberships/dtos.py` (NEW)

```python
class MembershipPolicy(str, Enum):
    ORGANIZATION_WIDE = "organization_wide"  # OSS
    PROJECT_ROWS = "project_rows"  # EE


class MembershipSource(str, Enum):
    ORGANIZATION = "organization"
    PROJECT = "project"


class ProjectScope(BaseModel):
    project_id: UUID
    organization_id: UUID
    workspace_id: UUID  # routing and the workspace mirror, until M4
    organization_owner_id: Optional[UUID] = None
    is_default: bool


class ProjectSummary(ProjectScope):  # the project list response needs the names
    project_name: str
    workspace_name: str
    organization_name: str


class OrganizationMember(BaseModel):
    organization_id: UUID
    user_id: UUID
    role: str


class ProjectMember(BaseModel):
    project_id: UUID
    user_id: UUID
    role: str


class ProjectMembership(BaseModel):  # resolver output; M2 caches it, so every nullable field has a default
    project_id: UUID
    user_id: UUID
    organization_id: UUID
    role: Optional[str] = None  # None: an EE project row with a null role (section 3.4)
    source: MembershipSource
    is_organization_owner: bool = False


class MembershipRow(BaseModel):  # DAO output for one (user, project); never returned by the service
    summary: ProjectSummary
    has_organization_row: bool = False
    organization_role: Optional[str] = None  # the oldest organization row's role
    has_project_row: bool = False  # row presence; a present row can have a null role
    project_role: Optional[str] = None  # the oldest project row's role


class ProjectListing(BaseModel):  # service output for the project routes
    membership: ProjectMembership
    summary: ProjectSummary


class MembershipWriteResult(BaseModel):  # DAO writer output, for the audit log
    user_id: Optional[UUID] = None
    previous_role: Optional[str] = None
    inserted_count: int = 0
    deleted_invitation_count: int = 0


class CreatedProject(BaseModel):  # DAO create_project output
    scope: ProjectScope
    seeded_count: int = 0
```

"Oldest" orders by `created_at ASC NULLS LAST, id ASC` everywhere.

### 2.2 `oss/src/core/memberships/types.py` (NEW): domain exceptions

```python
class MembershipError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class OrganizationOwnerProtected(MembershipError): ...  # set_member_role, remove_member on organizations.owner_id
class MemberNotFound(MembershipError): ...  # set_member_role(must_exist=True), transfer_ownership: no organization row
class OrganizationNotFound(MembershipError): ...  # transfer_ownership
class WorkspaceNotFound(MembershipError): ...  # create_project: workspace outside the organization
class MembershipsServiceNotRegistered(RuntimeError): ...
```

Each exception carries `organization_id` and, where it applies, `user_id` or `workspace_id`, set in `__init__`.

### 2.3 `oss/src/core/access/dtos.py` (NEW)

```python
class RoleRequirement(BaseModel):
    role: str  # slug; the legacy role=... check


Action = Union[Permission, RoleRequirement]  # Permission from oss.src.core.access.permissions.types


class DecisionReason(str, Enum):
    ROLE = "role"
    PROJECT_OWNER = "project_owner"
    ORGANIZATION_OWNER = "organization_owner"
    RBAC_NOT_ENTITLED = "rbac_not_entitled"
    NOT_MEMBER = "not_member"
    MISSING_CAPABILITY = "missing_capability"
    # M2 adds PRINCIPAL_INACTIVE, RESTRICTED_BY_AUTHORITY. M3 adds RESOURCE_DENIED.


class Decision(BaseModel):
    allowed: bool
    reason: DecisionReason
```

Construct with keywords: `Decision(allowed=False, reason=DecisionReason.NOT_MEMBER)`.

### 2.4 `oss/src/core/access/types.py` (NEW): exceptions

```python
class AccessError(Exception):  # base for the access domain; M2 derives its exceptions from it
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class InvalidRoleRequirement(AccessError): ...  # message "Invalid role specified" (today's text)
class InvalidPermission(AccessError): ...  # message "Invalid permission specified" (today's text)
class AccessServiceNotRegistered(RuntimeError): ...  # wiring error, not a domain error
```

## 3. Core interfaces

### 3.1 `oss/src/core/memberships/interfaces.py` (NEW)

```python
class MembershipsDAOInterface(ABC):
    # readers: each is ONE SQL statement (the hot paths stay at today's statement count)
    @abstractmethod
    async def fetch_membership_row(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
    ) -> Optional[MembershipRow]: ...  # None when the project does not exist

    @abstractmethod
    async def list_membership_rows(
        self,
        *,
        user_id: UUID,
    ) -> List[MembershipRow]: ...  # one row per project of every organization with an organization row for the user (duplicate organization rows count once: the oldest)

    @abstractmethod
    async def fetch_organization_member(
        self,
        *,
        organization_id: UUID,
        user_id: UUID,
    ) -> Optional[OrganizationMember]: ...  # oldest row; invite accept "already accepted"

    @abstractmethod
    async def list_projects(
        self,
        *,
        organization_ids: Sequence[UUID],
    ) -> List[ProjectScope]: ...  # project ids for invalidation after a write

    # writers: one transaction each, under the organization lock
    @abstractmethod
    async def set_member_role(
        self,
        *,
        organization_id: UUID,
        user_id: UUID,
        role: str,
        #
        join_project_ids: Sequence[UUID] = (),  # projects of organization_id only; other ids are ignored
        join_all_projects: bool = False,  # targets read inside the lock
        must_exist: bool = False,  # the role endpoint must not add a person
    ) -> MembershipWriteResult: ...  # raises OrganizationOwnerProtected, MemberNotFound

    @abstractmethod
    async def remove_member(
        self,
        *,
        organization_id: UUID,
        email: str,  # the endpoint also removes invitations of an email with no user
    ) -> MembershipWriteResult: ...  # user_id None when only invitations were removed
    # raises OrganizationOwnerProtected

    @abstractmethod
    async def create_project(
        self,
        *,
        organization_id: UUID,
        workspace_id: UUID,
        name: str,
        is_default: bool,
    ) -> CreatedProject: ...  # raises WorkspaceNotFound

    @abstractmethod
    async def transfer_ownership(
        self,
        *,
        organization_id: UUID,
        new_owner_id: UUID,
        current_owner_id: UUID,
    ) -> MembershipWriteResult: ...  # inserted_count = owner rows seeded; raises OrganizationNotFound, MemberNotFound
```

`fetch_membership_row` is one statement: `projects` joined to `workspaces` and `organizations`, with two `LEFT JOIN LATERAL (SELECT role ... ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 1)` subqueries on `organization_members (organization_id, user_id)` and `project_members (project_id, user_id)`; `has_*_row` is "the lateral row exists". `list_membership_rows` is the same statement driven by the user's organization rows, ordered by `organization_id`, then `projects.created_at`. The `oss000000040` indexes serve both.

Write semantics. Every writer runs in `get_transactions_engine().transaction()` (its own connection; `session()` is task-scoped and commits on the first nested exit) and first takes `pg_advisory_xact_lock(hashtextextended('memberships:' || :organization_id, 0))`.

| Method | Steps inside the transaction |
| --- | --- |
| `set_member_role` | 1. `organizations.owner_id = user_id` → `OrganizationOwnerProtected`. 2. Read the oldest organization row; none and `must_exist` → `MemberNotFound`. 3. Update that row's role, or insert it. 4. Set `role` on the user's existing project rows in the organization's projects. 5. Targets = `join_project_ids`, or every project of the organization when `join_all_projects`; insert missing rows `ON CONFLICT (project_id, user_id) DO NOTHING`. A removed row comes back only when its project is a target. 6. Workspace mirror (until M4): update the role on the user's workspace rows in the organization; insert a row for each workspace of a target project when missing. |
| `remove_member` | 1. Find the user by `users.email`. 2. User is `organizations.owner_id` → `OrganizationOwnerProtected`, nothing written. 3. User exists: delete their project rows in the organization's projects, workspace rows in its workspaces, organization rows. 4. Delete `project_invitations` for that email in the organization's projects. |
| `create_project` | 1. Workspace not in the organization → `WorkspaceNotFound`. 2. Default handling as today's `create_workspace_project`: `is_default`, or no default in the workspace, unsets other defaults in the workspace and sets this one. 3. Insert the project. 4. `INSERT INTO project_members (id, user_id, project_id, role, created_at, updated_at) SELECT gen_random_uuid(), user_id, :project_id, role, now(), now() FROM (SELECT DISTINCT ON (user_id) user_id, role FROM organization_members WHERE organization_id = :org ORDER BY user_id, created_at ASC NULLS LAST, id ASC) m`. One statement, whatever the member count (an organization can have tens of thousands of members). `project_members.id` has no database default, so every literal insert selects `gen_random_uuid()` per row; ORM inserts pass an explicit `uuid7()` per row. A failure in step 4 rolls back step 3. |
| `transfer_ownership` | 1. Organization missing → `OrganizationNotFound`. 2. New owner has no organization row → `MemberNotFound`. 3. Swap the two users' organization roles, and their workspace roles in every workspace where both have a row (today's `db_manager.transfer_organization_ownership`). 4. Insert an `owner` project row for the new owner in every project of the organization `ON CONFLICT DO NOTHING`. The new owner's existing rows and the former owner's rows keep their roles, as today. 5. Set `owner_id`, `updated_at`, `updated_by_id`. |

### 3.2 `oss/src/core/memberships/service.py` (NEW)

```python
class MembershipsService:
    def __init__(
        self,
        *,
        memberships_dao: MembershipsDAOInterface,
        policy: MembershipPolicy,
    ): ...

    # readers: one DAO call each
    async def resolve(self, *, user_id: UUID, project_id: UUID) -> Optional[ProjectMembership]: ...  # calls _read_membership; M2 adds its cache here
    async def is_member(self, *, user_id: UUID, project_id: UUID) -> bool: ...  # resolve(...) is not None
    async def list_for_user(self, *, user_id: UUID) -> List[ProjectListing]: ...  # not cached
    async def fetch_for_user(self, *, user_id: UUID, project_id: UUID) -> Optional[ProjectListing]: ...
    async def fetch_organization_member(self, *, organization_id: UUID, user_id: UUID) -> Optional[OrganizationMember]: ...  # invite accept "already accepted", the unassign-role endpoint

    # writers: DAO write, then invalidate_access_caches (section 6).
    # actor_user_id is used only for the audit log (technical design section 5).
    async def set_member_role(
        self,
        *,
        organization_id: UUID,
        user_id: UUID,
        role: str,
        #
        join_project_ids: Sequence[UUID] = (),
        join_all_projects: bool = False,
        must_exist: bool = False,
        actor_user_id: Optional[UUID] = None,
    ) -> None: ...
    async def remove_member(
        self,
        *,
        organization_id: UUID,
        email: str,
        #
        actor_user_id: Optional[UUID] = None,
    ) -> Optional[UUID]: ...
    async def create_project(
        self,
        *,
        organization_id: UUID,
        workspace_id: UUID,
        name: str,
        is_default: bool,
        #
        actor_user_id: Optional[UUID] = None,
    ) -> ProjectScope: ...
    async def transfer_ownership(
        self,
        *,
        organization_id: UUID,
        new_owner_id: UUID,
        current_owner_id: UUID,
    ) -> None: ...  # the actor is current_owner_id


def register_memberships_service(*, memberships_service: MembershipsService) -> None: ...
def get_memberships_service() -> MembershipsService: ...  # raises MembershipsServiceNotRegistered
```

One policy function, `_apply_policy(row: MembershipRow) -> Optional[ProjectMembership]`, serves `resolve`, `list_for_user` and `fetch_for_user`:

1. No row (unknown project): None.
2. `has_organization_row` false: None (both editions).
3. `ORGANIZATION_WIDE`: role = `organization_role`, `source=organization`.
4. `PROJECT_ROWS`: `has_project_row` false → None; else role = `project_role` (may be None), `source=project`.

`is_organization_owner` = `row.summary.organization_owner_id == user_id`. `resolve` calls the private `_read_membership(*, user_id, project_id)` (`fetch_membership_row` + `_apply_policy`), so M2 adds the `resolve_membership` cache inside `resolve` and changes no caller. `list_for_user` = `list_membership_rows` + `_apply_policy`, dropping None.

### 3.3 `oss/src/core/access/interfaces.py` (NEW), adapters

```python
class RbacEnforcementInterface(ABC):
    @abstractmethod
    async def is_enforced(self, *, organization_id: UUID) -> bool: ...


# oss/src/core/access/rbac.py (NEW)
class AlwaysEnforcedRbac(RbacEnforcementInterface): ...  # True


# ee/src/core/access/rbac.py (NEW)
class EntitlementsRbacEnforcement(RbacEnforcementInterface): ...
# check_entitlements(key=Flag.RBAC, scope=scope_from(organization_id=...))[0]
```

### 3.4 `oss/src/core/access/service.py` (NEW)

```python
class AccessService:
    def __init__(
        self,
        *,
        memberships: MembershipsService,
        rbac: RbacEnforcementInterface,
    ): ...

    async def check_capability(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
        action: Action,
    ) -> Decision: ...  # raises InvalidRoleRequirement, InvalidPermission (members only, as today)


def register_access_service(*, access_service: AccessService) -> None: ...
def get_access_service() -> AccessService: ...  # raises AccessServiceNotRegistered
```

`check_capability` order (CONTRACT section 6, step 1, then step 3):

1. `resolve` → None: `Decision(allowed=False, reason=NOT_MEMBER)`.
2. Not `rbac.is_enforced(organization_id=...)`: allow, `RBAC_NOT_ENTITLED`.
3. `is_organization_owner`: allow, `ORGANIZATION_OWNER`.
4. Role `owner`: allow, `PROJECT_OWNER`. Role None (an EE project row with a null role; the schema allows them): steps 2 and 3 still apply; steps 5 and 6 deny `MISSING_CAPABILITY` (fail closed).
5. `RoleRequirement`: `get_role("project", slug)` is None → `InvalidRoleRequirement`; exact match → allow, `ROLE`; else deny, `MISSING_CAPABILITY`.
6. `Permission`: unknown → `InvalidPermission`; `get_role_permissions("project", role)` holds `"*"` or the value → allow, `ROLE`; else deny, `MISSING_CAPABILITY`. An organization role slug that the `project` catalog does not define gives no permissions and logs `[access] undefined role slug`.

### 3.5 `oss/src/core/access/permissions/service.py` (MODIFIED): the wrapper

```python
async def check_action_access(
    user_uid: str,
    project_id: Optional[str] = None,
    permission: Optional[Permission] = None,
    role: Optional[Union[RequiredRole, str]] = None,
) -> bool: ...
```

Signature, argument checks, messages and return type unchanged. Body: today's argument checks first; then `get_access_service()` (an unregistered process raises, also on a cache hit); then today's cache read (namespace `check_action_access`, same key with `get_controls_hash()`); then `check_capability(...)`; `set_cache(value=decision.allowed)`; return `decision.allowed`.

Deleted from this module: `check_user_access_to_workspace`, `check_rbac_permission`, `check_project_has_role_or_permission`, `_get_workspace_member_ids`, `_get_project_member_role`, `_is_demo_member`, `_project_is_owner`, `_project_has_role`, `_project_has_permission`, and the ORM class imports. Kept: `check_user_org_access` (`ee/src/apis/fastapi/organizations/router.py`) and, for its `check_owner=True` branch, the `db_manager` import (`get_user_with_id`, `get_organization`); `check_action_access` itself reads no `db_manager` function.

### 3.6 Import boundary

`oss/src/core/memberships/*` and `oss/src/core/access/{dtos,types,interfaces,rbac,service}.py` import no `oss.src.services.db_manager`, no `oss.src.models`, no `ee.*`. `oss/src/dbs/postgres/memberships/dao.py` imports the existing ORM classes from `oss.src.models.db_models` (a second mapping of the same tables would conflict) and maps them in `mappings.py`: `map_project_scope_dbe_to_dto`, `map_membership_row_to_dto`, `map_organization_member_dbe_to_dto`.

## 4. API surface

No new route and no new model. `ProjectsResponse.is_demo` is removed; regenerate the Fern client.

### 4.1 Project routes (`oss/src/routers/projects_router.py`)

Organization-level acts authorize on the default project of the request's workspace, as the legacy workspace endpoints do. Acts on one project authorize on that project. Every check goes through `check_action_access`, so the membership gate runs first and the EE no-RBAC and organization-owner shortcuts apply only to members. The permission names are the existing ones.

| Route | Order of checks | Errors |
| --- | --- | --- |
| `GET /projects/` | `list_for_user` (one statement, as today); `user_role` = resolved role. | 404 "No projects found." as today |
| `GET /projects/{project_id}` | `fetch_for_user` (also for `current`; one statement, as today). | 404 "Project not found" |
| `POST /projects/` | 1. `request.state.workspace_id` and `organization_id` present, else 400. 2. `check_action_access(project_id=<default project of the workspace>, permission=CREATE_WORKSPACE)`, else 403. 3. Name not empty, else 400. 4. EE `project_limit_refusal`. 5. `MembershipsService.create_project(organization_id=request.state.organization_id, workspace_id=request.state.workspace_id, ...)`; `WorkspaceNotFound` → 400. 6. Default evaluators and environments (unchanged). 7. Response from `fetch_for_user`. | 400, 403, 201 |
| `PATCH /projects/{project_id}` | 1. `fetch_for_user(target)` None → 404. 2. `check_action_access(project_id=target, permission=EDIT_WORKSPACE)`, else 403. 3. Today's body checks and writes. | 404, 403, 400 |
| `DELETE /projects/{project_id}` | 1. Project missing, or `project.workspace_id != request.state.workspace_id` (today's tenant check) → 404. 2. `fetch_for_user(target)` None → 404. 3. `check_action_access(project_id=target, permission=DELETE_WORKSPACE)`, else 403. 4. Default project → 400 (today). | 404, 403, 400 |

With the default catalog: owners and admins create and update; only owners delete (`DELETE_WORKSPACE` is in the owner set only). In an EE organization without the RBAC entitlement, every member passes, as for every other permission today. The 403 body is today's text in `workspace_router.py`: `{"detail": "You do not have permission to perform this action. Please contact your Organization Owner"}`. `/m` already shows a string `detail` from a failed create, so no frontend change is needed.

### 4.2 Workspace and organization routes

| Route | Change |
| --- | --- |
| `POST /workspaces/{workspace_id}/roles/` | `set_member_role(..., must_exist=True)` for the whole organization. Permission unchanged: `MODIFY_USER_ROLES` on the workspace's default project. |
| `DELETE /workspaces/{workspace_id}/roles/` | Organization role equals `role` → `set_member_role(role="viewer", must_exist=True)`; else no write, returns `True`. |
| `DELETE /workspaces/{workspace_id}/users/` | `check_action_access(role=RequiredRole.ADMIN)` on the default project, then `remove_member`. EE `Gauge.USERS` unchanged. |
| `PUT /organizations/{organization_id}/workspaces/{workspace_id}` | `check_action_access(permission=EDIT_WORKSPACE)` on the default project (replaces `check_rbac_permission`). `organization_router.py` keeps its `get_user_org_and_workspace_id` import: `list_organizations` uses it in EE. |
| `POST /organizations/{organization_id}/workspaces/` | Permission unchanged (organization owner only). `db_manager.create_workspace_db_object` keeps the workspace insert and the creator's workspace row, then calls `MembershipsService.create_project(is_default=True)` for the default project, which seeds every organization member. The direct `create_default_project` and `create_project_member` calls are deleted. Seeds (testsets, evaluators, environments) unchanged. |
| `POST /organizations/{organization_id}/transfer/{new_owner_id}` | Permission unchanged (owner only). Calls `MembershipsService.transfer_ownership`; `OrganizationNotFound` and `MemberNotFound` → today's 400 "Invalid organization or new owner for ownership transfer". `db_manager.transfer_organization_ownership` is deleted. |
| invite accept (`accept_organization_invitation`) | `set_member_role(role=invitation.role, join_all_projects=True)`. "Already accepted" = organization row exists. |

Router error mapping (today's text and shape): `OrganizationOwnerProtected` → 403 `{"detail": {"message": "<the 403 text above>"}}`, today's owner-protection shape that `/w` reads; `MemberNotFound` from the role endpoint → 404 `"User not found."`; `WorkspaceNotFound` → 400 `"Workspace and organization context are required"`.

### 4.3 Bearer middleware (`oss/src/middlewares/auth.py`)

The `?project_id=` branch of `verify_bearer_token` calls `get_memberships_service().is_member(...)` instead of `db_manager.project_member_exists`. The deny stays 401 `Unauthorized` and is not cached. The `?workspace_id=` branch keeps `db_manager.workspace_member_exists` until M4.

## 5. Runner and SDK surface

None.

## 6. Cache invalidation

One helper in `oss/src/core/memberships/service.py`, the only place that knows the namespaces. It already clears `resolve_membership`, the per (user, project) cache of a membership or its absence that M2 adds to `resolve`, so every M1 mutation clears it from the day M2 ships. M2 removes the `check_action_access` line, in the same PR as its cache change:

```python
async def invalidate_access_caches(*, user_ids: Sequence[UUID], project_ids: Sequence[UUID]) -> None:
    # for each user u and project p:
    #   invalidate_cache(namespace="check_action_access", project_id=str(p), user_id=str(u))
    #   invalidate_cache(namespace="verify_bearer_token", project_id=str(p), user_id=str(u))
    #   invalidate_cache(namespace="resolve_membership", project_id=str(p), user_id=str(u))
    # for each user u, once: invalidate_cache(namespace="verify_bearer_token", user_id=str(u))
```

The admin simple-accounts organization membership writer stores the role it is given (it used to store `viewer`), because OSS now reads the organization role.

Called after the commit. Users: the changed user; for `transfer_ownership`, both users. Projects: every project of the organization, read after the commit. With an empty `user_ids`, the helper calls `invalidate_cache(namespace=<ns>, project_id=str(p))` for each namespace and project (user wildcard); `create_project` uses this for the new project. The admin tools in `oss/src/core/accounts/service.py` that create or delete a membership row, or transfer ownership, also call the helper after commit, with the affected user ids (captured before a delete) and the organization's project ids: today's `check_action_access` cache holds a cached `False`, and M2's cache holds an absence, so an admin add without invalidation stays denied for up to 300 s. Per-project calls are needed because `_pack` pads a missing `project_id` with `------------`, which is not a wildcard (`oss/src/utils/caching.py`).

Each `invalidate_cache` call is awaited, so a writer returns only after Redis holds no entry for the changed user and project. A failure is logged and does not fail the writer.

Revocation takes effect at the next decision. It can take up to `AGENTA_CACHE_TTL` (300 s) in two known cases: Redis invalidation fails, or a read that started before the mutation committed refills the old entry after the invalidation. Today's cache has the same race. M1 accepts it as a known limit and adds no lock or version counter. M2 states the same bound (M2 technical design section 8).

## 7. Script `entrypoints/memberships_check.py`

Runs from a checkout of the release branch against a database. No separate deploy.

| Flag | Effect | Exit codes |
| --- | --- | --- |
| `--report [--out DIR]` | Read only. Writes `report.json` with counts and id lists for P1 to P12 per organization. | 0 |
| `--apply` | In this order: (1) removes the newer rows of each duplicate group counted over non-demo rows only (`is_demo IS NOT TRUE`), keeping the oldest by `(created_at ASC NULLS LAST, id ASC)` (P5); demo rows are never deleted or kept by `--apply`, `oss000000044` deletes them, so a demo row never wins over a real row; (2) adds P2b rows (EE), excluding every (user, organization) pair that has a demo row in that organization, and only while `oss000000044` is not applied (`alembic_version_oss` below it, or absent); after the revision has run, P2b is skipped with a message, because former demo-only users can no longer be told apart. Idempotent across reruns. Prints every deleted row with its role. | 0, or 1 on error |
| `--materialize` | EE only, after `ee0000000002`. Materializes the effective OSS membership as rows, paged by organization and, inside an organization, by 1,000 members per statement. | 0; 1 when the unique index is missing |

## 8. Denial reasons and codes

| Where | Value |
| --- | --- |
| `Decision.reason`, deny | `not_member`, `missing_capability` |
| `Decision.reason`, allow | `role`, `project_owner`, `organization_owner`, `rbac_not_entitled` |
| Bearer | 401 `Unauthorized`, log reason unchanged |
| Routers | section 4 |

`check_action_access` returns a boolean, so routes do not expose the reason.
