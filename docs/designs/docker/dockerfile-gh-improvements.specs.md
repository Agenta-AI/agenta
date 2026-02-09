# Dockerfile.gh Improvement Spec (API, Services, Web)

## Scope

This spec covers:
- `application/api/oss/docker/Dockerfile.gh`
- `application/api/ee/docker/Dockerfile.gh`
- `application/services/oss/docker/Dockerfile.gh`
- `application/services/ee/docker/Dockerfile.gh`
- `application/web/oss/docker/Dockerfile.gh`
- `application/web/ee/docker/Dockerfile.gh`

## Goals

- Reduce final image size.
- Reduce build time and CI churn.
- Improve runtime security posture.
- Keep behavior unchanged unless explicitly noted.

## Cross-Cutting Improvements (All Targets)

1. Use smaller runtime stages
- Keep build tools (Poetry, pnpm, turbo, compilers, jq) in build-only stages.
- Final runtime image should contain only runtime binaries, app code, and runtime dependencies.

2. Run as non-root user
- Create and switch to an unprivileged user in runtime stages.
- Keep ownership via `COPY --chown=...`.

3. Use strict dependency scope for production
- Python: install only runtime deps (`--only main`).
- Node: ensure runtime stage does not carry dev tooling.

4. Improve build context hygiene
- Add or tighten `.dockerignore` in `api` and `services` (none currently).
- Expand `web/.dockerignore` to exclude non-build files/directories.

5. Standardize metadata and reproducibility
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
- Current image includes `cron` + `postgresql-client-16` because one image is reused for api/workers/cron/migrations.
- Option 1: keep one image (lowest risk), but use `--no-install-recommends` and trim packages.
- Option 2: split cron/migration into dedicated images so main API runtime drops unnecessary system packages.

5. Remove debug/build-verification layers in production image
- `RUN cat -A /etc/cron.d/...` and SDK check `python -c ...` should be optional (debug build arg) or removed.

6. Keep local SDK override optional
- `COPY ./sd[k] /app/sdk/` and editable install can bloat release images.
- Gate with `ARG INCLUDE_LOCAL_SDK=false` for GH release builds.

### C. Hygiene

7. Add `application/api/.dockerignore`
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

3. Optional local SDK override
- Keep local SDK workflow available for local integration but off by default for GH images.

### B. Medium Impact

4. Add non-root runtime user
- Run Gunicorn/Uvicorn as non-root in runtime stage.

5. Add `.dockerignore` for `application/services`
- Exclude test caches, git metadata, and local-only files.

### C. Architecture Cleanup

6. De-duplicate OSS/EE Dockerfiles
- `services/oss/docker/Dockerfile.gh` and `services/ee/docker/Dockerfile.gh` are identical.
- Replace with one shared Dockerfile + build arg if possible.
- Benefit: fewer drift bugs and simpler maintenance.

## Web Dockerfile.gh Improvements

### A. Critical (Highest Impact)

1. Do not derive `runner` from `base`
- Current state: `base` does `COPY . .`, global tool installs, turbo prune; `runner` uses `FROM base`.
- Result: final runtime image likely carries full source tree and build tooling.
- Change: use a minimal runtime stage (`FROM node:20.18.0-slim` or distroless Node) and copy only Next standalone output + static assets + entrypoint.

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

7. Non-root runtime user
- Run Next server with unprivileged user and owned app directory.

8. Reduce telemetry/noise in all stages
- Set `NEXT_TELEMETRY_DISABLED=1` and keep telemetry-disable commands deterministic.

## Prioritized Rollout Plan

1. Web critical stage fix (`runner` no longer from `base`).
2. API + Services production-only dependency install (`--only main`) and multi-stage conversion.
3. Add `.dockerignore` for API/Services; expand Web `.dockerignore`.
4. Non-root runtime users across all final images.
5. Optional: split API cron/migration image responsibilities for further size/security gains.

## Validation Checklist

- Build all GH images successfully (OSS + EE for api/services/web).
- Verify runtime commands still work in compose GH stacks.
- Compare image sizes before/after:
  - `docker image ls`
  - `docker history <image>`
- Smoke checks:
  - API responds and workers start.
  - Services responds.
  - Web serves standalone app.
- Confirm no dev dependencies remain in production images.

## Notes on Risk

- Lowest-risk immediate wins:
  - `--only main` for Poetry installs.
  - Web runner stage isolation.
  - `.dockerignore` improvements.
- Higher-risk changes:
  - Splitting API image roles (api vs cron vs migration) due to compose/service coupling.
