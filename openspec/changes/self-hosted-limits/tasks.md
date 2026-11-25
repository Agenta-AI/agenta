# Tasks

Program tier. Target release: v0.131.1 (`release/v0.131.1`, release PR #8583). Every PR is open and built; none is merged. Each merge needs Mahmoud's OK, a delta review of commits made since the last review record, and a CI check. The cloud repo work in M4 is its own PR in the private repo (agenta_cloud#1796).

## Milestone plan

The spec PR is the base of the stack and sits on #8242. M1 to M4 started together; M4's end-to-end check needs M2 and M3. M5 started when M1 to M3 were in review. A child PR merges its base into its branch to resolve conflicts; no rebase.

| Milestone | Tasks | Depends on | PR | PR base | Status |
| --- | --- | --- | --- | --- | --- |
| Registration and free key | R.x | #8238 | #8242 | `feat/self-hosted-license-keys` | built, in review |
| Spec | this change | #8242 | #8544 | `feat/self-hosted-free-key` | updated 2026-11-25 |
| M1 Limits | 1.x | spec | #8548 | `feat/one-image-spec` | built, in review |
| M2 EE path everywhere | 2.x | spec | #8549 | `feat/one-image-spec` | built, in review |
| M3 One migration runner | 3.x | spec | #8547 | `feat/one-image-spec` | built, in review |
| M4 Images, hosting, builds | 4.x | spec; check needs M2 and M3 | #8545, agenta_cloud#1796 | `feat/one-image-spec` | built, in review |
| M5 License text, docs, QA | 5.x | M1 to M4 | #8551 | `feat/one-image-spec` | docs built; QA open |

Shared files: M1 and M2 both touch `api/oss/src/services/commoners.py` (limit check, and the `env` import). Merge order: #8242, spec, M1, M2, M3, M4, M5.

## R. Registration and the free key (#8242, website worker)

- [x] R.1 Registration as a full onboarding step after the survey, with "Send me a free key" and "Skip".
- [x] R.2 One-time prompt for the instance admin of an upgraded install; `POST /instance/license/registration-prompt/dismiss` stores the skip, and `GET /instance/license` reports it.
- [x] R.3 The updates box starts ticked and is optional in the UI, the API and the worker; security notices go to every registrant.
- [x] R.4 The setup answers (option labels only) go with every registration, with the notice line under the button.
- [x] R.5 The API forwards the updates choice, the setup answers and the signed-in user id.
- [x] R.6 Worker: Loops contact with `source`, `userGroup` and the `agenta*` fields, `agentaProductUpdates` instead of a list, key email `LOOPS_TRANSACTIONAL_ID`.
- [x] R.7 Worker: PostHog `instance_registered`, `$groupidentify` with `registered_email`, and `$set: {email}` on the registering admin's person.
- [x] R.8 The self-hosted survey event carries no email, with a unit test.
- [x] R.9 Free key tied to the instance: the worker writes the instance id; the API accepts a free key only on that instance; the License tab says when a key belongs to another instance.
- [x] R.10 License tab redesign (before a key, after a free key, after a paid key), the "Add a license key" dialog, and one "Available on the Enterprise plan" box per locked page.
- [x] R.11 Free key docs: the new flow, the promise "You keep what your key unlocks.", and the analytics sentence.
- [x] R.12 The same analytics sentence on the telemetry page in #8237.

## M1. Limits in `ee/` (API and /m)

- [x] 1.1 `api/ee/src/core/access/entitlements/types.py`: add `self_hosted_community: 1` to `PROJECT_LIMITS`, add `ORGANIZATION_LIMITS` (community 1, registered 1), `ProjectLimitReachedError` and `InstanceOrganizationLimitReachedError` (its own class).
- [x] 1.2 `entitlements/service.py`: `check_project_limit` (replaces `project_limit_refusal`) and `check_instance_organization_limit`; add `db_manager.count_organizations()`.
- [x] 1.3 `create_project`: call `check_project_limit`; answer HTTP 403 `{"code": "project_limit_reached", "message", "limit"}`.
- [x] 1.4 `create_organization_for_user` and its router: raise and answer HTTP 403 `{"code": "instance_organization_limit_reached", "message", "limit"}`.
- [x] 1.5 `oss.src.services.commoners.create_accounts`: call `check_instance_organization_limit()` before `create_organization_for_signup`, catch the error, log and skip.
- [x] 1.6 `/m`: `DrawerProjectSwitcher.tsx` and `OrganizationsTab.tsx` read `detail.code`; the dialogs read the usage on open and keep Create off at the limit; the instance admin registers in place; the organization limit names a paid key or an invitation; Settings > Projects shows "This organization uses 1 of 1 projects" with Register; the no-organization card with "Check again" and "Sign out".
- [x] 1.7 English strings with plural forms: project limit for the admin "Register this instance for free to create more projects.", for a member "Ask your instance admin to register this instance for more projects."; organization limit "This instance allows {{limit}} organization(s). Ask for an invitation to an existing organization, or add a paid license key."; non-admin ending "Ask your instance admin."; zero organizations "You are not in an organization yet. Ask an organization admin to invite you." Translate into the 6 other locales with the `.meta` files.
- [x] 1.8 Unit tests for every scenario in `specs/self-hosted-limits/spec.md` that needs no browser; `/m` unit tests for the code-to-text mapping and the admin branch.
- [x] 1.9 Find API and SDK tests that create a second project or organization through the public routes, and move them to the platform admin routes.

- [x] 1.10 Usage in the license API: `usage` on `GET /instance/license`, and `GET /instance/license/usage` for any signed-in person.

## M2. The EE path on every install (API, SDK, web)

- [x] 2.1 `api/oss/src/utils/env.py` and `common.py`: `is_ee()` true when the `ee` package imports, with docstrings that say so; `AGENTA_LICENSE` is read only as the database prefix fallback (default `oss`). Move every other reader of `env.agenta.license` and `_LICENSE` (lock key, alembic ini paths for core and tracing) off it. Env examples for new installs set `POSTGRES_DB_PREFIX`.
- [x] 2.2 Throttling: outside `is_cloud()`, no fallback to the free cloud plan's throttles.
- [x] 2.3 SDK vault: no change. Provider keys from the environment keep today's rule, decided 2026-11-25 (on unless `AGENTA_LICENSE=ee`; `AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED` overrides it).
- [x] 2.4 Server analytics: replace the sign-up property `is_ee` with `is_cloud`. Do not add an install event: the install event is `instance_installed` from #8237, which replaces `oss_deployment_created`; M2 keeps main's `oss_deployment_created` code so the merge takes #8237's version.
- [x] 2.5 Default plan for new subscriptions outside cloud: `self_hosted_community`.
- [x] 2.6 `web/entrypoint.sh`: drop the edition condition from the cloud key check that sets `AGENTA_BILLING_ENABLED`; `@agenta/shared` adds `isCloud()` that reads that same value. `isBillingEnabled()` calls `isCloud()`. The entrypoint drops the edition condition from the Turnstile gate too. In `web/mobile` and `web/packages`, every `isEE()` branch takes the EE side, except the cloud branches (analytics `OSS_CONFIG` renamed `SELF_HOSTED_CONFIG`, `DrillInBridgeProvider.tsx`, `providerKey.ts`), which use `isCloud()`. Remove the `isEE()` branch in `LicenseTab.tsx`.
- [x] 2.7 `run-tests.py` (api, sdks/python, services): stop selecting tests by `AGENTA_LICENSE`; the EE path is the only path.

- [x] 2.8 Sign-in rule, option 1, for every plan: without the access entitlement the email and social flags follow the deployment; the stored SSO and root flags stay.
- [x] 2.9 No `self_hosted_deployment_created` event; keep main's `oss_deployment_created` code so the merge with #8237 takes `instance_installed`.

## M3. One migration runner

- [x] 3.1 The `ee` runner owns the sequence (legacy chain, `core_oss`, adoption step, `core_ee`, tracing chains); the `oss` runner module only calls it, with a docstring that records why. The runner ignores `ALEMBIC_CFG_PATH_CORE` and `ALEMBIC_CFG_PATH_TRACING` for the legacy core and tracing chains, and runs the revision check before the database split step.
- [x] 3.2 Pick the legacy core chain from the core database's `alembic_version` (on an empty database run the EE legacy chain, which creates the initial schema; skip it at `park00000000`; on any older or unknown revision, stop before any change with a message that asks for an upgrade to v0.129.x first, or, for a new install whose first start was interrupted, to delete its databases and start again).
- [x] 3.3 Detect adoption (no `alembic_version_ee`, no `subscriptions`); run the membership materialize step after `core_oss` and before `core_ee`.
- [x] 3.4 CI replay: fresh, OSS v0.104.0, OSS v0.129.x, EE v0.129.x, and an OSS start interrupted during the materialize step; check schema heads and member project access before and after.

- [x] 3.5 Installs older than v0.104.0: a static review of the revision check and its refusal, instead of a live test (decided 2026-11-25).

## M4. Images, hosting and builds

- [x] 4.1 One API Dockerfile (dev and gh) with `ee/` and the crons; one services Dockerfile. Remove the duplicates.
- [x] 4.2 Compose: the OSS files keep working unchanged (check with pull and restart on a real v0.129 OSS stack); the EE files pull the public names. `run.sh --oss/--ee` keeps choosing the env file and database prefix.
- [x] 4.3 Helm: one repository per component for API, services and runner; `agenta.license` sets only the database prefix and, for `/w`, the web build. Update the Helm tests that check `internal-ee` names.
- [x] 4.4 Railway: check the wrappers start on the new images; no template change needed if 4.2 holds.
- [x] 4.5 Public workflows 17 and 42 build from the combined Dockerfiles; 12 and 44 run the EE path.
- [x] 4.6 Cloud repo PR (agenta_cloud#1796, open): workflows 19 and 63 drop the edition loop for API, services and runner and push one digest under both the public mirror source and `internal-ee-*`; workflow 43 mirrors it to the public names.
- [x] 4.7 Removed: cloud sets no provider keys flag. Provider keys from the environment keep today's rule, decided 2026-11-25.

- [ ] 4.8 Helm test on a k3s cluster on the Hetzner dev box (Must, D32).

## M5. License text, docs and QA

- [x] 5.1 Enterprise License text in `ee/LICENSE`, `api/ee/LICENSE`, `web/ee/LICENSE`, `services/ee/LICENSE` and `hosting/docker-compose/ee/LICENSE`: replace the first paragraph with the wording in design Decision 8 (approved by Mahmoud 2026-11-21); flag a lawyer review in the PR.
- [x] 5.2 Docs (the free key is tied to the instance, the registration step, the optional updates box, the editions table): editions page `docs/docs/misc/01-opensource.mdx` (one image, plans, limits), license keys page `docs/docs/self-host/reference/04-license-keys.mdx` (every image reads keys), the OSS to EE switch page (replace with "add a key"), `docs/docs/self-host/upgrade-and-migrate/01-upgrading.mdx` (backup, first-start migration), the configuration reference (`AGENTA_LICENSE` is the database prefix choice; it also keeps its job for provider keys from the environment), `02-restrict-organization-creation.mdx` (one organization without a paid key), Helm and compose guides.
- [ ] 5.3 QA in `/m` from fresh accounts: upgrade a real v0.129 OSS compose stack by pull and restart; data and member access intact; second project refused; free key added; second project created; second organization refused; second person signs up with and without an invitation; playground uses the env provider key. Record the headline journey.
- [ ] 5.4 oss-team upgrades with the free key like a normal user, after a rehearsal on the dev copy; this is also the free key end-to-end test (D31).
- [ ] 5.5 Real telemetry from an upgraded dev stack, read back from PostHog (Must, D33).

## After the release (scheduled on the dev box)

- [ ] F.1 Remove `AGENTA_LICENSE` where it has no job left; keep the vault and `/w` uses (D34).
- [ ] F.2 Remove the open source only code paths that stopped running (D35).
- [ ] F.3 Fold the migration chains into one chain, 7 days after the release, with a replay test; never merged without Mahmoud's OK (D36).
- [ ] F.4 Per-project access screen on the enterprise edition, issue #8588 (D37).
