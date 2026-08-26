# WP33 tasks — Mock MCP harness acceptance for Claude Code and Codex

Depends on WP28 and WP29.

- [ ] Add reusable fixtures that create the builtin, standard, and custom mock MCP routes and a
      deterministic mock LLM route for a disposable project.
- [ ] Add **runner unit tests** for Claude Code and Codex MCP configuration: gateway URL/token
      delivery, no upstream secret in harness input, and registered-route enforcement.
- [ ] Add **runner integration tests** that run both harness configurations against the mock MCP
      service and assert `tools/list` plus the `echo` marker result.
- [ ] Add parameterized **OSS and EE acceptance tests** for builtin, standard, and custom MCP
      routes. Each case must prove a real `echo` call, not only configuration rendering.
- [ ] Add a manual dashboard QA checklist for Claude Code and Codex and record the command,
      harness version, run ID, and redacted result evidence outside the repository.
- [ ] Run the targeted unit, integration, and acceptance suites in both development stacks.
