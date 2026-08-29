# Deploying Agenta Enterprise Edition

This guide walks you through deploying Agenta EE with Docker Compose. It covers two paths: using pre-built images or building your own from source.

## Running EE dev stacks side by side

Use `hosting/docker-compose/env.sh` to create a worktree-specific EE environment. It writes
`hosting/docker-compose/ee/.env.ee.worktree`, a small non-secret allocation file containing the
Compose project name and every host-bound port in `docker-compose.dev.yml`: Postgres, Traefik
HTTP, and the Traefik dashboard. It then copies the source environment file and merges that
allocation into `hosting/docker-compose/ee/.env.ee.dev`. The allocation also updates the public
web, API, and services URLs to use the worktree's Traefik port.

Choose a unique worktree name. The script automatically finds three free host ports in the
`10000:19999` range; use `--port-offset` or explicit ports when you need a fixed allocation.
For example, from a new worktree:

```bash
bash hosting/docker-compose/env.sh --ee --dev
```

From a linked worktree this takes the worktree name from its directory and copies the primary
checkout's `.env.ee.dev`. Pass `--source` or `--worktree` to override either inference. The
smaller allocation is reusable and inspectable; the generated `.env.ee.dev` remains ignored
because it contains the copied credentials. Start the stack with:

```bash
bash hosting/docker-compose/run.sh --ee --dev \
  --env-file hosting/docker-compose/ee/.env.ee.dev
```

`env.sh` follows `run.sh`'s target selectors: `--ee|--oss`, `--dev|--gh`, `--local`, and
`--ssl`. Use the same selectors for both commands. GH-derived stages also receive a unique
loopback object-store port in addition to Postgres, Traefik HTTP, and the Traefik dashboard.

Use `--port-range START:END` to change the automatic range. Use `--port-offset`, or
`--postgres-port`, `--http-port`, and `--traefik-ui-port`, when the ports must be fixed. Use
`--public-host` or `--public-scheme` when the generated URLs should not use the source's
`TRAEFIK_DOMAIN`/`TRAEFIK_PROTOCOL` (or `localhost`/`http`). Use `env.sh allocate` and `env.sh
merge` when allocation and merging need to run independently.

## Prerequisites

- Docker Engine 24+ with Compose V2
- Docker BuildKit enabled (default in modern Docker)
- For pre-built images: a GitHub PAT with `read:packages` scope

## Quick Start

Before you begin, create an environment file from the provided example:

```bash
cp hosting/docker-compose/ee/env.ee.gh.example hosting/docker-compose/ee/.env.ee.gh
```

Open `.env.ee.gh` and set the required values:

```bash
AGENTA_LICENSE=ee
AGENTA_AUTH_KEY=<generate with: openssl rand -hex 32>
AGENTA_CRYPT_KEY=<generate with: openssl rand -hex 32>
AGENTA_SERVICES_INTERNAL_KEY=<generate with: openssl rand -hex 32>
```

