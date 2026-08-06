# Agenta E2E Test Organization & Structure Guide

## Purpose
This guide describes the recommended folder structure, naming conventions, and organizational patterns for new E2E test implementations in Agenta Cloud. It is based on established best practices and real examples using project utilities and fixtures. All new tests should follow these conventions for consistency and maintainability.

---

## Ideal E2E Test Folder Structure

```
web/
├── ee/
│   └── tests/
│       ├── app/
│       │   └── create.spec.ts                # EE-specific app creation E2E test
│       └── prompt-registry/
│           └── prompt-registry-flow.spec.ts  # EE-specific prompt registry E2E test
├── oss/
│   └── tests/
│       ├── app/
│       │   ├── create.spec.ts                # OSS-specific app creation E2E test
│       │   ├── index.ts                      # Exports shared test logic for app tests
│       │   ├── test.ts                       # OSS-specific fixtures and test utils
│       │   └── types.ts                      # OSS-specific type definitions
│       └── ...                               # Additional OSS-specific E2E specs
├── tests/
│   ├── guides/                               # E2E documentation and guides
│   ├── tests/                                # Shared Playwright fixtures/utilities ONLY (not for test specs)
│   │   ├── fixtures/
│   │   │   ├── base.fixture/                 # General-purpose helpers (apiHelpers, uiHelpers, etc.)
│   │   │   ├── user.fixture/                 # Auth/onboarding helpers
│   │   │   ├── session.fixture/              # (If present) Session-related helpers
│   │   │   └── ...                           # Other fixture folders as needed
│   │   └── ...
│   └── ...
└── ...
```

### Key Practices

- **Place E2E test specs (`*.spec.ts`) in the relevant product/package feature folder** (e.g., `web/ee/tests/app/`, `web/oss/tests/app/`).
- **Organize by feature or domain:** Use subfolders (like `app/`, `prompt-registry/`) to group tests by product area or workflow.
- **Share test logic via imports:** Product-specific tests can import shared logic from OSS (e.g., `import tests, {test, tags} from "@agenta/oss/tests/app"` in EE tests).
- **Keep shared Playwright fixtures/utilities in `web/tests/tests/fixtures/`** for maximum reuse and consistency.
- **Store all E2E documentation and best practices in `web/tests/guides/`.**
- **Follow naming conventions:** Use descriptive, kebab-case names for test files (e.g., `user-login.spec.ts`).
- **Never duplicate logic:** Always extend or import from shared helpers/utilities.

### Example: EE Test Importing OSS Logic

```typescript
// web/ee/tests/app/create.spec.ts
import tests, {test, tags} from "@agenta/oss/tests/app"

test.describe(`EE App Creation Flow ${tags}`, () => {
    tests()
})
```

### Why This Structure?
- **Separation of concerns:** Product/package tests live with the code they validate; shared helpers/utilities are centralized.
- **Scalability:** Each product/package can own its tests, but benefit from shared logic.
- **Clarity:** Engineers know where to find feature tests and shared helpers.

---

## Selector Guidance

Choose selectors for robustness and clarity in the context of your test:

- Use **role-based selectors** (e.g., `getByRole`) for static ARIA elements such as dialogs, buttons, and headings.
- Use **structural selectors** (e.g., `locator("tr", {hasText: ...})`) for dynamic lists or tables, often combining with text matching for specificity.
- Use **text-based selectors** (e.g., `getByText`) when validating the presence or content of dynamic/user-generated text.
- Prefer **`data-testid`** only if the element is otherwise hard to select robustly and the attribute is available.
- **Avoid brittle selectors:** Do not over-rely on text if the text is likely to change, but do use it when validating actual content.
- **Document the rationale** for selector choice in the test if the selection is non-obvious.

Do not enforce a strict hierarchy of selector types—choose the most resilient and clear selector for each scenario, as seen in real-world test implementations.

---

**This structure is required for all new E2E tests.**
- The [E2E Test Generation Workflow](../../../.windsurf/workflows/generate-e2e-test-multistep.md) and all guides reference this structure.
- If you introduce new patterns, update this guide and the workflow accordingly.

---

## Naming Conventions

- **Test files:** Use descriptive, kebab-case names: `user-login.spec.ts`, `variant-creation-flow.spec.ts`
- **Helpers/utilities:** Use camelCase for exported functions, and group related helpers in files or folders.
- **Fixtures:** Name fixture directories as `<concern>.fixture` (e.g., `base.fixture`, `user.fixture`).
- **Test descriptions:** Use clear, human-readable descriptions in `test.describe` and `test()` blocks.

---

## Organizational Patterns

- **One suite per file:** Each `.spec.ts` file should focus on a single flow or feature.
- **Incremental file creation:** Only create helpers/types/fixtures as needed by the evolving test logic (avoid boilerplate).
- **Reuse fixtures/utilities:** Always use shared helpers from `base.fixture`, `user.fixture`, etc. Don’t duplicate logic. Improve / add new utilities/fixtures as needed to maintain clean and human-readable implementations.
- **Type safety:** Import API response types from `web/oss/src/lib/Types.ts` (never use `any` for backend types).
- **Selectors:** Prefer role-based, data-testid, or structural selectors. Avoid text-based selectors unless validating content.
- **Component analysis:** Analyze UI/component structure to create robust selectors and assertions.
- **Documentation:** Update guides and helper READMEs when adding or changing utilities/fixtures.

---

## Authentication Guidance

- **Authentication is handled globally** using Playwright’s `globalSetup` and storage state. Assume the user is already logged in at the start of every test.
- **Never implement per-test authentication** unless explicitly testing login/onboarding flows.
- **Do not use deprecated session/user fixtures** for authentication.
- Use `authHelpers` only for onboarding/LLM key setup or explicit auth tests. See the [Utilities & Fixtures Guide](./UTILITIES_AND_FIXTURES_GUIDE.md#authentication-strategy) for details.

---

## Example Test File

```typescript
import { test, expect } from "@agenta/web-tests/tests/fixtures/base.fixture";
import type { ListAppsItem, ApiVariant } from "@/oss/lib/Types";

// Always assume user is logged in

test.describe('Variant Creation Flow', () => {
  test('should allow user to create a variant', async ({ page, uiHelpers, apiHelpers }) => {
    // Navigate to the apps page and get appId dynamically
    await page.goto("/apps");
    const apps = await apiHelpers.waitForApiResponse<ListAppsItem[]>({
      route: "/api/apps",
      method: "GET",
    });
    const appId = apps[0].app_id;

    // Go to the overview page for the selected app
    await page.goto(`/apps/${appId}/overview`);
    await uiHelpers.expectText('Recent Prompts'); // semantic section header

    // Click the button to create a variant (adjust selector as needed)
    await uiHelpers.clickButton('Create Variant');

    // Wait for the API response for variants
    const variants = await apiHelpers.waitForApiResponse<ApiVariant[]>({
      route: new RegExp(`/api/apps/${appId}/variants`),
      method: "GET",
    });
    expect(Array.isArray(variants)).toBe(true);
    expect(variants.length).toBeGreaterThan(0);
    // ...continue with further UI and API assertions as needed
  });
});
```

---

## References
- [Utilities & Fixtures Guide](./UTILITIES_AND_FIXTURES_GUIDE.md)
- [E2E Test Generation Guide](./E2E_TEST_GENERATION_GUIDE.md)
