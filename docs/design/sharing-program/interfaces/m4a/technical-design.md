# M4a `remove-workspaces-org-storage` (mount part): technical design

Status: proposed, round 2 (after the Codex review of round 1). Names and signatures: `interfaces.md` in this folder. Paths are relative to `api/` unless they start with `services/`, `web/`, `hosting/` or `docs/`. Owner rules (2026-10-22): one release with the least operational work; no downtime; a clean one-time migration; old mounts keep their path; no copy; no long-lived compatibility code; latency is a hard requirement.

## 1. File-by-file plan

M4a is one PR. It touches the mounts domain, one migration, tests, comments and docs. It changes no router, handler, worker, composition root, environment variable or API model.

### Code

| File | Status | Change |
| --- | --- | --- |
| `oss/src/core/mounts/types.py` | MODIFIED | `MOUNTS_KEY_ROOT`, `project_storage_prefix` (interfaces 2.1). |
| `oss/src/core/mounts/dtos.py` | MODIFIED | `Mount.storage_prefix` with `exclude=True`; `MountData` comment; `MountCredentials` docstring and `prefix` comment (interfaces 2.2). |
| `oss/src/core/mounts/service.py` | MODIFIED | `_storage_key(*, mount, path="")` reads the stored prefix; every internal call drops `project_id=` (interfaces 3.2). |
| `oss/src/core/sessions/mounts/service.py` | MODIFIED | Pass `storage_prefix` when it rebuilds `SessionMount` (interfaces 3.3). |
| `oss/src/core/mounts/interfaces.py` | MODIFIED (docstrings only) | The prefix rule on `create_mount` and `upsert_mount`. |
| `oss/src/dbs/postgres/mounts/dbas.py` | MODIFIED | `storage_prefix` column. |
| `oss/src/dbs/postgres/mounts/dao.py` | MODIFIED | Both inserts mint the id and write `project_storage_prefix` (interfaces 4.2). |
| `oss/src/dbs/postgres/mounts/mappings.py` | MODIFIED | `mount_id` and `storage_prefix` on both insert mappings; the DTO mapping reads the column (interfaces 4.3). |

### Migration

| File | Status | Change |
| --- | --- | --- |
| `oss/databases/postgres/migrations/core_oss/versions/oss000000050_add_mounts_storage_prefix.py` | NEW | Lock timeout, column, trigger, backfill, NOT NULL (interfaces 1.2). |

### Tests

| File | Status | Change |
| --- | --- | --- |
| `oss/tests/pytest/unit/mounts/test_storage_prefix.py` | NEW | Layout helper, key builder, namespace, DTO exclusion, session view, teardown (section 4.1). |
| `oss/tests/pytest/integration/sessions/test_mounts_storage_prefix_postgres.py` | NEW | Migration SQL, trigger, DAO writes, conflict path, statement counts (section 4.2). Uses the existing `integration/sessions/conftest.py`. |
| `oss/tests/pytest/acceptance/mounts/test_mount_storage_prefix_hidden.py` | NEW | Generated OpenAPI schema and JSON responses have no `storage_prefix` (section 4.3). |
| `oss/tests/pytest/unit/test_mounts_injection.py`, `unit/test_mounts_file_ops.py`, `unit/sessions/test_wp5_mount_teardown.py`, `unit/mounts/test_protected_mount_policy.py`, `unit/mounts/test_materialize_entries.py`, `unit/mounts/test_agent_mounts.py` | MODIFIED | Fake DAOs and `Mount(...)` fixtures set `storage_prefix`; `_storage_key(...)` calls drop `project_id=`. Behavior assertions unchanged. |
| `oss/tests/pytest/acceptance/sessions/test_session_attachment_teardown.py` | MODIFIED | `_coordinates` also reads the mount's `storage_prefix`, before the session is deleted; `_storage_key` builds the `Mount` from the captured value and reads no database. |
| `oss/tests/pytest/acceptance/mounts/test_mounts_injection.py` | MODIFIED (docstring and comments only) | Its assertions (`mounts/<project_id>/<mount_id>`) stay true in M4a. The M4b mount step changes them. |

### Comments and docs

