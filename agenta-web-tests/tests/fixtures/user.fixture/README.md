# User Test Fixture

Core test infrastructure managing user state, authentication, and test resources across worker threads.

## Features

### Worker State Management

- Maintains per-worker user state via global Map
- Each worker gets dedicated email address
- Tracks authentication status and environment settings
- Automatically determines environment (local/cloud) from worker info

### Authentication Handling

- Automatic authentication based on environment (required in cloud)
- Support for @requiresAuth and @skipAuth tags
- Caches authentication state within worker thread
- Handles login via email workflow

### Test Groups

- Groups share worker state for consistent user context
- Tracks active test groups globally
- Manages email resources lifecycle
- Handles test retries correctly

### Email Management

- Auto-generates unique emails per worker: `unique.{tag}@testmail.app`
- Tags include worker ID and group identifiers
- Automatic cleanup after group completion
- Retry-safe cleanup process

## Usage

### Basic Test

```typescript
// Basic test
test('my test', async ({ user }) => {
  console.log(user.email, user.environment);
});

// Force auth
test('protected @requiresAuth', async ({ user }) => {
  // Auto-authenticated
});

// Test group
test.describe('My Feature', () => {
  // Same user for all tests in group
  // Auto cleanup after group
});
```
