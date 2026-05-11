# Research

## Current Architecture

- Config: `web/tests/playwright.config.ts`
- Global auth setup: `web/tests/playwright/global-setup.ts`
- Global teardown: `web/tests/playwright/global-teardown.ts`
- Shared fixtures: `web/tests/tests/fixtures/*`
- OSS acceptance specs: `web/oss/tests/playwright/acceptance/*`
- EE acceptance specs: `web/ee/tests/playwright/acceptance/*`
- BDD feature specs: `web/oss/tests/playwright/acceptance/features/*`

## How Targeting Works

`playwright.config.ts` sets `testDir` dynamically using `AGENTA_LICENSE`:

- `AGENTA_LICENSE=oss` -> `web/oss/tests/playwright/acceptance`
- `AGENTA_LICENSE=ee` -> `web/ee/tests/playwright/acceptance`

## Suite Inventory (OSS)

| Domain | Spec File | Test File | Status |
|---|---|---|---|
| smoke | `smoke.spec.ts` | (inline) | Pass |
| app | `app/create.spec.ts` | `app/index.ts`, `app/test.ts` | Pass |
| playground | `playground/run-variant.spec.ts` | `playground/index.ts`, `playground/tests.ts` | Harness fix landed; runtime still blocked |
| deployment | `deployment/deploy-variant.spec.ts` | `deployment/index.ts` | Hard skipped |
| observability | `observability/observability.spec.ts` | `observability/index.ts` | Hard skipped |
| prompt-registry | `prompt-registry/prompt-registry-flow.spec.ts` | `prompt-registry/index.ts` | Fragile |
| settings | `settings/model-hub.spec.ts` | `settings/model-hub.ts` | Pass |
| settings | `settings/api-keys-management.spec.ts` | `settings/api-keys.ts` | Hard skipped |
| testset | `testsset/testset.spec.ts` | `testsset/index.ts` | Skip (conditional) |

EE acceptance domains:
- app, playground, prompt-registry, deployment, observability, settings, testset
- EE-native: auto-evaluation, human-annotation

## Key Findings

### Navigation Pattern (Critical)

All workspace-scoped routes (`/prompts`, `/observability`, `/testsets`, `/settings`) return 404 without the workspace/project prefix. Tests must:

1. Navigate to `/apps` (auto-redirects to `/w/{workspace_id}/p/{project_id}/apps`)
2. Click sidebar links to reach other pages

### Playground Direct URL Bug

Direct navigation to `/apps/{id}/playground` renders the page shell but content area stays blank. Tests must navigate through Overview page → Playground sidebar click. This is a frontend client-side state dependency issue.

### Table Locator Pattern

The prompts table uses div-based rows (not `<tr>`). Use:
- Search box to filter long lists
- `page.getByText()` or `[class*="cursor"]` locators instead of `tr:has-text()`

### API Interception Timing

`page.waitForResponse()` must be set up BEFORE the navigation/click that triggers the API call. Setting it up after causes race conditions.

This was one of the active issues on the branch review. The current patch fixes the Playground helper to attach the listener before clicking Run.

### Ephemeral Project Isolation

The project-per-run design is correct, but the cached-auth fallback path must recreate an authenticated browser context from `state.json` before creating the ephemeral project. Otherwise reruns can silently reuse the previous default project. The current patch fixes that setup path.

### Auth Modes

Global setup (`global-setup.ts`) supports:
- `auto` (default) - detects flow from UI
- `password` - enforces password flow (requires `AGENTA_TEST_OSS_OWNER_EMAIL`/`PASSWORD`)
- `otp` - enforces OTP flow (requires Testmail config)

### Teardown Safety

`global-teardown.ts` cleans up the ephemeral project and attempts to delete OpenAI secrets from vault. Secret cleanup may fail with "Unauthorized" if the session cookie expired, which is benign.
