# Design: one image, and self-hosted project and organization limits

Research notes with full evidence: `research/` in the run folder (migrations, images and hosting, runtime). Line numbers refer to `feat/self-hosted-free-key` at `9f7fc1cc42`.

## Context

### Two editions today

- The edition comes from one variable: `_LICENSE = "ee" if AGENTA_LICENSE == "ee" else "oss"` (`api/oss/src/utils/env.py:13`). `is_ee()` and `is_oss()` read it (`api/oss/src/utils/common.py:51-56`). With `ee`, the API imports `ee.src.main`, checks the cloud key, and adds the throttling middleware and the EE routes (`api/entrypoints/routers.py:359-393`, `:648`, `:727`).
- The edition also picks the database names: the default prefix is `agenta_{license}` (`env.py:1914`, lock key `:2003`). `POSTGRES_DB_PREFIX` and `POSTGRES_URI_*` override it.
- The edition picks the migration runner. The OSS runner runs the OSS legacy chain, `core_oss` and tracing (`api/oss/databases/postgres/migrations/runner.py:21-27`). The EE runner runs the EE legacy chain, `core_oss` and `core_ee` (`api/ee/databases/postgres/migrations/runner.py:31-39`). Both legacy chains end at the empty revision `park00000000`, first shipped in v0.104.0. `ee0000000002` adopts an OSS database: it creates the EE tables and backfills one subscription per organization.
- Images: the OSS images are public (`agenta-api`, `agenta-web`, `agenta-services`, `agenta-runner`, `agenta-web-mobile`). The EE images are private (`internal-ee-*`; an anonymous pull is refused). The API Dockerfiles differ only in `COPY ./api/ee` and three crons (`api/ee/docker/Dockerfile.gh:49`, `:102-127`). Services and runner images are the same apart from a label. `web-mobile` is already one image. Classic web (`/w`) has two different Next.js builds (`oss/server.js` and `ee/server.js`).
- Builds: the cloud repo's workflow 19 calls workflow 63 once per edition; `scripts/ci/build.sh` picks `./api/${LICENSE}/docker/Dockerfile.gh` and names `internal-${LICENSE}-agenta-<svc>`. Workflow 43 mirrors `internal-oss-*` to the public names. Cloud deploys `internal-ee-*` with workflow 29.
- Hosting: the OSS compose file pulls the public names and hardcodes `node ./oss/server.js`, `/app/crontab` and `oss.databases.postgres.migrations.runner` (`hosting/docker-compose/oss/docker-compose.gh.yml:14`, `:238`, `:264`). The Helm chart picks image repositories, the web server path, the alembic module and the database names from `agenta.license` (`hosting/kubernetes/helm/templates/_helpers.tpl:314-364`, `:575-645`). Railway wrappers hardcode `AGENTA_LICENSE=oss`, `oss/server.js` and the OSS runner.
- License: the root `LICENSE` is MIT except `ee/` folders, which are under the Agenta Enterprise License. That license allows production use only with a valid Agenta Enterprise License (`api/ee/LICENSE`).

### Plans and limits today

- `instance_plan()` (`api/ee/src/core/licenses/service.py:127`) is the plan of the active key, else `self_hosted_community`. On self-hosted EE, `SubscriptionsService.read` replaces the stored plan with it (`api/ee/src/core/subscriptions/service.py:175-177`). The OSS image has no key check, and `PUT /instance/license` exists only on EE (`api/oss/src/apis/fastapi/licenses/router.py:90`).
- Projects: `create_project` checks a limit only on EE (`api/oss/src/routers/projects_router.py:243-246`) through `project_limit_refusal` and `PROJECT_LIMITS = {cloud_v0_hobby: 1}` (`api/ee/src/core/access/entitlements/service.py:317-331`, `types.py:811-816`). The refusal is a fixed English string that `/m` shows as is (`web/mobile/src/features/nav/DrawerProjectSwitcher.tsx:110-114`).
- Organizations: `create_organization_for_user` checks the owner allowlist, blocked domains and the per-user cap `AGENTA_ACCESS_MAX_OWNED_ORGANIZATIONS` (`api/oss/src/services/commoners.py:208-221`). `create_accounts` gives every new user a personal organization through `create_organization_for_signup`; if that raises, it deletes the user (`:282-312`). A user with no organization sees "No projects found." (`web/mobile/src/features/context/ContextResolver.tsx:123`).
- Typed errors use `detail = {"code": ..., "message": ...}` (`api/oss/src/apis/fastapi/vault/router.py:136`).

