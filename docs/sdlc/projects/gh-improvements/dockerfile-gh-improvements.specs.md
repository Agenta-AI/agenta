# Dockerfile.gh Improvement Spec (API, Services, Web)

## Scope

This spec covers:
- `api/oss/docker/Dockerfile.gh`
- `api/ee/docker/Dockerfile.gh`
- `services/oss/docker/Dockerfile.gh`
- `services/ee/docker/Dockerfile.gh`
- `web/oss/docker/Dockerfile.gh`
- `web/ee/docker/Dockerfile.gh`

## Goals

- Preserve GH compose compatibility and runtime command behavior.
- Reduce final image size.
- Reduce build time and CI churn.
- Keep behavior unchanged unless explicitly noted.

## Implementation Status (Current Branch)

### Cross-Cutting Improvements
- [x] 1. Use smaller runtime stages.
- [x] 2. Use strict dependency scope for production.
- [x] 3. Improve build context hygiene.
- [x] 4. Standardize metadata and reproducibility.

### API Improvements
- [x] A1. Multi-stage Python build.
- [x] A2. Install only main dependency group.
- [x] A3. Remove build-only tooling from runtime.
- [x] B4. Reassess apt dependencies for shared API image (`--no-install-recommends`, keep shared image model).
- [x] B5. Remove debug/build-verification layers in production image.
- [x] B6. Keep local SDK override enabled for GH builds.
- [x] C7. Add `api/.dockerignore`.
- [x] C8. Consolidate RUN layers for cron setup.

### Services Improvements
- [x] A1. Multi-stage Python build.
- [x] A2. Install only runtime dependency group.
- [x] B4. Add `.dockerignore` for `services`.

### Web Improvements
- [x] A1. Do not derive `runner` from `base`.
- [x] A2. Split stages into `pruner` -> `builder` -> `runner`.
- [x] B3. Remove apt `jq` dependency.
- [x] B4. Improve `.dockerignore`.
- [x] B5. Use Corepack for pnpm.
- [x] C6. Avoid unnecessary files in builder (`.husky` no longer copied).
- [x] C7. Reduce telemetry/noise in all stages.

### Validation Status
- [ ] Full GH image build + compose runtime validation checklist (defined below) has not been executed in this branch yet.

## Cross-Cutting Improvements (All Targets)

1. Use smaller runtime stages
- Keep build tools (Poetry, pnpm, turbo, compilers, jq) in build-only stages.
- Final runtime image should contain only runtime binaries, app code, and runtime dependencies.

2. Use strict dependency scope for production
- Python: install only runtime deps (`--only main`).
- Node: ensure runtime stage does not carry dev tooling.

3. Improve build context hygiene
- Add or tighten `.dockerignore` in `api` and `services` (none currently).
- Expand `web/.dockerignore` to exclude non-build files/directories.

4. Standardize metadata and reproducibility
- Add OCI labels (`org.opencontainers.image.*`).
- Pin package manager versions and avoid dynamic install drift.

## API Dockerfile.gh Improvements

### A. High Impact

1. Multi-stage Python build
- Current state: single stage keeps Poetry and install caches in runtime.
- Change: use a `builder` stage for dependency resolution and a lean `runtime` stage.
- Expected impact: meaningful image-size reduction and cleaner runtime surface.

2. Install only main dependency group
- Current state: `poetry install --no-interaction --no-ansi` includes dev group.
- Change: `poetry install --only main --no-root --no-interaction --no-ansi`.
- Expected impact: removes test/dev dependencies from production image.

3. Remove build-only tooling from runtime
- Remove Poetry from final image by moving installs into builder and copying installed site-packages/venv.
- If single-stage retained temporarily: uninstall Poetry and clear `/root/.cache/*` after install.

### B. Medium Impact

4. Reassess apt dependencies for shared API image
- Current image includes `cron` + `postgresql-client-17` because one image is reused for api/workers/cron/migrations.
- Keep one image model for GH compose compatibility.
- Use `--no-install-recommends` and trim packages without changing service/runtime responsibilities.

5. Remove debug/build-verification layers in production image
- `RUN cat -A /etc/cron.d/...` and SDK check `python -c ...` should be optional (debug build arg) or removed.

6. Keep local SDK override enabled for GH builds
- `COPY ./sd[k] /app/sdk/` and editable install can bloat release images.
- GH images should continue preferring the local SDK override when present.
- Do not gate this behind a default-off build arg for GH release builds.

### C. Hygiene

7. Add `api/.dockerignore`
- Suggested excludes: `.git`, `.pytest_cache`, `.ruff_cache`, `tests`, docs, local env files, build artifacts.

8. Consolidate RUN layers
- Combine cron file setup commands to reduce image layers and improve caching behavior.

## Services Dockerfile.gh Improvements

### A. High Impact

1. Multi-stage Python build (same pattern as API)
- Current state: single stage with Poetry installed in runtime.
- Change: builder installs deps, runtime copies only installed runtime artifacts + app code.

2. Install only runtime dependency group
- Use `poetry install --only main --no-root --no-interaction --no-ansi`.
- Remove dev/test dependencies from runtime.

### B. Medium Impact

4. Add `.dockerignore` for `services`
- Exclude test caches, git metadata, and local-only files.

## Web Dockerfile.gh Improvements

### A. Critical (Highest Impact)

1. Do not derive `runner` from `base`
- Current state: `base` does `COPY . .`, global tool installs, turbo prune; `runner` uses `FROM base`.
- Result: final runtime image likely carries full source tree and build tooling.
- Change: use a minimal runtime stage (`FROM node:20.18.0-slim`) and copy only Next standalone output + static assets + entrypoint.

2. Split stages more intentionally
- Suggested stages: `pruner` -> `builder` -> `runner`.
- Keep prune/build artifacts isolated and avoid inheriting heavyweight layers into runtime.

### B. High Impact

3. Remove apt `jq` dependency
- Current state parses packageManager with `jq` requiring `apt-get install jq`.
- Change: parse with Node (`node -p`) or use Corepack directly.
- Benefit: fewer system packages and faster builds.

4. Improve `.dockerignore`
- Current file excludes some caches but should also exclude `.git`, docs, screenshots, local env files, CI artifacts, and other non-build assets.

5. Use Corepack for pnpm
- Prefer `corepack enable && corepack prepare pnpm@<version> --activate`.
- Avoid global `npm install -g pnpm` and potential drift.

### C. Medium Impact

6. Avoid unnecessary files in builder
- Reassess `COPY ./.husky /app/.husky`; likely not needed for production build.
- Ensure only pruned graph files are copied into install/build layers.

7. Reduce telemetry/noise in all stages
- Set `NEXT_TELEMETRY_DISABLED=1` and keep telemetry-disable commands deterministic.

## Validation Checklist

- Build all GH images successfully (OSS + EE for api/services/web).
- Verify runtime commands still work in GH compose stacks without command changes:
  - Web entrypoint + server startup (`/app/entrypoint.sh`, `node ./oss/server.js` or EE equivalent).
  - API gunicorn startup.
  - API worker startups.
  - `cron -f` startup and cron file execution paths.
  - Alembic/migration container execution.
- Compare image sizes before/after:
  - `docker image ls`
  - `docker history <image>`
- Smoke checks:
  - API responds and workers start.
  - Local SDK override remains active when `sdk/` is present in build context.
  - Cron service stays healthy and scheduled tasks execute.
  - Alembic service completes successfully.
  - Services responds.
  - Web serves standalone app.
- Confirm no dev dependencies remain in production images.
