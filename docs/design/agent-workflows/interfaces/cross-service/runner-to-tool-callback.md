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
- **`tools.agenta.{op}`** — a reserved Agenta platform tool (out of the Composio 5-segment
  namespace). v1 op: `tools.agenta.find_capabilities`, routed by `_call_agenta_tool` to
  `ToolsService.discover_capabilities` (same logic as the `POST /tools/discover` endpoint). The
  `CapabilitiesResult` is serialized into `call.data.content`. **Status:** the server-side route
  is wired; the SDK-side declaration/resolution that puts this `call_ref` on a `CallbackToolSpec`
  is pending (it rides the direct-call-tools platform-op seam), so no agent can declare the tool
  yet. The runner needs no change — it forwards the `call_ref` opaquely, as for the other two.

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

**Status (direct-call tools):** Phase 1 added the `call` field (plumbing), Phase 2 added the
runner dispatch branch (host-direct via the relay path, with the SSRF guardrails), and Phase 3a
added the `runContext` wire field + the `call.context` binding in `assembleBody`. Live behavior is
still unchanged because **no resolver emits `call` or `call.context` yet** — gateway and reference
tools still route through `/tools/call`. The platform-op catalog that emits them is Phase 3b. Full
spec: `docs/design/agent-workflows/projects/direct-call-tools/`.

## Owned by

- `services/agent/src/tools/callback.ts`: the runner caller (sends the envelope, reads `content`).
- `services/agent/src/tools/dispatch.ts`: runner-side dispatch.
- `api/oss/src/apis/fastapi/tools/router.py`: the endpoint that parses, executes, and serializes.
- `services/oss/src/agent/tools/resolver.py`: re-exports the SDK resolver; no service-layer logic.

## Watch for when changing

- **The tool slug format.** The `tools.{provider}.{integration}.{action}.{connection}`
  reference, the `workflow.{axis}.*` reference (`workflow.variant.{slug}[.{version}]` /
  `workflow.environment.{environment}.{slug}`), the reserved `tools.agenta.{op}` reference, and
  the `__`/`.` normalization are a paired contract across runner and router. The router
  dispatches by prefix: `workflow.` → `_call_workflow_tool`, `tools.agenta.` → `_call_agenta_tool`,
  else the 5-segment Composio parse. Keep the SDK resolvers and the router parser in agreement.
- **The `call` descriptor (direct path) and `runContext` binding.** A callback spec carries
  `call` XOR `call_ref`; the descriptor (`method`/`path`/`body`/`context`/`args_into`) must stay
  mirrored across `protocol.ts`, the SDK `CallbackToolSpec`, `wire_models.py`, and the golden
  fixtures. The `call.context` binding reads the per-turn `runContext` blob (also mirrored across
  `protocol.ts` / `wire_models.py` / `wire.py` / the goldens); its inner keys are the snake_case
  `$ctx.<key>` namespace, not camelCase. The runner now dispatches `call` and fills `call.context`
  (`tools/direct.ts` `assembleBody`), but no resolver EMITS `call`/`context` yet (the platform-op
  catalog is Phase 3b), so live behavior is unchanged.
- **Tool result content.** `call.data.content` is a JSON string already; do not double-encode
  it on the way out.
- **Argument normalization.** Keep accepting both string and object arguments.
- **Timeout and error mapping.** The runner pairs a tool-call timeout with the caller signal.
  A timeout has to surface as a tool error, not a hung turn.
- **Gateway provider execution.** Provider keys must stay server-side. Nothing here may push
  a key onto the wire to the sandbox.
