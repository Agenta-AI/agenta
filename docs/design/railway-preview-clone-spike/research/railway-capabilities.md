# Railway platform capabilities relevant to clone-based previews

Researched 2026-08-02 from Railway docs and community threads. Verify anything marked
uncertain during the spike.

## Environment duplication (the strongest fit)

- CLI: `railway environment new pr-123 --duplicate <source>` (alias `--copy`);
  `railway environment delete <name> -y` tears it down. This is Railway's own
  documented CI recipe for PR environments
  (https://docs.railway.com/guides/github-actions-pr-environment,
  https://docs.railway.com/cli/environment).
- GraphQL: `environmentCreate(input)` with `projectId`, `name`,
  `sourceEnvironmentId` (clones variables and settings), `ephemeral`,
  `skipInitialDeploys`, `stageInitialChanges`; `environmentDelete(id)` removes the
  environment and all deployments (https://docs.railway.com/guides/manage-environments).
- Duplication copies services, variables, and configuration. Volumes are recreated
  (empty unless the newer volume-data-copy option applies; exact semantics
  uncertain).
- Known failure mode: `environmentCreate` returned HTTP 504 while the environment was
  still created in the background (station thread, marked resolved 2025-09-08).
  Client pattern: create → on timeout, poll `environments` by name → proceed.

## Per-PR image tags

- There is no CLI command to update a service's image (railwayapp/cli#815 open).
- The API path is `serviceInstanceUpdate` (set `source.image`, scoped to the
  environment) followed by `serviceInstanceDeployV2`; updating the image alone does
  not redeploy.
- Native PR environments cannot substitute a per-PR image tag at creation time, so
  the clone-then-patch flow is required either way.

## Native PR environments (not a direct fit)

- Toggle in project settings; Railway auto-creates an environment per PR against the
  linked GitHub repo and deletes it on merge/close. Variables copy except sealed
  ones; volumes come up fresh; bot PRs skipped by default; fork PRs from outside the
  workspace are not deployed.
- The trigger is repo-centric: repo-connected services build the PR branch. Behavior
  for a project whose services are all Docker-image sources is undocumented; assume
  it does not fit our GHCR-image stack without the follow-up patch step, and verify
  empirically if we ever want the native trigger.

## Config-as-code and templates

- `railway.json`/`railway.toml` is single-service only (build/deploy settings; has a
  special `"pr"` environment override block). It cannot declare services, variables,
  volumes, or images (https://docs.railway.com/config-as-code/reference).
- Templates can define a full multi-service stack (images incl. private registries,
  volumes, variables with generators, reference variables). Programmatic
  instantiation is `templateDeployV2` with a `serializedConfig` you control, which is
  the one path that natively supports per-PR image tags in a single deploy call.
  Caveat: thin docs, higher schema-drift risk. This is the fallback if clone
  fidelity fails.

## Public GraphQL API

- Endpoint `https://backboard.railway.com/graphql/v2`; account, workspace, or project
  tokens. Introspection enabled; effectively "the dashboard's API": broad but not
  contract-stable.
- Documented rate limits: Free 100 requests/hour; Hobby 1,000 RPH / 10 RPS; Pro
  10,000 RPH / 50 RPS; standard `X-RateLimit-*` and `Retry-After` headers.
- Operations the CLI lacks or does worse: `environmentCreate` with source,
  `serviceCreate` with image source and inline variables, `serviceInstanceUpdate`,
  `serviceInstanceDeployV2`, `volumeCreate`, `templateDeployV2`, bulk
  `variableCollectionUpsert`. Nothing is documented as idempotent; idempotency must
  be built client-side (query by name first).

## Auth constraints that bit us before (spike must re-verify in CI)

- Environment creation requires an account-scoped token; workspace and project
  tokens do not work for it, and the CLI rejects workspace tokens outright
  (railwayapp/cli#618).
- `RAILWAY_TOKEN` is treated as project-scoped by the CLI; the account token must be
  passed as `RAILWAY_API_TOKEN` (#4392 regression).
- CLI `environment delete` hangs on accounts with 2FA in non-interactive contexts;
  use GraphQL for deletion.
- Fork PRs do not receive repo secrets, so previews for external contributors remain
  out of scope exactly as today.
