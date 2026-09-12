# WP28 tasks — Generated development mock catalogue and provider routing

Depends on WP5–WP10.  Read `../mocks.md` before changing a catalogue, route, or mock process.

## Phase 1 — Development configuration

- [ ] Add `AGENTA_GATEWAYS_MOCKS_ENABLED`, default false, to `MockGatewaysConfig`.
- [ ] Add a development-only expected upstream credential/profile configuration.  Do not print
      the credential in startup logs, test output, or responses.
- [ ] Set the switch and shared value in OSS and EE development compose services and document
      them in each `env.*.dev.example` file.
- [ ] Unit-test default-disabled and explicit-enabled configuration.

## Phase 2 — Generated catalogue entries

- [ ] Add LLM builtin `agenta` and `mock` entries and LLM standard `mock`; ensure LLM standard
      mock appears only for a project with the mock provider credential.
- [ ] Add MCP builtin `mock`, preserve/verify builtin `agenta`, add local-only Composio fake
      resolution, and add MCP standard `mock`; make standard mock require its project credential.
- [ ] Ensure no generated entry is stored through either custom endpoint DAO and disabled mode
      returns no mock entries.
- [ ] Unit-test namespace, provider, route, credential owner, and disabled-mode behaviour for
      every generated entry.

## Phase 3 — Route and adapter wiring

- [ ] Add LLM builtin proxy routes using the same OpenAI operation set as standard/custom.
- [ ] Add MCP standard proxy routes using the same relay checks as builtin/custom.
- [ ] Keep the existing builtin MCP provider grammar: bare-slug forms for `agenta` and `mock`,
      integration/connection form for `composio`.
- [ ] Add protected mock modes and a safe profile marker; assert wrong/missing upstream
      credentials fail without echoing their values.
- [ ] Add router and adapter contract tests for the new families.

## Phase 4 — Static and compose verification

- [ ] Run the targeted gateway unit suite and formatting/lint checks.
- [ ] Start both OSS and EE dev compose stacks; confirm mocks are enabled only there and both
      `/health` endpoints are healthy.
- [ ] Record the exact test commands and results in this task list before handing off to WP29.
