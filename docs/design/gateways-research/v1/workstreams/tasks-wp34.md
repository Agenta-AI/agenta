# WP34 tasks — Pi external mock MCP delivery and acceptance

Depends on WP33's shared mock fixtures.

- [x] Use Pi's extension API to register external HTTP MCP tools without a direct-upstream
      fallback.
- [x] Replace the Pi author-MCP rejection with registered gateway-route validation and native
      extension configuration.
- [x] Add **unit tests** for URL/token delivery, native/internal tool coexistence, invalid route
      rejection, and absence of upstream secrets.
- [x] Add a **runner integration test** that discovers and calls mock MCP `echo` through Pi.
- [x] Add parameterized service acceptance coverage for Pi against builtin, standard, and custom
      mock MCP routes, asserting the unique `echo` marker in either OSS or EE development stacks.
- [ ] Add the Pi dashboard QA procedure and record redacted live evidence outside the repository.
- [ ] Run the targeted unit, integration, and acceptance suites in both development stacks.
