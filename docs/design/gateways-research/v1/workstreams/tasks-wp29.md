# WP29 tasks — Gateway mock acceptance matrix

Depends on WP28 and the OSS/EE dev compose stack.

## Phase 1 — Shared test fixtures

- [ ] Define the declarative LLM and MCP mock-matrix cases from `../mocks.md`.
- [ ] Add fixtures for project-owned mock credentials, custom endpoints, and local Composio
      connections; use normal fixture cleanup and never write a credential to an env file.
- [ ] Add a mock-observation helper that asserts profile/credential behaviour without exposing
      credential values.

## Phase 2 — Unit and integration coverage

- [ ] Unit-test all generated catalogue entries and all new namespace/provider route parsing.
- [ ] Integration-test generated/custom merge, standard credential visibility, brokered local
      Composio resolution, and cross-project isolation.
- [ ] Confirm all tests remain valid with mocks disabled: generated mock entries are absent and
      no test accidentally relies on a production-visible mock provider.

## Phase 3 — Acceptance coverage

- [ ] Add the four LLM cases: builtin Agenta, builtin mock, standard mock, custom mock.
- [ ] Add the five MCP cases: builtin Agenta, builtin Composio fake, builtin mock, standard
      mock, custom mock.
- [ ] Add shared unauthorized, wrong-upstream-credential, forced-error, and timeout assertions.
- [ ] Add LLM streaming byte-preservation assertions and MCP list/call/allowlist assertions.
- [ ] Run the matrix through `hosting/docker-compose/test.sh` against OSS dev and EE dev.

## Phase 4 — Acceptance sign-off

- [ ] Record the OSS and EE commands, selected compose environment, result counts, and any
      expected skips.
- [ ] Verify no test contacted a non-local address and no secret value appeared in output.
- [ ] Update C1's checklist in `plan.md` to mark the full matrix complete only after both stacks
      pass.
