# Tasks

Tasks name the scenarios they make pass. Run `ruff format` and `ruff check --fix` in `api/` before each commit. One release and one implementation PR with ordered commits in the order of these sections. A signature change and all its callers land in one commit; no interim compatibility code.

## 1. Migration and script

- [ ] 1.1 `core_oss` data revision: delete demo rows, P1, P2a, P6 (design D6). Run `uv run api/scripts/migration_gate.py`. Scenarios: "Owner without rows", "Role changed through the workspace endpoint", "Demo rows deleted", "Demo-only user loses the organization", "Mixed demo and real user keeps the organization".
- [ ] 1.2 Unique index revision, concurrent, guarded. Scenarios: "Duplicate rows stop the upgrade", "Duplicate insert".
- [ ] 1.3 `entrypoints/memberships_check.py` with `--report`, `--apply` (P5 keep-oldest, P2b) and `--materialize`. Scenarios: "Multi-workspace organization", "User without a workspace row", "No-RBAC member without a row", "Oldest duplicate kept", "Stale row corrected", "Demo row and real row for one project", "Rerun cannot restore demo access".
- [ ] 1.4 Run `--report` from the release checkout on a copy of each region and on a seeded OSS database. Output under `~/`, counts in private notes (never in the repository or a PR).

## 2. Memberships domain

- [ ] 2.1 DTOs, exceptions, `MembershipsDAOInterface`, Postgres DAO and mappings in `oss/src/dbs/postgres/memberships/`, including `list_projects`. Scenario: "Seeding fails".
- [ ] 2.2 `MembershipsService.resolve`, `is_member`, `list_for_user`. Scenarios: `project-membership` "The edition policies apply as designed".
- [ ] 2.3 The four writers with cache invalidation and the audit log (D4, D8, D9). Scenarios: `membership-mutations`.

## 3. Access service

- [ ] 3.1 `Action`, `RoleRequirement`, `Decision`, `DecisionReason`, `AccessError`, `RbacEnforcementInterface` and the EE adapter.
- [ ] 3.2 `AccessService.check_capability`. Port `oss/tests/pytest/unit/access/test_project_member_lookup.py` without the demo cases. Scenarios: `project-capability-checks`.
- [ ] 3.3 The wrapper; delete `check_rbac_permission` and `check_user_access_to_workspace`; move the two direct callers. Scenarios: "Role check", "Remove by a non-admin".
- [ ] 3.4 `bootstrap_access()` in `entrypoints/routers.py`, `worker_streams.py`, `worker_queues.py`. Scenario: "Worker without wiring".

## 4. Readers

- [ ] 4.1 Bearer `?project_id=`, the project list and the project fetch call the resolver. Scenarios: "OSS project created by another member", "Bearer non-member", "Workspace row deleted".

## 5. Writers and routes

- [ ] 5.1 Replace the `db_manager` membership writers, the sync, auto-join and invite accept with the service writers.
- [ ] 5.2 Workspace create seeds its default project through `create_project`. Scenario: "New workspace".
- [ ] 5.3 Ownership transfer through `transfer_ownership`. Scenarios: "New owner without project rows", "Transfer fails".
- [ ] 5.4 Permission checks on `POST /projects`, `PATCH /projects/{id}`, `DELETE /projects/{id}` (design D5a). Scenarios: "Viewer creates a project", "Editor renames a project", "Admin deletes a project", "Non-member updates a project".
- [ ] 5.5 Delete the demo feature (design D4a). Scenarios: "Signup with AGENTA_DEMOS set".

## 6. Docs and config

- [ ] 6.1 `api/AGENTS.md`: a "Project membership and access" entry (resolver only, writers only through `MembershipsService`, `bootstrap_access()` in every process).
- [ ] 6.2 `docs/designs/oss-ee-convergence/migration-chains-and-edition-switch.md` for both directions; release notes for the OSS access change, the project route permissions and the removed `AGENTA_DEMOS`; EE upgrade note for `--apply`.
- [ ] 6.3 Config: delete `ExtrasConfig.demos` in `api/oss/src/utils/env.py`; the `AGENTA_EXTRAS_DEMOS` lines in `hosting/docker-compose/{oss,ee}/env.*.example`; the `demos` block in `hosting/kubernetes/{oss,ee}/values.*.example.yaml`, Helm `_helpers.tpl` and `values.schema.json`; `AGENTA_DEMOS` in the cloud deploy config.
- [ ] 6.4 Regenerate the Fern client from an EE spec; delete the web `is_demo` reads; `pnpm lint-fix` in `web/`.
- [ ] 6.5 Update `docs/design/sharing-program/interfaces/m1/` if the code differs.

## 7. QA (real boundaries)

| Case | Edition | Check |
| --- | --- | --- |
| Legacy shapes | both | seeded P1 to P12 shapes decide as the expected table says after the migration and `--apply` |
| Agreement | both | Bearer, project list and `check_action_access` agree |
| Preflight | EE copy | `--report` lists P3 and P4 and writes nothing; `--apply`, then the `core_oss` revisions, then `--report` shows P5 = 0 (demo rows of a duplicate group go with the data revision) |
| OSS to EE with stale role rows | seeded OSS then EE | stale `viewer` row becomes `editor` after `--materialize` |
| Project routes | both | viewer 403 on create; editor 403 on rename; admin 403 on delete; owner creates, renames, deletes |
| Ownership transfer | EE | the new owner edits in a project where they had no row |
| `/m` | `run.sh --oss --dev`, `--ee --dev` | owner and invited member open each project; a viewer sees the 403 text on create |
| `/w` | both | login, project list, project switch, invite, role change, remove member, prompts and evaluations, workspace-shaped API answers |
| Workers | both | a queued chat runs; no `AccessServiceNotRegistered` in the logs |
| Demo removed | both, `AGENTA_DEMOS` set | a new signup is not a member of that project or its organization |
| Docs and config | both | task 6 items present; `grep -rn -e AGENTA_DEMOS -e AGENTA_EXTRAS_DEMOS api hosting` returns nothing |
