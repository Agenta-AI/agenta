# Design: self-hosted project and organization limits

## Context

### Plans and where they come from today

- On self-hosted EE, every organization has the instance plan. `SubscriptionsService.read` replaces the stored plan with `instance_plan()` when the install is not cloud (`api/ee/src/core/subscriptions/service.py:175-177`).
- `instance_plan()` (`api/ee/src/core/licenses/service.py:127`) is the plan of the active license key, else `self_hosted_community` (`LicenseState.plan`, `api/ee/src/core/licenses/types.py:61-63`). The free registration key carries `self_hosted_registered` and only the `registration-1` signing key may sign it (`api/ee/src/core/licenses/keys.py`, `SIGNING_KEYS`).
- On cloud, the plan comes from Stripe. `is_cloud()` is true only for a valid cloud key in `AGENTA_LICENSE_KEY` (`api/ee/src/core/licenses/cloud.py`).
- The OSS image has no key check. `GET /instance/license` answers `self_hosted_community` on OSS, and `PUT /instance/license` is registered only when `is_ee()` (`api/oss/src/apis/fastapi/licenses/router.py:90`, `:106`). The OSS image can already ask Agenta for a free key (`POST /instance/license/registrations`, `api/oss/src/core/licenses/registrations.py`), but it cannot use the key it gets.

### Projects today

- `create_project` checks a limit only on EE (`api/oss/src/routers/projects_router.py:243-246`). It calls `project_limit_refusal`, which reads the organization's plan, looks it up in `PROJECT_LIMITS`, and compares with `count_organization_projects` (`api/ee/src/core/access/entitlements/service.py:317-331`). It fails open when the plan read fails.
- `PROJECT_LIMITS` has one entry, `cloud_v0_hobby: 1`. The refusal is the fixed English string `PROJECT_LIMIT_MESSAGE` about the Hobby plan (`api/ee/src/core/access/entitlements/types.py:811-816`).
- `/m` shows `detail` as is when it is a string (`web/mobile/src/features/nav/DrawerProjectSwitcher.tsx:110-114`). The text is not translated.
- Result: OSS has unlimited projects. Self-hosted EE has unlimited projects on every plan.

### Organizations today

- `create_organization_for_user` (`POST /organizations/`) checks the owner allowlist, blocked domains, and the per-user cap `AGENTA_ACCESS_MAX_OWNED_ORGANIZATIONS` (`api/oss/src/services/commoners.py:208-221`). The router turns `OrganizationCreationNotAllowedError` into HTTP 403 with `detail` as a string (`api/oss/src/routers/organization_router.py:396-400`).
- `create_accounts` gives every new user a personal organization when the allowlist allows it (`api/oss/src/services/commoners.py:282-298`). If that setup raises, it deletes the new user and the sign-up fails (`:299-312`).
- A signed-in user with no organization sees "No projects found." on `/m` (`web/mobile/src/features/context/ContextResolver.tsx:123`). This already happens today for users outside the allowlist.
- Result: every instance has unlimited organizations.

### Error shape convention

Newer routes answer typed errors as `detail = {"code": ..., "message": ...}` (for example `api/oss/src/apis/fastapi/vault/router.py:136`, `api/oss/src/apis/fastapi/shared/personal.py:58`). `/m` can switch on `code` and translate.

## Goals / Non-Goals

Goals:

- Without a key, an organization has 1 project, on OSS and on EE.
- The free key and a paid key give more projects.
- Without a paid key, an instance has 1 organization. A paid key and cloud have no organization limit.
- The OSS image accepts, checks and stores a key, through the same route and the same License tab as EE.
- Existing projects and organizations stay. Only new ones are refused.
- `/m` shows a translated refusal with a next step.

Non-goals:

- Limits on users or seats. Seats stay counted and never block.
- Enterprise features on the OSS image. A paid key on OSS lifts the limits. The full role catalog (`Flag.RBAC`), the audit log and the other flags still need the EE image. Role checks themselves run on both images, as today.
- Limit numbers inside the key payload (see Decision 2).
- Changes to cloud plans or to `cloud_v0_hobby`.
- A redesign of roles.

## Decisions

### Decision 1: Where the key check lives

The OSS image must check a key to lift its limits. The OSS image does not ship `api/ee/`.

