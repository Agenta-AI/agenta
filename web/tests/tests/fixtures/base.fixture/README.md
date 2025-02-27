# Base Test Fixture

Foundation for all Agenta test fixtures, providing namespaced UI and API helpers.

## Structure

```
base.fixture/
├── index.ts         # Main fixture definition
├── types.d.ts       # Base type definitions
├── apiHelpers/      # API interaction helpers
│   ├── index.ts     # API helper implementations
│   ├── types.d.ts   # API helper types
│   └── README.md    # API helper documentation
└── uiHelpers/       # UI interaction helpers
    ├── index.ts     # UI helper implementations
    ├── types.d.ts   # UI helper types
    └── README.md    # UI helper documentation
```

## Usage

```typescript
import { test } from './fixtures/base.fixture';

test('example test', async ({ page, uiHelpers, apiHelpers }) => {
  // Page object for direct Playwright actions
  await page.goto('/login');

  // UI Helpers for common interactions
  await uiHelpers.typeWithDelay('#email', 'user@example.com');
  await uiHelpers.clickButton('Login');

  // API Helpers for response handling
  const userData = await apiHelpers.waitForApiResponse<UserData>({
    route: '/api/user'
  });
});
```

## Provided Fixtures

### `page: Page`

Standard Playwright page object

### `uiHelpers: UIHelpers`

Namespaced UI interaction helpers

- Text assertions (`expectText`, `expectNoText`)
- Form interactions (`clickButton`, `typeWithDelay`, `selectOption`)
- Navigation (`waitForPath`, `expectPath`)
- Loading states (`waitForLoadingState`)

[UI Helpers Documentation](./uiHelpers/README.md)

### `apiHelpers: ApiHelpers`

Namespaced API interaction helpers

- Response handling (`waitForApiResponse`)
- Status validation
- Type-safe response handlers

[API Helpers Documentation](./apiHelpers/README.md)

## Extending

```typescript
// Extend with your own fixtures
const test = baseTest.extend<YourFixtures>({
  customHelper: async ({ page, uiHelpers }, use) => {
    await use(async () => {
      // Use base fixtures to build higher-level helpers
      await uiHelpers.expectText('Ready');
    });
  }
});
```

## Type Safety

```typescript
// All helpers are fully typed
interface BaseFixture {
  page: Page;
  uiHelpers: UIHelpers;
  apiHelpers: ApiHelpers;
}

// Extensions inherit types
interface YourFixture extends BaseFixture {
  customHelper: () => Promise<void>;
}
```

## Best Practices

1. **Use Namespaced Helpers**
   - Access helpers through their namespace: `uiHelpers.clickButton`
   - Keeps test code organized and prevents naming conflicts

2. **Build on Base Fixtures**
   - Extend base fixture for domain-specific helpers
   - Reuse base helpers in your extensions

3. **Maintain Type Safety**
   - Use TypeScript interfaces for API responses
   - Leverage generic type parameters for response handling

4. **Follow Helper Patterns**
   - Use UI helpers for interface interactions
   - Use API helpers for response validation
   - Combine both for complete user flow testing
