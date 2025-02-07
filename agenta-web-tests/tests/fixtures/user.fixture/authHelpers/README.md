# Auth Helpers

Core authentication utilities for test infrastructure.

## Components

### Auth Helper Factory

Creates authentication utilities with:

- Email-based login flows
- State persistence
- Environment detection
- New user handling

### Available Helpers

#### `loginWithEmail`

Complete authentication flow using email and OTP:

```typescript
test('auth test', async ({ loginWithEmail }) => {
  await loginWithEmail('test@example.com', {
    timeout: 30000,    // OTP wait timeout
    inputDelay: 100    // Typing delay
  });
});
```

**Flow Steps:**

1. Navigate to auth page
2. Enter email address
3. Wait for and enter OTP
4. Handle new user detection
5. Complete post-signup if needed
6. Verify navigation to /apps

#### `completePostSignup`

Handles new user onboarding flow:

```typescript
test('signup test', async ({ completePostSignup }) => {
  await completePostSignup();
});
```

**Flow Steps:**

1. First Section:
   - Team size selection ("-10")
   - Role selection ("Hobbyist")
   - Purpose selection ("Just exploring")

2. Second Section:
   - Use case selection ("Evaluating LLM Applications")
   - Additional purpose ("Just exploring")

## Implementation Details

### UI Interactions

Uses base fixture UI helpers:

- `typeWithDelay`: Human-like typing
- `clickButton`: Button interactions
- `expectText`: Text verification
- `selectOption`: Form selections
- `waitForPath`: Navigation checks

### API Integration

```typescript
const responsePromise = waitForApiResponse<AuthResponse>({
  route: "/api/auth/signinup/code/consume",
  validateStatus: true
});
```

### Email Service

```typescript
const otp = await testmail.waitForOTP(email, { timeout });
```

## Common Patterns

### New User Flow

```typescript
if (responseData.createdNewRecipeUser) {
  await waitForPath("/post-signup");
  await completePostSignup();
}
```

### Existing User Flow

```typescript
// Direct navigation to apps
await waitForPath("/apps");
```

## Error Handling

- OTP timeout handling
- API response validation
- Navigation verification
- Detailed error logging
