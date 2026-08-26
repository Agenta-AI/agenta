# Gateway connection configuration

This page defines the saved agent configuration for gateway connections. It covers
connection references, tool availability, permissions, validation, and migration from
the current one-entry-per-tool format.

Runtime tool delivery and callback protocols are out of scope.

## Configuration

A gateway connection is one entry in `parameters.agent.tools`:

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

The configuration refers to a shared project connection. It does not contain credentials,
provider account IDs, tool schemas, or runtime state.

## Field roles

| Field | Role | Meaning |
| --- | --- | --- |
| `type` | Config discriminator | Selects the grouped gateway-connection format. |
| `connection` | Resource reference | Identifies the shared project connection. |
| `connection.provider` | Routing | Selects the gateway provider adapter. |
| `connection.integration` | Routing | Selects the provider integration. |
| `connection.slug` | Resource identity | Selects the project-scoped connection. |
| `policy` | Agent policy | Defines what this agent may do through the connection. |
| `policy.permissions.default` | Connection policy | Applies when a tool has no exact entry. |
| `policy.permissions.tools` | Tool policy | Overrides the default for exact tool keys. |

The connection resource and the agent policy have different owners and lifetimes. A
project can reuse one connection across several agents and triggers. Each agent revision
can apply a different policy without changing the shared connection.

## Permission values

The connection default and each tool entry accept four values:

| Value | Meaning |
| --- | --- |
| `inherit` | Defer to the agent-wide runner permission policy. |
| `allow` | Run without approval. |
| `ask` | Require approval for each call. |
| `deny` | Make the tool unavailable and reject attempts to call it. |

`inherit` is explicit in this format. An absent tool key means "use this connection's
default," while a tool set to `inherit` means "skip this connection's default and use
the agent-wide policy." These states are different when the connection default is `deny`.

The agent-wide `allow_reads` mode remains a runner policy. It is not a gateway permission
value. A tool that resolves to `inherit` follows `allow_reads`: a trusted read-only tool
runs, while a write tool or a tool without a read-only classification asks.

## Policy examples

### Selected tools only

Set the connection default to `deny`, then list the tools the agent can use:

```json
{
  "permissions": {
    "default": "deny",
    "tools": {
      "GET_ISSUE": "inherit",
      "CREATE_ISSUE": "ask"
    }
  }
}
```

All other tools are unavailable.

### All tools use the agent policy

```json
{
  "permissions": {
    "default": "inherit",
    "tools": {}
  }
}
```

Every tool follows the agent-wide runner permission policy.

### All tools except specific exclusions

```json
{
  "permissions": {
    "default": "inherit",
    "tools": {
      "DELETE_REPOSITORY": "deny",
      "TRANSFER_REPOSITORY": "deny"
    }
  }
}
```

New provider tools also inherit the agent-wide policy. The two named tools remain
unavailable.

### Connection default with tool overrides

```json
{
  "permissions": {
    "default": "ask",
    "tools": {
      "GET_ISSUE": "allow",
      "DELETE_REPOSITORY": "deny"
    }
  }
}
```

The named read tool runs without approval, the named destructive tool is unavailable, and
every other tool asks.

## Permission resolution

For a tool on a gateway connection:

1. Use the exact value in `policy.permissions.tools` when present.
2. Otherwise use `policy.permissions.default`.
3. If the result is `inherit`, apply the existing agent-wide permission rules and runner
   default, including `allow_reads`.

An operator security override remains authoritative over authored agent policy.

`deny` is both an authorization decision and an availability decision. A denied tool is
not offered to the agent, and the backend still rejects a direct attempt to call it. There
is no separate include list.

## Validation

The saved model must enforce these rules:

- `type` is exactly `gateway_connection`.
- `provider`, `integration`, and `slug` are non-empty.
- `default` is required and is one of `inherit`, `allow`, `ask`, or `deny`.
- `tools` is an object whose keys are non-empty canonical Agenta tool keys.
- Every value in `tools` is one of `inherit`, `allow`, `ask`, or `deny`.
- One agent revision contains at most one `gateway_connection` entry for the same provider
  and integration. A project may contain several connections for that integration, but the
  agent selects one of them in V1.
- Unknown fields are rejected.

Tool descriptions, input schemas, read-only classifications, connection validity, and
provider-specific account IDs are resolved data. They are not persisted in this model.

A saved tool key can outlive the provider's current catalog. Catalog drift must not make
an old agent revision unparsable. The authoring surface can report the stale tool, while
the saved intent remains intact.

## Migration

The current format stores one entry per tool. Its legacy field is named `action`:

```json
[
  {
    "type": "gateway",
    "provider": "composio",
    "integration": "github",
    "connection": "github-work",
    "action": "GET_ISSUE",
    "permission": "allow"
  },
  {
    "type": "gateway",
    "provider": "composio",
    "integration": "github",
    "connection": "github-work",
    "action": "CREATE_ISSUE",
    "permission": "ask"
  }
]
```

Group entries by provider, integration, and connection. Set the new connection default to
`deny`, then copy each tool into the permission map:

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
        "GET_ISSUE": "allow",
        "CREATE_ISSUE": "ask"
      }
    }
  }
}
```

An old tool with no explicit `permission` maps to `inherit`. This preserves its current
behavior under the agent-wide runner policy.

During migration, readers accept both `gateway` and `gateway_connection`. Updated authoring
surfaces write only `gateway_connection`. This local discriminator migration does not add a
schema version to the whole agent configuration.
