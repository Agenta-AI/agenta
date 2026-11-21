# Self-hosted project and organization limits

Status: draft. Decided 2026-11-21: the free key gives no project limit, and a paid key means no project or organization limit. Waiting for answers on the key check move, the refusal in /m and the upgrade notice. Target release: v0.130.1, together with the telemetry and license PRs. Stacked on #8238 (signed license keys) and #8242 (free registration key) until a `release/v0.130.1` branch exists.

## Why

The free registration key from #8242 gives the plan `self_hosted_registered`. Today that plan unlocks exactly what an instance with no key gets (`self_hosted_community`), so there is no reason to register. Mahmoud decided on 2026-11-21 to make the key worth having and to limit what an instance gets without a key:

- Projects. Without a key, an organization gets 1 project. The free key or a paid key gives more. This applies to the open source (OSS) image too, so the OSS image must accept and check a key. Today the check lives in `api/ee/src/core/licenses/` and the OSS image cannot store a key (`PUT /instance/license` is EE only, `api/oss/src/apis/fastapi/licenses/router.py`).
- Organizations. Without a paid key (OSS, EE with no key, or EE with the free key), an instance has 1 organization. A paid key and Agenta Cloud have no limit.

Existing installs keep every project and organization they have. Only new ones are refused.

## What Changes

- The license key check, its storage and `PUT /instance/license` move from EE code to OSS code, so both images accept a key. The `licenses` table moves from the EE migration chain to the shared OSS chain. `is_cloud()` moves to OSS too and is false on the OSS image. The start-up check against Stripe, the plan table and the enterprise flags stay in EE.
- A new table of self-hosted limits, by plan, in OSS code: projects per organization and organizations per instance.
- `POST /projects/` checks the project limit on both images. On cloud it keeps the Stripe plan limit (`cloud_v0_hobby`: 1). The refusal becomes a typed error: HTTP 403 with `detail.code = "project_limit_reached"`.
- `POST /organizations/` checks the organization limit and refuses with HTTP 403 and `detail.code = "instance_organization_limit_reached"`.
- During sign-up, `create_accounts` skips the personal organization when the instance is at its organization limit. It logs and does not raise, because a failure there deletes the new user. The new user joins through an invitation.
- `/m` reads the error code and shows a translated message in all 7 locales, with a next step: the instance admin goes to the License tab to get or add a key; other people ask their instance admin.
- Docs: the editions page, the restrict access page, and the configuration reference describe the limits.

## Capabilities

### New Capabilities

- `self-hosted-limits`: project and organization limits by instance plan, the typed refusals, and the sign-up rule.

### Modified Capabilities

- `instance-license`: the key check, storage and the add-a-key route work on the OSS image too.

## Impact

- API: `api/oss/src/core/licenses/` (gets the key check and service), `api/oss/src/dbs/postgres/licenses/` (gets the DAO), a new `core_oss` migration, `api/oss/src/routers/projects_router.py`, `api/oss/src/routers/organization_router.py`, `api/oss/src/services/commoners.py`, `api/ee/src/core/access/entitlements/service.py`, the license imports in EE.
- Contract: two new error codes on existing routes; `PUT /instance/license` on OSS.
- Frontend: `web/mobile/src/features/nav/DrawerProjectSwitcher.tsx`, `web/mobile/src/features/settings/OrganizationsTab.tsx`, the i18n catalogs in `web/packages/agenta-i18n`.
- Behavior change for existing OSS installs on upgrade: a second project and a second organization need a key. New sign-ups on an instance that already has an organization get no personal organization.
- Dev stacks that already ran the EE migration `ee0000000010` downgrade `core_ee` to `ee0000000009` once with the old checkout (no released version has it).
