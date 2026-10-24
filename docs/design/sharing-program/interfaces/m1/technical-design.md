# M1 `project-membership-resolver`: technical design

Status: proposed, round 3 (plan review 2026-10-22). Names and signatures: `interfaces.md` in this folder. Paths are relative to `api/` unless they start with `web/`, `hosting/` or `docs/`. Owner decisions (2026-10-22): only duplicate rows block; the demo feature is deleted; one release with the least operational work; project create, update and delete check a permission.

## 1. File-by-file plan

### Core and DB (new domain)

| File | Status | Change |
| --- | --- | --- |
| `oss/src/core/memberships/{__init__,dtos,types,interfaces,service}.py` | NEW | DTOs, exceptions, `MembershipsDAOInterface` (4 single-statement readers, 4 writers), `MembershipsService` with `invalidate_access_caches`, registry. |
| `oss/src/dbs/postgres/memberships/{__init__,dao,mappings}.py` | NEW | `MembershipsDAO`. Readers use `engine.session()`; writers use `engine.transaction()` and the organization advisory lock. Inserts use `postgresql.insert(...).on_conflict_do_nothing(index_elements=["project_id", "user_id"])` with an explicit `id=uuid7()` per row; literal `INSERT ... SELECT` statements select `gen_random_uuid()`, `now()`, `now()` per row (`project_members.id` has no database default). Mappings named `map_<x>_dbe_to_dto`. |
| `oss/src/core/access/{dtos,types,interfaces,rbac,service}.py` | NEW | `RoleRequirement`, `Action`, `DecisionReason`, `Decision`; `AccessError` and its subclasses; `RbacEnforcementInterface`; `AlwaysEnforcedRbac`; `AccessService` and registry. |
| `ee/src/core/access/rbac.py` | NEW | `EntitlementsRbacEnforcement`. |
| `entrypoints/access.py` | NEW | `bootstrap_access() -> AccessService`: builds the DAO, `MembershipsService(policy=PROJECT_ROWS if is_ee() else ORGANIZATION_WIDE)`, the RBAC adapter, `AccessService`; registers both. The only edition branch for membership. |
| `entrypoints/memberships_check.py` | NEW | `--report`, `--apply`, `--materialize` (section 3.1). One-off jobs live in `entrypoints/`, as `backfill_wallet_signup_grants.py` does. |

### Modified

| File | Change |
| --- | --- |
| `oss/src/core/access/permissions/service.py` | `check_action_access` delegates to `AccessService` (interfaces 3.5). Delete the workspace-based helpers. Keep `check_user_org_access`. |
| `entrypoints/routers.py`, `entrypoints/worker_streams.py`, `entrypoints/worker_queues.py` | Call `bootstrap_access()`: in `routers.py` at the top of the `# SERVICES` section; in both workers right after `bootstrap_entitlements_services()`. |
| `oss/src/middlewares/auth.py` | `verify_bearer_token`: the `?project_id=` membership check calls `is_member`. |
| `oss/src/routers/projects_router.py` | The five routes per interfaces 4.1, including the three permission checks. Remove `is_demo`. `_project_to_response(listing: ProjectListing)` (sync, no read). |
| `oss/src/routers/workspace_router.py` | Role and remove endpoints call the service; drop `check_rbac_permission` and `get_user_org_and_workspace_id` imports. |
| `oss/src/routers/organization_router.py` | `update_workspace` uses `check_action_access(EDIT_WORKSPACE)`; `transfer_organization_ownership` calls `MembershipsService.transfer_ownership`. |
| `oss/src/services/organization_service.py` | Invite accept and remove call the service; drop its own user-only cache invalidation. |
| `oss/src/core/auth/service.py` | Domain auto-join calls `set_member_role(role="viewer", join_all_projects=True, must_be_absent=True)`, so an invitation accepted between its membership check and its write keeps its role. Drop the inline ORM inserts. |
| `oss/src/services/commoners.py` | Delete `DEMOS`, `DEMO_ROLE`, `Demo`, `list_all_demos`, `add_user_to_demos` and its signup call. `create_organization` unchanged. |
| `oss/src/services/db_manager.py` | `create_workspace_db_object` calls `MembershipsService.create_project(is_default=True)` instead of `create_default_project` and `create_project_member`. Delete `project_member_exists`, `fetch_project_memberships_by_user_id`, `add_user_to_organization`, `add_user_to_workspace`, `add_user_to_project`, `add_user_to_workspace_and_org`, `remove_user_from_workspace`, `create_workspace_project`, `sync_workspace_members_to_project`, `update_user_roles`, `get_project_member`, `check_user_in_workspace_with_email`, `transfer_organization_ownership` (no caller left). No new function is added here. Keep `get_user_org_and_workspace_id`, `workspace_member_exists`, `get_project_members` (display), admin helpers. |
| `oss/src/utils/env.py` | Delete `ExtrasConfig.demos`, and `ExtrasConfig` and `extras` if empty. |
| `oss/tests/pytest/unit/access/test_project_member_lookup.py` | DELETED; ported to `test_access_service.py` without the demo cases. |
| `oss/tests/pytest/unit/services/test_db_manager.py` | Remove the `get_project_member` tests. |
| Web and hosting | Section 6. |

