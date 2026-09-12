# Research

## Versions

The runner pins `@earendil-works/pi-coding-agent@0.80.6` and `pi-acp@0.0.29`, with a small Agenta
patch for skill and session paths.

The latest published `pi-acp` checked on 2026-07-14 is `0.0.31`. Its README still says MCP
servers are stored from ACP parameters but not wired into Pi. Upgrading it alone does not provide
MCP and is not a prerequisite.

The same README points to
[`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter). Latest checked release:
`2.11.0`.

## Reused behavior

The adapter already implements:

- Streamable HTTP with SSE fallback;
- arbitrary HTTP headers;
- initialization, discovery, calls, and cleanup;
- argument validation and result conversion;
- one `mcp` proxy tool for status, search, describe, and call;
- optional cache-backed direct tools.

It accepts standard configuration:

```json
{
  "mcpServers": {
    "exa": {
      "url": "https://mcp.exa.ai/mcp",
      "headers": {"x-api-key": "resolved-value"}
    }
  }
}
```

## Why proxy mode is first

The proxy works on first start. Direct tools depend on disk metadata and become available after a
restart for a new server. Adding cache warm-up only to imitate Claude's presentation adds
complexity without adding MCP functionality.

First prove the pinned adapter loads beside `agenta.js` under Pi `0.80.6`. Prefer the existing
bundled-asset path. If auxiliary files prevent one bundle, ship the pinned upstream package
directory. Do not replace it with a custom client.
