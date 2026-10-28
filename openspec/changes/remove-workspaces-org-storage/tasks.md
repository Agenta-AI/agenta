# Tasks

The releases of design.md D4 and D5; each ships after the previous one runs on every pod. Shared schema in `core_oss`, meters in `core_ee`. Run `uv run api/scripts/migration_gate.py` on every revision. Spec references: MSP = mount-storage-prefix, WR = workspace-removal, MS = meter-scope.

## 0a. M4a (one release)

- [ ] 0a.1 `core_oss` revision `oss000000050` (label): `storage_prefix` column, fill trigger, backfill, `NOT NULL` (MSP "contract layout", "rollout").
- [ ] 0a.2 Readers: stored prefix through DBA, DTO (`Field(exclude=True)`) and mappings; `_storage_key` takes the mount (MSP "one code path", "response shape").
- [ ] 0a.3 Writers: the DAO mints the id and writes the project layout in the insert.
- [ ] 0a.4 Docs and config: self-host key layout note; no env, Helm, Railway or Fern change.
- [ ] 0a.5 QA "Bucket and STS" (credentials cover exactly the stored prefix) and "Runner" (old and new mounts keep files across turns).

## 0b. The M4b mount step (the release after M4a)

- [ ] 0b.1 `core_oss` revision `oss000000051`: drop the fill trigger and its function.
- [ ] 0b.2 Organization layout for new mounts, written in the insert statement (MSP "contract layout").
- [ ] 0b.3 Predicate in `core/mounts/service.py` (MSP "predicate").
- [ ] 0b.4 QA: STS isolation of organization prefixes.
- [ ] 0b.5 Docs: self-host key layout note; upgrade note (upgrade through the M4a release for a clean rolling upgrade).

## 1. Step 1: accept

- [ ] 1.0 Count on production (read only): organizations with several workspaces, meter rows with a workspace, default projects per organization. Record them in private notes, not in the PR.
- [ ] 1.1 `core_oss` revision `oss000000052`: drop every foreign key from `projects.workspace_id` to `workspaces`; `projects.workspace_id` nullable; admin workspace deletion deletes its projects explicitly (WR "organization only").
- [ ] 1.4 Auth and routes accept organization ids and legacy workspace ids (WR "safe with old pods").
- [ ] 1.5 Serve the data that step 2 writes: a project with a NULL `workspace_id` and an organization or user with no workspace rows answer the organization id where a workspace id is expected, with no error and no denial (WR "safe with old pods").
- [ ] 1.6 Docs and config: upgrade note; no env, Helm, Railway or Fern change.
- [ ] 1.7 `MeterScope` accepts a project scope without a workspace, so accept-step pods read the meter rows that switch-step pods write (the usage report during the switch rollout and after a rollback) (MS "re-keying").

## 2. Step 2: switch