See [Environment Variables](#environment-variables) for what else you can configure.

### Option A: Pre-Built Images (GHCR)

Log in to the GitHub Container Registry, then start the stack. The `run.sh` script pulls the images, runs database migrations, and starts all services in one step:

```bash
echo $GHCR_PAT | docker login ghcr.io -u <github-username> --password-stdin

bash ./hosting/docker-compose/run.sh --ee --gh \
  --env-file ./hosting/docker-compose/ee/.env.ee.gh
```

### Option B: Build and Deploy from Source

This builds all images from the repository source, then starts the stack:

```bash
bash ./hosting/docker-compose/run.sh --ee --gh --local --build \
  --env-file ./hosting/docker-compose/ee/.env.ee.gh
```

Add `--no-cache` for a clean rebuild from scratch.

## Building Images Manually

If you need to build images outside of `run.sh` -- for example, to push to your own registry or to build for a different CPU architecture -- you can use `docker build` directly.

The project has three images. Each has its own Dockerfile and build context:

| Image | Dockerfile | Build context |
|-------|-----------|---------------|
| API | `api/ee/docker/Dockerfile.gh` | repo root (`.`) |
| Web | `web/ee/docker/Dockerfile.gh` | `web/` |
| Services | `services/ee/docker/Dockerfile.gh` | repo root (`.`) |

### Step 1: Build

API and Services use the repo root as their build context so the local Python SDK and generated Python client are available directly at `sdks/python` and `clients/python` during the build.

```bash
docker build -f api/ee/docker/Dockerfile.gh -t agenta-api-ee:latest .
docker build -f web/ee/docker/Dockerfile.gh -t agenta-web-ee:latest web/
docker build -f services/ee/docker/Dockerfile.gh -t agenta-services-ee:latest .
```

### Step 2: Deploy with Docker Compose

Once you have the images (whether built locally or pulled from a registry), deploy them using the compose file directly:

```bash
docker compose \
  -f hosting/docker-compose/ee/docker-compose.gh.yml \
  --env-file hosting/docker-compose/ee/.env.ee.gh \
  --profile with-web --profile with-traefik \
  up -d
```

To point the compose file at your custom images, set these variables in your `.env` file:

```bash
AGENTA_API_IMAGE_NAME=agenta-api-ee
AGENTA_API_IMAGE_TAG=latest
AGENTA_WEB_IMAGE_NAME=agenta-web-ee
AGENTA_WEB_IMAGE_TAG=latest
AGENTA_SERVICES_IMAGE_NAME=agenta-services-ee
AGENTA_SERVICES_IMAGE_TAG=latest
```

If you pushed the images to a private registry, use the full registry path:

```bash
AGENTA_API_IMAGE_NAME=registry.example.com/agenta-api-ee
AGENTA_API_IMAGE_TAG=v1.0.0
```

### Building for ARM64

The Dockerfiles support both `amd64` and `arm64`. On an ARM host (Apple Silicon, AWS Graviton), the standard `docker build` commands above produce native ARM images with no extra flags.

To cross-compile from an x86 host, or to build multi-architecture images, use Docker Buildx:

```bash
docker buildx create --name multiarch --use

docker buildx build \
  --platform linux/arm64 \
  -f api/ee/docker/Dockerfile.gh \
  -t agenta-api-ee:latest \
  --load \
  api/
```

Use the same approach for the `web` and `services` images.

## Environment Variables

The example file `env.ee.gh.example` documents every available variable. Copy it and edit as needed:

```bash
cp hosting/docker-compose/ee/env.ee.gh.example hosting/docker-compose/ee/.env.ee.gh
```

### Required

| Variable | Description |
|----------|-------------|
| `AGENTA_LICENSE` | Must be `ee`. |
| `AGENTA_AUTH_KEY` | Secret for internal service authentication. Generate with `openssl rand -hex 32`. |
| `AGENTA_CRYPT_KEY` | Encryption key for sensitive data at rest. Generate with `openssl rand -hex 32`. |
| `AGENTA_SERVICES_INTERNAL_KEY` | Proves the Services container is the platform runtime, so a run can read write-only secret values. Set the same value on the API and the Services container; no fallback to `AGENTA_AUTH_KEY`. Generate with `openssl rand -hex 32`. |
| `AGENTA_WEB_URL` | Public URL of the web frontend (default: `http://localhost`). |
| `AGENTA_API_URL` | Public URL of the API (default: `http://localhost/api`). |
| `AGENTA_SERVICES_URL` | Public URL of the services endpoint (default: `http://localhost/services`). |

### Notable Optional Variables

Most optional variables can be left empty. A few are worth calling out:

- **Stripe** (`STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICING`): Leave all three empty. Billing is disabled when these are unset. The application runs without usage limits.
- **LLM provider keys** (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.): These power the built-in LLM proxy in the playground. Leave empty if your users will provide their own keys at runtime.
- **SSO / OAuth** (`GOOGLE_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_ID`, etc.): Set a provider's `CLIENT_ID` and `CLIENT_SECRET` to enable it. The frontend auto-detects which providers are configured. Leave empty to use email/password authentication only.
- **Database** (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_URI_*`): The compose stack includes Postgres with working defaults. Override these only if you bring your own database. **Change the default password in production.**

### Development and Debugging

| Variable | Description |
|----------|-------------|
| `AGENTA_SERVICES_ALLOWED_ORIGINS` | Comma-separated web origins that may call the services API. Set this when the development web app runs on a different origin from `AGENTA_SERVICES_URL`, for example `http://localhost:3000,http://192.0.2.10:8680`. Recreate the `services` container after changing it. |

The example file lists all variables with descriptions, grouped by category.

## Architecture Overview

The compose stack runs these services:

| Service | Image | Role |
|---------|-------|------|
| `api` | `agenta-api-ee` | FastAPI backend (gunicorn + uvicorn) |
| `web` | `agenta-web-ee` | Next.js frontend |
| `services` | `agenta-services-ee` | LLM proxy and evaluator execution |
| `worker-streams` | `agenta-api-ee` | Stream consumers: tracing, events, records |
| `worker-queues` | `agenta-api-ee` | Queue consumers: webhooks, triggers, interactions, evaluations |
| `cron` | `agenta-api-ee` | Scheduled tasks (cleanup, metering) |
| `alembic` | `agenta-api-ee` | Runs database migrations on startup |
| `postgres` | `postgres:18` | PostgreSQL (three databases: core, tracing, supertokens) |
| `redis-volatile` | `redis:8` | Cache with LRU eviction |
| `redis-durable` | `redis:8` | Persistent queues with append-only file |
| `traefik` | `traefik:2` | Reverse proxy and routing |
| `supertokens` | `supertokens/supertokens-postgresql:11` | Authentication |
