# Interface design

## Stable saved object

This project extends behavior around the existing roles:

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

Connection results and discovered tools are not written into this object.

## Connection test result

```json
{
  "state": "connected",
  "server": {"name": "Memory", "version": "1.2.0"},
  "protocol_version": "2025-11-25",
  "tools": [
    {"name": "remember", "description": "Store a memory", "input_schema": {}}
  ],
  "error": null
}
```

This is ephemeral protocol context owned by the MCP client. Errors use stable codes plus safe
messages and never include headers or credential values.

## OAuth credential

```json
{
  "type": "oauth_connection",
  "connection_ref": "memory-production"
}
```

The referenced platform connection owns scopes, token refresh, revocation, and callback state.

## Policy enforcement

`all` exposes every discovered tool. `include` exposes only names in `policy.tools.names`.
Enforcement applies to both list and call paths. A direct call to an excluded tool fails even if a
model knows the tool name from earlier context.
