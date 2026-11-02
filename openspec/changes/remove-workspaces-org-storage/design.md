# Design: remove workspaces and key new mount storage by organization (M4)

## Context

M4a (the stored mount prefix) has no dependency. Only M4b's workspace part starts after M1: no permission decision reads workspace membership, and `MembershipsDAOInterface` owns membership writes. Shared rules: CONTRACT.md sections 1, 2, 9 and 12. Code facts: `research-remove-workspaces-org-storage.md`.

## Decisions

### D1. The row stores the namespace-relative prefix

New column `mounts.storage_prefix VARCHAR NOT NULL` from M4a (for example `mounts/<scope_id>/<mount_id>`, no namespace, no trailing slash). The deployment namespace (`env.store.namespace`) stays configuration and goes in front at use, so a preview clone or a namespace change does not invalidate rows. `MountsService._storage_key(mount, path)` builds `[<namespace>/]<storage_prefix>/<path>` and no longer takes `project_id`. `sign_mount_credentials` scopes STS to the same base.

### D2. The insert writes the mount id and the prefix

M4a: the DAO mints the mount id and writes the project layout in the insert. M4b mount step: the DAO writes the organization layout in the insert statement, reading `projects.organization_id` in the same statement. The create methods keep their signatures. Core defines the layout; a Postgres test pins the SQL to it. On the upsert paths (agent and session mounts), the existing row and its prefix win.

### D3. The per-mount predicate

The predicate arrives with the M4b mount step, in `core/mounts/service.py` next to `is_protected_mount`. `organization_storage_prefix(organization_id, mount_id) = "mounts/<organization_id>/<mount_id>"`. `is_organization_keyed(mount, organization_id)` is true exactly when the stored prefix equals that value. M6 owns the move set and the refusal (CONTRACT.md section 10).

### D4. Mount rollout: M4a, then the M4b mount step

Old pods compute keys from `project_id`, so the organization layout waits until none does. M4a, in one revision, adds the column, a `BEFORE INSERT` trigger that fills the project layout for inserts from previous-release pods, the backfill and `NOT NULL`, and switches every reader to the stored prefix. New mounts keep the project layout, so previous-release pods agree on every path. The M4b mount step, one release later, drops the trigger and starts the organization layout. No NULL rule anywhere.

### D5. Workspace removal order

The cascade from `projects.workspace_id` goes first.

| Step | Schema | Code |
| --- | --- | --- |
| 1. Accept | Drop `projects_workspace_id_fkey`; `projects.workspace_id` nullable; the M4b mount step (organization layout, trigger drop). | Accept organization ids and legacy workspace ids (mapped through `workspaces`). Responses unchanged. |
| 2. Switch | Repair projects whose workspace belongs to another organization (`workspace_id` NULL); one default project per organization (workspace-removal spec); EE meter re-key (D7). Data only. | Responses per D6. Stop writing `workspaces`, `workspace_members`, `projects.workspace_id`, including the legacy mirror in M1's `add_member`, `set_member_role` and `remove_member`. Tokens carry `workspace_id = organization_id`. `AuthScope` drops `workspace_id`. |
| 2b. Stop reading | Rerun the step-2 repair, consolidation and meter fold. Data only. | Remove every read and write of `workspaces`, `workspace_members`, `projects.workspace_id` and `meters.workspace_id`, including the mapping of legacy workspace ids. |
| 3. Contract | Drop `projects.workspace_id`, `workspace_members`, `workspaces`, `WorkspaceScopeDBA`, `meters.workspace_id`. | None: step 2b removed every reader. Readers ignore the token claim; signers keep it while `/w` lives. |

### D6. Classic compatibility adapter

The rule is CONTRACT.md section 1. Names follow ids. Until step 2b, a legacy workspace id of the same organization is also accepted. The admin account graph maps `workspaces` entries to the organization.

