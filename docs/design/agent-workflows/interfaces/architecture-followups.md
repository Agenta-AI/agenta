# Agent Workflow Interface Architecture Follow-ups

This note captures four interface design issues in the agent workflow stack. It is written
for an implementation agent. Each issue names the current boundary, why it is risky, and
what a good fix should prove.

This is not a replacement for the interface inventory. The inventory describes the current
contracts. This page proposes changes to make those contracts clearer and less fragile.

## 1. `/inspect` has no canonical response contract

### Current shape

The `/inspect` route accepts `WorkflowInspectRequest`, resolves an interface, and returns
whatever `workflow.inspect()` builds.

Relevant owners:

- `sdks/python/agenta/sdk/decorators/routing.py`
  - `inspect_endpoint()` calls `inspect_workflow()` or `wf.inspect()`.
  - `handle_inspect_success()` serializes the returned object with
    `request.model_dump(...)`.
- `sdks/python/agenta/sdk/decorators/running.py`
  - `workflow.inspect()` builds a `WorkflowInvokeRequest`.
  - The resolved interface is nested under `data.revision.data`.
- `web/packages/agenta-entities/src/workflow/api/api.ts`
  - `InspectWorkflowResponse` expects resolved schemas under
    `revision.schemas` or `interface.schemas`.
  - `inspectWorkflow()` returns the raw response body.
- `web/packages/agenta-entities/src/workflow/state/store.ts`
  - Schema resolution reads `inspectData.revision?.schemas ??
    inspectData.interface?.schemas`.

The backend and frontend therefore model different response envelopes. The backend exposes
an inspect result through an invocation request shape. The frontend expects an inspect
response shape.

### Why this matters

`/inspect` is a public edge. It tells the browser which form to render and which inputs,
parameters, and outputs exist. If the response envelope drifts, the UI can lose schemas
without a clear server error. The current design also makes the request model carry response
semantics, which hides the actual contract from both clients and tests.

### Proposed solution

Add an explicit `WorkflowInspectResponse` model and make `/inspect` return it.

Recommended public shape:

```json
{
  "version": "2025.07.14",
  "revision": {
    "uri": "agenta:builtin:agent:v0",
    "url": null,
    "headers": null,
    "schemas": {
      "inputs": {},
      "parameters": {},
      "outputs": {}
    },
    "parameters": {}
  },
  "configuration": null,
  "meta": {}
}
```

Use `WorkflowRevisionData` for `revision`, because that is already the model that owns
`uri`, `url`, `headers`, `schemas`, and `parameters`.

Implementation outline:

1. Add `WorkflowInspectResponse` in `sdks/python/agenta/sdk/models/workflows.py`.
2. Change `workflow.inspect()` or `handle_inspect_success()` so the public response is
   normalized to that model.
3. Keep a temporary compatibility path only if existing clients consume the old nested
   `data.revision.data` shape. Do not make the old shape the primary contract.
4. Update the frontend `InspectWorkflowResponse` type to match the backend model.
5. Keep frontend fallback reads only as a migration bridge, with a comment and removal
   condition.

### Acceptance criteria

- A backend test posts to `/inspect` and asserts schemas are available at
  `response["revision"]["schemas"]`.
- A frontend unit test or state test proves schema resolution works from the new response
  shape.
- No caller needs to know that `workflow.inspect()` used to build a `WorkflowInvokeRequest`.
- The interface inventory page for `/inspect` documents the new response model, not the
  old invocation request envelope.

## 2. Agent builtin URI and live handler identity are split

### Current shape

The SDK defines an agent builtin interface:

- `sdks/python/agenta/sdk/engines/running/interfaces.py`
  - `agent_v0_interface` uses `uri="agenta:builtin:agent:v0"`.

The live service registers the agent handler directly:

- `services/oss/src/agent/app.py`
  - `create_agent_app()` calls `ag.workflow(...)(_agent)` without binding the builtin URI.
  - The comment says the handler still gets an auto `user:custom:...` URI and that binding
    it to the builtin URI is the remaining step.

The SDK workflow constructor treats non-custom URIs as registered managed interfaces:

- `sdks/python/agenta/sdk/decorators/running.py`
  - `workflow.__init__()` calls `_retrieve_handler(self.uri)` for non-custom URIs.
  - It then merges any registered interface from `retrieve_interface(self.uri)`.

This leaves two identities for the same conceptual agent workflow: the builtin URI in the
SDK and the auto URI of the live service handler.

### Why this matters

Identity is an interface. Catalog lookup, `/inspect`, stored workflow revisions, and invoke
routing all need to agree on the same workflow identity. If the stored revision uses the
builtin URI but the live handler is registered under an auto URI, one path can find the
interface while another path cannot find the handler.

The risk is not only a 404. A worse outcome is partial success: `/inspect` resolves a
schema from the SDK builtin, but invocation uses a different handler identity and therefore
different defaults or behavior.

### Proposed solution

Pick one canonical public identity for the agent workflow.

Preferred path:

1. Make `agenta:builtin:agent:v0` the canonical identity.
2. Register the live `_agent` handler under that URI in `create_agent_app()`.
3. Ensure `retrieve_handler("agenta:builtin:agent:v0")` returns the live handler in the
   agent service process.
4. Ensure `retrieve_interface("agenta:builtin:agent:v0")` returns the same interface data
   that `/inspect` advertises.

Fallback path:

1. If the service cannot safely bind a builtin URI yet, remove or disable
   `agent_v0_interface` as a live-looking builtin.
