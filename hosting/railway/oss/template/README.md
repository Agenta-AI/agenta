# Railway preview template (template-as-code)

Per-PR preview environments on Railway are created by **cloning a template
environment** (design: issue #5650; live proof:
`docs/design/railway-preview-clone-spike/`). This directory makes that template
code in the repo:

- `template.json` — the full definition of the template environment: 14
  services with images (tags parameterized), startCommands, restart policies,
  volumes, healthcheck policy, deploy-ordering constraints, and every managed
  variable by NAME. It contains **no secret values**.
- `apply.sh` — idempotent converge of a live environment to the definition,
  driving Railway's GraphQL API. `--dry-run` prints a structured diff and exits
  nonzero (2) on drift; the default mode applies the delta.
- `lib-graphql.sh` — the GraphQL client (redaction, bounded retries, call
  accounting). Shared single copy: `apply.sh` and the preview lifecycle
  scripts (`../scripts/preview-clone-{create,destroy}.sh`) all source it.
- `.github/workflows/47-railway-template-drift.yml` — daily scheduled
  `apply.sh --dry-run` against the template; fails loudly on drift.

The template lives in project `agenta-oss-clone-spike`, environment
`pr-template`. The CI workflows (41/43/45) resolve the same location from the
repo variables `RAILWAY_TEMPLATE_PROJECT` / `RAILWAY_TEMPLATE_ENV` (falling
back to these values), and the preview scripts accept the same names as env
vars. Moving the template to another project therefore needs no logic change:
converge the new project's environment with `apply.sh --project`, then update
`project` in `template.json` and the two repo variables.

## How to change the template

Template changes are **pull requests**, exactly like DB migrations, and follow
the same additive-first discipline:

1. **Edit `template.json` in a PR.** Never hand-edit the template in the
   Railway dashboard: the drift check will page on it, and hand-edits are not
   reviewable or reproducible.
2. **Order changes additive-first relative to code PRs.** A new variable or
   service lands in the template *before* the code that requires it (old code
   ignores the extra config); removal lands *after* no supported code path
   needs it. This keeps every open PR's clone deployable throughout.

   A service added here does not reach existing clones until step 4 runs, so
   `preview-clone-create.sh` treats the names in its `OPTIONAL_SERVICES` list
   as skippable: a clone made from the not-yet-converged template deploys
   without them instead of failing on a missing `serviceId`. Add a new service
   to that list in the same PR, and drop it once the template is applied.
3. **Test on a clone first.** Create a scratch clone of `pr-template` (or reuse
   a preview clone), then converge *it* against your edited definition:

   ```bash
   hosting/railway/oss/template/apply.sh --env-name my-scratch-clone
   ```

   Deploy/smoke the clone before touching the template itself.
4. **Apply on merge.** After the PR merges, run `apply.sh` (no flags) against
   the template. Until this step runs, the daily drift check fails by design —
   a merged-but-unapplied definition IS drift.
5. **Drift check catches hand-edits.** Workflow 47 runs `--dry-run` daily.
   When it fails: if the live change was accidental, run `apply.sh` to revert
   it; if it was intentional, fold it into a PR that updates `template.json`,
   merge, and the next run goes green.

## Running apply locally

```bash
# Diff only (exit 0 clean / 2 drift / 1 error). Never mutates.
hosting/railway/oss/template/apply.sh --dry-run

# Converge the template to the committed definition.
hosting/railway/oss/template/apply.sh

# Converge a named environment (e.g. a scratch clone for testing a change).
hosting/railway/oss/template/apply.sh --env-name my-scratch-clone

# Override image tag parameters (see "Image tags" below).
hosting/railway/oss/template/apply.sh --app-tag v0.109.0
```

Auth: an **account** token in `RAILWAY_API_TOKEN` (auto-sourced from
`~/.agenta-railway.env`; in CI, exported from `secrets.RAILWAY_TOKEN`). Never
name the variable `RAILWAY_TOKEN` — the Railway CLI treats that name as
project-scoped and account-level calls fail Unauthorized.

Cost: a dry-run is ~18 API calls (instances + volumes in one query, plus one
variables query per service) against the token's 1000/hour Hobby budget.

## Image tags

Four tag parameters in `template.json`:

- `app_tag` — the five Agenta app images (`agenta-api`, `agenta-web`,
  `agenta-web-mobile`, `agenta-services`, `agenta-runner`), pinned to a release
  tag. Clones patch these to `pr-<n>-<sha>` tags per PR via
  `environmentPatchCommit`. Overridable via `--app-tag` or
  `AGENTA_TEMPLATE_APP_TAG`. **`agenta-web-mobile` was first published at
  `v0.111.0`**, so an `app_tag` older than that leaves `web-mobile` unable to
  pull its image; keep the parameter on a release that shipped all five.
- `gateway_tag` / `redis_tag` / `seaweedfs_tag` — one content-addressed tag
  per preview wrapper image
  (`ghcr.io/agenta-ai/agenta-preview-{gateway,redis,seaweedfs}`, built by
  workflow 42 from `../images/{gateway,redis,seaweedfs}/`). The definition is
  the source of truth; `--wrapper-tag` / `AGENTA_PREVIEW_WRAPPER_TAG` remains
  as an override that forces all three to one tag.

