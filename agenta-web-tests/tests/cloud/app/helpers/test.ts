import { expect } from "@playwright/test";
import {
  test as baseTest,
  createAuthTest,
} from "../../../fixtures/user.fixture";
import type { AppFixtures, AppActions, CreateAppResponse } from "../types";

/**
 * App-specific test fixtures extending the base test fixture.
 * Provides high-level actions for app management tests.
 */
const testWithAppFixtures = baseTest.extend<AppFixtures>({
  /**
   * Navigates to the apps dashboard and verifies page load.
   * Uses base fixture's page navigation and text validation.
   */
  navigateToApps: async ({ page, uiHelpers }, use) => {
    await use(async () => {
      await page.goto("/apps");
      await uiHelpers.expectText("App Management", {
        role: "heading",
      });
    });
  },

  /**
   * Creates a new app and validates both UI flow and API response.
   *
   * @param appName - Name for the new app
   * @returns CreateAppResponse containing app details from API
   *
   * Flow:
   * 1. Setup API response listener
   * 2. Execute UI interactions for app creation
   * 3. Validate API response
   * 4. Confirm navigation to playground
   */
  createNewApp: async ({ page, uiHelpers, apiHelpers }, use) => {
    await use(async (appName: string, appType) => {
      const createAppPromise = apiHelpers.waitForApiResponse<CreateAppResponse>(
        {
          route: "/api/apps/app_and_variant_from_template",
          validateStatus: true,
          responseHandler: (data) => {
            expect(data.app_id).toBeTruthy();
            expect(data.app_name).toBe(appName);
            expect(data.created_at).toBeTruthy();
          },
        }
      );

      await uiHelpers.clickButton("Create new app");
      await uiHelpers.typeWithDelay(
        'input[placeholder="Enter a name"]',
        appName
      );
      await page.getByText(appType).first().click();
      const dialog = page.getByRole("dialog");
      await uiHelpers.clickButton("Create new app", dialog);

      const response = await createAppPromise;
      await page.waitForURL(/\/apps\/.*\/playground/);
      return response;
    });
  },

  /**
   * Verifies successful app creation in the UI.
   *
   * @param appName - Name of the created app to verify
   *
   * Checks:
   * 1. Loading state appears and disappears
   * 2. App name is visible in the UI
   * 3. Loading indicator is gone
   */
  verifyAppCreation: async ({ uiHelpers }, use) => {
    await use(async (appName: string) => {
      await uiHelpers.waitForLoadingState("Loading variants...");
      await uiHelpers.expectText(appName, {
        multiple: true,
      });
    });
  },
});

// Then create auth-enabled test
export const test = createAuthTest<AppFixtures>(testWithAppFixtures);
export { expect };
