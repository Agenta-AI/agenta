# Railway preview pipeline: how it works and how it has failed

Compiled 2026-08-02 from the workflows, scripts, and git history. This is the evidence
base for the clone-based redesign.

## Per-PR lifecycle today

Entry point: `.github/workflows/14-check-pr-preview.yml` triggers on PR
open/synchronize/reopen/ready-for-review touching `api/**`, `web/**`, `services/**`,
`sdks/python/**`, or `hosting/railway/**`, with per-PR cancel-in-progress concurrency.
Chain: build (42) → setup (41) → deploy (43) → tests (44). Cleanup (45) runs on PR
close/draft-convert and a daily 06:00 UTC cron.

1. Build (42): 4 images (api/web/services/runner) x 2 arches, pushed to GHCR as
   `pr-<N>-<sha>-<arch>`, manifests merged. No Railway calls.
2. Setup (41) runs `bootstrap.sh` with the single shared `secrets.RAILWAY_TOKEN`
   (account-scoped, exported as `RAILWAY_API_TOKEN`). Each PR gets a dedicated Railway
   project `agenta-oss-pr-<N>`, environment `production` (`preview-resolve-env.sh`).
3. `bootstrap.sh`: project list/init/link (with link-failure → re-init fallback), env
   create, 13 `railway add --service` calls, `verify_services_exist` (status --json,
   up to 3 re-attempt rounds), 3 volumes via check-then-add retry loops, gateway
   domain. Roughly 25-35 CLI calls.
4. Deploy (43) runs `deploy-from-images.sh`: 2s post-bootstrap sleep (rate limit),
   then `configure.sh`.
5. `configure.sh`: variables for all 13 services, preferably one GraphQL
   `variableCollectionUpsert` per service (~15-17 mutations) against
   backboard.railway.com, CLI fallback. Previews set `CONFIGURE_SKIP_UNSETS=true`,
   skipping ~73 `variable delete` calls. Plus link, status, 2 variable-list reads,
   domain, 4 `environment edit` healthcheck mutations. README claims ~58 API calls
   per deploy.
