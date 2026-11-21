# One image, and self-hosted project and organization limits

Status: draft, design rewritten for one image (2026-11-21). Target release: v0.130.1, together with the telemetry and license PRs. Stacked on #8238 (signed license keys) and #8242 (free registration key) until a `release/v0.130.1` branch exists.

Decided by Mahmoud on 2026-11-21: the free key gives no project limit; a paid key means no project or organization limit; Agenta ships one image for both editions and the key check, plans and limits stay in `ee/`; a refused person sees a translated message with one next step by role; upgrades show no extra notice.

## Why

The free registration key from #8242 gives the plan `self_hosted_registered`. Today that plan unlocks exactly what an instance with no key gets (`self_hosted_community`), so there is no reason to register. Mahmoud decided to make the key worth having and to limit what an instance gets without a key:

- Projects. Without a key, an organization gets 1 project. The free key or a paid key removes the limit.
- Organizations. Without a paid key, an instance has 1 organization. A paid key and Agenta Cloud have no limit.

These limits must apply to people who run the open source image today. That image has no key check: the check, the plans and the "add a key" form exist only in the private enterprise image. Mahmoud chose to fix this by shipping one image that holds both the MIT code and the `ee/` code, the way n8n ships. The key then decides the plan, and a person upgrades from free to paid by adding a key, not by switching images.

Existing installs keep every project and organization they have. Only new ones are refused.

## What Changes

- One image per component, published under today's public names (`agenta-api`, `agenta-services`, `agenta-runner`, `agenta-web-mobile`). The API image always contains `api/ee`. An existing open source install upgrades by pulling and restarting, with no file edits.
- The EE code path runs on every install. `AGENTA_LICENSE` stops choosing the code path. It keeps one job: the default database name prefix (`agenta_oss` or `agenta_ee`), so existing installs keep their databases.
- One migration runner for every install. It adopts an open source database into the enterprise schema on the first start, and gives members the same project access they had.
- Fixes for behavior that is right on cloud and wrong on self-hosted: Hobby rate limits outside cloud, provider keys from the environment, analytics settings, "cloud" labels in `/m`, and the stored plan.
- Project limit by plan, checked on every install. Refusal: HTTP 403 with `detail.code = "project_limit_reached"`.
- Organization limit by plan, checked on `POST /organizations/` (HTTP 403, `detail.code = "instance_organization_limit_reached"`) and at sign-up, which skips the personal organization instead of failing.
- `/m` shows both refusals translated in 7 locales, with a next step by role, and a clear screen for a person who has no organization.
- The Enterprise License text (`ee/LICENSE` files) changes so the free plans may run the `ee/` code in production. The wording needs Mahmoud and a lawyer.
- Hosting files, the public and private image builds, CI and the docs follow.

## Capabilities

### New Capabilities

- `self-hosted-limits`: project and organization limits by instance plan, the typed refusals, and the sign-up rule.
- `one-image`: one image per component for every install, the edition no longer chosen by `AGENTA_LICENSE`, and the automatic upgrade of open source installs.

### Modified Capabilities

- None outside this change. The license key check from #8238 keeps its behavior; it now runs on every install.

## Impact

- API: `api/oss/src/utils/env.py`, `api/oss/src/utils/common.py`, both migration runners, `api/ee/src/middlewares/throttling.py`, analytics, `api/ee/src/core/subscriptions`, `api/ee/src/core/access/entitlements/` (limits tables and checks), `api/oss/src/routers/projects_router.py`, `api/oss/src/routers/organization_router.py`, `api/oss/src/services/commoners.py`.
- SDK: `sdks/python/agenta/sdk/middlewares/running/vault.py` (provider keys from the environment).
- Frontend: `web/entrypoint.sh`, `/m` cloud checks, analytics, the License tab, the project and organization refusals, the zero-organization screen, 7 locales.
- Images and hosting: Dockerfiles, `hosting/docker-compose/{oss,ee}`, `run.sh`, the Helm chart, Railway, public workflows 17, 42, 12 and 44, and the private image build (workflows 19, 63 and 43 in the cloud repo, a separate PR there).
- Legal: `api/ee/LICENSE`, `web/ee/LICENSE`, `services/ee/LICENSE`, `ee/LICENSE`.
- Behavior change for existing open source installs on upgrade: the first start migrates the database (take a backup), a second project and a second organization need a key, and new sign-ups on an instance with an organization get no personal organization.