**Template tags must never be `latest` and never a `pr-*` tag.**
`environmentPatchCommit` silently no-ops when a patched image:tag equals the
template's, which strands a clone on template images (proven live; see
findings.md "deploy-mode findings"). `apply.sh` refuses both.

### Regenerating wrapper content tags

The wrapper tags are content-addressed: `content-<12 hex>` derived from a
deterministic hash of the image source directory. When a wrapper source
changes (Dockerfile, nginx.conf, an entrypoint script), the tag changes with
it and the pinned default here goes stale. To update:

1. Recompute the tag for the changed wrapper:

   ```bash
   hosting/railway/oss/images/compute-tag.sh hosting/railway/oss/images/gateway
   ```

2. Let CI build and push it: the `wrapper-images` job in workflow 42
   (`.github/workflows/42-railway-build.yml`) computes the same tag, builds
   the image when that tag does not exist in GHCR yet, and pushes it.
3. Update the matching `*_tag` default in `template.json` (same PR as the
   wrapper source change), then run `apply.sh` after merge as usual.

Only the changed wrapper's tag moves; the other two stay pinned. Unchanged
sources hash to the already-published tag, so re-running the flow is a no-op.

## Secrets and variable conventions

`template.json` stores variables in three shapes:

- **Reference values** (contain `${{...}}`) are per-environment-unique:
  Railway re-resolves them inside every clone (e.g.
  `https://${{gateway.RAILWAY_PUBLIC_DOMAIN}}`, `${{Postgres.POSTGRES_PASSWORD}}`).
- **Literal values** are shared, non-secret config (ports, internal URLs,
  `AGENTA_LICENSE=oss`), byte-identical in template and clones.
- **Secrets** appear as `{"secret": "NAME"}` referencing the top-level
  `secrets` map, which declares only the *resolution*, never the value:
  `from_env` (operator-provided env var wins) and `generate` (e.g.
  `openssl-rand-hex-32`, `openssl-genpkey-rsa-2048`). At apply time a secret is
  resolved only when a variable is missing live, preferring the value already
  live on a sibling service (so shared secrets stay consistent), and is never
  printed — diff output carries variable **names only**.

`optionalVariables` lists names an operator may set without tripping the drift
check (e.g. `POSTHOG_API_KEY`, `AGENTA_RUNNER_DAYTONA_*`). Any other
undeclared variable is drift and is deleted by apply. Railway-injected
`RAILWAY_*` variables are ignored unless explicitly declared (the definition
declares `RAILWAY_RUN_UID/GID` on redis and
`RAILWAY_DEPLOYMENT_DRAINING_SECONDS` on Postgres, which are user-set).

## What apply will and will not do

| Drift | dry-run | apply |
|---|---|---|
| Missing service | reported | `serviceCreate` (check-then-act + verify poll) |
| Image mismatch | reported | `serviceInstanceUpdate` |
| startCommand violation | reported | cleared with `""` (API fact: `null` is a no-op) or set |
| Restart-policy mismatch | reported | `serviceInstanceUpdate` |
| Missing variable | name reported | `variableCollectionUpsert` (skipDeploys, merge) |
| Undeclared variable | name reported | `variableDelete` |
| Missing volume | reported | `volumeCreate` (check-then-act) |
| **Extra service / extra volume** | reported | **never deleted** — destructive; remove manually via a documented PR, then re-run |

Apply changes **configuration only**; it never triggers deployments (template
deployments are irrelevant to clones — clones copy config, not deployments).

## Policy notes

- **startCommand:** services whose image owns its entrypoint (Postgres,
  supertokens, and the three wrapper images) must have it empty/unset. The
  nine app services carry explicit startCommands because one image backs
  several services (`agenta-api` alone backs api, worker-streams,
  worker-queues, cron, alembic) and because `web` and `web-mobile` share an
  entrypoint but start different servers.
- **Mobile app:** `web-mobile` serves `/m`. The gateway routes `/m` and `/m/*`
  to it with **no** prefix strip, because the Next app is built with
  `basePath: "/m"` and owns the prefix. Preview gate policy: `web` sets
  `AGENTA_MOBILE_GATE=true` so a phone is redirected from a desktop route to
  `/m`, and `web-mobile` sets `AGENTA_MOBILE_REVERSE_GATE=false` so a reviewer
  on a laptop can open `/m` directly.
- **Healthchecks:** set only on `api` and `services`, which both serve
  `/health`. Two services have none on purpose, and `../scripts/configure.sh`
  clears the same two.
  - `gateway`: it proxies `/` to `web`, and the web app answers `/` with a 308
    redirect to `/w` (`web/oss/next.config.ts`). Railway counts a 308 as a
    failed probe, so a healthcheck on `/` never goes green and the gateway
    deployment of every clone ends FAILED. The gateway can carry a healthcheck
    again once the wrapper image serves its own 200 endpoint (for example
    `location = /healthz`), which needs a new `gateway_tag`.
  - `runner`: it serves `/health`, but on `AGENTA_RUNNER_PORT` (8765), not on
    the port Railway probes, so Railway cannot reach it. Dropped in 9fcbcec9d6.

  Adding a healthcheck to any other service is a deliberate change to
  `template.json`, not silent drift.
- **Deploy order** (for anything deploying a fresh clone): infra
  (Postgres/redis/seaweedfs) → alembic → everything else; supertokens must not
  start before alembic has created its database. A single Postgres
  first-deploy timeout in a fresh clone is retryable, not fatal.
