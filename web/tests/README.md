# Agenta Cloud E2E Tests

## 📚 E2E Reference Guides

- [E2E Test Generation Guide](guides/E2E_TEST_GENERATION_GUIDE.md)
- [E2E Test Organization Guide](guides/E2E_TEST_ORGANIZATION_GUIDE.md)
- [Utilities & Fixtures Guide](guides/UTILITIES_AND_FIXTURES_GUIDE.md)

End-to-end tests for the Agenta web application. This guide reflects the latest runner, environment, and CI/CD integration logic as of 2025.

---

## Quick Start (Current Runner)

The current runner is `playwright/scripts/run-tests.ts` and does **not** use `--preset`.
Use environment variables to select target and license.

```bash
# List OSS acceptance tests
AGENTA_LICENSE=oss AGENTA_WEB_URL="http://localhost:3000" \
pnpm -C web/tests test:acceptance -- --list

# Run a single smoke test against deployed OSS
AGENTA_LICENSE=oss AGENTA_WEB_URL="http://<deployment-url>" \
pnpm -C web/tests test:acceptance -- \
  --grep "smoke: auth works and can navigate to apps" \
  --max-failures=1 --workers=1 --retries=1
```

Auth behavior in global setup:

- `AGENTA_TEST_AUTH_MODE=auto` (default): detect flow from UI.
- `AGENTA_TEST_AUTH_MODE=password`: enforce password flow.
- `AGENTA_TEST_AUTH_MODE=otp`: enforce OTP flow (requires Testmail envs).

Safety behavior in teardown:

- Destructive cleanup is disabled by default.
- Enable only when needed with `AGENTA_TEST_ALLOW_DESTRUCTIVE_TEARDOWN=true`.

---

## Supported Environments & Presets

- `local` – Local development (requires explicit `--license`)
- `staging`, `beta`, `prod`, `demo` – Cloud environments (license always `ee`)
- `oss` – OSS cloud (license always `oss`)

**License logic:**
- For `staging`, `beta`, `prod`, `demo`: license is always `ee` (enforced by runner)
- For `oss`: license is always `oss` (enforced by runner)
- For `local`: must specify `--license oss` or `--license ee`

---

## Required Environment Variables

- `TESTMAIL_API_KEY` – Required only for OTP auth mode
- `TESTMAIL_NAMESPACE` – Required only for OTP auth mode
- `AGENTA_TEST_OSS_OWNER_PASSWORD` – Required only for OSS runs (preset/license = `oss`)
- `AGENTA_TEST_OSS_OWNER_EMAIL` – Optional for OSS runs. If provided, must end with `@inbox.testmail.app` and local part must start with `TESTMAIL_NAMESPACE`. If not provided, a valid testmail address will be auto-generated.
- `AGENTA_API_URL` – Set automatically in CI workflows for teardown and API flows.

All required secrets are injected automatically in CI via the reusable workflow.

## Environment Variable Loading

The test runner (`playwright/scripts/run-tests.ts`) loads environment variables from two sources:

1. The default `.env` file at `web/tests/.env` is always loaded first.
2. If you provide the `--env-file <path>` option, that file is loaded after the default.

> **Note:** Variables from the first file loaded (the default `.env`) will be used if there are duplicates. The `--env-file` only extends the environment with any variables not already set. There is no overriding unless you unset variables manually or use the `override: true` option with dotenv (which is not the default).

---

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Create a `.env` file in `web/tests/` with at least:

```env
TESTMAIL_API_KEY=your_api_key
TESTMAIL_NAMESPACE=your_namespace
# Optional:
MAX_WORKERS=4
RETRIES=2
```

---

## Running Tests

Run tests using the unified runner script:

```bash
# Local OSS
pnpm tsx playwright/scripts/run-tests.ts --preset local --license oss

# Local EE
pnpm tsx playwright/scripts/run-tests.ts --preset local --license ee --web-url http://localhost:3001

# Staging
pnpm tsx playwright/scripts/run-tests.ts --preset staging

# Beta
pnpm tsx playwright/scripts/run-tests.ts --preset beta

# Prod
pnpm tsx playwright/scripts/run-tests.ts --preset prod

# Demo
pnpm tsx playwright/scripts/run-tests.ts --preset demo

# OSS cloud
pnpm tsx playwright/scripts/run-tests.ts --preset oss

# With annotation filters (e.g., smoke tests for apps)
pnpm tsx playwright/scripts/run-tests.ts --preset local --license oss --scope apps --coverage smoke

# With lens/case/speed filters
pnpm tsx playwright/scripts/run-tests.ts --preset prod --lens functional --case typical --speed fast
```