### What breaks if an OSS install simply runs the EE path

From the runtime research:

1. It opens empty `agenta_ee_*` databases if the edition sets the name.
2. The OSS runner skips `core_ee`, so `check_entitlements` raises "No subscription found" (`entitlements/service.py:285-288`).
3. EE checks project access by project rows; OSS gives every member every project (`api/entrypoints/access.py:38-43`). Members lose access unless rows are written (`memberships_check --materialize`, a manual step today).
4. With no key, the throttling middleware falls back to the `cloud_v0_hobby` throttles (`api/ee/src/middlewares/throttling.py:297-325`): on slow routes a burst of 120, then 1 request per minute. Self-hosted EE with no key has this bug today.
5. The SDK uses provider keys from the environment only when `AGENTA_LICENSE != "ee"` (`sdks/python/agenta/sdk/middlewares/running/vault.py:70-74`). This rule stays. An upgraded open source install keeps `AGENTA_LICENSE=oss`, so its keys keep working (decision 2026-11-25).
6. `/m` treats EE as cloud: analytics settings (session recording, email as id) and the "unavailable in cloud" label (`web/mobile/src/features/analytics/client.ts:35`, `web/mobile/src/features/chat/DrillInBridgeProvider.tsx:73`). Server analytics stop sending the OSS deployment event (`api/oss/src/middlewares/analytics.py:118`). #8237 replaces that event with the anonymous `instance_installed` event.
7. Stored plan rows say `self_hosted_enterprise` (`api/ee/src/core/subscriptions/types.py:31-47`); most reads replace it, a few do not.

Harmless on self-hosted: Loops (no key), fraud checks (no key), Stripe and the meters cron (no key), roles (community offers admin and member, as OSS), SSO and audit (shown locked).

## Goals / Non-Goals

Goals:

- One image per component, under today's public names. An existing OSS install upgrades by pulling and restarting, with no file edits and no manual migration.
- The key check, plans and limits stay in `ee/`.
- Without a key, an organization has 1 project, and an instance has 1 organization. The free key removes the project limit. A paid key and cloud remove both.
- Existing projects and organizations stay. Only new ones are refused.
- `/m` shows a translated refusal with a next step.

Non-goals:

- Removing the dead OSS-only code paths. They stop running and are removed in a follow-up.
- Merging the two classic web (`/w`) builds (Decision 3).
- Limits on users or seats.
- Limit numbers inside the key payload.
- A retention policy for the events that self-hosted installs now store (status quo of self-hosted EE).
- A redesign of roles.

## Decisions

### Decision 1: One image, the EE path always on (decided 2026-11-21: one image)

| Option | Trade-off |
| --- | --- |
| A. Move the key check, storage and route into MIT code; keep two images | Small. Keeps the open source image pure MIT. Mahmoud chose against it. |
| **D. One image with MIT and `ee/` code; the key picks the plan** | No image switch to go from free to paid. Every open source install moves to the EE code path and schema on upgrade. Needs the license text change (Decision 8). |

What "the EE path always on" means in code:

