# Playground Test Fixtures

This directory contains test fixtures and utilities for testing the Playground component in the Agenta application. The fixtures provide a high-level API for common Playground interactions, making tests more readable and maintainable.

## Key Components

### Fixtures

The main test fixture extends the base test fixture with Playground-specific functionality:

```typescript
interface VariantFixtures {
    // Navigate to the Playground for a specific app
    navigateToPlayground: (appId: string) => Promise<void>

    // Run a completion variant test with the given messages
    runCompletionSingleViewVariant: (appId: string, messages: string[]) => Promise<void>

    // Run a chat variant test with the given messages
    runChatSingleViewVariant: (appId: string, messages: string[]) => Promise<void>

    // Add a new prompt with the specified role and content
    addNewPrompt: (promptMessages: {prompt: string; role: RoleType}[]) => Promise<void>

    // Change variable keys in the Playground
    changeVariableKeys: (variables: {oldKey: string; newKey: string}[]) => Promise<void>

    // Save a variant or version
    saveVariant: (
        type: "version" | "variant",
        note?: string,
        revisionId?: string,
        variantName?: string,
    ) => Promise<void>
}
```

### Test Data

- **Constants**: Contains test messages and prompts in `constants.ts`
- **Types**: Defines TypeScript interfaces and enums used in the tests

## Usage Example

```typescript
import {test} from "./tests.spec"
import {COMPLETION_MESSAGES} from "./assets/constants"

test("run completion variant", async ({navigateToPlayground, runCompletionSingleViewVariant}) => {
    const appId = "your-app-id"
    await navigateToPlayground(appId)
    await runCompletionSingleViewVariant(appId, COMPLETION_MESSAGES)
})
```

## Test Structure

1. **Setup**: Use `navigateToPlayground` to navigate to the Playground
2. **Execution**: Use the appropriate runner (`runCompletionSingleViewVariant` or `runChatSingleViewVariant`)
3. **Assertions**: Verify the expected behavior in the UI

## Best Practices

- Use the provided constants for test data when possible
- Follow the Page Object Model pattern for UI interactions
- Keep tests focused on specific functionality
- Use descriptive test names that explain the expected behavior
