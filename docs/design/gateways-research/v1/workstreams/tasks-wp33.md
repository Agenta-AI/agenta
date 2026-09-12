# WP33 tasks — Mock MCP harness acceptance for Claude Code and Codex

Depends on WP28 and WP29.

- [x] Add reusable fixtures that create the builtin, standard, and custom mock MCP routes and a
      deterministic mock LLM route for a disposable project.
- [x] Add **runner unit tests** for Claude Code and Codex MCP configuration: gateway URL/token
      delivery, no upstream secret in harness input, and registered-route enforcement.
- [ ] Prove **runner integration** tool discovery and `echo` calls against the mock MCP service.
      WP35 owns the protocol-compatible routing needed for this check.
- [ ] Prove parameterized **OSS and EE acceptance** calls for builtin, standard, and custom MCP
      routes. The existing marker-only cases are not evidence of a real `echo` call; WP35 replaces
      them with tool-result evidence.
- [ ] Add a manual dashboard QA checklist for Claude Code and Codex and record the command,
      harness version, run ID, and redacted result evidence outside the repository.
- [ ] Run the targeted unit, integration, and acceptance suites in both development stacks.
