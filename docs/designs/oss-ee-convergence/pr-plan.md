# PR plan — OSS multi-org + schema parity

Working doc for executing [assessment-a-oss-multi-org.md](assessment-a-oss-multi-org.md)
as 6 GitButler PRs. Updated as work proceeds; this file is the source of truth for
task state (context gets compacted between operations).

## Topology

| PR | Lane | Branch | Scope | Status |
| --- | --- | --- | --- | --- |
| 0 | A (parallel) | `docs/oss-ee-convergence-design` | Everything in `docs/designs/oss-ee-convergence/` | [#4669](https://github.com/Agenta-AI/agenta/pull/4669) |
| 1 | B (stack base) | `feat/oss-membership-tables` | Step 1: membership tables OSS-ward + backfill + parity step 1 drift fixes | [#4671](https://github.com/Agenta-AI/agenta/pull/4671) |
| 2 | B (on 1) | `feat/oss-org-creation` | Step 2: shared org-creation core + signup flow (changes 2, 3) | [#4673](https://github.com/Agenta-AI/agenta/pull/4673) |
| 3 | C (parallel) | `feat/oss-access-vars` | Step 3: enforce `AGENTA_ACCESS_*` in OSS (change 4) | [#4674](https://github.com/Agenta-AI/agenta/pull/4674) |
| 4 | B (on 2) | `feat/oss-singleton-sweep` | Step 4: singleton-assumption sweep + web gate relaxation (change 5) | [#4675](https://github.com/Agenta-AI/agenta/pull/4675) |
| 5 | B (on 4) | `chore/drop-legacy-tables` | Step 5: drop 20 legacy tables + dead model cleanup (parity step 2) | [#4676](https://github.com/Agenta-AI/agenta/pull/4676) |
| 6 | E (parallel) | `docs/oss-multi-org-docs` | Final phase: product docs (MDX) + migration page + AGENTS.md GitButler notes | [#4677](https://github.com/Agenta-AI/agenta/pull/4677) |
| 7 | B (on 5) | `feat/migration-chain-split` | Phase 2: align revision `a00000000000` parks both legacy chains; new chains `core_oss` (alembic_version_oss) + `core_ee` (alembic_version_ee); runner order + asserts | [#4680](https://github.com/Agenta-AI/agenta/pull/4680) |
| 8 | B (on 7) | `feat/oss-to-ee-adoption` | Adoption revision `e00000000003`: create-if-missing EE schema + subscriptions/USERS backfill; no-op on EE-origin DBs | [#4683](https://github.com/Agenta-AI/agenta/pull/4683) |
| 9 | F (parallel) | `feat/postgres-db-prefix` | `POSTGRES_DB_PREFIX` resolution (URIs > prefix > license default) | [#4684](https://github.com/Agenta-AI/agenta/pull/4684) |

Rationale: 1→2→4 each build on the previous (schema → creation path → sweep of
remaining singleton callers). 3 is a tiny independent deletion shippable before
multi-org. 0 is docs. 5 was planned as a parallel lane but is stacked on lane B:
its drop migrations must extend PR 1's revisions (`1b2c3d4e5f6a` / `2c3d4e5f6a7b`)
or each chain would get two alembic heads.

Merge order: #4669 and #4674 any time; then #4671 → #4673 → #4675 → #4676 →
#4680 → #4683; #4684 any time (GitHub bases are set to the parent branch, so
each shows only its own diff; retarget to main as parents merge).

Schema-state checkpoints for dump/diff testing, per edition (ids updated for the
v0.103.5 merge + the readable-id rename — see "v0.103.5 reconciliation" below):
- after #4676: cleanup done; heads OSS `4f5a6b7c8d9e`, EE `5a6b7c8d9e0f`;
  tracing `a4b5c6d7e8f9`; single version table.
- after #4680: legacy parked at `park00000000` (both editions, same id);
  alembic_version_oss at `oss000000000`; EE also alembic_version_ee at
  `ee0000000000`.
- after #4680 (incl. proofs): alembic_version_oss at `oss000000001` (both
  editions); alembic_version_ee at `ee0000000001` (EE only).
- after #4683: alembic_version_ee at `ee0000000002`; OSS→EE switch path live
  (EE runner against an OSS-origin DB creates EE schema + backfills; second
  run must be a byte-identical dump).

## v0.103.5 reconciliation (merge propagated up the whole stack)

`release/v0.103.5` was merged into the stack base and propagated through every
branch (parents merged down into children; independent lanes merged v0.103.5
directly). What it changed and how it was reconciled:

- **New upstream migration `b3c4d5e6f7a9`** (`repair_workflow_revision_versions`,
  plus its data migration) in both core chains, forking from `a2b3c4d5e6f8` — the same
  parent as our membership/parity roots, i.e. a second alembic head. Fix: the
  chain roots re-point onto it, so order is
  `a2b3c4d5e6f8 → b3c4d5e6f7a9 → 0a1b2c3d4e5f` (OSS) and
  `… → b3c4d5e6f7a9 → 2c3d4e5f6a7b` (EE). One head per chain restored.
- **`_admin_detach_user_references` / `admin_delete_accounts_batch`** (new in
  v0.103.5, `oss db_manager`) reference `AppDB/AppVariantDB/
  AppVariantRevisionsDB/AppEnvironmentRevisionDB`. PR 5 drops those tables, so
  in PR 5 the App-table NULL-out loop and its imports are removed (no rows/FKs
  once the tables are gone); kept everywhere earlier in the stack where the
  tables still exist.
- **`db_manager_ee` import/symbol churn:** v0.103.5 re-added `func` and
  `count_organizations_by_owner`/`count_organization_members` to EE; the stack
  had moved some OSS-ward. Net result per branch: keep `func`, keep
  `count_organization_members`, drop the duplicate `count_organizations_by_owner`
  / `get_default_workspace_id` definitions the PRs already re-export from OSS
  (F811). Caught by ruff, not by git (silent auto-merge import loss).
- **`accounts/errors.py`:** keep v0.103.5's `AccountHasMembersError` /
  `AccountAuthDeletionError`; `OssMultiOrgNotSupportedError` stays deleted from
  PR 2 onward.
- **`env.py`** (track F): v0.103.5's `SmtpConfig` + parsing helpers coexist with
  `POSTGRES_DB_PREFIX`; no conflict.

**Readable revision-id rename** (alembic ids are arbitrary 12-char strings, not
hex — verified against alembic 1.18.4): the post-alignment ids were renamed for
legibility, roots ending in 0 like the park point:
`a00000000000→park00000000`, `o00000000001/2→oss000000000/1`,
`e00000000001/2/3→ee0000000000/1/2`. `ALIGN_REVISION` updated in both
`core_oss`/`core_ee` utils.

Still stale, regenerate before re-validating: the committed schema dumps
(`oss_core.txt`, `ee_core.txt`, diffs) predate v0.103.5's `workflow_revisions`
repair — re-run `dump_pg_schema.sh` after replaying the chains.

## Per-PR worklog — all complete

- **PR 0** (#4669): design folder committed (assessment, pr-plan, 4 dumps, 2 diffs,
  dump script). Title/body rewritten per the write-pr-description skill after review feedback.
- **PR 1** (#4671, commit 661a7d3): model move + EE re-export; OSS migration
  `0a1b2c3d4e5f` (3 membership tables with exact EE shapes incl. `updated_by_id`;
  api_keys.project_id NOT NULL after deleting NULL-project rows; projects FK
  dedup/rename, `uq_projects_id` dropped; org/workspace NOT NULL + CASCADE with
  backfill); OSS data migration `1b2c3d4e5f6a` (membership backfill from owners +
  used invitations, via `data_migrations/memberships.py`); EE migration
  `2c3d4e5f6a7b` (created_by_id nullable + FK NOT VALID→VALIDATE; projects model
  alignment); `get_user_organizations()` is_ee fork gone.
- **PR 2** (#4673, commit 0c8a441): new `oss/src/services/commoners.py`
  (can_create_organization + creation core + for_signup/for_user + OSS
  create_accounts); `oss/src/core/organizations/exceptions.py`; membership writers,
  transfer/count/delete org moved to OSS db_manager (EE re-exports); singleton
  helpers deleted from db_manager; overrides.py collapsed to `create_accounts(payload)`;
  invitation accept writes membership rows; OSS endpoints create/update/transfer/delete
  registered only when `not is_ee()` (OSS router is mounted before the EE routers and
  would shadow them); admin multi-org block + `OssMultiOrgNotSupportedError` deleted;
  admin membership creation now via shared models (EE admin_manager indirection gone);
  EE commoners slimmed to billing wrappers over the OSS core.
- **PR 3** (#4674, commit 5832bf9): `is_auth_info_blocked()` early-exit deleted;
  is_ee import removed. PostHog blocklist fallback now active in OSS too.
- **PR 4** (#4675, commit ab96500): `get_default_workspace_id(user_id)` moved
  OSS-ward (owner workspace, else oldest membership), middleware fork collapsed;
  `get_default_workspace_id_oss`/`get_oss_organization`/`OSS_SINGLETON_ORG_SLUG`
  deleted; org list = membership join with per-org workspaces; org details scoped to
  requested org (invitations via its default project); workspace list user-scoped;
  admin singleton delete-guards + admin_create_organization ON CONFLICT removed;
  web ListOfOrgs: selection enabled, New organization + owner submenu ungated, label
  shows org name (isEE import removed).
- **PR 5** (#4676, commit 9f7bcee): drop migrations OSS `3d4e5f6a7b8c` / EE
  `4e5f6a7b8c9d` (20 tables, children first, downgrade raises); 15 dead classes
  deleted from db_models.py; `models/db/models.py` shim and `models/converters.py`
  deleted (zero importers); dead `db_manager_ee.create_deployment` deleted;
  deprecated_models scaffolding kept.

## Final phase — product docs + AGENTS.md

- [x] Reviewed all pages in the assessment's "Documentation impact" table; edits
      written per the write-docs skill (how-to style, no em dashes, both-editions
      framing):
      guide 06 rewritten as "Restrict Sign-ups and Organization Creation"
      (canonical `AGENTA_ACCESS_ALLOWED_OWNER_EMAILS` + sign-up restriction +
      reference table; URL slug unchanged); upgrading page got a pre-upgrade
      caution; configuration page marks the four access vars as both-editions;
      quick-start notes open signup; dynamic-access-controls clarifies the
      EE-only vs both-editions split; opensource comparison gains a
      "Multiple Organizations ✅/✅" row; access-control/organizations notes
      multi-org applies to self-hosted OSS. sso/rbac/domain-verification pages
      verified: no wording change needed (plan-gated framing already correct).
- [x] New migration page `docs/self-host/upgrades/multi-org-migration.mdx`
      (posture flip + what the migration does + rollback note); sidebar is
      autogenerated, no sidebar change needed
- [x] AGENTS.md gains a "Branching and PRs with GitButler" section (workspace
      mode, lanes/stacks, hook-abort behavior, `but push` + `gh pr create`,
      absorb + force-push)
- [x] Docs build passed (`npm run build`, no broken links); committed as 530f4be
      on `docs/oss-multi-org-docs`; PR #4677. `docs/package-lock.json` churn from
      the build's npm install was discarded, not committed.

## Test phase (after review feedback)

Surveyed `api`, `sdks/python`, `services`, `web/tests` for impact; fixed and added:

- PR 3 (a83194e): `oss/tests/pytest/unit/auth/test_helper.py` patched the now-deleted
  `auth_helper.is_ee` (AttributeError); stubs removed, tests now cover the shared path.
- PR 2 (042bffd): new unit tests for `can_create_organization`; new OSS acceptance
  suite `accounts/test_organizations.py` (create/list/rename/transfer/delete via
  cls_account ApiKey); lifted the leftover `is_ee` gates on the simple
  membership-create endpoints (they wrap the already-ungated graph path).
- PR 4 (96c348b): `get_default_workspace_id` unit tests moved EE→OSS
  (`unit/services/test_db_manager.py`, plain role strings; patching db_manager_ee's
  engine no longer reaches the moved function); OSS admin org create/delete
  round-trip restored in `test_simple_entities.py` (was EE-only due to the
  singleton guard).
- PR 4 (b6d4a7d): web Playwright `global-setup.ts` unified — the OSS
  owner-signup + invite + re-login bootstrap is gone; both editions sign up a
  fresh user directly (faster, identical flows). `AGENTA_TEST_OSS_OWNER_EMAIL`
  kept as optional fixed-account login (used by railway CI secrets);
  `AGENTA_TEST_OSS_AUTH_USER` and `inviteOssUser` deleted.
- Verified: touched unit suites pass locally (14 + 1 tests); `sdks/python` and
  `services` test trees have no affected tests (only legacy uncollected suites
  reference old flows).

## Phase 2 — chain split, DB cleanup, OSS→EE switch (decided, not started)

Decisions settled during review:

- All database cleanup lands BEFORE the alignment/parking point, in the existing
  cleanup PR (#4676 `chore/drop-legacy-tables`). The EE chain must be born with
  zero pending repairs.
- After alignment, the legacy chains park forever (`alembic_version` frozen at
  the align revision, same revision id in both editions). Two new independent
  chains take over: the shared chain tracked in `alembic_version_oss` (scripts
  under `oss/`, runs in both editions) and the EE-only chain tracked in
  `alembic_version_ee` (scripts under `ee/`). Runner order: legacy (assert at
  align) → oss chain → ee chain.
- FK discipline rule, enforced from now on: foreign keys only to forever-stable
  targets (`organizations.id`, `secrets.id`, and other immutable PKs). Lower
  scopes (workspace/project/user dimensions) and lifecycle actor columns stay
  loose UUIDs so history survives deletions.
- Lifecycle standard, every table, no exceptions: `created_at`, `updated_at`,
  `deleted_at`, `created_by_id`, `updated_by_id`, `deleted_by_id` — and NONE of
  the `*_by_id` columns carry FKs. Note: this drops existing lifecycle FKs
  (organizations' created/updated/deleted_by_id FKs, api_keys.created_by_id FK)
  in both editions. The EE parity migration (#4671) was amended in place
  (339c787) so it no longer ADDS the api_keys FK it would then drop — nothing
  in the stack has shipped, so unshipped migrations get edited, not patched
  over.

Tasks in #4676 (existing cleanup PR):

- [x] Audit file `docs/designs/oss-ee-convergence/db-integrity-audit.md`: full
      FK + lifecycle inventory, per-table target state, drift list (model vs
      DB), by-design-loose list with rationale. Notable verdict flips from the
      deep pass: events lives in the TRACING database, so events.project_id and
      webhook_deliveries.event_id can never be FKs (cross-database); the
      lifecycle-FK drops also cover webhook_subscriptions.created_by_id.
- [x] Lifecycle standardization migrations (both editions) + model/DBE updates:
      add the six-column set everywhere it is missing (users, projects,
      workspaces, members, secrets, invitations, api_keys, subscriptions,
      meters); map the membership columns the DB already has (updated_by_id,
      organization_members timestamps); move secrets off LegacyLifecycleDBA;
      drop lifecycle FKs per the rule.
- [x] FK repairs (per the audit file): subscriptions.organization_id →
      organizations.id CASCADE (new); meters.organization_id retargeted
      subscriptions → organizations.id CASCADE;
      webhook_deliveries.project_id/subscription_id FKs (event_id stays loose,
      cross-DB); membership user-FK drift (DB gets ON DELETE CASCADE);
      project_invitations.user_id → SET NULL; secrets owning-scope FKs.

Follow-up stacked PR (on #4676) — alignment + split:

- [x] Align revisions, new chain roots, version tables, runner updates,
      design doc — PR [#4680](https://github.com/Agenta-AI/agenta/pull/4680)
      `feat/migration-chain-split`, stacked on #4676. Align id `a00000000000`;
      chains `core_oss` (alembic_version_oss) and `core_ee`
      (alembic_version_ee); new chain configs derive from `__file__` (no path
      env var).
- [x] Dummy proof migrations: `o00000000002` (oss chain) and `e00000000002`
      (ee chain), folded into #4680 per review (#4681/#4682 closed).
      Cleanup/test/dump-script work landed as b365720 on #4676 (lifecycle +
      FK migrations `4f5a6b7c8d9e`/`5a6b7c8d9e0f`/`a4b5c6d7e8f9`, model
      alignment, convention unit tests; dump script now prints all three
      version tables). NOT yet run anywhere — verification via schema dumps
      and replays is the next step, done manually.

Follow-up PR — OSS→EE switch:

- [x] Adoption migration in the ee chain
      ([#4683](https://github.com/Agenta-AI/agenta/pull/4683), revision
      `e00000000003`, stacked on #4682): create-if-missing EE-only enum +
      tables in canonical post-cleanup shapes; backfill subscriptions
      (configured free plan via get_free_plan(), anchor = adoption day) and
      the USERS gauge per org (USERS only, per review); no-op on EE-origin
      databases.
- [ ] `POSTGRES_DB_PREFIX` env var: explicit `POSTGRES_URI_*` wins, else prefix
      + existing user/password/port vars, else `agenta_{license}` (today's
      behavior). DB bootstrap helper reads the same resolution.
- [ ] Switch runbook (compose: same-project-name trick reusing the postgres
      volume; helm: `agenta.license=ee` + post-upgrade Job) in the self-host
      docs; floor rule documented (OSS must be at align or later).
- [ ] CI: three-flow replay (OSS scratch, EE scratch, OSS→switch) + schema dump
      diff as the hygiene-rule enforcement.

## Findings / decisions made during execution

- `but` CLI v0.19.13. `but pr new` fails (GitButler forge auth not configured,
  interactive-only); workflow is `but push <branch>` then `gh pr create --head
  <branch> --base <parent>`.
- PR titles follow AGENTS.md (`type(area): Title`); bodies follow the repo's
  write-pr-description skill (Context/Changes/Tests/What to QA, no em dashes).
- GitButler correctly refused to fold pr-plan.md edits into feature commits (the
  file's hunks are locked to the docs branch commit); it stays unassigned until
  amended onto `docs/oss-ee-convergence-design`.
- Pre-commit hooks run ruff format/check + prettier + turbo lint + gitleaks via
  `but commit`; a hook reformat aborts the commit — rerun `but commit` after.
- After committing file deletions, GitButler resurrected the deleted files as
  untracked on disk (commit itself was correct); plain `rm` cleared them.
- PR 1: membership table shapes taken from the live EE dump (incl. `updated_by_id`,
  user FKs without ON DELETE), not from the model classes. Both chains' projects
  backfills raise on unresolved NULL scopes instead of guessing.
- PR 2: org slugs stay NULL at creation in both editions (EE semantics); `oss-default`
  keeps no special meaning. OSS analytics `capture_oss_deployment_created` now fires
  only for the first org ever created.
- PR 2 scope notes: subscriptions passed to the OSS admin API are silently ignored
  (EE-additive); `UpdateOrganizationPayload` supports name/description only (slug
  updates remain EE).
- PR 4 scope notes: admin membership delete/swap endpoints stay EE-gated (not part
  of the singleton sweep); EE `get_organization_details` path untouched.
- PR 5: legacy `oss/tests/legacy/old_tests` import the deleted classes but are not
  collected (`pytest.ini` testpaths = oss/tests/pytest, ee/tests/pytest). web
  pnpm lint-fix not run (component verified with prettier + tsc scan instead).
- PR 5 follow-up (df6a36a, after a boot failure on a workspace build): alembic
  loads every version script at startup, and historical migrations still imported
  the deleted classes (`create_free_plans` → `AppDB`; evaluators/environments/
  applications_workflow/projects data migrations → the rest) — ImportError killed
  the migration runner. Fix: frozen final pre-drop shapes added to
  `deprecated_models.py` on a dedicated `DroppedBase` (separate base because
  extend_existing on DeprecatedBase would merge columns into the older partial
  shapes, e.g. select() would then reference columns that don't exist at that
  point in the chain); migrations repointed. The deleted `EvaluatorConfigDB`
  mapped `auto_evaluator_configs`, not `evaluators_configs` — verbatim copies,
  never substitute a lookalike deprecated class. All 175 version scripts in both
  chains verified to import. Second round (70650cd): the frozen classes' FK
  declarations need their target tables (projects/users/folders) registered as
  stubs in DroppedBase metadata — the ORM resolves FK targets at flush time, so
  the first insert through a frozen class (55bdd2e9a465 adds a testset) failed
  even though selects and the import sweep passed. Sharing the OSS frozen
  models from EE migrations is fine (mapped columns exist in both editions at
  the relevant chain points); EE can grow its own copies if shapes diverge.
- PR 1 follow-up (911d815, after the NULL-scope raise surfaced on a fresh OSS
  replay): the chain seeds a default project (911e6034d05e) before any org can
  exist (orgs are created by the app at signup, which never ran during a fresh
  replay), so the parity migrations' raise-instead-of-guess guard killed new
  deployments. Fix in both parity migrations: delete NULL-scope projects when
  the DB has zero users (the fresh-replay signature; seeds are recreated per
  org at signup) — deployments with users keep the loud failure. OSS org
  adoption made deterministic for 0/1/N orgs with NULL or set slugs: prefer
  slug 'oss-default' (NULLS LAST), fall back to oldest org. Verified via
  EE schema dump diffs (v0→v1→v2 came back clean and exact).
