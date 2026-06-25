# Tool Models And Resolution

A tool starts as editable config and ends as a resolved spec that the runner can run. This
page covers that in-service contract: the config types the author writes, the three
resolved spec types they become, and the permission derivation that runs in between. The
resolved specs become `/run` fields, so a change here usually reaches the wire (see
[Runner to tool callback](../cross-service/runner-to-tool-callback.md) and
[Runner to MCP server](../cross-service/runner-to-mcp-server.md)).

## Config types (what the author writes)

All share a base of `needs_approval` (default `false`), `permission` (`allow`/`ask`/`deny`,
optional), and `render` (optional), discriminated by `type`:

```jsonc
{ "type": "builtin", "name": "read" }

{ "type": "gateway", "provider": "composio", "integration": "github",
  "action": "create_issue", "connection": "my-gh", "name": null }

{ "type": "code", "name": "fx", "runtime": "python",   // "python" | "node"
  "script": "...", "input_schema": {}, "secrets": ["API_KEY"] }

{ "type": "client", "name": "pick_file", "description": "...", "input_schema": {} }

// reference: a workflow pointed at via @ag.reference; coerce_tool_config parses the kept
// marker into this. Runs the workflow revision server-side when the model calls it.
{ "type": "reference", "slug": "summarize", "version": null,
  "name": "summarize", "description": "...", "input_schema": {} }
```

A tool can also be a **workflow** the author points at via `@ag.reference` (keep the reference)
or `@ag.embed` (inline a client tool value). The author commits the marker dict; `@ag.reference`
coerces into the `reference` config above, while `@ag.embed` is inlined to a concrete `client`
config by the generic resolver before tool resolution runs. The author's syntax decides the
behavior; `resolve_tools` owns the tool-specific mapping.

## Resolved spec types (what the runner gets)

```jsonc
// callback: a gateway tool OR a @ag.reference workflow tool; runs in Agenta via /tools/call.
// call_ref is the Composio 5-segment slug (tools.*) or the workflow identity (workflow.{slug}).
{ "kind": "callback", "name": "...", "description": "...", "input_schema": {},
  "call_ref": "tools.composio.github.create_issue.my-gh" }
// e.g. a referenced workflow tool: "call_ref": "workflow.summarize" (or "workflow.summarize.3")

// code: sandboxed code with its named secrets injected into env
{ "kind": "code", "name": "...", "runtime": "python", "code": "...", "env": { "API_KEY": "..." } }

// client: browser-fulfilled; filtered out of the runner's MCP tools/list
{ "kind": "client", "name": "..." }
```

Each resolved spec also carries `needs_approval`, `read_only`, `permission`, and `render`.

## Permission derivation

When a tool's `permission` is unset, it is derived by precedence:

1. an explicit `permission` wins,
2. else `needs_approval: true` to `"ask"`,
3. else `read_only`: `true` to `"allow"`, `false` to `"ask"`,
4. else `None`, and the runner falls back to the global policy.

## Secret injection

Code tools name their secrets (`secrets: ["API_KEY"]`). The resolver fetches the named
secrets once and merges them into the resolved spec's `env`. Gateway tools never carry a
secret; their provider key stays server-side and the call routes back through `/tools/call`.

## Owned by

- `sdks/python/agenta/sdk/agents/tools/models.py`: the config and spec models (incl.
  `ReferenceToolConfig`) and the permission derivation.
- `sdks/python/agenta/sdk/agents/tools/compat.py`: coerces a kept `@ag.reference` marker into a
  `ReferenceToolConfig`.
- `sdks/python/agenta/sdk/agents/platform/gateway.py`: gateway resolution to a `call_ref`.
- `sdks/python/agenta/sdk/agents/platform/workflow.py`: `@ag.reference` workflow resolution to a
  `workflow.{slug}` callback spec.
- `api/oss/src/apis/fastapi/tools/router.py`: `/tools/call` routes a `workflow.*` call_ref to
  `WorkflowsService.invoke_workflow` (the server-side execute path).
- `services/oss/src/agent/tools/resolver.py`: the service entrypoint (re-exports the SDK).

## Watch for when changing

- **Permission defaults and the derivation order.** It decides what gets gated.
- **Read-only and render hints.** They flow through to the runner and the browser.
- **The tool input schema.** It is what the harness sees as the tool's parameters.
- **Secret injection for code tools.** Secrets ride `env` and are resolved once at parse time.
- **Gateway call references.** The `call_ref` format is a paired contract with the tool
  endpoint.
- **Workflow call references.** A `@ag.reference` tool's `call_ref` is `workflow.{slug}` /
  `workflow.{slug}.{version}`. The server-side `/tools/call` routes by the `tools.*` vs
  `workflow.*` prefix; keep the SDK (`platform/workflow.py`) and the API parser in agreement.