| Option | What it means | Trade-off |
| --- | --- | --- |
| **A. Move the key check, its storage and `PUT /instance/license` to OSS code** | `keys.py`, the key types, `LicensesService`, the DAO and the `licenses` table move under `api/oss/`. `is_cloud()` moves to OSS `core/licenses/cloud.py`. EE keeps `validate_cloud_license`, the plan table and the flags. | One code path for both images. The check becomes MIT code, so anyone can patch it out. That is true of the EE code today too (it is in the public repo), so nothing is lost. |
| B. Copy the check into OSS, keep EE's | Two copies of the signature check and the signing keys. | Two places to rotate keys. Drift risk. |
| C. OSS reads only `AGENTA_LICENSE_KEY`, no in-app entry | No table on OSS. | The activation link in the free key email opens the License tab and cannot work on OSS. Breaks the #8242 flow. |

The license split stays correct with A: the key format and check are a lock, not an enterprise feature. The enterprise features they unlock (the flags in `DEFAULT_ENTITLEMENTS`) stay in `api/ee/`.

Details of A:

- `api/oss/src/core/licenses/`: `keys.py`, `types.py` (`LicenseKey`, `LicenseState`, `InvalidLicenseKey`, `LicenseKeyInEnvironment`, `CLOUD_PLAN`, the self-hosted plan slugs), `interfaces.py`, `service.py` (`instance_plan`, `activate`).
- `api/oss/src/dbs/postgres/licenses/`: `dao.py`, `dbes.py`.
- The plan check in `parse_license_key` today accepts `cloud` or a plan in `get_plans()` (EE). On OSS it accepts `cloud` or a plan in the OSS self-hosted plan set (`self_hosted_community`, `self_hosted_registered`, `self_hosted_enterprise`). On EE it keeps `get_plans()`. One `is_ee()` seam in `keys.py`, like the other seams in the API.
- `DefaultPlan` in EE keeps its members and takes the self-hosted values from the OSS constants, so the slugs have one source.
- `PUT /instance/license` is registered on both images. The `if is_ee()` branches in the router go away.
- A cloud key on the OSS image is valid but never makes the install cloud (`is_cloud()` is false on the OSS image). `activate` already refuses a cloud key in the app.

### Decision 2: The limits table

| Option | Trade-off |
| --- | --- |
| **A. A fixed table by plan in OSS code** (`api/oss/src/core/licenses/limits.py`) | Small. Changing a number needs a release. |
| B. Limits in the key payload (`projects`, `organizations`) | Per-customer numbers without a release. Needs a payload change in the website worker and the signing tool, and every key must carry them. No paid customers exist yet. |
| C. Add self-hosted rows to EE `PROJECT_LIMITS` | Not visible from the OSS image. |

The table:

| Plan | Projects per organization | Organizations per instance |
| --- | --- | --- |
| `self_hosted_community` (no key, expired key, invalid key) | 1 | 1 |
| `self_hosted_registered` (free key) | Question 1 on the decision page; spec uses no limit | 1 |
| any other plan (paid key) | no limit | no limit |
| cloud (`is_cloud()`) | from `PROJECT_LIMITS` by Stripe plan, as today | no limit |

The cloud project limit stays in EE `PROJECT_LIMITS`, because cloud plans are EE.

### Decision 3: One module decides the limits, with one cloud check

All limit logic lives in `api/oss/src/core/licenses/limits.py`. It has two checks with the same shape. Each raises an error class that carries its `code` and `limit`:

| Check | Raises | `code` |
| --- | --- | --- |
| `check_project_limit(organization_id)` | `ProjectLimitReachedError` | `project_limit_reached` |
| `check_instance_organization_limit()` | `InstanceOrganizationLimitReachedError` | `instance_organization_limit_reached` |

`InstanceOrganizationLimitReachedError` lives in `api/oss/src/core/organizations/exceptions.py`, next to the per-user `OrganizationLimitReachedError`. `ProjectLimitReachedError` lives in `api/oss/src/core/licenses/types.py`.

`SELF_HOSTED_LIMITS` maps a plan to `Limits(max_projects, max_organizations)`. `None` means no limit. A plan that is not in the table has no limit, the same rule as `PROJECT_LIMITS`.

The cloud check moves to OSS too. `is_cloud()` moves to `api/oss/src/core/licenses/cloud.py`. It returns false on the OSS image, so a cloud key on OSS never makes the install cloud. `validate_cloud_license` (the start-up check against Stripe) stays in EE. Every caller uses the one OSS `is_cloud()`. The license router's `_is_cloud()` wrapper is removed.

`check_project_limit` picks the limit in one place:

1. Cloud: the EE function `cloud_project_limit(organization_id)` reads the Stripe plan with `plan_for` and looks it up in `PROJECT_LIMITS`. It replaces `project_limit_refusal`. `check_project_limit` puts the EE `PROJECT_LIMIT_MESSAGE` in the cloud refusal as its English `message`.
2. Not cloud: `SELF_HOSTED_LIMITS[instance_plan()].max_projects`.

