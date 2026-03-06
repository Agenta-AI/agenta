# Plan

## Phase 0 - Stabilize OSS Deployment Smoke

Phase 0 is no longer complete.

The suite moved forward in one important way. Runtime tests now have a project-scoped mock provider fixture, and the Playground flow reaches the real execution request with `mock/custom/gpt-6`. At the same time, the latest verification against preview exposed that the runtime still rejects the custom provider model as missing credentials. That keeps the Playground and Observability domains blocked.

What is complete in this phase:
1. Fixed unscoped Settings navigation. The fixture now uses the project-scoped route.
2. Added a readiness gate for Settings Models content. The helper waits for content hydration instead of clicking as soon as the shell appears.
3. Replaced the Prompts-table detour in Playground navigation with scoped app navigation through Overview.
4. Added the generic test-provider fixture with a working `mock` profile in the UI flow.
5. Added all required dimension tags (`coverage`, `path`, `lens`, `cost`, `license`) to every test.

What is still open in this phase:
1. Fix the runtime custom-provider credential path for `mock/custom/gpt-6`.
2. Revalidate chat Playground and Observability after the runtime fix.
3. Fix the remaining CI failures in Prompt Registry, Testsets, and Deployment.

## Phase 1 - Structural Cleanup (Next)

Milestones:
1. Rename `testsset` folder to `testset` with EE wrapper import updates.
2. Resolve API keys test: either unskip with proper setup or document why it stays skipped.
3. Fix playground direct URL blank content bug in the frontend.

Exit criteria:
- Folder names are consistent across OSS and EE suites.

## Phase 2 - CI Integration

Run all Playwright tests on every PR (not just smoke). The suite is fast (~3.5 min) and has no monetary cost, so there's no reason to defer tests to nightly. Catching breakages at PR time is cheaper than discovering them on a release branch.

Milestones:
1. Add CI workflow that runs the full OSS acceptance suite on every PR.
2. Add `test:smoke` and `test:acceptance` script aliases in `web/tests/package.json`.
3. Create ephemeral project per CI run in global-setup, delete in global-teardown. This avoids data accumulation from repeated runs against the same environment (apps, variants, traces pile up otherwise).
4. Make the workflow a required check after a stability window.

Exit criteria:
- Full acceptance suite runs on every PR and is green.
- Repeated runs against the same environment don't leave stale data.

### Test provider fixture update

The suite now uses a project scoped test provider fixture for runtime tests.

- Provider setup stays in the normal Playwright fixture layer, not in `global-setup`.
- The active provider is selected through `AGENTA_TEST_PROVIDER`, with `mock` as the default.
- The `mock` profile creates a custom provider named `mock` with model `gpt-6`.
- Runtime tests call the provider fixture lazily. Navigation only tests do not.
- The `openai` profile remains part of the fixture design, but it is not wired in this phase.
- The fixture is backend-authoritative for creation. It verifies the created secret through the vault API first, then treats the Settings table row as explicit UI coverage in the dedicated Settings spec.

## Phase 3 - Test Independence and Parallelization

Currently tests run sequentially because of a dependency chain: app creation -> playground (produces traces) -> observability (reads traces). To enable future parallelization:

Milestones:
1. Make each test domain self-sufficient: each domain should be able to create its own prerequisites via API rather than depending on a previous test's side effects.
2. Structure CI so parallelization is a config change (separate jobs per domain), not a test rewrite.
3. When parallelizing, each job creates its own project via `POST /api/projects` for full isolation.

Design constraints:
- OSS allows only one organization. Projects are unlimited within the workspace and almost everything (apps, variants, testsets, traces, deployments) is scoped to `project_id`.
- The first run against a fresh env needs account creation (org/workspace/project). Subsequent runs reuse the same account. Global-setup already handles sign-up vs sign-in detection.
- Project creation/deletion is available via API (`POST /api/projects`, `DELETE /api/projects/{id}`), so ephemeral projects are straightforward.
- Local Playwright verification must remain serial until the suite stops sharing `test-project.json` and default-project switching across invocations.

Data seeding strategy (two-phase global-setup):
- Phase 1: Browser auth -> `state.json` (already implemented).
- Phase 2: Extract session token from `state.json` -> seed data via direct HTTP calls.
- `global-teardown.ts` already demonstrates this pattern (extracts `sAccessToken` cookie from `state.json` to make API calls).
- This avoids needing a separate API key — the browser session cookie is reused.

Exit criteria:
- Any test domain can run independently in its own project.
- CI jobs can be split by domain without test code changes.

## Phase 4 - Mock LLM for Tests

Playground tests now select a custom mock model through the UI, but the runtime still rejects that model as missing provider credentials. This phase therefore has two sub-steps.

Step 1. Fix the current custom-provider runtime path.
- Confirm that the `Secret` token path receives the project-scoped custom provider secret.
- Fix the runtime secret resolution so `mock/custom/gpt-6` resolves its `api_key` and `api_base`.

