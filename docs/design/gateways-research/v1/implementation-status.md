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

Re-measured on 2026-09-13 after the review repairs, on the same stack.

| Suite | Result |
| --- | --- |
| API unit, `oss/tests/pytest/unit/gateways/` | 838 passed |
| API unit, `oss/tests/pytest/unit/secrets/` | 198 passed |
| API integration, `oss/tests/pytest/integration/gateways/` | 28 passed |
| API acceptance, `oss/tests/pytest/acceptance/gateways/` | 40 passed |
| SDK acceptance | 126 passed, 2 skipped |
| Services integration | 14 passed |
| Services acceptance, `test_agent_gateway_route.py` | 27 passed |
| Runner unit | 3306 passed |
| Runner acceptance | 23 passed |

The counts grew because the repairs carry their own regression cases. The API gateway unit suite
was 654 before the review and is 838 after it.

`test_agent_harness_calls_echo_through_each_mock_mcp_gateway_route` covers every
LLM-namespace and MCP-namespace pair on every harness: nine Pi, nine Codex, nine Claude. The nine
Claude cells failed on this date and were fixed the same day by the mock MCP handshake change
recorded in OR23.

### The dashboard product path, re-measured 2026-09-13

The manual procedure in `qa.md` was re-run on 2026-09-13 against the same stack (compose project
`agenta-ee-dev-gateways`, EE, development mode), in a disposable project, through an isolated
browser. **Pi and Claude Code complete both the LLM leg and the MCP leg entirely from the
dashboard, with no API call standing in for any step.** Per harness:

| Harness | Gateway LLM leg | Gateway MCP leg | Typed refusal |
| --- | --- | --- | --- |
| Pi | `POST /gateways/llms/custom/<slug>/v1/chat/completions` returns `200` and the turn completes, on a provider created through the dashboard alone | the `tools/call` reaches the mock and the turn ends with `mock MCP echo: <marker>` | carries `failure_code` and `errorDetail` (OR28, measured on the agent invoke plane) |
| Claude Code | `POST /gateways/llms/custom/<slug>/v1/messages?beta=true` returns `200` and the turn completes, on a provider declaring the `anthropic` protocol | same, with the server named `mock-mcp`, which the Anthropic Messages path requires | carries `failure_code` and `errorDetail` (OR28, same plane) |
| Codex | offered only on an OpenAI-compatible endpoint, and still refuses a gateway model id nobody declared to it; the config pin is runner and SDK work (OR31d) | not reached | carries `failure_code` and `errorDetail`, and a refused run now fails rather than reporting success (OR28) |

Endpoint registration, protocol filtering and MCP routing were measured directly. Saving a provider
registers one endpoint row per provider, read back at `POST /gateways/llms/endpoints/query`, with a
slug matching the secret, a `provider_key` following the declared protocol, and an allowlist
carrying both the bare and the qualified spelling of every model. Editing the protocol updates that
row in place, same id and slug, with no duplicate; deleting the provider removes it. The
`Harnesses` control disables Claude Code with "Incompatible with this provider" on an
OpenAI-compatible endpoint and enables it on an Anthropic one, and does the reverse for Pi and
Codex.

Both MCP cells need a precondition that is not visible in the product, now recorded in `qa.md` step
4: the prompt must carry an acceptance marker matching `MCP-ACCEPTANCE-[A-Za-z0-9_-]+`, and on the
Anthropic Messages path the server must be named `mock-mcp`.

The dashboard findings are closed, and the closed record in `open-reviews.md` carries their
mechanisms and tests: **OR26** (the vault registers and deregisters the LLM endpoint alongside the
`custom_provider` secret, server-side rather than in the browser), **OR31a** (the provider form
declares its protocol and the harness control filters on it), **OR31b** (Pi declares the
`mcp.user_servers` capability, so the panel renders the row) and **OR31c** (`Add MCP server`
registers the custom MCP endpoint that carries its URL). **OR77** closes the OAuth half of that same
form, which sat under OR31's notes as a placeholder until it was tracked on its own. **OR31d** is
reclassified: the Codex
refusal is a missing model declaration in the SDK's Codex settings writer and the runner, owned
elsewhere and not yet proven by a run. **OR28** and **OR32** are closed on the runner and
agent-service side. Two defects found in passing are closed, and neither belonged to this branch.
**OR34** (the AI providers drawer closing itself) is a development-deployment artefact: the mobile
app's hot-reload websocket fails through Traefik and the development client reloads the page every
50 to 60 seconds, discarding every open form. **OR35** (no create control on the API keys page)
reproduces on `main` and is tracked as issue #6803.

