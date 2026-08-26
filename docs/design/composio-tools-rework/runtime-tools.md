# Runtime tools for gateway connections

This page defines the model-facing runtime tools derived from the saved
`gateway_connection` entries in [data-model.md](data-model.md). Permission compilation
and enforcement are defined in [permission-layers.md](permission-layers.md).

This first version uses Composio's semantic tool search. A local search implementation is
a follow-up that requires production evidence.

## Decision

When an agent has at least one `gateway_connection`, the platform gives the model two
tools for the whole agent:

- `search_tools`: find tools across configured integrations;
- `run_tool`: run one selected integration tool.

These are derived runtime tools. They are not saved configuration entries, do not appear
in the agent's tool editor, and cannot be renamed independently.

The model identifies an integration tool with two values:

```text
integration + tool key
```

For example:

```text
slack + SEND_MESSAGE
```

The tool key is the stable Agenta key used by the saved permission map. Provider action
IDs remain internal.

## V1 constraints

- One agent revision contains at most one `gateway_connection` per provider and
  integration.
- The model does not select or receive a connection slug.
- Search queries must be non-empty.
- Search uses Composio's `COMPOSIO_SEARCH_TOOLS` operation.
- Search results are filtered to configured, non-denied tools before reaching the model.
- Each returned result includes its input schema.
- The model is expected to search once, select a result, and run it.

The project may contain several connections for one integration. The agent revision
selects one of them for V1. Supporting several selected accounts for one integration
requires a model-facing account-selection contract and is deferred.

## Private runtime context

At run start, the SDK sends the runner the private resolved gateway policy described in
[permission-layers.md](permission-layers.md). It contains:

- configured providers and integrations;
- the selected connection slug for each integration;
- the catalog tool keys;
- the compiled `allow`, `ask`, or `deny` value for each tool.

This context is not part of either model-facing input schema. It does not enter the
sandbox as editable data.

## `search_tools`

### Input

