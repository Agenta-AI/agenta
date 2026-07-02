# self-host-agenta: reference

The env that controls the agent runtime, and the trust model. Loaded on demand by the
`self-host-agenta` skill.

## Topology

One traefik fronts the stack. The agent path:

```
client -> traefik -> api        (/api/...)        management: workflows, vault, tools
                  -> services   (/services/...)   the builtin agent /services/agent/v0/*
services -> sandbox-agent (8765) the runner sidecar that spawns the harness over ACP
sandbox-agent -> Pi | Claude Code  the harness
harness -> provider (OpenAI, Anthropic, ...) using the resolved key or the harness login
```

`api` is reached at `/api/...`, `services` at `/services/...`, both behind the same traefik
host (dev `:8280`).

## Env that controls the agent runtime

Set on the `services` container (it owns backend selection) unless noted.

| Var | Where | Default | Effect |
|---|---|---|---|
| `AGENTA_AGENT_RUNNER_URL` | services | unset (dev compose sets `http://sandbox-agent:8765`) | Set -> POST runs to the sidecar's `/run` (deployed path). Unset -> spawn the runner CLI locally. |
| `AGENTA_AGENT_RUNNER_DIR` | services | runner source dir | Where to find the TS runner when spawning locally. |
| `AGENTA_AGENT_RUNNER_TIMEOUT_SECONDS` | services | 180 | Run timeout for the HTTP/subprocess call. |
| `AGENTA_AGENT_ENABLE_MCP` | services | `false` | Gate MCP servers on the agent config. |
| `SANDBOX_AGENT_PROVIDER` | sidecar | `local` | `local` daemon vs cloud sandbox provider. |
| `SANDBOX_AGENT_DAYTONA_API_KEY` | sidecar | empty | Daytona API key (for `sandbox: "daytona"` runs). |
| `SANDBOX_AGENT_DAYTONA_API_URL` | sidecar | empty | Daytona API URL. |
| `SANDBOX_AGENT_DAYTONA_TARGET` | sidecar | empty | Daytona region, e.g. `eu`. |
| `SANDBOX_AGENT_DAYTONA_SNAPSHOT` | sidecar | `agenta-sandbox-pi` | Daytona snapshot to boot. |
| `ANTHROPIC_API_KEY` | sidecar | unset | Inherited only on a managed run; the subscription path sets none. |
| `PORT` | sidecar | 8765 | Sidecar listen port. |
| `AGENTA_AGENT_RUNNER_HOST` | sidecar | `0.0.0.0` | Bind host inside the container. |

The per-request `sandbox` axis (`local` vs `daytona`) is on the agent config, not env. The
backend is always the sandbox-agent backend; only the transport (`RUNNER_URL`) and the
sandbox axis vary.

## Two backend paths

- **Sidecar path** (deployed): `AGENTA_AGENT_RUNNER_URL` set. `services` POSTs to the
  sidecar over the compose network. The sidecar holds the harness binaries. This is the
  default on the dev box.
- **Local-spawn path** (runner dev): `AGENTA_AGENT_RUNNER_URL` unset,
  `AGENTA_AGENT_RUNNER_DIR` points at the runner checkout. `services` runs the TS runner as a
  subprocess. No sidecar container; `services` needs Node and the runner deps.

## Claude auth paths

| Path | Connection mode | Key storage | How the harness authenticates |
|---|---|---|---|
| API key (managed) | `agenta` (default) | `anthropic` provider key in the project vault | Agenta resolves the key server-side and injects `ANTHROPIC_API_KEY`. |
| Subscription (self-managed) | `self_managed` | none | The harness reads a mounted Claude OAuth login (`~/.claude/.credentials.json`); Agenta injects nothing. |

On a managed run, the runner clears ambient provider creds then injects the resolved key. On
a non-managed (`self_managed`) run, it keeps the inherited environment and the harness's own
login. That is why the subscription sidecar works with no code change: it just adds the
mounted login as infrastructure.

## Trust model (why the sidecar stays loopback-only)

The runner ships **resolved secrets in `/run` request bodies** (the injected provider key, code-tool and
MCP secrets). Anyone who can reach the sidecar can submit a run and observe its environment.
So the sidecar must be loopback-only (`127.0.0.1`) or confined to the private compose
network, never exposed off-host or to the public internet. The subscription sidecar binds
`127.0.0.1:8790` for exactly this reason.

The provider-key resolve uses the **caller's** auth (the `Authorization` on the invoke, else
the process `AGENTA_API_KEY`). A run never gets more access than the caller. A named
connection (`mode: agenta` + slug) selects one specific secret; the project default is used
when no slug is given; `self_managed` injects nothing.

## Port hygiene

When running multiple stacks or sidecars on one host, pick distinct host ports. Known users
on the dev box: `:8280/:8281` and `:8380/:8381` (web stacks via traefik), `:8480` (another
web stack), `:8790` (subscription sidecar), `5432/5434/5435` (Postgres). Sidecars bind their
host port to the container's `8765`.

## Source map

- Backend selection + invoke handler: `services/oss/src/agent/app.py`
- Runner config / env: `services/oss/src/agent/config.py`
- Compose definition + env wiring: `hosting/docker-compose/ee/docker-compose.dev.yml`
- Run command and worktree notes: `hosting/AGENTS.md`
- Sidecar Docker + OAuth notes: `services/agent/docker/README.md`
- Subscription sidecar recipe: `docs/design/agent-workflows/projects/subscription-sidecar/README.md`
- Sidecar deployment proposal (k8s/Helm/Railway plan): `docs/design/agent-workflows/projects/sidecar-deployment-proposal/`
