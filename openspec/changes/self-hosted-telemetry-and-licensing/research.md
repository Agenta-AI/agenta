# Research

Gathered on 2026-11-07 and 2026-11-08. Clones and saved doc pages are on the dev box under `~/agenta-research-telemetry/` (Langfuse at `b9529a93`, n8n at `3895cb31de`). Agenta findings come from `origin/main` at `aa9a7354ca`.

## Agenta today

- The API PostHog key falls back to Agenta's project key when `POSTHOG_API_KEY` is unset or empty (`api/oss/src/utils/env.py`, `PostHogConfig`), so API analytics cannot be turned off.
- The analytics middleware uses the user's email as the distinct id (`api/oss/src/middlewares/analytics.py`). `user_signed_up_v1` sends the instance URL. `oss_deployment_created` fires once per OSS instance.
- The browser has no fallback key; an empty key turns it off. Autocapture is on by default.
- The example env files and Helm values ship Agenta's keys. No self-hosting page describes telemetry. The privacy page says "anonymized analytics".
- No instance id, no heartbeat, no license key. EE without Stripe gets `self_hosted_enterprise` with every enterprise flag.
- The OSS API image has no `api/ee` code; the EE images are private on GHCR. The `/m` image is shared and checks the edition at runtime.
- The setup survey asks role, company size and referral source; answers go only to PostHog.

## Langfuse

- One `telemetry` event at most every 12 hours, scheduled through a `cron_jobs` row and a table lock, triggered from public API requests.
- Random UUID instance id stored in that row; PostHog id `docker:<uuid>`.
- Payload: version, project count, deltas of traces, observations, scores, datasets and more, top 30 email domains, and the full license key.
- `TELEMETRY_ENABLED=false` works only without a license key.
- License check is a key prefix (`langfuse_ee_`, `langfuse_pro_`, `lf_gov_`); no signature.
- Update check: the server calls `langfuse.com/api/latest-releases?version=...`; the sidebar shows a dot.
- No browser analytics in self-hosted builds; newsletter opt-in in onboarding.

## n8n

- RudderStack and PostHog, both through proxy routes on the instance. `N8N_DIAGNOSTICS_ENABLED=false` stops all of it and the survey.
- Instance id is a SHA-256 of part of the encryption key; users are `<instanceId>#<userId>`; a fake IP on every event.
- "Instance started" at boot; "pulse" every 6 hours; execution counts buffered.
- Setup: owner form with updates checkbox, a survey that cannot be closed (company type, industry, role, goals, size, source), then "Get paid features for free (forever)": email in, key by email, link with `?key=` activates it. The answers do not change which offer is shown.
- License SDK: activation against `license.n8n.io`, signed certificate checked offline, renewal every 15 minutes near expiry with usage counts, fallback to Community after expiry, `@Licensed('feat:...')` on routes.
- Version notices: the browser calls `api.n8n.io/api/versions/<version>` with an instance id header. A release with `hasSecurityIssue` shows a "Critical update available" toast that stays. A "What's new" feed comes from `api.n8n.io/api/whats-new`. Settings: `N8N_VERSION_NOTIFICATIONS_ENABLED` and related endpoint settings.
