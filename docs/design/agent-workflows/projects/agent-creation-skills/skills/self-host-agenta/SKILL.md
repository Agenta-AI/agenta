---
name: self-host-agenta
description: Run a self-hosted Agenta stack and wire up agents. Use when the user wants to self-host Agenta, start the local dev stack, run Agenta with or without the agent runner sidecar, enable Claude with an API key or a Claude subscription (OAuth) login, or configure provider keys, MCP, and the Daytona sandbox for self-hosted agents. Covers the docker-compose stack, the sandbox-agent runner, the subscription sidecar recipe, and the env that controls each.
allowed-tools: Read, Bash, Write, Grep, Glob
user-invocable: true
---

# Self-host Agenta

Stand up a self-hosted Agenta stack and run agents on it, with or without the agent runner
sidecar, with an API key or a Claude subscription login. This file is the procedure. Read
`reference.md` in this folder for the full env table and the trust model.

## The pieces

A running Agenta stack is one traefik fronting several containers. The ones that matter for
agents:

- `web` — the Next.js frontend.
- `api` — the management API (`/api/...`): workflows, vault, tools, projects.
- `services` — the workflow runner, including the builtin agent at
  `/services/agent/v0/...`. It drives the agent.
- `sandbox-agent` (optional) — the TypeScript runner sidecar. It is the thing that actually
  spawns the harness (Pi, Claude) over ACP. `services` talks to it over the compose network.

The agent works **without** the sidecar (the runner can spawn the harness CLI from a local
checkout) and **with** it (the deployed path, where `services` calls the sidecar over HTTP).
Which path runs is set by one env var, `AGENTA_AGENT_RUNNER_URL`.

## Run the stack (no agents, baseline)

From the repo root, on the main branch:

```bash
./hosting/docker-compose/run.sh --build --license ee --dev --env-file .env.ee.dev.local
```

- `--license ee` for the EE stack, `--license oss` for OSS.
- `--dev` mounts source for hot reload. Drop it for a production-style run.
- From a git worktree, prefix a distinct project name so compose does not collide:
  `COMPOSE_PROJECT_NAME=agenta-ee-dev-instance2 ... --env-file .env.ee.dev.instance2`.

The web app is on the traefik port (dev default `:8280`). Health: `curl $HOST/api/health`
-> `{"status":"ok"}`.

After it is up, set a provider key in the vault and create an agent with the
`create-agenta-agent` skill.

## Run agents WITHOUT the sidecar

The agent runner can spawn the harness CLI directly from a local source checkout. Leave
`AGENTA_AGENT_RUNNER_URL` unset and point `AGENTA_AGENT_RUNNER_DIR` at the runner source.
`services` then runs the TS runner as a subprocess. This is the lightest setup: no extra
container, but `services` needs Node and the runner deps available.

Use this for local development of the runner itself. For anything shared or deployed, use the
sidecar.

## Run agents WITH the sidecar (the deployed path)

The dev compose already defines the `sandbox-agent` service and wires it:

```
AGENTA_AGENT_RUNNER_URL=http://sandbox-agent:8765   # services -> sidecar over the compose net
```

When this is set, `services` POSTs each run to the sidecar's `/run`. The sidecar holds the
harness binaries (Pi is baked; Claude Code is installed at runtime). This is what runs on the
dev box today (compose project `agenta-ee-dev-wp-b2-rendering`).

Sidecar health: from the host, `curl http://<sidecar>:8765/health` ->
`{"status":"ok","engines":["sandbox-agent"],"harnesses":["pi_core","claude","pi_agenta"]}`.

The sidecar must stay loopback-only or on the private compose network. It receives resolved
provider keys in `/run` bodies, so it must never be exposed off-host. See `reference.md` for
the trust model.

## Claude: API key vs subscription (OAuth)

Claude Code (the `claude` harness) authenticates two ways.

### A. API key (managed)

