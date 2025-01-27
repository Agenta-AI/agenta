# API Helpers

Type-safe API response handling with built-in validation.

## Usage

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

## Core Helper

```typescript
waitForApiResponse<T>(options: ApiHandlerOptions<T>): Promise<T>

interface ApiHandlerOptions<T> {
  route: string | RegExp;      // Route to match
  method?: string;             // HTTP method (default: POST)
  validateStatus?: boolean;    // Validate 200 status (default: true)
  responseHandler?: (data: T) => Promise<void> | void;
}
```

## Common Patterns

### Response Race Pattern

```typescript
// Setup response listener before action
const responsePromise = apiHelpers.waitForApiResponse<ActionResponse>({
  route: '/api/action'
});

// Trigger action
await uiHelpers.clickButton('Submit');

// Wait for and validate response
const result = await responsePromise;
```

### Response Validation

```typescript
await apiHelpers.waitForApiResponse<UserResponse>({
  route: '/api/user',
  method: 'GET',
  validateStatus: true,
  responseHandler: (data) => {
    expect(data.id).toBeTruthy();
    expect(data.email).toBeDefined();
  }
});
```

### Route Matching

```typescript
// Exact route
await apiHelpers.waitForApiResponse({ 
  route: '/api/exact-path' 
});

// Pattern matching
await apiHelpers.waitForApiResponse({ 
  route: /\/api\/users\/\d+/ 
});
```

## Features

1. **Type Safety**
   - Generic type support for responses
   - Type-safe response handlers
   - Runtime type checking

2. **Built-in Validation**
   - Automatic status code checking
   - Response body validation
   - Custom validation handlers

3. **Flexible Matching**
   - String route matching
   - RegExp pattern matching
   - HTTP method filtering

## Implementation Details

- Based on Playwright's `page.waitForResponse`
- Automatic JSON parsing
- Error handling with clear messages
- Support for async validation
