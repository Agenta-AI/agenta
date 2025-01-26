# Test Fixtures

Core test infrastructure providing reusable, type-safe test helpers for Agenta's E2E tests.

## Architecture

```typescript
import { test } from './fixtures/base.fixture';

// All helpers available through base fixture
test('example', async ({ 
  // UI Helpers
  expectText,     // Text assertions
  clickButton,    // Button interactions
  typeWithDelay,  // Human-like typing
  
  // API Helpers
  waitForApiResponse, // Type-safe API handling
  
  // Auth Helpers
  loginWithEmail,    // Email-based auth
  completePostSignup // User onboarding
}) => {
  // Test implementation
});
```

## Core Fixtures

### [UI Helpers](ui.fixture/README.md)

Human-readable UI interaction patterns:

- Text assertions (`expectText`, `expectNoText`)
- Form interactions (`typeWithDelay`, `clickButton`)
- Navigation (`waitForPath`, `expectPath`)
- Loading states (`waitForLoadingState`)

### [API Helpers](api.fixture/README.md)

Type-safe API response handling:

```typescript
const data = await waitForApiResponse<UserResponse>({
  route: '/api/endpoint',
  method: 'POST',
  validateStatus: true
});
```

### [Auth Flows](auth/README.md)
Authentication and user management:

- Email-based authentication
- OTP verification
- New user onboarding

## Implementation

```
fixtures/
├── base.fixture.ts    # Main composition point
├── ui.fixture/        # UI interaction helpers
│   ├── helpers.ts    # Core UI functions
│   └── types.ts      # UI helper types
├── api.fixture/       # API response handling
│   ├── helpers.ts    # API functions
│   └── types.ts      # API types
└── auth/             # Auth flows
    ├── loginWithEmail.fixture/
    └── postSignup.fixture/
```

## Configuration

Required environment:

```bash
TEST_ENV=local|cloud     # Test environment
TESTMAIL_API_KEY=xxx    # Email service auth
```

## Extension Guide

1. Create helper functions with fixtures:

```typescript
const myHelper = (page: Page) => ({
  helperFn: async () => {
    // Implementation
  }
});

type MyFixture = ReturnType<typeof myHelper>;

export const myFixture = () => {
  return async ({ page }, use: (r: MyFixture) => Promise<void>) => {
    await use(myHelper(page));
  };
};
```

2. Add to base fixture:

```typescript
export const test = playwright.extend<MyFixture>({
  ...myFixture()
});
```

See individual fixture documentation for detailed APIs and examples.
