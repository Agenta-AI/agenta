# Gateway mocks

The local development stack must exercise every gateway namespace without calling a
third-party service. Generated mock providers use in-process adapters. The two compose
services remain test doubles for configured custom endpoints:

- `mock-llm-gateway` speaks the OpenAI-compatible protocol on the Docker network.
- `mock-mcp-gateway` speaks MCP Streamable HTTP on the Docker network.

Their in-process adapters and deployable forms share the same control behaviour. Unit and
generated-catalogue acceptance tests use the adapters; custom-endpoint acceptance tests use
the compose services over real sockets.

This document defines the catalogue entries that make the mocks reachable through every
gateway namespace.  They are generated in development only.  Production neither lists them
nor accepts their routes.

## Development matrix

| Plane | Namespace | Generated development entry | Upstream | What it proves |
| --- | --- | --- | --- | --- |
| LLM | `builtin` | `agenta` | LLM mock | The Agenta-supplied-key model path; its catalogue will later include Gemini and Bedrock models. |
| LLM | `builtin` | `mock` | LLM mock | A deliberately local builtin provider, including builtin route and policy selection. |
| LLM | `standard` | `mock` | LLM mock | Generated standard-provider lookup and project-owned credential resolution. |
| LLM | `custom` | test-created endpoint | LLM mock | Stored endpoint lookup, custom model restrictions, and direct-secret injection. |
| MCP | `builtin` | `agenta` | MCP mock | Agenta-owned builtin tools. |
| MCP | `builtin` | `mock` | MCP mock | A deliberately local builtin provider, independent of the Agenta provider grammar. |
| MCP | `standard` | `mock` | MCP mock | Generated standard-target lookup and project-owned credential resolution. |
| MCP | `custom` | test-created endpoint | MCP mock | Stored server lookup, direct auth, and tool policy. |

`agenta` and `mock` are separate builtin providers.  A mock implementation behind an
`agenta` endpoint is useful, but it does not test provider dispatch for `builtin/mock` and must
not be treated as equivalent.

There are six namespace combinations, not nine: LLM and MCP each have `builtin`, `standard`,
and `custom`.  Some combinations have more than one development provider so their provider
grammar and authentication mode are independently exercised.

## Routes and generated entries

The route families are part of the gateway contract.  The development entries use the same
families as future real entries; no test-only shortcut route is permitted.

| Family | Development route shape |
| --- | --- |
| LLM builtin | `/gateways/llms/builtin/{provider}/v1/{operation}`; providers `agenta` and `mock` |
| LLM standard | `/gateways/llms/standard/mock/v1/{operation}` |
| LLM custom | `/gateways/llms/custom/{slug}/v1/{operation}` |
| MCP builtin Agenta or mock | `/gateways/mcps/builtin/{provider}/{slug}` |
| MCP standard | `/gateways/mcps/standard/mock` |
| MCP custom | `/gateways/mcps/custom/{slug}` |

LLM builtin `agenta` initially exposes only mock-backed models.  It is the catalogue and
credential-owner boundary that matters here; adding Agenta-provided Gemini and Bedrock models
later extends this provider rather than inventing another namespace.  `builtin/mock` stays
available as the deterministic local control case.

The standard entries are generated, never persisted. The custom entries are created through
the existing endpoint APIs inside each test and deleted with the test project. Builtin entries
are generated, never persisted. Composio remains a real brokered integration: the mock
catalogue never invents a Composio connection, route, or credential.

## Configuration and isolation

Introduce one explicit development switch, `AGENTA_GATEWAYS_MOCKS_ENABLED`.  It defaults to
false and is set to true only by the OSS and EE development compose profiles. It controls the
generated mock entries. The two mock service URLs remain configuration values for custom
endpoint tests:

```text
AGENTA_MOCK_LLM_GATEWAY_URL=http://mock-llm-gateway:9091
AGENTA_MOCK_MCP_GATEWAY_URL=http://mock-mcp-gateway:9092
```

