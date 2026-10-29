# WP33 — Mock MCP harness acceptance for Claude Code and Codex

The gateway matrix proves that the API can relay mock MCP traffic. It does not prove that a
managed agent actually receives the gateway-backed MCP server, discovers `echo`, and calls it.
This package adds that product-path proof for the two harnesses that currently support external
HTTP MCP servers: Claude Code and Codex.

## Scope

- Use the existing development mock MCP endpoints, never a real MCP server or provider.
- Create a disposable agent configuration for each harness with a mock LLM route and one
  gateway-backed mock MCP server.
- Assert one complete run: tool discovery, a call to `echo` with a unique marker, and the marker
  in the final run/transcript result.
- Cover the builtin, standard, and custom mock MCP namespace paths across the two harnesses;
  parameterize the cases so a route family is not accidentally omitted.
- Keep the existing API matrix as the proxy-level control. This package tests the additional
  dashboard/API → runner → harness → gateway → mock-server path.

## Required verification

- **Unit:** runner configuration for Claude Code and Codex contains the intended gateway URL and
  token, contains no upstream credential, and rejects an MCP route that is not registered.
- **Integration:** a runner request through each harness configuration reaches the mock MCP
  server, lists `echo`, and returns its marker without exposing credentials.
- **Acceptance:** full OSS and EE development stacks run each harness against builtin, standard,
  and custom mock MCP routes. The test asserts the tool call and marker, rather than merely a
  successful agent response.
- **Live QA:** dashboard runs for Claude Code and Codex record run IDs, harness versions, and a
  screenshot showing the `echo` result. This is evidence, not a substitute for automated
  acceptance.

## Done when

Claude Code and Codex have automated full-stack acceptance evidence that each can use a
gateway-backed mock MCP tool. The tests use deterministic mock LLM and MCP services and leave no
credentials or test endpoints behind.