2. Treat the service-local auto URI as the only public identity until binding is ready.
3. Do not let catalog or frontend code advertise `agenta:builtin:agent:v0` as invokable.

The preferred path is cleaner because builtin workflows already use stable managed URIs.
The fallback path is acceptable only if it is explicit and tested.

### Acceptance criteria

- `POST /inspect` with `revision.uri = "agenta:builtin:agent:v0"` returns the live agent
  interface.
- Invoking a revision with `uri = "agenta:builtin:agent:v0"` reaches the live `_agent`
  handler.
- Tests that currently expect no handler or no interface for `agenta:builtin:agent:v0` are
  updated or removed.
- The catalog, stored revision data, inspect path, and invoke path all name the same agent
  URI.

## 3. Agent config defaults have two owners

### Current shape

The service advertises and uses a default agent config:

- `services/oss/src/agent/schemas.py`
  - `_DEFAULT_AGENT_CONFIG` includes `agents_md`, model, tools, MCP servers, harness,
    sandbox, permission policy, `sandbox_permission`, and the default platform skill.
- `services/oss/src/agent/app.py`
  - `_agent()` calls `AgentConfig.from_params(params, defaults=_default_agent_config())`.

The SDK builtin interface carries its own default:

- `sdks/python/agenta/sdk/engines/running/interfaces.py`
  - `agent_v0_interface` includes a default under the `agent_config` schema.
  - That default omits fields that the service default includes today, including
    `sandbox_permission` and the default skill.

The two defaults are meant to describe the same agent configuration contract, but they do
not match.

### Why this matters

Defaults are part of the interface. They decide what the browser pre-fills, what the first
agent run does, which permissions are requested, and which built-in skills exist before the
user edits anything.

If `/inspect` starts using the SDK builtin interface while invocation uses the service
default, the browser can show one initial config while the service executes another. If the
service later binds the builtin URI, this mismatch can become a user-visible behavior
change without any API field changing.

### Proposed solution

Create one owner for the agent v0 interface and defaults.

Preferred path:

1. Move the shared agent v0 schema/default builder into the SDK, near the agent config
   types.
2. Export a function such as `agent_v0_revision_data()` or
   `build_agent_v0_interface(defaults=...)`.
3. Make `agent_v0_interface` and the service `AGENT_SCHEMAS` use that same builder.
4. Keep service-only choices, such as a platform default skill, as named defaults passed
   into the builder rather than copied into a second schema.

Alternative path:

1. Make the service schema the only owner.
2. Remove the SDK builtin agent interface until it can import or generate the exact same
   data.

Do not keep two hand-maintained defaults.

### Acceptance criteria

- One test compares the default exposed by `/inspect` with the default passed into
  `AgentConfig.from_params(...)`.
- One test compares the SDK builtin agent interface with the service-advertised schema if
  both remain.
- Adding a new default field requires changing one builder, not two dictionaries.
- The default skill and `sandbox_permission` are either present in both inspect and runtime
  defaults, or intentionally absent from both with a documented reason.

## 4. Streaming mode leaks into generic workflow request data

### Current shape

`WorkflowRequestData` contains a `stream` field:

- `sdks/python/agenta/sdk/models/workflows.py`
  - `stream` is documented as transport mode for the agent `/messages` route.
  - The comment says `/messages` sets it from `Accept` negotiation and `/invoke` leaves it
    unset.

The `/messages` browser adapter sets that field:

- `sdks/python/agenta/sdk/agents/adapters/vercel/routing.py`
  - The route parses `Accept`.
  - It sets `request.data.stream = want_stream`.

The agent handler receives `stream` as a handler argument:

- `services/oss/src/agent/app.py`
  - `_agent(..., stream: Optional[bool] = None, ...)` switches between streaming and batch
    behavior.

The field is therefore not really workflow input data. It is route-local transport state.

### Why this matters

`WorkflowRequestData` is a generic public model shared by `/invoke`, workflow execution,
and agent messages. Putting transport state there makes `stream` look like a caller-owned
request field. A caller can send it to generic `/invoke`, even though the design says
streaming is negotiated by the `/messages` route.

This also makes the handler signature mix domain inputs (`messages`, `parameters`) with
adapter control state (`stream`). That makes future route behavior harder to reason about.

### Proposed solution

Move streaming mode out of public request data and into invocation context.

Preferred path:

1. Add an internal invocation context model, for example `WorkflowInvocationContext`, with
   `stream: bool = False`.
2. Let the `/messages` adapter set `context.stream` from `Accept` negotiation.
3. Pass the context through `wf.invoke(...)`, `RunningContext`, or an equivalent internal
   path.
4. Let the agent handler read streaming mode from internal context, not from
   `WorkflowRequestData`.
5. Remove `WorkflowRequestData.stream` from the public model once callers have no supported
   use for it.

Lower-risk transition path:

1. Keep `WorkflowRequestData.stream` temporarily.
2. Ignore or reject caller-supplied `data.stream` on generic `/invoke`.
3. Only the `/messages` adapter may set the internal stream flag.
4. Mark the public field deprecated and add tests that prove it is not honored outside the
   adapter path.

### Acceptance criteria

- `/messages` still streams when `Accept` asks for a streaming media type.
- `/messages` still returns batch JSON when `Accept` asks for JSON.
- Generic `/invoke` does not treat caller-supplied `data.stream` as a supported public
  switch.
- The public request schema no longer advertises transport mode as ordinary workflow data,
  or it marks the field deprecated with a clear removal path.
- Tests cover both `/messages` negotiation and `/invoke` rejection or ignoring of
  `data.stream`.

