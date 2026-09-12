# WP34 tasks — Pi external mock MCP delivery and acceptance

Depends on WP33's shared mock fixtures.

- [x] Use Pi's extension API to register external HTTP MCP tools without a direct-upstream
      fallback.
- [x] Replace the Pi author-MCP rejection with registered gateway-route validation and native
      extension configuration.
- [x] Add **unit tests** for URL/token delivery, native/internal tool coexistence, invalid route
      rejection, and absence of upstream secrets.
- [ ] Prove a **runner integration** discovery and mock-MCP `echo` call through Pi. WP35 owns the
      protocol-compatible routing needed for this check.
- [ ] Prove parameterized service acceptance for Pi against builtin, standard, and custom mock MCP
      routes using a verified tool result. The existing unique-marker assertion is insufficient and
      must be replaced by WP35.
- [ ] Add the Pi dashboard QA procedure and record redacted live evidence outside the repository.
- [ ] Run the targeted unit, integration, and acceptance suites in both development stacks.
