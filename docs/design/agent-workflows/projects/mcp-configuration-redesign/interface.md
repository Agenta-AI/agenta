# Interface design

## Interface layers

Do not use one type for author intent, resolved secrets, runner delivery, and MCP protocol state.

| Layer | Owner | Lifetime | May contain secret values |
| --- | --- | --- | --- |
| `MCPServerConfig` | Template author | Saved revision | No |
| `ResolvedMCPServer` | Service resolver | One run | Temporarily, until gateway migration |
| Runner MCP entry | Runner adapter | One session | Temporarily, direct Claude only |
| MCP connection status | MCP client or gateway | Ephemeral | No |

## Canonical author contract

```json
{
  "version": 2,
  "name": "memory",
  "connection": {
    "type": "remote_http",
    "url": "https://memory.example.com/mcp",
    "headers": {},
    "credentials": {
      "type": "none"
    }
  },
  "policy": {
    "tools": {
      "mode": "all"
    },
    "permission": "ask"
  }
}
```

`version` is the Agenta author-config version. It is not the negotiated MCP protocol version.

### Identity

`name` is the stable server name within one agent revision. It must be unique and must not equal
the reserved runtime name `agenta-tools`.

### Connection

`connection` owns how Agenta reaches the external server.

```text
type: "remote_http"
url: absolute HTTPS MCP endpoint
headers: non-secret static headers only
credentials: discriminated authentication strategy
```

There is no public `transport` selector in version 2. `remote_http` is a semantic connection type
and leaves room for future managed-server references without accepting arbitrary commands.

### Credentials

Credentials are extensible through a discriminator in the same location:

```json
{"type": "none"}
```

```json
{
  "type": "header_secret_refs",
  "headers": {
    "Authorization": "memory_token"
  }
}
```

```json
{
  "type": "oauth_connection",
  "connection_ref": "memory-production"
}
```

The secret-ref mapping contains platform secret names, never values. A future connection resource
may replace or resolve those refs without moving `credentials`.

### Policy

Policy is separate from connectivity:

```json
{"tools": {"mode": "all"}, "permission": "ask"}
```

or:

```json
{
  "tools": {
    "mode": "include",
    "names": ["search", "remember"]
  },
  "permission": "ask"
}
```

`names` is valid only for `include` and is populated from discovery. The gateway or direct-client
adapter must enforce it for both `tools/list` and `tools/call`. Prompt rendering is not enforcement.

## Capability contract

Add an optional MCP capability to harness metadata:

```json
{
  "mcp": {
    "user_servers": {
      "enabled": true,
      "connection_types": ["remote_http"],
      "credentials": ["none"],
      "discovery": true
    }
  }
}
```

The service publishes the effective deployment plus harness capability. Older or missing metadata
means disabled. Pi publishes disabled until the gateway projection exists. Internal
`agenta-tools` support is not part of this public capability.

## Status contract

Connection testing returns an ephemeral result, not a mutation of the saved author object:

```json
{
  "state": "connected",
  "server": {"name": "Memory", "version": "1.2.0"},
  "protocol_version": "negotiated-value",
  "tools": [
    {"name": "remember", "description": "Store a memory", "input_schema": {}}
  ],
  "error": null
}
```

Allowed states are `not_tested`, `connecting`, `connected`, and `error`. The test endpoint returns
normalized error codes and safe messages. It never returns credential values or raw authorization
headers.

## Resolved contract

Version 2 author config normalizes into a private resolved form. For the interim direct-Claude
adapter it may contain resolved header values, but that type must be named and documented as
secret-bearing. It must never be serialized into logs, persisted, returned by inspect, or copied
back into the author config.

The gateway adapter later consumes the same author intent and resolves credentials inside the
gateway. No public field changes when that switch happens.

## Removed public fields

| Field | Disposition | Reason |
| --- | --- | --- |
| `transport` | Replaced by `connection.type` | The UI supports one public connection type |
| `command` | Removed | Arbitrary runner-host execution is unsupported |
| `args` | Removed | Belongs to removed user stdio |
| `env` | Removed | Mixed process env and HTTP headers |
| flat `url` | Moved to `connection.url` | Endpoint ownership |
| flat `secrets` | Moved to `connection.credentials` | Credential ownership |
| flat `tools` | Moved to explicit policy | Empty-list ambiguity and dead enforcement |
| flat `permission` | Moved to policy | Authorization ownership |

