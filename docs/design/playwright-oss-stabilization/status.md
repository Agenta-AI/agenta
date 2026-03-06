# Playwright OSS Stabilization - Status

## How to Run Playwright Tests

### Prerequisites

1. **Install Playwright browsers** (first time only):
   ```bash
   cd web/tests
   node_modules/.bin/playwright install
   ```

2. **Configure environment** - create/edit `web/tests/.env`:
   ```env
   AGENTA_WEB_URL=<your-deployment-url>
   AGENTA_LICENSE=oss
   AGENTA_OSS_OWNER_EMAIL=<your-email>
   AGENTA_OSS_OWNER_PASSWORD=<your-password>
   ```

### Running Tests

All commands run from `web/tests/` directory:

```bash
cd web/tests

# Run ALL tests
node_modules/.bin/playwright test

# Run by feature area
node_modules/.bin/playwright test --grep "smoke"
node_modules/.bin/playwright test --grep "completion"
node_modules/.bin/playwright test --grep "Playground"
node_modules/.bin/playwright test --grep "deploy"
node_modules/.bin/playwright test --grep "observability"

# Run with headed browser (visible)
node_modules/.bin/playwright test --headed

# Show HTML report after run
node_modules/.bin/playwright show-report
```

### Important Notes

- The playwright config is at `web/tests/playwright.config.ts`
- There are NO browser projects configured (no `--project` flag needed)
- Tests use 1 worker sequentially (`workers: 1`)
- Test timeout is 60s, expect timeout is 60s
- Auth is handled by `global-setup.ts` (saves `state.json`)
- Test directory is determined by `AGENTA_LICENSE` env var (defaults to `oss`)
- Screenshots on failure go to `web/tests/test-results/`

---

## Current State (as of 2026-03-06)

The suite is not fully stabilized today.

The new project-scoped mock provider fixture is implemented. The Settings flow works locally against the preview deployment. The Playground runtime path now reaches real execution with the selected mock model. The remaining blocker is a runtime credential resolution failure for the custom provider model `mock/custom/gpt-6`.

### Verified today

| Area | Status | Notes |
|---|---|---|
| Settings mock provider creation | Pass | The test fixture can create the `mock` custom provider and the dedicated Settings spec passes locally. |
| Project-scoped Settings navigation | Pass | The helper now uses `/w/{workspace}/p/{project}/settings?tab=secrets`. |
| Playground app navigation | Improved | The test no longer depends on the Prompts table. It enters the app through Overview, then moves to Playground from the app sidebar. |
| Playground model selection | Improved | The helper now selects `mock/custom/gpt-6` through the grouped model picker. |
| Playground completion run | Blocked | The run reaches `/test`, but runtime returns `400 invalid-secrets` with `No API key found for model 'mock/custom/gpt-6'`. |
| Playground chat run | Not revalidated after the latest fixes | Expected to be blocked by the same runtime issue. |
| Observability | Blocked behind Playground execution | No fresh traces are produced until the runtime issue is fixed. |
| Prompt registry | Failing in CI | The page route loads, but the expected heading assertion does not match the rendered content. |
| Testsets | Failing in CI | The test still waits for a request contract that does not always fire on the current page path. |
| Deployment | Failing in CI | The current deployment test still assumes at least one variant exists. |
| API keys | Skip | Still skipped. |

## BDD Feature Specs

Gherkin-format BDD feature files live in `web/oss/tests/playwright/acceptance/features/`.
See `features/README.md` for the full mapping and caveats.

## Decisions

- Keep current auth-via-UI design (password and OTP flows both supported).
- Use project-scoped URLs when the route contract is stable. Never use unscoped workspace routes like `/settings` or `/prompts`.
- Keep the known Playground workaround. Enter the app through Overview first, then use the app sidebar to open Playground.
- `AGENTA_ALLOW_DESTRUCTIVE_TEARDOWN` defaults to `false`; only enable on disposable CI environments.
- Testset test skips gracefully when no testsets exist rather than failing.
- Local verification must stay serial while `global-setup.ts` and `global-teardown.ts` share `test-project.json`. Two local Playwright invocations in parallel are not a valid signal.

## Known Issues

1. **Settings content hydrates after the shell appears.** The page can render the heading and sidebar before project data and vault data finish loading. Clicking `Custom providers -> Create` too early loses the interaction. Tests must wait for Models content readiness, not just route readiness.
2. **Settings page can remount during hydration.** The page key depends on org and project state. Early interactions can be dropped if the page remounts after the first render.
3. **Playground direct URL still renders blank.** Direct navigation to `/apps/{id}/playground` is still unreliable. Tests navigate through Overview, then click Playground in the app sidebar.
4. **Custom provider runtime is still blocked.** The UI can create and select `mock/custom/gpt-6`, but the runtime still rejects it with `No API key found for model 'mock/custom/gpt-6'`.
5. **Teardown auth warning can still appear.** `Failed to fetch secrets {"detail":"Unauthorized"}` on teardown is benign when the session cookie expires before teardown runs on shared deployments.
6. **`testsset` folder typo remains.** The testset test folder is named `testsset`. Renaming still requires updating EE wrapper imports.

## Key Patterns Discovered

These patterns apply to all OSS acceptance tests:

1. **Project scope comes first.** Routes like `/settings`, `/prompts`, `/observability`, and `/testsets` fail or misrender without the `/w/{workspace}/p/{project}` prefix.
2. **Shell readiness is not content readiness.** Seeing the sidebar or heading is not enough. Wait until the target content finishes loading and visible spinners are gone.
3. **Do not bind tests to long list searches when you already have stable IDs.** If the app id is known, go straight to the scoped app route instead of searching the Prompts table.
4. **API listeners must be attached before the trigger.** This still applies to all run and navigation flows.
5. **The Playground model picker is grouped.** The custom model appears under the provider group and renders as `mock/custom/gpt-6`, not plain `gpt-6`.
