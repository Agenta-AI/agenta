# Starter-credits operations audit

Status date: 2026-08-24

This is the operator checklist for deploying and running the starter-credits bridge. It combines
the application contract, the cloud proxy runbook, the release handoff, and the QA handoff in one
place. It records names, ownership, order, and evidence. It never records secret values.

The central operational fact is simple: this is not a nine-variable deployment. Each EE
environment needs:

- the normal platform security configuration;
- thirteen values that are known before the first proxy deploy;
- one team id that can only be created after the proxy is healthy;
- a database, a dedicated provider identity and quota, a PostHog policy, an alert destination,
  and, in host mode, DNS and certificate coverage;
- wire-level, browser, spend, failure, and kill-switch QA after the final deploy.

If any of these groups is missing, the environment is not ready. A deploy script should report
the complete missing or invalid set at once rather than making the operator discover one item per
deployment attempt.

## Sources of truth

| Concern                                                               | Source                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Application behavior and `AGENTA_STARTER_CREDITS_BRIDGE_*` names      | This directory and `api/oss/src/utils/env.py`                                        |
| Cloud proxy compose, secret isolation, deployment checks, and runbook | `Agenta-AI/agenta_cloud`, `docs/designs/litellm-proxy.md`                            |
| Release and QA requirements                                           | The approved operator-local release handoff and `.agents/skills/agent-release-gate/` |
| Real secret values                                                    | The environment's secret store only                                                  |
| PostHog policy values                                                 | The environment's PostHog project only                                               |
| Current release evidence                                              | The local release-conductor run directory, not this document                         |

When these disagree, stop. Reconcile the implementation and this audit before deploying. In
particular, the public application repository currently does not ship the local LiteLLM compose
profile claimed by an older cloud design note. Local end-to-end QA uses the operator-managed stack
under `~/.agenta-starter-litellm/` and a local compose override. That setup works, but it is not yet
reproducible from tracked files alone.

## Environments in scope

| Environment                     | Edition | Proxy expected                         | Default routing                       | Current audit state                                                                 |
| ------------------------------- | ------- | -------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------- |
| Local EE development            | EE      | Yes, for feature QA                    | Path mode through an HTTPS tunnel     | Functional, but the proxy topology is local-only and not reproducible from the repo |
| Preview testing                 | EE      | Yes after the cloud proxy change lands | Decide and record before provisioning | Not audited. Treat every bridge prerequisite as unverified                          |
| Preview demo                    | EE      | Yes after the cloud proxy change lands | Decide and record before provisioning | Not audited. Treat every bridge prerequisite as unverified                          |
| Preview staging                 | EE      | Yes                                    | Host mode is the intended hardening   | Partially provisioned; see the dated snapshot below                                 |
| Cloud live, EU                  | EE      | Yes before a live rollout              | Host mode                             | Not audited and not authorized for deployment                                       |
| Cloud live, US                  | EE      | Yes before a live rollout              | Host mode                             | Not audited and not authorized for deployment                                       |
| OSS preview and self-hosted OSS | OSS     | No                                     | Not applicable                        | Bridge stays disabled; the release's internal service key is still required         |

The cloud deployment script treats every non-OSS stage as EE. Once the proxy change is merged,
testing, demo, staging, and live deploys all enter the LiteLLM preflight. They therefore need an
intentional configuration even when seeding is initially disabled.

## Complete environment contract

### Existing platform security values

These are not bridge-specific, but release 0.114 depends on them and the handoff requires them to
be audited in every environment.

| Variable                       | Requirement                                                                                          | Distribution                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `AGENTA_AUTH_KEY`              | Non-empty, non-placeholder platform auth key                                                         | Services that already require platform auth                                       |
| `AGENTA_CRYPT_KEY`             | Non-empty, non-placeholder encryption key. Never rotate casually because stored secrets depend on it | API secret-handling path only                                                     |
| `AGENTA_SERVICES_INTERNAL_KEY` | Non-empty, non-placeholder proof shared by API and services. The two values must match               | API and services only. Never web, runner, workers, cron, migrations, or sandboxes |
| `AGENTA_RUNNER_TOKEN`          | Non-empty, non-placeholder runner authentication key                                                 | Services and runner according to the existing contract                            |
| `SUPERTOKENS_API_KEY`          | Valid key for the environment's SuperTokens deployment                                               | API and SuperTokens integration only                                              |

The startup validator work should report all invalid security keys together and point at the
standard key-generation command. Local quickstarts may generate missing values into a gitignored
overlay, but they must never rewrite a tracked example or rotate an existing crypt key.

Supporting runtime values also need an environment-by-environment check:

