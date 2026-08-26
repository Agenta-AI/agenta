# Gateway implementation status

This is the current implementation inventory, not a roadmap claim.

## LLM

| Namespace | Current implementation | Limit |
| --- | --- | --- |
| Builtin `agenta` | Development-only generated `mock/echo` endpoint, served by `MockLLMAdapter`. | No production Agenta-owned model catalogue yet. |
| Builtin `mock` | Development-only generated `mock/echo` endpoint, served by `MockLLMAdapter`. | Test provider only. |
| Standard | Generated endpoint for each provider in the SDK model catalogue with a project provider key; non-mock providers use the byte-preserving relay. | A catalogue entry without a configured fixed route is rejected as having no known route. No live-provider acceptance is part of this increment. |
| Standard `mock` | Development-only generated `mock/echo`, requiring a project mock provider key. | Test provider only. |
| Custom | Persisted endpoint with direct, Azure, Bedrock, Vertex, or custom compatible routing through the relay. | SageMaker is explicitly rejected because it has no fixed request protocol. |

The relay has routes for Chat Completions, Responses, and Messages. Vertex Messages has the
explicit static field rewrite; all other supported routes preserve request bytes.

## MCP

| Namespace/provider | Current implementation | Limit |
| --- | --- | --- |
| Builtin `agenta` | Development-only generated `mock` endpoint mapped to `MockMCPAdapter`. Existing production Agenta tools are resolved per run and delivered as `customTools` — natively to Pi and through the runner's loopback `agenta-tools` MCP server to Claude/Codex. | The gateway has not adapted that existing tool resolver and dispatch path, so `builtin/agenta` does not expose it. |
| Builtin `mock` | Development-only generated mock endpoint. | Test provider only. |
| Builtin `composio` | Catalogue browsing and project connection/OAuth management use the deployment's `COMPOSIO_API_KEY`. The data-plane service selects a `composio` adapter that is not implemented or registered. | A real MCP call fails at adapter dispatch. |
| Standard `mock` | Development-only generated endpoint, requiring a project mock provider key. | Test provider only. |
| Standard `composio` | Not implemented. A project-owned Composio developer key has no endpoint, connection, or adapter path. | This is the bring-your-own-Composio mode and belongs in `standard`; it must never fall back to the deployment key. |
| Custom | Persisted Streamable HTTP endpoint with direct secret or MCP OAuth grant support. | Requires WP35 before standard clients can relay because the current gateway relies on non-standard routing headers. |

## Harness MCP acceptance

The current harness test is not valid acceptance evidence:

- the MCP proxy requires `MCP-Method` (and optionally `MCP-Name`) headers, but standard MCP
  clients send only JSON-RPC bodies; observed Pi and Codex gateway calls returned HTTP 400;
- the mock LLM echoes the prompt marker, so finding that marker in the final response does not
  prove an MCP tool call; and
- Claude Code has an independent known timeout with the mock LLM, including when no MCP route is
  involved. It must not be presented as an MCP failure or a passing MCP case.

WP35 closes the first two points. The Claude mock-LLM problem needs a deterministic harness
fixture before Claude joins the automated matrix again. WP36 implements platform-key builtin
Composio, WP38 implements project-key standard Composio, and WP37 implements production Agenta
builtin MCP.
