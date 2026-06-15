# WP-2 implementation plan: agent service wrapping Pi

Status: MVP built and verified by curl (2026-06-15). Decisions below were taken; the
"Implemented" section records what shipped. Original decision points are kept marked
**[DECISION]** for history.

## Implemented (MVP, verified by curl)

Per the decisions: a Python service exposes the Agenta `/invoke` contract (auth,
middleware, CORS via `ag.create_app`) and calls a thin TypeScript Pi wrapper. Standalone,
verified with curl. Pi runs on the local login (`openai-codex` / `gpt-5.5`).

What shipped:

- TypeScript Pi wrapper: `services/agent/` (`src/runPi.ts`, `src/cli.ts`). One-shot
  JSON-over-stdio: read a request on stdin, drive Pi's SDK (`createAgentSession`) with
  AGENTS.md injected in memory, write the reply as JSON on stdout. Pinned
  `@earendil-works/pi-coding-agent@0.79.4`. Editable config in `services/agent/config/`
  (`AGENTS.md`, `agent.json`), read per request so edits need no restart.
- Python service: `services/oss/src/agent.py` mirrors `chat.py` (`ag.create_app` +
  `ag.workflow` + `ag.route`, `is_chat` flag). Ports and adapters in
  `services/oss/src/agent_pi/`: `Harness` port + `PiHarness` (spawns the wrapper over the
  JSON transport), `Runtime` port + `LocalRuntime` (local subprocess; Daytona slots in
  here later).
- Standalone entrypoint: `services/entrypoints/agent_main.py` mounts only the agent app +
  `/health` for isolated local runs.

How to run and verify locally:

```bash
cd services/agent && pnpm install            # once
cd ../ && set -a && source ../.env.test.local && set +a
AGENTA_SERVICES_MIDDLEWARE_AUTH_ENABLED=false \
  uv run uvicorn entrypoints.agent_main:app --host 0.0.0.0 --port 8090

curl -s -X POST http://localhost:8090/agent/v0/invoke -H "Content-Type: application/json" \
  -d '{"data":{"inputs":{"messages":[{"role":"user","content":"Hi, who are you?"}]}}}'
# -> {"data":{"outputs":{"role":"assistant","content":"Hi! I'm your friendly hello-world AI assistant."}}, "status":{"code":200}, ...}
```

## Dockerized (verified by curl)

The agent now runs fully in Docker via a dedicated, self-contained compose that does not
touch other stacks. Two containers:

- `agent-pi`: the TypeScript Pi wrapper as an HTTP sidecar
  (`services/agent/src/server.ts`, `docker/Dockerfile.dev`). It copies the read-only
  mounted `~/.pi/agent` login into a writable container path at startup, so OAuth refresh
  never writes back to the host. `node_modules` is baked into the image; `src` is
  bind-mounted so `tsx watch` hot-reloads code edits. Adding npm deps needs a rebuild.
- `agent-api`: the Python agent service, built from the current services dev Dockerfile
  (`agenta-agent-api:dev`, a dedicated tag). Selects the HTTP harness via
  `AGENTA_AGENT_PI_URL` and calls the sidecar in-network. Published on host port 8092.

The Python -> Pi seam is now two adapters behind the same Harness port: `PiHarness`
(subprocess, local) and `PiHttpHarness` (HTTP, docker). `agent.py` picks by env.

Run and verify:

```bash
docker compose -f services/agent/docker-compose.agent.yml up --build -d
curl localhost:8092/health
curl -s -X POST localhost:8092/agent/v0/invoke -H 'Content-Type: application/json' \
  -d '{"data":{"inputs":{"messages":[{"role":"user","content":"Hi, who are you?"}]}}}'
# -> 200, {"data":{"outputs":{"role":"assistant","content":"Hello from your friendly Docker agent!"}}, ...}
docker compose -f services/agent/docker-compose.agent.yml down   # tear down
```

Note: do not reuse the stale `agenta-oss-dev-services:latest` image (Python 3.11, old SDK
without `route(app=...)`); the compose builds a fresh `agenta-agent-api:dev` from the
current Dockerfile instead.

Known gaps / next steps: auth header is bypassed for local curl; streaming, multi-message
output, and tools; tracing across the boundary is being wired in (OTel deps + `agenta-otel.ts`
in the wrapper, `TraceContext` in the ports) and the HTTP path / OTLP target still need
finishing; registering `agenta:builtin:agent:v0` as a real workflow type + template (WP-6)
and pointing a real dev stack at the sidecar so it runs from the playground.

---

Status: draft for review. Add inline comments anywhere. Decision points are marked
**[DECISION]** and have a recommended default.

## Context

Agenta runs prompt-style workflows today (completion, chat, LLM-as-a-judge). Each is a
Python FastAPI app exposing `/invoke` and `/inspect`, all mounted in one `services`
container (`services/entrypoints/main.py`). The backend and playground call a service by
POSTing a `WorkflowInvokeRequest` to `{serviceUrl}/invoke` and reading
`WorkflowBatchResponse.data.outputs` back.

