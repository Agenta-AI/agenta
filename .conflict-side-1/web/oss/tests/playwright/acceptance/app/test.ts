import {test as baseTest} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {getProjectScopedBasePath} from "@agenta/web-tests/tests/fixtures/base.fixture/apiHelpers"
import {expect} from "@agenta/web-tests/utils"
import type {Locator, Page} from "@playwright/test"

import {AppType} from "./assets/types"
import type {AppFixtures, CreateAppResponse} from "./assets/types"

// Leaf testIds for the Chat/Completion entries in the "New prompt" submenu,
// under the "Create new" dropdown trigger on /prompts.
const TYPE_MENU_ITEM_TESTIDS: Record<AppType, string> = {
    [AppType.CHAT_PROMPT]: "prompts-new-prompt-chat",
    [AppType.COMPLETION_PROMPT]: "prompts-new-prompt-completion",
}

export const openCreateAppDrawerForType = async (
    page: Page,
    appType: AppType,
): Promise<Locator> => {
    const typeMenuItemTestId = TYPE_MENU_ITEM_TESTIDS[appType]
    const createTrigger = page.getByTestId("prompts-create-new-trigger").first()
    const newPromptMenuItem = page.getByTestId("prompts-new-prompt-menu-item").first()
    const typeSelector = page.getByTestId(typeMenuItemTestId).first()

    const drawer = page
        .getByRole("dialog")
        .filter({has: page.getByTestId("app-create-name-input")})
        .last()

    await expect(createTrigger).toBeVisible({timeout: 15000})

    for (let attempt = 0; attempt < 3; attempt += 1) {
        await createTrigger.click({force: attempt > 0})

        // The "New prompt" entry opens a Chat/Completion/Agent submenu on
        // hover (antd Menu's default triggerSubMenuAction) — click alone
        // won't reveal it.
        const menuItemVisible = await newPromptMenuItem
            .waitFor({state: "visible", timeout: 4000})
            .then(() => true)
            .catch(() => false)

        if (!menuItemVisible) {
            await page.keyboard.press("Escape").catch(() => undefined)
            continue
        }

        await newPromptMenuItem.hover()

        const typeSelectorVisible = await typeSelector
            .waitFor({state: "visible", timeout: 4000})
            .then(() => true)
            .catch(() => false)

        if (!typeSelectorVisible) {
            await page.keyboard.press("Escape").catch(() => undefined)
            continue
        }

        await typeSelector.click()

        // Check whether the drawer opened. If the click landed on a stale
        // element during re-render it won't appear — retry rather than throw.
        const drawerOpened = await drawer
            .waitFor({state: "visible", timeout: 8000})
            .then(() => true)
            .catch(() => false)

        if (drawerOpened) {
            return drawer
        }

        // Drawer didn't open — dismiss any leftover menu and try again.
        await page.keyboard.press("Escape").catch(() => undefined)
        await page.waitForTimeout(200)
    }

    // Final attempt: surfaces a clear failure if the drawer still won't open.
    await createTrigger.click()
    await newPromptMenuItem.hover()
    await expect(typeSelector).toBeVisible({timeout: 15000})
    await typeSelector.click()
    await expect(drawer).toBeVisible({timeout: 15000})
    return drawer
}

/**
 * App-specific test fixtures extending the base test fixture.
 * Provides high-level actions for app management tests.
 *
 * NOTE: As of the agent-centric nav redesign, the app list lives at
 * /prompts (the old /apps listing page and its "Applications"/"App
 * Management" heading are gone — /apps now redirects into onboarding).
 * App creation goes through:
 *   1. Click the "Create new" dropdown trigger on /prompts
 *   2. Hover "New prompt" to reveal the Chat/Completion/Agent submenu,
 *      then pick "Chat" or "Completion"
 *   3. The drawer opens with an ephemeral local-* entity
 *   4. (optionally) edit the name in the drawer header
 *   5. Click Commit inside the drawer to create the app
 *   6. Drawer closes and user lands on /apps/<id>/playground
 *
 * Custom workflow uses a separate path (not covered by this fixture today).
 */
const testWithAppFixtures = baseTest.extend<AppFixtures>({
    /**
     * Navigates to the prompts list and verifies page load.
     */
    navigateToApps: async ({page, uiHelpers: _uiHelpers}, use) => {
        await use(async () => {
            const projectBasePath = getProjectScopedBasePath(page)
            await page.goto(`${projectBasePath}/prompts`)
            await page.waitForURL("**/prompts", {waitUntil: "domcontentloaded"})
            const promptsHeading = page.getByRole("heading", {name: "Prompts"})
            await expect(promptsHeading.first()).toBeVisible()
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
            const createAppPromise = page.waitForResponse(
                (response) => {
                    if (
                        !response.url().includes("/workflows") ||
                        response.request().method() !== "POST"
                    ) {
                        return false
                    }
                    const payload = response.request().postData() ?? ""
                    return payload.includes(appName)
                },
                {timeout: 90000},
            )

            // 5. Click the "Create" button. CommitVariantChangesButton shows "Create"
            //    (not "Commit") for ephemeral local-* entities. Clicking it opens
            //    CommitVariantChangesModal (EntityCommitModal with actionLabel="Create").
            await uiHelpers.clickButton("Create", drawer)
            // The confirmation modal opens — accept it. Wait for the submit
            // button before clicking; isVisible() is an immediate snapshot and
            // can race the antd modal render.
            // The modal no longer wraps its buttons in a `.ant-modal-footer`
            // div (migrated off the raw antd Modal footer), so filter by the
            // "Create" button itself rather than the footer wrapper.
            const confirmModal = page
                .locator(".ant-modal-wrap")
                .filter({has: page.getByRole("button", {name: "Create", exact: true})})
                .last()
            const confirmButton = confirmModal.getByRole("button", {
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
            const projectBasePath = getProjectScopedBasePath(page)
            await page.goto(`${projectBasePath}/apps/${response.workflow.id}/playground`, {
                waitUntil: "domcontentloaded",
            })
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
