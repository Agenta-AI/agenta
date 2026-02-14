# Web Testing — Interface Specification

The Web interface is the Next.js frontend consumed by users via browser. This document describes the current test state, target state, and conventions specific to the Web.

For architectural layer definitions, see [testing.boundaries.specs.md](testing.boundaries.specs.md).
For dimension/marker taxonomy, see [testing.dimensions.specs.md](testing.dimensions.specs.md).
For folder layout, see [testing.structure.specs.md](testing.structure.specs.md).
For fixtures and utilities, see [testing.fixtures.specs.md](testing.fixtures.specs.md).

---

## Current state

### E2E tests (Playwright)

**Runner:** `web/tests/` — Playwright v1.57.0

**Configuration (`web/tests/playwright.config.ts`):**
- Test directory: dynamically set via `PROJECT_DIRECTORY` env var
- Single worker, no parallelization
- Retries: 2 in CI, configurable locally
- Timeouts: 60s per test, 60s for expectations
- Artifacts: trace on first retry, screenshots only on failure, video retained on failure
- Storage state: `state.json` for session persistence
- Reporter: HTML
- Browser: Desktop Chrome

**Test organization (feature-numbered):**

| Number | Area | OSS | EE |
|--------|------|-----|-----|
| 1 | Settings (API keys, model hub) | Yes | Yes |
| 2 | App creation | Yes | Yes |
| 3 | Playground (run variant) | Yes | Yes |
| 4 | Prompt registry | Yes | Yes |
| 5 | Testset management | Yes | Yes |
| 6 | Auto-evaluation | No | Yes |
| 7 | Observability | Yes | Yes |
| 8 | Deployment | Yes | Yes |
| 9 | Human annotation | No | Yes |

**Global setup/teardown:**
- Located in `web/tests/playwright/global-setup` and `global-teardown`
- Requires testmail integration for email-based authentication

**Tag system (`web/tests/playwright/config/testTags.ts`):**
See [testing.dimensions.specs.md](testing.dimensions.specs.md) for the full taxonomy. Tags use the `@dimension:value` syntax (e.g., `@coverage:smoke`, `@path:happy`).

### Data layer integration tests

**Location:** `web/oss/tests/datalayer/`

TypeScript-based tests that exercise Jotai atoms + TanStack Query against a live API:
- `test-apps.ts` — Application state management
- `test-observability.ts` — Observability state management

Executed via `tsx` for TypeScript support.

### Component unit tests

**Location:** Colocated `__tests__/` directories near source code.

**Example:** `web/oss/src/components/Playground/state/atoms/__tests__/core.test.ts`
- Tests Jotai atoms using `createStore()` for isolated store instances
- Tests `selectedVariantsAtom`, `viewTypeAtom`, mutation atoms
- No DOM rendering, no API calls — pure state logic testing

### Scripts (npm)

**From `web/tests/package.json`:**
- `pnpm test:e2e` — Run all E2E tests
- `pnpm test:e2e:ui` — Run with Playwright UI mode
- `pnpm test:e2e:debug` — Debug mode

**From `web/package.json`:**
- `pnpm test:datalayer` — All data layer tests
- `pnpm test:apps` — App tests
- `pnpm test:observability` — Observability tests
- Plus: `test:revision-centric`, `test:environments`, `test:deployments`, `test:orgs`, `test:profile`, `test:workspace`, `test:project`, `test:newPlayground`

---

## Boundaries applied to Web

The Web has a different architecture than the API. The relevant boundaries are:

| Boundary | Web equivalent | Status |
|----------|---------------|--------|
| Utils/helpers (pure unit) | Pure utility functions, formatters, validators | Minimal |
| Core/business logic | Jotai atoms, derived selectors, mutation atoms | Partially exists (Playground atoms) |
| Adapter unit | N/A (browser is the adapter) | N/A |
| E2E/system | Playwright browser tests + data layer integration tests | Exists |

