# Playwright OSS Stabilization

## How to Run Playwright Tests

### Prerequisites

1. **Install Playwright browsers** (first time only):
   ```bash
   cd web/tests
   node_modules/.bin/playwright install
   ```

2. **Configure environment** - create/edit `web/tests/.env`:
   ```env
   AGENTA_WEB_URL=http://gateway-production-99ee.up.railway.app
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

# Run specific test file
node_modules/.bin/playwright test ../oss/tests/playwright/acceptance/smoke.spec.ts

# Run tests matching a grep pattern
node_modules/.bin/playwright test --grep "smoke"
node_modules/.bin/playwright test --grep "completion"

# Run with headed browser (visible)
node_modules/.bin/playwright test --headed

# Run with debug mode
node_modules/.bin/playwright test --debug

# Show HTML test report after run
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

# Status

## Current State

- OSS deployment smoke test is runnable against live URL using `AGENTA_LICENSE=oss` and `AGENTA_WEB_URL`.
- Playwright runner/setup received stability fixes (arg parsing, default URL behavior, setup/teardown robustness).
- Frontend suite structure and gaps reviewed.

## Open Risks

1. EE wrapper import paths for OSS test reuse require normalization.
2. Some acceptance specs remain flaky due to nondeterministic data assumptions.
3. Tag semantics are inconsistent, reducing filter accuracy.

## Decisions

- Keep current auth-via-UI design for now.
- Prioritize OSS deployment subset as production gate before broad-suite enforcement.
- Use phased rollout (gate small first, expand later).

## Next Actions

1. Land P0 structural fixes.
2. Define CI job for OSS deployment smoke profile.
3. Add regression test for playground variable rename payload behavior.

---

## Current Session (2026-03-05)

### Session Goals
- Fix failing OSS tests against deployed environment: http://gateway-production-99ee.up.railway.app/
- Auth credentials: configured via env vars
- Use Playwright tools to understand actual UI behavior and update tests accordingly

### Findings

**Test Structure:**
- OSS tests located at: `web/oss/tests/playwright/acceptance/`
- Main smoke test: `smoke.spec.ts` - simple navigation test to /apps
- Auth handled by: `web/tests/playwright/global-setup.ts`
- Storage state saved to: `state.json`

**Auth Flow:**
Global setup supports three modes:
1. `auto` (default) - detects flow from UI
2. `password` - enforces password flow (requires AGENTA_OSS_OWNER_EMAIL/PASSWORD)
3. `otp` - enforces OTP flow (requires Testmail config)

For OSS deployment with password auth:
- Uses AGENTA_OSS_OWNER_EMAIL and AGENTA_OSS_OWNER_PASSWORD
- Falls back to generated testmail address if owner email not provided

**Test Files Found:**
- smoke.spec.ts
- app/create.spec.ts
- playground/run-variant.spec.ts
- testsset/testset.spec.ts (note typo in folder name)
- observability/observability.spec.ts
- deployment/deploy-variant.spec.ts
- settings/model-hub.spec.ts
- settings/api-keys-management.spec.ts
- prompt-registry/prompt-registry-flow.spec.ts

### Test Results

**Passing Tests:**
- ✅ smoke.spec.ts - Auth and navigation works
- ✅ app/create.spec.ts - Both completion and chat app creation work

**Failing Tests:**
- ❌ playground/run-variant.spec.ts - Navigation to playground fails (timeout after 60s)

### Analysis of Playground Test Failure

**Root Cause:**
The `navigateToPlayground` fixture in `playground/tests.ts` (line 10-31) is trying to navigate to the playground but getting stuck on the /apps page.

**Environment-Specific Details:**
- Deployed URL: http://gateway-production-99ee.up.railway.app/
- Workspace ID: 019cbd70-ed45-78c3-8c8b-8bad3e59aadd
- Project ID: 019cba2c-3f4c-7080-81fa-fb8e9a6d5b2d
- URL Pattern: `/w/{workspace_id}/p/{project_id}/apps`

**Apps Found on Deployment:**
1. test-app-1772704916295 (chat) - created 05 Mar 2026
2. test-app-1772704902499 (completion) - created 05 Mar 2026

**The Problem:**
Looking at line 19 in `playground/tests.ts`:
```typescript
const playgroundPath = `${scopedPrefix}/apps/${appId}/playground`
```

The code tries to extract the workspace/project prefix from the current URL, but the navigation to the playground page itself may be failing because:
1. The `page.goto(playgroundPath)` might not be constructing the correct URL
2. The page might need to interact with the app row to navigate rather than using direct URL navigation
3. The URL pattern might have changed in the deployed version

### Chrome Extension Investigation (Verified via Browser)

Used Chrome extension to manually navigate the deployed UI. Key findings:

**Login Flow:**
- Auth page at `/auth?redirectToPath=%2Fw`
- Enter email → "Continue" → Enter password → "Continue with password"
- Redirects to `/w/{workspace_id}/p/{project_id}/apps` (the Home/dashboard page)

**Dashboard (Home):**
- Shows "Welcome, What do you want to do?" with action cards
- Sidebar navigation: Home, **Prompts** (not "Apps"), Test sets, Evaluators, Evaluations, Observability
- "Prompts" link goes to `/prompts`

**Prompts Page (`/prompts`):**
- Table with columns: Name, Date modified, Type
- Apps listed: test-app-1772704916295 (chat), test-app-1772704902499 (completion)
- Clicking a row navigates to `/apps/{app_id}/overview` (NOT `/apps/{app_id}/playground`)

**App Overview Page (`/apps/{app_id}/overview`):**
- Shows app-specific sidebar: Overview, **Playground**, Registry, Evaluations, Observability
- Dashboard widgets: Requests, Latency, Cost, Tokens
- Deployment section: Development, Staging, Production

**Playground Navigation (CRITICAL BUG FOUND):**
- Clicking "Playground" in app sidebar → navigates to `/apps/{app_id}/playground` → **content loads correctly**
- Direct URL navigation to `/apps/{app_id}/playground` → **page shell loads but content area is BLANK**
- Even after 15+ seconds, playground content never renders on direct URL navigation
- This is a frontend client-side state dependency issue

**Playground UI (when loaded correctly):**
- Left panel: Variant selector ("default"), model selector ("gpt-4o-mini"), system prompt editor
- Right panel: "Generations" with input fields, Chat area, "Run" button
- Top bar: "Run Evaluation", "+ Compare" buttons
- Bottom: "Run" and "+ Message" buttons
- Also has "Run all" button in top-right of Generations panel

### Resolution

**Root Cause Confirmed via Chrome:**
Direct URL navigation to `/apps/{appId}/playground` does NOT work - the playground content area stays blank. Navigation must go through:
1. Go to `/prompts` (or `/apps`)
2. Click on the app row → lands on `/apps/{app_id}/overview`
3. Click "Playground" in app sidebar → loads playground correctly

**The Fix:**
Modified `navigateToPlayground` fixture in `web/oss/tests/playwright/acceptance/playground/tests.ts`:

```typescript
// Navigate to prompts page, click app row, then click Playground in sidebar
await page.goto("/apps", {waitUntil: "domcontentloaded"})
const app = await apiHelpers.getAppById(appId)
const appRow = page.locator(`tr:has-text("${app.app_name}")`).first()
await expect(appRow).toBeVisible({timeout: 10000})
await appRow.click()
// Wait for overview page, then click Playground
await page.locator('a:has-text("Playground")').click()
await uiHelpers.expectPath(`/apps/${appId}/playground`)
```

**Additional Changes:**
- Added `getAppById()` helper function to `web/tests/tests/fixtures/base.fixture/apiHelpers/index.ts`
- Updated ApiHelpers interface in `web/tests/tests/fixtures/base.fixture/apiHelpers/types.d.ts`

### Test Run Results (after all fixes)

**Passing (2):**
- smoke.spec.ts (auth + navigation)
- app/create.spec.ts (completion + chat app creation)

**Failing (4) - all due to environment/config, not test code:**
- playground/completion - Navigation works! Playground loads! Fails at Run: "No API key found for model 'gpt-4o-mini'"
- playground/chat - Navigation works! Playground loads! Fails at Run: same API key error
- playground/save-changes - Fails waiting for "Updating playground with new revision..." (commit might also need API key)
- prompt-registry - Heading locator mismatch (separate issue)

### Fixes Applied
1. `navigateToPlayground` rewritten to use Overview → Sidebar click flow (avoids blank playground bug on direct URL nav)
2. Added `page.waitForLoadState("networkidle")` before clicking Playground (fixes intermittent blank content)
3. Fixed race condition: API response listener set up BEFORE `page.goto()`
4. `"Enter value"` → `"Enter a value"` (completion input placeholder)
5. `"Type a message..."` → `"Type your message…"` (chat input placeholder, Unicode ellipsis)
6. Removed dependency on `getAppById` helper in navigateToPlayground (uses inline API response)

### Final Test Results (all fixes applied)

**Passing (10):**
- smoke.spec.ts - Auth and navigation
- app/create.spec.ts - Completion app creation
- app/create.spec.ts - Chat app creation
- playground/run-variant.spec.ts - Completion single view variant
- playground/run-variant.spec.ts - Chat single view variant
- playground/run-variant.spec.ts - Update prompt and save changes
- deployment/deploy-variant.spec.ts - Deploy variant to development
- observability/observability.spec.ts - View traces
- settings/model-hub.spec.ts - View model providers
- prompt-registry/prompt-registry-flow.spec.ts - Open prompt details

**Skipped (2):**
- settings/api-keys-management.spec.ts - Permanently skipped (requires extra setup)
- testsset/testset.spec.ts - Skipped when no testsets exist on deployment

**Status:** All 12 OSS Playwright tests stabilized (10 pass, 2 skip gracefully).

### BDD Feature Files

Created Gherkin-format BDD feature files in `web/oss/tests/playwright/acceptance/features/`:

| Feature File | Test File(s) |
|---|---|
| `smoke.feature` | `smoke.spec.ts` |
| `app-creation.feature` | `app/create.spec.ts` |
| `playground.feature` | `playground/run-variant.spec.ts` |
| `deployment.feature` | `deployment/deploy-variant.spec.ts` |
| `observability.feature` | `observability/observability.spec.ts` |
| `prompt-registry.feature` | `prompt-registry/prompt-registry-flow.spec.ts` |
| `settings.feature` | `settings/model-hub.spec.ts` |
| `testsets.feature` | `testsset/testset.spec.ts` |

Each feature file includes implementation notes documenting caveats and navigation patterns.
