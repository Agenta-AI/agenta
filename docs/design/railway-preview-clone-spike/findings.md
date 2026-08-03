# Findings: Railway clone-based preview spike (issue #5650)

Status date: 2026-08-02. Schema facts below were verified against the real API
via **unauthenticated introspection** (confirmed working: schema queries
against `https://backboard.railway.com/graphql/v2` succeed with no
`Authorization` header). Live-run rows are updated as phases execute.

## Open questions from issue #5650

| # | Question | Status | Answered by |
|---|----------|--------|-------------|
| Q1 | `environmentCreate` 504 behavior at 13-service scale: does the clone complete in the background, and does poll-by-name recover it reliably? | **answered live (2026-08-02): no 504 across 25+ clones** — every `environmentCreate` returned synchronously in 3-4s (`clone_s` column across both 10-cycle series). The poll-by-name fallback stays as unexercised insurance. | `results/cycle-log.csv`, both 10-cycle runs. |
| Q2 | Clone fidelity: reference variables. Do `${{gateway.RAILWAY_PUBLIC_DOMAIN}}`, `${{Postgres.POSTGRES_PASSWORD}}` etc. stay references (re-resolving inside the clone) rather than freezing to template values? | **answered live (2026-08-02): yes, references re-resolve per clone.** Alembic connected to the CLONE's Postgres through `${{Postgres.*}}` references; the full smoke passed through the clone's own regenerated gateway domain. | Kept clone: migrations + 200 on all three smoke paths. |
| Q3 | Clone fidelity: volumes (recreated empty and attached?) and service domains (expected NOT copied). | **answered live (2026-08-02): both better than expected.** Volumes: recreated empty and attached — clone Postgres booted on its own volume and alembic created all three databases from scratch. Domains: Railway REGENERATED a service domain for the gateway in the clone automatically (`gateway-<env-name>.up.railway.app`), so no `serviceDomainCreate` is needed (the script keeps it as a fallback). | Observed in the kept clone `pr-clone-c1-1785674907`. |
| Q4 | Clone fidelity: private networking. Does `*.railway.internal` resolve per-environment inside the clone? | **answered live (2026-08-02): yes.** `/w`, `/api/health`, `/services/health` all returned 200 through the clone's gateway (nginx -> web/api/services over `*.railway.internal`), and api reached Postgres/redis/supertokens internally. | Kept clone smoke, 2026-08-02. |
| Q5 | Can template services stay permanently undeployed while still cloning into deployable environments? | **answered live (2026-08-02): yes.** The 16:23+ cycles cloned from a template whose services showed `latestDeployment: NONE` (the earlier CLI-triggered deployments had been removed), and every clone deployed green. Template deployments are irrelevant to clones in both directions (stale ones don't leak, missing ones don't block). | Both 10-cycle series in `results/cycle-log.csv`. |
| Q6 | CI auth: does the shared `secrets.RAILWAY_TOKEN` (account token) work from GitHub Actions for `me`, clone, delete — and what rate-limit tier do the headers report? | pending live run | Runbook phase 4: `spike/ci-auth-check.yml`. |
| Q7 | Does `serviceInstanceUpdate` apply immediately, or does it only STAGE a change (staged-changes mutations exist in the schema: `environmentStageChanges`, `environmentPatchCommit*`, `environmentApplyChangeSet`) that a deploy would ignore? | **answered live (2026-08-02): applies immediately.** No `unmergedChangesCount` warning fired, and the clone deployment's `meta.serviceManifest` carried the patched `image`, the fixup `startCommand`, and the `ON_FAILURE`/10 restart policy verbatim. | Verified via `deployment(id).meta` of a clone deployment. |
| Q8 | API calls per cycle: can a cycle fit in <=15 calls? | **answered live (2026-08-02): yes on mutations (8), 16 on total HTTP calls incl. polling.** The low-call mechanism is `environmentPatchCommit` (NOT `environmentTriggersDeploy`, which is per-service — see the deploy-mode section). Full verdict in the Results section. | Patch-mode rows in `results/cycle-log.csv`; Results section below. |
| Q9 | Deployment status semantics for a one-shot service (alembic runs migrations and exits): does `latestDeployment.status` settle on `SUCCESS`, or `SLEEPING`/`REMOVED`? | **answered live (2026-08-02): stays `SUCCESS`.** With `restartPolicyType: ON_FAILURE` the exit-0 container is not restarted and the deployment keeps reporting SUCCESS. | Kept clone, alembic after migrations completed. |
| Q10 | Is `startCommand` executed through a shell (needed for the alembic inline `psql` command)? | **answered live (2026-08-02): NO.** Railway tokenizes the string (quote-aware) and execs it argv-style. A bare `until ...` start command fails within seconds as FAILED with EMPTY build and deploy logs (the misleading signature that cost cycle 1). Wrapping in `sh -c '<script>'` works — the wrapped alembic ran all migrations to completion. Fixed in `build-template-env.sh`. | Kept clone: alembic FAILED bare, SUCCESS wrapped. |
| Q11 | Do upload-built sources (`railway up`, used by the no-registry fallback for gateway/redis/seaweedfs) survive cloning — i.e. can a clone deploy them without a new upload? | **answered live (2026-08-02): NO, with a trap.** Gateway (pure upload source): `serviceInstanceDeployV2` in the clone fails with `"Deployment not found"` — the upload artifact is not part of the cloneable config. Redis/seaweedfs (created with `--image` then upped): the clone silently deploys the PLAIN base image (`redis:8`, `chrislusf/seaweedfs:4.37`) because `source.image` still points there — the wrapper entrypoints are LOST, resurfacing failure-history items 14 and 17. **Conclusion: the design requires real registry images for gateway/redis/seaweedfs (runbook phase 0.2). The `railway up` fallback only validates the rest of the flow.** A per-clone `railway up gateway` (+1 upload/cycle) is a workable interim. | Kept clone: gateway deployV2 error; redis/seaweedfs source.image inspection. |
| Q12 | Deploy ordering: which services must wait for alembic? | **answered live (2026-08-02): supertokens.** Deployed alongside infra it exhausts its restarts and ends CRASHED because the `agenta_oss_supertokens` database does not exist until alembic runs. Order fixed in `preview-cycle.sh`: Postgres/redis/seaweedfs -> alembic -> supertokens + apps. A redeploy after alembic succeeds. | Kept clone: supertokens CRASHED pre-alembic, SUCCESS after. |

