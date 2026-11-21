# Tasks

Order: section 1 first. Sections 2 and 3 can run in parallel after it. Section 4 can start in parallel with section 2 once the error codes are fixed. Section 5 runs last.

## 1. Preconditions

- [x] 1.1 The public keys (a468f37ff6) and the editions page (1ca32d4604) landed on `feat/self-hosted-free-key`. Rebase this branch on it before work starts.

## 2. Move the key check to OSS (API)

- [ ] 2.1 Move `keys.py`, `types.py`, `interfaces.py` and `service.py` from `api/ee/src/core/licenses/` to `api/oss/src/core/licenses/`, and the DAO and DBE from `api/ee/src/dbs/postgres/licenses/` to `api/oss/src/dbs/postgres/licenses/`. Move `is_cloud()` to `api/oss/src/core/licenses/cloud.py` (false on the OSS image); keep `validate_cloud_license` in EE. Merge the moved `types.py` with the OSS `types.py` that holds `RegistrationFailed`.
- [ ] 2.2 Put the self-hosted plan slugs, `SELF_HOSTED_PLANS` and `FREE_SELF_HOSTED_PLANS` in `api/oss/src/core/licenses/types.py`; make EE `DefaultPlan` take its self-hosted values from them, and make EE `controls.py` import `FREE_SELF_HOSTED_PLANS` instead of defining it.
- [ ] 2.3 In `parse_license_key`, check the plan against `get_plans()` on EE and against the OSS self-hosted plan set on OSS.
- [ ] 2.4 Add `oss000000064_add_licenses` to `core_oss` and delete `ee0000000010_add_licenses.py`. Write the one-time dev stack repair (downgrade `core_ee` to `ee0000000009` with the old checkout, then upgrade) in the PR body.
- [ ] 2.5 Register `PUT /instance/license` on both images; `GET` reads the license on both. Remove the `is_ee()` branches, `_is_cloud()` and `COMMUNITY_PLAN` in `api/oss/src/apis/fastapi/licenses/router.py`.
- [ ] 2.6 Update every import of `ee.src.core.licenses.{keys,types,service}` (EE subscriptions, entitlements, cloud, throttling, entrypoints, tests). Move the license unit tests to `api/oss/tests/pytest/unit/licenses/`.

## 3. Limits (API)

- [ ] 3.1 Add `api/oss/src/core/licenses/limits.py` with `SELF_HOSTED_LIMITS`, `check_project_limit` and `check_instance_organization_limit`. `SELF_HOSTED_LIMITS` maps plan to `Limits(max_projects, max_organizations)`. Add `ProjectLimitReachedError` to `api/oss/src/core/licenses/types.py` and `InstanceOrganizationLimitReachedError` to `api/oss/src/core/organizations/exceptions.py`, and `db_manager.count_organizations()`. Replace EE `project_limit_refusal` with `cloud_project_limit`.
- [ ] 3.2 `create_project`: call the check on both images; on cloud keep EE `PROJECT_LIMITS`. Raise `ProjectLimitReachedError`; answer HTTP 403 `{"code": "project_limit_reached", "message", "limit"}`.
- [ ] 3.3 `create_organization_for_user`: raise `InstanceOrganizationLimitReachedError`; the router answers HTTP 403 `{"code": "instance_organization_limit_reached", "message", "limit"}`.
- [ ] 3.4 `oss.src.services.commoners.create_accounts`: call `check_instance_organization_limit()` before `create_organization_for_signup`, catch `InstanceOrganizationLimitReachedError` and skip the personal organization at the limit, log, do not raise.
- [ ] 3.5 Find API and SDK tests that create a second project or organization through the public routes, and move them to the platform admin routes or give their stack a test key.
- [ ] 3.6 Unit tests: every scenario in `specs/self-hosted-limits/spec.md` and `specs/instance-license/spec.md` that does not need a browser. Acceptance tests on the local OSS and EE stacks for `POST /projects/` and `POST /organizations/`.

## 4. /m (frontend), parallel with section 3

- [ ] 4.1 `DrawerProjectSwitcher.tsx` and `OrganizationsTab.tsx`: read `detail.code`; map the two codes to translated text; keep the string fallback for other errors.
- [ ] 4.2 Show "Open License settings" to the instance admin; show the "ask your instance admin" text to others.
- [ ] 4.3 `LicenseTab.tsx`: show the add-a-key form and the activation link flow on OSS; remove the `isEE()` branch and the "needs the Enterprise image" text.
- [ ] 4.4 Zero-organization screen: new text instead of "No projects found." in `ContextResolver.tsx`.
- [ ] 4.5 English strings (to confirm on the decision page): project limit "This organization has reached its limit of {{limit}} project(s)."; with a free key note "A free key gives more projects."; organization limit "This instance allows {{limit}} organization(s). Ask for an invitation to an existing organization, or add a paid license key."; non-admin ending "Ask your instance admin."; zero organizations "You are not in an organization yet. Ask an admin to invite you." Translate into de-DE, es-ES, fr-FR, ja-JP, pt-BR, zh-CN with the `.meta` files.
- [ ] 4.6 Unit tests for the code-to-text mapping and the admin and non-admin branches.

## 5. Docs and QA

- [ ] 5.1 Editions page `docs/docs/misc/01-opensource.mdx`: add projects and organizations rows per edition and key. License keys page `docs/docs/self-host/reference/04-license-keys.mdx`: the OSS image now reads keys (today line 9 says it does not).
- [ ] 5.2 `docs/docs/self-host/access-control/02-restrict-organization-creation.mdx`: the default is now one organization per instance without a paid key; sign-up without an invitation gives no organization.
- [ ] 5.3 `docs/docs/self-host/reference/01-configuration.mdx`: `AGENTA_LICENSE_KEY` works on OSS too.
- [ ] 5.4 QA in `/m` on OSS and EE from fresh accounts: second project refused, free key added, second project created; second organization refused; second person signs up with and without an invitation. Record the headline journey.