| Surface | After step 2 |
| --- | --- |
| `GET /projects`, `GET /projects/{id}` | `workspace_id = organization_id`, `workspace_name` = organization name |
| `GET /organizations/`, `GET /organizations/{id}` | `workspaces = [organization_id]`; `default_workspace.id = organization_id`; its members are the members of the project that step 1 selected for the organization's details (the same people as before), with the organization role |
| `GET /workspaces/` | one item per organization of the user |
| `GET /workspaces/roles/`, `GET /workspaces/permissions/`, the `workspace` key of `GET /access/roles` | unchanged; the role catalog keeps the `workspace` scope (`SCOPES` and the EE mirror in `role_overrides.py`) until `/w` is retired |
| `POST /workspaces/{id}/roles/` | `set_member_role(organization_id={id}, ...)` |
| `DELETE /workspaces/{id}/roles/` | `set_member_role(..., role="viewer")`, as M1 maps it |
| `DELETE /workspaces/{id}/users/` | `remove_member(organization_id={id}, ...)`; owner refused |
| `/organizations/{org}/workspaces/{ws}/invite`, `/resend`, `/accept` | `{ws}` must equal `{org}` (or, until step 2b, be a workspace of `{org}`) |
| `POST /organizations/{org}/workspaces/`, `PUT /organizations/{org}/workspaces/{ws}` | HTTP 410, "Workspaces were removed. Projects belong to the organization." |
| `?workspace_id=` on Bearer auth | an organization id; with `project_id`, the project must belong to it, else 401 |
| `scope_type="workspace"` in `/access` | compares with `organization_id` |
| Emails and session links | `/w/{organization_id}/p/{project_id}`, `/m/w/{organization_id}/p/...` |

