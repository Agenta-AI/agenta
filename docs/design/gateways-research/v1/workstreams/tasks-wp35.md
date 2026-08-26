# WP35 tasks — Protocol-compatible MCP routing and truthful harness acceptance

- [ ] Parse method and tool name from JSON-RPC without changing relayed body bytes; accept absent
      proprietary headers and reject conflicting values.
- [ ] Add **unit tests** for valid body-derived routing, malformed JSON-RPC, header/body conflict,
      and byte-preserving relay behaviour.
- [ ] Add **integration tests** using a normal Streamable HTTP MCP client against builtin,
      standard, and custom mock routes.
- [ ] Add deterministic mock-model tool-call behaviour and assert a recorded `echo` result, not a
      marker repeated from the prompt.
- [ ] Add **Pi and Codex OSS/EE acceptance** for all three mock MCP namespaces.
- [ ] Restore Claude only after a standalone mock-LLM run succeeds; otherwise keep one explicit
      expected-limitation case with the known timeout reason.
- [ ] Run the focused unit, integration, and OSS/EE acceptance suites after deployment.
