# App Management Tests

## Test Strategy

### App Creation (`create.spec.ts`)

#### Prerequisites

- Valid user session (handled by auth fixture)
- Cloud environment configuration
- Network access to API endpoints

#### Validations

1. UI Validation
    - Navigation to apps dashboard
    - Modal interactions
    - Loading states
    - Success indicators

2. API Validation
    - Successful app creation request
    - Valid response structure
    - Correct app name in response

## Fixtures ([helpers/test.ts](helpers/test.ts))

Our tests use custom fixtures that extend Playwright's base functionality:

### Navigation

- `navigateToApps()`: Navigates to apps dashboard and verifies page load

    ```typescript
    await navigateToApps() // Navigates and checks for "App Management" text
    ```

### Create a new App

- `createNewApp(name: string)`: Handles complete app creation flow

    ```typescript
    const response = await createNewApp("my-app")
    // Returns CreateAppResponse with id, name, createdAt
    ```
    - Manages modal interactions
    - Validates API response
    - Ensures successful navigation to playground

### Verification

- `verifyAppCreation(name: string)`: Validates UI state after app creation

    ```typescript
    await verifyAppCreation("my-app")
    // Checks loading states and app name visibility
    ```

## Testcases

### App Creation

- ✅ Create from dashboard with API validation
- 🔄 Create from sidepanel (TODO)
- 🔄 Validation cases (TODO)

## Common Patterns

### Basic App Creation Flow

```typescript
test("create app", async ({navigateToApps, createNewApp, verifyAppCreation}) => {
    await navigateToApps()
    const appName = `test-app-${Date.now()}`
    await createNewApp(appName)
    await verifyAppCreation(appName)
})
```

## Types

Common types are defined in `types.d.ts`:

- `CreateAppResponse` - API response structure
- `AppActions` - Available test actions
