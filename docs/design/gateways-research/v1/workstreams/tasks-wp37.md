# WP37 tasks — Expose existing Agenta tools through builtin MCP

- [ ] Map the existing resolver's per-run public tool set, callback authorization, context
      bindings, and approval semantics into a gateway credential contract.
- [ ] Implement and register the builtin Agenta adapter using the existing resolver/dispatch
      path; remove production dependence on the mock adapter while retaining `builtin/mock`.
- [ ] Add **unit and integration tests** for run-scoped discovery, allowed calls, denied calls,
      bindings, permissions, and disabled mock mode.
- [ ] Add **OSS/EE gateway and harness acceptance** proving an existing Agenta tool call and
      refusal for a missing or mismatched run credential.
- [ ] Verify the runner's loopback `agenta-tools` transport and the builtin gateway adapter have
      the same capability and authorization semantics without becoming coupled transports.
