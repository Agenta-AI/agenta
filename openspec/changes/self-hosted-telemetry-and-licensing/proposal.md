# Proposal

## Why

When a team self-hosts Agenta, we learn almost nothing about it. We cannot count running instances, see which version they run, or see how much they use. When a team wants enterprise features, nothing inside the product lets them upgrade. At the same time, the telemetry we do send is not honest: the API always sends events to Agenta's PostHog project, keyed by the user's email, and no setting turns it off.

The research behind this change (how Langfuse and n8n do it, and what Agenta does today) is in [research.md](research.md). Each decision lists its options in [design.md](design.md).

## What Changes

When this change is done, these thirteen things are true.

1. **Upgrade from inside the instance.** An instance admin pastes a license key on a License page in settings, or opens a link that carries the key, and enterprise features turn on without a reinstall.
2. **Free registered tier.** An instance admin can enter an email (product updates opt-in), register the instance and get a free key. At first the key unlocks nothing extra. It is there so that a later release can turn on free features for everyone who registered (point 13).
3. **Locked enterprise screens.** Enterprise screens (Access and security, with SSO and domain verification, and Audit log) are visible on every self-hosted instance. Without the right plan they show an empty state that explains the feature and offers the steps that apply: "Get a free key", "Add a license key" (EE image), "How to upgrade" (OSS image) or "Talk to us".
4. **Heartbeat.** Each instance sends one report every 12 hours with its version, edition, plan and usage counts. In PostHog each instance is a group, so we can chart instances and filter every user event by instance.
5. **Instance count.** Each instance has a stable random id stored in its database. We count active instances (a heartbeat in the last 7 days) and all instances ever installed (point 11).
6. **Email domains.** The heartbeat carries the top 100 email domains on the instance, with a user count for each. It never carries an email address.
7. **Anonymous activation per user.** Per-user product events from self-hosted instances use `<instance_id>:<user_id>` as the identity, never the email. The user id is the database id, so it stays the same when the email changes or the user signs in from another device. Activation flags keep working on that identity.
8. **No opt-out for licensed instances.** An instance with a paid license key sends telemetry whatever the switch says. A key can carry a contract exception for air-gapped customers.
9. **Update and upgrade notices.** We reuse the "What's new" dialog, the help-menu release list and the generated changelog that `/m` already has. The same generated list is also published as a static feed file. Cloud and self-hosted read it through the same API route, so a self-hosted instance that is behind sees the newer releases, an "update available" marker, a warning that stays for security releases, and notices we target by edition, plan or version.
10. **A real off switch.** One setting, `AGENTA_TELEMETRY_ENABLED=false`, stops every PostHog event from the API and the browser except the install ping. The built-in PostHog key stays in the API, so every instance can still send the install ping.
11. **Install ping that always runs.** Once an instance has its first organization, the instance sends one event whose only data is its stable random id. No URL, IP address, version or other detail is sent or stored. It goes to PostHog with the built-in key, like every other event, and it is the one event the off switch does not stop. It replaces today's `oss_deployment_created`. In PostHog, the number of instance ids with this event is the lowest number of instances that exist, and the ids with no other event are the anonymous ones. The docs say so.
12. **A docs page that lists every field.** One self-hosting page lists every event and every field we collect, what is always sent, and how to turn the rest off. A test keeps the page and the code in step.
13. **A path for the free features.** We choose no free features now. The registered plan is a plan name in the key, and its features live in the existing plan table, starting with the same features as the community plan, the plan of an instance with no key. Later, one release can add features to it, chosen from data on which locked screens people open and click.

## Capabilities

### New Capabilities

- `instance-identity`: the instance id, how it is created and stored, and how we count instances.
- `instance-telemetry`: the switch, the install ping, the heartbeat, user domains, anonymous per-user events, the licensed-instance rule, PostHog groups, and the docs page.
- `instance-license`: license keys, the instance admin, the License page, activation links, the registration key, the community and registered plans, expiry and offline checks.
- `enterprise-upgrade-surfaces`: locked enterprise screens, upgrade buttons, and the offer after the setup survey.
- `instance-update-notices`: the release feed, update and security notices, "What's new", and targeted notices.

### Modified Capabilities

None as OpenSpec specs. In code, this changes the PostHog config, the analytics middleware, the setup survey follow-up, and how the plan is picked on self-hosted instances.

## Impact

- **API:** `api/oss/src/utils/env.py` (new settings; the built-in PostHog key stays), `api/oss/src/middlewares/analytics.py` (identity), a new `instances` table, a telemetry module and cron job, an EE license module and `licenses` table, the `/instance/*` routes, and plan resolution in `api/ee/src/core/subscriptions/service.py`.
- **Images:** design decision 1 (one image or two). Upgrading from the instance needs the enterprise code inside the image the operator runs. Today the OSS API image has no `api/ee` code, and the EE images are private. This change works on today's images; the move to one image is a later release.
- **Frontend (`/m`):** a License page, locked states for enterprise settings tabs, the offer after the survey, update notices, and the browser following the same switch.
- **Hosting:** compose, Helm and Railway templates set a deployment method value and document the switch.
- **Agenta-side services:** an endpoint that issues registration keys by email, a signing key we keep private, and a static release feed file on the website.
- **Docs:** a new telemetry page, a license page, and a fix to the privacy page, which today says "anonymized analytics".

## Out of Scope

- Online license renewal and usage reporting through a license server, as n8n does. The signed key with an expiry date covers v1.
- Floating seats that move between instances.
- Payment inside the product. "Talk to us" and the pricing page stay the paid path.
- Choosing the free-tier features (point 13 sets only the path).
- Cloud analytics. Cloud keeps its own PostHog key and its email identity.
