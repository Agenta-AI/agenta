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

All three harnesses execute `echo` through the builtin, standard, and custom mock routes in
full-stack acceptance, 27 cells green. Codex and Claude Code used to fail because the mock MCP
server answered only `server/discover`, `tools/list` and `tools/call`, so their native clients
could not complete the `initialize` handshake every MCP session opens with; Pi passed because its
extension calls `tools/list` directly. The mock now answers the handshake, and no per-harness
captured fixture was needed. See OR23 in `open-reviews.md`. `builtin/agenta/run` is validated
through an invocation-scoped agent/runner path rather than the HTTP mock matrix.

## Verified state as of 2026-09-12

Measured on the branch squashed onto `main`, deployed as an EE development stack, with
`hosting/docker-compose/test.sh --ee --dev`.

### Automated suites

| Suite | Result |
| --- | --- |
| API acceptance, `oss/tests/pytest/acceptance/gateways/` | 40 passed |
| API acceptance, the mock matrix alone | 21 passed |
| API integration, `oss/tests/pytest/integration/gateways/` | 23 passed |
| SDK acceptance, `test_mcp_gateway_routing_acceptance.py` | 2 passed |
| Services integration, `test_gateway_http.py` | 11 passed |
| Runner acceptance, `gateway-credentials-no-provider-secret.test.ts` | 23 passed |
| Services acceptance, `test_agent_gateway_route.py` | 27 passed |

`test_agent_harness_calls_echo_through_each_mock_mcp_gateway_route` covers every
LLM-namespace and MCP-namespace pair on every harness: nine Pi, nine Codex, nine Claude. The nine
Claude cells failed on this date and were fixed the same day by the mock MCP handshake change
recorded in OR23.

### The dashboard product path

The manual procedure in `qa.md` was run the same day against the same stack, in a disposable
project, through an isolated browser. **Two of the three harnesses complete a gateway LLM turn from
the dashboard, none completes the MCP leg, and no harness can be configured without an API call
first.** Per harness:

| Harness | Gateway LLM leg | Gateway MCP leg | Typed refusal |
| --- | --- | --- | --- |
| Pi | reaches the gateway and returns `200`, on a custom endpoint created through the API | not executable: the `MCP servers` section is hidden whenever Pi is selected | partial: `code` and message appear only inside the harness session recap |
| Claude Code | completes a turn, on a custom endpoint declaring the `anthropic` protocol; refused at `422` on an `openai` one, which is the only protocol the provider form offers | failed silently: the handshake was refused and the run carried on as if no server were attached | nothing reaches the user |
| Codex | refused inside the harness: it matches the full prefixed model key against a fixed catalogue, so no custom gateway model can satisfy it | not reached | partial: an error card with the human message, no `code` |

Four findings remain active in `open-reviews.md`. **OR26** is the one that gates configuration: the
AI providers page writes a `custom_provider` secret and never registers the endpoint the SDK then
resolves, which is why every cell above needed an endpoint created through the API. **OR31** is the
configuration surface itself, starting with the missing protocol choice that makes Claude Code
un-runnable through the form. **OR28** is per-harness preservation of the refusal envelope, which
no harness satisfies. **OR32** is the silent MCP handshake failure in the Claude Code row. OR23,
OR27, OR29 and OR30 were closed the same day; the closed record carries their mechanisms and
tests.

### Deployment flags

Two named environment variables now gate gateway behaviour, both default off.

| Variable | Read by | Effect |
| --- | --- | --- |
| `AGENTA_GATEWAYS_MOCKS_ENABLED` | the API process, `api/oss/src/utils/env.py` | generates the development-only mock catalogue entries and routes |
| `AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED` | the SDK in the `services` container and the runner, `run-plan.ts` | permits a gateway bearer over plain HTTP to a routable host (OR24) |

In the OSS and EE development compose files `AGENTA_GATEWAYS_MOCKS_ENABLED` is hardcoded on the
`api` service and on the two mock gateway services, and
`AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED` is declared on `runner` only. The `services` container,
which runs the SDK resolver, receives the second variable only through the deployment env file,
which every service loads by `env_file`. Setting both in the env file is therefore the reliable
way to configure a stack, and it is what a plain-HTTP development deployment needs.
