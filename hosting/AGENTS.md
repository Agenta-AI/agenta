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
