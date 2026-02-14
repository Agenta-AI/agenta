import {test as baseTest} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"

import type {AppFixtures, CreateAppResponse} from "./assets/types"

/**
 * App-specific test fixtures extending the base test fixture.
 * Provides high-level actions for app management tests.
 */
const testWithAppFixtures = baseTest.extend<AppFixtures>({
    /**
     * Navigates to the apps dashboard and verifies page load.
     * Uses base fixture's page navigation and text validation.
     */
    navigateToApps: async ({page, uiHelpers}, use) => {
        await use(async () => {
            await page.goto("/apps")
            await page.waitForURL("**/apps", {waitUntil: "domcontentloaded"})
            await uiHelpers.expectText("App Management", {
                role: "heading",
            })
        })
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
    createNewApp: async ({page, uiHelpers, apiHelpers}, use) => {
        await use(async (appName: string, appType) => {
            await uiHelpers.clickButton("Create New Prompt")

            const input = page.getByRole("textbox", {name: "Enter a name"})
            let dialog = page.getByRole("dialog")

            // Wait for dialog with a short timeout
            const isDialogVisible = await dialog.isVisible().catch(() => false)

            // If dialog is not visible, click the button and wait for it
            if (!isDialogVisible) {
                await uiHelpers.clickButton("Create New Prompt")
                dialog = page.getByRole("dialog")
                await expect(dialog).toBeVisible()
            }
            await expect(input).toBeVisible()
            const dialogTitle = dialog.getByText("Create New Prompt").first()
            await expect(dialogTitle).toBeVisible()
            await uiHelpers.typeWithDelay('input[placeholder="Enter a name"]', appName)
            await page.getByText(appType).first().click()
            await uiHelpers.clickButton("Create New Prompt", dialog)
            const createAppPromise = apiHelpers.waitForApiResponse<CreateAppResponse>({
                route: "/variant/from-template",
                validateStatus: true,
                responseHandler: (data) => {
                    expect(data.app_id).toBeTruthy()
                    expect(data.app_name).toBe(appName)
                    expect(data.created_at).toBeTruthy()
                },
            })
            const response = await createAppPromise
            await page.waitForURL(/\/apps\/.*\/playground/)
            return response
        })
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
    verifyAppCreation: async ({uiHelpers}, use) => {
        await use(async (appName: string) => {
            await uiHelpers.waitForLoadingState("Loading Playground...")
            await uiHelpers.expectText(appName, {
                multiple: true,
            })
        })
    },
})

// Then create auth-enabled test
// export const test = testWithAppFixtures
// createAuthTest<AppFixtures>(testWithAppFixtures);
export {expect, testWithAppFixtures as test}
