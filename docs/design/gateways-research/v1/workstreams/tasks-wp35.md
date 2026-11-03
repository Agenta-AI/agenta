# WP35 tasks — Protocol-compatible MCP routing and truthful harness acceptance

- [x] Parse method and tool name from JSON-RPC without changing relayed body bytes; accept absent
      proprietary headers and reject conflicting values.
- [x] Add **unit tests** for valid body-derived routing, malformed JSON-RPC, header/body conflict,
      and byte-preserving relay behaviour.
- [x] Add **integration tests** using a normal Streamable HTTP MCP client against builtin,
      standard, and custom mock routes.
- [x] Add deterministic mock-model tool-call behaviour and assert a recorded `echo` result, not a
      marker repeated from the prompt.
- [x] Add **Pi and Codex OSS/EE acceptance** for all three mock MCP namespaces.
- [x] Restore Claude only after a standalone mock-LLM run succeeds; otherwise keep one explicit
      expected-limitation case for its system-reminder response.
- [ ] Run the focused unit, integration, and OSS/EE acceptance suites after deployment.
