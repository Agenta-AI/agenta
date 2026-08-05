# Runner To Tool Callback

Gateway and callback tools run their real work inside Agenta, not inside the sandbox. When
the harness calls such a tool, the runner posts the call back to Agenta's tool endpoint,
Agenta executes it with the provider key it holds, and the result comes back. This is how
provider keys and connection auth stay server-side: the sandbox never sees them.

## The contract

The runner posts an OpenAI-style function-call envelope to `POST /tools/call`:

```jsonc
{
  "data": {
    "id":       "call_zEoV...",            // the LLM tool_call_id, echoed back for correlation
    "type":     "function",
    "function": {
      "name":      "tools.composio.github.create_issue.my_conn",  // resolved tool slug
      "arguments": { "title": "..." }      // sent as an object, not a JSON string
    }
  }
}
```

The endpoint returns a `ToolCallResponse`. The execution result is already serialized as a
JSON string in `call.data.content`, so the runner hands it to the model verbatim:

```jsonc
{
  "call": {
    "id": "uuid",
    "status": { "code": "STATUS_CODE_OK", "message": "..." },
    "data":   { "role": "tool", "tool_call_id": "call_zEoV...", "content": "{\"...\":\"...\"}" }
  }
}
```

Two details bite. The LLM cannot put dots in a function name, so the slug travels with `__`
separators and the router normalizes them back to dots. And `arguments` may arrive as a JSON
string (from the model) or an object; the router normalizes to a dict before executing.

## Three call_ref grammars on one endpoint

The same `POST /tools/call` serves three kinds of callback tool, routed by the `call_ref` prefix:

- **`tools.{provider}.{integration}.{action}.{connection}`** — a Composio gateway action; the
  router re-resolves the connection and runs it through the provider adapter.
- **`workflow.variant.{slug}[.{version}]`** / **`workflow.environment.{environment}.{slug}`** — a
  `type: "reference"` workflow tool; the router (`_call_workflow_tool`) parses the targeting axis
  and builds a `WorkflowServiceRequest` — the variant axis sets
  `references={"workflow": Reference(slug, version)}`; the environment axis sets
  `references={"environment": Reference(slug=environment), "workflow": Reference(slug)}` (the
  environment selects the deployed revision via the derived `{slug}.revision` key) — with
  `data.inputs = arguments`, and calls
  `WorkflowsService.invoke_workflow(project_id, user_id, request)`. The workflow's
  `response.data.outputs` is serialized into `call.data.content`. Auth is minted server-side from
  the caller's project + user, so the workflow's own connections/secrets stay server-side — the
  same safety property as a gateway tool.
- **`tools.agenta.{op}`**: a reserved Agenta server-side handler (out of the Composio 5-segment
  namespace). The router (`_call_reserved_agenta_tool`) dispatches a registered ref through the
  handler registry in `api/oss/src/core/tools/platform_handlers.py`; an unregistered
  `tools.agenta.*` ref fails loud with a 404. The first registered handler is
  `tools.agenta.test_run` (run the agent's own variant once, digest + verdict; an argument
  `delta` requires `EDIT_WORKFLOWS`). **Status:** the legacy v1 dispatch
  (`tools.agenta.find_capabilities` via `_call_agenta_tool`) is deleted; discovery is the
  `discover_tools` [platform tool](../in-service/tool-models-and-resolution.md), whose SDK
  resolution emits a direct `call` to `POST /api/tools/discover` (the `call` descriptor below),
  bypassing `/tools/call`. Handler-mode resolution is default-on in the SDK, with
  `AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS` as a kill switch (`0`, `false`, `f`, `n`, `no`,
  `off`, `disable`, or `disabled`). The runner dispatches reserved `callRef` specs through
  `/tools/call`, applies spec-level `contextBindings` after the permission verdict, and
  forwards `timeoutMs` end to end. Positive per-spec timeouts add a 10s grace window to the
  host callback fetch and the child relay poll.

The runner is unchanged for all three: it relays a `callback` spec with whatever `call_ref` the
resolver put on it. Only the router's prefix dispatch is aware of the grammars.

## Direct-call descriptor (`call`) and run-context binding (`runContext`)

A resolved callback spec can carry an optional `call` descriptor instead of a `call_ref`
(`ResolvedToolSpec.call` in `protocol.ts`; `CallbackToolSpec.call` in the SDK `tools/models.py`;
mirrored in `wire_models.py` and pinned by the golden `/run` fixtures). When present it tells the
runner to call an Agenta endpoint **directly** — reusing the run's `toolCallback.authorization`,
with `path` an absolute path from the Agenta origin (derived from `toolCallback.endpoint`) — rather
than posting back through `/tools/call`. Shape: `{ method: "GET"|"POST", path, body?, context?,
args_into? }`. A spec carries `call` XOR `call_ref`.

