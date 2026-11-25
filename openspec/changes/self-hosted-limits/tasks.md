# Tasks

Program tier. Milestones ship to the same release (v0.130.1). M1, M2 and M3 can start in parallel. M4 needs M2 for its end-to-end check. M5 runs last. The cloud repo work in M4 is its own PR in the private repo.

## Milestone plan

All PRs target v0.130.1. The spec PR is the base of the stack. M1 to M4 start together; M4's end-to-end check waits for M2 and M3. M5 starts when M1 to M3 are in review.

| Milestone | Tasks | Depends on | Parallel group | Clone | PR base | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Spec | this change | #8242 | none | worktree | `feat/self-hosted-free-key` | done |
| M1 Limits | 1.x | spec | A | `/data/mahmoud/agenta-limits-m1` | `feat/one-image-spec` | starting |
| M2 EE path everywhere | 2.x | spec | A | `/data/mahmoud/agenta-limits-m2` | `feat/one-image-spec` | starting |
| M3 One migration runner | 3.x | spec | A | `/data/mahmoud/agenta-limits-m3` | `feat/one-image-spec` | starting |
| M4 Images, hosting, builds | 4.x | spec; check needs M2 and M3 | A | `/data/mahmoud/agenta-limits-m4` | `feat/one-image-spec` | starting |
| M5 License text, docs, QA | 5.x | M1 to M4 | B | `/data/mahmoud/agenta-limits-m5` | `feat/one-image-spec` | waiting |

Shared files: M1 and M2 both touch `api/oss/src/services/commoners.py` (limit check, and the `env` import). Merge order: spec, M1, M2, M3, M4, M5; a later PR merges the base into its branch to resolve conflicts.

## M1. Limits in `ee/` (API and /m)

- [ ] 1.1 `api/ee/src/core/access/entitlements/types.py`: add `self_hosted_community: 1` to `PROJECT_LIMITS`, add `ORGANIZATION_LIMITS` (community 1, registered 1), `ProjectLimitReachedError` and `InstanceOrganizationLimitReachedError` (its own class).
- [ ] 1.2 `entitlements/service.py`: `check_project_limit` (replaces `project_limit_refusal`) and `check_instance_organization_limit`; add `db_manager.count_organizations()`.
- [ ] 1.3 `create_project`: call `check_project_limit`; answer HTTP 403 `{"code": "project_limit_reached", "message", "limit"}`.
- [ ] 1.4 `create_organization_for_user` and its router: raise and answer HTTP 403 `{"code": "instance_organization_limit_reached", "message", "limit"}`.
- [ ] 1.5 `oss.src.services.commoners.create_accounts`: call `check_instance_organization_limit()` before `create_organization_for_signup`, catch the error, log and skip.
- [ ] 1.6 `/m`: `DrawerProjectSwitcher.tsx` and `OrganizationsTab.tsx` read `detail.code`; "Open License settings" for the instance admin, "Ask your instance admin." for others; zero-organization screen text in `ContextResolver.tsx`.
- [ ] 1.7 English strings: project limit "This organization has reached its limit of {{limit}} project(s)."; free key note "A free key gives more projects."; organization limit "This instance allows {{limit}} organization(s). Ask for an invitation to an existing organization, or add a paid license key."; non-admin ending "Ask your instance admin."; zero organizations "You are not in an organization yet. Ask an organization admin to invite you." Translate into the 6 other locales with the `.meta` files.
- [ ] 1.8 Unit tests for every scenario in `specs/self-hosted-limits/spec.md` that needs no browser; `/m` unit tests for the code-to-text mapping and the admin branch.
- [ ] 1.9 Find API and SDK tests that create a second project or organization through the public routes, and move them to the platform admin routes.

## M2. The EE path on every install (API, SDK, web)

