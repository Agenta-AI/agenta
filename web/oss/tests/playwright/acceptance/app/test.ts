import {test as baseTest} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"

import {AppType} from "./assets/types"
import type {AppFixtures, CreateAppResponse} from "./assets/types"

/**
 * App-specific test fixtures extending the base test fixture.
 * Provides high-level actions for app management tests.
 *
 * NOTE: As of the app-create drawer alignment redesign, app creation
 * goes through:
 *   1. Click the "Create New Prompt" dropdown trigger on /apps
 *   2. Pick "Chat" or "Completion" from the dropdown menu
 *   3. The drawer opens with an ephemeral local-* entity
 *   4. (optionally) edit the name in the drawer header
 *   5. Click Commit inside the drawer to create the app
 *   6. Drawer closes and user lands on /apps/<id>/playground
 *
 * Custom workflow uses a separate path (not covered by this fixture today).
 */
const testWithAppFixtures = baseTest.extend<AppFixtures>({
    /**
     * Navigates to the apps dashboard and verifies page load.
     */
    navigateToApps: async ({page, uiHelpers: _uiHelpers}, use) => {
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
     * Drives the lazy-create-via-drawer flow:
     *   open dropdown → pick type → drawer opens → set name → commit → wait for nav
     *
     * @param appName - Name for the new app (set inline in the drawer header)
     * @param appType - Chat or Completion
     * @returns CreateAppResponse with the created workflow's id + name
     */
    createNewApp: async ({page, uiHelpers}, use) => {
        await use(async (appName: string, appType: AppType) => {
            // 1. Open the dropdown
            const trigger = page.getByTestId("create-app-dropdown-trigger").first()
            await expect(trigger).toBeVisible({timeout: 15000})
            await trigger.click()

            // 2. Pick the matching menu item
            const itemTestId =
                appType === AppType.CHAT_PROMPT
                    ? "create-app-dropdown-chat"
                    : "create-app-dropdown-completion"
            const menuItem = page.getByTestId(itemTestId).first()
            await expect(menuItem).toBeVisible({timeout: 15000})
            await menuItem.click()

            // 3. Drawer opens with the ephemeral entity. Find the inline
            //    name input in the drawer header and replace its value.
            const drawer = page.getByRole("dialog").last()
            await expect(drawer).toBeVisible({timeout: 15000})

            const nameInput = page.getByTestId("app-create-name-input").first()
            await expect(nameInput).toBeVisible({timeout: 15000})
            await nameInput.click()
            await nameInput.fill(appName)
            // Blur so the workflow draft picks up the new name (the input
            // commits on blur via the onBlur handler).
            await nameInput.blur()

            // 4. Set up the network listener BEFORE clicking commit, so we
            //    capture the workflow create POST.
            const createAppPromise = page.waitForResponse((response) => {
                if (
                    !response.url().includes("/workflows") ||
                    response.request().method() !== "POST"
                ) {
                    return false
                }
                const payload = response.request().postData() ?? ""
                return payload.includes(appName)
            })

            // 5. Click the Commit button. The drawer's commit flow promotes
            //    the ephemeral local-* entity to a real workflow. The
            //    drawer typically opens a confirmation modal — accept it.
            await uiHelpers.clickButton("Commit", drawer)
            // Some drawer commit buttons open a confirmation modal first.
            const confirmDialog = page.getByRole("dialog").last()
            const confirmButton = confirmDialog.getByRole("button", {name: /commit|create/i})
            const confirmVisible = await confirmButton.isVisible().catch(() => false)
            if (confirmVisible) {
                await confirmButton.click()
            }

            // 6. Wait for the response and the navigation.
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
     */
    verifyAppCreation: async ({uiHelpers}, use) => {
        await use(async (appName: string) => {
            await uiHelpers.expectText(appName, {
                multiple: true,
            })
        })
    },
})

export {expect, testWithAppFixtures as test}