### The review record, as of 2026-09-15

The credential-boundary review recorded forty-one findings, OR36 to OR76. Six of them came from
reviewing the repairs rather than the original code: OR70 to OR75, all six closed. OR76 came from
closing OR49: the usage repair meters every stream that reports usage, and one route still does not
report it. OR77 came from the playground surface rather than the credential boundary, and it is
closed. The record therefore runs OR36 to OR78, forty-three findings. One of them, OR69, was withdrawn
on 2026-09-13, so it counts as neither open nor closed and forty-two stand. Thirty-five are fixed
and closed, and seven are open: OR63, OR65 to OR68, OR76 and OR78.

OR78 is the odd one: a client registration is keyed on the issuer alone, so a deployment that
changes its public address silently reuses a registration the authorization server will refuse. It
has not bitten, because no registration is stored anywhere yet. It was found while proving that the
Linear failure was something else.

OR77 is the product-reach entry. The agent config's MCP server form offered OAuth as a disabled
option behind a `Soon` badge, so only the settings drawer could register an OAuth server and the
playground could not express one. OAuth is selectable there now, and the row authorizes in place
through the same discover, scope dialog, popup and connected-message flow the settings page runs.
OAuth stays a registration choice rather than a stored credential: the SDK's `MCPCredentials` union
accepts only `none` and `header_secret_refs` under `extra="forbid"`, so registration sends
`auth_mode: "oauth"`, the commit normalizes credentials back to `none`, and the form reads the OAuth
state off the endpoint row. The mobile app needs no change, because it renders the same control from
`@agenta/entity-ui`.

No P0 and no P1 remain. OR45 was the last P0 and it is closed: the credential issuer at
`POST /gateways/mcps/credentials/agenta` requires the permission its credential is spent under, and
bounds the tool list it signs instead of signing what the caller asked for. OR75 was the last P1 and
it is closed: all three MCP relays now scan the upstream's header block and buffered body for the
credential they injected, and refuse with the envelope the LLM plane uses.

The highest severity open is P2, and OR76 is the only finding carrying one: an OpenAI Chat
Completions stream records no usage unless the caller itself sent `stream_options.include_usage`,
while Responses and Messages streams meter on every call because both report usage unasked. Nothing
prices usage yet, so this is a gap the metering work must settle rather than a defect with a
consequence today. The other five open entries are debt, carry no severity, and are also tracked as
CU15 to CU19 in `cleanups.md`. `open-reviews.md` carries the mechanism, the fix and the tests for
each. The suites in the table above stayed green through every one of these defects, which is what
OR65 records.

### Deployment flags

Three named environment variables now gate gateway behaviour, all three default off.

| Variable | Read by | Effect |
| --- | --- | --- |
| `AGENTA_GATEWAYS_MOCKS_ENABLED` | the API process, `api/oss/src/utils/env.py` | generates the development-only mock catalogue entries and routes |
| `AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED` | the SDK in the `services` container and the runner, `run-plan.ts` | permits a gateway bearer over plain HTTP to a routable host (OR24) |
| `AGENTA_GATEWAYS_INSECURE_EGRESS_ALLOWED` | the API process, `api/oss/src/utils/env.py` | off by default, so the shared egress module resolves, range-checks and pins every outbound gateway call and requires https. Setting it lifts those checks for the gateway alone; webhooks keep their own flag, `AGENTA_INSECURE_EGRESS_ALLOWED`, and their own default (OR40, OR64) |

In the OSS and EE development compose files `AGENTA_GATEWAYS_MOCKS_ENABLED` is hardcoded on the
`api` service and on the two mock gateway services, and
`AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED` is declared on `runner` only. The `services` container,
which runs the SDK resolver, receives the second variable only through the deployment env file,
which every service loads by `env_file`. Setting both in the env file is therefore the reliable
way to configure a stack, and it is what a plain-HTTP development deployment needs.
