# Agenta E2E Utilities & Fixtures Guide

## Purpose
This guide documents all reusable test utilities and fixtures available in the `web/tests` setup for Agenta Cloud. It helps engineers:
- Write robust, maintainable, and DRY E2E tests
- Understand available fixtures/utilities
- Follow best practices for extending shared test infrastructure

---

## Table of Contents
- [Agenta E2E Utilities \& Fixtures Guide](#agenta-e2e-utilities--fixtures-guide)
  - [Purpose](#purpose)
  - [Table of Contents](#table-of-contents)
  - [API Helpers](#api-helpers)
    - [Usage](#usage)
    - [Core Helper](#core-helper)
  - [E2E Test Utilities, Fixtures, and Structure](#e2e-test-utilities-fixtures-and-structure)
  - [Debug Logging for E2E Test Development](#debug-logging-for-e2e-test-development)
  - [Selector Best Practices for E2E Tests](#selector-best-practices-for-e2e-tests)
  - [UI Helpers](#ui-helpers)
    - [Usage](#usage-1)
    - [Available Helpers](#available-helpers)
      - [Examples](#examples)
  - [Authentication Strategy](#authentication-strategy)
  - [Best Practices](#best-practices)
  - [References](#references)

---

## API Helpers

Type-safe API response handling with built-in validation, located in [`tests/fixtures/base.fixture/apiHelpers`](../tests/fixtures/base.fixture/apiHelpers/README.md).

### Usage
```typescript
test('example', async ({ apiHelpers }) => {
  const response = await apiHelpers.waitForApiResponse<UserResponse>({
    route: '/api/user',
    responseHandler: (data) => {
      expect(data.id).toBeDefined();
    }
  });
});
```

### Core Helper
```typescript
waitForApiResponse<T>(options: ApiHandlerOptions<T>): Promise<T>

interface ApiHandlerOptions<T> {
  route: string | RegExp;      // Route to match
  method?: string;             // HTTP method (default: POST)
  validateStatus?: boolean;    // Validate 200 status (default: true)
  responseHandler?: (data: T) => Promise<void> | void;
}
```

- Supports string and RegExp matching for routes
- Type safety for all responses (import types from `web/oss/src/lib/Types.ts`)
- Built-in status and response validation

See full documentation and patterns in [`apiHelpers/README.md`](../tests/fixtures/base.fixture/apiHelpers/README.md)

---

## E2E Test Utilities, Fixtures, and Structure

**All new E2E tests must be placed in the appropriate product/package feature folder** (e.g., `web/ee/tests/app/`, `web/oss/tests/app/`). Do not place test specs in `web/tests/`—that folder is for shared Playwright fixtures, utilities, and documentation only.

- **Shared helpers/utilities** (like `uiHelpers`, `apiHelpers`, etc.) are always imported from `web/tests/tests/fixtures/`.
- **Product-specific tests can import shared logic from OSS** (for example, EE tests can import test logic from `@agenta/oss/tests/app`).
- **Organize by feature or flow** using subfolders (e.g., `app/`, `prompt-registry/`).
- **See the [E2E Test Organization Guide](E2E_TEST_ORGANIZATION_GUIDE.md) and the [E2E Test Generation Workflow](../../../.windsurf/workflows/generate-e2e-test-multistep.md) for full details and examples.**

---

## Debug Logging for E2E Test Development

During E2E test development, use `console.log` or similar debug logging to inspect API responses, request URLs, and important state transitions. This can help troubleshoot and understand test flows. Remove or comment out logs for production/CI runs to keep tests clean.

## Selector Best Practices for E2E Tests

Selectors should be chosen for robustness and clarity in the context of your test—not by a strict hierarchy:

- Use **role-based selectors** (e.g., `getByRole`) for ARIA/static elements such as dialogs, buttons, and headings.
- Use **structural selectors** (e.g., `locator("tr", {hasText: ...})`) for dynamic lists or tables, often combining with text matching for specificity.
- Use **text-based selectors** (e.g., `getByText`) when validating the presence or content of dynamic/user-generated text.
- Prefer **`data-testid`** only if the element is otherwise hard to select robustly and the attribute is available.
- For editors, drawers, or custom components, Cascade must always reference the actual component tree and rendered DOM (e.g., `.ant-drawer-content-wrapper` for drawers, `.agenta-rich-text-editor [contenteditable="true"]` for editors).
- **Drawer Visibility:** When asserting for Ant Design Drawer visibility (e.g., provider configuration drawers), Cascade must use `.ant-drawer-content-wrapper` unless a more specific selector is required.
- **Modal Visibility (Provider Configuration):** When handling the 'Configure now' button in the 'Secrets' tab, Cascade must assert modal visibility using `.ant-modal`, as this action opens an Ant Design Modal, not a Drawer.
- **API Data Refresh After Mutations (Canonical Pattern):**
  - **Required:** Always initiate `waitForApiResponse` **before** the UI action that triggers the API call (such as a tab switch, button click, or modal confirmation).
  - **Then trigger the UI action** that causes the API request.
  - **Then await the result** of the promise. This guarantees you are listening for the correct, fresh API response and not using stale data.
  - **Never rely on previously fetched data** for assertions or further actions after a mutation—always use the latest API response to drive test logic. This ensures robust, reliable, and accurate reflection of backend state.

  **Canonical Example:**
  ```typescript
  // Initiate the API wait BEFORE the UI action
  const apiKeysPromise = apiHelpers.waitForApiResponse<ApiKey[]>({
    route: "/api/api-keys",
    method: "GET",
  })
  // Trigger the UI action (e.g., tab switch)
  await uiHelpers.clickTab("API Keys")
  // Await the fresh API response
  const apiKeys = await apiKeysPromise
  expect(apiKeys.length).toBeGreaterThan(0)
  ```
  - **This pattern is required for all E2E tests that depend on fresh API data after a UI-triggered mutation or navigation.**

- Cascade must always extract relevant UI and structural info (headers, roles, text, hierarchy) from the implementation to create dynamic, robust selectors and assertions.
- Cascade must document the rationale for selector choice in the test if the selection is non-obvious.


**Important:**
- **Never chain multiple `.filter({hasText: ...})` calls** to match different texts in different descendants. This only matches if all texts are present in the same node, which is rarely the case for table rows and actions. Instead, select the table, then the row, then the action within that row.

**Example: Robust Table Row Button Assertion**
```typescript
const providersTable = page.getByRole("table").filter({ hasText: "Mistral AI" })
const mistralRow = providersTable.getByRole("row", { name: /Mistral AI/ })
await expect(mistralRow).toBeVisible()
await expect(mistralRow.getByRole("button", { name: "Configure now" })).toBeVisible()
```

This ensures you are asserting on the button within the correct row, not across all rows. Avoid ambiguous selectors that match multiple elements, as this can cause strict mode errors in Playwright.

**See also:** [E2E Test Organization Guide](E2E_TEST_ORGANIZATION_GUIDE.md) for more selector and structure guidance.

---

## UI Helpers

Type-safe UI interaction helpers with built-in waiting and error handling, located in [`tests/fixtures/base.fixture/uiHelpers`](../tests/fixtures/base.fixture/uiHelpers/README.md).

### Usage
```typescript
test('example', async ({ uiHelpers }) => {
  const { expectText, clickButton, typeWithDelay } = uiHelpers;
  await expectText('Welcome');
  await typeWithDelay('#email', 'user@example.com');
  await clickButton('Submit');
});
```

### Available Helpers
- `expectText(text: string, options?: { exact?: boolean, multiple?: boolean }): Promise<void>`
- `expectNoText(text: string): Promise<void>`
- `typeWithDelay(selector: string, text: string, delay?: number): Promise<void>`
- `clickButton(name: string, locator?: Locator): Promise<void>`
- `selectOption(config: { label?: string, text?: string | [string, { exact: boolean }] }): Promise<void>`
- `selectOptions(labels: string[]): Promise<void>`
- `expectPath(path: string): Promise<void>`
- `waitForPath(path: string | RegExp): Promise<void>`
- `waitForLoadingState(text: string): Promise<void>`

#### Examples
```typescript
await uiHelpers.expectText('Welcome')
await uiHelpers.expectText('Results', { multiple: true })
await uiHelpers.expectNoText('Error')
await uiHelpers.typeWithDelay('#email', 'user@example.com')
await uiHelpers.clickButton('Submit', dialogLocator)
await uiHelpers.selectOption({ text: 'Option 1' })
await uiHelpers.selectOption({ text: ['Exact Match', { exact: true }] })
await uiHelpers.selectOption({ label: 'Remember me' })
await uiHelpers.waitForPath('/dashboard')
await uiHelpers.expectPath('/profile')
await uiHelpers.waitForLoadingState('Loading...')
```

See full documentation and usage in [`uiHelpers/README.md`](../tests/fixtures/base.fixture/uiHelpers/README.md)

---

## Authentication Strategy

Authentication for all E2E tests is handled globally using Playwright's `globalSetup` and storage state features. The login flow is executed once before the test suite runs, and the authenticated session is saved to a state file. All tests automatically use this session, so you should:

- **Assume the user is already logged in** at the start of every test.
- **Do not implement per-test login or authentication logic** unless specifically testing the authentication flow itself.
- **Do not use deprecated session or user fixtures** for authentication purposes.
- Use the `authHelpers` only for onboarding flows, LLM key setup, or explicit authentication tests.

This approach keeps tests fast, reliable, and focused on application logic, reducing unnecessary complexity and duplication.

---

## Best Practices
- **Type Safety:** Always import API response types from `web/oss/src/lib/Types.ts` (never use `any` or define custom interfaces for backend types).
- **API Validation:** Use API helpers to verify server state before asserting DOM state.
- **API Endpoint Accuracy:** When working with API-driven selectors and type-safe assertions, always verify the actual backend endpoint for a given type. For example, the canonical endpoint for `StandardSecretDTO` is `/api/vault/v1/secrets` (not `/api/secrets`). Do not assume endpoint paths based on type or naming alone—inspect the implementation if unsure.
- **Authentication:** Assume the user is already logged in (handled by Playwright globalSetup). Do not use deprecated session/user fixtures.
- **Component Analysis:** Extract UI structure and semantics to create robust selectors and assertions.
- **Documentation:** Update this guide and helper READMEs when adding or changing utilities/fixtures.

---

## References
- [apiHelpers/README.md](../tests/fixtures/base.fixture/apiHelpers/README.md)
- [uiHelpers/README.md](../tests/fixtures/base.fixture/uiHelpers/README.md)
- [authHelpers/README.md](../tests/fixtures/user.fixture/authHelpers/README.md)
- [Agenta E2E Test Generation Guide](./E2E_TEST_GENERATION_GUIDE.md)
- [Agenta E2E Test Organization Guide](./E2E_TEST_ORGANIZATION_GUIDE.md)