You can also provide a custom env file:

```bash
pnpm tsx playwright/scripts/run-tests.ts --preset oss --env-file ./my.env
```

---

## Annotation Flags

You can filter tests using these flags:
- `--scope <auth|apps|playground|datasets|evaluations>`
- `--coverage <smoke|sanity|light|full>`
- `--path <happy|grumpy>`
- `--env <local|staging|beta|prod|demo|oss>`
- `--feature <ee>` (only allowed if `--license ee`)
- `--entitlement <hobby|pro>`
- `--permission <owner|editor|viewer>`
- `--lens <functional|performance|security>`
- `--case <typical|edge>`
- `--speed <fast|slow>`

**Notes:**
- If you use `--license oss`, you **must** set `AGENTA_TEST_OSS_OWNER_PASSWORD`.
- `AGENTA_TEST_OSS_OWNER_EMAIL` is optional for OSS, but if provided, must be a valid testmail address for your namespace.
- `--feature` can only be used with license `ee`.
- All other Playwright CLI options (e.g. `--ui`, `--workers`, etc.) are supported.


---

## CI/CD & Workflow Integration

- All required secrets and API URLs are injected automatically in CI via the reusable workflow (`.github/workflows/62-testing.yml`).
- No need to set these manually in per-environment workflows.
- The Playwright teardown script uses `AGENTA_API_URL` to clean up test data.

---

## Best Practices

- **Type Safety:** Always use API response types from `web/oss/src/lib/Types.ts` in E2E tests. Do not define custom interfaces or use `any` for backend responses.
- **Dynamic Selectors:** Use API responses to drive selectors and assertions for robust, non-brittle tests.
- **API-driven Assertions:** Always assert backend responses/messages for actions that mutate state.

---

## Test Tags

Tests can be filtered using the following tags:

- `@scope:` - Test category (auth, apps, playground, etc.)
- `@coverage:` - Test coverage level (smoke, sanity, light, full)
- `@path:` - Test path type (happy, grumpy)
- `@feature-scope:` - Feature availability (ee, common)
- `@lens:` - Test lens (functional, performance, security)
- `@case:` - Testcase type (typical, edge)
- `@speed:` - Test speed type (fast, slow)

Tags affect user authentication requirements. For example:
- Tests with `@feature-scope:ee` always require authentication
- Cloud environments always require authentication
- Tests with `@scope:auth` require authentication in any environment


End-to-end tests for Agenta web application.


3. Configure test environment:

- Local OSS: Make sure Agenta is running on http://localhost:3000
- Staging/Beta: Ensure you have access to the cloud environments

**Note:**
- If you use `--license oss`, you **must** set the `AGENTA_TEST_OSS_OWNER_PASSWORD` environment variable (either in your shell or in a `.env` file in the tests directory). The runner will exit with an error if this is missing.
- `--feature` can only be used if the license is `ee`. If you provide `--feature` with any other license, the script will exit with an error.
- `--entitlement` and `--permission` are always optional and can be combined with other filters.
- `--coverage full` means all coverage levels are included (no coverage filter is applied), but other annotation filters (e.g. `--scope`, `--path`) will still be used if present.
- You no longer need to use `--project` or `--grep` directly; the script handles project selection and annotation mapping for you.
- All other Playwright CLI options (e.g. `--ui`, `--workers`, etc.) are supported.

```

## Available Projects

- `local` - OSS
- `staging` - All features
- `beta` - All features
- `oss` - OSS features only

## Test Tags

Tests can be filtered using the following tags:

- `@scope:` - Test category (auth, apps, playground, etc.)
- `@coverage:` - Test coverage level (smoke, sanity, light, full)
- `@path:` - Test path type (happy, grumpy)
- `@feature-scope:` - Feature availability (ee, common)

Tags affect user authentication requirements. For example:

- Tests with `@feature-scope:ee` always require authentication
- Cloud environments always require authentication
- Tests with `@scope:auth` require authentication in any environment

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
   - Test tags (ee features)
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
