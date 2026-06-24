# Agent Service Handler

The handler is where a generic workflow request becomes an agent run. It sits between the
workflow route and the neutral runtime, and it owns the order in which a run is assembled:
parse the config, resolve everything the run needs, build one `SessionConfig`, pick a
backend and harness, and execute. Most run-level behavior changes pass through this file, so
the order it runs in is itself a contract.

## What it reads

The handler (`_agent` in `app.py`) takes the workflow envelope's pieces:

- `parameters`: carries the agent config under `agent`. The run-selection fields (`harness`,
  `uri`, `permission_policy`) live on that same `agent` object.
- `messages` or `inputs.messages`: the turn history (it checks `messages` first).
- `stream`: batch versus streaming.
- `session_id`: the external conversation id.

## What it does, in order

1. Parse the config: `AgentConfig.from_params(params, defaults=...)`. One parse covers
   everything, including the run-selection fields (`harness`, `uri`, `permission_policy`).
2. Convert the request messages to neutral `Message[]`.
3. Resolve tools into builtin names, runnable specs, and a tool callback.
4. Resolve MCP servers.
5. Resolve the model connection and its scoped secrets. The capability check runs in two
   halves: provider and mode before resolution, deployment after. Unnamed default
   connections degrade tolerantly to an empty `env` rather than failing the run.
6. Build one `SessionConfig` carrying all of the above plus trace context and session id.
7. Select the backend (`SandboxAgentBackend`) and make the harness, which validates that the
   harness is supported. `select_backend` routes by the config's `uri`: routing precedence is
   the config's `uri` (validated against the server-side allowlist) -> `AGENTA_AGENT_RUNNER_URL`
   -> the local runner CLI. A set-but-disallowed `uri` fails loud (no silent fallback). The
   sidecar at the resolved address is configured local-or-Daytona by its own env, so the
   service sends a constant `sandbox` default on the wire rather than a per-run selector.
8. Run: stream Vercel parts, or await one batch turn that returns
   `{"role": "assistant", "content": result.output}`.
9. Record usage.

## App build: binding the builtin URI

`create_agent_app()` binds the handler to the canonical builtin URI `agenta:builtin:agent:v0`
instead of letting it fall to an auto `user:custom:...` URI, so the handler and the interface
`/inspect` advertises share one identity. The order avoids two traps:

1. **Instrument before registering.** `register_handler(auto_instrument(_agent), uri=...)` — not the
   raw `_agent`. `ag.workflow` only instruments inside its own `_register_handler`, which it skips
   once a handler already exists in the registry, so the service registers the instrumented one.
2. **Override the interface.** `register_interface(...)` REPLACES the SDK's minimal seed for the
   URI with the service interface (`AGENT_SCHEMAS`), so `retrieve_interface(uri)` returns what
   `/inspect` advertises. This is process-local to the agent service; the API catalog still builds
   from the SDK defaults in its own process.

Then `ag.workflow(uri="agenta:builtin:agent:v0", schemas=AGENT_SCHEMAS, meta=...)(_agent)` resolves
the instrumented handler and merges the registered interface (the passed `schemas`/`meta` win).

## Owned by

- `services/oss/src/agent/app.py`

## Watch for when changing

- **Where config lives.** The agent config, including its run-selection fields, rides
  `parameters.agent`. Moving it breaks the form and the playground request builder.
- **Default application.** The handler merges request params over a default agent config.
  Changing the merge changes what an empty form runs.
- **Resolution order.** Provider and mode gate before resolution; deployment gates after.
  The tolerant default path is deliberate. Reordering can turn a clean reject into a leak or
  a hard failure.
- **Batch versus streaming.** Two execution paths return two shapes. Keep them in sync.
- **Sidecar routing and the allowlist.** A caller-supplied `uri` controls where the service
  ships resolved secrets and bearer tokens, so it is honored only when its origin is on
  `AGENTA_AGENT_RUNNER_URI_ALLOWLIST` (default empty = every override rejected, feature off).
  Loosening the gate is a security change. `resolve_runner_url` / `validate_runner_uri` live in
  `services/oss/src/agent/config.py`.
