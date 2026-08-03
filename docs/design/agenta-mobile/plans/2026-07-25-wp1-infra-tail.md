# Agenta Mobile — WP1 Infra Tail: Prod Image CI + Compose Wiring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal**
Close the WP1 deferred infra items (README "Open items & gotchas", `docs/design/agenta-mobile/README.md:166-169`): (1) a CI workflow that build-verifies and (on dispatch) publishes the `web/mobile/docker/Dockerfile.gh` image — which has **never been built** (commit `b44cbee4`, "Image build deferred to a gh CI run"); (2) a runtime fix the grounding audit found in that unbuilt image (the shared entrypoint cannot write `__env.js` as the non-root user); (3) `web-mobile` service blocks in all five prod/gh compose files (oss gh, oss gh.ssl, oss gh.local, ee gh, ee gh.local — **an ee ssl file does not exist**, see grounding fact G6); (4) `run.sh` awareness (`--with-mobile`) + env-file image-var entries; (5) a CI typecheck job for `@agenta/mobile` (lint and `@agenta/chat` tests turn out to be **already wired** — see G3/G5, verify-only tasks).

**Architecture**
- **New workflow file, not edits to shared ones.** Workflows are organized in numbered bands (`0x` releases, `1x` PR checks, `3x` crons, `4x` railway). The mobile image build + typecheck land as a new `17-check-mobile.yml` in the checks band. Rationale: `42-railway-build.yml` and `11-check-code-styling.yml` are heavily shared (the FE PR queue and railway pipeline touch them); adding a file has zero merge-conflict surface, and the numbered-band convention explicitly accommodates new checks. The job mirrors `42`'s image conventions exactly (per-arch matrix → registry buildcache → manifest merge, `ghcr.io/agenta-ai/<name>` naming, `pr-<n>-<sha>`/`manual-<sha>` tags, non-root verification).
- **Image name `agenta-web-mobile`** — matches the Dockerfile's own OCI title label (`web/mobile/docker/Dockerfile.gh:71`) and the sibling scheme (`agenta-web`, `agenta-api`, …). The mobile app is edition-agnostic (one image serves OSS and EE), so the **EE compose default is the same public image**, not an `internal-ee-*` one — the code it ships is OSS-repo code; operators can still override via `AGENTA_WEB_MOBILE_IMAGE_NAME`.
- **PR runs build both arches natively (no push) + container smoke** (`curl /m`, `/m/__env.js`, image size to the step summary). **`workflow_dispatch` with `push=true` pushes** per-arch tags and stitches the manifest, optionally also `:latest`. Nothing in this repo's CI pushes `:latest` for any prod image today (G2), so `:latest` publication is an explicit dispatch, documented in the rollout runbook task.
- **Compose command decision: explicit `command: sh -c "node ./mobile/server.js"` in every compose block, keeping the baked `CMD`.** Rationale: (a) consistency — every `web` service in these five files carries an explicit command, and the oss/ee gh images *require* one (their Dockerfile has no `CMD`, G7), so an uncommanded service would read as an omission; (b) the compose file stays self-documenting about what runs; (c) the baked `CMD` (justified in `b44cbee4`) still serves bare `docker run`, the CI smoke, and future k8s/railway contexts. No conflict — they agree.
- **Opt-in profile `with-web-mobile` in all five prod files** (dev files keep `with-web`, already shipped in `bd4671ad`). Rationale: prod `web-mobile` must not auto-start for existing self-hosters — before the first dispatch-push, `ghcr.io/agenta-ai/agenta-web-mobile:latest` does not exist and `docker compose up`/`pull` would fail the whole stack; and the mobile app is pre-GA (no auth until WP2, no device gate until WP5). `run.sh --with-mobile` activates it. Flip to `with-web` at mobile GA.

**Tech Stack**
GitHub Actions (`docker/build-push-action@v6`, `docker/setup-buildx-action@v4`, `docker/login-action@v3`, `actions/checkout@v6`, `pnpm/action-setup@v4`, `actions/setup-node@v4` — the exact versions in use in `42`/`11`), BuildKit registry cache, Docker Compose + Traefik v2, bash (`run.sh`), turbo (`types:check` task graph already declared for `@agenta/mobile` in `web/turbo.json`).

**Operator requirements (Arda, 2026-07-26) — binding for this plan**

1. **Mobile is NEVER forced on anyone.** OSS self-hosters and EE self-hosters get mobile only
   by explicit opt-in at container-start time. This plan satisfies that with the
   `with-web-mobile` compose profile + `run.sh --with-mobile` (nothing pulls or starts the
   mobile image otherwise), and WP5's `AGENTA_MOBILE_GATE` (default off) keeps redirect
   behavior opt-in even where the container runs. One known asymmetry to be aware of: the DEV
   compose files (from WP1-P5) put `web-mobile` on the `with-web` profile, so contributor dev
   stacks auto-start it — deliberate DX for people working on mobile, cheap to flip to the
   opt-in profile if undesired (one-line change per dev file; decision: keep as-is unless Arda
   says otherwise).
