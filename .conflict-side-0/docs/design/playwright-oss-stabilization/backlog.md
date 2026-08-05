# Backlog

## Completed

1. ~~Stabilize project-scoped Settings navigation for the mock provider flow~~
2. ~~Replace direct URL navigation with sidebar navigation in all tests~~
3. ~~Fix API response interception race conditions~~
4. ~~Add graceful skip for testset test when no testsets exist~~
5. ~~Add BDD feature specs in Gherkin format~~
6. ~~Remove destructive account teardown from Playwright cleanup~~
7. ~~Harden auth setup with explicit mode selection (auto/password/otp)~~
8. ~~Add all required dimension tags (`coverage`, `path`, `lens`, `cost`, `license`) to every test~~
9. ~~Analyze 15 legacy BDD feature files and produce prioritized coverage plan~~
10. ~~Document E2E vs API/SDK test boundary and data seeding strategy~~
11. ~~Add a project scoped mock provider fixture for runtime tests~~
12. ~~Move Playground runtime tests from paid provider assumptions to the mock provider path~~
13. ~~Replace Prompts-table Playground navigation with scoped app navigation through Overview~~
14. ~~Document the Settings hydration and remount issue that makes early clicks flaky~~

## P1 (Structural cleanup — Phase 1)

0. Fix the active harness regressions on this branch:
   - Playground run listener order.
   - Cached-auth fallback skipping ephemeral-project creation.
   - Doc claims that no longer match the real pass/skip state.
1. Rename `testsset` folder to `testset` (requires updating EE wrapper imports).
2. Unskip or clearly document API keys test with rationale for what setup it needs.
3. Fix playground direct URL blank content (frontend bug, not test issue).
4. Wire the `openai` test provider profile into the generic fixture abstraction.
5. Fix the runtime custom-provider credential path so `mock/custom/gpt-6` can execute, not just render in Playground.
6. Update Prompt Registry assertions to match the current page contract.
7. Update the Testsets test to wait for the current request contract.
8. Remove the deployment test assumption that at least one variant already exists.

## P2 (CI integration — Phase 2)

1. Add CI workflow running full acceptance suite on every PR.
2. Add `test:smoke` and `test:acceptance` script aliases in `web/tests/package.json`.
3. Create ephemeral project per CI run (global-setup creates via `POST /api/projects`, global-teardown deletes via `DELETE /api/projects/{id}`) to prevent data accumulation from repeated runs.
4. Make the workflow a required check after stability window.

## P3 (Test independence — Phase 3)

1. Implement two-phase global-setup: Phase 1 browser auth -> `state.json`, Phase 2 extract token -> seed data via direct HTTP.
2. Make each test domain self-sufficient — create own prerequisites via API instead of depending on prior test side effects.
3. Structure CI so domain jobs can run in parallel, each in its own ephemeral project.
4. Remove the shared `test-project.json` coupling so local verification can run more than one Playwright invocation safely.

## P4 (Mock LLM — Phase 4)

1. Fix execution support for the custom mock provider in the runtime path.
2. Investigate LiteLLM `mock/` prefix for dummy LLM responses if the current custom-provider path remains blocked.
3. If not viable, implement an Agenta-level mock or echo provider.
4. Convert playground tests from paid-provider assumptions to a fully working free path.

## P5 (Coverage expansion — Phase 5, Tier 1)

1. **Testset CRUD**: Create from UI, CSV upload, edit rows/columns, delete testset.
2. **Variant management**: Create variant, remove variant, compare variants in overview.
3. **Playground depth**: Load testset in playground, comparison mode, model/params changes (blocked on mock LLM).
4. **App deletion**: Delete app from UI.

## P6 (Coverage expansion — Phase 5, Tier 2)

1. **Evaluations**: Run with basic evaluator, validate requirements, view results, delete.
2. **Observability depth**: Span hierarchy, time filter, search, pagination.
3. **Custom models**: Full provider CRUD, verify model in playground dropdown.
4. **Evaluator debugging**: Load test case, run variant, run evaluator in debug view.

## Out of scope for OSS

- Membership management (EE-only, no invitations in OSS)
- Guest scopes / RBAC (EE-only, no roles in OSS)
- Human evaluation (being deprecated)
- Custom workflows (requires local server infra)
- BaseResponse SDK compat (better as integration test)
