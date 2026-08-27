# Shared contracts

This file pins every shape that crosses a boundary. A slice that writes a field name reads
this file first. If a slice needs to change a shape here, it updates this file in the same
commit and tells the other side.

Each field below carries a role. The roles come from the `design-interfaces` practice.

| Role | Meaning |
| --- | --- |
| Data | The payload the operation acts on. |
| Config | Authored settings saved in the agent revision. |
| Policy | An authorization decision. Never a name, never a routing string. |
| Routing | Selects code or a resource. Carries no policy. |
| Protocol context | Trusted values the caller adds beside the data. Never model input. |

## 1. Saved configuration entry

Owner: the Python SDK, at `sdks/python/agenta/sdk/agents/tools/models.py`.
Readers: the API (it imports the SDK class), and the frontend (it parses the raw JSON).

```json
{
  "type": "gateway_connection",
  "connection": {
    "provider": "composio",
    "integration": "github",
    "slug": "github-work"
  },
  "policy": {
    "permissions": {
      "default": "deny",
      "tools": {
        "GET_ISSUE": "inherit",
        "CREATE_ISSUE": "ask",
        "DELETE_REPOSITORY": "deny"
      }
    }
  }
}
```

| Field | Role | Rules |
| --- | --- | --- |
| `type` | Routing | Exactly `gateway_connection`. |
| `connection.provider` | Routing | Non-empty. Only `composio` is supported. |
| `connection.integration` | Routing | Non-empty. |
| `connection.slug` | Routing | Non-empty. Names a project connection. |
| `policy.permissions.default` | Policy | Required. One of `inherit`, `allow`, `ask`, `deny`. |
| `policy.permissions.tools` | Policy | Object. Keys are non-empty tool keys. Values are the same four. |

Unknown fields are rejected. The model uses `extra="forbid"`, as every other tool config
does. One agent revision holds at most one entry for the same provider and integration.

The entry never holds credentials, provider account IDs, tool schemas, or `read_only`.

## 2. Catalog metadata for the compiler

Owner: the API, at `api/oss/src/core/tools/dtos.py`.
Reader: the Python SDK compiler.

The compiler needs two fields per catalog tool.

```json
{"key": "GET_ISSUE", "read_only": true}
```

| Field | Role | Rules |
| --- | --- | --- |
| `key` | Routing | The stable Agenta tool key. |
| `read_only` | Data | `true` is a read. `false` is a write. Absent means unknown. |

The SDK defines its own input model for these two fields. It must not import an API model.

`read_only` keeps its existing snake_case spelling on the HTTP wire. It is already spelled
that way on `ToolCatalogAction`.

## 3. Resolve request and response

Route: `POST /tools/resolve`. Owner: the API. Caller: the SDK gateway resolver.

The request keeps its existing shape, `{"tools": [ ...raw config entries... ]}`. It gains
one accepted arm, the `gateway_connection` entry from section 1.

The response keeps `count`, `builtins`, and `custom`. It gains one field.

```json
{
  "count": 0,
  "builtins": [],
  "custom": [],
  "gateway_connections": [
    {
      "provider": "composio",
      "integration": "github",
      "connection": "github-work",
      "toolkit_version": "20250827_00",
      "tools": [
        {"key": "GET_ISSUE", "read_only": true},
        {"key": "CREATE_ISSUE", "read_only": false}
      ]
    }
  ]
}
```

| Field | Role | Rules |
| --- | --- | --- |
| `gateway_connections[].provider` | Routing | Echoed from the request entry. |
| `gateway_connections[].integration` | Routing | Echoed from the request entry. |
| `gateway_connections[].connection` | Routing | The validated connection slug. |
| `gateway_connections[].toolkit_version` | Execution context | The concrete toolkit version resolved from `latest` for this run. |
| `gateway_connections[].tools` | Data | The whole catalog for that version, key and `read_only` only. Input schemas stay at the API. |

The API validates the connection here, as it does for the per-tool arm today. It does not
read `policy`. It returns the catalog slice so the SDK makes one round trip per integration
instead of one per tool.

