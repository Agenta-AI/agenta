# Workflow Inspect

`POST {route}/inspect` returns the workflow's interface description. The playground reads it
to build the config form and to know what the workflow accepts and returns. For the agent
service it returns the chat input schema, the output schema, and the editable agent config
schema. Change what this returns and you change what the playground renders.

## The contract

The response carries the three schemas plus harness metadata:

```jsonc
{
  "inputs":     { /* messages, marked x-ag-type-ref: "messages" */ },
  "parameters": { "properties": { "agent": { /* x-ag-type-ref: "agent_config" */ } } },
  "outputs":    { /* assistant message schema */ },
  "meta":       { "harness_capabilities": { /* per-harness provider/deployment limits */ } }
}
```

Two markers do the heavy lifting. `x-ag-type-ref: "messages"` tells the playground this is a
chat workflow. `x-ag-type-ref: "agent_config"` tells it to render the agent config control.
Each marker resolves through `/workflows/catalog/types/{type}` to the full JSON Schema, so
the form and the schema stay in one place. The `meta.harness_capabilities` block is the same
table the service uses server-side to reject unreachable provider and deployment choices, so
the form can filter stored connections before the user submits.

The shape of the config itself lives in [Agent config
schema](agent-config-schema.md). This page covers what `/inspect` returns; that page covers
the fields.

## Owned by

- `services/oss/src/agent/schemas.py`: builds the input, parameter, and output schemas.
- `sdks/python/agenta/sdk/models/workflows.py`: the inspect response model.
- `sdks/python/agenta/sdk/decorators/routing.py`: the generic inspect route.

## Watch for when changing

- **Catalog type markers.** `agent_config` and `messages` bind the schema to a playground
  control. Renaming a marker without updating the catalog breaks the form silently.
- **The config default.** `/inspect` ships the default agent config the form starts from.
  Keep it in sync with what the runtime actually accepts.
- **Harness capability metadata.** The form filters connections from this block. If it drifts
  from the server-side table, the form offers choices the run will reject.
