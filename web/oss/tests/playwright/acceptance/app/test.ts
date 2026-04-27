import {test as baseTest} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"
import type {Locator} from "@playwright/test"

import {APP_TYPE_LABELS} from "./assets/types"
import type {AppFixtures, CreateAppResponse} from "./assets/types"

const selectCreatePromptType = async (dialog: Locator, appTypeLabel: string) => {
    await expect(dialog.getByText("Choose the prompt type", {exact: true})).toBeVisible({
        timeout: 15000,
    })

    const appTypeCards = dialog.locator(".ant-card")
    await expect(appTypeCards.first()).toBeVisible({timeout: 15000})

    const matchingCards = appTypeCards.filter({hasText: new RegExp(appTypeLabel, "i")})
    await expect.poll(async () => await matchingCards.count(), {timeout: 15000}).toBeGreaterThan(0)

    const appTypeCard = matchingCards.first()
    await expect(appTypeCard).toBeVisible({timeout: 15000})

    const appTypeRadio = appTypeCard.locator('input[type="radio"]').first()
    const isSelected = async () => {
        if ((await appTypeRadio.count().catch(() => 0)) > 0) {
            return await appTypeRadio.isChecked().catch(() => false)
        }

        const checkedRadio = appTypeCard.locator(".ant-radio-checked").first()
        return await checkedRadio.isVisible().catch(() => false)
    }

    if (!(await isSelected())) {
        await appTypeCard.click()
    }

    await expect.poll(isSelected, {timeout: 15000}).toBe(true)
}

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
            const appsHeading = page.getByRole("heading", {
                name: /Applications|App Management/i,
            })
            await expect(appsHeading.first()).toBeVisible()
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
    createNewApp: async ({page, uiHelpers}, use) => {
        await use(async (appName: string, appType) => {
            await uiHelpers.clickButton("Create New Prompt")

            let dialog = page.getByRole("dialog").last()

            // Wait for dialog with a short timeout
            const isDialogVisible = await dialog.isVisible().catch(() => false)

            // If dialog is not visible, click the button and wait for it
            if (!isDialogVisible) {
                await uiHelpers.clickButton("Create New Prompt")
                dialog = page.getByRole("dialog").last()
                await expect(dialog).toBeVisible()
            }
            const input = dialog.getByRole("textbox", {name: "Enter a name"})
            await expect(input).toBeVisible()
            const dialogTitle = dialog.getByText("Create New Prompt").first()
            await expect(dialogTitle).toBeVisible()
            await uiHelpers.typeWithDelay('input[placeholder="Enter a name"]', appName)
            const appTypeLabel = APP_TYPE_LABELS[appType]
            await selectCreatePromptType(dialog, appTypeLabel)
            const createAppPromise = page.waitForResponse((response) => {
                if (
                    !response.url().includes("/workflows") ||
                    response.request().method() !== "POST"
                ) {
                    return false
                }

                const payload = response.request().postData() || ""
                return payload.includes(appName)
            })
            await uiHelpers.clickButton("Create New Prompt", dialog)
            const createAppResponse = await createAppPromise
            expect(createAppResponse.ok()).toBe(true)

            const response = (await createAppResponse.json()) as CreateAppResponse
            expect(response.workflow.id).toBeTruthy()
            expect(response.workflow.name).toBe(appName)
            expect(response.workflow.created_at).toBeTruthy()
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