| Variable or group                                                                   | Requirement                                                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `POSTHOG_API_KEY`                                                                   | Use the intended project token. A token for another or nonexistent project makes the policy unavailable |
| `AGENTA_SERVICES_ALLOWED_ORIGINS`                                                   | Include the environment's real web origins so agent streaming is not rejected by services               |
| `AGENTA_RUNNER_DAYTONA_API_KEY` and related URL, target, snapshot or image settings | Configure the runner's Daytona path independently from the code evaluator's `DAYTONA_*` settings        |
| `AGENTA_BASE`, `AGENTA_PROJECT_ID`, `AGENTA_API_KEY`                                | Supply the three target-specific inputs required by the wire-level release gate                         |
| Provider QA keys                                                                    | Keep them in operator-only files for local/provider cells. Never place them in cloud sandboxes          |

The runner's Daytona key needs `manage:secrets`. The API may use a separate Daytona key, but its
scope and owner must be recorded rather than inferred from the runner configuration.

### Phase A: values known before the first proxy deploy

Set every row before dispatching the first EE deployment. `ENABLED` must be explicitly false until
the proxy team and PostHog policy have been verified.

| Variable                                            | Role                                               | Required value shape                                                                    | Secret and distribution                      |
| --------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------- |
| `AGENTA_STARTER_CREDITS_BRIDGE_ENABLED`             | Durable seeding switch                             | Boolean; `false` for the first deploy                                                   | Non-secret; API                              |
| `AGENTA_STARTER_CREDITS_BRIDGE_PROXY_PUBLIC_URL`    | Public inference base stored in seeded connections | Absolute HTTPS URL matching the selected routing mode                                   | Non-secret; API                              |
| `AGENTA_STARTER_CREDITS_BRIDGE_PROXY_ADMIN_URL`     | Private mint, team, and block base                 | Internal HTTP URL for the proxy service                                                 | Non-secret; API                              |
| `AGENTA_STARTER_CREDITS_BRIDGE_MASTER_KEY`          | Proxy administrator credential                     | Non-empty and valid for the pinned proxy version                                        | Secret; API and proxy only                   |
| `AGENTA_STARTER_CREDITS_BRIDGE_MODEL_ID`            | The one funded model and pricing route             | Full LiteLLM route id                                                                   | Non-secret; API and proxy                    |
| `AGENTA_STARTER_CREDITS_BRIDGE_PROGRAM_CEILING_USD` | Team ceiling and proxy-wide backstop               | Positive plain number with no currency symbol                                           | Sensitive policy; deploy and proxy           |
| `AGENTA_STARTER_CREDITS_BRIDGE_POLICY_FLAG`         | PostHog flag carrying mint policy                  | Existing flag name for the correct PostHog project                                      | Non-secret; API                              |
| `AGENTA_STARTER_CREDITS_BRIDGE_ALERT_WEBHOOK`       | Refusal, failure, and budget alert destination     | Valid webhook accepted by the operator's alert sink                                     | Secret URL; API and proxy alerting only      |
| `POSTGRES_URI_LITELLM`                              | Persistent proxy ledger and auth database          | Plain `postgresql://` URI for the dedicated database and role                           | Secret; proxy only                           |
| `LITELLM_SALT_KEY`                                  | Stable encryption salt used by the proxy           | Non-empty, environment-specific, and never rotated after keys exist                     | Secret; proxy only                           |
| `LITELLM_VERTEX_SA_JSON_B64`                        | Dedicated upstream provider identity               | Single-line base64 of valid service-account JSON                                        | Secret; decoded file mounted into proxy only |
| `LITELLM_VERTEX_PROJECT`                            | Provider project used by the funded model          | Project identifier that matches the service account and quota                           | Sensitive identifier; proxy only             |
| `LITELLM_VERTEX_LOCATION`                           | Provider region                                    | Explicit supported location; do not rely on an implicit default in managed environments | Non-secret; proxy only                       |

Routing adds one optional variable:

| Variable                                     | Empty                                  | Set                                       |
| -------------------------------------------- | -------------------------------------- | ----------------------------------------- |
| `AGENTA_STARTER_CREDITS_BRIDGE_GATEWAY_HOST` | Path mode on the stage's existing host | Host mode on a dedicated gateway hostname |

The public URL must match the routing choice. Path mode uses the configured prefix on the stage
host. Host mode uses the dedicated gateway host without that prefix. A mismatch is a customer-facing
404 and must be rejected by preflight.

### Phase B: value created after the proxy exists

`AGENTA_STARTER_CREDITS_BRIDGE_TEAM_ID` cannot exist before the first successful proxy deploy.
Deploy once with seeding disabled and the team id empty. Then create exactly one program team by
calling the private admin API from the stage network:

