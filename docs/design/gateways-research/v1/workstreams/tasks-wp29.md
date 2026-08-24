# WP29 tasks — Gateway mock acceptance matrix

Depends on WP28 and the OSS/EE dev compose stack.

## Completed — shared test fixtures

- [x] Define the declarative LLM and MCP mock-matrix cases from `../mocks.md`.
- [x] Add fixtures for project-owned mock credentials and custom endpoints; use normal fixture
      cleanup and never write a credential to an env file. Composio has no mock route.
- [x] Add a mock-observation helper that asserts profile/credential behaviour without exposing
      credential values.

## Completed — unit and integration coverage

- [x] Unit-test generated catalogue entries and namespace/provider route parsing.
- [x] Integration-test generated/custom merge, standard credential visibility and cross-project
      isolation.
- [x] Confirm all tests remain valid with mocks disabled: generated mock entries are absent and
      no test accidentally relies on a production-visible mock provider.

## Completed — acceptance coverage

- [x] Add the four LLM cases: builtin Agenta, builtin mock, standard mock, custom mock.
- [x] Add the four MCP cases: builtin Agenta, builtin mock, standard mock, custom mock.
- [x] Add shared unauthorized, wrong-upstream-credential, forced-error, and timeout assertions.
- [x] Add LLM streaming byte-preservation assertions and MCP list/call/allowlist assertions.
- [x] Run the matrix through `hosting/docker-compose/test.sh` against OSS dev and EE dev.

## Completed — acceptance sign-off

- [x] Record the OSS/EE command and evidence in `../mocks.md` (EE: 24 passed on 2026-08-24).
- [x] Verify no test contacted a non-local address and no secret value appeared in output.
- [x] Update the checkpoint record after both stacks pass.
