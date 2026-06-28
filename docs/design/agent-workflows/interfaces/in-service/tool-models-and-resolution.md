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

// reference: a workflow referenced as a tool (plain config, no marker). Runs the selected
// workflow revision server-side when the model calls it. ref_by "variant" (latest or a pinned
// `version`) or "environment" (whatever is deployed in `environment` for `slug`).
{ "type": "reference", "ref_by": "variant", "slug": "summarize", "version": null,
  "environment": null, "name": "summarize", "description": "...", "input_schema": {} }
```

A tool can also be a **workflow** referenced as a tool (`type: "reference"`, above). A separate
feature, `@ag.embed`, inlines a workflow value into a concrete `client` config — the generic
resolver does that inlining before tool resolution runs. The reference tool is plain config (not a
marker); `resolve_tools` owns the tool-specific mapping.

## Resolved spec types (what the runner gets)

```jsonc
// callback: a gateway tool OR a type:"reference" workflow tool; runs in Agenta via /tools/call.
// call_ref is the Composio 5-segment slug (tools.*) or the workflow identity (workflow.{axis}.*).
{ "kind": "callback", "name": "...", "description": "...", "input_schema": {},
  "call_ref": "tools.composio.github.create_issue.my-gh" }
// e.g. a referenced workflow tool: "call_ref": "workflow.variant.summarize"
// (or "workflow.variant.summarize.3", or "workflow.environment.production.summarize")

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
  `ReferenceToolConfig`, its `ref_by` axes, and `call_ref`) and the permission derivation.
- `sdks/python/agenta/sdk/agents/tools/compat.py`: coerces legacy/typed tool dicts (a
  `type: "reference"` dict parses straight into `ReferenceToolConfig`).
- `sdks/python/agenta/sdk/agents/platform/gateway.py`: gateway resolution to a `call_ref`.
- `sdks/python/agenta/sdk/agents/platform/workflow.py`: `type: "reference"` workflow resolution to
  a `workflow.{axis}.*` callback spec.
- `api/oss/src/apis/fastapi/tools/router.py`: `/tools/call` routes a `workflow.*` call_ref to
  `WorkflowsService.invoke_workflow`, and a `tools.agenta.*` call_ref (the reserved
  `find_capabilities` discovery tool) to `ToolsService.discover_capabilities` (server-side execute
  paths).
- `services/oss/src/agent/tools/resolver.py`: the service entrypoint (re-exports the SDK).

The reserved `tools.agenta.find_capabilities` tool's **resolution is not yet wired**: the SDK
resolver does not yet emit a `CallbackToolSpec` for a `tools.agenta.*` op, so no agent config can
declare it. The server-side `/tools/call` route and the `/tools/discover` endpoint exist; the SDK
declaration/resolution is a follow-up that rides the direct-call-tools platform-op seam. The
canonical reserved-tool spec (call_ref, input_schema, description) lives in
`api/oss/src/core/tools/discovery.py`.

## Watch for when changing

- **Permission defaults and the derivation order.** It decides what gets gated.
- **Read-only and render hints.** They flow through to the runner and the browser.
- **The tool input schema.** It is what the harness sees as the tool's parameters.
- **Secret injection for code tools.** Secrets ride `env` and are resolved once at parse time.
- **Gateway call references.** The `call_ref` format is a paired contract with the tool
  endpoint.
- **Workflow call references.** A `type: "reference"` tool's `call_ref` is
  `workflow.variant.{slug}[.{version}]` or `workflow.environment.{environment}.{slug}`. The
  server-side `/tools/call` routes by the `tools.*` vs `workflow.*` prefix; keep the SDK
  (`platform/workflow.py`) and the API parser (`_call_workflow_tool`) in agreement on the axis
  grammar.
- **Reserved platform call references.** `tools.agenta.{op}` is reserved for Agenta platform
  tools (v1: `find_capabilities`), routed server-side by `_call_agenta_tool`. When the SDK
  resolution lands, keep the emitted `call_ref` and the router parser in agreement, and keep the
  reserved prefix out of the Composio 5-segment namespace.
