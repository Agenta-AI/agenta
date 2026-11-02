# M4b: the mount step and workspace removal step 1 (accept)

Status: built (v0.125.0 scope). Normative rules: `docs/design/sharing-program/CONTRACT.md` sections 1, 2, 9, 12 and 14, and the OpenSpec change `remove-workspaces-org-storage`.

Two parts, two PRs:

- **Mount step** (`feat/m4b-mount-step`, revision `oss000000051`): new mounts store `mounts/<organization_id>/<mount_id>`, written in the insert statement; the M4a fill trigger and its function are dropped; `organization_storage_prefix` and `is_organization_keyed` arrive in core.
- **Workspace accept** (`feat/m4b-workspace-accept`, revision `oss000000052`): no foreign key from `projects.workspace_id` to `workspaces`, the column is nullable; every place that takes a workspace id also takes the organization id and a workspace id of the same organization; projects without a workspace and organizations without workspace rows are served; every response for existing rows stays the same, except the organization-id list item for a member without a workspace row (D-26) and the access changes listed below.

Revision chain on the v0.124.0 base: `... 047 -> 050 -> 051 -> 052`. At the v0.125.0 integration, M3's `048 -> 049` follow `050` and `051` moves after `049`; `052` stays after `051`.

## Decisions

| # | Decision | Why |
| --- | --- | --- |
| D-1 | Two lanes, two PRs, one linear stack on `release/v0.124.0`: `feat/m4b-mount-step` on the release (PR base `release/v0.124.0`), `feat/m4b-workspace-accept` on top of it (PR base `feat/m4b-mount-step`). | Part A needs M4a's column and code (now in the release); Part B edits auth and the memberships DAO in the form M2 left them (also in the release). The two parts share no file. |
| D-4 | Revision ids: Part A `oss000000051`, Part B `oss000000052`. Lane-local parents: `051.down_revision = "oss000000050"`, `052.down_revision = "oss000000051"` (after the restack on v0.124.0). v0.125.0 chain (one head): `... 047 -> 050 -> 048 -> 049 -> 051 -> 052` (v0.124.0 ends at 050; M3 048 follows 050; merge order inside v0.125.0: M3, then the mount step, then accept). At the v0.125.0 retarget: `051.down_revision = "oss000000049"` and `052.down_revision = "oss000000051"`. If M3 is not in v0.125.0: `051 -> 050`, `052 -> 051`. | Central allocation continues after 050. The chain order, not the number, decides the head (RELEASE-v0124.md 1.5). 051 and 052 touch only `mounts` triggers and `projects` constraints; M3's 048/049 touch neither, so the order is free and fixed here once. |
| D-5 | Part B also serves step-2-shaped data (a project with NULL `workspace_id`; an organization or user with no workspace rows). | The spec requires it: design.md mixed-version table "Projects without `workspace_id` are handled since step 1" and the workspace-removal scenario "Old pod during the switch rollout". Step 2 stops all workspace writes, so step-1 pods serve such rows during the step-2 rollout and for as long as a rollback to step 1 lasts. Without it, the step-2 rollout would need downtime. The reader inventory in Task B2 bounds this work. |
| D-6 | The canonical `request.state.workspace_id` is the project's stored `workspace_id`, or the organization id when it is NULL. It never echoes the id form the client sent. The source of `request.state.organization_id` remains the value each branch uses today: the project row in the `project_id` branches, the resolved workspace's organization in the workspace-only and no-parameter branches (the organization itself when the id is an organization id). | Responses, run credentials and EE meter ids (`wrk=` and `org=` parts of `compute_meter_id`) stay identical for every existing project, whatever id the client sends, including the legacy cross-organization project (project in O1, its workspace in O2), whose workspace-only token keeps O2 as today. |
| D-7 | Bearer with `?workspace_id=` and no `project_id` resolves the default project of that workspace or organization (D-10) and checks membership with NEW `MembershipsService.read_membership(*, user_id, project_id)`, the resolver's own one-statement read without the `resolve_membership` cache. It no longer reads `workspace_members`. The Bearer state cache key of this branch gets a version field (D-21). | CONTRACT section 2: one resolver answers membership for Bearer authentication; the M1 spec kept the legacy check "until M4". The request then acts in that project, so the project answer is the right one. Step-2 members have no `workspace_members` row, so the legacy check would deny them. The uncached read replaces today's uncached `workspace_member_exists` statement one for one: no Redis call is added (the Bearer state cache already caches the outcome). Access changes in both directions are listed in "Access changes" below. |
| D-8 | Bearer with `project_id` and `workspace_id`: accept when the workspace id equals the project's `workspace_id` or its `organization_id` (no read), or when it is a workspace of the project's organization (one read, as today). Else 401 (cached deny, as today). The project membership check is unchanged. | Spec D6 and "Mismatched organization". The fast path removes today's workspace read in the normal case. The legacy cross-organization project shape (project in O1, workspace in O2) keeps today's acceptance through the equality with `project.workspace_id`. |
| D-9 | Bearer with no parameters keeps today's choice of workspace (oldest workspace membership); a user without one falls back to the oldest organization membership. Every selection then passes `read_membership` on the selected project (fail closed, 401 not cached), and this branch's cache key carries `"v": "m4b1"`. | CONTRACT section 2: no permission decision reads workspace membership. Statement budget: 3 SQL on the normal path (today 3), 4 on the fallback (today a 401). |
| D-10 | (Built with the deviation below for `get_project_by_workspace`.) `db_manager.get_project_by_workspace` and `db_manager.get_default_project_id_from_workspace` keep their names and signatures and accept either id (one statement each). One new reader, `db_manager.fetch_default_project(*, workspace_or_organization_id)`, returns `DefaultProjectRef(project_id, project_organization_id, project_workspace_id, ref_workspace_id, ref_organization_id)`. All three map the id inside the statement: a workspace id resolves through `workspaces` to its organization, an organization id to itself. The default project of a workspace is its own default when it has one, else the organization's default (D-11 order); that fallback covers a secondary workspace whose default step 2 cleared. | Every route that maps a URL workspace id (`/workspaces/{id}/...`, `/organizations/{org}/workspaces/{ws}/invite` and `/resend`, the members block of `GET /organizations/{id}`) already goes through these two functions, so the routes need no edit. |
| D-11 | When an organization id must be mapped to one workspace or one default project, the rule is the step-2 rule: the `default`-type workspace, else the oldest workspace (by `created_at`, then `id`); a workspace id given explicitly always wins. | One rule for step 1 and step 2 (workspace-removal "One default project per organization"). |
| D-12 | `PUT /organizations/{org}/workspaces/{ws}` (rename) and `POST /organizations/{org}/workspaces/` (create) do not change in step 1. | Step 2 makes both 410; no classic screen calls them (spec open question 1). Accepting an organization id there would add code that lives one release. |
| D-13 | Admin workspace deletion (`db_manager.admin_delete_workspace`, the workspace part of `admin_delete_accounts_batch`) deletes the workspace's projects explicitly, in the same transaction, before the workspace row. Every organization delete (`delete_organization`, `admin_delete_organization`, the organization part of `admin_delete_accounts_batch`, so also `admin_delete_user_with_cascade`) first deletes the projects whose `workspace_id` is a workspace of that organization (the legacy cross-organization shape), and the principal snapshot (`access/dao.py` `_LIST_SCOPE_PRINCIPALS_SQL`) covers them. | The cascade that did this goes away with the foreign key. Without it, admin deletes would leave orphan projects. |
| D-14 | Accept-invitation on a project with NULL `workspace_id` skips the "new member" admin email and logs `[invitations] admin notice skipped: no workspace` (info, ids only). | Step-2-shaped data only, on a step-1 pod. The email names a workspace and its administrators, which do not exist for such an organization. Step 2 rewrites this email. |
| D-15 | `project_storage_prefix` stays in `core/mounts/types.py`. | It names the layout that every pre-v0.125 mount keeps; tests and M6c's refusal ("a mount in the move set uses an old path") describe old rows with it. Three lines. |
| D-16 | The mount-step upgrade note and the workspace note go in one "Upgrading to 0.125.0" section of `docs/docs/self-host/upgrade-and-migrate/01-upgrading.mdx`. | One section per release on the upgrade page. |
| D-18 | Part B makes no web, SDK, Fern, env, Helm or Railway change. `api/AGENTS.md` changes by one bullet (D-7 entry point). | Responses do not change. Config check in Task B5. |
| D-19 | New tests go in new files. Existing test files change only where a behavior assertion must change (listed per task). | Keeps the existing membership test files stable for other changes of the same release. |
| D-20 | The organization-wide default invariant is a step-2 and step-3 rule, not a step-1 rule. Step-1 writers keep today's workspace-scoped default logic for projects that have a workspace; for a project with a NULL `workspace_id` (step-2 data only) they scope the default check and the unset to the whole organization. Step 2: its migration consolidates to one default per organization (WR "default project"), and its readers pick by the D-11 order when an organization has several defaults (a step-1 pod in the step-2 rollout can set a second one through a workspace-scoped write). Step 3 runs the same consolidation again, idempotent, before it drops workspaces (the same pattern as the meter fold). | Least work: making step-1 writers organization-wide would change today's behavior in multi-workspace organizations one release early. Readers that pick by a fixed order make a stray second default harmless, and the step-3 rerun removes it. Spec edits in Task B5 move the requirement there. |
| D-21 | The Bearer state cache key of the workspace-only branch (query has `workspace_id` and no `project_id`) gains `"v": "m4b1"`. The other branches keep their keys. | A v0.124.0 pod cached success for this branch after a `workspace_members` check only. A v0.125.0 pod must not reuse that entry, or the new membership rule would not apply until the TTL ends. The bump affects only this rare branch, so there is no cold-cache burst for normal traffic. v0.124.0 pods never read the new keys. The other branches' cached answers mean the same thing in both versions. |
| D-22 | `POST /organizations/{org}/workspaces/{ws}/invite/accept` validates `{ws}` inside the project read the service already makes: that read becomes NEW `db_manager.fetch_project_with_workspace_organization(project_id)` (one statement: the project row `LEFT JOIN workspaces w ON w.id = p.workspace_id`, returning `w.organization_id AS workspace_organization_id`). `{ws}` is accepted when `{ws} == {org} == project.organization_id`, or when `{ws} == project.workspace_id` and `workspace_organization_id == {org}`; any other id costs one `get_workspace` read (only for an id no server-built link contains) and is accepted when that workspace's `organization_id == {org}`. Else `InviteNotFoundError` (400 "Invitation does not exist.") before any write. | D6 says `{ws}` must identify `{org}` or one of its workspaces; today the route ignores it. The legacy cross-organization project (project in O1, workspace W in O2) is refused through `/organizations/O1/workspaces/W/invite/accept`, as the spec scenario says. No added statement on the normal path. |
| D-23 | Both revisions use `SET LOCAL lock_timeout = '2s'` (M4a used 5 s). | Each revision is catalog-only and needs ACCESS EXCLUSIVE on a hot table (`mounts`: sign on every turn; `projects`: every auth cache miss). While the lock request waits, later requests on that table queue behind it. 2 s bounds that stall; a timeout fails the hook cleanly and the deploy is retried. Task B1 and A1 measure it under contention. |
| D-25 | The EE branch of `GET /organizations/` stays as it is (`workspaces = []` for every organization). | That is today's EE response; D6 changes it in step 2. Byte-identical rule. |
| D-26 | `GET /workspaces/` and the OSS `GET /organizations/` list one organization-id item for every organization where the user is a member but has no workspace membership row in any of its workspaces (also when the organization still has workspace rows). | Step 2 stops writing workspace memberships but keeps workspace rows until step 3, so new members of existing organizations would otherwise see nothing. The same rule changes the response for a legacy user with an organization row and no workspace row: listed in "Access changes" as an accepted exception (a list entry, no access). |

