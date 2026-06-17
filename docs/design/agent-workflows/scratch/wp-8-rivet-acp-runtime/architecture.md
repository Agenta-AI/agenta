# Architecture

## Principle

Keep the `Harness` port and the `/invoke` contract. Add one adapter behind the port that
runs the agent through rivet over ACP, and a small TypeScript runner that wraps the rivet
SDK. Everything Pi-specific moves below the port and becomes one harness choice.

```
                 unchanged
  ┌───────────────────────────────────────────────┐
  │ agent.py  (/invoke, /inspect, ag.create_app)   │
  │   _resolve_run_config / _latest_user_message   │
  │   _build_harness()  ── selects adapter by env  │
  └───────────────────────────────────────────────┘
                      │  Harness port (setup / invoke / shutdown)
                      ▼
  ┌───────────────────────────────────────────────┐
  │ RivetHarness (new, Python)                     │   PiHarness / PiHttpHarness
  │  maps HarnessRequest + {harness, sandbox} →    │   (kept; legacy path)
  │  a one-shot rivet run; passes trace + secrets  │
  └───────────────────────────────────────────────┘
                      │  /run (HTTP or stdio), same contract family as runPi
                      ▼
  ┌───────────────────────────────────────────────┐
  │ runRivet.ts  (services/agent, wraps rivet SDK) │
  │  start({ sandbox, env }) → createSession({     │
  │  agent, cwd }) → write AGENTS.md → prompt →     │
  │  collect chunks → destroy                       │
  └───────────────────────────────────────────────┘
                      │  spawns the daemon (local subprocess, or in Daytona)
                      ▼
  ┌───────────────────────────────────────────────┐
  │ sandbox-agent daemon (Rust, one per invoke)    │
  └───────────────────────────────────────────────┘
                      │  ACP (JSON-RPC: session/prompt, session/update)
                      ▼
  ┌───────────────────────────────────────────────┐
  │ harness ACP adapter subprocess in cwd          │
  │  pi-acp │ claude-code-acp                       │
  └───────────────────────────────────────────────┘
```

The ACP boundary is daemon to harness. That is the requirement: the agent loop runs over
ACP, not the Pi JSON envelope. The service-to-rivet hop is rivet's own control surface and
stays harness-agnostic behind the port.

## Two orthogonal swap axes

These swap independently. Do not bundle them.

- **Sandbox (where the daemon runs):** `local`, `daytona`. A config value passed to
  `runRivet`, which selects the rivet provider.
- **Harness (which engine):** `pi`, `claude`. A config value passed as the rivet `agent`.

The demo proves each separately: swap `local` and `daytona` with the harness fixed, and
swap `pi` and `claude` with the sandbox fixed.

## Lifecycle: one daemon and one sandbox per invoke (cold)

Each `/invoke` brings up its own daemon and sandbox, runs, and tears down. This copies the
shipped code-evaluator pattern (`DaytonaRunner`: an ephemeral sandbox per execution from a
snapshot, deleted in a `finally`). Two reasons it is the right default:

- It makes the daemon's environment **per-invoke**, which is what makes tracing work
  without forking anything (see below).
- It needs no filesystem jail, because agents never share a daemon.

Cost is acceptable. Locally the daemon is a Rust binary that boots in tens of
milliseconds, so the per-invoke cost is the Node adapter spawn (~0.2 to 0.5s). On Daytona
the sandbox create adds ~1s. Concurrency is bounded the way evaluations already bound it
(see Concurrency).

## Tracing: inject at the daemon's birth

The agent's spans must nest under the `/invoke` span. Standalone traces are not
acceptable. The mechanism is uniform across sandboxes because each invoke owns its daemon:

- The static OTLP target and auth (`OTEL_*`, the Agenta endpoint and `Authorization`) and
  the per-invoke `traceparent` go into the daemon's environment when it is created.
  - **Local:** the SDK `env` option on `start({ sandbox: local(), env })`.
  - **Daytona:** the sandbox `env_vars`, exactly like `DaytonaRunner` injects `AGENTA_*`.
- The daemon passes its env to the adapter subprocess, which passes it to the harness.
- **Pi:** install the `agenta-otel` logic as a Pi extension in the environment (global
  `~/.pi/agent/extensions`, or baked into the Daytona snapshot). Pi loads it and emits
  spans under the injected `traceparent`.
- **Claude Code:** set `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_*`, and `TRACEPARENT`, and
  run it in `-p` / Agent-SDK mode.