### Migrations

| File | Change |
| --- | --- |
| `oss/databases/postgres/migrations/core_oss/versions/oss000000044_repair_memberships_for_resolver.py` | NEW. Demo rows, P1, P2a, P6 (section 3.2). |
| `oss/databases/postgres/migrations/core_oss/versions/oss000000045_add_project_members_unique_index.py` | NEW. Guarded concurrent unique index (section 3.3). |

## 2. Key flows

### 2.1 Permission check

1. Handler → `check_action_access`.
2. `get_access_service()`; raises when the process did not register it.
3. Redis `get_cache` (namespace `check_action_access`); hit → return.
4. `check_capability` → `resolve` → `fetch_membership_row`: one statement in both editions (today's path makes about 9).
5. Shortcuts and catalog (interfaces 3.4). `set_cache(decision.allowed)`.

### 2.2 Bearer request with `?project_id=`

Project resolved (unchanged) → success cache hit restores state (unchanged) → `is_member` (one statement, as today's `project_member_exists`); False → 401, not cached → sign and cache (unchanged).

### 2.3 Project list

`list_for_user` → `list_membership_rows`: one statement (projects, workspaces, organizations and the user's oldest rows), as today's `fetch_project_memberships_by_user_id` → responses. `GET /projects/{id}` uses `fetch_for_user`: one statement.

Statement counts (access-decision statements, not total endpoint statements; for example EE `resource_type=local_secrets` keeps its meter write):

| Path | Today | M1 |
| --- | --- | --- |
| `check_action_access`, cache hit | 0 | 0 |
| `check_action_access`, cache miss | about 9 | 1 |
| Bearer `?project_id=` membership check | 1 | 1 |
| `GET /projects/` | 1 | 1 |
| `GET /projects/{id}`, `current` | 1 | 1 |

`test_hot_path_query_counts_postgres.py` pins the M1 column.

### 2.4 Project creation

1. Context check, then `check_action_access(CREATE_WORKSPACE)` on the workspace's default project (`db_manager.get_default_project_id_from_workspace`, existing).
2. EE project limit.
3. `create_project` in one transaction: lock → workspace check → default handling → insert project → insert one row per organization member → commit.
4. Invalidation for the new project.
5. Default evaluators and environments, outside the transaction (as today).

The workspace-create route follows steps 3 to 5 for its default project after its own workspace insert.

### 2.5 Role change, invite accept, remove member

Each: router permission check (unchanged permission) → service writer → DAO transaction under the lock → commit → `invalidate_access_caches` for the user and every project of the organization.

### 2.6 Ownership transfer

1. Router: caller is the organization owner (unchanged).
2. `transfer_ownership` → DAO transaction: lock → organization and new-owner checks → swap organization, workspace and project roles (project rows where both have one, as the admin transfer tool) → insert `owner` project rows for the new owner in every project → set `owner_id` → commit.
3. `invalidate_access_caches(user_ids=[current, new], project_ids=<all projects of the organization>)`.

Reason for step 2's insert: after M1 the owner shortcut runs only for a member. In EE, a new owner without project rows would be `not_member` in those projects.

## 3. Migration and data

### 3.1 Script `entrypoints/memberships_check.py`

```text
cd api
uv run --no-sync python -m entrypoints.memberships_check --report [--out DIR]
uv run --no-sync python -m entrypoints.memberships_check --apply
uv run --no-sync python -m entrypoints.memberships_check --materialize   # EE only, after ee0000000002
```

- Runs from a checkout of the release branch with the database URL of the target in the environment. There is no deploy of the script.
- `AGENTA_LICENSE` selects the edition. EE runs call `bootstrap_entitlements_services()` first. EE-only checks run only when `is_ee()`.
- `--out` default: `~/agenta-memberships-check/<UTC timestamp>/`. Each check is one SQL constant with an optional `organization_ids` filter (tests use it). Batches of 500 organizations, as in `backfill_wallet_signup_grants.py`; per-member work (`--materialize`) also pages by 1,000 members inside an organization (an organization can have tens of thousands of members).
- `--apply`: (1) dedupe over non-demo rows only, keeping the oldest; (2) P2b, excluding (user, organization) pairs with a demo row and skipped once `oss000000044` has run (interfaces section 7). `--apply` never deletes demo rows; the revision does. So a demo row never wins a duplicate group, and a rerun after the revision cannot restore demo access through P2b. Tested by `test_apply_never_keeps_a_demo_row_over_a_real_row` and `test_apply_twice_then_migration_never_restores_demo_access`.

| Id | Check | Handling |
| --- | --- | --- |
| P1 | organization owner without an organization row | `oss000000044` inserts `owner` |
| P2a | organization owner without a row in a project of the organization | `oss000000044` inserts `owner` |
| P2b (EE) | workspace member of an organization without the RBAC entitlement, with an organization row and no row in a project of that workspace | `--apply` inserts the oldest workspace role |
| P3 (EE) | user with organization and project rows but no workspace row for that project (denied today, allowed after) | report only (accepted) |
| P4 (EE) | organization with more than one workspace, with member and project counts | report only (accepted) |
| P5 | duplicate `(project_id, user_id)` groups, with ids and roles in `(created_at, id)` order | blocks `oss000000045`; `--apply` deletes all rows but the oldest |
| P6 | organization role differs from the workspace role, single-workspace organizations | `oss000000044` copies it |
| P7 (OSS) | project row role differs from the effective organization role | report only, for release notes |
| P8 (OSS) | organization member without a row in a project of the organization (gains access) | report only, for release notes |
| P9 | project row without an organization row | report only (denied before and after) |
| P10 | soft-deleted rows in the three membership tables | report only |
| P11 | `project_members` rows with `is_demo = true`, per organization | `oss000000044` deletes them |
| P12 | duplicate `organization_members` rows | report only; the DAO reads the oldest |

`--materialize` (EE only; exit 1 when `to_regclass('ux_project_members_project_id_user_id')` is null) inserts a row for every (oldest organization row, project of that organization) pair without one, then sets every existing row's role to the organization role. A second run changes 0 rows. It prints both counts.

### 3.2 Revision `oss000000044`

Five SQL constants in the revision file, run in order in `op.execute(text(...))` inside the hook transaction. Tests load them from the file (migrations do not import app code).

```sql
-- _DELETE_DEMO_ONLY_MEMBERSHIPS_SQL: organization and workspace rows of demo-only users
-- (not the owner; every project row of the user in the organization is a demo row)
WITH demo_only AS (
    SELECT DISTINCT d.user_id, dp.organization_id
    FROM project_members d
    JOIN projects dp ON dp.id = d.project_id
    JOIN organizations o ON o.id = dp.organization_id
    WHERE d.is_demo IS TRUE
      AND d.user_id IS NOT NULL
      AND d.user_id IS DISTINCT FROM o.owner_id
      AND NOT EXISTS (SELECT 1 FROM project_members r
                      JOIN projects rp ON rp.id = r.project_id
                      WHERE rp.organization_id = dp.organization_id
                        AND r.user_id = d.user_id
                        AND r.is_demo IS NOT TRUE)
),
deleted_workspace_rows AS (
    DELETE FROM workspace_members wm
    USING workspaces w, demo_only x
    WHERE w.id = wm.workspace_id
      AND w.organization_id = x.organization_id
      AND wm.user_id = x.user_id
    RETURNING wm.id
)
DELETE FROM organization_members om
USING demo_only x
WHERE om.organization_id = x.organization_id
  AND om.user_id = x.user_id;

-- _DELETE_DEMO_ROWS_SQL
DELETE FROM project_members WHERE is_demo IS TRUE;

-- _ADD_OWNER_ORGANIZATION_ROWS_SQL (P1)
INSERT INTO organization_members (id, user_id, organization_id, role, created_at, updated_at)
SELECT gen_random_uuid(), o.owner_id, o.id, 'owner', now(), now()
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM organization_members om
                  WHERE om.organization_id = o.id AND om.user_id = o.owner_id);

-- _ADD_OWNER_PROJECT_ROWS_SQL (P2a)
INSERT INTO project_members (id, user_id, project_id, role, created_at, updated_at)
SELECT gen_random_uuid(), o.owner_id, p.id, 'owner', now(), now()
FROM projects p JOIN organizations o ON o.id = p.organization_id
WHERE NOT EXISTS (SELECT 1 FROM project_members pm
                  WHERE pm.project_id = p.id AND pm.user_id = o.owner_id);

-- _COPY_WORKSPACE_ROLE_SQL (P6)
UPDATE organization_members om
SET role = wm.role, updated_at = now()
FROM workspace_members wm
JOIN workspaces w ON w.id = wm.workspace_id
JOIN organizations o ON o.id = w.organization_id
WHERE om.organization_id = w.organization_id
  AND om.user_id = wm.user_id
  AND om.user_id <> o.owner_id
  AND wm.role IS NOT NULL
  AND om.role IS DISTINCT FROM wm.role
  AND (SELECT count(*) FROM workspaces w2 WHERE w2.organization_id = w.organization_id) = 1
  AND (SELECT count(*) FROM workspace_members wm2
       WHERE wm2.workspace_id = w.id AND wm2.user_id = wm.user_id) = 1;
```

Demo enrollment wrote an organization row and a workspace row next to the demo project row. OSS reads the organization row, and an EE project created later seeds every organization member, so a demo-only user would keep a path into the organization; the first statement removes those rows (a user with any real project row in the organization keeps every row). It runs before the demo delete, which removes the evidence. The demo delete runs before the owner steps, so a user with a demo row and a real row in one project is no longer a duplicate. P2a gives the owner a row in every project; in an organization with several workspaces this is wider than today, which the owner accepted (P4). Organizations with several workspaces keep their organization roles (P6 skips them), and new projects there are seeded with those roles. Accepted, as P4.

### 3.3 Revision `oss000000045`

1. `autocommit_block()`.
2. Count duplicate groups; not 0 → `RuntimeError("project_members has <n> duplicate (project_id, user_id) groups. Run python -m entrypoints.memberships_check --apply, which keeps the oldest row of each group, then rerun the migration.")`.
3. `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ...`.
4. `indisvalid` check as in `oss000000040`; invalid → `RuntimeError` with the `REINDEX INDEX CONCURRENTLY` instruction.
5. `ANALYZE project_members`.

Mixed versions: pods of the previous release keep writing project rows while the index builds, and one of them can insert a duplicate after step 2. The concurrent build then fails, step 4 raises with the `REINDEX` instruction, and the operator runs `--apply` and the migration again. The window is the build time of one index, and the old writers insert only for users without a row. Accepted; no writer is stopped.

Why the guard and not an automatic delete: the duplicates are expected to be 0 or near 0, and the operator sees each deleted role before it goes.

### 3.4 Release procedure (one release)

Managed cloud (one region at a time):

1. From the release checkout, `--report` against each region's database. Write each report to its own `--out` directory; keep the counts in private notes.
2. `--apply` against each region's database (P5 duplicates, P2b rows). The rows are valid for the old code. The report shows whether `--apply` has anything to change. Multi-workspace organizations (P4) are report-only; their cutover review is an owner action. Report counts stay in private notes, never in the repository or a PR.
3. Deploy the release. The hook runs `oss000000044` and `oss000000045`.

Self-hosted OSS: upgrade only. When the hook stops on duplicates, the error names the `--apply` command. Self-hosted EE: the upgrade notes say to run `--apply` first (P2b and duplicates). The OSS release notes state the P7 and P8 effect: every organization member is in every project with the organization role.

OSS to EE switch: `ee0000000002`, then `--materialize`, then traffic. EE to OSS: no script; the runbook states the expansion.

### 3.5 Rollback

Code: previous release. M1 rows are valid for the old code. `oss000000044` and `oss000000045` are not rolled back; the old code does not read organization roles for project decisions, and the old code can live with the unique index. Deleted demo rows stay deleted.

## 4. Test plan

Commands: unit tests with `cd api && py-run-tests`; integration tests need the local stack (`run.sh --oss --dev` or `--ee --dev`) and `pytestmark = pytest.mark.integration`; acceptance tests run against the deployed stack with `admin_api` and the accounts in `oss/tests/pytest/utils/accounts.py`.

Focused fixtures replace any recording of production decisions. NEW `oss/tests/pytest/utils/membership_seed.py`: `seed_organization(*, members: dict[str, str], workspaces: int, projects_per_workspace: int)` and `seed_legacy_shapes(...)`, which writes one example of each P1 to P12 shape plus the production shapes seen on 2026-10-22: an owner with no organization row and no project row; an owner whose organization row role is not `owner`; an organization with two `owner`-role rows; an organization with 5 workspaces; a project whose workspace belongs to another organization; a project row for a non-member; an EE project row with a null role. Duplicate and demo rows are seeded only in migration tests. Tests that need duplicates run on an index-free temp-table shadow (`LIKE ... INCLUDING DEFAULTS`), because the unique index exists on the test database. NEW `oss/tests/pytest/utils/memberships.py`: `InMemoryMembershipsDAO` and `RecordingRbac(enforced: bool)`.

### 4.1 Unit (no database, no Redis)

| File | Tests |
| --- | --- |
| `unit/memberships/test_memberships_resolver.py` | `test_oss_member_without_a_project_row_resolves_with_the_organization_role`; `test_oss_stale_project_role_resolves_to_the_organization_role`; `test_ee_member_without_a_row_is_not_a_member`; `test_project_row_without_organization_row_is_not_a_member` (both policies); `test_unknown_project_is_not_a_member`; `test_list_for_user_agrees_with_resolve`; `test_ee_to_oss_gives_every_team_project`; `test_null_role_project_row_is_a_member_without_capabilities`; `test_resolve_reads_one_dao_row`; `test_is_member_goes_through_resolve`; `test_project_membership_round_trips_through_the_cache_serializer`. |
| `unit/memberships/test_memberships_invalidation.py` | `test_each_writer_invalidates_every_namespace_for_every_project` (`check_action_access`, `verify_bearer_token`, `resolve_membership`; parametrized over the four writers; for transfer, both users). |
| `unit/access/test_access_service.py` | `test_unknown_project_denies_not_member`; `test_organization_owner_without_membership_denies_not_member`; `test_no_rbac_organization_and_a_non_member_denies_not_member`; `test_no_rbac_member_is_allowed`; `test_organization_owner_member_is_allowed`; `test_project_owner_passes_any_role_or_permission`; `test_role_requirement_matches_exactly`; `test_permission_uses_the_project_scope_catalog`; `test_oss_organization_viewer_uses_project_viewer_permissions`; `test_undefined_organization_role_gives_no_permissions_and_logs`; `test_ee_custom_role_permission_is_allowed`; `test_unknown_role_raises_invalid_role_specified`. |
| `unit/access/test_check_action_access_wrapper.py` | `test_role_check_passes_a_role_requirement`; `test_argument_validation_is_unchanged`; `test_cache_key_is_unchanged`; `test_call_without_registration_raises`. |
| `unit/access/test_access_import_boundary.py` | `test_new_access_core_imports_no_db_manager_models_or_ee`. |
| `unit/middlewares/test_auth_bearer_membership.py` | `test_bearer_non_member_is_refused`; `test_bearer_workspace_branch_keeps_the_workspace_check`. |
| `unit/test_entrypoints_access.py` | `test_bootstrap_access_picks_the_policy_from_the_edition`. |

### 4.2 Integration against Postgres

`integration/memberships/conftest.py` copies `integration/sessions/conftest.py` (`deployment_databases = ("core",)`) and the engine reset fixture of `test_mounts_agent_id_backfill.py`. Each test seeds uuid-named rows and deletes its organization at teardown.

| File | Tests |
| --- | --- |
| `test_memberships_dao_postgres.py` | `test_duplicate_insert_is_rejected_and_treated_as_existing`; `test_create_project_seeds_every_organization_member`; `test_create_project_leaves_nothing_when_seeding_fails`; `test_role_change_keeps_a_removed_row_removed`; `test_role_change_updates_existing_rows_and_creates_none`; `test_invite_accept_writes_every_row`; `test_remove_member_refuses_the_organization_owner`; `test_remove_member_clears_rows_and_invitations_in_the_organization`; `test_remove_member_with_only_an_invitation`; `test_role_change_refuses_the_owner_and_must_exist`; `test_transfer_ownership_seeds_the_new_owner_in_every_project`; `test_transfer_ownership_leaves_nothing_when_a_step_fails`; `test_workspace_create_seeds_every_organization_member`; `test_workspace_row_deleted_does_not_change_resolve`; `test_membership_row_reads_the_oldest_organization_row_in_one_statement`; `test_membership_row_reports_a_null_role_row_as_present`; `test_membership_rows_list_every_project_of_the_user_organizations_in_one_statement`; `test_concurrent_role_writes_leave_one_row_per_project`; `test_create_project_seeds_2000_members_in_one_statement`; `test_admin_membership_create_clears_a_cached_denial`. |
| `test_hot_path_query_counts_postgres.py` | `test_project_list_is_one_statement`; `test_project_fetch_is_one_statement`; `test_bearer_membership_check_is_one_statement`; `test_check_action_access_miss_is_one_statement`; `test_check_action_access_hit_is_zero_statements`. |
| `test_membership_parity_postgres.py` | `test_bearer_list_and_capability_agree` (seeded matrix, both policies: `is_member` == in `list_for_user` == `check_capability(VIEW_APPLICATIONS)` for viewer or higher); `test_legacy_shapes_decide_as_expected` (after `seed_legacy_shapes` and the `oss000000044` SQL, a hand-written table of expected decisions per shape and edition: owners allowed, P2b members allowed after `--apply`, P3 users allowed, P9 users denied, former demo users denied). |
| `test_memberships_migration_postgres.py` | `test_repair_revision_adds_owner_rows` (P1, P2a); `test_repair_revision_deletes_demo_rows`; `test_role_copy_skips_the_owner_and_multi_workspace_organizations`; `test_repair_revision_is_idempotent`; `test_unique_index_revision_refuses_duplicates` (on a session temp table shadowing `project_members`); `test_apply_keeps_the_oldest_duplicate`; `test_apply_never_keeps_a_demo_row_over_a_real_row` (both timestamp orders, then the `oss000000044` SQL: the real row survives); `test_apply_twice_then_migration_never_restores_demo_access` (no-RBAC organization, former demo user: `--apply` twice, the revision SQL, `--apply` again: no project row); `test_repair_revision_handles_production_shapes` (owner without rows, owner row not `owner`, two owner rows, 5 workspaces, null-role row); `test_apply_adds_the_row_a_no_rbac_member_needs` (EE); `test_report_lists_p3_and_p4_and_writes_nothing`; `test_materialize_corrects_a_stale_row` (second run 0). |
| `test_signup_demos_postgres.py` | `test_signup_ignores_agenta_demos` (`AGENTA_DEMOS` and `AGENTA_EXTRAS_DEMOS` set to a seeded project; `commoners.create_accounts` for a new email adds no row in that organization). |

Run `uv run api/scripts/migration_gate.py` on both revisions.

### 4.3 Acceptance (real stack)

| File | Test | Edition |
| --- | --- | --- |
| `oss/tests/pytest/acceptance/accounts/test_project_membership_resolver.py` (NEW) | `test_project_created_by_another_member_is_listed` | OSS |
| same | `test_viewer_member_is_denied_member_removal` | both |
| same | `test_role_change_takes_effect_at_once` | both |
| `oss/tests/pytest/acceptance/accounts/test_project_route_permissions.py` (NEW) | `test_viewer_cannot_create_a_project` (403, no project); `test_admin_can_create_and_rename_a_project`; `test_editor_cannot_rename_a_project` (403); `test_admin_cannot_delete_a_project` (403); `test_owner_can_delete_a_project`; `test_non_member_gets_404_on_update_and_delete` | both (EE: organization with RBAC) |
| `ee/tests/pytest/acceptance/accounts/test_project_creation_seeding_ee.py` (NEW) | `test_new_project_seeds_every_member`; `test_new_owner_can_edit_after_transfer` (new owner had no project row) | EE |
| existing `test_rbac_enforcement.py`, `test_rbac_enforcement_ee.py`, `workspaces/test_workspace_members.py`, `test_transfer_ownership.py`, `test_organizations.py` | unchanged, must stay green | both |

### 4.4 Live QA

| Case | How |
| --- | --- |
| Local stack, `/m` | `run.sh --oss --dev` and `--ee --dev`: owner and an invited member open each project; a viewer tries to create a project and sees the 403 text; record the run. |
| Local stack, `/w` | login and project list, project switch, invite and role change, remove member, prompts and evaluations still open, workspace-shaped API answers (`GET /organizations/{id}`, workspace detail). |
| Workers | send one chat in `/m` (queued path) and one channel turn if a channel is configured; no `AccessServiceNotRegistered` in the worker logs. |
| Preflight | `--report` on a copy of a region; P5 count; `--apply` then `--report` shows P5 = 0. |
| OSS to EE | seeded OSS stack, switch per runbook, `--materialize`; stale `viewer` row becomes `editor`. |
| Demo removed | `AGENTA_DEMOS` set; new signup is not a member; `grep -rn -e AGENTA_DEMOS -e AGENTA_EXTRAS_DEMOS -e add_user_to_demos -e _is_demo_member api/oss/src api/ee/src hosting` returns nothing. |

## 5. Audit and observability

Existing structlog path (`get_module_logger`). No new event system. Never log emails, tokens, API key values or invitation tokens; log ids only.

| Event | Where | Fields |
| --- | --- | --- |
| `[memberships] role set` | `MembershipsService.set_member_role` | `organization_id`, `user_id`, `actor_user_id` (from the router), `role`, `previous_role`, `joined_project_count` |
| `[memberships] member removed` | `remove_member` | `organization_id`, `user_id` (or none), `actor_user_id`, `invitation_count` |
| `[memberships] project created` | `create_project` | `organization_id`, `workspace_id`, `project_id`, `actor_user_id`, `seeded_count` |
| `[memberships] ownership transferred` | `transfer_ownership` | `organization_id`, `previous_owner_id`, `new_owner_id`, `seeded_count` |
| `[access] denied` | `check_capability`, debug level | `user_id`, `project_id`, `action`, `reason` |
| `[memberships] cache invalidation failed` | `invalidate_access_caches`, warning | `namespace`, `user_id`, `project_count` |

To pass `actor_user_id`, the four service writers take an optional keyword `actor_user_id: Optional[UUID] = None`, used only for the log. The DAO does not take it. The denial event with principal and credential fields is M2 (CONTRACT section 6).

## 6. Docs and config

| Item | Change |
| --- | --- |
| `docs/design/sharing-program/` | Keep this folder and the OpenSpec change in step with the code at merge. |
| `api/AGENTS.md` | Add under "API Architecture Patterns" a short "Project membership and access" entry: membership is decided only by `MembershipsService.resolve`; membership writes go only through the four `MembershipsService` writers; `check_action_access` delegates to `AccessService`, and every process registers it with `bootstrap_access()`; no new code reads `workspace_members` or `project_members` to decide access. |
| `docs/designs/oss-ee-convergence/migration-chains-and-edition-switch.md` | OSS to EE: run `--materialize` after `ee0000000002`. EE to OSS: access expands to every project with the organization role. |
| Self-host docs and release notes | OSS: every organization member is in every project with their organization role. Project create, update and delete need a permission. `AGENTA_DEMOS` is removed. Self-hosted EE: run `--apply` before the upgrade. |
| `api/oss/src/utils/env.py` | Delete `ExtrasConfig.demos` (and `ExtrasConfig`, `extras` if empty). No new variable. |
| `hosting/docker-compose/{oss,ee}/env.{oss,ee}.{dev,gh}.example` | Delete the commented `AGENTA_EXTRAS_DEMOS` lines. |
| `hosting/kubernetes/{oss,ee}/values.*.example.yaml` | Delete the commented `demos` block. |
| `hosting/kubernetes/helm/templates/_helpers.tpl`, `helm/values.schema.json` | Delete the `agenta.extras.demos` block that sets `AGENTA_DEMOS`, and the `demos` schema entry. |
| Managed deployment config | Remove `AGENTA_DEMOS` in the same release. A leftover value has no effect. |
| Railway | No reference today; no change. |
| Fern client | Regenerate from an EE spec after `ProjectsResponse.is_demo` is removed; update `web/packages/agenta-api-client`. |
| Web | Delete `web/packages/agenta-entities/src/project/demo.ts` and the `is_demo` reads in `project/types.ts`, `web/mobile/src/lib/context.ts`, `web/packages/agenta-settings-ui/src/projects/ProjectsPage.tsx` and its unit test. In `web/oss`, delete the same reads only so it type-checks (an explicit exception to the `web/oss` rule). Run `pnpm lint-fix` in `web/`. |

## 7. Risks and implementation order

| Risk | Mitigation |
| --- | --- |
| A process calls `check_action_access` without registration | `bootstrap_access()` in the three roots; the error names the fix; worker QA row. |
| Invalidation cost: one Redis scan per (namespace, project) | 2N+1 scans per mutation for N projects; mutations are rare. |
| OSS access expansion and role collapse | Deliberate; P7 and P8 lists go to the release notes. |
| Former demo users keep an organization row in the demo organization (their demo project rows are deleted). In OSS they become members of every project of that organization. | Demo was a cloud (EE) feature; in EE an organization row alone gives no project. P11 counts the organizations. |
| A viewer in `/m` sees the create action and gets 403 | Accepted; `/m` shows the API text. |
| `remove_member` and role changes act on the whole organization in multi-workspace EE organizations | Accepted (P4). |

One implementation PR, one release, with ordered commits: (1) both revisions, the script and their tests; (2) memberships domain (DTOs, DAO, service, invalidation) and DAO tests; (3) access service, wrapper, three registrations, delete the workspace helpers (with every caller in the same commit); (4) readers (Bearer, project list and fetch, and every `_project_to_response` caller); (5) writers, ownership transfer, workspace create, project route permissions, demo removal, docs and config; (6) acceptance tests. A signature change and all its callers land in one commit. No interim compatibility code.

## 8. Decided rules (former gaps)

| Topic | Rule |
| --- | --- |
| Duplicate rows | Keep the oldest by `(created_at, id)`; `--apply` deletes the rest and prints them. The revision guard stays. |
| Owner repairs | P1 and P2a in `oss000000044`; P2b in `--apply`, before the revision only, never for a user with a demo row in the organization. |
| Ownership transfer | `transfer_ownership` DAO writer: one transaction, new owner seeded in every project, both users invalidated. |
| Workspace create | Its default project goes through `create_project`. |
| Project routes | Interfaces 4.1. |
| Demo rows | Deleted by `oss000000044`. Organization and workspace rows from demo enrollment cannot be told apart and stay. |
| Multi-workspace organizations, role copy | Not copied (accepted with P4). |
| Workspace member list display | Reads the default project's rows, as today; a resolver-backed member list is M3. |
| Admin tools | Stay in `db_manager` and `core/accounts/service.py`; every admin membership create, delete and ownership transfer calls `invalidate_access_caches` after commit (affected users captured before a delete). |
| Null project role | An EE `project_members` row with a null role is a membership (row presence decides). The no-RBAC and organization-owner shortcuts apply; role and permission checks deny `missing_capability`. |
| Large organizations | Per-member writes are single statements (`create_project` seeding) or paged (`--materialize`, 1,000 members per statement). |
| Missing user | `check_action_access` returns False (today: 500). |
| Secret tokens of a removed member | Valid until expiry; M2 owns credential lifetime. |
| Rollout-window writes by old pods | Accepted (section 1.3 of the interfaces); no post-rollout run. |