2. **Production reality (verified against `Agenta-AI/agenta_cloud`, 2026-07-26):** the hosted
   product (`https://eu.cloud.agenta.ai`, staging `https://testing.preview.agenta.dev`, plus
   demo/staging/oss preview stages) deploys from the private `agenta_cloud` repo: its
   `63-build.yml` **checks out THIS public repo** at a chosen branch, overlays private
   scripts, builds `./web/${LICENSE}/docker/Dockerfile.gh` via `scripts/ci/build.sh
   --service web` → **AWS ECR** `internal-{license}-agenta-web`, and per-stage deploy
   workflows run `hosting/docker-compose/docker-compose.application.yml` on EC2 (Traefik,
   web router = `Host(${TRAEFIK_DOMAIN}) && PathPrefix(/)`, port 3000, + alias-domain
   routers). Consequences for mobile:
   - **This plan's `web/mobile/docker/Dockerfile.gh` is directly buildable by that pipeline
     once merged** — the cloud checkout gets it for free. The ghcr publication in this plan
     serves self-hosters; cloud will build its own ECR image.
   - **Cloud rollout = a small `agenta_cloud` change-set (separate PR, that repo):**
     (a) `scripts/ci/build.sh`: add a `web-mobile` service case — `BUILD_CONTEXT="./web"`,
     `DOCKERFILE="./web/mobile/docker/Dockerfile.gh"`, image `internal-agenta-web-mobile`
     (license-agnostic — one image for all stages; note the existing naming embeds license,
     so either accept `internal-{license}-agenta-web-mobile` per convention or special-case);
     (b) `63-build.yml`: add `web-mobile` to the build matrix; (c)
     `docker-compose.application.yml`: a `web-mobile` service mirroring `web`'s label
     pattern with `Host(${TRAEFIK_DOMAIN}) && PathPrefix(/m)` (wins over the web catch-all
     by rule length; alias-domain variants likewise), port 3000,
     `command: sh -c "node ./mobile/server.js"` with `working_dir: /app` (the mobile
     standalone layout nests as `/app/mobile/server.js` — unlike web's
     `working_dir: /app/${AGENTA_LICENSE}`); (d) stage env vars
     (`AGENTA_WEB_MOBILE_IMAGE_NAME/TAG` in the env.csv system) and, at gate-flip time,
     `AGENTA_MOBILE_GATE=true` on both `web` and `web-mobile`.
   - Compatibility: the mobile app is edition- and domain-agnostic (basePath routing, no
     Host assumptions); WP5 gate cookies are host-only `path=/`, coexisting with the
     parent-domain SuperTokens cookies on `.cloud.agenta.ai`/`.preview.agenta.dev`.

**Conventions for all commit steps:** run `git branch --show-current` first — if it prints `gitbutler/workspace`, use `but branch new <lane>` / `but commit <lane>` per root `AGENTS.md`; commands below assume plain git on `feat/agenta-mobile-wave-1`. Never include Claude/Anthropic/Co-Authored-By lines in commit messages. **Zero edits to OSS app source** (`web/oss/src`, `web/ee/src`, `web/packages/*` src) — this plan touches only `web/mobile/docker/`, `.github/workflows/` (new file), `hosting/docker-compose/`, and docs.

---

## Grounding facts (verified against the worktree, 2026-07-25)

