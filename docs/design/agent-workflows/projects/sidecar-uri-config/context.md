# Context

## Why this exists

Today the agent service decides which runner (sidecar) to call from environment variables
alone. The agent service (`services/oss/src/agent/`) is the control plane; the Node runner
sidecar (`services/agent/`) is the execution plane. The control plane reaches the execution
plane at `POST /run`. Which sidecar it reaches is fixed at deploy time by
`AGENTA_AGENT_RUNNER_URL` (HTTP) or, when that is unset, a local TypeScript runner spawned from
`AGENTA_AGENT_RUNNER_DIR`.

The reviewer on PR #4821 asked for a per-run override: an **optional `uri`** in the agent
config that names the sidecar address, and routing that **prefers** that address when present
and **falls back** to the env vars when it is absent.

The original review thread sits on the agent-config schema doc
(`docs/design/agent-workflows/interfaces/public-edge/agent-config-schema.md`, line 27), which is
why the field is being designed as part of the config surface rather than, say, a deployment
knob.

## The reviewer's ask, verbatim

> instead we should have an optional uri that points to sidecar and provide an address of the
> thing (the sandbox should probably use this uri to determine where to route the request). if
> the uri is not set then we use the environment variables

Two parts:

1. **An optional `uri`** in the config that gives the sidecar address.
2. **Routing uses it** to decide where `/run` goes; **unset → env-var resolution** as today.

## What "the config" means here, precisely

The agent surface has two distinct config models (see the agent-config-schema interface doc):

- **`AgentConfig`** (neutral) — *what the agent is*: instructions, model, tools, MCP servers,
  skills, harness options. It is harness-agnostic and is the thing that would, one day, be
  stored as a versioned artifact.
- **`RunSelection`** — *where and how a run executes*: `harness`, `sandbox`,
  `permission_policy`. The handler reads it from the same `parameters` object but keeps it
  deliberately out of the neutral `AgentConfig`.

A sidecar address is a **routing** fact (where the run goes), exactly like `sandbox`. So this
design places `uri` in `RunSelection`, not in `AgentConfig`. The field is surfaced on the
playground-facing `AgentConfigSchema`, which already carries the run-selection trio
(`harness`/`sandbox`/`permission_policy`) for editing. See [research.md](research.md) for the
evidence and [plan.md](plan.md) for the exact placement.

## Goals

- Let a run name its sidecar address and have routing honor it.
- Keep the env-var path as the fallback when `uri` is unset (the default, unchanged).
- Make the change in the single routing seam (`select_backend`) without touching the
  service→runner `/run` wire contract or the golden fixtures.
- Decide and document the security posture of a caller-supplied address before any code lands.

## Non-goals

- **No `/run` wire field.** `uri` decides which runner the service opens the boundary to; it
  does not cross that boundary. The runner never receives it. The golden wire fixtures stay
  byte-identical.
- **No back-compat machinery.** Pre-production; the env-var fallback is kept because it is the
  right default, not for compatibility.
- **No new transport.** Reuses the existing HTTP delivery (`deliver_http` /
  `deliver_http_stream`). A `uri` only changes the URL, not how bytes move.
- **No sidecar trust/transport hardening here.** mTLS, a `/run` shared token, scoped tokens —
  those belong to the [sidecar-trust-and-sandbox-enforcement](../sidecar-trust-and-sandbox-enforcement/README.md)
  project. This project only adds the *address selection* and the *restriction* that a
  caller-supplied address requires (see [security.md](security.md)).
- **No deployment-shape changes.** The env contract, Compose/Helm/Railway wiring, and the
  `sandbox-agent` naming are the [sidecar-deployment-proposal](../sidecar-deployment-proposal/README.md)
  project's scope. This `uri` is the per-run override layered *on top* of that default contract.
