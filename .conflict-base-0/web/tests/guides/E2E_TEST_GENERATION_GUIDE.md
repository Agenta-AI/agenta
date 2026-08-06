# Agenta E2E Test Generation Guide

## Purpose
This guide describes the repeatable process for converting Playwright codegen output or flow descriptions into robust, maintainable, and dynamic E2E tests for the Agenta Cloud codebase. It should be used by all team members and updated as best practices evolve.

---

## E2E Test Generation Workflow

Follow these steps to convert Playwright codegen output or flow descriptions into Agenta E2E tests:

1. **Analyze the Flow**
   - Understand the user journey, UI, and API calls in the codegen script or flow description.
   - Identify the relevant React/Next.js components and how data is fetched/rendered.

2. **Determine Test Location and Naming**
   - Choose the appropriate product/package folder (e.g., `web/ee/tests/app/`, `web/oss/tests/app/`).
   - Suggest a descriptive folder and file name reflecting the user action, business logic, and components involved. Confirm with the team if needed.

3. **Create Only the Main Test File**
   - After confirmation, create only the main spec/test file. Add supporting files (helpers, types, fixture extensions) incrementally as real needs arise.

4. **Set Up the Test Skeleton**
   - Always use the Agenta base fixture:
     ```typescript
     import { test, expect } from "@agenta/web-tests/tests/fixtures/base.fixture";
     import type { ListAppsItem, ApiVariant } from "@/oss/lib/Types";
     ```
   - Never use plain Playwright imports or custom API response types.
   - Assume the user is already logged in (authentication is handled globally).

5. **Drive Logic with API Data**
   - Use `apiHelpers.waitForApiResponse` to fetch dynamic data (e.g., app names, variant IDs) and drive selectors/assertions.
   - Validate API responses for type and content before interacting with the UI.
   - Import all API response types from `web/oss/src/lib/Types.ts`.

6. **Use Robust, Contextual Selectors**
   - Choose selectors based on robustness and clarity:
     - Role-based selectors for static ARIA elements (dialogs, buttons, headings).
     - Structural selectors for dynamic lists/tables (e.g., `locator("tr", {hasText: ...})`).
     - Text-based selectors only when validating user-generated or dynamic content.
     - Prefer `data-testid` only if other options are not robust or available.
   - Reference the actual component tree and rendered DOM for complex elements (e.g., editors, drawers).
   - See the [Selector Best Practices](./UTILITIES_AND_FIXTURES_GUIDE.md#selector-best-practices-for-e2e-tests) for details.

7. **Assert Navigation and URL State**
   - If the flow involves navigation or URL parameter changes, always assert the expected URL state.

8. **Incrementally Add Helpers/Fixtures**
   - Only add new helpers, types, or fixture extensions if required by the evolving test logic. Document any new helpers for future maintainability.

9. **Type Safety**
   - Ensure strong TypeScript type safety throughout. Never use `any` or custom interfaces for API responses.

10. **Document Rationale for Non-Obvious Choices**
   - If a selector or assertion is non-obvious, add a comment explaining the rationale.

---

## Canonical Example Test Skeleton

```typescript
import { test, expect } from "@agenta/web-tests/tests/fixtures/base.fixture";
import type { ListAppsItem, ApiVariant } from "@/oss/lib/Types";

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

    // Click the button to create a variant
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

## Debug Logging During Test Development

During E2E test development, it is encouraged to use debug logging (e.g., `console.log` for API responses, request URLs, and important state transitions) to aid troubleshooting and understanding of test flows. These logs can be left as comments or removed for production/CI runs to keep tests clean and focused.

---

## References
- [E2E Test Organization Guide](./E2E_TEST_ORGANIZATION_GUIDE.md)
- [Utilities & Fixtures Guide](./UTILITIES_AND_FIXTURES_GUIDE.md)
- [E2E Test Generation Workflow](../../.windsurf/workflows/generate-e2e-test-multistep.md)

---

**Keep this guide up to date as best practices evolve.**
