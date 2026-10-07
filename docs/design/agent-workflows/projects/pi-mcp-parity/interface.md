# Interface

## Public interfaces do not change

```json
{
  "name": "exa",
  "connection": {
    "type": "http",
    "url": "https://mcp.exa.ai/mcp",
    "headers": {},
    "credentials": {
      "type": "header_secret_refs",
      "headers": {"x-api-key": "exa_api_key"}
    }
  },
  "policy": {
    "tools": {"mode": "all"},
    "permission": "ask"
  }
}
```

The service resolves this into the existing per-run object. Pi adds no API, ACP field, transport
selector, config version, feature flag, or compatibility decoder.

## Private rendering

```ts
interface PiMcpAdapterConfig {
  settings: {
    toolPrefix: "server";
    directTools: false;
    sampling: false;
    elicitation: false;
  };
  mcpServers: Record<string, {
    url: string;
    headers: Record<string, string>;
    lifecycle: "lazy";
    exposeResources: false;
    directTools: false;
  }>;
}
```

This is a private renderer, not another source of truth. Unsupported connection and policy modes
fail closed.

## Runtime artifact

The generated adapter file is secret-bearing. It must:

- live outside the durable conversation workspace;
- use a unique per-process path and restrictive permissions;
- remain for the process lifetime because the adapter may reload it;
- stay out of logs, traces, errors, snapshots, and inspect responses;
- be deleted during teardown;
- follow the same lifecycle locally and on Daytona.

A narrow `pi-acp` launch patch may pass only the config path to Pi. Header values never enter the
environment.

This does not claim secrets are hidden from the MCP client. Like Claude, the selected sandboxed
harness receives the resolved header so it can authenticate, while Agenta avoids persistence.

After local and Daytona acceptance, Pi publishes the existing `mcp.user_servers` capability. The
frontend then shows the editor without Pi-specific UI logic.

Pi sees the adapter's `mcp` proxy tool and can list servers, discover tools, and call them. This
presentation differs from Claude's direct list, but public and resolved interfaces are identical.

Remote tool execution must reuse Pi's existing extension `tool_call` permission hook and
`pi-acp` approval request path. Discovery-only proxy actions may proceed without approval.
Do not add another approval protocol.
