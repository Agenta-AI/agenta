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

## Logs
General:  `docker compose logs -f --tail=200`
Specific: `docker compose -p <project> logs -f --tail=200 <service>`