Only the whole-catalog cache that serves this response, `tools:catalog:all`, is keyed by
toolkit version. It is the only cache a run reads and it holds entries for 24 hours, so an
unversioned key there can run against a snapshot a day older than the alias it resolved.
The router's browse caches (`tools:catalog:actions`, `:action`, `:integration`, and the
rest) stay unversioned on purpose: they always ask for `latest`, hold entries for 5
minutes, and feed display only. Someone reading an integration's page should see what it
offers now, not what some run pinned.

Legacy `gateway` entries in the same request keep returning `custom` specifications. The two
arms can appear in one request during migration.

## 4. Runner-ready tool specifications

Owner: the Python SDK. Reader: the runner.

The SDK derives exactly two `CallbackToolSpec` values when the agent has at least one
`gateway_connection` entry. They are not saved configuration.

| Field | `search_tools` | `run_tool` |
| --- | --- | --- |
| `name` | `search_tools` | `run_tool` |
| `call_ref` | `gateway.search` | `gateway.run` |
| `permission` | `allow` | `allow` |
| `read_only` | `true` | absent |

Both carry `permission: "allow"`. This is not an authorization decision. It only opens the
coarse harness gate so the call reaches the runner at all.

Without it, the harness gate resolves `run_tool` through the agent-wide mode. Under
`allow_reads` a tool with no `read_only` hint resolves to `ask`, so every gateway call would
raise a second, meaningless approval card named `run_tool` before the runner ever saw the
integration and the tool key. A compiled `allow` would never run unprompted.

The authorization boundary is the runner's semantic gate, keyed on the `gateway.run` call
reference, applied on every delivery path. It reads the integration and the tool key from
the arguments and looks them up in the resolved policy. A coarse `allow` here never reaches
a provider without passing that gate.

The model-facing input schemas are fixed by `runtime-tools.md`.

`search_tools` input:

```json
{
  "type": "object",
  "properties": {
    "query": {"type": "string"},
    "integration": {"type": "string"}
  },
  "required": ["query"]
}
```

`run_tool` input:

```json
{
  "type": "object",
  "properties": {
    "integration": {"type": "string"},
    "tool": {"type": "string"},
    "arguments": {"type": "object"}
  },
  "required": ["integration", "tool", "arguments"]
}
```

## 5. The resolved gateway policy

Owner: the Python SDK. Reader: the runner. Never reaches the harness or the sandbox.

This rides the run request as one new top-level field, `gatewayPolicy`.

```json
{
  "gatewayPolicy": {
    "integrations": {
      "github": {
        "provider": "composio",
        "connection": "github-work",
        "toolkitVersion": "20250827_00",
        "tools": {
          "GET_ISSUE": {"permission": "allow", "readOnly": true},
          "CREATE_ISSUE": {"permission": "ask", "readOnly": false},
          "DELETE_REPOSITORY": {"permission": "deny", "readOnly": false}
        }
      }
    }
  }
}
```

| Field | Role | Rules |
| --- | --- | --- |
| `integrations` | Policy and routing | Keyed by integration. Only configured integrations appear. |
| `.provider` | Routing | Selects the provider adapter at the API. |
| `.connection` | Routing | The selected connection slug. |
| `.toolkitVersion` | Execution context | The concrete toolkit version. `latest` never crosses this boundary. |
| `.tools[key].permission` | Policy | One of `allow`, `ask`, `deny`. Never `inherit`. |
| `.tools[key].readOnly` | Data | `true`, `false`, or `null`. Carried for the approval card and for logs. |

Input schemas are deliberately absent. They are large, the policy rides every run request,
and the runner needs a schema only for the at most five results one search returns. The
search route answers those from the pinned catalog instead. Carrying them here measured 60
KiB against 1.5 MiB for one `github` integration.

`inherit` never crosses this boundary. The compiler has already applied it.

`readOnly` is tri-state and unknown must survive the wire. The catalog hint is absent for
some provider tools, and absent is not the same as `false` for a reader. Both languages
represent unknown as JSON `null`, and both must test it:

- Python: `Optional[bool]`, serialized with `exclude_none=False` for this field so the key is
  present and null rather than dropped.