| File | Change |
| --- | --- |
| `services/runner/src/engines/sandbox_agent/environment-setup.ts:130`, `mount.ts:37`, `run-plan.ts:424` | Comments: the prefix is the mount's stored prefix (`mounts/<scope_id>/<mount_id>`). No code change. |
| `web/packages/agenta-entities/src/session/core/fileActivity.ts:135`, `:153` | Comments only, same wording. |
| `docs/docs/self-host/reference/01-configuration.mdx:891-894` | The key layout note (section 6). |
| `docs/design/sharing-program/interfaces/m4a/{interfaces,technical-design}.md` | NEW: this folder. |
| `docs/design/sharing-program/CONTRACT.md` | Section 7 edits (sections 9 and 14). |
| `openspec/changes/remove-workspaces-org-storage/` | Section 7 edits. |

### Files shared with M1, M2 or M3

M4a is built in clone B (`~/code/agenta-sharing-2`) while M1 to M3 are built in clone A. M4a stays out of every application file those plans change.

| Shared item | Who else | How to merge |
| --- | --- | --- |
| The `core_oss` revision chain | M1 (044, 045), M2 (046, 047), M3 (048, 049) | Ids are allocated centrally, so no file name clashes. `down_revision` is set from the integration target before merge (section 3.3). |
| `docs/docs/self-host/reference/01-configuration.mdx` | M1 (removes the `AGENTA_DEMOS` rows near lines 169 and 1501) | Different hunks (M4a: lines 891-894). |
| `docs/design/sharing-program/CONTRACT.md` | Lane `docs/sharing-program-specs` (clone A) | M4a edits sections 9 and 14 only. Apply them on the docs lane if it has not merged, or in the M4a PR if it has. |
| `docs/design/sharing-program/interfaces/` | M1, M2, M3 folders | M4a adds only `m4a/`. |
| `openspec/changes/remove-workspaces-org-storage/` | M4b later | M4a edits first. |

Checked and not shared: M1 to M3 do not touch `core/mounts/*`, `dbs/postgres/mounts/*`, `core/sessions/mounts/*`, the mount tests, `fileActivity.ts` or the runner files above. M4a does not touch `apis/fastapi/sessions/router.py`, `apis/fastapi/mounts/router.py`, `core/tools/platform_handlers.py`, `core/agent_templates/loader.py`, `entrypoints/*`, `api/AGENTS.md`, `api/oss/src/utils/env.py` or the Fern client.

## 2. Key flows

### 2.1 New mount (any create path)

1. A route, handler or worker calls one of the existing `MountsService` create methods. Nothing new is passed.
2. The DAO mints `mount_id = uuid7()` and writes `storage_prefix = project_storage_prefix(project_id=..., mount_id=mount_id)` in the same INSERT or upsert.
3. The row comes back (refresh or `RETURNING`) with the stored prefix.

### 2.2 Re-bind (sign on every turn)

`get_or_create_session_mount` and `get_or_create_agent_mount` run the upsert. On conflict the existing row and its prefix win. One statement, as today.

### 2.3 File operation, credential signing, teardown

`_resolve_mount` reads the row (as today). `_storage_key(mount=mount, path=...)` returns `[<namespace>/]<storage_prefix>/<path>`. `sign_mount_credentials` signs `[<namespace>/]<storage_prefix>`. `delete_session_mounts` gets the rows from `delete_by_session_id` (which returns them before the delete commits) and deletes each stored prefix.

## 3. Migration and release

### 3.1 Revision steps

Interfaces 1.2 has the exact SQL and order. All steps run in the hook transaction. `ADD COLUMN` takes the table lock first, so no insert slips between the backfill and `SET NOT NULL`. Mount reads and writes wait while the revision runs. The duration is measured, not assumed: Task 1 of the plan times the revision on a seeded table, and the PR body carries the duration.

### 3.2 Release procedure (one release)

1. The PR carries the `migration:destructive-approved` label. The PR body has the gate output (one finding, the NOT NULL tightening) and why it is safe (the backfill and the trigger in the same revision).
2. Deploy as usual. The hook runs the revision before any new pod starts. If the lock timeout fires, retry the deploy.
3. Nothing to do after the rollout.

Self-hosted: upgrade only.

### 3.3 Revision id and the single-head check

- Id `oss000000050`. The builder does not pick a number.
- Before the PR opens and again before it merges: `but pull` in clone B, so the workspace base is the current integration target (`origin/release/v0.122.11`). Read the target's head with Alembic on an export of the target tree (chain order, not file numbers, decides the head):
  `D=~/agenta-m4a-qa/target-chain && rm -rf $D && mkdir -p $D && git archive origin/release/v0.122.11 api/oss/databases/postgres/migrations/core_oss | tar -x -C $D && cd api && uv run --no-sync python -c "import sys; from alembic.script import ScriptDirectory; print(ScriptDirectory(sys.argv[1]).get_heads())" $D/api/oss/databases/postgres/migrations/core_oss`
  It prints one id. Set `down_revision` to it.