WP-2 adds a new kind of workflow: an agent. An agent runs a harness (Pi by default) that
drives a model over multiple turns. Pi is a TypeScript/Node SDK
(`@earendil-works/pi-coding-agent`, pinned `0.79.4`). It has no Python SDK. So the agent
service is a Node service, the first non-Python service in the dev stack.

This work package builds only the service. It runs Pi locally (no Daytona), with hardcoded
config (AGENTS.md text, model, provider key from env). The goal is to stand up the right
ports and adapters even for the simplest MVP, so Daytona and other harnesses slot in later
without reshaping the service.

Source: `wp-2-agent-service/README.md` and the research it links
(`research/pi-interaction.md`, `research/diskless-in-memory-config.md`).

## What I confirmed in the codebase

- All Python services run in one `services` container, each mounted at its own path and
  exposing `/invoke` + `/inspect` (`services/entrypoints/main.py:135`).
- The chat handler takes `inputs`, `messages`, and `parameters`
  (`services/oss/src/chat.py:18`). The routing decorator pulls these from the
  `WorkflowInvokeRequest` envelope.
- The playground resolves `serviceUrl` from the workflow's `data.url` (or builds it from
  `data.uri`) and POSTs directly from the browser to `{serviceUrl}/invoke`
  (`web/packages/agenta-entities/src/workflow/state/runnableSetup.ts:246`). So the service
  needs the same request/response shapes and CORS as the Python services
  (`services/entrypoints/main.py:115`).
- The dev stack hot-reloads via bind mounts plus uvicorn `--reload`, and traefik routes
  `PathPrefix(/services/)` after stripping the prefix
  (`hosting/docker-compose/oss/docker-compose.dev.yml:351`).
- Research confirms Pi runs fully diskless through its SDK: in-memory auth, AGENTS.md,
  model, and sessions (`research/diskless-in-memory-config.md`).

## Scope

In:
- A new Node/TypeScript service that exposes the Agenta `/invoke` contract directly.
- Drives Pi through its SDK (`createAgentSession`) in-process, config in memory.
- Hardcoded config: AGENTS.md text, model id, provider key from env. Config read from a
  mounted file so it is editable and hot-reloads.
- Ports and adapters wired from the start (see Architecture).
- Dockerized with hot-reload, wired into the OSS dev compose and traefik.

Out (later WPs, per the design doc):
- Daytona sandbox. The runtime adapter is the local process for now.
- Streaming and multi-message output. This cut returns the final assistant text as a
  single `data.outputs`.
- Custom tools and skills. Stubbed for the first cut.
- Server-side config persistence. Config is passed in at startup.
- Other harnesses (Codex, Claude Code). Design the port for them, implement only Pi.

## Architecture: ports and adapters

The service is harness-agnostic at its core, with the two ports the design doc calls out.

```
HTTP layer (Fastify or Express): POST /invoke, POST /inspect, GET /health, CORS
        |
Core (no Pi, no Daytona):
   AgentRunner.run(config, messages, inputs) -> { output }
        |                                  |
   Port: Harness                      Port: Runtime (environment)
   setup(config)                      start() / shutdown()
   invoke(messages, inputs)           pause() / connectVolume()
   stop() / shutdown()
        |                                  |
   Adapter: PiSdkHarness              Adapter: LocalRuntime
   (createAgentSession,              (in-process; the Node process
    in-memory auth + AGENTS.md         itself is the run environment)
    + model, SessionManager
    .inMemory())                      [later: DaytonaRuntime in WP-3]
   [later: PiRpcHarness]
```

- Harness port: the seam between our service and the agent engine. Pi is one
  implementation. The MVP ships one adapter, `PiSdkHarness`. The doc also floats RPC and
  JSON adapters; the port shape leaves room for `PiRpcHarness` later.
  **[DECISION]** Drive Pi via the SDK in-process for the MVP (recommended: simplest for a
  Node service, gives in-memory auth + AGENTS.md + model), rather than spawning `pi --mode
  rpc`.
- Runtime port: the seam for the run environment (start, shutdown, pause, connect volume).
  The MVP adapter is `LocalRuntime` (the Node process). `DaytonaRuntime` lands in WP-3
  behind the same port.

### PiSdkHarness (the MVP adapter)

Per `research/diskless-in-memory-config.md`:
- `AuthStorage.inMemory()` + `setRuntimeApiKey(provider, key)` for the LLM key.
- `DefaultResourceLoader` with `noContextFiles: true` and `agentsFilesOverride` (or
  `systemPromptOverride`) to inject AGENTS.md text in memory.
- `SessionManager.inMemory()`, `SettingsManager.inMemory()`,
  `ModelRegistry.inMemory(auth)` so nothing persists.
- `model: getModel(provider, modelId)`.
- `TMPDIR` set to a tmpfs for Pi's bash output spillover (the one forced write).
- MVP run: `await session.prompt(text)`, then read the final assistant text from
  `session.messages` (or the `agent_end` event). Return it as `data.outputs`. No
  streaming.

