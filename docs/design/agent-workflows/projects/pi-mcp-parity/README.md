# Pi MCP parity

Status: design ready for review
Date: 2026-07-14

This project makes the existing remote MCP configuration work with Pi. The service-side path stays
identical to Claude. Only the harness-specific last mile changes:

```text
saved agent.mcps
        |
        v
service resolves secret references
        |
        v
ResolvedMCPServer[]
        |
        +--> Claude adapter --> ACP mcpServers
        |
        +--> Pi adapter ------> pi-mcp-adapter config
```

The Pi path reuses [`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter). Agenta does
not implement another MCP client, introduce a gateway, or change the saved object.

## Decision

- Keep `MCPServerConfig` and `ResolvedMCPServer` unchanged.
- Resolve secrets in the agent service exactly as for Claude.
- Generate private `pi-mcp-adapter` configuration from the resolved run object.
- Start with its default `mcp` proxy tool, which works without cache warm-up or restart.
- Support remote HTTP, no auth, secret-backed headers, and all tools.
- Use the same implementation locally and on Daytona.
- Do not add OAuth, public stdio, MCP UI, probing, flags, compatibility, or a gateway.

See [context](context.md), [research](research.md), [interface](interface.md),
[implementation plan](plan.md), [QA](qa.md), and [status](status.md).
