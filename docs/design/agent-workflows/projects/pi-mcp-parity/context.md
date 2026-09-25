# Context

## Current path

The agent service reads `parameters.agent.mcps`, validates it, resolves project secret references,
and sends `ResolvedMCPServer[]` to the runner. This path is harness-independent.

Claude receives the resolved HTTP servers as ACP `sessionInit.mcpServers`. The runner validates
URLs and applies its SSRF policy before delivery.

The session fingerprint already includes `mcpServers`. Changing an endpoint, secret reference, or
policy makes the next normal turn cold. Approval resume intentionally continues the parked process.

## Why Pi does not work

The runner rejects Pi requests containing MCP servers with
`PI_USER_MCP_UNSUPPORTED_MESSAGE`. Removing the gate alone does not help because
`buildSessionMcpServers()` returns an empty list for Pi.

Installed `pi-acp@0.0.29` accepts ACP MCP entries but does not forward them into Pi. Latest
`pi-acp@0.0.31` documents the same limitation. This is not a UI or warm-session bug.

Pi supports extensions, and the runner already installs an Agenta extension in local and Daytona
runs. `pi-mcp-adapter` supplies the missing HTTP MCP client.

## Boundary

| Concern | Shared | Claude last mile | Pi last mile |
| --- | --- | --- | --- |
| Saved config | Yes | None | None |
| Secret resolution | Agent service | Reused | Reused |
| URL and SSRF validation | Runner | Reused | Reused |
| MCP client | No | Claude Code | `pi-mcp-adapter` |
| Harness config | No | ACP entries | Temporary adapter config |

This remains direct MCP delivery, not the future gateway.

## Scope

In scope: remote HTTP, none and secret-header auth, `tools.mode = "all"`, local and Daytona,
cold configuration replacement, and redacted errors.

Out of scope: OAuth, public stdio, host-config imports, setup panels, MCP UI, sampling, elicitation,
direct-tool cache reload, gateway connections, and public contract changes.