In step 1 the same inputs are accepted (organization id, or a workspace of the same organization), and every answer for an existing row stays as it is, except the organization-id list item for a member without a workspace row and the workspace-only membership check. Bearer `?workspace_id=` without `project_id` resolves the default project of that workspace or organization (its own default, else the organization's) and checks project membership through the resolver; the auth context keeps the organization of the workspace, as before. Step 1 keeps today's answer of `get_project_by_workspace` for a workspace that has projects but no default project (its own project), while the Bearer default-project lookup answers the organization default; step 2 makes the two agree before it stops writing workspace rows.

Rename returns 410 and does not rename the organization: no classic screen calls it. `/m` resolves `/m/w/<segment>/p/<project_id>` by the project id and rewrites a wrong segment.

### D7. Meter re-key that keeps counts

`MeterScope` becomes `organization -> project -> user`, and `compute_meter_id` drops the `wrk` part. Organization-scope meters (all billed meters) keep their ids. The re-key folds colliding rows by adding `value` and `synced`, which keeps the unreported delta exact; step 2b repeats the fold for rows that step-1 pods wrote (meter-scope spec). During the step 2 rollout a user's daily `TRACES_RETRIEVED` can count under two ids, so the quota may admit a few extra reads.

The re-key walks the rows that have a workspace once, in `meter_id` order. For each batch, one statement deletes the old rows and inserts their values under the new id, adding into a row that already has it. A concurrent write from an accept-step pod waits for the row lock and then writes a new row under its old id; switch-step code never reads a row with a workspace as the current one, and bumps every row by its stored id, so the step-2b fold takes that row. The re-key holds the usage-report lock for its whole run (it waits for a running report, and no report starts until it ends), and a report bump only sets `synced` when the row still has the `synced` value the report read. A row with a workspace and no project matches no quota; the revision refuses to run when one exists.

## Data structures

The schema per step is in D5. `mounts.storage_prefix VARCHAR NOT NULL` (M4a) is the only new column. Everything is `core_oss` except `meters`, which is `core_ee` only (CONTRACT.md section 12). Step 3 turns `ScopeDBA` into a mixin without workspace.

## Interfaces

```python
# api/oss/src/core/mounts/
class Mount(Identifier, Slug, Header, Lifecycle):
    project_id: UUID
    storage_prefix: str = Field(exclude=True)  # namespace-relative, no trailing slash; not serialized

class MountsDAOInterface(ABC):  # signatures unchanged; the DAO writes the prefix in the insert
    async def create_mount(self, *, project_id, user_id, mount_create) -> Mount: ...
    async def upsert_mount(self, *, project_id, user_id, mount_create) -> Mount: ...  # existing row wins

# M4a
MOUNTS_KEY_ROOT = "mounts"
def project_storage_prefix(*, project_id: UUID, mount_id: UUID) -> str: ...
# the M4b mount step
def organization_storage_prefix(*, organization_id: UUID, mount_id: UUID) -> str: ...
def is_organization_keyed(*, mount: Mount, organization_id: UUID) -> bool: ...
```

`AuthScope` loses `workspace_id`. `MeterScope` is `organization_id`, `project_id` (requires the organization), `user_id` (requires the project). M4 adds no membership mutation method and no membership policy. Step 1 adds one reader, `MembershipsService.read_membership`: the same edition policy and DAO read as `resolve`, without its cache, only for callers whose outcome another cache already keeps (the Bearer workspace-only and no-parameter branches). The layout rule lives in `core/mounts/types.py`. In the M4b mount step, the DAO builds the equivalent SQL expression inside the insert. A Postgres test checks that its result equals `organization_storage_prefix`.

## Migration and mixed-version behavior

Gate: M4a (`NOT NULL`) needs `migration:destructive-approved`. Step 1 is reported (`drop_constraint`) and passes. The M4b mount step revision reports nothing. Step 2 (one-way data changes: the cross-organization repair, the default consolidation, the meter re-key), step 2b (the reruns) and step 3 (drops) need `migration:destructive-approved`. Dump `workspaces` and `workspace_members` before step 3.

| Rollout | Old pods on the new schema | New pods on old data |
| --- | --- | --- |
| M4a | Previous-release pods insert mounts without the column; the trigger fills the project layout, which is the key they compute. Re-binds succeed and keep the stored prefix. Rollback of the application is safe. | Every row is backfilled in the same revision. |
| Step 1 | Pre-step-1 pods write `workspace_id`; M4a pods write the project layout explicitly and read the stored prefix, so they serve organization-keyed mounts and need no trigger. Pods of the release before step 1 still write `workspace_id`; a workspace that such a pod deletes through the admin API during the rollout keeps its projects. | Every existing row keeps its answers. Step-1 pods also serve the rows step 2 writes (a project with a NULL `workspace_id`, an organization without workspace rows), so the step-2 rollout and a rollback to step 1 are safe. |
| Step 2 | Step-1 pods read stored prefixes, accept organization ids, and serve the rows step 2 writes. They still write workspace rows for organizations they create, a second default project through a workspace-scoped write, and meter rows with a workspace; step-2 readers ignore all three (the meter rows are folded in step 2b). | Step-2 pods answer the organization id for every legacy row. They read auth states and tokens written by step-1 pods with the organization id, never the cached workspace id. |
| Step 2b | Step-2 pods still read the workspace tables and columns, which exist. | None: 2b data is step-2 data. |
| Step 3 | Step-2b pods never read the dropped columns or tables. | None. |

Durable state across rollouts: signed tokens (the claim stays), auth caches (step 1 accepts both id forms) and meter rows (the fold). No queued work carries a workspace id.

## Risks

- M4a: a trigger is a new pattern in these migrations. It has a `WHEN` guard that is false for M4a code, and the M4b mount step drops it.
- The M4b mount step: a deployment that skips the M4a release runs pods older than M4a during the rollout. Their mount inserts fail until those pods are gone (no trigger), and they compute keys from `project_id`, so they cannot read mounts in the organization layout. Finish the M4a release on every pod before starting the mount step.
- Multi-workspace EE organizations lose workspace grouping and extra default projects. M1's preflight reports them; the owner accepted the wider access (CONTRACT.md section 2).
- After step 2b, a link with only a legacy workspace id fails in `/w`.
- One-way: objects under `mounts/<organization_id>/` stay there; dropped workspace tables and old meter ids are gone (counts kept).

## Open questions

1. Workspace create and rename return 410, and rename does not rename the organization. Recommendation: accept; no classic screen calls them.
2. Multi-workspace EE organizations lose their grouping. Recommendation: accept, and notify each affected organization when M1's count is above zero.
