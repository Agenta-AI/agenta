# Auto Evaluation Test Fixtures

This directory contains test fixtures for automating the evaluation process in the Agenta platform. These fixtures provide reusable functions to interact with the evaluation UI and perform common evaluation tasks.

## Available Fixtures

### 1. `navigateToEvaluation`

Navigates to the Automatic Evaluation section for a specific application.

**Parameters:**

- `appId` (string): The ID of the application to evaluate

**Usage:**

```typescript
await test("navigate to evaluation", async ({navigateToEvaluation}) => {
    await navigateToEvaluation("your-app-id")
})
```

### 2. `runAutoEvaluation`

Runs an automatic evaluation with the specified configuration.

**Parameters (object):**

- `evaluators` (string[]): List of evaluator names to use
- `testset` (string, optional): Name of the testset to evaluate against
- `variants` (string[]): List of variant names to evaluate

**Usage:**

```typescript
await test("run evaluation", async ({runAutoEvaluation}) => {
    await runAutoEvaluation({
        evaluators: ["factual-accuracy", "relevance"],
        testset: "my-testset",
        variants: ["variant-1", "variant-2"],
    })
})
```

## How It Works

1. **Testsetup**: The fixtures extend the base test fixture with evaluation-specific functionality.
2. **UI Automation**: They handle all the necessary UI interactions, including:
    - Navigating to the evaluation section
    - Selecting testsets
    - Choosing variants
    - Configuring evaluators
    - Managing the evaluation creation flow
3. **State Management**: The fixtures handle waiting for async operations and ensure the UI is in the correct state before proceeding.

## Best Practices

- Always wait for navigation and UI updates to complete
- Use the provided helper methods instead of direct page interactions
- Keep test data (evaluators, testsets, variants) in separate configuration files
- Combine fixtures for complex test scenarios

## Dependencies

- Base test fixtures from `@agenta/web-tests`
- Playwright test runner
- Agenta UI components and API helpers
