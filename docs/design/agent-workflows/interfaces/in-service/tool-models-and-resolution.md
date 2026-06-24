# Tool Models And Resolution

A tool starts as editable config and ends as a resolved spec that the runner can run. This
page covers that in-service contract: the four config types the author writes, the three
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
```

## Resolved spec types (what the runner gets)

```jsonc
// callback: a gateway tool; runs in Agenta via /tools/call
{ "kind": "callback", "name": "...", "description": "...", "input_schema": {},
  "call_ref": "tools.composio.github.create_issue.my-gh" }

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

- `sdks/python/agenta/sdk/agents/tools/models.py`: the config and spec models and the
  permission derivation.
- `sdks/python/agenta/sdk/agents/platform/gateway.py`: gateway resolution to a `call_ref`.
- `services/oss/src/agent/tools/resolver.py`: the service entrypoint (re-exports the SDK).

## Watch for when changing

- **Permission defaults and the derivation order.** It decides what gets gated.
- **Read-only and render hints.** They flow through to the runner and the browser.
- **The tool input schema.** It is what the harness sees as the tool's parameters.
- **Secret injection for code tools.** Secrets ride `env` and are resolved once at parse time.
- **Gateway call references.** The `call_ref` format is a paired contract with the tool
  endpoint.
