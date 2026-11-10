# Design

## Context

Today's behavior, read on `origin/main` at `ce68eea1af`.

| Area | Today | Evidence |
|---|---|---|
| PostHog key | The API falls back to a built-in Agenta project key when `POSTHOG_API_KEY` is unset, so `enabled` is true in every install. No setting turns it off. | `api/oss/src/utils/env.py:2013-2036` (key at `:2021-2024`) |
| PostHog client | One loader, `_load_posthog()`, serves event sends and feature flag reads (blocklists, fraud, wallets). | `api/oss/src/utils/lazy.py:52`, `api/oss/src/core/auth/helper.py:64` |
| User identity (API) | The middleware sends the user's email as the PostHog distinct id and sets it as a person property. | `api/oss/src/middlewares/analytics.py:241-255` |
| Sign-up event | `user_signed_up_v1` uses the email as the distinct id and sends `cloud_url`, the instance URL. | `api/oss/src/core/auth/supertokens/overrides.py:203-218` |
| Setup event | `oss_deployment_created` fires once on OSS when the first organization is created, keyed by the owner's email. | `api/oss/src/middlewares/analytics.py:111-135`, `api/oss/src/services/commoners.py:186` |
| User identity (browser) | OSS uses a random id kept in local storage. Cloud uses the email. Both set `email` and `username` as person properties. The setup survey event `survey sent` carries the email. | `web/packages/agenta-shared/src/analytics/index.ts:40-52`, `web/mobile/src/features/onboarding/onboardingQuestions.ts:213-234` |
| Instance secrets | `AGENTA_AUTH_KEY` and `AGENTA_CRYPT_KEY` default to `"replace-me"`, so many installs share the same value. | `api/oss/src/utils/env.py:883-884` |
| Edition setting | `AGENTA_LICENSE` (`oss` or `ee`) selects the edition. In code it is `env.agenta.license`. | `api/oss/src/utils/env.py:13`, `:864` |
| Running version | The API image has no package metadata for the API (`package = false`). The bundled Agenta SDK has the release version. | `api/pyproject.toml:77-78`, `sdks/python/pyproject.toml:3` |
| OSS image | The public API image copies only `api/oss` and `api/entrypoints`. It has no enterprise code. | `api/oss/docker/Dockerfile.gh:49-50` |
| EE images | `internal-ee-agenta-*` images on GHCR are private. The `/m` web image is shared by both editions. | GHCR package settings; EE compose files |
| Self-hosted EE plan | Each organization stores its plan in its subscription row. With no Stripe setup, a new organization gets `AGENTA_ACCESS_DEFAULT_PLAN`, else `self_hosted_enterprise`, which has every enterprise flag. Entitlement checks and the browser read the stored plan. | `api/ee/src/core/subscriptions/types.py:30-45`, `api/ee/src/core/subscriptions/service.py:346-374`, `api/ee/src/core/access/entitlements/service.py:267-307` |
| Free plan in code | `get_free_plan()` returns `cloud_v0_hobby`, a cloud plan with 2 users and monthly quotas. | `api/ee/src/core/subscriptions/settings.py:464-472` |
| Enterprise screens | `/m` hides the Access and security tab (`organization`) and the Audit log tab (`auditLog`) when the edition is not EE. On EE, `UpgradeNotice` already shows a locked state from the plan flags. | `web/packages/agenta-settings/src/navigation.ts:253-256`, `web/packages/agenta-settings-ui/src/access/UpgradeNotice.tsx` |
| Instance admins | No instance-wide admin role. `AGENTA_ACCESS_ALLOWED_OWNER_EMAILS` lists who may own an organization. | `api/oss/src/utils/env.py:162-167` |
| Scheduled jobs | The API image runs supercronic crons that call internal admin routes with `AGENTA_AUTH_KEY`. | `api/oss/docker/Dockerfile.gh:96-119`, `api/oss/src/crons/queries.sh` |
| Release list | `pnpm generate:releases` builds `changelog.json` from the docs changelog entries, keeps the last 10 versions, and bundles it into the web build. | `web/packages/agenta-navigation/scripts/build-releases.mjs`, `web/packages/agenta-navigation/src/releases/index.ts` |

How the parts fit together after the change:

```
self-hosted instance                                   Agenta
---------------------                                  ------
API start or first org --- instance_installed (id only, always) --> PostHog (open-source project)
cron, hourly           --- instance_heartbeat (12 h) -->   group type "instance"
API middleware         --- per-user events ---------->   distinct id <instance_id>:<user_id>
browser (/m)           --- product events (proxy) ---->
API, every 12 h        --- GET releases.json (no instance data) --> agenta.ai static file
License page           --- POST registration -------->   key service --> email with key + link
License page           <-- paste key / open link             (signing key kept by Agenta)
```

