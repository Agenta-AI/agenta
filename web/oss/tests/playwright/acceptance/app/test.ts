import {test as baseTest} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"
import type {Locator, Page} from "@playwright/test"

import {AppType} from "./assets/types"
import type {AppFixtures, CreateAppResponse} from "./assets/types"

const TYPE_DROPDOWN_TESTIDS: Record<AppType, string> = {
    [AppType.CHAT_PROMPT]: "create-app-dropdown-chat",
    [AppType.COMPLETION_PROMPT]: "create-app-dropdown-completion",
}

const TYPE_MODAL_TESTIDS: Record<AppType, string> = {
    [AppType.CHAT_PROMPT]: "create-app-type-modal-chat",
    [AppType.COMPLETION_PROMPT]: "create-app-type-modal-completion",
}

export const openCreateAppDrawerForType = async (
    page: Page,
    appType: AppType,
): Promise<Locator> => {
    const dropdownTypeTestId = TYPE_DROPDOWN_TESTIDS[appType]
    const modalTypeTestId = TYPE_MODAL_TESTIDS[appType]
    const createEntryPoints = [
        page.getByTestId("create-app-dropdown-trigger").first(),
        page.getByText("Create a prompt", {exact: true}).first(),
    ]

    await expect
        .poll(
            async () => {
                for (const entryPoint of createEntryPoints) {
                    if (await entryPoint.isVisible().catch(() => false)) return true
                }
                return false
            },
            {timeout: 15000},
        )
        .toBe(true)

    const typeSelector = page
        .getByTestId(dropdownTypeTestId)
        .or(page.getByTestId(modalTypeTestId))
        .first()

    for (let attempt = 0; attempt < 3; attempt += 1) {
        for (const entryPoint of createEntryPoints) {
            if (!(await entryPoint.isVisible().catch(() => false))) continue

            await entryPoint.scrollIntoViewIfNeeded().catch(() => undefined)
            await entryPoint.click({force: attempt > 0})
            break
        }

        const opened = await typeSelector
            .waitFor({state: "visible", timeout: 3000})
            .then(() => true)
            .catch(() => false)

        if (opened) {
            await typeSelector.click()
            const drawer = page
                .getByRole("dialog")
                .filter({has: page.getByTestId("app-create-name-input")})
                .last()
            await expect(drawer).toBeVisible({timeout: 15000})
            return drawer
        }

        await page.keyboard.press("Escape").catch(() => undefined)
    }

    await expect(typeSelector).toBeVisible({timeout: 15000})
    await typeSelector.click()
    const drawer = page
        .getByRole("dialog")
        .filter({has: page.getByTestId("app-create-name-input")})
        .last()
    await expect(drawer).toBeVisible({timeout: 15000})
    return drawer
}

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
            // 1/2. Open the create menu/modal and pick the matching type.
            // 3. Drawer opens with the ephemeral entity.
            const drawer = await openCreateAppDrawerForType(page, appType)

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

            // 5. Click the "Create" button. CommitVariantChangesButton shows "Create"
            //    (not "Commit") for ephemeral local-* entities. Clicking it opens
            //    CommitVariantChangesModal (EntityCommitModal with actionLabel="Create").
            await uiHelpers.clickButton("Create", drawer)
            // The confirmation modal opens — accept it. Wait for the submit
            // button before clicking; isVisible() is an immediate snapshot and
            // can race the antd modal render.
            const confirmModal = page
                .locator(".ant-modal-wrap")
                .filter({has: page.locator(".ant-modal-footer")})
                .last()
            const confirmButton = confirmModal.locator(".ant-modal-footer").getByRole("button", {
                name: "Create",
                exact: true,
            })
            await expect(confirmModal).toBeVisible({timeout: 15000})
            await expect(confirmButton).toBeVisible({timeout: 15000})
            await expect(confirmButton).toBeEnabled({timeout: 15000})
            await confirmButton.click({force: true})

            // 6. Wait for the create response and for the confirmation modal
            //    to close. The current create flow returns to /apps; callers
            //    assert the created app is visible there.
            const createAppResponse = await createAppPromise
            expect(createAppResponse.ok()).toBe(true)

            const response = (await createAppResponse.json()) as CreateAppResponse
            expect(response.workflow.id).toBeTruthy()
            expect(response.workflow.name).toBe(appName)
            expect(response.workflow.created_at).toBeTruthy()
            await expect(page.locator(".ant-modal-wrap:visible")).toHaveCount(0, {
                timeout: 15000,
            })
            await page.goto(
                `${page.url().replace(/\/apps(?:\/.*)?$/, "/apps")}/${response.workflow.id}/playground`,
                {
                    waitUntil: "domcontentloaded",
                },
            )
            return response
        })
    },

    /**
     * Verifies successful app creation in the UI.
     */
    verifyAppCreation: async ({uiHelpers}, use) => {
        await use(async (appName: string) => {
            await uiHelpers.expectText(appName, {
                exact: true,
                multiple: true,
            })
        })
    },
})

export {expect, testWithAppFixtures as test}