The compose API service and mock services also share a non-secret test token through an
environment variable dedicated to development. The custom mock upstream validates that it
receives the expected injected credential but never returns the credential in a response, log,
or assertion message.

Project-owned mock credentials are created by test fixtures for standard and custom cases.
They live only for the test project and are removed in fixture cleanup.  Builtin Agenta and mock
entries use platform-owned development credentials or `NONE`, according to the provider's
declared auth scheme; they never reuse a project credential.

## Mock behaviour

The current shared controls remain the base contract:

- LLM: `mock/echo`, `mock/error`, `mock/slow-{seconds}`, and streamed responses.
- MCP: `tools/list`, `tools/call` for `echo`, `fail`, and `slow`, notifications, and protocol
  errors.

The deployable services need two observable-but-safe assertions for acceptance:

1. a protected mode that rejects a missing or wrong injected upstream credential; and
2. a response marker for a configured custom mock server,
   never the credential value.

Forced error and slow modes must be usable on each path so timeout and error mapping are not
only tested on custom endpoints.

## Test layers

| Layer | Scope | Runs against |
| --- | --- | --- |
| Unit | Catalogue generation, namespace parsing, provider selection, auth strategy, policy-before-upstream, and mock adapter contract | In-process adapters and fakes |
| Integration | Custom rows, generated-entry merge, project credential/connection resolution, and isolation between projects | API plus local Postgres |
| Acceptance | A real authenticated HTTP/MCP call for every row in the development matrix, plus streaming, errors, timeouts, auth injection, and policy refusals | Full OSS and EE dev compose stacks |

Acceptance is parameterised by namespace/provider rather than copied into unrelated tests.  A
case declares its endpoint factory, auth mode, and supported
operations.  The shared assertions then cover, where the protocol supports them:

- unauthenticated and unauthorized calls fail before the mock is reached;
- the generated mock endpoints resolve to the in-process mock adapter;
- a custom mock endpoint reaches its configured local mock server;
- the custom mock upstream accepts only its configured upstream credential;
- standard and custom paths use a project-owned credential, while builtin paths do not;
- LLM streaming is byte-for-byte and non-streaming responses preserve status and body;
- MCP `tools/list`, `tools/call`, tool allowlists, and JSON-RPC errors preserve their contract;
- forced upstream errors and timeouts map to the gateway error contract; and
- an entry visible in one project is not usable from another project.

The full matrix runs in both `--oss --dev` and `--ee --dev`.  It is deliberately not gated on an
EE entitlement: these are development test doubles for shared gateway behaviour.

**Host test contract.** The compose API and mock containers receive
`AGENTA_GATEWAYS_MOCKS_ENABLED=true` in development. `test.sh` exports that same transient,
development-only setting and its non-secret mock token before starting host pytest; it never
persists either value to a worktree env file. Without this parity, pytest would skip the matrix
even while the containers correctly expose its routes.

**Recorded EE evidence (2026-08-24).**
`bash hosting/docker-compose/test.sh --ee --dev --api -a --
oss/tests/pytest/acceptance/gateways/test_gateway_mock_matrix_acceptance.py` completed with
**24 passed**. That is the eight-row development matrix: each row proves its authenticated route,
while the shared cases prove unauthenticated refusal, LLM streaming, and MCP tool calls.

## Work packages

- **WP28 — Generated development mock catalogue and provider routing** implements the dev-only
  entries and all six route families.
- **WP29 — Gateway mock acceptance matrix** implements the fixtures and the unit, integration,
  and compose-acceptance coverage described above.
- **WP33 — Mock MCP harness acceptance for Claude Code and Codex** proves that those harnesses
  discover and call the gateway-backed mock MCP tools in full-stack runs.
- **WP34 — Pi external mock MCP delivery and acceptance** replaces Pi's current author-MCP
  refusal with native external-MCP delivery, then proves the same mock routes.

WP29 depends on WP28; WP33 depends on both; WP34 depends on WP33's shared fixtures. Neither
package changes the two existing mock processes' public
protocols except for the safe credential/profile observability required here.