- [ ] 2.1 `core_oss` revision `oss000000053` (label): the 2.0 repair, then one default project per organization by the WR order; it sets no default where none exists; dump `projects` first (WR "default project").
- [ ] 2.1a Readers pick one default project per organization by the WR order when several remain; 2b.1 repeats the consolidation (D-20 of the M4b step-1 plan).
- [ ] 2.1b Make `get_project_by_workspace` and `fetch_default_project` agree before step 2 stops writing workspace rows. In step 1 they differ on purpose for a workspace that has projects but no default project (the first keeps today's answer, the workspace's own project; the second answers the organization default).
- [ ] 2.1c Step 2 uses one default-project rule for `check_organization_write`, `fetch_default_project` and `get_project_by_workspace` (today `check_organization_write` takes the oldest default project of the organization; the M4b step-1 lookup takes the default project of the `default`-type workspace first; they differ only in multi-workspace organizations).
- [ ] 2.0 Before step 2, repair every project whose workspace belongs to another organization (`projects.organization_id` wins; `workspace_id` becomes NULL); step 2 refuses the shape: the organization comes only from the project, and a legacy workspace id maps only within the project's organization (CONTRACT section 1; step 1 keeps the legacy answer).
- [ ] 2.1d Every writer of `is_default` (set default, project create, admin project create, the 2.1 revision) takes one organization-scoped lock; an organization that had a default keeps exactly one (WR "default project").
- [ ] 2.2 `core_ee` revision `ee0000000007` (label): meter re-key; dump `meters` first; it refuses a row that has a workspace and no project; it holds the usage-report lock for the whole run, and report bumps compare the `synced` they read (MS "re-keying").
- [ ] 2.3 Auth states and tokens written by accept-step pods: switch-step pods take the organization id, never the cached workspace id; the Bearer branches that have `workspace_id` or no `project_id` use a new state key version; every credential path refuses a request whose organization is not its project's organization (WR "safe with old pods", "run credentials").
- [ ] 2.4 `AuthScope` without workspace; every `sign_secret_token` caller signs the organization id; `scope_type="workspace"` (WR "run credentials").
- [ ] 2.5 Responses per D6 (WR "organization id answers").
- [ ] 2.6 Stop creating and updating `workspaces` and `workspace_members` rows and writing `projects.workspace_id`, including the M1 mirror, signup, ownership transfer and the admin account graph; removals keep deleting the legacy rows until 2b.3; create and rename return 410 (WR "M1 mutations", "unsupported").
- [ ] 2.7 Member routes on `set_member_role` and `remove_member`; delete the workspace functions in `db_manager.py` and `organization_service.py` (WR "M1 mutations").
- [ ] 2.8 Keep the `workspace` role scope (WR "role scope").
- [ ] 2.9 EE meter scope without workspace; the meters DAO keeps the stored `meter_id` of a row and reads only rows without a workspace as current (MS "scope", "re-keying").
- [ ] 2.10 Emails, session links, `/m` segment rewrite; `pnpm lint-fix` in `web` (WR "legacy links").
- [ ] 2.11 Regenerate the Fern client from an EE OpenAPI spec, on a base that holds every change of the release.
- [ ] 2.12 Docs and config: upgrade note; the dynamic access controls page (meter scopes `organization`, `project`, `user`; a plan override with `workspace` reads as `organization`); no env, Helm or Railway change.

## 2b. Step 2b: stop reading

- [ ] 2b.1 `core_oss` revision (label): rerun the 2.0 repair and the 2.1 consolidation.
- [ ] 2b.2 `core_ee` revision (label): rerun the 2.2 fold under the usage-report lock (MS "re-keying").
- [ ] 2b.3 Remove every read and write of `workspaces`, `workspace_members`, `projects.workspace_id` and `meters.workspace_id`, including the legacy-id mapping, the no-parameter selection by workspace membership and the legacy deletes (WR "safe with old pods").
- [ ] 2b.4 Docs: upgrade note (links with only a legacy workspace id stop working in `/w`).

## 3. Step 3: contract

- [ ] 3.1 Dump `workspaces`, `workspace_members`, `projects` and `meters`.
- [ ] 3.2 `core_ee` revision: drop `meters.workspace_id` (MS "re-keying").
- [ ] 3.3 `core_oss` revision (label): drop the column and tables and their models (WR "organization only").
- [ ] 3.4 Check that no code reads the dropped objects (2b.3 removed every reader).

## 4. QA matrix

| Boundary | Test |
| --- | --- |
| Bucket and STS | Dedicated bucket and namespaced preview: old mount works; new mount uses the stored prefix (project layout in M4a, organization layout after the M4b mount step); its STS credentials reach nothing else. |
| Runner | Daytona and local: old and new mounts both keep files across turns. |
| Classic `/w` (OSS, EE) | Switch projects, playground, members page (invite, change role, remove), with organization ids in the URL. |
| `/m` and SDK | An old bookmark is rewritten; `ag.init()` resolves scopes; the trace link opens. |
| Mixed versions | Production copy: each step with the previous step's pods serving; no 401 spike, missing file or deleted project. |
| EE meters | After re-key and fold, per-user `TRACES_RETRIEVED` equals the sum before; `TRACES_INGESTED` and the next Stripe report are unchanged. |
| Multi-workspace fixture | Same project access for every member; one default project. |
