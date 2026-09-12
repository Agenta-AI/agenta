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

## Verified state as of 2026-09-12

Measured on the branch squashed onto `main`, deployed as an EE development stack, with
`hosting/docker-compose/test.sh --ee --dev`.

### Automated suites

| Suite | Result |
| --- | --- |
| API acceptance, `oss/tests/pytest/acceptance/gateways/` | 40 passed |
| API acceptance, the mock matrix alone | 21 passed |
| API integration, `oss/tests/pytest/integration/gateways/` | 22 passed |
| SDK acceptance, `test_mcp_gateway_routing_acceptance.py` | 2 passed |
| Services integration, `test_gateway_http.py` | 11 passed |
| Runner acceptance, `gateway-credentials-no-provider-secret.test.ts` | 23 passed |
| Services acceptance, `test_agent_gateway_route.py` | 18 passed, 9 failed |

The nine failures are every Claude cell of
`test_agent_harness_calls_echo_through_each_mock_mcp_gateway_route`, one per LLM-namespace and
MCP-namespace pair, each returning a tool result with no echo marker. Every Pi and every Codex
cell passes, which narrows OR23 to Claude Code alone on the automated path.

### The dashboard product path

The manual procedure in `qa.md` was run the same day against the same stack, in a disposable
project, through an isolated browser. **The product path from the dashboard does not complete for
any harness.** Per harness:

| Harness | Gateway LLM leg | Gateway MCP leg | Typed refusal |
| --- | --- | --- | --- |
| Pi | reaches the gateway and returns `200`, on a custom endpoint created through the API | not executable: the configuration panel has no `MCP servers` row for Pi | partial: `code` and message appear only inside the harness session recap |
| Claude Code | refused at `422`, `provider 'openai' is not supported by harness 'claude'` | not proven: the MCP request went out as `custom/<name>` and returned `404` | nothing reaches the user |
| Codex | refused inside the harness: the gateway model key is not in its fixed model catalogue | not reached | partial: an error card with the human message, no `code` |

The blockers are recorded as OR26 through OR31 in `open-reviews.md`. OR26 is the one that gates
the rest: the AI providers page writes a `custom_provider` secret and never creates the gateway
endpoint, so every run resolves against an endpoint that does not exist. OR27 is why the resulting
refusal reaches the user as a generic 500 with no `code`.

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