- **G1 — image CI conventions.** The ONLY image-building workflow in this repo is `.github/workflows/42-railway-build.yml`. Conventions to mirror: matrix `image_name` × `arch` with per-service `context`/`dockerfile` includes — `agenta-web` builds `context: web`, `dockerfile: web/oss/docker/Dockerfile.gh` (42:125-127); runners `ubuntu-24.04` (amd64) / `ubuntu-24.04-arm` (arm64) (42:135-139); tags `ghcr.io/agenta-ai/<name>:<tag>-<arch>` (42:167); tag scheme `pr-<PR>-<shortsha>` / `manual-<shortsha>` computed in a `prepare` job (42:60-69); per-arch registry buildcache refs `buildcache-shared-<arch>` + `buildcache-<scope>-<arch>` (42:169-174); `provenance: false, sbom: false` (42:161-166); GHCR login with `GITHUB_TOKEN` (42:144-149); non-root runtime verification via `docker inspect --format='{{.Config.User}}'` (42:195-204); manifest stitch via `docker buildx imagetools create` in a separate `merge-manifests` job (42:234-245); `permissions: contents: read, packages: write` (42:34-36); concurrency group keyed on PR/ref (42:38-40). **No `BUILD_DATE`/`VCS_REF`/`VERSION` build-args and no turbo remote-cache secrets are passed anywhere in `.github/workflows/`** (grep clean) — the Dockerfile's `turbo_team`/`turbo_token` secret mounts are `required=false` (`web/mobile/docker/Dockerfile.gh:45-46`) and `web/docker/run-turbo-build.sh` falls back to local cache, so mirroring = omitting both.
- **G2 — no `:latest` pipeline.** No workflow in this repo builds or pushes `:latest`/release prod images (42 builds preview tags only, invoked per-PR by `14-check-pr-preview.yml:36-41`). Prod `:latest` images are published outside this repo's CI. Therefore `agenta-web-mobile:latest` needs an explicit dispatch-push (runbook, Task 7).
- **G3 — mobile lint is ALREADY in CI.** `11-check-code-styling.yml:74-96` (`eslint` job) runs `cd web && pnpm run lint` → `turbo run lint` (`web/package.json:57`) → every workspace package with a `lint` script, including `@agenta/mobile` (workspace member, `web/package.json:7`; task config `web/turbo.json` `@agenta/mobile#lint`), whose script chains `tokens:check` (`web/mobile/package.json:12`), and `@agenta/chat`. The prettier job's root glob also covers `web/mobile`. **No lint CI change needed — verify-only (Task 5).**
- **G4 — no web typecheck in CI at all.** `grep -rn "types:check\|tsc" .github/workflows/` matches nothing web-side (only the runner's own `pnpm run typecheck`, `12:372-375`). The turbo task `@agenta/mobile#types:check` exists with no dependencies (`web/turbo.json`). Node-setup pattern to mirror: `11:55-69` (pnpm/action-setup with `package_json_file: web/package.json`, node 24, pnpm cache keyed on `web/pnpm-lock.yaml`, `pnpm install --frozen-lockfile`).
- **G5 — `@agenta/chat` tests are ALREADY in CI.** `12-check-unit-tests.yml:122-125` runs `web/tests` `run-tests.ts --layer unit`, whose Phase 1 executes `pnpm -r --filter=!agenta-web-tests --if-present run test:unit` across all packages (`web/tests/playwright/scripts/run-tests.ts:200`); `@agenta/chat` defines `test:unit` (`web/packages/agenta-chat/package.json:13`) with a junit reporter at `./test-results/junit.xml` (`vitest.config.ts:7-9`), matching the publish glob `web/packages/*/test-results/junit.xml` (`12:133-135`). Same mechanism as `@agenta/entities`. **No CI change needed — verify-only (Task 5).**
- **G6 — compose landscape.** `hosting/docker-compose/oss/`: `docker-compose.gh.yml` (web: profile `with-web`, `image: ghcr.io/agenta-ai/${AGENTA_WEB_IMAGE_NAME:-agenta-web}:${AGENTA_WEB_IMAGE_TAG:-latest}`, `command: sh -c "node ./oss/server.js"`, router `web` `` PathPrefix(`/`) `` port 3000 — lines 4-27), `docker-compose.gh.ssl.yml` (web builds locally from `oss/docker/Dockerfile.gh`, labels add `` Host(`${TRAEFIK_DOMAIN}`) ``, `entrypoints=web,web-secure`, `tls=true`, `tls.certresolver=myResolver` — lines 4-28, network `agenta-gh-ssl-network`), `docker-compose.gh.local.yml` (web builds locally, otherwise gh-shaped). `hosting/docker-compose/ee/`: `docker-compose.gh.yml` (web: **no profile**, image default `internal-ee-agenta-web`, `command: sh -c "node ./ee/server.js"` — lines 13-31, network `agenta-ee-gh-network`), `docker-compose.gh.local.yml` (builds from `ee/docker/Dockerfile.gh`, which exists in this worktree). **There is NO `ee/docker-compose.gh.ssl.yml`** — the earlier assumption of "four files (… ee ssl)" is off by one reality; this plan covers the five files that exist and explicitly does not create an EE ssl stack. Env image vars live commented in `env.oss.gh.example:8-16` / `env.ee.gh.example:8-16`.
- **G7 — command/CMD split.** `web/oss/docker/Dockerfile.gh` has `ENTRYPOINT` but **no `CMD`** (82-83) — compose must supply the command, which is why every web block overrides it. `web/mobile/docker/Dockerfile.gh:77-79` bakes `ENTRYPOINT ["/app/entrypoint.sh"]` + `CMD ["node","mobile/server.js"]` + `EXPOSE 3000`.
- **G8 — latent entrypoint crash in the mobile image (found in this audit; the image was never run).** `web/entrypoint.sh:77` does `mkdir -p "${ENTRYPOINT_DIR}/${AGENTA_LICENSE}/public"` (→ `/app/oss/public`) under `set -e` (line 3), then writes `__env.js` there (184) and mirrors it into `mobile/public` (228-231). In the oss/ee images `/app/oss` exists (copied `--chown=agenta`), so the `mkdir -p` no-ops. In the mobile image the standalone output ships only `mobile/`; `/app` itself is created root-owned by `WORKDIR` (`Dockerfile.gh:56`) before `USER 10001` (69), so the `mkdir` gets `EACCES` and the container exits at startup. Fix in the mobile Dockerfile (Task 1) — **not** in the shared `web/entrypoint.sh`.
- **G9 — run.sh.** Stage selection `dev|gh.local|gh.ssl|gh` (`run.sh:309-317`); base compose file `docker-compose.<stage>.yml` per edition (343-347) + auto-included `*.local.yml` overrides (360-366); profiles appended at 427-439 (`with-web` only when `WEB_MODE=docker`); **shutdown enumerates all profiles explicitly** (526) — a new profile MUST be added there or its containers survive `down`; `--recreate/--rebuild` validate against the compose model resolved with active profiles (458-470); missing-env-file hard fail (414-419).
- **G10 — mobile app runtime shape.** `basePath: "/m"`, `output: "standalone"`, `outputFileTracingRoot` = `web/` so standalone nests as `.next/standalone/mobile/server.js`, `__env.js` forced `no-store` (`web/mobile/next.config.ts:10-36`); port 3000. `/` is 404, `/m` is 200 (verified live in WP1).
- **G11 — planning-environment limits.** `docker`, `actionlint`, and `yamllint` are all unavailable in the environment this plan was authored in (checked). The image build smoke is therefore specified as an execution-phase task with exact commands (Task 6) — the executor MUST run it on a docker-capable host before the compose blocks are considered verified; compose `config` validation likewise needs docker.
- **G12 — railway is a separate hosting path.** `hosting/railway/oss/**` deploys a fixed service set (web from `ghcr.io/agenta-ai/agenta-web` preview tags) via `41/43`; mobile is not part of preview deploys. Scoped out (see "Not in this plan").

---

## Task 1 — Fix the mobile gh image's entrypoint env-dir crash

**File: `web/mobile/docker/Dockerfile.gh`** (mobile-owned; not OSS app source).

- [ ] Insert after the `useradd` RUN (current lines 61-62) and before the `COPY --from=builder` block:

```dockerfile
# web/entrypoint.sh (set -e) does `mkdir -p /app/<license>/public` before
# writing __env.js and mirroring it into mobile/public. This image ships only
# mobile/ and /app is root-owned, so pre-create both license dirs writable
# for the runtime user or the container exits at startup.
RUN mkdir -p /app/oss/public /app/ee/public && \
    chown -R agenta:agenta /app/oss /app/ee
```

The runner stage then reads (context — do not change the rest):

```dockerfile
RUN groupadd --gid 10001 agenta && \
    useradd --uid 10001 --gid 10001 --shell /bin/false --create-home agenta

# web/entrypoint.sh (set -e) does `mkdir -p /app/<license>/public` before
# writing __env.js and mirroring it into mobile/public. This image ships only
# mobile/ and /app is root-owned, so pre-create both license dirs writable
# for the runtime user or the container exits at startup.
RUN mkdir -p /app/oss/public /app/ee/public && \
    chown -R agenta:agenta /app/oss /app/ee

COPY --chown=agenta:agenta --from=builder /app/mobile/.next/standalone /app
```

- [ ] Verify: `grep -n "mkdir -p /app/oss/public" web/mobile/docker/Dockerfile.gh` → one match; `grep -c "chown" web/mobile/docker/Dockerfile.gh` → 5 (4 COPY --chown + 1 RUN).
- [ ] Commit: `fix(mobile): pre-create entrypoint env dirs in the gh image`

## Task 2 — New workflow `17-check-mobile.yml` (typecheck + image build/push)

- [ ] Create `.github/workflows/17-check-mobile.yml` with exactly this content:

```yaml
name: "17 - check mobile"

on:
  pull_request:
    paths:
      - 'web/mobile/**'
      - 'web/entrypoint.sh'
      - 'web/docker/**'
      - 'web/package.json'
      - 'web/pnpm-lock.yaml'
      - 'web/pnpm-workspace.yaml'
      - 'web/turbo.json'
      - 'web/patches/**'
      - '.github/workflows/17-check-mobile.yml'
  workflow_dispatch:
    inputs:
      push:
        description: "Push the built image to GHCR"
        type: boolean
        default: false
      image_tag:
        description: "Image tag; leave empty for manual-<short-sha>"
        type: string
        default: ""
      push_latest:
        description: "Also tag :latest (requires push)"
        type: boolean
        default: false

permissions:
  contents: read
  packages: write

concurrency:
  group: check-mobile-${{ github.event.pull_request.number || github.ref_name }}
  cancel-in-progress: true

jobs:
  typecheck:
    name: Mobile types
    if: github.event_name == 'workflow_dispatch' || !github.event.pull_request.draft
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - name: Install pnpm
        uses: pnpm/action-setup@v4
        with:
          package_json_file: web/package.json

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: 'pnpm'
          cache-dependency-path: web/pnpm-lock.yaml

      - name: Install dependencies
        run: cd web && pnpm install --frozen-lockfile

      - name: Typecheck @agenta/mobile
        run: cd web && pnpm turbo run types:check --filter=@agenta/mobile

  prepare:
    name: prepare
    if: github.event_name == 'workflow_dispatch' || !github.event.pull_request.draft
    runs-on: ubuntu-latest
    outputs:
      image_tag: ${{ steps.meta.outputs.image_tag }}
      cache_scope: ${{ steps.meta.outputs.cache_scope }}
      push: ${{ steps.meta.outputs.push }}
    steps:
      - uses: actions/checkout@v6

      - name: Determine build metadata
        id: meta
        env:
          # Through `env` these are only ever data. Interpolated directly into `run:` they
          # are substituted before bash parses the line, so a value could close the quote
          # and run commands.
          PR: ${{ github.event.pull_request.number }}
          INPUT_TAG: ${{ inputs.image_tag }}
        run: |
          PR="$PR"
          INPUT_TAG="$INPUT_TAG"
          SHA="$(git rev-parse --short HEAD)"

          if [ -n "$PR" ]; then
            TAG="pr-${PR}-${SHA}"
            PUSH=false
            CACHE_SCOPE="pr-${PR}"
          else
            TAG="${INPUT_TAG:-manual-${SHA}}"
            PUSH="${{ inputs.push }}"
            REF="$(printf "%s" "${GITHUB_REF_NAME}" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9._-' '-')"
            REF="${REF#-}"
            REF="${REF%-}"
            CACHE_SCOPE="${REF:-manual}"
          fi

          CACHE_SCOPE="${CACHE_SCOPE:0:80}"

          echo "image_tag=${TAG}" >> "$GITHUB_OUTPUT"
          echo "cache_scope=${CACHE_SCOPE}" >> "$GITHUB_OUTPUT"
          echo "push=${PUSH}" >> "$GITHUB_OUTPUT"

  build-image:
    name: build-image
    needs: prepare
    runs-on: ${{ matrix.runner }}
    strategy:
      fail-fast: false
      matrix:
        arch:
          - amd64
          - arm64
        include:
          - arch: amd64
            runner: ubuntu-24.04
            platform: linux/amd64
          - arch: arm64
            runner: ubuntu-24.04-arm
            platform: linux/arm64
    steps:
      - uses: actions/checkout@v6

      - name: Log in to GHCR
        if: needs.prepare.outputs.push == 'true'
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v4

      - name: Build per-arch image
        uses: docker/build-push-action@v6
        with:
          context: web
          file: web/mobile/docker/Dockerfile.gh
          push: ${{ needs.prepare.outputs.push == 'true' }}
          load: ${{ needs.prepare.outputs.push != 'true' }}
          platforms: ${{ matrix.platform }}
          # Mirror 42-railway-build: no provenance/SBOM attestations (they add
          # unknown/unknown manifest entries we don't consume).
          provenance: false
          sbom: false
          tags: ghcr.io/agenta-ai/agenta-web-mobile:${{ needs.prepare.outputs.image_tag }}-${{ matrix.arch }}
          # Per-arch cache refs so amd64 and arm64 don't clobber each other.
          # cache-to is push-gated: PR runs (incl. forks) have no registry write.
          cache-from: |
            type=registry,ref=ghcr.io/agenta-ai/agenta-web-mobile:buildcache-shared-${{ matrix.arch }}
            type=registry,ref=ghcr.io/agenta-ai/agenta-web-mobile:buildcache-${{ needs.prepare.outputs.cache_scope }}-${{ matrix.arch }}
          cache-to: ${{ needs.prepare.outputs.push == 'true' && format('type=registry,ref=ghcr.io/agenta-ai/agenta-web-mobile:buildcache-shared-{0},mode=max', matrix.arch) || '' }}

      - name: Smoke-test the image serves /m
        run: |
          IMAGE="ghcr.io/agenta-ai/agenta-web-mobile:${{ needs.prepare.outputs.image_tag }}-${{ matrix.arch }}"
          if [ "${{ needs.prepare.outputs.push }}" = "true" ]; then
            docker pull "$IMAGE"
          fi
          docker run -d --name mobile-smoke -p 3000:3000 "$IMAGE"
          for i in $(seq 1 30); do
            if curl -sf http://127.0.0.1:3000/m >/dev/null; then break; fi
            sleep 1
          done
          # Assert the status itself rather than curl's exit code: `-sf` succeeds on a
          # 3xx (the page never rendered) and fails identically on 404 and 500.
          expect_status() {
            local path="$1" want="$2" got
            got="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000${path}")"
            if [ "$got" != "$want" ]; then
              echo "::error::expected ${path} to return ${want}, got ${got}"
              docker logs mobile-smoke
              exit 1
            fi
          }
          expect_status /m 200
          expect_status /m/__env.js 200
          # basePath /m owns the prefix, so the bare root belongs to nothing.
          expect_status / 404
          docker rm -f mobile-smoke

      - name: Verify image runs as non-root
        run: |
          IMAGE="ghcr.io/agenta-ai/agenta-web-mobile:${{ needs.prepare.outputs.image_tag }}-${{ matrix.arch }}"
          USER=$(docker inspect --format='{{.Config.User}}' "$IMAGE")
          if [ -z "$USER" ] || [ "$USER" = "root" ] || [ "$USER" = "0" ]; then
            echo "::error::agenta-web-mobile (${{ matrix.arch }}) runs as root (User='${USER}')"
            exit 1
          fi
          echo "PASS: runs as User='${USER}'"

      - name: Summary
        run: |
          IMAGE="ghcr.io/agenta-ai/agenta-web-mobile:${{ needs.prepare.outputs.image_tag }}-${{ matrix.arch }}"
          SIZE="$(docker image ls --format '{{.Size}}' "$IMAGE" | head -1)"
          echo "- Built \`agenta-web-mobile:${{ needs.prepare.outputs.image_tag }}-${{ matrix.arch }}\` (${SIZE}), smoke on /m passed" >> "$GITHUB_STEP_SUMMARY"

  merge-manifests:
    name: merge-manifest
    needs: [prepare, build-image]
    if: needs.prepare.outputs.push == 'true'
    runs-on: ubuntu-latest
    steps:
      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v4

      - name: Stitch per-arch tags into manifest list
        env:
          IMAGE: ghcr.io/agenta-ai/agenta-web-mobile
          TAG: ${{ needs.prepare.outputs.image_tag }}
          PUSH_LATEST: ${{ inputs.push_latest }}
        run: |
          set -euo pipefail
          docker buildx imagetools create \
            -t "${IMAGE}:${TAG}" \
            "${IMAGE}:${TAG}-amd64" \
            "${IMAGE}:${TAG}-arm64"
          if [ "${PUSH_LATEST}" = "true" ]; then
            docker buildx imagetools create \
              -t "${IMAGE}:latest" \
              "${IMAGE}:${TAG}-amd64" \
              "${IMAGE}:${TAG}-arm64"
          fi
          echo "- Merged \`agenta-web-mobile:${TAG}\` (linux/amd64 + linux/arm64; latest=${PUSH_LATEST})" >> "$GITHUB_STEP_SUMMARY"
```

- [ ] Syntax-check (no actionlint in repo tooling; use YAML parse):
  `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/17-check-mobile.yml')); print('ok')"` → `ok`. If `actionlint` happens to be installed locally, also run `actionlint .github/workflows/17-check-mobile.yml` → no output.
- [ ] Optional pre-verified extension: run `cd web && pnpm turbo run types:check --filter=@agenta/chat` locally. If (and only if) it exits 0 — it pulls in `@agenta/shared`/`entities`/`playground` `types:check` via turbo `dependsOn` — append `--filter=@agenta/chat` to the workflow's typecheck command. If any dep package fails, leave mobile-only and note it in the commit body.
- [ ] Commit: `ci(mobile): add mobile typecheck and gh image build workflow`

## Task 3 — `web-mobile` service in the five prod/gh compose files

Insert each block **immediately after the `web` service** in its file. All blocks use the section-banner comment style of their file (`# === X ==== #`).

- [ ] **`hosting/docker-compose/oss/docker-compose.gh.yml`** (network `agenta-oss-gh-network`, env default `./.env.oss.gh`):

```yaml
    web-mobile:
        # === ACTIVATION =========================================== #
        # Opt-in while the mobile app is pre-GA (run.sh --with-mobile).
        profiles:
            - with-web-mobile
        # === IMAGE ================================================ #
        # build:
        #     context: ../../../web
        #     dockerfile: mobile/docker/Dockerfile.gh
        image: ghcr.io/agenta-ai/${AGENTA_WEB_MOBILE_IMAGE_NAME:-agenta-web-mobile}:${AGENTA_WEB_MOBILE_IMAGE_TAG:-latest}
        # === EXECUTION ============================================ #
        command: sh -c "node ./mobile/server.js"
        # === CONFIGURATION ======================================== #
        env_file:
            - ${ENV_FILE:-./.env.oss.gh}
        # === NETWORK ============================================== #
        networks:
            - agenta-oss-gh-network
        # === LABELS =============================================== #
        # Match the `/m` SEGMENT, not every path whose first two characters are `/m`:
        # a bare PathPrefix(`/m`) would also capture /mobile, /metrics and friends and
        # steal them from the web catch-all. The rule still auto-wins over PathPrefix(`/`)
        # by length; no stripprefix — the app is built with basePath /m.
        labels:
            - "traefik.http.routers.web-mobile.rule=(Path(`/m`) || PathPrefix(`/m/`))"
            - "traefik.http.routers.web-mobile.entrypoints=web"
            - "traefik.http.services.web-mobile.loadbalancer.server.port=3000"
        # === LIFECYCLE ============================================ #
        restart: always
```

- [ ] **`hosting/docker-compose/oss/docker-compose.gh.ssl.yml`** (builds locally like its `web`; network `agenta-gh-ssl-network`):

```yaml
    web-mobile:
        # === ACTIVATION =========================================== #
        # Opt-in while the mobile app is pre-GA (run.sh --with-mobile).
        profiles:
            - with-web-mobile
        # === IMAGE ================================================ #
        build:
            context: ../../../web
            dockerfile: mobile/docker/Dockerfile.gh
        # === EXECUTION ============================================ #
        command: sh -c "node ./mobile/server.js"
        # === CONFIGURATION ======================================== #
        env_file:
            - ${ENV_FILE:-./.env.oss.gh}
        # === NETWORK ============================================== #
        networks:
            - agenta-gh-ssl-network
        # === LABELS =============================================== #
        # PathPrefix(`/m`) auto-wins over the web catch-all PathPrefix(`/`)
        # by rule length; no stripprefix — the app is built with basePath /m.
        labels:
            - "traefik.http.routers.web-mobile.rule=Host(`${TRAEFIK_DOMAIN}`) && PathPrefix(`/m`)"
            - "traefik.http.routers.web-mobile.entrypoints=web,web-secure"
            - "traefik.http.services.web-mobile.loadbalancer.server.port=3000"
            - "traefik.http.routers.web-mobile.tls=true"
            - "traefik.http.routers.web-mobile.tls.certresolver=myResolver"
        # === LIFECYCLE ============================================ #
        restart: always
```

- [ ] **`hosting/docker-compose/oss/docker-compose.gh.local.yml`**: same as the ssl block but with the **non-ssl labels** from the gh block (`` PathPrefix(`/m`) ``, `entrypoints=web`, no tls lines) and network `agenta-oss-gh-network`.

- [ ] **`hosting/docker-compose/ee/docker-compose.gh.yml`** (its `web` has no profile, but `web-mobile` keeps the opt-in profile — same pre-GA rationale; network `agenta-ee-gh-network`, env default `./.env.ee.gh`). Same as the oss gh block except network/env_file, and the image line carries the edition note:

```yaml
    web-mobile:
        # === ACTIVATION =========================================== #
        # Opt-in while the mobile app is pre-GA (run.sh --with-mobile).
        profiles:
            - with-web-mobile
        # === IMAGE ================================================ #
        # The mobile app is edition-agnostic OSS-repo code: one public image
        # serves both editions (no internal-ee variant).
        image: ghcr.io/agenta-ai/${AGENTA_WEB_MOBILE_IMAGE_NAME:-agenta-web-mobile}:${AGENTA_WEB_MOBILE_IMAGE_TAG:-latest}
        # === EXECUTION ============================================ #
        command: sh -c "node ./mobile/server.js"
        # === CONFIGURATION ======================================== #
        env_file:
            - ${ENV_FILE:-./.env.ee.gh}
        # === NETWORK ============================================== #
        networks:
            - agenta-ee-gh-network
        # === LABELS =============================================== #
        # PathPrefix(`/m`) auto-wins over the web catch-all PathPrefix(`/`)
        # by rule length; no stripprefix — the app is built with basePath /m.
        labels:
            - "traefik.http.routers.web-mobile.rule=PathPrefix(`/m`)"
            - "traefik.http.routers.web-mobile.entrypoints=web"
            - "traefik.http.services.web-mobile.loadbalancer.server.port=3000"
        # === LIFECYCLE ============================================ #
        restart: always
```

- [ ] **`hosting/docker-compose/ee/docker-compose.gh.local.yml`**: same as the ee gh block but replace the `image:` line with the local build (identical Dockerfile — the mobile image is edition-agnostic):

```yaml
        build:
            context: ../../../web
            dockerfile: mobile/docker/Dockerfile.gh
```

(env_file `${ENV_FILE:-./.env.ee.gh}`, network `agenta-ee-gh-network`, non-ssl labels.)

- [ ] **Env examples** — append to the "Agenta - Docker images" block (after the runner lines) in BOTH `hosting/docker-compose/oss/env.oss.gh.example` and `hosting/docker-compose/ee/env.ee.gh.example`:

```bash
# AGENTA_WEB_MOBILE_IMAGE_NAME=agenta-web-mobile
# AGENTA_WEB_MOBILE_IMAGE_TAG=latest
```

- [ ] Commit (with Task 4): see Task 4.

## Task 4 — `run.sh` awareness: `--with-mobile`

**File: `hosting/docker-compose/run.sh`** — five hunks:

- [ ] Defaults block (after line 23 `LOCAL_OVERRIDES=true …`):

```bash
WITH_MOBILE=false  # Start the mobile web app (/m) via the with-web-mobile profile; enable with --with-mobile
```

- [ ] Usage, in the "Web:" section (after the `--web-url` line):

```bash
    echo "  --with-mobile           Also start the mobile web app at /m (gh/ssl/gh.local stacks;"
    echo "                          no-op on --dev, where web-mobile rides the with-web profile)"
```

- [ ] Argument parsing, next to `--no-tunnel` (order in the case list is cosmetic):

```bash
        --with-mobile)
            WITH_MOBILE=true
            ;;
```

- [ ] Profile assembly, after the `with-tunnel` block (lines 437-439):

```bash
if $WITH_MOBILE; then
    COMPOSE_CMD+=" --profile with-web-mobile"
fi
```

- [ ] **Shutdown** (line 526) — add the profile so `down` reaps mobile containers (G9):

```bash
SHUTDOWN_CMD="$COMPOSE_CMD --profile with-web-mobile --profile with-web --profile with-nginx --profile with-traefik --profile with-tunnel down"
```

  (Note `$COMPOSE_CMD` already contains `--profile with-web-mobile` when the flag was passed; the explicit repeat in `SHUTDOWN_CMD` covers the flagless-down case and duplicates are harmless to compose.)

- [ ] Verify: `bash -n hosting/docker-compose/run.sh` → silent; `./hosting/docker-compose/run.sh --help | grep -A1 "with-mobile"` → prints the two usage lines; `grep -c "with-web-mobile" hosting/docker-compose/run.sh` → 3.
- [ ] Commit (Tasks 3+4 together): `feat(hosting): wire the web-mobile service into the gh compose stacks`

## Task 5 — Verify (don't change) the already-wired CI coverage

Pin the G3/G5 claims so nobody re-adds duplicate jobs later. Run `set -o pipefail` first —
the two piped checks below would otherwise report the exit status of `python3`/`grep` and
swallow a failing producer:

- [ ] `cd web && pnpm turbo run lint --filter=@agenta/mobile --dry=json | python3 -c "import json,sys; d=json.load(sys.stdin); print([t['taskId'] for t in d['tasks']])"` → includes `@agenta/mobile#lint` (proves `pnpm run lint` in `11-check-code-styling.yml:96` reaches mobile, tokens:check chained).
- [ ] `cd web && pnpm -r --filter=!agenta-web-tests --if-present run test:unit --reporter=dot 2>&1 | grep -i chat` → `@agenta/chat` suite executes (the exact Phase-1 command from `run-tests.ts:200`); confirm `web/packages/agenta-chat/test-results/junit.xml` exists afterwards (matches the publish glob `12:133-135`).
- [ ] `cd web && pnpm turbo run types:check --filter=@agenta/mobile` → exit 0 (the new CI job's exact command).
- [ ] No commit (verification only; findings go in the PR description).

## Task 6 — Local image build + serve smoke (docker-capable host REQUIRED)

Docker is unavailable in the planning environment (G11); this is the execution gate for Tasks 1-3. Run from the repo root on any machine with Docker + BuildKit:

- [ ] Build (context is `web/`, matching the compose/CI blocks):

```bash
DOCKER_BUILDKIT=1 docker build -f web/mobile/docker/Dockerfile.gh -t agenta-web-mobile:smoke web/
docker image ls agenta-web-mobile:smoke --format 'SIZE {{.Size}}'
```

  Expected: build succeeds (first run ~5-10 min; `run-turbo-build.sh` prints "Turbo remote cache not configured. Using local Turbo cache only."); record the reported size in the PR (expect roughly 250-400MB for a standalone Next app on `node:24-slim` — record actual).

- [ ] Run + serve check (mirrors runtime: entrypoint writes `__env.js`, then `node mobile/server.js` on 3000):

```bash
docker run -d --name mobile-smoke -p 3000:3000 agenta-web-mobile:smoke
trap 'docker rm -f mobile-smoke >/dev/null 2>&1' EXIT   # container goes away on failure too
# Bounded readiness poll, same as the workflow: a fixed sleep races a slow host, where
# the entrypoint plus the Next server can need well over three seconds.
for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:3000/m >/dev/null && break
  sleep 1
done
curl -sf -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/m          # expect: 200
curl -sf -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/m/__env.js # expect: 200
curl -s  -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/           # expect: 404
docker exec mobile-smoke id -u                                             # expect: 10001
docker logs mobile-smoke | head -5   # expect the __env.js dump from entrypoint.sh:222, no mkdir error
docker rm -f mobile-smoke
```

  Without Task 1's fix, `docker logs` shows `mkdir: cannot create directory '/app/oss': Permission denied` and the container exits — that failure is the regression proof for the fix.

- [ ] Compose config validation (WP1-P5 style; needs docker, run from the edition dir so relative env paths resolve; dummy values satisfy the `:?` guards):

```bash
cd hosting/docker-compose/oss
ENV_FILE=./env.oss.gh.example AGENTA_RUNNER_TOKEN=dummy \
  docker compose -f docker-compose.gh.yml --profile with-web --profile with-web-mobile config --quiet && echo OK
ENV_FILE=./env.oss.gh.example AGENTA_RUNNER_TOKEN=dummy TRAEFIK_DOMAIN=example.com AGENTA_SSL_DIR=/tmp \
  docker compose -f docker-compose.gh.ssl.yml --profile with-web --profile with-web-mobile config --quiet && echo OK
ENV_FILE=./env.oss.gh.example AGENTA_RUNNER_TOKEN=dummy \
  docker compose -f docker-compose.gh.local.yml --profile with-web --profile with-web-mobile config --quiet && echo OK
cd ../ee
ENV_FILE=./env.ee.gh.example AGENTA_RUNNER_TOKEN=dummy \
  docker compose -f docker-compose.gh.yml --profile with-web-mobile config --quiet && echo OK
ENV_FILE=./env.ee.gh.example AGENTA_RUNNER_TOKEN=dummy \
  docker compose -f docker-compose.gh.local.yml --profile with-web-mobile config --quiet && echo OK
```

  Expected: five `OK`s. Also confirm the service resolves: append `config --services | grep web-mobile` on one file → `web-mobile`.

- [ ] No commit (verification). If the smoke surfaces a Dockerfile issue beyond G8, fix it in `web/mobile/docker/Dockerfile.gh` under the Task 1 commit scope (amend or follow-up `fix(mobile):` commit).

## Task 7 — Rollout runbook + docs tail

- [ ] Add the publication runbook to `docs/design/agenta-mobile/README.md` (replace the "gh CI workflow job for the mobile image + prod/ssl compose variants; CI lint/typecheck jobs for `@agenta/mobile`" clauses in the "Chores pending" bullet, lines 166-169) with a short note:
  - `17-check-mobile.yml` builds+smokes the image on mobile PRs and typechecks `@agenta/mobile`; lint (`turbo run lint` in workflow 11) and `@agenta/chat` unit tests (package discovery in workflow 12) were already covered.
  - **First publication ordering:** merge → run `17 - check mobile` via `workflow_dispatch` with `push=true, push_latest=true` → only then can operators use `run.sh --gh --with-mobile` (until then the profile is opt-in precisely so nothing pulls a nonexistent image).
  - Keep (unchanged) the `@agenta/*` deps gotcha: `Dockerfile.gh` copies no package manifests and the new compose blocks mount no packages — both must gain wiring the moment WP2 imports `@agenta/entities`/`@agenta/shared`/`@agenta/chat` (Dockerfile manifest COPYs + turbo `dependsOn` for `@agenta/mobile#build`).
- [ ] Commit: `docs(mobile): record the wp1 infra tail wiring and rollout order`

---

## Not in this plan

- **Cloud/EE product rollout (`eu.cloud.agenta.ai`, `testing.preview.agenta.dev`).** Lives in
  the private `Agenta-AI/agenta_cloud` repo as its own small PR — the concrete change-set
  (build.sh service case, 63-build matrix entry, `web-mobile` service in
  `docker-compose.application.yml` with `Host && PathPrefix(/m)`, stage env vars) is spelled
  out in Operator-requirements point 2 above. This repo's contribution: the merged
  `web/mobile/docker/Dockerfile.gh` (buildable by that pipeline as-is) + the self-hosting
  wiring + the ghcr publication for the community.
- **Railway preview/deploy wiring** (`hosting/railway/**`, workflows 40-45): the preview stack deploys a fixed OSS service set from the `42` matrix; mobile isn't deployed there. Adding `agenta-web-mobile` to the `42` matrix would edit a heavily-shared workflow and burn CI minutes for an undeployed image — deferred until mobile is part of a preview environment. (G12)
- **An EE ssl compose file** — `hosting/docker-compose/ee/docker-compose.gh.ssl.yml` does not exist (G6); creating a whole EE ssl stack is not this plan's job. If one appears later, its `web-mobile` block is the oss-ssl block with the ee network/env names.
- **`:latest` release automation** — no prod image in this repo has one (G2); mobile follows the same (external/dispatch) publication model.
- **`@agenta/*` package-dep wiring for mobile** (Dockerfile manifest COPYs, compose package mounts, turbo `dependsOn`) — lands with WP2, the first time `web/mobile` imports a workspace package (README:151-155 gotcha preserved by Task 7).
- **Changes to `11-check-code-styling.yml` / `12-check-unit-tests.yml`** — mobile lint and chat tests are already covered by their generic mechanisms (G3/G5); Task 5 only proves it.
- **`web/entrypoint.sh` edits** — the G8 crash is fixed image-side to keep the shared entrypoint (used by four other images) untouched.
- **Helm chart** (`hosting/kubernetes/helm`) — no web-mobile Deployment; separate track when mobile reaches k8s users.

## Conflict-risk notes for the executor

- `.github/workflows/`: **new file only** — zero conflict surface with open PRs.
- `hosting/docker-compose/{oss,ee}/docker-compose.gh*.yml`, `run.sh`, env examples: shared files, but outside the FE PR queue's hot zone (`web/oss/src`, `web/packages`); the blocks are pure insertions after `web:`, which rebase cleanly. Re-run the Task 6 `config` checks after any rebase.
- The branch `feat/agenta-mobile-wave-1` already carries 35 unpushed commits on PR #5479's tip; keep these 4-5 commits at the tail so the infra tail can be peeled into its own PR if the wave-1 PR gets split.