If the limit is set and `count_organization_projects(org) >= limit`, it raises. Fail open, as today: a failed plan read logs and allows the creation.

`check_instance_organization_limit` returns at once on cloud. Else it reads `SELF_HOSTED_LIMITS[instance_plan()].max_organizations` and compares with a new helper `db_manager.count_organizations()` (organizations not deleted). Fail open the same way.

`SELF_HOSTED_PLANS` (community, registered, enterprise), the set a key may carry on OSS, and `FREE_SELF_HOSTED_PLANS` (community, registered), the set without a paid key, live in `licenses/types.py` next to the plan slugs. EE `controls.py` drops its own `FREE_SELF_HOSTED_PLANS` and imports this one. `keys.py` and `limits.py` both import them from there, so the key check does not depend on the limits. The router's own `COMMUNITY_PLAN` copy goes away.

### Decision 4: Where the checks run

| Path | Project check | Organization check |
| --- | --- | --- |
| `POST /projects/` (`create_project`) | yes, both images | n/a |
| `POST /organizations/` (`create_organization_for_user`) | n/a | yes, raises; the router answers HTTP 403 |
| Sign-up (`oss.src.services.commoners.create_accounts`) | n/a | yes; before it calls `create_organization_for_signup`, it calls `check_instance_organization_limit()`, catches the error, logs, and skips the personal organization |
| Platform admin routes (`/admin/...`, `PlatformAdminAccountsService`) | no | no |

The platform admin routes are the operator's own tool, authorized by `AUTH_KEY`, and the test suites create accounts through them. They stay outside the limits.

The router error shape is `detail = {"code": ..., "message": <English>, "limit": <int>}`, the same flat shape as `vault` and `mounts`. `InstanceOrganizationLimitReachedError` subclasses `OrganizationCreationNotAllowedError`, so the router's existing handler order must catch it first. The per-user cap `AGENTA_ACCESS_MAX_OWNED_ORGANIZATIONS` keeps its string `detail`, as today.

Two sign-ups at the same moment on an empty instance can both create an organization. This needs two people to sign up within milliseconds on a new install; the instance then has 2 organizations and refuses more. No lock.

### Decision 5: `/m` refusal and next step

The create-project dialog and the Organizations tab read `detail.code`. For `project_limit_reached` and `instance_organization_limit_reached` they show a translated message and one next step:

- Instance admin (the License tab is visible to them): a button "Open License settings" that opens the License tab. The tab already has the free key form (#8242) and the add-a-key form (#8238).
- Anyone else: the message ends with "Ask your instance admin."
- Cloud project refusal: the existing upgrade path to Billing, translated.

New strings go in all 7 locales. Exact text is in `tasks.md`; Question 4 on the decision page covers the shape.

The License tab shows the add-a-key form on the OSS image too. Today `LicenseTab.tsx` hides it behind `isEE()` and says license keys need the Enterprise image; that branch goes away, so the activation link and the refusal's next step work on OSS.

The zero-organization screen changes from "No projects found." to a text that says the person has no organization yet and needs an invitation. This also helps the existing allowlist case.

### Decision 6: Existing installs on upgrade

No data changes. A count above the limit is kept; only creating a new one is refused. The release notes and the editions page say what changes. Question 5 on the decision page asks whether the instance admin also sees a notice in `/m`.

## Risks / Trade-offs

- Existing OSS teams that add a project a week hit the limit right after upgrade. Mitigation: the refusal names the free key and the License tab has the form.
- Existing OSS installs where every person signs up and gets their own organization change behavior: new people get no organization and need an invitation. Mahmoud decided this on 2026-11-21.
- Moving `ee0000000010` to the OSS chain needs a one-time downgrade on dev stacks that ran it (see Migration). No released version has it.
- The key check is MIT code and can be patched out. Same as today.
- `keys.py` is being edited on #8238 (real public keys). This change moves the file, so it must start after that edit lands on #8238.

## Migration

- New migration `oss000000064_add_licenses` in `api/oss/databases/postgres/migrations/core_oss/versions/` with the same `licenses` table. EE runs the `core_oss` chain before `core_ee` (`api/ee/databases/postgres/migrations/runner.py:34-35`), so EE gets it too.
- Remove `ee0000000010_add_licenses.py`, so the `core_oss` chain alone creates and drops the table. #8238 and this change ship in the same release (v0.130.1), so no released version has `ee0000000010`. A dev stack that ran it repairs once: with the old checkout, downgrade `core_ee` to `ee0000000009` (this drops `licenses` and records the right revision), then upgrade with the new checkout and add the license key again.
- Rollback: drop the table with the OSS migration's downgrade. A rollback to a version without the OSS key check loses the limits and the key on OSS only.
