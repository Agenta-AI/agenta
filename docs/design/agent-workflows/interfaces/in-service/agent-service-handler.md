# Agent Service Handler

The handler is where a generic workflow request becomes an agent run. It sits between the
workflow route and the neutral runtime, and it owns the order in which a run is assembled:
parse the config, resolve everything the run needs, build one `SessionConfig`, pick a
backend and harness, and execute. Most run-level behavior changes pass through this file, so
the order it runs in is itself a contract.

## What it reads

The handler (`_agent` in `app.py`) takes the workflow envelope's pieces:

- `parameters`: carries the agent config under `agent` and the run selection (`harness`,
  `sandbox`, `permission_policy`) in the same object.
- `messages` or `inputs.messages`: the turn history (it checks `messages` first).
- `stream`: batch versus streaming.
- `session_id`: the external conversation id.

## What it does, in order

1. Parse config and selection: `AgentConfig.from_params(params, defaults=...)` and
   `RunSelection.from_params(params)`.
2. Convert the request messages to neutral `Message[]`.
3. Resolve tools into builtin names, runnable specs, and a tool callback.
4. Resolve MCP servers.
5. Resolve the model connection and its scoped secrets. The capability check runs in two
   halves: provider and mode before resolution, deployment after. Unnamed default
   connections degrade tolerantly to an empty `env` rather than failing the run.
6. Build one `SessionConfig` carrying all of the above plus trace context and session id.
7. Select the backend (`SandboxAgentBackend`) and make the harness, which validates that the
   harness is supported.
8. Run: stream Vercel parts, or await one batch turn that returns
   `{"role": "assistant", "content": result.output}`.
9. Record usage.

## Owned by

- `services/oss/src/agent/app.py`

## Watch for when changing

- **Where config lives.** Agent config and run selection share `parameters`. Moving either
  breaks the form and the playground request builder.
- **Default application.** The handler merges request params over a default agent config.
  Changing the merge changes what an empty form runs.
- **Resolution order.** Provider and mode gate before resolution; deployment gates after.
  The tolerant default path is deliberate. Reordering can turn a clean reject into a leak or
  a hard failure.
- **Batch versus streaming.** Two execution paths return two shapes. Keep them in sync.
