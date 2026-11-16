# Hosting and local dev stack

Scope: everything under `hosting/` plus running the local dev stack. This file loads when
you work in `hosting/`. The repo-wide root conventions live in `/AGENTS.md`.

## Running the dev stack

### From the main checked-out branch (no worktree)

```bash
./hosting/docker-compose/run.sh --build --license ee --dev --env-file .env.ee.dev.local
```

### From a git worktree

Prefix with a distinct `COMPOSE_PROJECT_NAME` and use a per-worktree env file so Docker
Compose does not conflict with the main-branch instance:

```bash
COMPOSE_PROJECT_NAME=agenta-ee-dev-instance2 ./hosting/docker-compose/run.sh \
  --license ee --dev --env-file .env.ee.dev.instance2
```

With a rebuild:

```bash
COMPOSE_PROJECT_NAME=agenta-ee-dev-instance2 ./hosting/docker-compose/run.sh \
  --license ee --dev --env-file .env.ee.dev.instance2 --build
```

### Rebuild options

- `--build` for a normal rebuild.
- `--build --no-cache` to rebuild from scratch.

### Local compose overrides (auto-included)

`run.sh` auto-includes every `docker-compose.<stage>.*.local.yml` in the edition dir as an
extra `-f`, sorted lexicographically, and prints the effective compose file set on every run.
These files are gitignored (see the `.gitignore` pattern) and hold operator-local tweaks. One
example is `docker-compose.dev.harness.local.yml`, which bind-mounts the runner's Claude/Pi
subscription logins. Because `run.sh` assembles the same set every time, a routine
`run.sh --build` can no longer silently recreate a service without its override.

- `--no-local-overrides` skips the auto-include.
- `--compose-file <name>` appends an extra file (repeatable; bare name resolves in the edition
  dir like `-e`, or pass a path). Appended after the auto-included ones.

### The web app (`web-mobile`, served at `/m`)

`web-mobile` is the only frontend service. Every stack starts it; the compose files carry no
profile for it and no env key is needed. It owns the catch-all: Traefik routes
``PathPrefix(`/`)`` to it with `priority=1`, below the api and services routers, and nginx sends
`location /` to it through a variable upstream, so nginx still starts when it is left out. The
app answers `/m` itself; `proxy.ts` redirects `/` to `/m` and maps other root paths to their `/m`
pages with `mapDesktopToMobile`. A backend-only run
(`--no-web` / `--web-mode none`) leaves it out; `--web-local` leaves it out and runs
`web/mobile` from the checkout instead. The dev image builds from
`web/mobile/docker/Dockerfile.dev`.

### Restart one service (surgical)

`run.sh --recreate <service>` and `--rebuild <service>` are the blessed entry point for
single-service restarts. They run `up -d --no-deps --force-recreate <service>` (or `build`
then recreate) with the **full assembled `-f` set** and the same env handling as a full run,
so a targeted restart never drops a local override. Both are repeatable and reject unknown
services. `--rebuild` honors `--no-cache`; a service with no build config of its own (e.g. the
dev `api`/`runner`) is built via its `.<name>` anchor automatically.

```bash
run.sh --ee --dev --env-file .env.ee.dev.local --recreate runner   # recreate with all overrides
run.sh --ee --dev --env-file .env.ee.dev.local --rebuild web-mobile # rebuilds and recreates web-mobile
```

### Key difference

- **Main branch**: no prefix, uses `.env.ee.dev.local`.
- **Worktree**: `COMPOSE_PROJECT_NAME=agenta-ee-dev-instance2` prefix, uses
  `.env.ee.dev.instance2`.

This separation prevents Docker Compose conflicts between the main-branch and worktree
instances.

### Recreate a dev service with `run.sh`, never by hand (F-037)

The dev `web-mobile` runs `next dev` and reads its env at container-create time, so an env or
config change needs a **recreate**, not a `restart`. A raw `docker compose ... up -d --no-deps
web-mobile` without the env file falls back to the committed default
`${ENV_FILE:-./.env.<license>.dev}`, which has **port-80 / no-port URLs**, so every `/api` call
404s with no obvious cause (same class as F-020). Use `run.sh --recreate web-mobile`, which
passes the env file on both planes (the shell `ENV_FILE` var and the `--env-file` CLI flag).
`run.sh` also fails loud when its resolved env file is missing.