## Goals / Non-Goals

**Goals**

- Count self-hosted instances: installed, active, and silent.
- Know version, edition, plan, usage and top email domains per instance.
- Track activation per user without emails.
- Give operators one honest off switch, and a docs page that lists every field.
- Let an instance admin turn on enterprise features from inside the instance with a key.
- Offer a free key for an email, show enterprise screens as locked, and measure which ones people want.
- Show update, security and "What's new" notices inside the product.

**Non-Goals**

- Online license renewal or a license server.
- Floating seats between instances.
- Payment inside the product.
- Choosing the final free feature list. This change only sets the path.
- Changes to cloud analytics. Cloud keeps its own key and its email identity.

## Decisions

### 1. Where the enterprise code lives (one image or two)

An upgrade from inside the instance needs the enterprise code in the image the operator already runs. Today it is not there (see Context).

| Option | Trade-off |
|---|---|
| **A. One public API image with the enterprise code inside. The key decides the plan.** | Meets the goal. n8n and Langfuse work this way. The code is already public in the repo. Costs a build and hosting pipeline change, and cloud moves to the same image. EE-only dependencies ship to everyone. |
| B. Keep two images. The License page says to switch to the EE image. | No pipeline change. The upgrade becomes a redeploy, and we must manage registry access per customer. |

**Chosen: A**, done after the license work. Until then, every part works on today's images. Key checks and plan resolution are enterprise code and ship in the EE image. The OSS image shows the License page, the registration form and the locked screens, and its locked screens point to the upgrade path (the self-host upgrade docs and "Talk to us").

Ops for the move to one image (task group 6). It runs as its own release, after the plan order of decision 9 is live everywhere:

1. **Build:** the release pipeline builds one public API image, one services image and one runner image, each with the enterprise code inside. It keeps publishing the private EE images for one release, so a rollback is a tag change.
2. **Staging and preview:** move them to the public images first. Check that each one keeps its plan (Stripe or its internal key) and that enterprise features still work.
3. **Cloud:** move one region at a time, with a rolling deploy and no downtime. Check plans and enterprise features in the first region before the next one starts.
4. **Team dev stacks:** point the EE compose files and the Helm values at the public images.
5. **Customers on the private EE image:** tell them the new image name in the release notes. Their key keeps working, and the only change for them is the image name.
6. **Clean up:** one release later, stop publishing the private EE images and remove the EE-only build files.

### 2. How the instance id is made

| Option | Trade-off |
|---|---|
| **A. Random UUID stored in Postgres, plus `instance_kind` and the install ping.** | Simple and private. A database reset makes a new id; the install ping and the 7-day active window absorb that. |
| B. Hash of an instance secret, as n8n does. | Survives a database reset, but collides on the `"replace-me"` default and changes when the secret rotates. |

**Chosen: A.** The migration that creates the `instances` table also inserts its one row with `gen_random_uuid()`, so no container has to create the id and no start-up race exists. One database is one instance. There is no setting to override the id. The counts are installed, active and silent, and active instances split by `instance_kind` (production, development, CI).

### 3. Pseudonymous identity for users

| Option | Trade-off |
|---|---|
| **A. `<instance_id>:<user_id>`.** | No email or name in the event. The id is pseudonymous: the instance's own database can map it back to a user. Cannot match a self-hosted user with the same person on cloud. |
| B. Hash of the email. | Matches across instances and cloud. Common emails can be guessed back, so it is still personal data under GDPR. |

**Chosen: A.** Domains give the company signal. The registration email gives a real contact when the person chooses to share it. The API computes the distinct id in one place and gives it to the browser, so both always send the same id.

"Self-hosted" in this change means an instance without Stripe (`env.stripe.enabled` is false). Cloud has Stripe and keeps today's identity, key and events.

### 4. Where self-hosted telemetry goes

Today the OSS example files use one PostHog project key (the open-source project) and the EE example files another, and cloud also sends to PostHog.

| Option | Trade-off |
|---|---|
| A. One new PostHog project for all self-hosted telemetry. | Empty project to start. Old self-hosted history stays behind in the old projects. |
| **B. Reuse the existing open-source PostHog project for all self-hosted telemetry, and build new dashboards there.** | No new project to set up, and old and new self-hosted data sit in one place. New events (`instance_installed`, `instance_heartbeat`) and the new user id live next to the old email-keyed events, so each dashboard filters on the new events or on a start date. |

**Chosen: B.** The data shape changes over time anyway, and separate dashboards in one project handle that. Cloud keeps its own project.

### 5. How the heartbeat runs

| Option | Trade-off |
|---|---|
| **A. `telemetry.sh` in the existing cron, hourly, calling an internal route that sends when 12 hours have passed.** | Follows the existing cron pattern. Keeps work off request paths. |
| B. Inline on API requests, as Langfuse does. | No cron change. Adds work and failure modes to request paths. |

