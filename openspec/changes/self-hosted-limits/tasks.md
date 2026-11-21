# Tasks

Program tier. Milestones ship to the same release (v0.130.1). M1, M2 and M3 can start in parallel. M4 needs M2 for its end-to-end check. M5 runs last. The cloud repo work in M4 is its own PR in the private repo.

## M1. Limits in `ee/` (API and /m)

- [ ] 1.1 Add `api/ee/src/core/licenses/limits.py`: `SELF_HOSTED_LIMITS` (plan to `Limits(max_projects, max_organizations)`), `check_project_limit`, `check_instance_organization_limit`. Reuse `FREE_SELF_HOSTED_PLANS` from `controls.py`. Replace `project_limit_refusal` (cloud half moves into `check_project_limit`).
- [ ] 1.2 Add `ProjectLimitReachedError` to `api/ee/src/core/licenses/types.py` and `InstanceOrganizationLimitReachedError` to `api/oss/src/core/organizations/exceptions.py`; add `db_manager.count_organizations()`.
- [ ] 1.3 `create_project`: call `check_project_limit`; answer HTTP 403 `{"code": "project_limit_reached", "message", "limit"}`.
- [ ] 1.4 `create_organization_for_user` and its router: raise and answer HTTP 403 `{"code": "instance_organization_limit_reached", "message", "limit"}`; catch it before `OrganizationCreationNotAllowedError`.
- [ ] 1.5 `oss.src.services.commoners.create_accounts`: call `check_instance_organization_limit()` before `create_organization_for_signup`, catch the error, log and skip.
- [ ] 1.6 `/m`: `DrawerProjectSwitcher.tsx` and `OrganizationsTab.tsx` read `detail.code`; "Open License settings" for the instance admin, "Ask your instance admin." for others; zero-organization screen text in `ContextResolver.tsx`.
- [ ] 1.7 English strings: project limit "This organization has reached its limit of {{limit}} project(s)."; free key note "A free key gives more projects."; organization limit "This instance allows {{limit}} organization(s). Ask for an invitation to an existing organization, or add a paid license key."; non-admin ending "Ask your instance admin."; zero organizations "You are not in an organization yet. Ask an admin to invite you." Translate into the 6 other locales with the `.meta` files.
- [ ] 1.8 Unit tests for every scenario in `specs/self-hosted-limits/spec.md` that needs no browser; `/m` unit tests for the code-to-text mapping and the admin branch.
- [ ] 1.9 Find API and SDK tests that create a second project or organization through the public routes, and move them to the platform admin routes.

## M2. The EE path on every install (API, SDK, web)

- [ ] 2.1 `api/oss/src/utils/env.py` and `common.py`: `is_ee()` true when the `ee` package imports; `AGENTA_LICENSE` only sets the default database prefix (default `oss`). Check every reader of `env.agenta.license` and `_LICENSE` (database names, lock key, alembic ini path).
- [ ] 2.2 Throttling: outside `is_cloud()`, no fallback to the free cloud plan's throttles.
- [ ] 2.3 SDK vault: read provider keys from the environment unless `AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED=false`. Note in the PR that cloud must set it before the new services image deploys.
- [ ] 2.4 Server analytics: deployment event on `not is_cloud()`, sign-up event field from `is_cloud()`.
- [ ] 2.5 Default plan for new subscriptions outside cloud: `self_hosted_community`.
- [ ] 2.6 `web/entrypoint.sh`: write a cloud flag into `__env.js` from the existing cloud key check; `@agenta/shared` exposes `isCloud()`. Replace `isEE()` in `/m` analytics, `DrillInBridgeProvider.tsx`, `providerKey.ts`, and remove the `isEE()` branch in `LicenseTab.tsx`. List every other `isEE()` in `web/mobile` and `web/packages` and decide each.
- [ ] 2.7 `run-tests.py` (api, sdks/python, services): stop selecting tests by `AGENTA_LICENSE`; the EE path is the only path.

## M3. One migration runner

- [ ] 3.1 One runner sequence behind both module names: legacy chain, `core_oss`, `core_ee`, tracing chains.
- [ ] 3.2 Pick the legacy chain from the database state (skip it at `park00000000` or on an empty database; on any older or unknown revision, stop before any change with a message that asks for an upgrade to v0.129.x first).
- [ ] 3.3 Detect adoption before `core_ee` (no `alembic_version_ee`, no `subscriptions`); after `core_ee`, run the membership materialize step.
- [ ] 3.4 CI replay: fresh, OSS v0.104.0, OSS v0.129.x, EE v0.129.x; check schema heads and member project access before and after.

## M4. Images, hosting and builds

- [ ] 4.1 One API Dockerfile (dev and gh) with `ee/` and the crons; one services Dockerfile. Remove the duplicates.
- [ ] 4.2 Compose: the OSS files keep working unchanged (check with pull and restart on a real v0.129 OSS stack); the EE files pull the public names. `run.sh --oss/--ee` keeps choosing the env file and database prefix.
- [ ] 4.3 Helm: one repository per component for API, services and runner; `agenta.license` sets only the database prefix and, for `/w`, the web build. Update the Helm tests that check `internal-ee` names.
- [ ] 4.4 Railway: check the wrappers start on the new images; no template change needed if 4.2 holds.
- [ ] 4.5 Public workflows 17 and 42 build from the combined Dockerfiles; 12 and 44 run the EE path.
- [ ] 4.6 Cloud repo PR: workflows 19 and 63 drop the edition loop for API, services and runner and push one digest under both the public mirror source and `internal-ee-*`; workflow 43 mirrors it to the public names.

## M5. License text, docs and QA

- [ ] 5.1 Enterprise License text in `ee/LICENSE`, `api/ee/LICENSE`, `web/ee/LICENSE`, `services/ee/LICENSE`, and the root `LICENSE` note, after Mahmoud and a lawyer approve the wording (decision Question 8).
- [ ] 5.2 Docs: editions page `docs/docs/misc/01-opensource.mdx` (one image, plans, limits), license keys page `docs/docs/self-host/reference/04-license-keys.mdx` (every image reads keys), the OSS to EE switch page (replace with "add a key"), `docs/docs/self-host/upgrade-and-migrate/01-upgrading.mdx` (backup, first-start migration), the configuration reference (`AGENTA_LICENSE` is the database prefix choice, `AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED`), `02-restrict-organization-creation.mdx` (one organization without a paid key), Helm and compose guides.
- [ ] 5.3 QA in `/m` from fresh accounts: upgrade a real v0.129 OSS compose stack by pull and restart; data and member access intact; second project refused; free key added; second project created; second organization refused; second person signs up with and without an invitation; playground uses the env provider key. Record the headline journey.
