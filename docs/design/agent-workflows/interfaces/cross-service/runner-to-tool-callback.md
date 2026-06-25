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

## Two call_ref grammars on one endpoint

The same `POST /tools/call` serves two kinds of callback tool, routed by the `call_ref` prefix:

- **`tools.{provider}.{integration}.{action}.{connection}`** — a Composio gateway action; the
  router re-resolves the connection and runs it through the provider adapter.
- **`workflow.{slug}`** / **`workflow.{slug}.{version}`** — a `@ag.reference` workflow tool; the
  router (`_call_workflow_tool`) builds a `WorkflowServiceRequest`
  (`references={"workflow": Reference(slug, version)}`, `data.inputs = arguments`) and calls
  `WorkflowsService.invoke_workflow(project_id, user_id, request)`. The workflow's
  `response.data.outputs` is serialized into `call.data.content`. Auth is minted server-side from
  the caller's project + user, so the workflow's own connections/secrets stay server-side — the
  same safety property as a gateway tool.

The runner is unchanged for both: it relays a `callback` spec with whatever `call_ref` the
resolver put on it. Only the router's prefix dispatch is aware of the two grammars.

## Owned by

- `services/agent/src/tools/callback.ts`: the runner caller (sends the envelope, reads `content`).
- `services/agent/src/tools/dispatch.ts`: runner-side dispatch.
- `api/oss/src/apis/fastapi/tools/router.py`: the endpoint that parses, executes, and serializes.
- `services/oss/src/agent/tools/resolver.py`: re-exports the SDK resolver; no service-layer logic.

## Watch for when changing

- **The tool slug format.** The `tools.{provider}.{integration}.{action}.{connection}`
  reference, the `workflow.{slug}[.{version}]` reference, and the `__`/`.` normalization are a
  paired contract across runner and router. The router dispatches by the `tools.*` vs
  `workflow.*` prefix; keep the SDK resolvers and the router parser in agreement.
- **Tool result content.** `call.data.content` is a JSON string already; do not double-encode
  it on the way out.
- **Argument normalization.** Keep accepting both string and object arguments.
- **Timeout and error mapping.** The runner pairs a tool-call timeout with the caller signal.
  A timeout has to surface as a tool error, not a hung turn.
- **Gateway provider execution.** Provider keys must stay server-side. Nothing here may push
  a key onto the wire to the sandbox.
