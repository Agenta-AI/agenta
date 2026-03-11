# BDD Feature Specifications

This directory contains Gherkin-format BDD feature files that describe the acceptance tests
for the Agenta OSS frontend. Each feature file maps to one or more Playwright test files.

## Feature-to-Test Mapping

| Feature File | Test File(s) | Status |
|---|---|---|
| `smoke.feature` | `smoke.spec.ts` | Passing |
| `app-creation.feature` | `app/create.spec.ts`, `app/index.ts` | Passing |
| `playground.feature` | `playground/run-variant.spec.ts`, `playground/index.ts` | Passing |
| `deployment.feature` | `deployment/deploy-variant.spec.ts`, `deployment/index.ts` | Passing |
| `observability.feature` | `observability/observability.spec.ts`, `observability/index.ts` | Passing |
| `prompt-registry.feature` | `prompt-registry/prompt-registry-flow.spec.ts`, `prompt-registry/index.ts` | Passing |
| `settings.feature` | `settings/model-hub.spec.ts`, `settings/model-hub.ts` | Passing |
| `testsets.feature` | `testsset/testset.spec.ts`, `testsset/index.ts` | Skipped (no data) |

## Caveats and Known Issues

1. **Testset test skips when no testsets exist** - The deployment environment may not have
   testsets pre-created. The test gracefully skips with `test.skip()` in this case.

2. **API Keys Management is skipped** - The `api-keys-management.spec.ts` test is permanently
   skipped via `test.skip()`. It requires additional setup not available on all deployments.

3. **Navigation requires sidebar clicks** - Direct URL navigation (e.g., `page.goto("/prompts")`)
   results in 404 errors because paths require workspace/project prefix. All tests navigate via
   `/apps` (which redirects correctly) then use sidebar links.

4. **Playground direct URL renders blank** - Navigating directly to `/apps/{id}/playground` via
   URL shows a blank content area. Tests must navigate through Overview -> Playground sidebar click.

5. **Prompts table uses virtual/div-based rows** - The prompts table does not use standard `<tr>`
   elements. Tests use text search (search box + `getByText`) instead of `tr:has-text()` locators.

6. **App list may be long** - Repeated test runs create many apps. The `navigateToPlayground`
   fixture uses the search box to filter the prompts table before clicking an app row.

7. **Deployments section is on Overview page** - There is no separate `/deployments` route in the
   sidebar. Deployment environment cards are on the app's Overview page.

## How to Run

```bash
cd web/tests

# Run all tests
node_modules/.bin/playwright test

# Run by feature area
node_modules/.bin/playwright test --grep "smoke"
node_modules/.bin/playwright test --grep "completion"
node_modules/.bin/playwright test --grep "Playground"
node_modules/.bin/playwright test --grep "deploy"
node_modules/.bin/playwright test --grep "observability"

# Show HTML report
node_modules/.bin/playwright show-report
```
