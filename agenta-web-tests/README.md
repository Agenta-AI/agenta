# Agenta Web Tests

End-to-end tests for Agenta web application.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:

```bash
# .env
# Required for email-based authentication testing
TESTMAIL_API_KEY=your_api_key
TESTMAIL_NAMESPACE=your_namespace

# Optional test configuration
MAX_WORKERS=4        # Number of parallel workers (default: 2)
RETRIES=2           # Number of test retries (default: 0)
```

3. Configure test environment:

- Local OSS: Make sure Agenta is running on http://localhost:3000
- Staging/Beta: Ensure you have access to the cloud environments

## Usage Examples

Run tests against specific environments in parallel:

```bash
# Run against multiple environments
npm run test:e2e -- --project staging --project beta

# Run cloud-only features
npm run test:e2e -- --project staging-cloud-only --project beta-cloud-only

# Run with test filters
npm run test:e2e -- --project staging -- --project beta --grep @scope:auth

# Control parallelism
npm run test:e2e -- --project staging --project beta --workers 4
```

## Available Projects

- `local` - OSS features only
- `local-cloud` - All features
- `staging` - All features
- `beta` - All features
- `staging-cloud-only` - Cloud features only
- `beta-cloud-only` - Cloud features only

## Test Tags

Tests can be filtered using the following tags:

- `@scope:` - Test category (auth, apps, playground, etc.)
- `@coverage:` - Test coverage level (smoke, sanity, light, full)
- `@path:` - Test path type (happy, grumpy)
- `@feature-scope:` - Feature availability (cloud-only, common)

Tags affect user authentication requirements. For example:

- Tests with `@feature-scope:cloud-only` always require authentication
- Cloud environments always require authentication
- Tests with `@scope:auth` require authentication in any environment

## Project Structure

```
agenta-web-tests/
├── tests/
│   ├── fixtures/
│   │   ├── auth/
│   │   │   ├── loginWithEmail.fixture.ts  # Email-based authentication
│   │   │   └── postSignup.fixture.ts      # New user onboarding flow
│   │   └── user.fixture/                  # User state management
│   │       ├── index.ts                   # Main fixture
│   │       ├── types.ts                   # Type definitions
│   │       └── utilities.ts               # Helper functions
│   ├── cloud/
│   │   └── app/                          # App-related tests
│   │       ├── create.spec.ts            # App creation tests
│   │       └── helpers/                  # Reusable app test helpers
│   └── oss/
├── playwright/
│   ├── config/       # Test configuration
│   └── scripts/      # Test runner scripts
├── utils/
│   ├── testmail.ts   # Testmail.app API client
│   └── types.d.ts    # Type definitions
└── playwright.config.ts
```

## Test Organization

Tests are organized by domain with dedicated documentation:

- [`auth/`](./tests/fixtures/auth/README.md) - Authentication flows and fixtures
- [`cloud/`](./tests/cloud/README.md) - Cloud-specific features
  - [`app/`](./tests/cloud/app/README.md) - App management features

Each domain has its own README with:
- Feature-specific documentation
- Test patterns and examples
- Common scenarios
- Helper functions

## Core Concepts

For detailed documentation see:
- [Authentication](./tests/fixtures/auth/README.md)
- [User Management](./tests/fixtures/user.fixture/README.md)
- [Cloud Features](./tests/cloud/README.md)

## User Management & Authentication

The test framework separates concerns between:

1. User Management (`user.fixture.ts`)
   - One user per worker process
   - Environment-aware state
   - Authentication requirement detection
   - Test group state management

2. Authentication (`auth/loginWithEmail.fixture.ts`)
   - Email-based authentication flow
   - OTP handling
   - Login UI interactions

Example usage:

```typescript
import { test } from '../fixtures/user.fixture';

test.describe('Feature Tests', () => {
  test('my test', async ({ page, user }) => {
    // User is automatically authenticated if needed
    // based on environment and test tags
    await page.goto('/app');
    console.log(`Testing with user: ${user.email}`);
  });
});
```

## Authentication Flow

The framework handles authentication automatically with several improvements:

1. Email Generation
   - One email per worker process
   - Format: `namespace.tag@inbox.testmail.app`
   - Tag includes environment, worker ID, and timestamp

2. Login Process
   - Automatic OTP retrieval and input
   - Detection of new vs existing users
   - Automatic post-signup flow for new users

3. Post-Signup Flow
   - Handles new user onboarding automatically
   - Completes user survey questions
   - Ensures proper navigation to apps dashboard

Example usage remains the same, but with enhanced capabilities:
```typescript
import { test } from '../fixtures/user.fixture';

test('my test', async ({ page, user }) => {
  // Framework automatically:
  // 1. Detects if authentication is needed
  // 2. Creates unique test email
  // 3. Handles OTP verification
  // 4. Completes post-signup if needed
  // 5. Ensures user ends up in correct location
  await page.goto('/apps');
});
```

## Authentication Testing

Tests use testmail.app for email-based authentication, managed by the user fixture:

1. One email account is created per worker process
2. Authentication state is maintained across tests in the same group
3. Authentication is automatic based on:
   - Environment type (cloud vs OSS)
   - Test tags (cloud-only features)
   - Explicit auth requirements

Configure environment variables:

```bash
# Required for authentication
TESTMAIL_API_KEY=your_api_key
TESTMAIL_NAMESPACE=your_namespace
```

## Test Organization

Tests are now organized by domain and feature:

- `cloud/` - Cloud-specific features
  - `app/` - App-related features
    - `create.spec.ts` - App creation flows
    - `helpers/` - Reusable app test utilities

Each test domain can have its own helpers and utilities for better maintainability and reuse.