- Check the graph with Alembic on the clone's working tree (target plus M4a): `cd api && uv run --no-sync python -c "from alembic.script import ScriptDirectory; print(ScriptDirectory('oss/databases/postgres/migrations/core_oss').get_heads())"`. Expected: `['oss000000050']`.
- If `down_revision` changed after the revision was applied on stack B, the stack's version stamp is stale. Rebuild the stack database (`run.sh ... --down --nuke`, then deploy) and run the upgrade again from the target schema. Do not edit the stamp by hand.

### 3.4 Rollback

Roll the application back if needed. Every row has the project layout, so the previous code is correct on every row; the trigger keeps its inserts valid. `downgrade()` is safe in M4a but is not needed.

### 3.5 Follow-up: the M4b mount step (next release, not in this PR)

Ships in the release after M4a, with M4b. It does not depend on M1: if M4b slips, it ships alone. Every pod then runs M4a or later, and M4a pods read the stored prefix and write it explicitly.

| Part | Change |
| --- | --- |
| Revision | `DROP TRIGGER IF EXISTS trg_mounts_fill_legacy_storage_prefix ON mounts; DROP FUNCTION IF EXISTS mounts_fill_legacy_storage_prefix();`. Gate: passes. |
| `core/mounts/types.py` | Add `organization_storage_prefix(*, organization_id, mount_id) -> str` (`mounts/<organization_id>/<mount_id>`). Remove `project_storage_prefix` when nothing uses it. |
| `core/mounts/service.py` | Add `is_organization_keyed(*, mount, organization_id) -> bool`, true exactly when the stored prefix equals `organization_storage_prefix(organization_id, mount.id)`, next to `is_protected_mount`. M6c calls it. |
| `dbs/postgres/mounts/dao.py` | Both inserts write the organization layout inside the insert statement: `'mounts/' \|\| (SELECT organization_id::text FROM projects WHERE id = :project_id) \|\| '/' \|\| :mount_id`, through `sqlalchemy.table("projects", ...)`. Use `\|\|`, never `concat()` (a missing project must give NULL, not `mounts//<id>`). No new round trip. A Postgres test pins the SQL to `organization_storage_prefix`. |
| Tests | `acceptance/mounts/test_mounts_injection.py` expects `mounts/<organization_id>/<mount_id>` (organization id from `GET /projects/current`); predicate unit tests (organization layout, project layout, `mounts/O/M/extra`, another organization); STS isolation QA: a new mount's credentials deny `mounts/<organization_id>/<other mount>/` and `mounts/<project_id>/<this mount>/`. |
| Docs | Self-host note: newer mounts use `mounts/<organization_id>/<mount_id>`. |

Mixed versions during that rollout: M4a pods write the project layout explicitly and read the stored prefix, so they serve organization-keyed rows correctly and need no trigger. Rollback from the step to M4a: M4a reads the stored prefix, so organization-keyed mounts keep working.

## 4. Test plan

Commands (clone B, from `api/`): unit `uv run --no-sync python run-tests.py --layer unit` (`AGENTA_LICENSE=ee` for EE); integration and acceptance with `--env-file ../hosting/docker-compose/<edition>/.env.<edition>.dev.sharing2`. Integration tests carry `pytestmark = pytest.mark.integration`.

### 4.1 Unit (no database)

| File | Tests |
| --- | --- |
| `unit/mounts/test_storage_prefix.py` | `test_project_storage_prefix_has_no_namespace_and_no_trailing_slash`; `test_storage_key_uses_the_stored_prefix`; `test_storage_key_ignores_the_project_id` (a row whose `project_id` differs from its prefix keeps its prefix: the M6 move case); `test_storage_key_without_namespace_has_no_leading_slash`; `test_sign_scopes_the_namespaced_stored_prefix`; `test_mount_dump_has_no_storage_prefix` (`MountResponse(...).model_dump()`); `test_session_mount_view_keeps_storage_prefix`; `test_delete_session_mounts_deletes_the_stored_prefix`. |
| existing mount unit tests | Fixtures carry a prefix; behavior assertions unchanged. |

### 4.2 Integration against Postgres

`integration/sessions/test_mounts_storage_prefix_postgres.py`, with a scope fixture copied from `integration/sessions/test_attachment_dao_integration.py:52-136`. The revision's SQL constants are loaded from `oss000000050_add_mounts_storage_prefix.py` with `importlib.util.spec_from_file_location`. Old-pod rows are inserted with the full column set the old mappings write: `project_id`, `id`, `slug`, `name`, `session_id`, `agent_id`, `purpose`, `flags = '{}'`, `data = '{}'`, `tags`, `meta`, `created_by_id`, and no `storage_prefix`.