- TypeScript: `boolean | null`, not `boolean | undefined`.

A missing key and a null value must not mean different things. Pin the null form and test a
round trip in each language.

The field is top level, not per specification, because both derived tools read the same
table and because the runner filters search results before it knows which tool the model
will run.

Mirror sites that change together:

- `services/runner/src/protocol.ts`, on `AgentRunRequest`.
- `services/runner/tests/unit/wire-contract.test.ts`, in `KNOWN_REQUEST_KEYS`. This is a
  compile-time guard. Skipping it breaks `tsc`.
- `sdks/python/agenta/sdk/agents/wire_models.py`.
- `sdks/python/agenta/sdk/agents/utils/wire.py`.
- `sdks/python/agenta/sdk/agents/dtos.py`, a new `wire_gateway_policy` method beside
  `wire_permissions`.
- The golden files under `sdks/python/oss/tests/pytest/unit/agents/golden/`.

The field is omitted when the agent has no `gateway_connection` entry. A run without one
must produce a byte-identical payload to today.

## 6. The gateway callback

Caller: the runner. Receiver: the API at `POST /tools/call`.

The runner adds one new sibling to `data`. The name is `context`.

```json
{
  "data": {
    "id": "tool-call-id",
    "type": "function",
    "function": {
      "name": "gateway.run",
      "arguments": {"channel": "#general", "text": "hello"}
    }
  },
  "context": {
    "provider": "composio",
    "integration": "slack",
    "connection": "slack-main",
    "tool": "SEND_MESSAGE"
  }
}
```

| Field | Role | Rules |
| --- | --- | --- |
| `data.function.name` | Routing | `gateway.run` or `gateway.search`. No policy, no identity. |
| `data.function.arguments` | Data | For `gateway.run`, the integration tool's own arguments only. For `gateway.search`, `{"query": ..., "integration": ...}`. |
| `context.provider` | Protocol context | Trusted. The runner read it from the resolved policy. |
| `context.integration` | Protocol context | Trusted. |
| `context.connection` | Protocol context | Trusted. Absent for `gateway.search`. |
| `context.tool` | Protocol context | Trusted. Absent for `gateway.search`. |
| `context.toolkit_version` | Execution context | The run's concrete version. `gateway.run` only. Never `latest`. |
| `context.toolkit_versions` | Execution context | One concrete version per configured integration. `gateway.search` only, because one search can rank into several. |

The two version fields differ because the two calls differ. A run names one tool, so it
carries one version. A search ranks across every configured integration, so it carries the
pin for each one it could rank into: a scoped search sends the one it named, an unscoped
search sends them all. A result whose integration is not in the map is dropped.

The API must reject a `gateway.run` or `gateway.search` call whose `context` is missing or
incomplete. Do not fall back to a default connection.

`ToolCall` does not forbid extra fields today, so an older API silently drops `context`. The
new routes are new, so an older API returns a 400 for an unknown call reference instead of
running with no connection. Keep it that way. Do not add a fallback path.

## 7. The search result

Producer: the API. First reader: the runner, which filters. Second reader: the model.

The API returns a JSON object as the tool result content.

```json
{
  "results": [
    {
      "integration": "slack",
      "tool": "SEND_MESSAGE",
      "name": "Send message",
      "description": "Post a message to a Slack channel.",
      "input_schema": {"type": "object", "properties": {}, "required": []}
    }
  ]
}
```

The runner parses that JSON, filters `results` against the resolved policy, caps the list at
five, and writes the filtered object back to the harness. When nothing remains, the runner
writes the empty result and message fixed by `runtime-tools.md`.

A result never carries the connection slug, the provider account ID, the provider action ID,
a permission value, or `read_only`.

If the API returns text that is not this object, the runner treats the call as a search
failure and returns the `tool_search_unavailable` error from `runtime-tools.md`. The runner
never passes unparsed provider text to the model on this path.

## 8. Error shapes

The gateway routes use the existing agent error envelope from
`api/oss/src/core/tools/dtos.py`. It is `{code, message, retryable, next_step, details}` and
it rides HTTP 200 inside `ToolResult.status`, because the runner hides non-2xx bodies from
the model.