```json
{
  "query": "send a message",
  "integration": "slack"
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `query` | Yes | A non-empty description of the task the model wants to perform. |
| `integration` | No | Restricts the request to one integration configured on the agent. |

An unknown or unconfigured `integration` is rejected before the provider search. An empty
query is invalid in V1. Listing every tool in an integration is deferred.

### Provider search

The Tools API calls Composio's `COMPOSIO_SEARCH_TOOLS` operation through the existing
provider adapter. The existing response contains:

- primary and related provider tool slugs;
- descriptions;
- inline input schemas;
- provider toolkit identities.

The existing API cache for provider search results remains in use. Cold search latency was
measured at about 2.3 seconds on 2026-08-26. The V1 prompt tells the model to search once
and reuse the returned schema.

The current Composio adapter does not pass a toolkit filter. When the model supplies an
integration, the API includes that integration in the provider use-case text. Regardless
of provider behavior, returned results are filtered after translation.

Before relying on query enrichment, implementation must check whether the current
Composio operation supports a native toolkit filter. Use the native filter if available.

### Translation and filtering

The Tools API translates provider results into Agenta integration and tool keys. It does
not decide agent permissions.

The trusted runner then filters the translated results against its private resolved policy:

1. Remove results from providers or integrations not configured on the agent.
2. Remove tools missing from the resolved catalog policy.
3. Remove tools whose compiled permission is `deny`.
4. Remove results without a usable object input schema.
5. Return at most five results.

Filtering improves model behavior. It is not the execution boundary. `run_tool`
independently checks every requested tool.

The current callback path returns API text directly to the model. V1 therefore adds a
trusted result-processing step for `search_tools` in the runner before the result is
written back to the harness.

### Output

One result has this shape:

```json
{
  "integration": "slack",
  "tool": "SEND_MESSAGE",
  "name": "Send message",
  "description": "Post a message to a Slack channel.",
  "input_schema": {
    "type": "object",
    "properties": {
      "channel": {"type": "string"},
      "text": {"type": "string"}
    },
    "required": ["channel", "text"]
  }
}
```

The result does not contain:

- the connection slug;
- the provider account ID;
- the provider action ID;
- permission values;
- `read_only` classification.

The model does not need those fields to call the tool. The runner already owns the
compiled permission.

### No matching result

If provider search succeeds but no configured, non-denied result remains, return a normal
empty result with a short message:

```json
{
  "results": [],
  "message": "No configured tool matched this request. Try a more specific task description."
}
```

The message must not suggest unconfigured integrations returned by Composio.

### Search failure

Provider or transport failure returns an agent-actionable error:

```json
{
  "code": "tool_search_unavailable",
  "message": "Tool search is temporarily unavailable.",
  "retryable": true,
  "next_step": "Retry the search once."
}
```

The prompt permits one retry for a temporary failure. It tells the model not to repeat
equivalent searches indefinitely and never to invent a tool key.

## `run_tool`

### Input

```json
{
  "integration": "slack",
  "tool": "SEND_MESSAGE",
  "arguments": {
    "channel": "#general",
    "text": "hello"
  }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `integration` | Yes | One integration configured on the agent. |
| `tool` | Yes | The stable Agenta tool key returned by `search_tools`. |
| `arguments` | Yes | One JSON object matching the returned input schema. |

The model cannot supply a connection slug or provider action ID.

### Runner gate

The runner applies the private resolved policy before making the execution callback:

1. Find the configured integration and tool key.
2. Treat a missing integration or tool as `deny`.
3. Apply the operator deny override.
4. Apply the compiled tool permission.
5. Reject `deny`, continue on `allow`, or start a user approval interaction on `ask`.

Approval identity includes the integration, tool key, and canonical arguments. The
approval card shows the integration tool and the arguments, not only the coarse
`run_tool` name.

The runner forwards exactly the arguments that were checked or approved. It does not
silently rewrite malformed input.

### API execution

After the runner allows the call, it sends the selected provider, integration, connection,
and tool key as private callback context. Only the integration tool's arguments remain in
the callback function arguments. The API:

1. Checks project-level `RUN_TOOLS` access.
2. Resolves the project connection and checks that it is active and valid.
3. Confirms that the tool key belongs to the selected integration.
4. Reads the canonical provider action ID from the catalog.
5. Validates that `arguments` is an object. Invalid input returns an actionable error; it
   is never replaced with `{}`.
6. Executes through the provider adapter with the selected connection.

The API validates resource identity and routing. It does not recompute the agent's
permission policy.

### Execution errors

An unknown or stale tool key returns an error with up to five close keys from the same
configured integration. A malformed argument payload returns the expected object shape.
Provider failures keep their provider detail so the model can correct a valid but rejected
request.

## Call references

The two resolved callback specifications use stable routing identities:

```text
gateway.search
gateway.run
```

No integration, connection, provider action ID, or permission policy is encoded in these
strings. The runner uses the private resolved policy for permission and connection
selection. The API receives the selected connection through private callback context.

## Prompt guidance

The SDK assembles a runtime instruction section when the agent has at least one
`gateway_connection`. It is not stored in the agent revision.

The V1 section contains:

1. The configured integration names.
2. An instruction to search once with a concrete task description.
3. An instruction to use only a returned integration and tool key.
4. An instruction to copy arguments from the returned schema.
5. An instruction to retry search at most once after a temporary failure.
6. An instruction to stop searching after receiving a usable result.

Capability grouping such as "Messaging" or "Code" is deferred. V1 lists the configured
integration names without inventing a second classification system.

## Measurements

Instrument V1 before replacing provider search. Record:

- cold and cached search latency;
- provider search failures;
- searches per model task;
- searches that return no permitted result after filtering;
- results from unconfigured integrations before filtering;
- selected result rank;
- execution attempts without a prior successful search;
- unknown or stale tool-key failures;
- outcomes by model family and size.

These measurements decide whether a local search implementation is needed.

## Follow-ups

- Local lexical search over the cached catalog.
- A local fallback when Composio search is unavailable.
- Empty-query listing for one configured integration.
- Native provider-independent ranking.
- Several selected connections for one integration.
- Model-facing connection selection when several accounts are selected.
- Capability grouping in prompt guidance.
- More advanced fuzzy correction for unknown tool keys.