The runner assembles the request body (`tools/direct.ts` `assembleBody`) in three layers, later
wins: the model's args (at `args_into`, else the root) → the static `body` → the `context`
binding. `context` maps a body path to a `"$ctx.<dotted.path>"` token, which the runner resolves
against the per-turn `runContext` blob on the `/run` request (`service-to-agent-runner.md`) and
deep-sets LAST — so a self-targeting tool's own trace/variant is filled server-side and the model
can never set or override a bound field. A token that does not resolve is skipped (the field stays
unset); deep-set is prototype-pollution-safe.

**Status (direct-call tools):** wired end to end for endpoint-mode platform ops. The SDK
platform-op resolver emits `call` (and `call.context` for self-targeting ops such as
`commit_revision`); the runner dispatches it host-direct with the SSRF guardrails. Gateway and
reference tools still route through `/tools/call`. Handler-mode platform ops add a second wire
shape: a reserved `tools.agenta.{op}` `call_ref` plus spec-level `contextBindings` and
`timeoutMs`. The runner carries those fields, dispatches `callRef` specs through the host relay,
applies `contextBindings` only after the permission verdict, forwards `runContext.run.kind` as
`x-agenta-run-kind`, and honors `timeoutMs` on both the host callback fetch and the child relay
poll. The SDK emits handler-mode ops by default; set `AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS` to a
disabled value to turn them off. Full spec:
`docs/design/agent-workflows/projects/direct-call-tools/` and
`docs/design/agent-workflows/projects/build-kit-tools-cleanup/api-design.md`.

## Owned by

- `services/agent/src/tools/callback.ts`: the runner caller (sends the envelope, reads `content`).
- `services/agent/src/tools/dispatch.ts`: runner-side dispatch.
- `api/oss/src/apis/fastapi/tools/router.py`: the endpoint that parses, executes, and serializes.
- `api/oss/src/core/tools/platform_handlers.py`: the reserved-ref handler registry (`test_run`).
- `services/oss/src/agent/tools/resolver.py`: re-exports the SDK resolver; no service-layer logic.

## Watch for when changing

- **The tool slug format.** The `tools.{provider}.{integration}.{action}.{connection}`
  reference, the `workflow.{axis}.*` reference (`workflow.variant.{slug}[.{version}]` /
  `workflow.environment.{environment}.{slug}`), the reserved `tools.agenta.{op}` reference, and
  the `__`/`.` normalization are a paired contract across runner and router. The router
  dispatches by prefix: a registered reserved ref → `_call_reserved_agenta_tool` (the handler
  registry), `workflow.` → `_call_workflow_tool`, else the 5-segment Composio parse. Keep the
  SDK resolvers and the router parser in agreement.
- **The `call` descriptor (direct path) and `runContext` binding.** A callback spec carries
  `call` XOR `call_ref`; the descriptor (`method`/`path`/`body`/`context`/`args_into`) must stay
  mirrored across `protocol.ts`, the SDK `CallbackToolSpec`, `wire_models.py`, and the golden
  fixtures. The `call.context` binding reads the per-turn `runContext` blob (also mirrored across
  `protocol.ts` / `wire_models.py` / `wire.py` / the goldens); its inner keys are the snake_case
  `$ctx.<key>` namespace, not camelCase. The runner dispatches `call` and fills `call.context`
  (`tools/direct.ts` `assembleBody`); the platform-op catalog emits them for endpoint-mode ops.
- **Handler-mode spec fields.** A handler-mode op emits a reserved `call_ref` plus spec-level
  `contextBindings` and `timeoutMs`. Keep those fields mirrored across `protocol.ts`, the SDK
  `CallbackToolSpec`, `wire_models.py`, and the golden fixtures. The relay applies
  `contextBindings` after the permission verdict and redacts bound paths from the Pi pending
  approval display. `timeoutMs` is honored by the host `/tools/call` fetch and the child file-relay
  poll; positive per-spec timeouts get the same 10s grace in both places. The SDK flag is default
  on with `AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS` as a kill switch.
- **Tool result content.** `call.data.content` is a JSON string already; do not double-encode
  it on the way out.
- **Argument normalization.** Keep accepting both string and object arguments.
- **Timeout and error mapping.** The runner pairs a tool-call timeout with the caller signal.
  A timeout has to surface as a tool error, not a hung turn.
- **Gateway provider execution.** Provider keys must stay server-side. Nothing here may push
  a key onto the wire to the sandbox.
