# Running the Agent

This page explains how the agent workflow runs in practice. There is no agent-specific
`run.sh`. The agent runs as a normal service in the Agenta stack, started by the shared
`hosting/docker-compose/run.sh`. This page covers that script, the agent pieces it starts,
the ports, the env vars, and the two ways to run the Node runner outside Docker.

All file:line citations were verified against the code on 2026-07-03.

## There are two agent processes

The agent workflow is split across two services. Know which is which.

1. The Python agent service. It lives in `services/oss/src/agent/`. It runs inside the shared
   `services` container as a normal Agenta workflow. It decides what to run. It exposes
   `/invoke` and `/inspect`, parses the config, resolves tools and secrets server-side, and
   then calls the runner (`services/oss/src/agent/app.py`).

2. The Node runner sidecar. It lives in `services/runner/`. Its compose service name is
   `runner`. It runs the agent loop with the real harnesses (Pi, Claude, the `sandbox-agent`
   package). It listens on `:8765` and serves `GET /health` and `POST /run`
   (`services/runner/src/server.ts`). The Python service calls it over HTTP.

The Python service finds the runner through `AGENTA_RUNNER_INTERNAL_URL`, which defaults to
`http://runner:8765` in every compose stage (for example
`hosting/docker-compose/ee/docker-compose.dev.yml:565`).

## The script: hosting/docker-compose/run.sh

`run.sh` is the single entrypoint for the whole stack. It picks the right compose file,
profiles, and env file, then builds or pulls images and runs `docker compose up -d`. The
agent comes up with everything else. You do not start it separately.

Note: the `run-sh` skill describes an older flag set (`--stage`, `--gh`, `--ssl`,
`--web-domain`). The current script uses different flags. The accurate flag set is below,
read straight from `hosting/docker-compose/run.sh`.

### Stage selection

The script derives a stage from the image mode and a few flags:

- `--dev` selects the `dev` stage. Code is bind-mounted and reloads live.
- `--gh` (the default) selects the `gh` stage. It uses prebuilt registry images.
- `--local` with `--gh` selects `gh.local`, which builds from local source but in gh layout.
- `--ssl` with `--gh` selects `gh.ssl`.

The compose file resolves to
`hosting/docker-compose/<license>/docker-compose.<stage>.yml`. If that file is missing, the
script exits with an error.

### Key flags

- `--oss` or `--ee` or `--license <oss|ee>`. Default is `oss`.
- `--dev` or `--gh` or `--image <gh|dev>`. Default is `gh`.
- `--local`. Build from local gh source. Requires `--gh`.
- `--build`. Build images before up.
- `--no-cache`. Build with no cache. Requires `--build`.
- `--pull` or `--no-pull`. Default is pull on gh, no pull on dev.
- `--no-web` or `--web-local` or `--web-mode <docker|local|none>`. Default is docker.
- `--web-url <URL>`. Override `AGENTA_WEB_URL`.
- `-e` or `--env` or `--env-file <path>`. Use an explicit env file. Otherwise the stage
  default applies.
- `--nuke`. Remove related volumes on shutdown.
- `--down`. Stop containers and exit, no up.
- `--ssl`. Use the SSL proxy stage. Requires `--gh`.
- `--nginx`. Use the nginx proxy instead of Traefik.
- `--help`. Print usage.

### What it does, in order

1. Parse and validate flags. Conflicting flags error out.
2. Pick the compose file from license and stage.
3. Resolve the env file. The default is `.env.<license>.<stage>` under
   `hosting/docker-compose/<license>/`. `gh.local` reuses the `gh` env file.
4. Add profiles. `with-web` unless web mode is none. Then `with-traefik` or `with-nginx`.
5. Build, or build with no cache, or pull, depending on the flags and stage.
6. Run `docker compose down` to clear the old stack. Add `--volumes` when `--nuke`.
7. Run `docker compose up -d` with `AGENTA_WEB_URL` set.
8. If web mode is local, install web deps and run the web dev server on the host.

The agent runs in step 7 like any other service. No agent flag exists.

## The standard agent dev command

From the main checked-out branch:

```bash
./hosting/docker-compose/run.sh --build --license ee --dev --env-file .env.ee.dev.local
```

This is the dev default from `hosting/CLAUDE.md`. It brings up the full EE stack in dev mode,
including the `services` container (which hosts the Python agent service) and the `runner`
container (the Node runner).

From a git worktree, prefix a distinct project name and use a per-worktree env file so the
two stacks do not collide:

```bash
COMPOSE_PROJECT_NAME=agenta-ee-dev-instance2 ./hosting/docker-compose/run.sh \
  --license ee --dev --env-file .env.ee.dev.instance2
```

To stop the stack without removing volumes:

```bash
./hosting/docker-compose/run.sh --license ee --dev --down
```

## What run.sh starts for the agent

In the EE dev compose, the relevant services are:

- `services`. Runs uvicorn on port `8080` inside the container
  (`hosting/docker-compose/ee/docker-compose.dev.yml:519`). It hosts the Python agent
  service. Traefik routes `/services/` to it. It sets `AGENTA_RUNNER_INTERNAL_URL` to
  `http://runner:8765`. It depends on `runner` being healthy.

- `runner`. The Node runner (line 588 onward). In dev it runs `tsx src/server.ts` after
  rebuilding the Pi extension. It listens on `8765`. Its health check hits
  `http://127.0.0.1:8765/health` (line 652). It is not behind a compose profile, so it always
  comes up.

The `runner` service ships in every stage. It is present in dev, gh, and gh.ssl for both oss
and ee. For example the gh stage defines it at
`hosting/docker-compose/ee/docker-compose.gh.yml:451` and
`hosting/docker-compose/oss/docker-compose.gh.yml:493`. In gh it uses a prebuilt ghcr image
instead of building from source.