Step 2. If the current path remains blocked, choose a simpler free runtime.
1. LiteLLM `mock/` prefix, if the existing stack supports it.
2. An Agenta-level mock or echo provider.
3. An external mock server only if the first two options are not viable.

Exit criteria:
- All Playground runtime tests are truly free and green.
- CI does not need OpenAI credentials.

## Phase 5 - Coverage Expansion

Based on analysis of 15 legacy BDD feature files covering the full manual QA suite.

### Test boundary: Playwright E2E vs API/SDK tests

Decision framework — a test belongs in Playwright if it **needs a browser to be meaningful** (clicks, navigation, visual feedback). Otherwise it belongs in the API/SDK test suite.

| Concern | API/SDK tests | Playwright tests |
|---|---|---|
| Data correctness (CRUD, trace shapes) | Create/read/update/delete via API, assert responses | N/A |
| UI rendering and interaction | N/A | Navigate, click, verify elements visible |
| Both | API seeds the data | Playwright verifies the UI shows it |

For data seeding in Playwright fixtures: use the two-phase global-setup pattern from Phase 3 (extract session token from `state.json`, make direct HTTP calls). No separate SDK or API key needed.

### Tier 1 — Core OSS workflows (highest priority)

| Domain | New tests | What's missing vs old BDD suite |
|---|---|---|
| Testset CRUD | 4-6 | Create from UI, CSV upload, edit rows/columns, delete, unsaved changes warning. Currently only "view" exists. |
| Variant management | 3-4 | Create new variant, remove variant, compare variants in overview, publish to deployment. |
| Playground depth | 4-5 | Load testset, switch variant, comparison mode, modify model/params. Depends on mock LLM (Phase 4). |
| App deletion | 1 | Delete app from UI. |

### Tier 2 — Important but complex (medium priority)

| Domain | New tests | Notes |
|---|---|---|
| Evaluations | 3-4 | Run evaluation with basic evaluator, validate requirements, view results, delete. Requires testset + variant as prerequisites. |
| Observability depth | 3-4 | Span hierarchy in drawer, time filter, search, pagination. Data comes from playground run side effects. |
| Custom models | 2-3 | Full provider CRUD in Settings, verify model appears in Playground dropdown. |
| Evaluator debugging | 2-3 | Load test case, run variant, run evaluator, view output. Complex UI. |

### Tier 3 — Lower priority for OSS

| Domain | Why lower |
|---|---|
| Human evaluation | Being deprecated/evolved. |
| LLM-as-a-judge depth | Subset of evaluations — automate after Tier 2. |
| BaseResponse SDK compat | SDK-version-specific. Better as integration test. |
| Custom workflows | Requires running local servers. Not practical for CI without infra. |

### Tier 4 — EE-only (skip for OSS)

| Domain | Why skip |
|---|---|
| Membership management | OSS has single user, no invitations. |
| Guest scopes / RBAC | No roles in OSS. |
| Bootstrap sequences | Nice-to-have, low breakage risk. |

### Target structure

```
web/oss/tests/playwright/acceptance/
├── smoke.spec.ts                    # Auth smoke
├── app/
│   ├── create.spec.ts               # existing
│   └── delete.spec.ts               # NEW (Tier 1)
├── playground/
│   ├── run-variant.spec.ts          # existing
│   ├── save-prompt.spec.ts          # existing
│   ├── load-testset.spec.ts         # NEW (Tier 1, needs mock LLM)
│   ├── comparison-mode.spec.ts      # NEW (Tier 1, needs mock LLM)
│   └── model-params.spec.ts         # NEW (Tier 1, needs mock LLM)
├── testset/                         # rename from testsset
│   ├── view-testset.spec.ts         # existing
│   ├── create-testset.spec.ts       # NEW (Tier 1)
│   ├── edit-testset.spec.ts         # NEW (Tier 1)
│   └── delete-testset.spec.ts       # NEW (Tier 1)
├── variant/                         # NEW domain (Tier 1)
│   ├── create-variant.spec.ts
│   ├── remove-variant.spec.ts
│   └── compare-variants.spec.ts
├── deployment/
│   └── deploy-variant.spec.ts       # existing
├── evaluation/                      # NEW domain (Tier 2)
│   ├── run-evaluation.spec.ts
│   ├── view-results.spec.ts
│   └── delete-evaluation.spec.ts
├── observability/
│   ├── observability.spec.ts        # existing
│   ├── span-hierarchy.spec.ts       # NEW (Tier 2)
│   └── filters.spec.ts             # NEW (Tier 2)
├── prompt-registry/                 # existing
├── settings/                        # existing
└── features/                        # BDD specs
```

Exit criteria:
- Tier 1 tests implemented and passing (~12-16 new tests).
- Core OSS subset has stable pass trend across 1 month of runs.