**Chosen: A.** The route opens one transaction, locks the `instances` row with `FOR UPDATE SKIP LOCKED` when `heartbeat_sent_at` is null or older than 12 hours, sends the event synchronously with a short timeout, then sets `heartbeat_sent_at` and commits. Another container skips the locked row. A failed send, or a process that stops, rolls the transaction back, so nothing needs to be restored. The event carries a fixed `uuid` made from the instance id and the window start, so PostHog drops the copy when a send succeeded but the commit failed. The install ping works the same way on `installed_event_sent_at`. Known limit: if PostHog accepts a heartbeat and the commit then fails, the retry an hour later has the same `uuid` and is dropped, so up to one hour of counts is lost. That case needs a database failure in the same second, and the counts are trend data, so we accept it.

The heartbeat carries only totals and window counts that PostHog cannot compute. Active users and new sign-ups come from the per-user events, which flow whenever the heartbeat flows.

### 6. Where the release feed lives

`/m` already has a "What's new" dialog and a help-menu release list. Both read `changelog.json`, which `pnpm generate:releases` builds and bundles into the web build. A bundled list cannot show releases newer than the running build.

| Option | Trade-off |
|---|---|
| **A. Publish that same generated list as a static file, `https://agenta.ai/releases.json`, from the marketing website build. Cloud and self-hosted read it through one instance API route, and the browser merges it with the bundled list.** | No second changelog and no second UI: the existing dialog and menu gain newer releases. One code path for cloud and self-hosted. No worker code. |
| B. The website worker serves the feed and records each check with the instance id. | Gives a count of instances with telemetry off. Sends instance data with the switch off, which the off switch promises not to do. |
| C. A separate update system for self-hosted only. | Free to design. Two systems to keep in step with cloud. |

**Chosen: A.** The feed request carries no instance id and no version. The website build publishes the file after the release merges to `main`, which is after the production deploy, so cloud is never behind the feed.

### 7. Licensed instances and the off switch

| Option | Trade-off |
|---|---|
| **A. A paid key ignores the switch. The registration key does not. A key field `telemetry: "exempt"` covers air-gapped contracts.** | Matches Langfuse. Must be stated in the docs and the license terms. |
| B. Every instance follows the switch. | Simplest. We lose usage data from paying customers. |

**Chosen: A.** A paid key is any valid key whose `plan` is not `self_hosted_registered`.

### 8. Who may add a license key

There is no instance-wide admin role today. This change names one: the **instance admin**.

| Option | Trade-off |
|---|---|
| A. The owner of the first organization. | No new setting. Wrong when that person left. |
| **B. Any email on `AGENTA_ACCESS_ALLOWED_OWNER_EMAILS`, or the owner of the oldest organization when the list is unset.** | Uses a setting operators already know. |

**Chosen: B.** Only an instance admin sees the License page, adds a key, or registers the instance. "Owner" in this change means only the organization role.

### 9. Installs without a key

The EE images are private, and no customer runs one without a key. The only keyless EE installs are Agenta's own: cloud, staging, preview, and the team's dev stacks.

| Option | Trade-off |
|---|---|
| A. Keep `self_hosted_enterprise` as the keyless default and show a notice. | Nothing changes for our own stacks. With one public image (decision 1), anyone gets every enterprise feature without a key. |
| **B. No key means the community plan, on every self-hosted install. Our own deployments get what they need through the ops steps below.** | One simple rule and no hole in the public image. Every one of our deployments needs a check before the release. |

**Chosen: B.** The new plan `self_hosted_community` is the plan of a self-hosted install with no valid key. It has no enterprise flags and no seat or usage limits, like the OSS edition today. It is not `get_free_plan()`, which stays the cloud free plan.

The plan of every organization on the instance, in order:

1. Stripe set up (cloud): the subscription plan, as today. `AGENTA_ACCESS_DEFAULT_PLAN` keeps working here.
2. A valid license key: the key's plan.
3. No valid key: `self_hosted_community`.

Steps 2 and 3 come from one resolver, `instance_plan()`, that reads the active key (cached under one key, cleared when a key is added, with expiry checked on every call). Without Stripe, both `SubscriptionsService.read` and the entitlement reader take the plan from it instead of the stored row and the per-organization cache, so entitlement checks, the billing routes and the browser all see the same plan at once, and stored subscription rows need no migration. `AGENTA_ACCESS_DEFAULT_PLAN` cannot raise a self-hosted install, and env plan overrides (`AGENTA_ACCESS_PLANS`, `AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY`) cannot turn on the five enterprise flags of `self_hosted_community` or `self_hosted_registered`. The OSS image has no plan table and reports `self_hosted_community`.

Ops for Agenta's own deployments (task 3.6):