Store an `anthropic` provider key in the project vault (see the `create-agenta-agent` skill,
"Set a provider key"). At invoke time Agenta resolves it server-side and injects
`ANTHROPIC_API_KEY` into the harness env. Use `harness: "claude"`, `model: "sonnet"` (or
`opus`/`haiku`/`default`). This is the normal self-host path.

### B. Subscription / OAuth (self-managed)

Drive Claude Code off a Claude **subscription** login (Max/Pro) instead of an API key. No key
is stored anywhere; the harness uses a mounted OAuth login. On the agent config set
`model.connection = {"mode": "self_managed"}` so Agenta injects nothing and the harness uses
its own login.

The reproducible recipe stands up a **second** sidecar that mounts the host's
`~/.claude` (read-only) and serves the existing runner image with no API key:

```bash
REPO=/path/to/agenta
IMAGE=agenta-ee-dev-sandbox-agent:latest
HOST_PORT=8790    # distinct, loopback-only

docker rm -f agenta-claude-sub-sidecar 2>/dev/null || true
docker run -d --name agenta-claude-sub-sidecar \
  --user "$(id -u):$(id -g)" \
  -p 127.0.0.1:${HOST_PORT}:8765 \
  -e PORT=8765 -e AGENTA_AGENT_RUNNER_HOST=0.0.0.0 -e NODE_ENV=development \
  -e HOME=/home/agent -e PI_CODING_AGENT_DIR=/pi-agent -e SANDBOX_AGENT_PROVIDER=local \
  --tmpfs /home/agent:exec,uid=$(id -u),gid=$(id -g) \
  -v "$REPO/services/agent/src":/app/src:ro \
  -v "$REPO/services/agent/skills":/app/skills:ro \
  -v "$HOME/.claude":/home/agent/.claude:ro \
  "$IMAGE" node_modules/.bin/tsx src/server.ts

curl -s http://127.0.0.1:${HOST_PORT}/health
```

Before mounting, confirm the host login is a subscription (OAuth), not an API key:
`~/.claude/.credentials.json` should have a `claudeAiOauth` block with `subscriptionType`
`max`/`pro` and an `sk-ant-oat01-...` access token (`sk-ant-api...` is an API key). The full
recipe, including the OAuth check and why each docker flag is there, is in
`docs/design/agent-workflows/projects/subscription-sidecar/README.md`.

This second sidecar is a DEV/TEST target by default. To make `services` send Claude runs to
it instead of the API-key sidecar, point `AGENTA_AGENT_RUNNER_URL` at it (or wire it via the
playground's composite sidecar URI). Keep it loopback-only.

## Daytona cloud sandbox (optional)

To run an agent in a Daytona cloud VM instead of locally, set `agent.sandbox = "daytona"` on
the config. The sidecar reads `SANDBOX_AGENT_DAYTONA_*` (API key, URL, target, snapshot) to
create the VM. The default snapshot is `agenta-sandbox-pi`. These are distinct from the api's
`DAYTONA_*` vars. ALWAYS tear a Daytona sandbox down after use and verify it is gone; never
leave a cloud sandbox open.

## Quick verification

After the stack is up and a provider key is set, run the `create-agenta-agent` skill's
bundled `create_agent.py` against your host. It creates, invokes, and (with `--archive`)
cleans up. A correct one-line answer proves the whole path: api -> services -> sidecar ->
harness -> provider.

## Gotchas

- The sidecar must never be reachable off-host. It carries resolved secrets in run bodies.
- The subscription sidecar needs a writable `HOME` (tmpfs) with the credential mounted
  read-only *into* it; run as the host user so it can read the mounted `~/.claude`.
- MCP is flag-gated. `AGENTA_AGENT_ENABLE_MCP` defaults to `false` in dev compose.
- New Python deps in `sdks/pyproject.toml` crash-loop the dev `api` container on hot reload;
  rebuild (`run.sh --build`) rather than relying on reload.
- A non-secure HTTP dev host disables `crypto.randomUUID` and other secure-context Web APIs;
  the frontend can crash silently. Use HTTPS for anything beyond local poking.