| Case | `code` | `retryable` |
| --- | --- | --- |
| Provider search failed | `tool_search_unavailable` | `true` |
| Unknown or stale tool key | `tool_not_found` | `false` |
| Tool key not in that integration | `tool_not_in_integration` | `false` |
| Arguments are not an object | `invalid_arguments` | `false` |
| Connection revoked or invalid | `connection_unavailable` | `false` |
| The provider could not run the tool | `tool_execution_failed` | provider 4xx `false`, otherwise `true` |

For `tool_not_found`, `details` carries at most five close keys from the same configured
integration, under `suggestions`. Never replace malformed arguments with `{}`.

The API separates the two tool-key cases only as far as it can prove. It holds the named
integration's catalog and nothing else, so it answers `tool_not_in_integration` when the
key is no near miss of any key in that catalog and its own prefix names a different
integration, and `tool_not_found` with suggestions in every other case. The runner's
policy gate catches a tool of another configured integration before the callback is made.

`tool_execution_failed` carries the provider's own detail in `message`. It rides HTTP 200
like every other case here, because the runner hides a non-2xx body from the model and
that detail is what lets the model correct a rejected request.

## 9. The permission compiler

Owner: the Python SDK, at `sdks/python/agenta/sdk/agents/tools/gateway_policy.py`.

Signature:

```python
def compile_gateway_permissions(
    policy: GatewayPermissions,
    catalog: Sequence[CatalogToolInfo],
    mode: PermissionMode,
) -> CompiledGatewayPolicy:
```

The result is one explicit type, not a bare mapping, because the caller needs two lists:

```python
class CompiledGatewayPolicy(BaseModel):
    tools: Dict[str, CompiledTool]   # executable, one of allow, ask, deny
    stale_keys: List[str]            # configured keys absent from the catalog
```

`tools` feeds the resolved policy in section 5. `stale_keys` feeds the resolver warnings and
the authoring surface. A stale key never appears in `tools`.

Order, for each catalog tool:

1. Use the exact value in `policy.tools` when the key is present.
2. Otherwise use `policy.default`.
3. If the result is `inherit`, apply `mode`.
4. Under `allow_reads`, `read_only: true` becomes `allow`. `false` and absent become `ask`.

The function is pure. It performs no input and output. It must not import an API model or a
runner type. `mode` comes from `permission_default` on the harness template, which defaults
to `allow_reads`.

A configured tool key that is not in the catalog does not appear in the output. The compiler
returns it in `stale_keys` so the authoring surface can report it.

## 10. Authoring presets

Owner: the frontend. The saved format is section 1. Presets are a display of that format,
not a saved value.

Writing a preset:

| Preset shown | Saved `default` | Saved `tools` |
| --- | --- | --- |
| Always ask | `ask` | `{}` |
| Ask for write and delete | `inherit` | `{}` |
| Allow all | `allow` | `{}` |
| Deny all | `deny` | `{}` |
| Custom | unchanged | non-empty |

Reading a preset back:

1. If `tools` is not empty, show Custom, with the count of entries.
2. Otherwise map `default` through the table above.

"Ask for write and delete" saves `inherit` because the agent-wide mode `allow_reads` already
means "reads run, writes ask". The default agent-wide mode is `allow_reads`. See open
question 1 in [plan.md](plan.md) for what to show when an author changes that mode.

Setting any per-tool value switches the shown preset to Custom, because `tools` is no longer
empty. Picking a preset clears `tools`.

**The override count is the number of saved entries in `tools`.** There is one rule and both
this file and [qa.md](qa.md) case F7 state it the same way.

Do not compute the count by comparing each entry against the value the preset would have
produced. That second rule disagrees with the first whenever an entry is redundant, for
example a tool explicitly set to `ask` under a `default` of `ask`. Under the comparison rule
that entry counts as zero overrides while the preset still reads Custom, so the drawer would
show "Custom" with a count of 0.

The writer keeps the two consistent: when a per-tool change makes an entry equal to the
current default, still save the entry. The author set it deliberately, and the saved value
survives a later change of default. Redundancy is intended here, not a bug to normalize away.