- `is_ee()` is true when the `ee` package is in the image, which is always for a shipped image. `is_oss()` is its opposite. `AGENTA_LICENSE` no longer changes them. Their docstrings say they mean "the `ee` code is present", not "this install has an enterprise plan". New code in this change calls the `ee/` limits through the existing `is_ee()` seam; a follow-up removes the seams and the dead OSS-only branches.
- In the API, `AGENTA_LICENSE` is read in one place only: the fallback for the database prefix, `agenta_{AGENTA_LICENSE}` with `oss` when unset. Existing OSS env files and the Helm default set `oss`, so they keep `agenta_oss_*`. Existing EE installs set `ee` and keep `agenta_ee_*`. The env examples for new installs set `POSTGRES_DB_PREFIX` instead. The alembic ini path no longer derives from it (Decision 4). The docs say that adding a key is the only step to a paid plan, and that changing `AGENTA_LICENSE` on an existing install points it at other, empty databases.
- In the web image, `AGENTA_LICENSE` only picks the classic `/w` build (Decision 3). `/m` stops reading it: every `isEE()` branch in `web/mobile` and `web/packages` takes the EE side, because the API always runs the EE path, except the branches that mean "cloud", which use `isCloud()` (Decision 2).
- Cloud stays `is_cloud()`: a valid cloud key in `AGENTA_LICENSE_KEY` (`api/ee/src/core/licenses/cloud.py`).
- The limits, the key check and the plans stay in `api/ee/`. The OSS routers call them through the existing `is_ee()` seams.

### Decision 2: The edition-dependent behavior that must change

| Today's rule | New rule |
| --- | --- |
| Throttling falls back to the free cloud plan's throttles for a plan with none | Outside `is_cloud()`, a plan with no throttles has none |
| SDK reads provider keys from the environment when `AGENTA_LICENSE != "ee"` | No change. Provider keys from the environment keep today's rule, decided 2026-11-25: on unless `AGENTA_LICENSE=ee`, and `AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED` overrides it. Open source installs (`AGENTA_LICENSE=oss` or unset) keep using `OPENAI_API_KEY` and the others from the environment. EE and cloud (`AGENTA_LICENSE=ee`) keep them off, and users store their keys in the app. Cloud sets no new flag |
| `/m` uses `isEE()` for cloud analytics (`OSS_CONFIG` or `CLOUD_CONFIG`), cloud labels and the provider key guard | `/m` uses `isCloud()`. It reads the value `web/entrypoint.sh` already derives from the cloud key for billing (`AGENTA_BILLING_ENABLED`, `web/entrypoint.sh:64-76`); `isBillingEnabled()` becomes a call to `isCloud()`, so one value has one source. The entrypoint drops the edition condition from that check and from the Turnstile gate. No new flag. `OSS_CONFIG` becomes `SELF_HOSTED_CONFIG` |
| `/m` hides the add-a-key form when not EE (`LicenseTab.tsx`) | The form shows on every self-hosted install; the `isEE()` branch goes away |
| Server analytics: `oss_deployment_created` under `is_oss()` (`api/oss/src/middlewares/analytics.py:118-126`); sign-up event property `is_ee` (`api/oss/src/core/auth/supertokens/overrides.py:211`) | No new install event. The install event is `instance_installed` from #8237 (instance id only, no email), which replaces `oss_deployment_created`. Sign-up property `is_cloud` instead of `is_ee`. The old property stops in v0.131.1; the release notes for the analytics dashboards say so |
| New subscriptions outside cloud store `self_hosted_enterprise` | They store `self_hosted_community`; reads keep using the instance plan |
| An organization created on an open source install stores `allow_email` and `allow_social` as the deployment had them; the EE policy check reads them and a Community owner cannot change them | Sign-in rule, option 1, decided 2026-11-25 for every plan: on a plan without the access entitlement, the email and social flags follow the deployment settings; the stored SSO and root flags stay, so SSO set up under a license keeps working after it expires |

### Decision 3: Images and names

- API: one Dockerfile, today's EE one (with `ee/` and the three crons). Published as `agenta-api`. The crons are valid on every install because the EE path is always on.
- Services and runner: one Dockerfile each (today they differ only in a label), published as `agenta-services` and `agenta-runner`.
- `web-mobile`: no change.
- Classic web (`/w`): keep both builds. The public `agenta-web` stays the OSS build, so `node ./oss/server.js` keeps working; cloud keeps the private EE build. `/w` is the abandoned desktop app and `/m` already serves both editions. Decided 2026-11-21 (Question 7, option A).
- Private names: cloud keeps deploying `internal-ee-*`. The build pushes the same API, services and runner digests under both the public and the private names, so workflow 29 is unchanged.
- Builds: workflows 19 and 63 drop the edition loop for API, services and runner. Workflow 43 mirrors the combined build to the public names. Public workflows 42 and 17 point at the combined Dockerfiles. The cloud repo change is its own PR.

