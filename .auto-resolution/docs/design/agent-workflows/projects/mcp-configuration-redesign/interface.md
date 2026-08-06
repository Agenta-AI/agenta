# Interface design

## Interface layers

| Layer | Owner | Lifetime | May contain secret values |
| --- | --- | --- | --- |
| `MCPServerConfig` | Template author | Saved revision | No |
| `ResolvedMCPServer` | Service resolver | One run | Yes, in redacted headers |
| Runner MCP entry | Runner adapter | One session | Yes, direct Claude only |
| MCP connection status | Future MCP client or gateway | Ephemeral | No |

## Saved author contract

```json
{
  "name": "memory",
  "connection": {
    "type": "http",
    "url": "https://memory.example.com/mcp",
    "headers": {},
    "credentials": {"type": "none"}
  },
  "policy": {
    "tools": {"mode": "all"},
    "permission": "ask"
  }
}
```

There is no config version and no compatibility decoder. This is a breaking pre-production reset.
There is also no public transport selector: the only accepted connection type is external HTTP.

### Semantic roles

| Field | Role | Owner |
| --- | --- | --- |
| `name` | Stable identity within one agent revision | Author |
| `connection.type` and `url` | External routing | Author |
| `connection.headers` | Non-secret public HTTP metadata | Author |
| `connection.credentials` | Credential strategy and secret references | Author plus platform |
| `policy.tools` | Tool exposure policy | Author |
| `policy.permission` | Whole-server authorization policy | Author |

`name` must not be `agenta-tools`. That name is reserved for the private runtime channel.

### Credentials

Unauthenticated:

```json
{"type": "none"}
```

Static header secret references:

```json
{
  "type": "header_secret_refs",
  "headers": {"Authorization": "memory_token"}
}
```

The values are project secret names, never credential values. Future OAuth can add another
discriminator in this same location without moving unrelated fields.

### Tool policy

```json
{"tools": {"mode": "all"}, "permission": "ask"}
```

`include` requires a non-empty `names` list. `all` rejects names. The initial UI uses `all`
because discovery and enforceable selection belong to slice 3.

## Runtime capability contract

```json
{
  "mcp": {
    "user_servers": {
      "connection_types": ["http"],
      "credentials": ["none", "header_secret_refs"]
    }
  }
}
```

Presence means the selected harness supports external user MCP authoring and delivery. Absence
means unsupported. There is no separate `enabled` boolean and no frontend environment variable.

The UI reads this from the existing inspect-fed harness catalog:

- Claude publishes `mcp.user_servers`.
- Pi omits it until slice 2.2 works.
- missing or loading metadata fails closed;
- internal `agenta-tools` capability is not represented here.

This is the same path in local Docker and Agenta Cloud, so `agenta_cloud` needs no MCP-specific
frontend or compose setting.

## Resolved runner contract

The service resolves secret references per run and sends:

```json
{
  "name": "memory",
  "connection": {
    "type": "http",
    "url": "https://memory.example.com/mcp",
    "headers": {"Authorization": "resolved value"}
  },
  "policy": {
    "tools": {"mode": "all"},
    "permission": "ask"
  }
}
```

Resolved headers are secret-bearing. They must not be persisted, returned by inspect, included in
repr output, or logged. Claude's adapter maps this object to the existing ACP HTTP MCP entry.

## Removed fields

| Field | Disposition |
| --- | --- |
| `transport` | Removed |
| `command`, `args` | Removed with public stdio |
| `env` | Removed; it mixed process environment with HTTP headers |
| flat `url` | Moved to `connection.url` |
| flat `secrets` | Moved to `connection.credentials` |
| flat `tools` | Replaced by explicit `policy.tools` |
| flat `permission` | Moved to `policy.permission` |