| Test | Asserts |
| --- | --- |
| `test_backfill_sql_writes_the_project_layout` | On a session temp table `mounts (project_id uuid, id uuid, storage_prefix varchar)` (shadows the real table in `pg_temp`): the row gets `mounts/<project_id>/<id>`; a second run changes 0 rows. |
| `test_old_pod_insert_gets_the_project_layout` | An old-shaped insert on the migrated table; the row stores `mounts/<project_id>/<id>`. |
| `test_old_pod_rebind_keeps_the_stored_prefix` | A row exists; an old-shaped `INSERT ... ON CONFLICT ON CONSTRAINT uq_mounts_project_id_slug DO UPDATE SET updated_at = now() RETURNING id, storage_prefix` succeeds and returns the existing id and prefix. |
| `test_dao_reads_an_old_pod_row` | `MountsDAO.fetch_mount` on an old-shaped row returns a `Mount` with the project-layout prefix (the `data = '{}'` row validates). |
| `test_create_mount_writes_the_project_layout` | `MountsDAO.create_mount`: `storage_prefix == project_storage_prefix(project_id=P, mount_id=mount.id)`. |
| `test_upsert_writes_the_prefix_once` | First upsert stores the project layout; a second upsert with the same slug returns the same id and prefix. |
| `test_upsert_runs_one_statement_on_both_paths` | After one warm-up call on the same engine, a `before_cursor_execute` listener on `engine._engine.sync_engine` counts 1 statement for an upsert that inserts and 1 for an upsert that conflicts. |
| `test_column_is_not_null` | `information_schema.columns` reports `is_nullable = 'NO'` for `mounts.storage_prefix`. |

Migration gate: exactly one finding (the NOT NULL tightening).

### 4.3 Acceptance (real stack, OSS and EE)

| File | Test |
| --- | --- |
| `acceptance/mounts/test_mount_storage_prefix_hidden.py` (NEW) | `test_openapi_has_no_storage_prefix` (`GET /openapi.json` on the deployed stack; no schema in `components.schemas` declares a `storage_prefix` property; the `MountCredentials` description names it in prose); `test_mount_responses_have_no_storage_prefix` (`POST /mounts/`, `GET /mounts/{id}`, `POST /mounts/query`, `POST /sessions/mounts/sign`: no `storage_prefix` key in any `mount` object). |
| `acceptance/sessions/test_session_attachment_teardown.py` | Existing tests, with the prefix captured before delete; must stay green. |
| `acceptance/mounts/*` | Existing tests; must stay green. |

### 4.4 Live QA (stack B, OSS and EE)

| Case | How |
| --- | --- |
| Old mounts keep their files | Baselines are created on the base build of each edition before either upgrade (plan Task 0). After the upgrade, the same mounts show the same files through the API and the same chat reads them in a new turn. |
| New mounts | A new session mount and a new agent mount store `mounts/<project_id>/<mount_id>`; a file written in turn 1 is read in turn 2 (local runner). |
| Previous-release pod on the new schema | After plan Task 1 the lane has the revision and the column but the old service and DAO code, which is exactly a previous-release pod on the new schema. On the stack: a sign, a file write, a re-sign and an attachment upload succeed; the new rows store the project layout through the trigger; the files are under that prefix. |
| Namespace | Unit test `test_sign_scopes_the_namespaced_stored_prefix`; on the stack only if it can be restarted with `AGENTA_STORE_NAMESPACE`. |
| Classic `/w` | A `/w` agent chat with a file: the file persists across two turns. |
| Latency | `POST /api/sessions/mounts/sign` and `GET /api/mounts/{id}/files` with the seeded account's API key, on a mount that account created; before and after, per edition, same stack. |

## 5. Audit and observability

No new log event. The prefix holds ids only, never a credential.

## 6. Docs and config

