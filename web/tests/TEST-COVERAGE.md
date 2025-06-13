# Test Coverage
We have total 4 coverage levels, each level has different depth of tests.

- smoke
- sanity
- light
- full

## Smoke tests
For smoke tests, we have 11 tests from each part of the application:

- Model-hub: Add the OpenAPI provider key to the model hub
- App: Create an app for both completion and chat
- Playground: Run a single view variant for both completion and chat apps
- Playground: Change the variable keys and run again
- Playground: Save the changes
- Prompt Registry: Test the Registry page
- Testset: Confirm we have the default testset
- Auto Eval: Run the Evaluation using an evaluator
- Observability: Confirm we have traces and view the traces
- Deployment: Deploy a variant on an environment

### What we are not going for smoke tests:

- Going deep into the page
- User invite
- API keys
- Billing

## Sanity tests
Sanity check means testing a specific feature or functionality to ensure it works as expected.
We can do sanity check using the `--scope` flag.

```bash
pnpm tsx playwright/scripts/run-tests.ts --scope app
```

## Light tests
....