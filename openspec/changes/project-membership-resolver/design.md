# Design: project membership resolver (M1)

Shared rules: CONTRACT.md sections 1, 2, 6 and 12; only M1's additions are here. Exact names, signatures and SQL: `docs/design/sharing-program/interfaces/m1/` (`interfaces.md`, `technical-design.md`). Paths are relative to `api/`.

## Decisions

### D1. Eligibility before every shortcut

`AccessService.check_capability` resolves membership first (CONTRACT.md section 6, step 1); the shortcuts run only for a member (step 3). Today the workspace check is the only organization gate, so removing it without this order would let the shortcuts allow non-members. Users who pass today only by a shortcut get rows (D6: P1, P2a, P2b).

### D2. One resolver, one policy value

`MembershipsService` takes a `MembershipPolicy` chosen once at the composition root from `is_ee()`:

| Policy | Member when | Role | `source` |
| --- | --- | --- | --- |
| `organization_wide` (OSS) | `organization_members` row exists | organization role | `organization` |
| `project_rows` (EE) | `organization_members` row AND `project_members` row | row role (may be null) | `project` |

Row presence decides membership, not the role value. An EE project row with a null role (the schema allows them) is a membership: the no-RBAC and organization-owner shortcuts apply, and role and permission checks deny `missing_capability`. Each membership read is one SQL statement (`fetch_membership_row`, `list_membership_rows`), so `check_action_access`, Bearer project selection, the project list and the project fetch make no more statements than today; one policy function serves all of them. M6 adds one rule before these: a personal project resolves only for its owner. Soft-deleted rows keep counting, as today.

### D3. Organization roles map to project capabilities by slug

Under `organization_wide`, the organization role slug is evaluated in the `project` scope catalog. An undefined slug gives no permissions and is logged.

### D4. Membership writers

`MembershipsDAOInterface` has four writers. Each runs in one transaction under a per-organization advisory lock. The service invalidates the access caches after each commit.

- `set_member_role(organization_id, user_id, role, join_project_ids=(), join_all_projects=False, must_exist=False)`: sets the organization row (inserts it unless `must_exist`), the workspace mirror (until M4) and the user's existing project rows; inserts rows only in the target projects. It refuses the organization owner.
- `remove_member(organization_id, email)`: deletes the user's organization, workspace and project rows in that organization, and the email's pending invitations. It refuses the organization owner.
- `create_project(organization_id, workspace_id, name, is_default)`: inserts the project and one row per current organization member with the organization role. `POST /projects` and the default project of a new workspace both use it.
- `transfer_ownership(organization_id, new_owner_id, current_owner_id)`: swaps the two users' organization and workspace roles as today, swaps their project roles where both have a row (the rule of the admin transfer tool), inserts an `owner` row for the new owner in every project, and sets `owner_id`. Needed because the owner shortcut now runs only for a member.

Literal inserts select `gen_random_uuid()` per row, because `project_members.id` has no database default. Seeding a new project is one statement, whatever the member count. The sync is deleted. Admin tools stay where they are and call the cache invalidation after every membership create, delete and ownership transfer.

### D4a. The demo feature is deleted

Owner decision, 2026-10-22. M1 deletes `ExtrasConfig.demos` (`AGENTA_EXTRAS_DEMOS`, `AGENTA_DEMOS`), the demo code in `oss/src/services/commoners.py`, `_is_demo_member`, `ProjectsResponse.is_demo`, the web reads of `is_demo`, and the config lines in `hosting/` (docker-compose examples, Kubernetes example values, Helm `_helpers.tpl` and `values.schema.json`). The migration deletes the `project_members` rows with `is_demo = true`, because otherwise a former demo row in an EE organization without the RBAC entitlement would get the no-RBAC shortcut, which allows every action. The column stays; M4 drops it. Organization and workspace rows from demo enrollment cannot be told apart from real rows and stay. Out of scope: `organizations.flags.is_demo` and the `isDemo()` helper of `web/oss`.

### D5. Legacy endpoints keep their URLs

| Endpoint | Meaning after M1 |
| --- | --- |
| `POST /workspaces/{id}/roles/` | `set_member_role(must_exist=True)` with the requested role, for the whole organization |
| `DELETE /workspaces/{id}/roles/` | `set_member_role(viewer)` when the removed role is the current one |
| `DELETE /workspaces/{id}/users/` | `remove_member` |
| `POST /organizations/{id}/workspaces/` | default project through `create_project` |
| `POST /organizations/{id}/transfer/{new_owner_id}` | `transfer_ownership` |

The role, remove and update-workspace endpoints authorize with `check_action_access` on the workspace's default project. `check_rbac_permission` and `check_user_access_to_workspace` are deleted.

### D5a. Project routes check a permission

| Route | Target project of the check | Permission | Tenant check |
| --- | --- | --- | --- |
| `POST /projects` | default project of the request's workspace | `create_workspace` | the new project goes into the request's organization and workspace; a workspace outside the organization gives 400 |
| `PATCH /projects/{id}` | the target project | `edit_workspace` | 404 unless the resolver finds a membership in the target |
| `DELETE /projects/{id}` | the target project | `delete_workspace` | 404 unless the target is in the request's workspace (today) and the resolver finds a membership |

A denied check gives 403 with today's text. The EE no-RBAC and organization-owner shortcuts apply to members, as for every other permission.

