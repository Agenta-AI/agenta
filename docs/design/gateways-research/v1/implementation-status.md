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
| Builtin `agenta` | Run-scoped callback tools are exposed at `builtin/agenta/run` through the existing Tools router. | Requires the invocation-scoped credential issued to an agent run. |
| Builtin `mock` | Development-only generated mock endpoint. | Test provider only. |
| Builtin `composio` | Uses the deployment `COMPOSIO_API_KEY` to create a project-scoped Tool Router session and relay JSON-RPC. | Requires an active deployment-managed Composio connection. |
| Standard `mock` | Development-only generated endpoint, requiring a project mock provider key. | Test provider only. |
| Standard `composio` | Uses a project vault Composio developer key to create a project-scoped Tool Router session and relay JSON-RPC. | The external account is managed in that Composio project; it never falls back to the deployment key. |
| Custom | Persisted Streamable HTTP endpoint with direct secret or MCP OAuth grant support. | The proxy parses JSON-RPC method and tool name from the request body; legacy routing headers are optional consistency checks. |

## Harness MCP acceptance

Pi executes `echo` through the builtin, standard, and custom mock routes in full-stack
acceptance. Codex and Claude Code receive the gateway HTTP-MCP configuration, but neither has a
deterministic native-MCP exchange with the generic mock LLM; their cases are named non-strict
expected failures tracked in OR23. `builtin/agenta/run` is validated through an invocation-scoped
agent/runner path rather than the HTTP mock matrix.