## HTTP contract (mirror chat)

- `POST /invoke`: accept `{ data: { parameters, inputs }, references?, ... }`. Pull the
  user message from `inputs`/`messages` the way chat does
  (`services/oss/src/chat.py:18`). Return
  `{ version, data: { outputs }, status: { code: 200 }, trace_id, span_id }`.
- `POST /inspect`: return the parameters/inputs schema. The MVP can return a minimal
  static schema, enough for the backend inspect path.
- `GET /health`: `{ status: "ok" }`.
- CORS: allow the same origins as the Python services so the browser can call it directly.

Auth note: the Python services verify an `Authorization: Secret {token}` header via SDK
middleware. The local MVP can accept the header without verifying it. Real verification is
a later concern. Flagging this as a known gap.

## Repo placement and Docker

- New Node project at `services/agent/`: own `package.json`, `tsconfig.json`, `src/` (with
  `http/`, `core/`, `adapters/pi/`, `adapters/runtime/`), `config/` (the editable
  AGENTS.md and model config), and `docker/Dockerfile.dev` + `docker/Dockerfile.gh`.
- Pin `@earendil-works/pi-coding-agent@0.79.4` and `@earendil-works/pi-ai@0.79.4`.
- Hot-reload: run with `tsx watch` (or `node --watch`). Bind-mount `services/agent/src` and
  `services/agent/config`; keep `node_modules` in the image via an anonymous volume so the
  host/container split does not break it.
- New compose service block in `hosting/docker-compose/oss/docker-compose.dev.yml` (model
  the existing `services` block at line 351). Own port (for example 8090), traefik router
  `PathPrefix(/agent/)` that strips the prefix, env_file for the provider key.
- The provider key (for example `OPENAI_API_KEY`) goes in the dev env file the compose
  service reads.

## Verification

1. Bring up the OSS dev stack with the new service:
   `./hosting/docker-compose/run.sh --oss --dev --build`.
2. `curl http://localhost/agent/health` returns ok.
3. `curl -X POST http://localhost/agent/invoke` with a chat-style body and a message;
   confirm the response carries the agent reply in `data.outputs`. This is the core WP-2
   definition of done.
4. Edit `services/agent/config/AGENTS.md`; confirm the change is picked up without a
   rebuild.
5. End-to-end demo (only if decided in scope below): register an agent workflow whose
   `data.url` points at the agent service, open it in the playground, send a message, see
   the output.

## Decisions to confirm

**[DECISION 1] Service shape.** Recommended: a pure Node service that speaks `/invoke`
directly (matches the doc, fewest moving parts). Alternative: a Python shim in the existing
services container that bridges to a Node Pi sidecar (reuses Agenta auth/tracing
middleware, adds a hop).
> Your call: We should use python then call ts for the moment. The Py provides authentication, middleware, and a bunch of things. 

**[DECISION 2] How far this iteration goes.** Option A: standalone service, verified by
curl (the true WP-2 definition of done). Option B: also wire the minimal end-to-end so you
can create an agent and run it in the playground (overlaps WP-6's workflow-type
registration).
> Your call: Let's start with the standalone service verified by curl

**[DECISION 3] LLM key for Pi.** `.env.test.local` only has Agenta cloud creds, not a model
key. Pi needs a real provider key to run. Which provider and model for the hardcoded
"hello world" agent (for example OpenAI `gpt-4o-mini`)? Can you supply the key as an env
var for a live verification, or should I build without live verification for now?
> Your call: I have set up 

**[DECISION 4] Pi driving mode.** Recommended: SDK in-process. Alternative: `pi --mode rpc`
subprocess. SDK is simpler here and supports in-memory auth and AGENTS.md.
> Your call:
I have set up auth What's left — your one-time Pi login
`~/.pi/agent` doesn't exist yet, so no model is available. Pi can't reuse the `~/.codex` token directly; it needs its own login (same ChatGPT account, browser OAuth — I can't drive that for you):

```bash
cd docs/design/agent-workflows/wp-1-pi-tracing/poc
pnpm exec pi          # TUI opens
# type:  /login  →  choose "ChatGPT Plus/Pro (Codex)"  →  finish browser OAuth  →  quit
pnpm start            # runs the agent, exports the trace
```

(Or `export OPENAI_API_KEY=...` / `ANTHROPIC_API_KEY=...` instead of logging in.)

After `pnpm start`, watch for `[agenta-otel] exporting spans to .../api/otlp/v1/traces` and `[run] flushed`, then open Agenta observability on the dev box and find the `invoke_agent` trace — verify the tree types correctly and the `chat` span carries model, latency, and token usage.

Want me to wait while you log in, then I'll run it and verify the trace in Agenta together — or would you rather I add the Pi-native model-usage cost (`gen_ai.usage.cost`) display check to the verification while you do that?


 Logged in to ChatGPT Plus/Pro (Codex Subscription). Selected gpt-5.5. Credentials saved
 to /home/mahmoud/.pi/agent/auth.json