- set its `max_budget` to the same source value as
  `AGENTA_STARTER_CREDITS_BRIDGE_PROGRAM_CEILING_USD`;
- omit `budget_duration`, so the ceiling never resets;
- store the returned id as `AGENTA_STARTER_CREDITS_BRIDGE_TEAM_ID`;
- read the team back and verify both fields before enabling seeding.

Never create a second team as a recovery shortcut. Two teams split spend across two ceilings and
silently double the intended exposure.

### Phase C: PostHog policy

Before seeding is enabled, the configured PostHog project must contain the policy flag with exactly
these nine payload fields:

```text
global_daily
global_hourly
work_domain_daily
freemail_domains
block_digit_locals
grant_usd
key_max_parallel_requests
key_rpm_limit
key_tpm_limit
```

Unknown or malformed fields fail closed. Record the real values only in PostHog, not in this repo.
The cloud environment must use its own configured PostHog project token. An absent operator token
in local development selects the built-in development policy, so local QA must record whether it
tested the real flag or that fallback.

The payload is the fastest live kill switch. Disabling the flag or removing its payload stops new
grants without a deploy. It does not stop already minted keys from spending.

## Non-environment prerequisites

Environment variables are necessary but not sufficient. Every EE environment needs the following
external setup and evidence.

| Area                   | Required operation                                                                                                                                       | Evidence to retain                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Database               | Create one persistent `agenta_<stage>_litellm` database and a dedicated least-privilege owner. Keep it outside application blue/green database switching | Sanitized role/ownership check and successful proxy readiness with `db: connected` |
| Provider identity      | Create a service account used only by this proxy with prediction-only IAM or narrower                                                                    | Sanitized identity and IAM review                                                  |
| Provider quota         | Apply a provider-side quota that bounds exposure even if the proxy ledger is wrong                                                                       | Quota name, limit, region, and owner without credential material                   |
| Routing                | Choose path or host mode. In host mode, add the gateway DNS alias and certificate coverage before setting the public URL                                 | DNS resolution, certificate validation, and rendered Traefik rule                  |
| Public surface         | Publish only the three required inference/model paths. Keep all admin routes private                                                                     | Positive inference/model probes and negative admin-route probes                    |
| Response hygiene       | Strip every enumerated `x-litellm-*` response header                                                                                                     | Captured response headers after the final deploy                                   |
| Proxy safety           | Keep the proxy pinned, single-instance, database-fail-closed, and configured with proxy-side mint upper bounds and explicit pricing                      | Image digest, rendered config, DB-down refusal, and mint-limit probes              |
| Alerting               | Point the webhook at a channel someone reads and trigger a test delivery                                                                                 | Dated delivered alert                                                              |
| Observability          | Retain spend logs and team rollups; reconcile them with provider billing. The proxy metrics endpoint is not currently scraped                            | One request linked across run, spend log, team total, and provider record          |
| Daytona                | Give the runner's Daytona credential `manage:secrets`. Never place provider credentials in the sandbox                                                   | Capability check and P3 gate result                                                |
| Application migrations | Check OSS and EE Alembic heads and run the normal release migration sequence                                                                             | Migration workflow URL and head check                                              |
| Stage hardening        | Resolve the staging health-check fail-open finding and review unnecessary SSH exposure before treating staging as production-like                        | Separate infrastructure change and a fresh verification                            |
| Credential lifecycle   | Close the database credential-lifecycle follow-up recorded in the private staging provisioning report before live deployment                             | Private operator ticket or change reference only                                   |

The LiteLLM proxy database does not use the application's migration or database-switch flow. A
migration-only application deployment can still exercise proxy preflight, but it must not create or
rename the proxy database.

## Environment audit worksheet

Use this table as the release dashboard. “Unverified” means exactly that; it does not mean the
value is absent.

