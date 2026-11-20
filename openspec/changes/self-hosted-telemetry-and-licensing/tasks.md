# Tasks

Each group ships on its own. Groups 1, 3 and 5 can run in parallel. Group 2 needs group 1. Group 4 needs group 3. Group 6 is the ops move to one image; it needs group 3 and ships last. Inside a group, tasks marked (parallel) can run at the same time. Every group works on today's OSS and EE images.

## 1. Honest telemetry (points 7, 10, 11, 12)

- [ ] 1.1 Add `AGENTA_TELEMETRY_ENABLED` and `AGENTA_DEPLOYMENT_METHOD` to `api/oss/src/utils/env.py` in a new `TelemetryConfig` (`env.telemetry`).
- [ ] 1.2 Migration in the shared OSS chain: the `instances` table and its one row. DAO and a service that returns the instance id, kind, edition and running version.
- [ ] 1.3 One telemetry gate and one distinct id function. `_load_posthog()` returns nothing when the gate is closed. Keep the built-in PostHog key.
- [ ] 1.4 Switch self-hosted per-user API events to `<instance_id>:<user_id>`; drop email, username, organization name and `cloud_url`.
- [ ] 1.5 Send `instance_installed` at start and after organization creation, with only the instance id, GeoIP off and no IP. Remove `oss_deployment_created`.
- [ ] 1.6 (parallel) `GET /instance/telemetry`; the browser loads PostHog only when it says so and uses its distinct id and group; drop email from browser person properties and from `survey sent` on self-hosted.
- [ ] 1.7 (parallel) Hosting templates (compose, Helm, Railway): set `AGENTA_DEPLOYMENT_METHOD` and document the switch and the update check setting.
- [ ] 1.8 (parallel) Write the telemetry docs page, fix the privacy page, add the docs-versus-model unit test, and add the startup log line.

## 2. Heartbeat and PostHog (points 4, 5, 6)

- [ ] 2.1 Heartbeat payload model, collector queries, `POST /admin/telemetry/heartbeat` with the row lock on `instances` and a synchronous send, and the `telemetry.sh` cron in the four API Dockerfiles.
- [ ] 2.2 PostHog `instance` group on every self-hosted heartbeat and per-user event; group properties from the heartbeat.
- [ ] 2.3 (parallel) Dashboards in the existing open-source PostHog project: installed, active, silent instances; versions; editions; top domains. First confirm that the built-in key and the EE template key both point to that project, or point the EE templates there.

## 3. License keys (points 1, 8, 13)

- [ ] 3.1 Key format and check (Ed25519), public key in code, `key_id` refusal list, signing tool kept outside the repo, `licenses` table in the EE chain, `AGENTA_LICENSE_KEY` (`env.license.key`).
- [ ] 3.2 `self_hosted_community` and `self_hosted_registered` in the plan table. One `instance_plan()` resolver used by `SubscriptionsService.read` and the entitlement reader: Stripe, then the key, then `self_hosted_community`; env plan settings cannot turn on enterprise flags without a key (design decision 9).
- [ ] 3.3 (parallel) Instance admin check; `GET` and `PUT /instance/license`; License page and activation link in `/m`, with the OSS image variant.
- [ ] 3.4 Licensed instances ignore the switch unless `telemetry: "exempt"`.
- [ ] 3.5 Expiry and seat notices for instance admins.
- [ ] 3.6 (parallel) Ops before the release: confirm every cloud region resolves plans through Stripe; check staging and preview and give an internal key where Stripe is not set up; issue an internal development key for the team dev stacks.

## 4. Registration and upgrade surfaces (points 2, 3)

- [ ] 4.1 Agenta registration endpoint: signs a `self_hosted_registered` key and emails it with the activation link.
- [ ] 4.2 `POST /instance/license/registrations` and the registration form on the License page, on both images.
- [ ] 4.3 (parallel) Locked states for the Access and security and Audit log tabs on both images; upgrade events.
- [ ] 4.4 Offer after the setup survey, chosen from the survey answers in the browser.

## 5. Update notices (point 9)

- [ ] 5.1 Extend `pnpm generate:releases` with `securityFix` (from the `security` tag) and the notices file, and publish `releases.json` from the website build.
- [ ] 5.2 (parallel) `GET /instance/releases` that fetches and caches the feed, used by cloud and self-hosted; `AGENTA_UPDATE_CHECK_ENABLED`.
- [ ] 5.3 (parallel) Merge the feed into the existing `RELEASES` reader in `@agenta/navigation`, so the existing "What's new" dialog and help menu show newer releases; add the version compare function, the update marker, the security warning and targeted notices there.

## 6. Ops: move to one public image (point 1, design decision 1)

Its own release. It needs group 3 live on cloud, staging and preview first.

- [ ] 6.1 Release pipeline builds one public API, services and runner image with the enterprise code inside, and keeps publishing the private EE images for one release.
- [ ] 6.2 Move staging and preview to the public images; check plans and enterprise features.
- [ ] 6.3 Move cloud one region at a time with a rolling deploy and no downtime; check the first region before the next one starts.
- [ ] 6.4 (parallel) Point the EE compose files and the Helm values at the public images for the team dev stacks.
- [ ] 6.5 (parallel) Release notes and self-host docs tell customers on the private EE image the new image name.
- [ ] 6.6 One release later, stop publishing the private EE images and remove the EE-only build files.
