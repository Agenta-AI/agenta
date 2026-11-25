# One image, and self-hosted project and organization limits

Status: decided and built, in review (updated 2026-11-25). Target release: v0.131.1 (`release/v0.131.1`, release PR #8583); no `release/v0.130.1` branch exists. Stacked on #8238 (signed license keys) and #8242 (free registration key). The PRs get base `release/v0.131.1` when Mahmoud approves each merge.

Decided by Mahmoud on 2026-11-21: the free key gives no project limit; a paid key means no project or organization limit; Agenta ships one image for both editions and the key check, plans and limits stay in `ee/`; a refused person sees a translated message with one next step by role; upgrades show no extra notice in the app beyond the one-time registration prompt; open source installs older than v0.104.0 upgrade through v0.129.x first; the classic /w web app keeps two builds; the Enterprise License wording is approved.

Decided by Mahmoud on 2026-11-25 (decisions D1 to D38 in the run folder recap): registration is a full onboarding step and a one-time prompt for admins of upgraded installs; the updates box is optional and starts ticked; the setup answers go with the registration by default; the free key is tied to the instance that registered; registration links the instance to the email in PostHog and Loops; the 8 license and limit screens and the usage API are approved; the project limit asks to register; provider keys from the environment keep today's rule; the install event is `instance_installed` from #8237; the sign-in rule applies to every plan; installs older than v0.104.0 are reviewed statically.

## Why

The free registration key from #8242 gives the plan `self_hosted_registered`. Today that plan unlocks exactly what an instance with no key gets (`self_hosted_community`), so there is no reason to register. Mahmoud decided to make the key worth having and to limit what an instance gets without a key:

- Projects. Without a key, an organization gets 1 project. The free key or a paid key removes the limit.
- Organizations. Without a paid key, an instance has 1 organization. A paid key and Agenta Cloud have no limit.

These limits must apply to people who run the open source image today. That image has no key check: the check, the plans and the "add a key" form exist only in the private enterprise image. Mahmoud chose to fix this by shipping one image that holds both the MIT code and the `ee/` code, the way n8n ships. The key then decides the plan, and a person upgrades from free to paid by adding a key, not by switching images.

Existing installs keep every project and organization they have. Only new ones are refused.

## What Changes

- One image per component, published under today's public names (`agenta-api`, `agenta-services`, `agenta-runner`, `agenta-web-mobile`). The API image always contains `api/ee`. An existing open source install upgrades by pulling and restarting, with no file edits.
- The EE code path runs on every install. `AGENTA_LICENSE` stops choosing the code path. In the API it keeps one job: the default database name prefix (`agenta_oss` or `agenta_ee`), so existing installs keep their databases. The services keep today's provider keys rule, which reads it (decided 2026-11-25).
- One migration runner for every install. It adopts an open source database into the enterprise schema on the first start, and gives members the same project access they had. Installs older than v0.104.0 are refused before any change; this path is checked by a static review, not a live test.
- Fixes for behavior that is right on cloud and wrong on self-hosted: Hobby rate limits outside cloud, analytics settings, "cloud" labels in `/m`, the stored plan, and the sign-in methods of organizations created before the upgrade (the rule applies to every plan).
- Project limit by plan, checked on every install. Refusal: HTTP 403 with `detail.code = "project_limit_reached"`. The text asks the instance admin to register the instance for free.
- Organization limit by plan, checked on `POST /organizations/` (HTTP 403, `detail.code = "instance_organization_limit_reached"`) and at sign-up, which skips the personal organization instead of failing. The text names a paid key or an invitation, never the free key.
- Registration (#8242): a full onboarding step in `/m` after the survey, and a one-time prompt for the admin of an upgraded install, skipped for good on the server. The box "Send me security and product updates (about once a month)" starts ticked and is optional. The setup answers go with every registration. The free key carries the instance id and works only on that instance; paid keys stay untied.
- Registration links the instance to the email: the website worker sends `instance_registered` to PostHog and stores the `agenta*` fields on the Loops contact. Instances that do not register stay anonymous.
- License API: `GET /instance/license` and `GET /instance/license/usage` return project and organization usage against the plan limits.
- `/m` shows the 8 approved license and limit screens: the License tab before a key, after a free key and after a paid key, the registration step, one Enterprise box per locked page, the project limit dialog, the organization limit dialog, and the no-organization card. All text is in 7 locales.
- The Enterprise License text (`ee/LICENSE` files) changes so the free plans may run the `ee/` code in production, with the wording Mahmoud approved on 2026-11-21. A lawyer review is still advised.
- Hosting files, the public and private image builds, CI and the docs follow.

### Related changes, not in this spec

- Telemetry and analytics (#8237, #8239, #8240, #8487): `instance_installed` as the only install event, `instance_kind` on every self-hosted event, the audit gaps, the update check, PostHog person linking and dashboards, and the test PostHog project (decisions D4 to D7, D9, D10 and D38). This change only relies on `instance_installed` and does not add its own install event.
- Update notices in the help menu and What's new (#8240, decisions D11 to D14).

### Scheduled follow-ups, after the release

- Remove `AGENTA_LICENSE` where it no longer has a job, and keep the vault and `/w` uses (D34).
- Remove the open source only code paths that stop running (D35).
- Fold the migration chains into one chain, 7 days after the release, with a replay test, never merged without Mahmoud's OK (D36).
- Per-project access screen on the enterprise edition, issue #8588 (D37).

## Capabilities

### New Capabilities

- `self-hosted-limits`: project and organization limits by instance plan, the typed refusals, the sign-up rule, the instance registration with the free key tied to the instance, the usage API and the license and limit screens.
- `one-image`: one image per component for every install, the edition no longer chosen by `AGENTA_LICENSE`, and the automatic upgrade of open source installs.

### Modified Capabilities

- None outside this change. The license key check from #8238 keeps its behavior; it now runs on every install.

## Impact

- API: `api/oss/src/core/licenses/` (registration, prompt, usage), `api/oss/src/apis/fastapi/licenses/`, `api/ee/src/core/licenses/service.py` (instance tie), `api/oss/src/core/auth/service.py` (sign-in flags), `api/oss/src/utils/env.py`, `api/oss/src/utils/common.py`, both migration runners, `api/ee/src/middlewares/throttling.py`, analytics, `api/ee/src/core/subscriptions`, `api/ee/src/core/access/entitlements/` (limits tables and checks), `api/oss/src/routers/projects_router.py`, `api/oss/src/routers/organization_router.py`, `api/oss/src/services/commoners.py`.
- SDK: none. Provider keys from the environment keep today's rule (decided 2026-11-25).
- Frontend: `web/entrypoint.sh`, `/m` cloud checks, analytics, the registration step and prompt, the License tab, the Enterprise boxes, the project and organization dialogs, the no-organization card, 7 locales.
- Website worker (`web/website`): the free key carries the instance id, the Loops fields, `agentaProductUpdates`, and the PostHog `instance_registered` event.
- Images and hosting: Dockerfiles, `hosting/docker-compose/{oss,ee}`, `run.sh`, the Helm chart, Railway, public workflows 17, 42, 12 and 44, and the private image build (workflows 19, 63 and 43 in the cloud repo, a separate PR there).
- Legal: `api/ee/LICENSE`, `web/ee/LICENSE`, `services/ee/LICENSE`, `ee/LICENSE`.
- Behavior change for existing open source installs on upgrade: the first start migrates the database (take a backup), a second project needs the free key, a second organization needs a paid key, and new sign-ups on an instance with an organization get no personal organization.