- [ ] 2.1 `api/oss/src/utils/env.py` and `common.py`: `is_ee()` true when the `ee` package imports, with docstrings that say so; `AGENTA_LICENSE` is read only as the database prefix fallback (default `oss`). Move every other reader of `env.agenta.license` and `_LICENSE` (lock key, alembic ini paths for core and tracing) off it. Env examples for new installs set `POSTGRES_DB_PREFIX`.
- [ ] 2.2 Throttling: outside `is_cloud()`, no fallback to the free cloud plan's throttles.
- [x] 2.3 SDK vault: no change. Provider keys from the environment keep today's rule, decided 2026-11-25 (on unless `AGENTA_LICENSE=ee`; `AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED` overrides it).
- [ ] 2.4 Server analytics: replace the sign-up property `is_ee` with `is_cloud`. Do not add an install event: the install event is `instance_installed` from #8237, which replaces `oss_deployment_created`; M2 keeps main's `oss_deployment_created` code so the merge takes #8237's version.
- [ ] 2.5 Default plan for new subscriptions outside cloud: `self_hosted_community`.
- [ ] 2.6 `web/entrypoint.sh`: drop the edition condition from the cloud key check that sets `AGENTA_BILLING_ENABLED`; `@agenta/shared` adds `isCloud()` that reads that same value. `isBillingEnabled()` calls `isCloud()`. The entrypoint drops the edition condition from the Turnstile gate too. In `web/mobile` and `web/packages`, every `isEE()` branch takes the EE side, except the cloud branches (analytics `OSS_CONFIG` renamed `SELF_HOSTED_CONFIG`, `DrillInBridgeProvider.tsx`, `providerKey.ts`), which use `isCloud()`. Remove the `isEE()` branch in `LicenseTab.tsx`.
- [ ] 2.7 `run-tests.py` (api, sdks/python, services): stop selecting tests by `AGENTA_LICENSE`; the EE path is the only path.

## M3. One migration runner

- [ ] 3.1 The `ee` runner owns the sequence (legacy chain, `core_oss`, adoption step, `core_ee`, tracing chains); the `oss` runner module only calls it, with a docstring that records why. The runner ignores `ALEMBIC_CFG_PATH_CORE` and `ALEMBIC_CFG_PATH_TRACING` for the legacy core and tracing chains, and runs the revision check before the database split step.
- [ ] 3.2 Pick the legacy core chain from the core database's `alembic_version` (on an empty database run the EE legacy chain, which creates the initial schema; skip it at `park00000000`; on any older or unknown revision, stop before any change with a message that asks for an upgrade to v0.129.x first, or, for a new install whose first start was interrupted, to delete its databases and start again).
- [ ] 3.3 Detect adoption (no `alembic_version_ee`, no `subscriptions`); run the membership materialize step after `core_oss` and before `core_ee`.
- [ ] 3.4 CI replay: fresh, OSS v0.104.0, OSS v0.129.x, EE v0.129.x, and an OSS start interrupted during the materialize step; check schema heads and member project access before and after.

## M4. Images, hosting and builds

- [ ] 4.1 One API Dockerfile (dev and gh) with `ee/` and the crons; one services Dockerfile. Remove the duplicates.
- [ ] 4.2 Compose: the OSS files keep working unchanged (check with pull and restart on a real v0.129 OSS stack); the EE files pull the public names. `run.sh --oss/--ee` keeps choosing the env file and database prefix.
- [ ] 4.3 Helm: one repository per component for API, services and runner; `agenta.license` sets only the database prefix and, for `/w`, the web build. Update the Helm tests that check `internal-ee` names.
- [ ] 4.4 Railway: check the wrappers start on the new images; no template change needed if 4.2 holds.
- [ ] 4.5 Public workflows 17 and 42 build from the combined Dockerfiles; 12 and 44 run the EE path.
- [ ] 4.6 Cloud repo PR: workflows 19 and 63 drop the edition loop for API, services and runner and push one digest under both the public mirror source and `internal-ee-*`; workflow 43 mirrors it to the public names.
- [x] 4.7 Removed: cloud sets no provider keys flag. Provider keys from the environment keep today's rule, decided 2026-11-25.

## M5. License text, docs and QA

- [ ] 5.1 Enterprise License text in `ee/LICENSE`, `api/ee/LICENSE`, `web/ee/LICENSE`, `services/ee/LICENSE` and `hosting/docker-compose/ee/LICENSE`: replace the first paragraph with the wording in design Decision 8 (approved by Mahmoud 2026-11-21); flag a lawyer review in the PR.
- [ ] 5.2 Docs: editions page `docs/docs/misc/01-opensource.mdx` (one image, plans, limits), license keys page `docs/docs/self-host/reference/04-license-keys.mdx` (every image reads keys), the OSS to EE switch page (replace with "add a key"), `docs/docs/self-host/upgrade-and-migrate/01-upgrading.mdx` (backup, first-start migration), the configuration reference (`AGENTA_LICENSE` is the database prefix choice; it also keeps its job for provider keys from the environment), `02-restrict-organization-creation.mdx` (one organization without a paid key), Helm and compose guides.
- [ ] 5.3 QA in `/m` from fresh accounts: upgrade a real v0.129 OSS compose stack by pull and restart; data and member access intact; second project refused; free key added; second project created; second organization refused; second person signs up with and without an invitation; playground uses the env provider key. Record the headline journey.