| Item | Change |
| --- | --- |
| `docs/design/sharing-program/interfaces/m4a/` | NEW: these two files. |
| `CONTRACT.md`, OpenSpec | Section 7. |
| `docs/docs/self-host/reference/01-configuration.mdx:891-894` | "The **row** is the mount's stored prefix, `mounts/<project_id>/<mount_id>`. A full key is `<bucket>/[<namespace>/]<stored prefix>/...`." The namespace paragraph stays. |
| `api/AGENTS.md` | No change. The rule "only `MountsService._storage_key` builds a mount key, from the stored prefix" is local to the mounts domain and lives in that docstring. |
| `api/oss/src/utils/env.py`, `hosting/docker-compose/*/env.*.example`, `hosting/kubernetes/*/values*.yaml`, Helm charts, Railway | No change. |
| Fern client | No regeneration (interfaces 2.2). |
| Release note | None needed: no visible change. |

## 7. Edits to the shared specs (applied in the lane, not in the spec worktree)

| File | Edit |
| --- | --- |
| `CONTRACT.md` section 9 | Add: "M4a stores the prefix and makes all code read it; new mounts keep the project layout. The M4b mount step, one release later, writes `mounts/<org_id>/<mount_id>/` for new mounts and drops the fill trigger." |
| `CONTRACT.md` section 14 | Pieces: M4a = "Stored mount prefix, read everywhere; project layout kept". M4b gains "organization-keyed paths for new mounts, drop the fill trigger". Implementation table: M6c needs "M3, M4b mount step, M6b" (it calls `is_organization_keyed`). Release table: M6c needs "the M4b mount step and M6b". The M4b mount step: needs nothing but M4a live. |
| OpenSpec `proposal.md` | Split What Changes into M4a (stored prefix, read everywhere) and the M4b mount step (organization layout, predicate, trigger drop), then the workspace bullets. |
| `design.md` Context | Only M4b's workspace part starts after M1. |
| `design.md` D1 | Keep. The column is NOT NULL from M4a. |
| `design.md` D2 | Replace: "M4a: the DAO mints the mount id and writes the project layout in the insert. M4b mount step: the DAO writes the organization layout in the insert statement, reading `projects.organization_id` in the same statement. The create methods keep their signatures. Core defines the layout; a Postgres test pins the SQL to it." |
| `design.md` D3 | The predicate arrives with the M4b mount step, in `core/mounts/service.py` next to `is_protected_mount`. |
| `design.md` D4 | Replace the steps: M4a adds the column, the fill trigger, the backfill and NOT NULL, and switches every reader; new mounts keep the project layout, so previous-release pods agree on every path. The M4b mount step drops the trigger and starts the organization layout. No NULL rule anywhere. |
| `design.md` D5 table | Step 1 and step 2: remove the mount steps A and B. Step 1 gains "the M4b mount step" (section 3.5 here). |
| `design.md` Interfaces block | `MountsDAOInterface` signatures unchanged. `Mount.storage_prefix` is `Field(exclude=True)`. |
| `design.md` Migration table and Risks | M4a row: previous-release pods insert through the trigger and compute the same path; rollback is safe. |
| `specs/mount-storage-prefix/spec.md` | "The service SHALL mint the mount id before the insert" becomes "The insert that creates a mount SHALL write its id and its prefix". Scenario "New agent mount": "after the M4b mount step". Requirement "Mount rollout is safe with old pods": in M4a, every new row SHALL store the project layout, and a re-bind on a previous-release pod SHALL succeed and keep the stored prefix; in the M4b mount step, pods of M4a SHALL serve organization-keyed mounts. Remove "Between them, a row with no prefix SHALL read as the project layout". Add "Response shape": no API response SHALL include `storage_prefix`. The predicate requirement stays and names the M4b mount step. |
| `tasks.md` | New section "M4a (one release)": column, trigger, backfill, NOT NULL, readers, docs and config, QA "Bucket and STS" (scope) and "Runner". New section "M4b mount step": trigger drop, organization layout, predicate, STS isolation of organization prefixes. Remove those parts from steps 1 and 2. |

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| A trigger is a new pattern in this repo's migrations | One trigger, a `WHEN` guard that is false for all M4a code, dropped by the next release. |
| The lock is not granted | `lock_timeout = 5s`; the hook fails cleanly and the deploy is retried. |
| `SET NOT NULL` blocks mount traffic while the revision runs | Measured on a seeded table before the PR (plan Task 1). |
| Code later dumps a `Mount` and rebuilds it without the excluded field | The field is required, so the rebuild fails loudly in tests. |
| The organization layout lands one release later | Nothing needs it before M6c, which already needs M3 and M6b. |

## 9. Open questions (least-work default chosen)

1. Should the API expose `storage_prefix`? Default: no. The signed `credentials.prefix` already gives the runner what it needs. Exposing it later is additive.
2. Should the M4b mount step ship alone if M4b slips? Default: yes. It has no M1 dependency.