No fork of rivet or the adapters is needed under the per-invoke model. A fork (the
TypeScript adapter reading ACP `_meta.traceparent`, not Rust) is only needed if a later
phase shares one warm daemon across concurrent invokes.

## Components

### `RivetHarness` (Python, new)

`services/oss/src/agent_pi/rivet_harness.py`, implements the `Harness` ABC. It holds the
harness id and sandbox choice (from config) and the trace/secret context, and maps a
`HarnessRequest` onto a `runRivet` `/run` call. Field mapping:

| `HarnessRequest` | Becomes |
| --- | --- |
| `agents_md` | written as `AGENTS.md` into the session `cwd` |
| `model` | session model where the harness honors it (the adapter normalizes this) |
| `prompt` | the ACP prompt text |
| `messages` | MVP uses the latest user turn; history replay is later |
| `tools` etc. | unused (empty) in WP-8 |
| `trace` | injected as daemon env (`traceparent`, OTLP endpoint, auth) |

### `runRivet.ts` (TypeScript, in `services/agent`)

Wraps the rivet SDK. Selected by env (`AGENT_BACKEND=rivet`) and serves the same `/run`
contract `runPi.ts` serves, so the Python side stays thin. Per invoke:

1. `start({ sandbox: local() | daytona({...}), env })` (env carries trace + secrets).
2. `createSession({ agent: <harness>, cwd })`.
3. Write `AGENTS.md` (and later skills) into `cwd`.
4. `prompt(sessionId, prompt)`, accumulate `agent_message_chunk` into the output.
5. `destroy()`.
6. Return `{ ok, output, sessionId, model }`.

### `agent.py` selection

Extend `_build_harness()` with `AGENTA_AGENT_RUNTIME=rivet` to return `RivetHarness`
(harness from `AGENTA_AGENT_HARNESS`, sandbox from config, default `local`). Keep the Pi
path as default so nothing regresses.

## Agent configuration (the contract: filesystem plus config)

Resolved before each run: AGENTS.md, input variables (substituted into AGENTS.md), skills
(files in the workspace), tool definitions (empty here), harness, sandbox, secrets. The
contract handed to rivet is files in `cwd` plus the session/daemon config. Secrets go as
launch env, never as files, because there is no jail.

## Tools: definition vs body (deferred, but shapes the seam)

A tool splits into a **definition** (the schema the model sees, stored in a neutral
OpenAI-function shape) and a **body** (the execution). The body is swappable: real,
service-backed, or mock. A test variant of an agent swaps bodies without touching
definitions. Delivery is per-harness over **MCP** (rivet's per-directory MCP config), not a
raw OpenAI array. The body model is general and not Agenta-specific: a self-contained body
runs in-process, a service-backed body (for example a Composio tool calling Agenta's
`/tools/call`) needs its service reachable (a local or remote Agenta), and a mock needs
nothing. WP-8 ships no tools; this is the shape to preserve, not build.

## Sessions and state

A session is the **stored message history**, not a kept-alive sandbox. Because we offer no
persistent file writes, nothing on disk is worth keeping. So: ephemeral sandbox per turn,
persisted messages, continue by replaying history with ACP `session/load` (Pi
`resumeSession`, Claude Code `loadSession`). Zero at-rest cost. The history store is the
backend DB on the platform and a local file standalone. Tradeoff: long-history replay
re-sends tokens, so cap it. Paused or FS-persisted sessions wait until we offer durable
writes.

## Concurrency

Mirror evaluations. Do not run the agent inside the API request if a background path is
available; dispatch it like an evaluation (taskiq worker on a Redis stream) and bound
concurrency with a shared semaphore. Each concurrent slot is one ephemeral sandbox, so the
semaphore caps how many sandboxes (and how much Daytona cost) run at once. Extra invokes
queue. Locally a slot is a cheap subprocess.

## Running standalone via the SDK (later)

The harness and sandbox adapters are written to live in the SDK, so the backend service
and a standalone run share one implementation. Running locally is not special: the rivet
server is open source (Apache-2.0, a static binary), so a local run runs that server
locally and the SDK wraps the rivet client. A standalone run fetches or loads a config,
then calls the SDK runner.

## What this does not change

No new endpoints. No change to `/invoke` or `/inspect` shapes. No tools, no jail, no
multi-turn, no client-side streaming. Each is its own follow-on.