| Environment     | Platform keys                                                            | Phase A values                                | DB                              | Provider identity and quota                                            | Routing                               | Team                        | PostHog                                                         | Alerts         | QA                                                                      | Authorization                                                   |
| --------------- | ------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------- | ------------------------------------- | --------------------------- | --------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| Local EE        | Configured for current dev stack                                         | Configured in gitignored local files          | Local proxy DB                  | Dedicated local QA identity; quota evidence not recorded here          | HTTPS tunnel, path mode               | Created                     | Real flag and development fallback have both been exercised     | Local sink     | P2/P2b and starter chat green; P3 and browser matrix tracked separately | Local QA allowed                                                |
| Preview testing | Unverified                                                               | Unverified                                    | Unverified                      | Unverified                                                             | Undecided                             | Missing or unverified       | Unverified                                                      | Unverified     | Not run                                                                 | No deploy approval recorded here                                |
| Preview demo    | Unverified                                                               | Unverified                                    | Unverified                      | Unverified                                                             | Undecided                             | Missing or unverified       | Unverified                                                      | Unverified     | Not run                                                                 | No deploy approval recorded here                                |
| Preview staging | Internal key and existing platform keys passed earlier deployment checks | Partial; see snapshot below                   | Provisioned                     | Credential exists locally, but stage secret and quota are not verified | Host-mode infrastructure not verified | Not created or not verified | Flag exists; stage token and payload still require verification | Unverified     | Blocked before proxy deployment                                         | Staging deployment explicitly approved                          |
| Cloud live EU   | Unverified                                                               | Unverified                                    | Not provisioned or not verified | Unverified                                                             | Host mode required                    | Missing                     | Policy exists but environment binding is unverified             | Unverified     | Not run                                                                 | Production deployment forbidden without a new explicit approval |
| Cloud live US   | Unverified                                                               | Unverified                                    | Not provisioned or not verified | Unverified                                                             | Host mode required                    | Missing                     | Policy exists but environment binding is unverified             | Unverified     | Not run                                                                 | Production deployment forbidden without a new explicit approval |
| OSS preview     | Internal key required                                                    | Bridge variables absent or disabled by design | Not applicable                  | Not applicable                                                         | Not applicable                        | Not applicable              | Not applicable                                                  | Not applicable | OSS acceptance and release gate still required                          | Preview QA only                                                 |

### Staging snapshot on 2026-08-24

Two migration-only deployment attempts stopped in preflight before migrations or compute rollout:

1. The first attempt reported a missing `LITELLM_SALT_KEY`.
2. After the salt was populated, the second attempt reached and reported a missing
   `LITELLM_VERTEX_SA_JSON_B64`.

The existing stage remained healthy after both refusals. The dedicated database had already been
provisioned. A valid dedicated service-account JSON exists in the local operator store, but the
credential itself must never be copied into this document, a PR, chat, or a sandbox.

Because the current preflight exits on the first missing variable, values after the service-account
check remain unverified. The correct next step is to run a complete, non-printing audit of all rows,
populate the full missing set, and dispatch once. Do not continue discovering them through failed
deployments.

## Operator files and QA tools

These are local pointers, not alternate secret stores. Keep secret-bearing files mode 600 and the
LiteLLM operations directory mode 700. Load values without printing them.

| Purpose                                                  | Operator location or tool                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Local EE application values                              | `hosting/docker-compose/ee/.env.ee.dev.local`                                        |
| Local runner and harness overrides                       | Gitignored EE compose override files beside the dev env                              |
| Local LiteLLM proxy, configuration, and credential files | `~/.agenta-starter-litellm/`                                                         |
| Staging release-gate target                              | `~/.agenta-staging.env`                                                              |
| OSS preview release-gate target                          | `~/.agenta-oss-preview.env`                                                          |
| Provider-key QA cells                                    | `~/.agenta-qa-openai.env` and `~/.agenta-qa-secrets.env`                             |
| Disposable signup mail                                   | `~/.agenta-testmail.env`                                                             |
| PostHog operator access                                  | `~/.posthog.env`                                                                     |
| Observability operator access                            | `~/.newrelic.env`                                                                    |
| Browser QA                                               | Chrome DevTools MCP server with a headless, isolated profile                         |
| Wire-level QA                                            | `.agents/skills/agent-release-gate/`                                                 |
| Release protocol                                         | Local release-conductor run under `.claude/skills/release-conductor/runs/<version>/` |

The release conductor orchestrates workflows, evidence, and approvals. It does not replace the
release gate or browser QA. Its hard rules for this release are: no production deployment, one
deployment per stage at a time, explicit approval per dispatch, and invalidation of QA evidence
after any redeploy.

## Deployment sequence for one EE environment

1. Audit the existing platform security keys and their container distribution.
2. Provision the dedicated database, provider identity, provider quota, alert destination, and
   routing prerequisites.
3. Populate all Phase A values, with seeding explicitly disabled and the team id empty.
4. Run a non-printing preflight that reports every missing or invalid item together. Render compose
   and assert that secrets reach only their intended containers.
5. Deploy the proxy. Require readiness to report `db: connected` before continuing.
6. Create the one program team, store its id, and read it back.
7. Create and validate the strict nine-field PostHog payload in the correct project.
8. Redeploy with the team id present and seeding still disabled. Re-run routing, admin-surface,
   header-stripping, fail-closed, pricing, and mint-bound checks.