6. `deploy-from-images.sh` continues: Postgres redeploy (tolerating "No deployment
   found"), redis + seaweedfs `railway up` wrappers, 20s settle, alembic `up` with up
   to 5 attempts (each failure = Postgres redeploy + settle), then 7 more `railway up`
   calls (api, worker-streams, worker-queues, runner, services, cron, web), gateway
   up, `smoke.sh`. Each `up` uploads a locally generated wrapper Dockerfile (FROM the
   GHCR image) and triggers a server-side build. ~13-17 more mutations.
7. `smoke.sh`: poll gateway domain, curl `/w`, `/api/health`, `/services/health`
   (300s each).
8. Tests (44): readiness polling, Playwright auth bootstrap, API/SDK/services/web
   matrices. Read-only vs Railway.

Totals per full run: ~55-75 CLI mutations + ~17 GraphQL upserts, one shared token.
Per PR the account accrues 1 project, 1 env, 13 services, 3 volumes, 1 domain,
O(100) variables. Every push re-runs the chain against the same project;
cancel-in-progress can kill a run mid-mutation; the daily cron deletes previews idle
>24h, so a quiet-but-open PR is rebuilt from scratch on its next push. "Re-run failed
jobs" skips a green setup job, so bootstrap never repairs a half-created environment.

## Failure catalog (symptom | root cause | mitigation | evidence)

1. Deploys failed ~96% of the time | `variable set` timed out ~20% per call, ~15
   calls/deploy, no retry (0.8^15) | context-aware retry in `railway_call` | 060441a840.
2. Still-slow variable writes | CLI fans out one expensive `variableUpsert` per key |
   one `variableCollectionUpsert` GraphQL mutation per service | 71c9492846.
3. Deploy aborted on 429s | shared account token, hourly rate limit, ~58+ calls/deploy,
   concurrent PRs share the budget | backoff retries, `CONFIGURE_SKIP_UNSETS`, sleeps |
   c77ffd53bb; hosting/railway/oss/README.md rate-limit section.
4. "Unauthorized" on every account-level call | account token aliased into
   `RAILWAY_TOKEN`, which the CLI treats as project-scoped | removed the alias |
   892513093c, 06c2b970af (#4392).
5. Green setup, every later deploy fails "Service 'X' not found" forever | transient
   `railway add` failure silently swallowed; no reconcile; re-run skips green setup |
   `verify_services_exist` + configure's "Re-run all jobs" guidance | 24b82bc09a,
   81a9a5c0c4 (#5566).
6. "You are creating volumes too quickly" / duplicate volume breaks deploys |
   separate volume throttle with non-standard error text; `volume add` non-idempotent |
   `ensure_volume` check-before-add, 3 attempts, 15s delay | 81a9a5c0c4.
7. "Service 'cron' not found" seconds after creation | status/read APIs lag writes |
   `_service_id_with_retry` (6 x 5s) + CLI retry on "not found" | b46eb2a135 (#5322).
8. `Project not found in workspace` after draft→ready cycle | `project list`
   (cross-workspace, lags deletions) disagrees with `link` | link failure → re-init |
   4d303c1088 (#4589).
9. Redeploy hit wrong service / failed on fresh envs | implicit linking; fresh
   Postgres has no deployment | explicit `--service --environment`, tolerate "No
   deployment found" | 492a8b4e1a → de228efb8b → d63a4a2b2f.
10. Readiness poll hung for hours | curl without timeouts | `--max-time`/
    `--connect-timeout` + job timeout | b0b48f1152.
11. ~6h hang in test jobs | Playwright zip extraction deadlock on Node 24 | browser
    cache + bounded retries | comments in 44-railway-tests.yml.
12. Gateway 504s after any redeploy | nginx resolves `*.railway.internal` once at
    startup; internal IPs change per deploy | resolver `[fd12::10] valid=5s` +
    variable-based proxy_pass | README.
13. Auth session refresh failures | proxy header buffers too small for auth cookies |
    enlarged nginx buffers | d7c09e3f94.
14. Redis MISCONF / lost persistence | Railway non-root UID vs official redis
    entrypoint privilege drop | 4-commit saga: volume, `RAILWAY_RUN_UID=0`,
    entrypoint wrapper both paths | 7880842361, 32085d8bba, 22b8dde6b4, 8cb583f8b7.
15. First alembic run fails on fresh envs | Postgres not ready | redeploy + 5
    bounded retries | deploy-from-images.sh.
16. Whole chain produced zero jobs silently | duplicate YAML key made workflow 43
    invalid; Actions failed silently | 0e92a44b26.
17. Mounts/STS broken | bare SeaweedFS image lacks advanced IAM; non-4.37 releases
    regressed | IAM entrypoint wrapper + 4.37 pin | a6778e5dbb.
18. Runner unreachable + store creds rotating per deploy | runner not on private
    network; creds regenerated per run | runner fix + reuse durable creds from the
    API service | 894c23b4db (#5485).
19. Throttling misreported as bad token | rate-limited `whoami` classified as auth
    failure | error classification in `require_railway_auth` | 21186ffe32.
20. Env-parity bugs (supercronic path, venv python, worker Redis hostnames, SDK
    source) | wrapper Dockerfiles drift from the compose baseline | per-item fixes |
    6e5c312f16, bd26e0f726, README notes.
21. Runner-token contract break took previews down | `AGENTA_RUNNER_TOKEN` made
    required without updating all deploy surfaces | 4a1e9cc235.
22. Secrets in CI logs risk | failing commands echoed args including
    `variable set KEY=secret` | `_railway_redact` on failure paths | 63136af47e,
    d97cf94d97.

## Structural roots

1. Non-idempotent CLI mutations with ambiguous outcomes dominate: `init`, `add`,
   `environment new`, `volume add`, `up`, `redeploy` can succeed server-side while
   reporting a timeout. Every workaround is a hand-rolled check-then-act loop per
   resource type. Failures 5, 6, 8 are all this one gap.
2. No desired-state reconcile; creation and configuration are split across CI jobs;
   the only real reconcile is "delete the whole project and start over", which itself
   caused failure 8.
3. Railway's reads lag its writes (three distinct read paths needed retry loops).
4. One shared rate-limit budget across all concurrent PRs; workspace tokens carry
   higher limits but the CLI rejects them (railwayapp/cli#618).
5. The biggest historical reliability win came from bypassing the CLI for GraphQL
   (`variableCollectionUpsert`); the README already lists bootstrap and cleanup as
   next candidates.
6. A second, independent failure family is wrapper-vs-compose config drift; it ships
   as a preview outage every time a compose-side change is not mirrored by hand.
