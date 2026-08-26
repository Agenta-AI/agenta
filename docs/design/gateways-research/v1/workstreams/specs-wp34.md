# WP34 — Pi external mock MCP delivery and acceptance

Pi currently refuses author-supplied MCP servers before the harness starts. Its native extension
can use Agenta's internal tool channel, but that is not a gateway-backed external MCP server and
does not test the mock MCP routes. This package adds first-class external HTTP MCP delivery to Pi,
then proves it with the same mock MCP routes as WP33.

## Scope

- Replace Pi's external-MCP refusal with its native, supported MCP configuration mechanism.
- Deliver only registered gateway MCP URLs and the short-lived gateway token; the Pi process must
  not receive an upstream URL, provider credential, or a direct mock-server URL.
- Preserve Pi's native Agenta tool extension. External gateway MCP servers and internal tools are
  separate inputs and must coexist without name collisions.
- Reuse WP33's mock fixtures and assertions; do not create a Pi-only mock route or bypass the
  gateway.

## Required verification

- **Unit:** Pi accepts registered HTTP MCP servers, renders them through its native mechanism,
  rejects unsupported transport and unregistered routes, and never serializes upstream secrets.
- **Integration:** a Pi run lists and calls the gateway-backed mock `echo` tool while its native
  Agenta tools remain available.
- **Acceptance:** full OSS and EE development stacks run Pi through builtin, standard, and custom
  mock MCP routes and assert the returned unique `echo` marker.
- **Live QA:** one dashboard run per route family records Pi version, run ID, and the visible
  tool result.

## Done when

Pi can use a registered gateway-backed HTTP MCP server without a test-only bridge, and automated
acceptance demonstrates `echo` through every mock MCP namespace.
