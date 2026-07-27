# Hosting

Use this to run a local Agenta instance
Unless intentional, use `--env-file <path>`.
If conflicts, trust script.

## Recipes
- Backend work:
  `bash ./hosting/docker-compose/run.sh --ee --dev --no-web --build`
- Frontend work:
  `bash ./hosting/docker-compose/run.sh --ee --dev --web-local --build`
- Full-Stack work:
  `bash ./hosting/docker-compose/run.sh --ee --dev --build`
- OSS test & work:
  `bash ./hosting/docker-compose/run.sh --oss --dev --build`
- OSS test & build:
  `bash ./hosting/docker-compose/run.sh --oss --gh --local --build`
- OSS test as released:
  `bash ./hosting/docker-compose/run.sh --oss --gh`

## Extensions
- set env file: append `--env-file <path>`
- clean rebuild: append `--no-cache` (requires `--build`)
- skip pull step: append `--no-pull`
- volume reset: append `--nuke`
- extra compose file: append `--compose-file <name>` (repeatable; bare name resolves in the edition dir, or pass a path)
- skip local overrides: append `--no-local-overrides` (by default run.sh auto-includes `docker-compose.<stage>.*.local.yml` from the edition dir and prints the effective file set)

## Restart one service (surgical)
- recreate in place: `bash ./hosting/docker-compose/run.sh --ee --dev --env-file <path> --recreate <service>`
- rebuild then recreate: swap `--recreate` for `--rebuild` (honors `--no-cache`)
- Both reuse the full compose set (base + local overrides), so a targeted restart never drops an override. Repeatable; unknown services are rejected.

## Logs
General:  `docker compose logs -f --tail=200`
Specific: `docker compose -p <project> logs -f --tail=200 <service>`

## Variables (per worktree)

```bash
AGENTA_WEB_URL=
AGENTA_API_URL=
AGENTA_SERVICES_URL=
COMPOSE_PROJECT_NAME=
TRAEFIK_PORT=
TRAEFIK_UI_PORT=
POSTGRES_PORT=
```