## Statically verified vs assumed

### Verified 2026-08-02 by unauthenticated introspection

- Introspection itself requires no auth (claimed in
  `research/railway-capabilities.md`; now confirmed empirically).
- `environmentCreate(input: EnvironmentCreateInput!): Environment!`; input
  fields exactly: `projectId!`, `name!`, `sourceEnvironmentId`,
  `skipInitialDeploys`, `ephemeral`, `stageInitialChanges`,
  `applyChangesInBackground`.
- `environmentDelete(id: String!): Boolean!` (bare `id`, not an input object).
- `serviceInstanceUpdate(serviceId: String!, environmentId: String, input:
  ServiceInstanceUpdateInput!): Boolean!`; input includes `source`
  (`ServiceSourceInput` = `{image, repo}`), `startCommand`, `healthcheckPath`,
  `restartPolicyType`, `restartPolicyMaxRetries`, `preDeployCommand`,
  `numReplicas`, `registryCredentials`, `sleepApplication`, `cronSchedule`.
- `serviceInstanceDeployV2(environmentId: String!, serviceId: String!,
  commitSha: String): String!` (returns a deployment id).
- `serviceInstanceRedeploy(environmentId!, serviceId!)` exists (redeploys the
  CURRENT deployment — not useful for first deploys of a skipped clone).
- `environmentTriggersDeploy(input: {projectId, environmentId, serviceId})`
  exists — candidate single-call deploy for a whole environment (semantics
  unverified; `serviceId` presumably optional).
- `environments(projectId: String!, first, isEphemeral, ...)` connection — the
  poll-by-name path. `Environment` exposes `serviceInstances`,
  `volumeInstances`, `sourceEnvironment`, `unmergedChangesCount`, `configEtag`.
- `ServiceInstance` exposes `serviceId`, `serviceName`, `source {image repo}`,
  `latestDeployment {status}`, `domains` (`AllDomains` = `{serviceDomains,
  customDomains}`), `startCommand`, `healthcheckPath`.
- `DeploymentStatus` enum: `BUILDING CRASHED DEPLOYING FAILED INITIALIZING
  NEEDS_APPROVAL QUEUED REMOVED REMOVING SKIPPED SLEEPING SUCCESS WAITING`.
- `variableCollectionUpsert(input: {projectId, environmentId, serviceId,
  replace, skipDeploys, variables})` — matches configure.sh's production use.