**What to test at the component unit level:**
- Jotai atoms with `createStore()` — test state transitions in isolation
- Derived atoms (selectors) — test computation logic
- Mutation atoms (write-only atoms) — test side effects and state updates
- Pure utility functions — formatters, validators, parsers

**What NOT to test at the component unit level:**
- DOM rendering or component markup (use E2E for this)
- API calls (use data layer integration tests for this)
- Browser-specific behavior (use Playwright for this)

---

## E2E test types

Playwright E2E tests fall into two categories:

1. **UI tests** — Full browser interaction: clicking, typing, navigating, asserting on rendered pages. These validate user-facing flows end-to-end.
2. **Internal API tests** — Playwright-driven tests that exercise the frontend's data fetching and API integration without necessarily asserting on UI rendering. Useful for validating data layer behavior in a real browser context.

Both types use the same Playwright runner, fixtures, and tag system.

---

## Target state

### E2E (Playwright)

The existing feature-numbered suites continue. Both UI and internal API test types are organized in the same numbered structure.

### Unit tests

**Current limitation:** React components in this codebase do not use dependency injection. Without DI, it is not practical to unit-test components in isolation (mocking props/context becomes fragile and couples tests to implementation).

**Phase 1 (now):** Focus on what can be tested without DI:
1. **Utils** — Pure utility functions in `lib/helpers/`, formatters, validators. No DI needed.
2. **Atom/store tests** — Jotai atoms with `createStore()`. Each major feature (playground, evaluations, observability, testsets) should have `__tests__/` directories.
3. **Molecule/bridge pattern tests** — Test the molecule and bridge patterns from `@agenta/entities` using their imperative APIs (`molecule.get.*`, `molecule.set.*`).
4. **Package utility tests** — Test utilities exported from `@agenta/shared/utils`, `@agenta/ui`, and other workspace packages.

**Phase 2 (when DI is available):** Once components adopt dependency injection (via providers, context, or atom-based injection):
- Component-level unit tests with mocked dependencies
- Test boundary layers analogous to API (state management, data fetching, rendering)

---

## E2E guide references

The following in-tree guides provide detailed procedural documentation for writing and maintaining Playwright E2E tests. This spec does not duplicate their content.

| Guide | Location | What it covers |
|-------|----------|---------------|
| E2E Test Generation | `web/tests/guides/E2E_TEST_GENERATION_GUIDE.md` | Converting Playwright codegen output to production tests |
| E2E Test Organization | `web/tests/guides/E2E_TEST_ORGANIZATION_GUIDE.md` | Folder structure, naming, OSS/EE sharing |
| Utilities and Fixtures | `web/tests/guides/UTILITIES_AND_FIXTURES_GUIDE.md` | apiHelpers, uiHelpers, selector patterns |
| Recording Guide | `web/tests/guides/RECORDING_GUIDE.md` | Using Playwright codegen for recording |

---

## Conventions

### File naming
- `*.spec.ts` — Playwright E2E tests
- `*.test.ts` — Component unit tests
- `__tests__/` — Colocated test directories next to source

### Fixture imports
E2E tests use a layered fixture system:
- `base.fixture` — API helpers, UI helpers, LLM key settings
- `user.fixture` — Authentication flows, email/password account creation
- `session.fixture` — Browser session management

### Tag application
Every E2E test should include at minimum `@coverage:` and `@path:` tags:
```typescript
test("create app @coverage:smoke @path:happy", async ({ page }) => {
  // ...
})
```

---

## Environment

| Variable | Required for | Purpose |
|----------|-------------|---------|
| `TESTMAIL_API_KEY` | E2E tests | Email-based auth flow testing |
| `TESTMAIL_NAMESPACE` | E2E tests | Testmail namespace |
| `AGENTA_OSS_OWNER_PASSWORD` | E2E tests (OSS only) | OSS owner account password |
| `AGENTA_OSS_OWNER_EMAIL` | E2E tests (OSS, optional) | OSS owner email |
| `AGENTA_API_URL` | E2E teardown, API flows | API base URL |
| `NEXT_PUBLIC_AGENTA_API_URL` | Data layer tests | API URL for frontend |