### The dev runner command, explained

The dev compose overrides the image CMD with a shell command (around line 600):

```sh
node scripts/build-extension.mjs &&
exec node_modules/.bin/tsx src/server.ts
```

It does two things. It rebuilds the Pi extension from the mounted `src`, because `dist/` is not
bind-mounted and a restart would otherwise keep a stale bundle and silently drop custom tools. It
then starts the server with `tsx`.

The Pi login itself is bind-mounted read-write at `/pi-agent` and the harness runs directly out of
it, so an OAuth token the harness refreshes mid-run persists back to the host login instead of
dying with the container.

## Ports

- `8765`. The Node runner sidecar. `GET /health` and `POST /run`. Internal to the stack.
- `8080`. The Python `services` container's uvicorn. Internal. Traefik routes `/services/`
  to it.
- Traefik. In dev the EE stack exposes Traefik on the host. The default mapping is
  `8080:8080` in the example compose, but the live local env file
  (`hosting/docker-compose/ee/.env.ee.dev.local`) sets `TRAEFIK_PORT=8280`, so the local box
  serves the whole stack on `:8280`.

The frontend talks to the agent through the gateway, not the runner. For example the local
env file points the chat slice at
`http://144.76.237.122:8280/services/agent/v0/messages`
(`NEXT_PUBLIC_AGENT_CHAT_API` in `.env.ee.dev.local`).

## Agent env vars

These are the agent-relevant variables. The example file lists them commented out
(`hosting/docker-compose/ee/env.ee.dev.example`, "Core endpoints" and "Agenta - Agent"
sections).

- `AGENTA_RUNNER_INTERNAL_URL`. Where the Python service finds the runner. Default
  `http://runner:8765`. When unset, the Python service spawns the runner CLI locally instead
  (see `runner_url` in `services/oss/src/agent/config.py` and `select_backend` in
  `services/oss/src/agent/app.py`).
- `SANDBOX_AGENT_PROVIDER`. `local` or `daytona`. Default `local`.
- `SANDBOX_AGENT_DAYTONA_API_KEY`, `_API_URL`, `_TARGET`, `_SNAPSHOT`, `_IMAGE`,
  `_INSTALL_PI`. Daytona credentials the runner reads for the `daytona` sandbox provider.
- `SANDBOX_AGENT_DAYTONA_AUTOSTOP_MINUTES`. Idle minutes before Daytona auto-stops a sandbox.
  Default `15`. Leak backstop: the create object pairs `ephemeral` (auto-delete on stop) with
  this non-zero auto-stop so a sandbox the runner leaks (a process KILL skips the per-run
  teardown) self-reaps instead of burning credit. Values below `1` fall back to the default
  (a `0` would re-disable auto-stop and reintroduce the leak).
- `SANDBOX_AGENT_RELAY_MCP_BUNDLE`. Overrides the path of the in-sandbox stdio MCP shim bundle
  the runner uploads to Daytona for non-Pi tool delivery. Default
  `dist/tools/tool-mcp-stdio.js` (built by `pnpm run build:extension`). Trusted deployment
  configuration — it selects code — never run or request configuration.
- `AGENTA_RUNNER_SESSION_KEEPALIVE`. Gates session keep-alive: after a turn ends, the runner
  parks the live harness session and continues it on the next matching message in the same
  conversation, instead of cold-replaying the transcript. Default off. Local sandbox only;
  requires mount signing (no mount scope means the session never parks). Design:
  `docs/design/agent-workflows/projects/session-keepalive/plan.md`.
- `AGENTA_RUNNER_SESSION_TTL_MS`. How long an idle parked session lives before it is
  destroyed. Default `60000`.
- `AGENTA_RUNNER_SESSION_APPROVAL_TTL_MS`. How long a session parked on a Claude ACP approval
  gate holds its pending permission request open. Default `300000`. Expiry degrades to the
  cold decision-map path.
- `AGENTA_RUNNER_SESSION_POOL_MAX`. Maximum parked sessions per runner replica (LRU evicts
  idle sessions; busy and awaiting-approval sessions are never evicted). Default `8`.

The `runner` container deliberately has no `env_file`. The harness sandbox must not inherit
the stack's secrets. The compose block comments explain this
(`hosting/docker-compose/ee/docker-compose.dev.yml`, around line 604). Tools run server-side
in the Python service, so the sandbox only needs its own port, the Pi login, an OTLP export
fallback, and the Daytona credentials.

## Running the Node runner outside Docker

You can run the runner directly. From `services/runner/`, with Node 24 on PATH
(`services/runner/AGENTS.md`):

```bash
pnpm install
pnpm run serve     # HTTP sidecar on :8765, GET /health and POST /run
pnpm run run:cli   # one JSON request on stdin, one result on stdout
```

This is a standalone pnpm package. It is not part of the web workspace. It runs through `tsx`
with no compile step. The only build is `pnpm run build:extension`, which bundles the Pi
extension into `dist/`.

When the Python service runs in a source checkout with `AGENTA_RUNNER_INTERNAL_URL` unset, it
spawns this runner through the CLI path instead of calling it over HTTP. See `select_backend`
in `services/oss/src/agent/app.py:192` and `runner_url` in `services/oss/src/agent/config.py:46`.

## See also

- The `run-sh` skill at `.claude/skills/run-sh/SKILL.md`. It is a useful overview but its
  flag list is stale. Trust `hosting/docker-compose/run.sh` and `docs/packs/hosting.md` for
  the current flags.
- `hosting/CLAUDE.md` for the worktree project-name pattern.
- `agent-configuration.md` for what the config payload contains.
- `architecture.md` and `ports-and-adapters.md` for the service split rationale.