- `serviceDomainCreate(input: {environmentId, serviceId, targetPort}):
  ServiceDomain` (`targetPort` optional; spike passes 8080, the gateway nginx
  listen port).
- `projectCreate(input: {name, defaultEnvironmentName, workspaceId, ...})`,
  `projectDelete(id: String!)` (used for teardown).
- Staged-changes mutations exist (basis for Q7).
- Unauthenticated introspection responses carried NO `X-RateLimit-*` or
  `Retry-After` headers; presumably only on authenticated calls (Q6 prints
  them from CI).

### Assumed (recorded, not invented silently)

- ~~`startCommand` runs through a shell~~ — RESOLVED live: it does NOT (Q10).
- ~~One-shot deployment status semantics~~ — RESOLVED live: stays SUCCESS (Q9).
- ~~Environment duplication copies service config~~ — RESOLVED live: start
  command, restart policy, image, variables (incl. references), volumes and
  even the gateway service domain all carried over (Q2/Q3/Q7).
- ~~`environmentTriggersDeploy` deploys every service when `serviceId` is
  omitted (Q8's low-call path)~~ — DISPROVEN live (2026-08-02): introspection
  shows `EnvironmentTriggersDeployInput.serviceId` is NON_NULL (the call is
  per-service, tied to deploy triggers), and omitting it returns HTTP 400
  "Problem processing request". There is NO single-call whole-environment
  deploy. The real low-call path is `environmentPatchCommit` (see the live run
  log): ONE mutation carries an `EnvironmentConfig` patch covering all 8 app
  images AND deploys each service whose config actually changed.
- `psql` remains available in the api image (verified today in
  `api/oss/docker/Dockerfile.gh`: `postgresql-client-17`; re-check if that
  Dockerfile changes).

## Per-cycle API call ledger (static)

Mutations, per-service deploy mode: 1 `environmentCreate` + 8
`serviceInstanceUpdate` + 13 `serviceInstanceDeployV2` + <=1
`serviceDomainCreate` + 1 `environmentDelete` = **24**. Plus reads: 1-2 id
resolutions (amortized across cycles), 1 populate check, ~1 read per 15s of
deploy wait. Realistic total: **~35-60/cycle**, dominated by status polling.

Mutations, triggers mode: 1 create + 8 patches + 1 `environmentTriggersDeploy`
+ <=1 domain + 1 delete = **12**, meeting the <=15 criterion if polling reads
are excluded (record both numbers in the spike report; reads and writes share
the hourly budget).

Further reduction candidates (not implemented):

- If `source.image` accepts a reference variable (e.g.
  `ghcr.io/agenta-ai/agenta-api:${{shared.IMAGE_TAG}}`), the 8 patch calls
  collapse into one shared-variable upsert baked into the template. Worth one
  manual dashboard experiment during phase 2.
- `skipInitialDeploys: false` would drop the 13 deploy calls but deploys the
  template's `:latest` images first, forcing 8 patch+redeploys anyway and
  doubling build/start load — rejected.

## How this addresses the failure history

- Failures 1/2 (slow per-key variable writes): clones copy variables; zero
  variable writes per PR.
- Failures 5/6/7/8 (non-idempotent creates, read lag, list/link divergence):
  the per-PR path creates exactly one resource (the environment) with a
  name-poll reconcile; services/volumes/config come from the clone.
- Failure 3 (rate limits): ~24 mutations vs ~58+ calls today, one project
  instead of one per PR.
- Failure 20 (wrapper drift): wrapper ENV/CMD now live once in the template
  (build-template-env.sh fixups), not re-rendered per deploy. Residual risk:
  the template itself drifts from compose — a template rebuild must become
  part of changing the compose baseline if this design ships.

## Live run log

### 2026-08-02 — phase 1 (template build) — SUCCESS

- Auth: account token verified through `lib-graphql.sh` (`me` query). Response
  headers show the token is on the **Hobby tier: `x-ratelimit-limit: 1000`**
  requests/hour (answers the header half of Q6 for local runs; CI still
  pending).
- **New live finding (fixed in the scripts): `projects` without arguments
  returns an EMPTY list for account tokens.** Project lookup must be scoped
  with `workspaceId`, iterating the workspaces from `me { workspaces { id } }`
  (`rw_find_project_id` in `lib-graphql.sh`). The workspace also contains all
  the per-PR preview projects, some with duplicate names — first match wins.
- `bootstrap.sh` + `configure.sh` + GraphQL fixups all succeeded against the
  throwaway project (fixups: 16 mutations + 3 resolution reads = 19 calls).
- **Q5 amendment: a CLI-bootstrapped template does NOT stay undeployed.**
  `railway add --service --image` triggers an initial deploy, so all 13
  template services had deployments before the fixups ran. Consequences:
  (a) the running template costs money continuously — if the design ships,
  either stop/sleep the template services or accept the cost;
  (b) the template's Postgres first deploy CRASHED because it started before
  `configure.sh` set `POSTGRES_PASSWORD` (the official image refuses to boot
  without it). Stale deployments do not affect clones — clones copy config,
  not deployments — verified by the phase 2 cycle below.
- The no-registry fallback (`railway up` one-time builds for
  gateway/redis/seaweedfs) uploaded and built server-side. Observation for
  Q11: while building, redis/seaweedfs still REPORT `source.image` as their
  base image (`redis:8`, `chrislusf/seaweedfs:4.37`) and gateway reports a
  null image (upload source) — what a clone inherits is answered in phase 2.

### 2026-08-02 — phase 2 (preview cycles) — smoke GREEN after two fix rounds

- Cycle 1 (scripted, auto-delete): clone 4s (no 504), 8 image patches applied
  (verified in the clone deployment's `serviceManifest`), infra deployed, then
  alembic FAILED in seconds with EMPTY build+deploy logs. Auto-delete
  destroyed the evidence — diagnostics were added to the script
  (`dump_failed_service_logs`) and later runs used `--keep`.
- Cycle 2 (`--keep`): same failure, root causes found and fixed live:
  1. Q10 — `startCommand` is execed, not shell-wrapped. Bare `until ...`
     fails instantly, no logs. Fix: `sh -c '<script>'` (applied to the
     template and to `build-template-env.sh`).
  2. Q12 — supertokens deployed alongside infra CRASHED (its database only
     exists after alembic). Fix: deploy order Postgres/redis/seaweedfs ->
     alembic -> supertokens + apps (applied to `preview-cycle.sh`).
  3. Q11 — gateway (upload source) cannot deploy in a clone
     (`Deployment not found`); worked around with a per-clone
     `railway up gateway`. redis/seaweedfs silently deployed their PLAIN base
     images.
- After the fixes, the kept clone reached ALL 13 services SUCCESS and the full
  smoke passed: `/w`, `/api/health`, `/services/health` all 200 via the
  clone's own regenerated gateway domain. The clone env was then deleted via
  `environmentDelete` (clean).
- Cost observation: the two scripted cycle attempts consumed 22-24 API calls
  each up to the failure point; the whole live session (template build +
  fixups + 2 cycles + debugging + manual completion) fit comfortably inside
  the Hobby 1,000/hour budget.
- Wall-time observation: clone + patch = ~7s; infra deploys reached SUCCESS in
  well under a minute; the un-timed manual completion (supertokens + 8 app
  deploys + gateway upload build) took a few minutes end to end. A clean
  scripted cycle time comes from re-running phase 3 after the template gets
  real wrapper images.

### 2026-08-02 — wrapper images built; GHCR push BLOCKED on token scope

- The three wrapper images now exist as real, self-contained build contexts in
  `spike/images/{gateway,redis,seaweedfs}/` (byte-faithful to what
  `deploy-from-images.sh` renders; provenance and the one deliberate
  divergence — the redis base pin — documented at the top of each Dockerfile).
  All three build clean for linux/amd64 and contain NO secrets (nginx.conf
  routes internal hostnames only; both entrypoints read credentials from env at
  runtime), so publishing them as public GHCR packages is safe once a push
  succeeds.
- **Push blocked at first: no `write:packages` credential existed.** The `gh`
  OAuth token initially carried only read scopes; pushes to BOTH
  `ghcr.io/agenta-ai/*` and the user namespace failed with
  `denied: permission_denied: The token provided does not match expected scopes`.
  **RESOLVED later the same day**: Mahmoud ran `gh auth refresh -s
  write:packages` interactively, and all three images pushed to
  `ghcr.io/agenta-ai/agenta-preview-{gateway,redis,seaweedfs}:spike`
  (digests `sha256:62fc66b9…` gateway, `sha256:513f5420…` redis,
  `sha256:bd1353af…` seaweedfs; image IDs match the locally audited builds).
- **Visibility flip still pending — GitHub-UI-only.** New GHCR packages
  default to PRIVATE and there is NO REST or GraphQL API to change package
  visibility (`PATCH orgs/.../packages/...` returns 404; the docs describe
  only the web UI "Danger Zone -> Change visibility" flow). Anonymous
  manifest pulls return 401/403 while private, so Railway cannot pull them
  yet. Once an org admin flips the three packages public,
  `spike/switch-template-to-ghcr-images.sh` (pull-gated: it refuses to touch
  the template while any package is private) switches the template to the
  images and clears the startCommand overrides; run one patch-mode cycle to
  certify the registry-backed path.
- Consequence for the cycle tests: one interim cycle ran with
  `preview-cycle.sh --gateway-up-interim` (uploads `spike/images/gateway` into
  the clone via `railway up`; pass, 80s, "+cli-up" in the CSV) — and was then
  SUPERSEDED the same day by the registry-free startCommand wrappers (next
  section), which restore all three wrapper behaviors without any registry or
  per-clone upload. ttl.sh was probed as an anonymous ephemeral registry and
  ruled out: blob uploads stall from this network.

### 2026-08-02 — registry-free wrappers via startCommand; templates fully image-backed

With the GHCR push blocked and ttl.sh uploads stalling from this network
(`POST /v2/.../blobs/uploads/` times out while `GET /v2/` returns 200), a
third mechanism made the template registry-free: **Railway's start command
"overrides the image's ENTRYPOINT in exec form"**
(docs.railway.com/guides/start-command; consistent with Q10's exec-not-shell
finding). `spike/apply-wrapper-startcommands.sh` therefore reshapes the three
special services onto PUBLIC base images with the wrapper behavior in
startCommand:

- redis -> `redis:8` + `sh -c 'mkdir -p /data; chown -R redis:redis /data;
  exec docker-entrypoint.sh redis-server'` (item 14 protection preserved).
- seaweedfs -> `chrislusf/seaweedfs:4.37` + the EXACT wrapper entrypoint
  (`spike/images/seaweedfs/entrypoint.sh`) shipped base64-inline and exec'd
  (item 17 IAM protection preserved, byte-faithful).
- gateway -> `nginx:1.27-alpine` + the EXACT `spike/images/gateway/nginx.conf`
  shipped base64-inline + the wrapper's envsubst+nginx command; the wrapper
  image's `ENV PORT=8080` became a gateway service variable.

Railway accepted startCommands up to 3372 chars. All three deployed SUCCESS in
the template in ~20s; deploy logs confirm real behavior (redis "Ready to
accept connections"; seaweedfs runs `weed server` with filer+master, i.e. our
entrypoint, not the base image's `mini` default). Every template service is
now image-backed, so clones deploy with pure GraphQL — no per-clone
`railway up`, no registry, no wrapper images required. Two caveats recorded:
(a) if Railway ever switches startCommand to append-as-CMD semantics, the
seaweedfs base entrypoint would break it (its default case is
`exec /usr/bin/weed $@`, and it su-execs to the `seaweed` user first);
(b) the wrapper images in `spike/images/` remain the intended production
shape — the startCommand variant trades image immutability for registry
independence, and the two must be kept in sync by rebuilding both from the
same `hosting/railway/oss/` sources.

### 2026-08-02 — deploy-mode findings: triggers disproven, patch mode wins

- **Triggers mode is a dead end** (see the schema note above): the cycle run
  recorded `fail` in 8s with HTTP 400. CSV row kept for honesty.
- **`environmentPatchCommit` deploys exactly the services whose config
  CHANGED.** First patch-mode run with `--image-tag latest` timed out: the
  patch equaled the template config (template apps already point at
  `:latest`), the commit was a silent no-op, and all 8 app services stayed
  `latestDeployment: NONE`. With a real PR tag (`pr-5651-a46168f`, present for
  all four app images) the same flow went green. Consequence for the design:
  the template must pin app images to a tag a PR can never reuse (`:latest`
  works only if PR tags are always `pr-<n>-<sha>`), and a `:latest` smoke test
  of the cycle must use per-service mode.
- Patch-mode per-cycle ledger (measured): 8 mutations (create + 3 infra
  deploys + 1 patchCommit + supertokens + gateway + delete) and **16 TOTAL
  API calls including polling**, at ~55s per cycle. The <=15-mutation
  criterion is met with headroom; even total calls sit at the line.
- The 7 non-alembic app services deploy in parallel with alembic after
  Postgres is up and none of them terminally crashed while migrations ran
  (10+ live cycles of evidence, all smoke-green).

## Results: the 10-cycle runs vs the issue #5650 success criteria

All rows in `spike/results/cycle-log.csv` (cycle numbers restart per script
invocation — runs were chunked; `start_iso`/`env_name` order the sequence).
Two full evidence series ran on 2026-08-02:

- **Per-service mode, `--image-tag latest`: 10/10 consecutive green**
  (16:26-16:37 UTC, strictly unbroken), 62-80s per cycle, 32-33 total API
  calls per cycle (23 of them mutations).
- **Patch mode, `--image-tag pr-5651-a46168f`: 10 consecutive green rows**
  (16:53-17:23 UTC), 55-72s per cycle, 16 total API calls per cycle (8 of
  them mutations). Honesty note: between the 8th and 9th green row one cycle
  attempt was ABORTED mid-run (no CSV row): the hourly rate budget — spent by
  the day's debugging, not by the cycles — ran out and the operator stopped
  the run rather than let 429-retry exhaustion record a bogus failure; its
  clone was deleted, and the run resumed after the 17:22 UTC window reset.
  No cycle ever failed for a design reason in either series.

| # | Criterion (issue #5650) | Verdict |
|---|--------------------------|---------|
| 1 | 10 consecutive green clone→patch→deploy→smoke→delete cycles | **MET** — per-service 10/10 strictly unbroken; patch mode 10 green rows with the aborted-attempt note above. |
| 2 | ≤ 15 Railway API calls per cycle | **MET on mutations, 1 over on total calls.** Patch mode: 8 mutations (create + 3 infra deploys + 1 patchCommit + supertokens + gateway + delete). Total HTTP requests incl. polling = 16: the 8 mutations + 8 reads (populate check, domain check, ~5 status polls at 15s, post-patch refresh). Merging the populate and domain reads or widening `RW_POLL_INTERVAL` brings the total to ≤15; mutations are the scarce/priced dimension and sit at nearly half the target. |
| 3 | Wall time ≤ today's setup+deploy | **MET with ~3x headroom.** Baseline measured live from the last successful `14-check-pr-preview.yml` deploy (run 30753555499, 2026-08-02): setup 38s + deploy 2m18s = **~176s**, excluding image builds. Patch-mode cycles complete clone→patch→deploy→smoke in ~51-55s (55-57s including the delete). |

Winning mode: **patch** (`--deploy-mode patch`) with a PR-style tag. Triggers
mode is disproven; per-service mode remains the fallback (and the only mode
that works when the tested tag equals the template's, e.g. `:latest` smokes).

### Remaining / open

1. ~~Push `spike/images/*` to GHCR~~ — DONE 2026-08-02 (`:spike` tags, see the
   push section). Remaining: an org admin flips the three packages PUBLIC in
   the GitHub UI (no API exists), then
   `spike/switch-template-to-ghcr-images.sh --deploy` + one patch-mode cycle
   certifies the registry-backed path. Canonical shape = the GHCR images; the
   startCommand variant (Option B, currently live in the template) stays as
   the registry-free fallback.
2. Run the CI auth check (runbook phase 4) — still pending.
3. Sequencing note for a real rollout: keep the template's app-image tags
   disjoint from PR tags so `environmentPatchCommit` never no-ops (see above).

## Addendum 2026-08-02 (spike close-out): registry-backed validation

- The three wrapper packages were made public in the GitHub UI and the template was
  switched to them with `spike/switch-template-to-ghcr-images.sh --deploy`. All
  three services deployed SUCCESS on the images' own entrypoints.
- API finding: `serviceInstanceUpdate` with `startCommand: null` is a no-op (patch
  semantics treat null as "no change"); setting `startCommand: ""` clears the
  override. The switch script's warning caught this live; the empty-string clear is
  the documented workaround.
- Final proof cycle, fully registry-backed (GHCR images, no startCommand
  overrides, zero `railway up`): **pass, 57s, 15 API calls** with tag
  `pr-5651-a46168f`. This is the production-shaped path and lands under the ≤15
  calls criterion.
- One transient failure preceded it: the clone's Postgres deploy timed out at 420s
  immediately after the template's infra services had been freshly redeployed.
  The retry passed. Production rule: allow generous first-deploy timeouts for
  volume-backed services in a fresh clone, and treat a single Postgres timeout as
  retryable.
