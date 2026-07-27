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

### Restart one service (surgical)

`run.sh --recreate <service>` and `--rebuild <service>` are the blessed entry point for
single-service restarts. They run `up -d --no-deps --force-recreate <service>` (or `build`
then recreate) with the **full assembled `-f` set** and the same env handling as a full run,
so a targeted restart never drops a local override. Both are repeatable and reject unknown
services. `--rebuild` honors `--no-cache`; a service with no build config of its own (e.g. the
dev `web`/`runner`) is built via its `.<name>` anchor automatically.

```bash
run.sh --ee --dev --env-file .env.ee.dev.local --recreate runner   # recreate with all overrides
run.sh --ee --dev --env-file .env.ee.dev.local --rebuild web        # rebuilds the .web anchor, recreates web
```

### Key difference

- **Main branch**: no prefix, uses `.env.ee.dev.local`.
- **Worktree**: `COMPOSE_PROJECT_NAME=agenta-ee-dev-instance2` prefix, uses
  `.env.ee.dev.instance2`.

This separation prevents Docker Compose conflicts between the main-branch and worktree
instances.

### Recreating only `web` — always pass the env file (F-037)

`web` runs `next dev` and reads its env at container-create time, so an env or config change
needs a **recreate**, not a `restart`. The footgun: recreating it by hand with a raw
`docker compose ... up -d --no-deps web` and forgetting the env file. Compose then falls back to
the committed default `${ENV_FILE:-./.env.<license>.dev}`, which has **port-80 / no-port URLs**,
so the recreated web container 404s every `/api` call with no obvious cause (same class as F-020).

Use the helper, which always passes the env file on both planes (the shell `ENV_FILE` var and the
`--env-file` CLI flag) so the trap cannot recur:

```bash
hosting/docker-compose/recreate-web.sh                              # ee / dev / .env.ee.dev.local
PROJECT=agenta-ee-dev-wp-b2-rendering hosting/docker-compose/recreate-web.sh
```

If you must run `docker compose` directly, pass `ENV_FILE=<file>` **and**
`--env-file <path>` — both, every time. `run.sh` now also fails loud when its resolved env file
is missing instead of silently using the port-80 default.