### Decision 4: One migration runner

- `ee.databases.postgres.migrations.runner` owns the sequence: the revision check (below), the existing split of core and tracing databases, the legacy core chain, `core_oss`, the adoption step, `core_ee`, the legacy tracing chain and the tracing chains, then the existing copy of nodes from core to tracing. `oss.databases.postgres.migrations.runner` stays as a module name only because old compose, Helm and Railway files call it; in the one image it calls the `ee` runner and does nothing else. This alias is recorded in the module docstring and removed when those files no longer name it.
- The runner picks the legacy core chain and the legacy tracing chain itself, and ignores `ALEMBIC_CFG_PATH_CORE` and `ALEMBIC_CFG_PATH_TRACING` (today `env.py:925-928`, the Helm alembic job and the Railway wrapper derive both paths from the edition). It uses the EE copies; the two legacy tracing chains are the same files. The legacy core chain is picked from the core database's `alembic_version`, not from `AGENTA_LICENSE`, and the check runs before any other step, so a refusal changes nothing: on an empty database the runner runs the EE legacy chain, which creates the initial schema up to `park00000000`, as an EE install does today; at `park00000000` it skips the chain. Any other revision is a database older than v0.104.0. The runner stops before any change and tells the operator to upgrade to v0.129.x first (Question 6, decided 2026-11-21: option A). A new install whose very first start stopped partway through the legacy chain also lands here, because the chain commits one revision at a time. Such a database holds no data yet, so the message also says: if this is a new install, delete its databases and start again. This is a documented limit, not extra code.
- Adoption of an OSS database (no `alembic_version_ee` and no `subscriptions` table): after `core_oss` and before `core_ee`, the runner writes project membership rows (today's `memberships_check --materialize`), so every member keeps the projects they had. The materializer needs only the membership schema from `core_oss`. Because `core_ee` runs after it, an interrupted start leaves the adoption condition in place and the next start repeats the step, which is safe to repeat. It never runs on an EE database, where it would widen access.
- `ee0000000010_add_licenses` stays in `core_ee`, unchanged.
- Tests: replay a fresh database, an OSS database at v0.104.0, an OSS database at v0.129.x, an EE database at v0.129.x, and an OSS database whose first start stopped during the materialize step, through the runner in CI, and check the member access before and after.

### Decision 5: The limits tables, in the entitlements domain

Both limits live next to today's `PROJECT_LIMITS` in `api/ee/src/core/access/entitlements/types.py`, and both checks in `entitlements/service.py`:

| Plan | `PROJECT_LIMITS` (per organization) | `ORGANIZATION_LIMITS` (per instance) |
| --- | --- | --- |
| `cloud_v0_hobby` | 1 (today) | not in table |
| `self_hosted_community` (no key, expired, invalid) | 1 (new row) | 1 |
| `self_hosted_registered` (free key) | not in table | 1 |
| any other plan (paid key, other cloud plans) | not in table | not in table |

A plan missing from a table has no limit. Outside cloud, `plan_for` already returns the instance plan (`SubscriptionsService.read` replaces the stored plan), so one table serves cloud and self-hosted for projects. `ORGANIZATION_LIMITS` is never read on cloud.

### Decision 6: The two checks

| Check (`entitlements/service.py`) | Raises (`entitlements/types.py`) | `detail.code` |
| --- | --- | --- |
| `check_project_limit(organization_id)` | `ProjectLimitReachedError` | `project_limit_reached` |
| `check_instance_organization_limit()` | `InstanceOrganizationLimitReachedError` | `instance_organization_limit_reached` |

- `check_project_limit` replaces `project_limit_refusal`: `PROJECT_LIMITS.get(plan_for(org))` against `count_organization_projects`. The English message is `PROJECT_LIMIT_MESSAGE` on cloud and a self-hosted message otherwise.
- `check_instance_organization_limit` returns at once on cloud. Else `ORGANIZATION_LIMITS.get(instance_plan())` against a new `db_manager.count_organizations()` (not deleted), next to `count_organization_projects`.
- Both fail open: a failed plan read logs and allows the creation, as today.
- `InstanceOrganizationLimitReachedError` is its own class, not a subclass of `OrganizationCreationNotAllowedError` (which means "this person may not create organizations"). The organization router catches it explicitly.
- Response shape: HTTP 403, `detail = {"code", "message" (English), "limit"}`, flat like `vault` and `mounts`.

Where they run:

| Path | Project check | Organization check |
| --- | --- | --- |
| `POST /projects/` (`create_project`) | yes | n/a |
| `POST /organizations/` (`create_organization_for_user`) | n/a | yes, raises |
| Sign-up (`oss.src.services.commoners.create_accounts`) | n/a | yes: it calls the check before `create_organization_for_signup`, catches the error, logs, and skips the personal organization |
| Platform admin routes (`PlatformAdminAccountsService`) | no | no |

The platform admin routes are the operator's tool, authorized by `AUTH_KEY`, and the test suites create accounts through them. Two sign-ups at the same moment on an empty instance can both create an organization; no lock.

### Decision 7: `/m` limits and next step (decided 2026-11-21: option A; screens approved 2026-11-25)

- The project and organization dialogs read the usage (`GET /instance/license/usage`) when they open. At the limit they show the count with a bar in the info color and keep Create off, so the person sees the limit before a refusal.
- `DrawerProjectSwitcher.tsx` and `OrganizationsTab.tsx` still read `detail.code` from a refusal and show translated text for the two codes; other errors keep the string fallback.
- Project limit, instance admin: "Register this instance for free to create more projects." and a "Register this instance" button that opens the registration in place. Member: "Ask your instance admin to register this instance for more projects."
- Organization limit: a paid key or an invitation, never the free key, because the free key does not lift it.
- Settings > Projects shows "This organization uses 1 of 1 projects" with a Register button.
- Cloud project refusal: the existing upgrade path to Billing, translated.
- No organization: a card that names who to ask and the signed-in account, with "Check again" and "Sign out".

### Decision 8: The Enterprise License text

A public image distributes the `ee/` code, and every install without a key runs it in production. The current text allows production use only with a valid Agenta Enterprise License. The text must allow production use of the `ee/` code on the free plans (no key, and the free registration key), while the features those plans do not turn on stay licensed only with a paid key. Decided 2026-11-21 (Question 8, option A): the first paragraph of each Enterprise License file becomes:

> You may use this Software in production free of charge under the Community plan and the Registered plan, as described in the Agenta documentation, but only for the features those plans make available. Any other production use of this Software, including any feature that requires a paid license key, requires that you (and any entity that you represent) have agreed to, and comply with, the Agenta Subscription Terms of Service, available at https://agenta.ai/terms, or another agreement with Agenta, and hold a valid Agenta Enterprise License.

The rest of the license stays as it is. A lawyer review is still advised before the release. The code does not change with it.

### Decision 9: Existing installs on upgrade (decided 2026-11-21: no notice; 2026-11-25: one registration prompt)

No upgrade notice in `/m`. The only new prompt is the one-time registration prompt for the instance admin (Decision 10). The release notes, the editions page and the upgrade page say: take a database backup; the first start migrates the open source database to the full schema; a second project needs the free key and a second organization needs a paid key. Counts above the limit are kept.

Installs older than v0.104.0 are checked by a static review of the runner's revision check and refusal, not by a live upgrade test (decided 2026-11-25).

### Decision 10: Registration in onboarding and a one-time prompt (decided 2026-11-25)

- Registration is a full onboarding step in `/m` right after the survey, not a dialog over the next step. It names the gain (more than 1 project, security notices, future free features) and has "Send me a free key" and "Skip".
- The admin of an upgraded install, who never sees onboarding, gets the same step once as a prompt. Skipping it calls `POST /instance/license/registration-prompt/dismiss`; the skip is stored on the server, and `GET /instance/license` reports it, so the prompt does not come back on another browser.
- Other places to register: a card on the License tab, the project limit dialog (in place), and Settings > Projects.
- The box "Send me security and product updates (about once a month)" starts ticked and is optional. Unticked still gets the key. Security notices go to every registrant.
- The setup answers (role, team size, how they found Agenta; option labels only, never typed text) go with every registration, with no box. One line under the button says so.
- The promise "You keep what your key unlocks." is shown; free keys never expire.

### Decision 11: The free key is tied to one instance (decided 2026-11-25, option 1)

The worker writes the instance id into the free key payload. The API accepts a `self_hosted_registered` key only when that id is this instance's id, on activation and when it reads a stored or environment key. A key for another instance gives the plan `self_hosted_community`, and the License tab says the key belongs to another instance. Paid keys stay untied.

### Decision 12: Registration in PostHog and Loops (decided 2026-11-25)

- The API forwards the updates choice, the setup answers and the signed-in user id with the registration.
- The website worker sends the key email (Loops transactional `LOOPS_TRANSACTIONAL_ID`) and stores the contact with `source` "self-hosted registration", `userGroup` "self-hosted", and the fields `agentaVersion`, `agentaRegisteredAt`, `agentaPlan`, `agentaInstanceId`, `agentaRole`, `agentaTeamSize`, `agentaHeardFrom` and `agentaProductUpdates` (true when ticked). No Loops list; campaigns target `userGroup` self-hosted with `agentaProductUpdates` true.
- The worker then sends to the self-hosted PostHog project, whatever the instance's telemetry switch: `instance_registered` with distinct id the instance id, the email, version, plan and setup answers, in group `instance`; a `$groupidentify` with `registered_email`; and `$set: {email}` on the person `<instance_id>:<user_id>` of the registering admin.
- The docs say: "Registering links your instance to your email in our analytics. Instances that do not register stay anonymous."
- The self-hosted survey event does not carry the email (this avoids a merge trap with #8237).

### Decision 13: Usage in the license API (decided 2026-11-25)

- `GET /instance/license` adds `usage.projects` (in the request's organization) and `usage.organizations` (on the instance), each `{count, limit}`, with `limit` null for no limit.
- `GET /instance/license/usage` gives the same counts to any person signed in to the app, so a member sees the limit before creating.
- The License tab shows them as bars (and seats for a paid key), with a "Community" or "Registered" badge, the days left for a paid key, and the key box moved into an "Add a license key" dialog. Each locked enterprise page shows one compact "Available on the Enterprise plan" box.

## Risks / Trade-offs

- Size and timing: this is a Program-size change for v0.131.1. The migration runner and the image build are the slow parts. If they slip, the limits cannot ship alone, because the open source image would not have the key check.
- Migration on first start for every open source install. The adoption only adds tables and rows, but a bad legacy chain choice cannot be undone. The runner stops before any change on an unknown revision. Release notes ask for a backup.
- Rollback: an OSS image v0.104.0 or later can start again on an adopted database with `ALEMBIC_AUTO_MIGRATIONS=false`; the added tables and rows do not affect it.
- The open source image now contains code under the Enterprise License. Community packagers may object.
- CI: `12-check-unit-tests.yml` and `44-railway-tests.yml` pin `oss`. The OSS-only test paths in the three `run-tests.py` stop matching what ships; CI moves to the EE path.
- Existing open source teams hit the project limit after upgrade. The dialog shows the limit and lets the admin register in place.
- Registration links an instance to an email in PostHog and Loops. Only instances that register are linked; the docs say so.
- Self-hosted installs now store events with no retention and write meters on ingest, as self-hosted EE does today.

## Migration

- No new table for the limits. `ee0000000010` stays.
- The runner change in Decision 4 is the migration path for open source installs.
- Dev stacks: no repair needed.
