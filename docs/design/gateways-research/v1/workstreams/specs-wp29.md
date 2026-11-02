# WP29 — Gateway mock acceptance matrix

Build the reusable fixtures and the end-to-end test matrix defined in `../mocks.md`.  This is
the proof that every gateway namespace makes a real local network call through its intended
catalogue, policy, secret, and adapter path.

*Depends on:* WP28.  *Closes:* the C1 mock acceptance matrix.

## Files

WP29 owns test-only files and test-runner documentation:

- `api/oss/tests/pytest/unit/gateways/test_gateway_mock_catalogue.py`
- `api/oss/tests/pytest/integration/gateways/test_gateway_mock_catalogue.py`
- `api/oss/tests/pytest/acceptance/gateways/` mock-matrix fixtures and parametrised LLM/MCP
  acceptance tests
- `hosting/docker-compose/test.sh` only if a stable, explicit gateway matrix selection is needed
  in addition to `--api -a`

It must not add a production bypass, edit endpoint persistence, or create persistent local test
projects outside normal fixture cleanup.

## Matrix fixture

Create one declarative case object per row in `mocks.md`: namespace, provider or slug factory,
auth ownership, expected upstream profile, protocol operations, and whether tool policy applies.
Factories create project-owned mock credentials and custom rows only where the case requires
them.  They clean up through the project fixture.

The matrix must contain at least:

- `llm_builtin_agenta`, `llm_builtin_mock`, `llm_standard_mock`, `llm_custom_mock`;
- `mcp_builtin_agenta`, `mcp_builtin_composio`, `mcp_builtin_mock`, `mcp_standard_mock`,
  `mcp_custom_mock`.

Multiple providers within a namespace remain separate cases; collapsing them by asserting only
the namespace would miss provider dispatch and authentication regressions.

## Required assertions

Every applicable case proves a real call reaches its expected compose mock profile, and that a
missing token or missing permission is rejected before the upstream.  The suite additionally
proves the upstream accepts the injected expected credential and rejects the caller gateway
token as an upstream credential.

LLM cases cover non-streaming, streaming byte preservation, forced error, and timeout.  MCP
cases cover `tools/list`, `tools/call`, JSON-RPC error pass-through, forced timeout, and policy
allowlist refusal.  Standard/custom cases prove project isolation; builtin cases prove that no
project credential is required.  The local-Composio case proves brokered route/auth dispatch but
has no external dependency.

Run the same acceptance matrix against OSS dev and EE dev.  The test suite may skip with a
clear reason only when the compose stack is not present; it may not silently replace a missing
network test with an in-process adapter test.