### D6. Report, repairs and the cutover gate

`entrypoints/memberships_check.py` has `--report` (read only), `--apply` and `--materialize`. It runs from a checkout of the release branch; it is not deployed.

| Id | Check | Edition | Handling |
| --- | --- | --- | --- |
| P1 | organization owner without an organization row | both | migration inserts `owner` |
| P2a | organization owner without a row in a project of the organization | both | migration inserts `owner` |
| P2b | workspace member of a no-RBAC organization without a project row | EE | `--apply` inserts the workspace role, never for a user with a demo row in the organization, and only before `oss000000044` has run |
| P3 | user with organization and project rows but no workspace row (denied today, allowed after) | EE | reported (accepted) |
| P4 | organization with more than one workspace | EE | reported (accepted) |
| P5 | duplicate `(project_id, user_id)` rows | both | **blocks** the unique index revision; `--apply` keeps the oldest non-demo row by `(created_at, id)`; demo rows are left to the revision, so a demo row never wins over a real row |
| P6 | organization role differs from the workspace role (single-workspace organizations) | both | migration copies the workspace role |
| P7 | project row role differs from the organization role | OSS | reported, for release notes |
| P8 | organization member without a row in a project | OSS | reported, for release notes |
| P9 | project row without an organization row | both | reported |
| P10 | soft-deleted membership rows | both | reported |
| P11 | `project_members` rows with `is_demo = true` | both | migration deletes them |
| P12 | duplicate `organization_members` rows | both | reported; the resolver reads the oldest |

P1, P2a, P6 and the demo delete are in a `core_oss` data revision, so self-hosted operators get them without a script. P2b needs the RBAC entitlement, which a migration cannot read.

### D7. Edition switches

- OSS to EE: the runbook runs `--materialize` after `ee0000000002_adopt_oss_database`. A `core_ee` revision cannot do this: it would also run on existing EE databases.
- EE to OSS: access expands to every team project of the organization, with the organization role. The runbook says so.

### D8. Cache and revocation

Each writer invalidates `check_action_access`, `verify_bearer_token` and `resolve_membership` for each affected user and every project of the organization, through one helper, `invalidate_access_caches`. It is the only place that lists the namespaces. `resolve_membership` is the per (user, project) membership cache that M2 (run-principal) adds to `resolve`; M1 clears it from the start, so the M2 cache is never left out of a mutation. Revocation takes effect at the next decision. It can take up to `AGENTA_CACHE_TTL` (300 seconds) in two known cases: the invalidation fails, or a read that started before the mutation committed refills the old entry after the invalidation. Today's cache has the same race; M1 accepts it as a known limit and adds no lock or version counter. In M1 the `check_action_access` cache stays as today; M2 deletes it (CONTRACT.md section 6).

### D9. Audit

The four writers log one structured event each with ids only (organization, project, target user, actor, roles, counts). Denials log at debug level with the reason. No email or credential value is logged. Principal and credential fields on denials are M2.

## Interfaces

Exact code shapes are in `interfaces.md`. Summary:

- `oss/src/core/memberships/`: `MembershipPolicy`, `MembershipSource`, `ProjectScope`, `ProjectSummary`, `OrganizationMember`, `ProjectMember`, `ProjectMembership`, `MembershipRow`, `ProjectListing`, `MembershipWriteResult`, `CreatedProject`; exceptions `MembershipError` and subclasses; `MembershipsDAOInterface` (4 single-statement readers: `fetch_membership_row`, `list_membership_rows`, `fetch_organization_member`, `list_projects`; 4 writers); `MembershipsService` (`resolve`, `is_member`, `list_for_user -> ProjectListing`, `fetch_for_user`, the four writers).
- `oss/src/dbs/postgres/memberships/`: `MembershipsDAO`, `mappings.py`. The project list query lives here, not in `db_manager.py`; `projects_router._project_to_response` takes a `ProjectListing`.
- `oss/src/core/access/`: `RoleRequirement`, `Action = Union[Permission, RoleRequirement]`, `DecisionReason`, `Decision`, `AccessError`, `RbacEnforcementInterface`, `AccessService.check_capability`. EE adapter in `ee/src/core/access/rbac.py`.
- `entrypoints/access.py`: `bootstrap_access()`, called by the API and both workers. An unregistered call raises.

Import boundary: `core/access/{dtos,types,interfaces,rbac,service}.py` and `core/memberships/` import no `db_manager`, `oss.src.models` or `ee.*`.

## Migration and mixed-version behavior

One release (CONTRACT.md section 12):

1. From the release checkout: `--report`, then `--apply`, against each region's database. Rows written are valid for the old code.
2. Deploy. The hook runs the `core_oss` data revision (demo delete, P1, P2a, P6), then the concurrent unique index revision, which stops the release while duplicates exist.

Self-hosted OSS upgrades without a script. Self-hosted EE runs `--apply` first (upgrade notes).

During the rollout old pods use the workspace gate and the sync. An old pod can still add a demo row for a new signup, and an OSS role change on an old pod is not seen by new pods. Both are accepted: the window is minutes, and OSS self-hosting runs one API process. Rollback is safe: the written rows are valid for the old code; demo rows do not come back.

## Open questions

None. Decided: soft-deleted rows keep counting (M4 decides later); new EE projects seed all current organization members; multi-workspace organizations keep their organization roles (P4 accepted).