Step 2 supersedes D-6, D-9 and D-21 (see "Step 2: switch" below): `request.state.workspace_id` is the organization id in every branch, and every Bearer branch that has `workspace_id` or no `project_id` uses `"v": "m4b2"`.

Deviation found while building (accepted): `get_project_by_workspace` keeps today's order inside the workspace (`is_default DESC`, NULLS first, then `created_at`) for every workspace that has a project, and uses the organization default only for an organization id or a workspace without projects. `fetch_default_project` answers the workspace's own default, else the organization default. The two differ for a workspace with projects but no default project; step 2 makes them agree before it stops writing workspace rows. Step 2 also uses one default-project rule for `check_organization_write` (v0.124.0: the oldest default project of the organization), `fetch_default_project` and `get_project_by_workspace`; they differ today only in multi-workspace organizations.

### Access changes (explicit exceptions to "responses unchanged")

Rule applied: a case that goes from refused to allowed is accepted only when M1's resolver already allows the same user the same project through another route (`?project_id=<that project>`, which every client can send). A case that would allow more keeps today's refusal.

Refused today, allowed after:

| # | Case | Why it is consistent with M1 |
| --- | --- | --- |
| W1 | Bearer `?project_id=P&workspace_id=<another workspace of P's organization>` (today 401 "mismatch") | Membership is still `is_member(user, P)`, the same check as `?project_id=P` alone. |
| W2 | Bearer `?project_id=P&workspace_id=<P's organization id>` (today 401 "workspace not found") | Same as W1. |
| W3 | Bearer `?workspace_id=W` (or the organization id), user has no `workspace_members` row in W and is resolver-eligible on the project auth selects for W (OSS: an organization row in that project's organization; EE: also a `project_members` row there). Users without that eligibility stay 401 (counted separately, "W3-refused") | `read_membership(user, selected project)` is the resolver answer that `?project_id=<selected project>` gives today. |
| W4 | Bearer with no parameters, user with no workspace membership row at all (today 401) and resolver-eligible on the default project of the oldest organization membership's organization. Others stay 401 ("W4-refused") | D-9 requires `read_membership` on the fallback project, the same answer as `?project_id=` for it. |
| W5 | `DELETE /projects/{id}` when the request context is the organization id (step-2 data only) | The DELETE permission check on the target project does not change. |
| W6 | `/access` check with `scope_type="workspace"` and the organization id | It compares the caller's own scope ids and then checks the caller's permission in its own project; it grants nothing. |
| W7 | Invite, resend, role and remove routes with the organization id in the path (today 404 or 500) | They authorize with `check_action_access` on the organization's default project, as with a workspace id. |
| W8 | `GET /workspaces/` and OSS `GET /organizations/` show an organization-id item for a member without a workspace row (D-26) | A list entry; no access follows from it. |

Allowed today, refused after:

| # | Case | Why |
| --- | --- | --- |
| N1 | Bearer `?workspace_id=W`, user has a `workspace_members` row in W but the resolver says not a member of W's default project (EE: no project row there, or no organization row; OSS: no organization row) | Fail closed; M1 made the resolver the only membership answer. |
| N3 | Bearer with no parameters, the user's oldest workspace has no own default (only after the step-2 consolidation) and the user is not resolver-eligible on the selected default (D-9 a) | Fail closed: authentication never hands out a project the resolver refuses. Zero such rows exist before step 2 (counted). |
| N2 | Accept-invitation with a `{ws}` that is neither `{org}` nor a workspace of `{org}` (D-22) | Fail closed; the invitation is unchanged and still works with the right link. |

Kept as today on purpose: the cross-organization legacy project keeps its token and meter organization in every branch (D-6); a workspace that belongs to another organization than the project still gives 401 (D-8).

## Mixed-version behavior

### Part A (`oss000000051`)

| Case | Behavior |
| --- | --- |
| v0.124.0 (M4a) pod inserts or re-binds a mount after 051 | M4a code always writes `storage_prefix` (the project layout) in the statement. The trigger's `WHEN (NEW.storage_prefix IS NULL)` guard was already false for it, so dropping the trigger changes nothing. The row keeps the project layout forever. |
| v0.124.0 pod reads, signs, re-binds, lists or deletes a mount that a v0.125.0 pod created (organization layout) | It uses the stored prefix for every key and credential (M4a interfaces 1.3, spec "An M4a pod during the M4b mount step rollout"); the re-bind keeps the organization prefix. Executed in Task A5 Step 4b with the M4a code against the real database and store. |
| v0.125.0 pod re-binds a mount created before | The upsert's conflict path keeps the existing row and its prefix (project layout). Files stay. |
| v0.125.0 pod creates a mount | The INSERT writes `mounts/<organization_id>/<mount_id>`; the organization id is read by a subquery inside the same statement. |
| A deployment that skips v0.124.0 (0.123.x pods during the rollout) | 050 and 051 run in one hook. Pods older than M4a insert mounts without the column and get a NOT NULL error until they are replaced (no trigger any more). Docker Compose (one process) is not affected. Accepted (failed in-flight items, CONTRACT 12); the upgrade note says to upgrade through 0.124.0 for a clean rolling upgrade. |
| Application rollback v0.125.0 to v0.124.0 | Safe: M4a reads stored prefixes and writes its own explicitly. |

### Part B (`oss000000052`)

| Case | Behavior |
| --- | --- |
| v0.124.0 pod on the 052 schema | It always writes a `workspace_id`; it reads `projects` joined to `workspaces` and every row still has a workspace (v0.125.0 code writes NULL only for an organization that has no workspace rows, which only step-2 data has). Only difference: an admin workspace deletion served by an old pod during the rollout no longer deletes the workspace's projects (no cascade). Admin-only route; accepted and listed in the PR body. |
| v0.125.0 pod on existing data | Byte-identical responses (D-6), except the access changes listed above (W8 list item, N1/N3 refusals). Accepts organization ids and legacy workspace ids of the same organization in addition (nobody sends them yet in this release). |
| v0.125.0 pod on step-2 data (step-2 rollout, or rollback from step 2) | Projects with NULL `workspace_id` and organizations without workspace rows: authentication succeeds for members, every workspace-shaped field carries the organization id, project create, set-default, invite, accept and member routes work. |
| v0.125.0 pod on mixed data (a legacy organization that also holds a NULL-workspace project written by a step-2 pod) | Lists show both projects (the NULL one with the organization id); defaults follow D-20; `set_default_project` on the NULL project clears the organization's other defaults. Task B2 tests, Task B6 Step 5. |
| Tokens signed by step-2 pods (`workspace_id` claim = organization id) | `verify_secret_token` copies the claim, so `AuthScope.workspace_id` is the organization id for that request. Authorization does not read it. EE meters key that request under `wrk=<organization_id>` (design.md D7 accepts this; the step-3 fold merges it). Task B6 Step 5b. |
| Cached auth state from v0.124.0 pods | Same keys and value format in every branch except workspace-only, whose key has the D-21 version, so a v0.124.0 success entry for that branch is never read. A deny that a v0.124.0 pod cached for an organization id needs a client that sends one; no server tells a client to do that in this release. Tested with an entry written in the old key shape (Task B3). |
| Signed run credentials | Unchanged claim set; `workspace_id` is the canonical value and `organization_id` keeps its per-branch source (D-6). |
| EE meters | `AuthScope.workspace_id` is unchanged for every existing project, so meter ids are unchanged. NULL-workspace projects (step-2 data only) meter under `wrk=<organization_id>`; the step-3 fold covers them (design.md D7). |

---

## Bearer rules (whole request, beyond the common SuperTokens and organization-name caches)

New Bearer rules in `verify_bearer_token` (`auth.py:920-1121`). Common to every branch and unchanged: the SuperTokens session read, the `get_supertokens_user_by_id` cache, one `verify_bearer_token` cache GET (and one SET after a success), the `get_organization_name` cache. The cache read itself is unchanged except the key of the workspace-only branch (D-21: `cache_key["v"] = "m4b1"` when `query_workspace_id and not query_project_id`).

Counts below are per request, beyond the common part. "Cold" = Bearer state and `resolve_membership` absent; "partly warm" = Bearer state absent, `resolve_membership` present; "warm" = Bearer state present (0 SQL, 0 extra Redis in every branch, before and after).

| Query | Cold, before → after | Partly warm, before → after | Rule |
| --- | --- | --- | --- |
| `project_id` + `workspace_id` | SQL: project, workspace + resolve read (3) → project + resolve read (2); +1 workspace read only for another legacy workspace. Redis: resolve GET+SET (2) → (2) | SQL 2 → 1; Redis 1 → 1 | Accept when the id equals `project.workspace_id` or `project.organization_id`, or names a workspace whose `organization_id == project.organization_id`. Else cached deny "project/workspace mismatch" (as today). Membership: `is_member` (M1, unchanged). Organization from the project (as today). |
| `project_id` only | unchanged (project + resolve read; Redis 2) | unchanged | As today. |
| `workspace_id` only | SQL: workspace, default project, workspace member (3) → `fetch_default_project` + `read_membership` (2). Redis: 0 → 0 | SQL 3 → 2; Redis 0 → 0 (`read_membership` has no cache) | `fetch_default_project(ref)`; none → cached deny "workspace not found (no project_id)" (as today). Not a member → 401, not cached (as today for this branch). Organization = `ref_organization_id` (the workspace's organization, as today). |
| none | SQL: workspace member, default project, workspace (3) → workspace member + `fetch_default_project` (2); + `read_membership` (3) only when the workspace has no own default (D-9 a). Redis 0 → 0. Fallback (users who get 401 today): + `fetch_oldest_organization_id` + `read_membership` (4) | same | `get_default_workspace_id(user)`; on `NoResultFound` → `fetch_oldest_organization_id(user)`, then `fetch_default_project(org)`. `read_membership` whenever the selection is not the workspace's own default (D-9); not a member → 401, not cached. Organization = `ref_organization_id` (the default workspace's organization, as today). |

In every branch: `workspace_id = str(legacy_workspace_id(workspace_id=<project workspace>, organization_id=<project organization>))` (D-6). API-key auth (`auth.py:1297`): `workspace_id = str(legacy_workspace_id(...))`, no read. `verify_secret_token` does not change (claims always carry `workspace_id`).

Invitation accept (D-22): `organization_router.accept_organization_invitation` passes `workspace_id` to `organization_service.accept_organization_invitation(..., workspace_id=...)`. The existing `project_pre = get_project_by_id(...)` read becomes `fetch_project_with_workspace_organization(...)` (same one statement, plus the LEFT JOIN). If it returns None keep today's flow; else apply D-22 (the `{ws} == project.workspace_id` case also requires `workspace_organization_id == organization_id`) and raise `InviteNotFoundError` before any write or state check. No added statement on the normal path.


## Reader inventory

**Reader inventory (request paths and admin paths that read `workspaces`, `workspace_members` or `projects.workspace_id`, M2 tip).** Disposition: CHANGED in this plan, COMPATIBLE (works unchanged with step-2 data, reason given), DEFERRED (step 2 or 3 removes it). Every row goes into the step-2 and step-3 removal inventory of the design doc (Task B5 Step 2).

| Reader | Disposition |
| --- | --- |
| `middlewares/auth.py` Bearer branches, API-key state | CHANGED (Task B3) |
| `dbs/postgres/memberships/dao.py` resolver SQL, `_LIST_PROJECTS_SQL`, `create_project` | CHANGED (this task) |
| memberships DAO mirror SQL (`add_member`, `set_member_role`, `remove_member`), transfer workspace-role swap | COMPATIBLE: NULL-workspace projects join no workspace, so they add no mirror row; DEFERRED: step 2 stops the mirror |
| `db_manager.get_project_by_workspace`, `get_default_project_id_from_workspace`, NEW `fetch_default_project` | CHANGED |
| `db_manager.get_default_workspace_id` | COMPATIBLE (D-9 handles no rows); DEFERRED step 3 |
| `db_manager.get_user_workspaces` | CHANGED (replaced by `fetch_user_workspace_items`; deleted if no caller remains) |
| `db_manager.workspace_member_exists` | CHANGED (deleted, no caller) |
| `db_manager.get_user_org_and_workspace_id` (`:1820`; callers: `organization_router.list_organizations` EE branch and `ee/src/apis/fastapi/organizations/router.py:44` `verify_user_org_access`) | COMPATIBLE: both callers use only `organization_ids` (organization memberships); the `workspace_ids` list is unused; DEFERRED: step 3 drops the workspace part |
| `db_manager.get_org_details`, `get_org_default_workspace`, `get_organization_workspaces`, `get_workspace_in_format`, `get_workspace_members` | CHANGED (organization stand-in) / COMPATIBLE (the rest read only existing rows) |
| `db_manager.set_default_project` | CHANGED (D-20) |
| `db_manager.get_workspace` (auth, organization_service accept, update_workspace) | CHANGED where a NULL id can reach it (auth, accept); COMPATIBLE in `update_workspace` (D-12) |
| `db_manager.get_workspace_administrators`, `notify_org_admin_invitation` | COMPATIBLE: called only when the project has a workspace (D-14) |
| `db_manager.fetch_projects_by_workspace`, `fetch_workspace_by_id` | COMPATIBLE: no caller; DEFERRED: step 3 deletes them |
| `db_manager` admin readers and writers (`admin_get_workspace_by_id`, `admin_get_workspace_ids_for_orgs`, `admin_create_workspace`, `admin_swap_workspace_memberships`, `admin_delete_workspace_membership`, `admin_transfer_ownership` workspace part) | COMPATIBLE: admin graph keeps writing workspaces in step 1; DEFERRED: step 2 maps them to the organization |
| `db_manager` delete paths (`admin_delete_workspace`, `admin_delete_accounts_batch`, `delete_organization`, `admin_delete_organization`, `admin_delete_user_with_cascade`) | CHANGED (D-13 and the organization-delete rule above) |
| `dbs/postgres/access/dao.py:91-96` `_LIST_SCOPE_PRINCIPALS_SQL` | CHANGED (organization-delete rule above) |
| `core/accounts/service.py:281` admin project DTO; `:568` `_MEMBERSHIP_SCOPE_SQL["workspace"]` | CHANGED / COMPATIBLE (reads a membership row by id) |
| `services/organization_service.py` invites and accept | CHANGED |
| `routers/workspace_router.py` (`GET /workspaces/`, role and remove routes) | CHANGED (list) / COMPATIBLE through `get_project_by_workspace` |
| `routers/organization_router.py` (list, details, invite, resend, accept, create, update) | CHANGED (list OSS, accept) / COMPATIBLE (details, invite, resend through the helpers; create, update: D-12) |
| `routers/projects_router.py` create, delete | COMPATIBLE (create, through `get_default_project_id_from_workspace`) / CHANGED (delete) |
| `apis/fastapi/access/router.py` scope check, `:284` token mint | CHANGED / COMPATIBLE (reads the canonical state) |
| `core/workflows/service.py:3311` token mint | CHANGED |
| `apis/fastapi/sessions/utils.py`, `sessions/router.py:616` session links; `gateways/credentials_router.py:158`, `gateways/mcps/router.py:315`, `gateways/policy/audit.py:40`; `core/events/utils.py`; `middlewares/analytics.py`; `utils/exceptions.py` | COMPATIBLE: they read `request.state.workspace_id` or `AuthScope.workspace_id`, which is never NULL after D-6; DEFERRED: step 2 switches links and `AuthScope` |
| EE meters (`core/meters/types.py`, `dbs/postgres/meters/dao.py`, `entitlements/service.py`) | COMPATIBLE (design.md D7); DEFERRED step 2/3 |
| `entrypoints/memberships_check.py` (M1 preflight, maintenance only) | COMPATIBLE: NULL-workspace rows join nothing and are not reported; DEFERRED: step 3 removes its workspace checks |
| role catalog (`SCOPES`, EE `role_overrides.py`) | COMPATIBLE (WR "role scope") |



## Steps 2 and 3 (later releases, outline only)

### Step 2: switch (the release after v0.125.0; needs step 1 on every pod)

Revisions: `core_oss` `oss000000053` (after `oss000000052`) and `core_ee` `ee0000000007` (after `ee0000000006`). Both change data only and need `migration:destructive-approved`.

- `oss000000053`, one transaction, row locks only (`lock_timeout` 2 s): (1) every project whose workspace belongs to another organization gets `workspace_id = NULL` (`projects.organization_id` wins); (2) each organization keeps `is_default` on the first default project by the D-11 order and loses it on the others. It sets no default where none exists. It logs each changed project id.
- `ee0000000007`: every meter row with a workspace is re-keyed to the id without `wrk`, in one keyset pass, one statement per batch (delete and insert under the new id, adding `value` and `synced` into an existing row). It refuses to run when a row has a workspace and no project. Organization-scope meters (all billed meters) do not change.
- One default-project rule: `fetch_default_project`, `get_project_by_workspace` and `check_organization_write` select within the ref's organization by the D-11 order. They answer the same project whenever the organization has a default.
- The organization is the only tenant source: every Bearer branch and API-key state takes the project's organization. A legacy workspace id is accepted only when it belongs to that organization (the Bearer project read joins the workspace, one statement as before).
- `AuthScope` has no `workspace_id`. `request.state.workspace_id` always equals the organization id. `sign_secret_token` writes the claim `workspace_id = organization_id` itself. Cached states keep a `workspace_id` field equal to the organization id, for step-1 pods. On a cache hit, step 2 reads the organization id. 
- No code creates or updates `workspaces` or `workspace_members` rows or writes `projects.workspace_id` (signup, project create, the M1 mirror, ownership transfer, the admin account graph). Removals keep deleting legacy rows until step 3, because a stale workspace member row would make the no-parameter Bearer selection pick an organization the user left.
- Responses per design.md D6. The members of `GET /organizations/{id}` are the members of the project that step 1 selected for it (the same people as before), with the organization role. Workspace create and rename return HTTP 410.
- The "new member" email goes to the organization's owners and admins with `/w/{organization_id}/p/{project_id}/settings?tab=workspace`. Invite links carry the organization id. Session links carry it through `request.state.workspace_id`.
- EE: `MeterScope` is organization, project, user. The meters DAO reads only rows without a workspace as current and bumps every row by its stored id. A plan override with `scope: "workspace"` loads as organization scope.
- `/m` matches a project by its id and rewrites the URL segment to `organization_id`, which every pod answers the same way, so a mixed rollout cannot cause a rewrite loop.
- Fern is regenerated from an EE spec on a base that holds every change of the release.
- Every credential path refuses a request whose organization is not its project's organization, inside the access decision's membership step (no added read). The Bearer branches that have `workspace_id` or no `project_id` use the state key version `m4b2`, so no success cached by a step-1 pod is served.
- Every default-project writer and `oss000000053` take one organization-scoped advisory lock, in their first statement.
- `ee0000000007` holds the usage-report lock; report bumps are compare-and-set on the `synced` value they read.
- The admin aliases: deleting a workspace id that is an organization deletes nothing (HTTP 409); deleting an organization-membership alias removes the member through `remove_member`.

Details of the built step 2:

- The D-11 order sorts `(type IS NOT DISTINCT FROM 'default') DESC`: a workspace with a NULL type is not the `default` one and sorts with the other workspaces by age. The same rule picks the workspace whose project lists the members of `GET /organizations/{id}`.
- `oss000000053` takes the per-organization advisory lock of the default-project writers, then `FOR UPDATE` row locks on the default projects of the organizations it changes, and ranks in a later statement. It locks only default rows: a step-1 writer clears the defaults and then sets its target, so locking the target too would deadlock with it.
- `ee0000000007` also refuses to run when a row with a workspace has a key the usage report bills. Billed meters are organization-scope, so they never move. A report that outlives its lock, or a step-1 report, can then only touch the `synced` value of a moved, non-billed row.
- `POST /admin/simple/accounts/workspaces/` answers the organization and creates no project. A new default project would take the organization's default away.

#### Access changes

Refused before, allowed after:

| Case | Status |
| --- | --- |
| `check_organization_write` for an API key or run credential of the default project that the D-11 order picks, in an organization where that project is not the oldest default (organization settings, domains, SSO providers, billing, members) | Accepted by the owner: the organization's default project follows the spec's rule. |
| Member routes `/workspaces/{W}/...`, invite and resend with a secondary workspace `W` of a multi-workspace organization: authorized on the organization's default project instead of W's own project | The same caller can already send the default workspace id or the organization id for the same route. |

Allowed before, refused after:

| Case | Why |
| --- | --- |
| Bearer `?workspace_id=W` (or no parameters selecting W) where W belongs to O2 and the project belongs to O1 | Repaired by `oss000000053` and refused at run time (CONTRACT section 1). |
| Bearer `?project_id=P&workspace_id=W` where `W == P.workspace_id` but W belongs to another organization | Same. |
| `/access` check with `scope_type="workspace"` and a legacy workspace id | No client sends it; it grants nothing. |
| `check_organization_write` for a key of a default project that `oss000000053` clears | The mirror of the first row above. |
| Workspace create and rename | HTTP 410. |
| A request whose organization is not its project's organization (run credentials minted for the cross-organization shape before the repair) | Refused in the access decision. |

#### Mixed versions

Step-1 pods on step-2 data:

| Step-2 data | Step-1 behavior |
| --- | --- |
| Projects without a workspace, organizations without workspace rows, members without workspace rows | Served (step 1 accepts organization ids and NULL workspaces). |
| One default per organization | `fetch_default_project` answers the organization default. A secondary workspace with projects and no default keeps its own project for member routes on a step-1 pod (same organization). |
| Tokens and cached states with the organization id in `workspace_id` | Accepted. |
| `m4b2` Bearer keys | Never read by step-1 pods. |
| Meter rows without a workspace | Read and bumped (step 1 accepts a project scope without a workspace); a step-1 pod does not read them as its current rows, so the daily count on that pod starts a separate bucket (merged in step 2b). |

Step-2 pods on step-1 data:

| Step-1 data | Step-2 behavior |
| --- | --- |
| Legacy projects, workspace and workspace member rows | Ignored for every answer; legacy workspace ids still map within the project's organization until step 2b. |
| A second default written by a step-1 pod during the rollout | Readers pick by the D-11 order; step 2b reruns the consolidation. |
| The cross-organization shape written after the repair | Refused. |
| Project-only Bearer and API-key states | Served; `request.state.workspace_id` comes from the cached organization id. |
| Project + workspace, workspace-only and no-parameter Bearer states | Not read (`m4b2` keys). |
| Tokens with a legacy workspace claim | `request.state.workspace_id` is the organization claim; a token whose organization is not its project's is refused. |
| Meter rows with a workspace | Never read as current; bumped by their stored id; folded in step 2b. |

Rollback to step 1: the repaired projects, the cleared defaults and the re-keyed meter rows stay; step-1 pods serve them. Forward again: rows step-1 pods wrote with a workspace are ignored and folded in step 2b.

#### One-way changes

| Change | One-way because | Gate |
| --- | --- | --- |
| Cross-organization repair | The old `workspace_id` of those projects is gone | Dump of `projects`, `workspaces`, `workspace_members` before the release |
| Default consolidation | Which projects were defaults is gone | Same dump; the migration log keeps the cleared ids |
| Meter re-key and fold | Old meter ids are gone; folded rows cannot be split | Dump of `meters`; the revision refuses unsupported rows before any write |

Mixed versions: step-1 pods serve step-2 data (projects without a workspace, organizations without workspace rows, one default per organization, tokens and states with the organization id). Step 1 also needs `MeterScope` to accept a project scope without a workspace (tasks.md 1.7); without it, a step-1 pod's usage report cannot read re-keyed rows. Step-2 pods read step-1 states, tokens and rows as described above. Rollback to step 1 keeps the data changes; step-1 pods serve them.

### Step 2b: stop reading (the release after step 2)

Step-2 pods still read `workspaces`, `workspace_members`, `projects.workspace_id` (legacy-id mapping, default ordering, the no-parameter selection, legacy deletes) and `meters.workspace_id`. Step 2b reruns the step-2 repair, consolidation and meter fold, then removes every read and write of these objects. Step 3 drops them once only 2b pods run.

### Step 3: contract (the release after step 2b)

- **Prerequisite:** step 2b on every pod. Step 2b already removed every read and write of these objects and reran the repair, the consolidation and the meter fold.
- **Tasks:** tasks.md 3.1 to 3.4. Dump `workspaces`, `workspace_members`, `projects` and `meters` (private); `core_ee` drops `meters.workspace_id`; `core_oss` drops `projects.workspace_id`, `workspace_members`, `workspaces`, `WorkspaceScopeDBA` and the models. Readers ignore the token claim; signers keep it while `/w` lives.
- **Revisions:** `core_ee` drop, `core_oss` drops (label `migration:destructive-approved`).
- **Gates:** no step-2b code reads a dropped column or table (step-2b pods serve during the step-3 rollout); dumps taken and restorable; full acceptance on a production-shape copy.
- **Risks:** one-way door (dropped tables and old meter ids). Anything outside the API that still joins `workspaces` breaks at deploy.

## Known gap kept for step 2

CONTRACT section 1 (the organization is the tenant boundary): a legacy project of organization O1 whose workspace belongs to organization O2 keeps today's answers in step 1, so the workspace-only and no-parameter branches sign its token with organization O2. Before step 2, every such project is repaired (`projects.organization_id` wins) and step 2 refuses the shape.