- **Cloud:** Stripe is set up, so step 1 applies and nothing changes. Check before the release that every cloud region resolves plans through Stripe.
- **Staging and preview:** check each one. Where Stripe is not set up, give it an internal license key through its secret store.
- **Team dev stacks:** an internal development key, set as `AGENTA_LICENSE_KEY` in the dev env files that are not committed. Their public URL is often not `localhost`, so dashboards leave them out by the internal key's `license_key_id`.

### 10. How we choose the free features

| Option | Trade-off |
|---|---|
| A. Pick a short starting list now and change it after 30 days of data. | Something to offer at launch. A guess we may need to undo. |
| **B. Choose nothing now. Ship the registration and the key system, with the registered plan unlocking nothing extra at first.** | No guess to undo. We collect emails and demand data from day one. The offer cannot promise features yet, only product updates and future free features. |

**Chosen: B.** `self_hosted_registered` starts with the same entitlements as `self_hosted_community`. When we decide, one release adds features to it in the plan table, and every instance that already registered gets them with the key it has. The `upgrade_prompt_viewed` and `upgrade_prompt_clicked` events tell us which locked screens people want.

Registration works on the OSS image too, so we collect emails now. The key it sends works once the instance runs the enterprise code (the EE image today, the one image after group 6).

## Names

One name per concept, in every layer.

| Concept | Name |
|---|---|
| The installation (one database) | instance; table `instances`; PostHog group type `instance` |
| Its random id | `instance_id` (column `instances.id`) |
| Kind of instance | `instance_kind`: `production`, `development`, `ci` |
| Edition | `edition`: `oss`, `ee`. Read from `env.agenta.license` in one helper. `AGENTA_LICENSE` keeps its shipped name and means the edition, not a key. |
| Plan | the resolved plan slug: `self_hosted_community`, `self_hosted_registered`, `self_hosted_enterprise`, or a cloud slug |
| Person who manages the key | instance admin (UI: "Instance admin") |
| Signed key | license key; setting `AGENTA_LICENSE_KEY` (`env.license.key`); table `licenses` (EE) |
| Free key | registration key: a license key with `plan: "self_hosted_registered"` |
| Request for it | registration (route `/instance/license/registrations`) |
| One-time event | install ping, event `instance_installed` (replaces `oss_deployment_created`) |
| 12-hour event | heartbeat, event `instance_heartbeat`. In code, "telemetry heartbeat" (`core/telemetry/heartbeat.py`), because `utils/heartbeat.py` and `AGENTA_HEARTBEAT_FILE` already name a liveness file |
| Feed download | update check, setting `AGENTA_UPDATE_CHECK_ENABLED` |
| Published release list | release feed, `https://agenta.ai/releases.json` |
| Feed messages | notices (`notices` in the feed) |
| Enterprise feature | the `Flag` value: `access`, `audit`, `domains`, `rbac`, `sso` |

New API routes (all under `/instance` for the user, one folder per domain in code):

| Route | Purpose | Who |
|---|---|---|
| `GET /instance/telemetry` | Whether the browser sends events, and the distinct id and groups to use | Signed-in user |
| `GET /instance/license` | Plan, key details, seats used, key source | Instance admin |
| `PUT /instance/license` | Add or replace the key (EE image only) | Instance admin |
| `POST /instance/license/registrations` | Ask Agenta for a registration key | Instance admin |
| `GET /instance/releases` | Cached release feed and the running version | Signed-in user |
| `POST /admin/telemetry/heartbeat` | Cron trigger for the heartbeat | `Access AGENTA_AUTH_KEY` |

Exact fields, files and owners are in the implementers' contracts file.

## Risks / Trade-offs

- **Trust.** The install ping and the update check run with telemetry off. The docs page and the startup log must say so, or it reads as hidden tracking. The update check sends no instance data, and the install ping sends only the id.
- **Key leak.** A leaked signing key lets anyone mint keys. Keep it in Agenta's secret store. Each key carries `key_id` so a later release can refuse it.
- **Plan change on Agenta's own EE stacks.** Without the ops checks in decision 9, a keyless staging or dev stack drops to `self_hosted_community` and loses enterprise screens.

## Migration

1. A migration in the shared OSS chain creates the `instances` table and inserts its one row. Existing instances get an id when they upgrade, and send the install ping once at the next start because they already have an organization.
2. A migration in the EE chain creates the `licenses` table.
3. Hosting templates set `AGENTA_DEPLOYMENT_METHOD` and document the switch.
4. Before the release that ships the plan order, run the ops checks in decision 9 for cloud, staging, preview and the team dev stacks.
5. The single image ships as its own release after the license work. The ops steps in decision 1 give the order: build, staging and preview, cloud one region at a time, team dev stacks, customers, clean up.
