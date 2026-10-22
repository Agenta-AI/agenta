# Tasks

Three releases (design.md D4, D5); each ships after the previous one runs on every pod. Shared schema in `core_oss`, meters in `core_ee`. Run `uv run api/scripts/migration_gate.py` on every revision. Spec references: MSP = mount-storage-prefix, WR = workspace-removal, MS = meter-scope.

## 0a. M4a (one release)

- [ ] 0a.1 `core_oss` revision `oss000000050` (label): `storage_prefix` column, fill trigger, backfill, `NOT NULL` (MSP "contract layout", "rollout").
- [ ] 0a.2 Readers: stored prefix through DBA, DTO (`Field(exclude=True)`) and mappings; `_storage_key` takes the mount (MSP "one code path", "response shape").
- [ ] 0a.3 Writers: the DAO mints the id and writes the project layout in the insert.
- [ ] 0a.4 Docs and config: self-host key layout note; no env, Helm, Railway or Fern change.
- [ ] 0a.5 QA "Bucket and STS" (credentials cover exactly the stored prefix) and "Runner" (old and new mounts keep files across turns).

## 0b. The M4b mount step (the release after M4a)

- [ ] 0b.1 `core_oss` revision: drop the fill trigger and its function.
- [ ] 0b.2 Organization layout for new mounts, written in the insert statement (MSP "contract layout").
- [ ] 0b.3 Predicate in `core/mounts/service.py` (MSP "predicate").
- [ ] 0b.4 QA: STS isolation of organization prefixes.

## 1. Step 1: accept

- [ ] 1.0 Count on production (read only): organizations with several workspaces, meter rows with a workspace, default projects per organization. Record them in the PR.
- [ ] 1.1 `core_oss` revision: drop the project FK; `projects.workspace_id` nullable (WR "organization only").
- [ ] 1.4 Auth and routes accept organization ids and legacy workspace ids (WR "safe with old pods").

## 2. Step 2: switch

- [ ] 2.1 `core_oss` revision (label): one default project per organization (WR "default project").
- [ ] 2.2 `core_ee` revision: meter re-key (MS "re-keying").
- [ ] 2.4 `AuthScope` without workspace; every `sign_secret_token` caller signs the organization id; `scope_type="workspace"` (WR "run credentials").
- [ ] 2.5 Responses per D6 (WR "organization id answers").
- [ ] 2.6 Stop all workspace writes, including the M1 mirror; create and rename return 410 (WR "unsupported").
- [ ] 2.7 Member routes on `set_member_role` and `remove_member`; delete the workspace functions in `db_manager.py` and `organization_service.py` (WR "M1 mutations").
- [ ] 2.8 Keep the `workspace` role scope (WR "role scope").
- [ ] 2.9 EE meter scope without workspace (MS "scope").
- [ ] 2.10 Emails, session links, `/m` segment rewrite; `pnpm lint-fix` in `web` (WR "legacy links").
- [ ] 2.11 Regenerate the Fern client from an EE OpenAPI spec.

## 3. Step 3: contract

- [ ] 3.1 Dump `workspaces` and `workspace_members`.
- [ ] 3.2 `core_ee` revision: fold, drop `meters.workspace_id` (MS "re-keying").
- [ ] 3.3 `core_oss` revision (label): drop the column and tables and their models (WR "organization only").
- [ ] 3.4 Remove the legacy-id mapping.

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
