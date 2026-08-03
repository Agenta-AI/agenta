# Runbook: Railway clone-based preview spike (issue #5650)

> **Historical record.** The spike scripts this runbook drove were removed
> before merge, after WP1-WP3 productionized them: the GraphQL client and
> template apply live in `hosting/railway/oss/template/`, the clone
> create/destroy scripts in `hosting/railway/oss/scripts/`, the wrapper image
> sources in `hosting/railway/oss/images/`, and the CI evidence harness is
> `.github/workflows/48-railway-clone-preview-test.yml`. The measurements in
> `spike/results/` remain the spike's evidence.

Exact steps to run the spike end to end. Everything below runs from the repo
root. All scripts live in `docs/design/railway-preview-clone-spike/spike/`.

Success criteria (from issue #5650):

1. **10 consecutive green cycles** of clone → patch → deploy → smoke → delete
   (phase 3).
2. **≤ 15 Railway API calls per cycle** (the `api_calls` column in
   `spike/results/cycle-log.csv`; see the note in phase 3 about the two deploy
   modes).
3. **Wall time per cycle ≤ today's setup + deploy** (the combined duration of
   the "41 - railway setup" and "43 - railway deploy" jobs on a recent PR run;
   fetch a baseline with
   `gh run list --workflow "14-check-pr-preview.yml" --limit 5` and open one
   run's job timings).

## Phase 0 — prerequisites

### 0.1 Provide the token

The spike needs a Railway **account** token (workspace and project tokens
cannot create environments; the CLI additionally rejects workspace tokens —
see `research/railway-capabilities.md`). Create one at
`railway.com/account/tokens`, then store it locally:

```bash
touch ~/.agenta-railway.env && chmod 600 ~/.agenta-railway.env
# Edit the file so it contains exactly one line:
#   RAILWAY_API_TOKEN=<the account token>
```

Every spike script auto-sources that file when `RAILWAY_API_TOKEN` is unset.
Never export it as `RAILWAY_TOKEN`: the CLI treats that name as
project-scoped and account-level calls fail "Unauthorized"
(failure-history item 4).

Alternative for the CLI-driven parts only (phase 1 uses `railway` CLI via
`bootstrap.sh`/`configure.sh`): an interactive login from a Claude session:

```bash
! npx --yes @railway/cli login
```

Note the leading `!` (runs interactively so the browser handoff works). A CLI
login alone does NOT cover the GraphQL phases — the account token in
`~/.agenta-railway.env` covers both, so prefer it.

Verify (cheap, 1 API call, prints no secrets):

```bash
source docs/design/railway-preview-clone-spike/spike/lib-graphql.sh
rw_require_token && rw_graphql 'query { me { name } }' | jq '.data.me'
```

### 0.2 The three wrapper images — build, push, or go registry-free

Three services need custom content beyond a plain public image: the nginx
gateway, the redis permission wrapper (failure-history item 14), and the
SeaweedFS IAM wrapper (item 17). The self-contained build contexts live in
`spike/images/{gateway,redis,seaweedfs}/` (byte-faithful to what
`deploy-from-images.sh` renders per PR today; divergences documented at the
top of each Dockerfile).

**Option A — registry images (the intended production shape):**

```bash
SPIKE=docs/design/railway-preview-clone-spike/spike
gh auth token | docker login ghcr.io -u "$(gh api user --jq .login)" --password-stdin
for n in gateway redis seaweedfs; do
  docker buildx build --platform linux/amd64 --load \
    -t "ghcr.io/agenta-ai/agenta-preview-$n:spike" "$SPIKE/images/$n"
  docker push "ghcr.io/agenta-ai/agenta-preview-$n:spike"
done
# New GHCR packages default to PRIVATE; make them public so Railway can pull
# (verified: they contain no secrets — config + entrypoints reading env only).
# There is NO API for this (PATCH returns 404): use the GitHub web UI —
# org Packages -> agenta-preview-<n> -> Package settings -> Danger Zone ->
# Change visibility -> Public.
```

LIVE STATUS (2026-08-02): the push is DONE — all three images are on GHCR at
`:spike` (needed an interactive `gh auth refresh -s write:packages` first;
without that scope every namespace fails `denied: permission_denied`; ttl.sh
as an anonymous fallback registry does not work from this network — blob
uploads stall). What remains is UI-only: GHCR packages default to PRIVATE and
GitHub has NO API to change package visibility. An org admin must open each
package (org Packages -> agenta-preview-<name> -> Package settings -> Danger
Zone -> Change visibility) and set Public. Then run:

```bash
docs/design/railway-preview-clone-spike/spike/switch-template-to-ghcr-images.sh --deploy
```

It is pull-gated (refuses while any package is private), switches the three
services to the GHCR images, CLEARS the Option B startCommand overrides so the
images' own entrypoints are what deploys, and (with `--deploy`) redeploys them
in the template for a health check. Finish with one patch-mode cycle (phase 3
command) to certify the registry-backed path end to end.

**Option B — registry-free startCommand wrappers (what the live spike runs):**
Railway's start command overrides the image ENTRYPOINT in exec form, so the
wrapper behavior fits in template config on PUBLIC base images — no registry
at all:

```bash
docs/design/railway-preview-clone-spike/spike/apply-wrapper-startcommands.sh
```

This points redis at `redis:8` + a chown-then-delegate startCommand,
seaweedfs at `chrislusf/seaweedfs:4.37` + the base64-inlined IAM entrypoint,
and gateway at `nginx:1.27-alpine` + the base64-inlined nginx.conf (plus a
`PORT=8080` service variable). Idempotent; 4 mutations. Keep
`spike/images/*` and this script in sync — both derive from
`hosting/railway/oss/`.

The alembic service needs no wrapper: its `create_databases.py` step is
replaced by an inline `psql` start command (the api image ships
`postgresql-client-17`), so per-PR image patching keeps working for it.

**Deprecated fallback (`railway up` into the template — findings Q11):** the
live run showed clones CANNOT deploy upload-built sources (`Deployment not
found` for gateway; redis/seaweedfs silently fall back to their plain base
images). `preview-cycle.sh --gateway-up-interim` (a per-clone
`railway up` of `spike/images/gateway`) remains as an escape hatch only.

## Phase 1 — build the template environment (one-time) — BLOCKED ON TOKEN

Creates throwaway project `agenta-oss-clone-spike` with environment
`pr-template`: 13 image-backed services, 3 volumes, variables, healthchecks,
plus the GraphQL fixups (start commands + wrapper env as service variables).

```bash
# With prebuilt wrapper images (phase 0.2):
export AGENTA_GATEWAY_IMAGE="$NS/agenta-spike-gateway:v1"
export RAILWAY_REDIS_WRAPPER_IMAGE="$NS/agenta-spike-redis:v1"
export RAILWAY_SEAWEEDFS_WRAPPER_IMAGE="$NS/agenta-spike-seaweedfs:v1"
# ...or leave all three unset to use the `railway up` fallback (see phase 0.2).

docs/design/railway-preview-clone-spike/spike/build-template-env.sh

# Option B (registry-free): run the plain build above (fallback mode is fine),
# then reshape gateway/redis/seaweedfs onto public base images + startCommand
# wrappers:
docs/design/railway-preview-clone-spike/spike/apply-wrapper-startcommands.sh
```

The `railway` CLI is required (`npm i -g @railway/cli`, or shim it with
`npx --yes @railway/cli`).

The template is intentionally left **undeployed** — whether an undeployed
template clones into a deployable environment is spike question Q5
(`findings.md`). To debug the template itself, re-run with `--deploy`, which
triggers all 13 deploys and smoke-tests the template env.

Requires the `railway` CLI (`npm i -g @railway/cli`) and `jq`.

## Phase 2 — one preview cycle

```bash
docs/design/railway-preview-clone-spike/spike/preview-cycle.sh --image-tag latest
```

- `--keep` skips the delete so you can inspect the clone in the dashboard
  (delete it afterwards, or the next 10-cycle run still works — clones get
  unique names).
- `--image-tag pr-1234-abc1234` exercises a real PR tag from GHCR.

Watch for the `unmergedChangesCount` warning: if it fires, image patches are
being staged rather than applied and findings Q7 has its answer.

## Phase 3 — ten consecutive cycles

```bash
# Winning mode (measured 2026-08-02): patch. MUST use an image tag that
# differs from the template's (:latest no-ops the patch — findings, deploy-mode
# section). Use a real pr-<n>-<sha> tag:
docs/design/railway-preview-clone-spike/spike/preview-cycle.sh \
    --image-tag pr-5651-a46168f --deploy-mode patch --cycles 10
column -s, -t docs/design/railway-preview-clone-spike/spike/results/cycle-log.csv
```

- Measured budgets per cycle (2026-08-02): patch mode = 8 mutations, ~16
  total calls, ~55s; per-service mode = 23 mutations, ~32 total calls, ~65s.
  `--deploy-mode triggers` is a dead end (`environmentTriggersDeploy`
  requires `serviceId`; no whole-env deploy exists).
- Rate budget: the Hobby token allows 1,000 requests/hour. A 10-cycle patch
  run costs ~160 calls. Debug sessions add up fast; when a call returns 429
  the lib honors `Retry-After` (120s waits), but a burst of 429s means the
  hour's budget is spent — pause the run rather than letting retries exhaust
  (an exhausted retry fails the cycle).
- Cycles are independent: a failed cycle records `fail` in the CSV and the
  next one starts fresh, so a single flake does not abort the evidence run.

## Phase 4 — CI auth check

```bash
# On a branch (never main), copy the workflow into place:
cp docs/design/railway-preview-clone-spike/spike/ci-auth-check.yml \
   .github/workflows/ci-auth-check.yml
# Commit + push the branch (workflow_dispatch requires the file on a pushed ref),
# then dispatch:
gh workflow run railway-clone-spike-auth-check --ref <branch>
gh run watch
```

The job proves the shared `secrets.RAILWAY_TOKEN` can authenticate at account
level, clone the template env, and delete the clone from a GitHub runner, and
it prints the rate-limit headers so we learn the token's real budget tier.
Delete the workflow file from the branch when done.

## Teardown

Delete the throwaway project (removes all environments, services, volumes,
and domains):

```bash
source docs/design/railway-preview-clone-spike/spike/lib-graphql.sh
rw_require_token
project_id="$(rw_find_project_id agenta-oss-clone-spike)"
rw_graphql 'mutation($id: String!) { projectDelete(id: $id) }' \
  "$(jq -nc --arg id "$project_id" '{id: $id}')"
```

Also delete the pushed `agenta-spike-*` wrapper images from the registry if
they were pushed to a shared namespace, and remove
`~/.agenta-railway.env` when the spike is finished if the token was minted
just for it (revoke it in the Railway dashboard too).
