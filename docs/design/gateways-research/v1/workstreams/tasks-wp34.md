# WP34 tasks — Pi external mock MCP delivery and acceptance

Depends on WP33's shared mock fixtures.

- [ ] Identify Pi's supported native external-HTTP-MCP configuration format and add it to the
      runner without a direct-upstream fallback.
- [ ] Replace the current Pi author-MCP rejection with registered gateway-route validation and
      native configuration rendering.
- [ ] Add **unit tests** for URL/token delivery, native/internal tool coexistence, unsupported
      transport rejection, and absence of upstream secrets.
- [ ] Add a **runner integration test** that discovers and calls mock MCP `echo` through Pi.
- [ ] Add parameterized **OSS and EE acceptance tests** for Pi against builtin, standard, and
      custom mock MCP routes, asserting the unique `echo` marker.
- [ ] Add the Pi dashboard QA procedure and record redacted live evidence outside the repository.
- [ ] Run the targeted unit, integration, and acceptance suites in both development stacks.
