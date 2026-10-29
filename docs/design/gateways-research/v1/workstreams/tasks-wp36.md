# WP36 tasks — Composio brokered MCP data plane

- [ ] Define the brokered MCP endpoint and authorization exchange against the Composio connection
      contract; do not use the placeholder URL as an outbound target.
- [ ] Implement and register `ComposioMCPAdapter` with **unit tests** for connection state,
      request construction, response preservation, and safe error mapping.
- [ ] Add **integration tests** for connected, disconnected, invalid, and insufficient-scope
      Composio connections.
- [ ] Add a local broker double and **OSS/EE acceptance** covering `tools/list` and `tools/call`
      through builtin Composio.
- [ ] Verify no broker or user secret crosses the gateway credential boundary.
