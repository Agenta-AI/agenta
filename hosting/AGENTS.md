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
