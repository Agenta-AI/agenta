# Workflow Inspect

`POST {route}/inspect` returns the workflow's interface description. The playground reads it
to build the config form and to know what the workflow accepts and returns. For the agent
service it returns the chat input schema, the output schema, and the editable agent config
schema. Change what this returns and you change what the playground renders.

## The contract

The raw response is an inspect envelope. The schemas and default config sit under
`data.revision.data`; top-level `meta` carries harness metadata when the registered agent
workflow provides it:

```jsonc
{
  "version": "2025.07.14",
  "meta": { "harness_capabilities": { /* per-harness provider/deployment limits */ } },
  "data": {
    "revision": {
      "data": {
        "uri": "agenta:builtin:agent:v0",
        "schemas": {
          "inputs":     { /* messages, marked x-ag-type-ref: "messages" */ },
          "parameters": { "properties": { "agent": { /* x-ag-type-ref: "agent_config" */ } } },
          "outputs":    { /* assistant message schema */ }
        },
        "parameters": { /* default agent config */ }
      }
    }
  }
}
```

Two markers do the heavy lifting. `x-ag-type-ref: "messages"` tells the playground this is a
chat workflow. `x-ag-type-ref: "agent_config"` tells it to render the agent config control.
Each marker resolves through `/workflows/catalog/types/{type}` to the full JSON Schema, so
the form and the schema stay in one place. The `meta.harness_capabilities` block is the same
table the service uses server-side to reject unreachable provider and deployment choices, so
the form can filter stored connections before the user submits when that metadata is present.

The shape of the config itself lives in [Agent config
schema](agent-config-schema.md). This page covers what `/inspect` returns; that page covers
the fields.

## Owned by

- `services/oss/src/agent/schemas.py`: builds the input, parameter, and output schemas.
- `services/oss/src/agent/app.py`: `create_agent_app()` binds the live `_agent` handler AND the
  service interface to the builtin URI `agenta:builtin:agent:v0` (via `register_handler` /
  `register_interface`), so `retrieve_handler` / `retrieve_interface` return the live handler and
  the same schemas `/inspect` advertises. The handler and the interface share one identity.
- `sdks/python/agenta/sdk/models/workflows.py`: the inspect response model.
- `sdks/python/agenta/sdk/decorators/routing.py`: the generic inspect route.

## Watch for when changing

- **Catalog type markers.** `agent_config` and `messages` bind the schema to a playground
  control. Renaming a marker without updating the catalog breaks the form silently.
- **The config default.** `/inspect` ships the default agent config the form starts from.
  Keep it in sync with what the runtime actually accepts. The SDK builtin config registry entry
  (`CONFIGURATION_REGISTRY` for `agent:v0`) uses the same `build_agent_v0_default()` builder, so a
  URI-dispatched run with no parameters gets the same default.
- **Harness capability metadata.** The form filters connections from this block. If it drifts
  from the server-side table, the form offers choices the run will reject.
- **The builtin URI binding.** The live handler and interface are registered under
  `agenta:builtin:agent:v0` at app build time. The interface override is process-local (the agent
  service process), so the API process's catalog still builds from the SDK defaults.