9. Enable the environment switch and the PostHog flag, then deploy the API.
10. Run the full QA matrix below against this exact deployment.
11. Rehearse every kill switch, restore the intended state, and rerun the affected smoke tests.
12. Record the workflow, commit SHA, environment, evidence paths, decisions, and rollback steps.

One deployment per stage may run at a time. QA evidence expires whenever that stage is redeployed.
Approval is per dispatch. The current authorization covers staging only and does not authorize a
production workflow.

## Required QA after the final deploy

### Wire-level release gate

The portable gate is `.agents/skills/agent-release-gate/resources/qa_product.py`. It drives the
same `/services/agent/v0/invoke` endpoint as the playground and asserts on SSE frames and real side
effects, not model prose.

Run and retain:

- P2: Pi, local sandbox;
- P2b: provider-set/custom-connection model selection;
- P3: Pi on Daytona, including opaque secret delivery;
- fresh signup through the seeded managed connection;
- warm and cold restart, mounts, tools, approval and deny, commit, MCP, and permission rules that
  the release gate covers.

The gate needs only `AGENTA_BASE`, `AGENTA_PROJECT_ID`, and `AGENTA_API_KEY` for the target. The
operator files named in the handoff are `~/.agenta-staging.env` and
`~/.agenta-oss-preview.env`; provider QA keys live separately. Never load provider credentials into
a Daytona sandbox.

### Browser QA

Use an isolated Chrome profile through the Chrome DevTools MCP server. Verify:

- a fresh signup sees the managed “Agenta” connection and funded model in the model picker;
- the managed connection stays hidden from the ordinary provider drawer and settings;
- “Test” and “Refresh models” work for an ordinary write-only user connection without exposing its
  stored value;
- exhaustion, paused, and unavailable states show the correct recovery action;
- a successful funded run appears in observability with a non-zero cost;
- the click paths produce the expected network requests and no browser console regression.

Screenshots are evidence. A short Playwright recording is preferred when the release needs a video.
The isolated browser profile is disposable and must not use the owner's everyday session.

### Spend and security QA

For one fresh funded run, connect all of these records:

- organization id and seeded vault row;
- runner session and trace id;
- proxy key alias and spend log;
- program-team rollup;
- provider-side usage or billing record.

Also verify:

- public inference and model-list paths work with a minted key;
- public admin paths do not route;
- no `x-litellm-*` response header escapes;
- the proxy refuses when its database is unavailable;
- over-limit mint requests are rejected and omitted limits receive safe defaults;
- a blocked key fails and an unblocked key works;
- disabling the PostHog flag stops new grants without a deploy;
- `ENABLED=false` stops new grants after an API redeploy;
- already minted keys remain bounded by the team and proxy ceilings.

Local release testing produced a valid run and native Pi traces, but its recorded cost was zero.
Therefore staging must provide the non-zero-cost evidence before this feature is considered ready.

## Known gaps to close

| Priority | Gap                                                                                            | Required change                                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Cloud preflight reports only the first missing value                                           | Aggregate every missing and invalid platform, bridge, proxy, routing, and phase-order error into one refusal                                         |
| P0       | The app repository's four tracked compose examples omit the bridge contract                    | Add commented EE examples and explain OSS disablement. Do not put the master key in a shared env without preserving container-level secret isolation |
| P0       | Staging is missing or has not verified the complete Phase A set                                | Audit and populate the full set once, then retry the approved staging workflow                                                                       |
| P0       | Testing, demo, and both live regions have no completed environment audit                       | Complete this worksheet separately for each environment before its first proxy-aware deploy                                                          |
| P1       | Local LiteLLM topology exists only under `~/.agenta-starter-litellm/` and gitignored overrides | Either track a safe `with-litellm` EE profile or correct the cloud design to declare local setup operator-owned                                      |
| P1       | Routing/public-URL consistency is documented but not enforced                                  | Add a semantic preflight check for path versus host mode                                                                                             |
| P1       | Proxy metrics are not scraped                                                                  | Add a private-network scrape path and alert on health, spend, and remaining budget                                                                   |
| P1       | Stage hardening findings are separate from the feature rollout                                 | Close them through dedicated infrastructure changes before production-like sign-off                                                                  |

## Operator record template

Append one record to the release protocol for every mutation or decision:

```text
time:
operator:
environment:
action:
authorization:
workflow or command:
application SHA:
cloud SHA:
result:
side effects:
evidence:
decision and reason:
rollback:
remaining blockers:
```

Never store a secret value, a base64 credential, a master-key header, or a database URI in the
record. Store only the variable name, secret-store location, validation result, and the person or
system that owns it.
