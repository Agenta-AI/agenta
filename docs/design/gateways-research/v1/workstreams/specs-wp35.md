# WP35 — Protocol-compatible MCP routing and truthful harness acceptance

The current MCP proxy demands `MCP-Method` and `MCP-Name` headers. Those are Agenta-specific and
ordinary Streamable HTTP MCP clients do not send them. The current Pi and Codex acceptance cases
therefore receive HTTP 400, while the mock LLM echoes their prompt marker and makes the tests look
green. This package makes the data plane interoperable and makes acceptance evidence real.

## Scope

- Extract method and optional tool name from a parsed view of the JSON-RPC body while relaying the
  original bytes unchanged. The optional headers may remain a consistency check, but cannot be
  required from a standard MCP client.
- Reject malformed JSON-RPC and conflicting header/body metadata with a JSON-RPC invalid-request
  response.
- Replace prompt-echo assertions with a deterministic mock-model tool-call exchange: discover a
  mock tool, call `echo` with a unique marker, feed its result back to the model, and only then
  return the marker.
- Re-enable Claude only with a deterministic fixture that fixes its independent mock-LLM timeout;
  until then, mark its case as a named expected limitation rather than a passing test.

## Required verification

- **Unit:** body-derived context, header/body consistency, malformed JSON-RPC, and byte identity.
- **Integration:** standard Streamable HTTP client traffic reaches builtin, standard, and custom
  mock MCP routes without Agenta-only headers.
- **Acceptance:** Pi and Codex execute `echo` through all three namespaces and assert evidence of
  the tool call. Claude joins only after its mock-LLM fixture passes independently.

## Done when

A standard MCP client can use every mock gateway route without proprietary routing headers, and a
passing harness test proves a real tool call rather than a repeated prompt string.
