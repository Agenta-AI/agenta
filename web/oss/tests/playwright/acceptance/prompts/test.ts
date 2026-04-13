import {test as baseTest} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"

import type {PromptsFixtures} from "./assets/types"
import {getProjectScopedBasePath} from "@agenta/web-tests/tests/fixtures/base.fixture/apiHelpers"

/**
 * Prompts-specific test fixtures extending the base test fixture.
 * Provides high-level actions for prompts page tests.
 */
const testWithPromptsFixtures = baseTest.extend<PromptsFixtures>({
    /**
     * Navigates to the Prompts page and verifies it is displayed.
     * Checks that the "Create new" button is visible as the primary page landmark.
     */
    navigateToPrompts: async ({page}, use) => {
        await use(async () => {
            await page.goto(`${getProjectScopedBasePath(page)}/prompts`, {
                waitUntil: "domcontentloaded",
            })
            await page.waitForURL("**/prompts", {waitUntil: "domcontentloaded"})

            const createNewButton = page.getByRole("button", {name: /create new/i})
            await expect(createNewButton.first()).toBeVisible()
        })
    },

    /**
     * Opens the "New prompt" modal via the "Create new" dropdown and submits creation.
     *
     * Flow:
     * 1. Click "Create new" dropdown button
     * 2. Click the "New prompt" menu item
     * 3. Verify the modal opens with "Create New Prompt" title
     * 4. Fill in the app name
     * 5. Select the first available template card
     * 6. Click "Create New Prompt" to submit
     */
    createNewPrompt: async ({page, uiHelpers}, use) => {
        await use(async (promptName: string) => {
            // Open the dropdown
            const createNewButton = page.getByRole("button", {name: /create new/i}).first()
            await createNewButton.click()

            // Click "New prompt" in the dropdown menu
            const newPromptItem = page.getByText("New prompt").first()
            await expect(newPromptItem).toBeVisible()
            await newPromptItem.click()

            // Verify the modal opened
            const modal = page.getByRole("dialog").last()
            await expect(modal).toBeVisible()

            const modalTitle = modal.getByText("Create New Prompt").first()
            await expect(modalTitle).toBeVisible()

            // Fill in the app name
            const nameInput = modal.getByPlaceholder("Enter a name")
            await expect(nameInput).toBeVisible()
            await uiHelpers.typeWithDelay('input[placeholder="Enter a name"]', promptName)

            // Select the first available template card
            const templateCards = modal.locator(".ant-card")
            await expect(templateCards.first()).toBeVisible()
            await templateCards.first().click()

            // Submit creation
            const createButton = modal.getByRole("button", {name: "Create New Prompt"})
            await expect(createButton).toBeVisible()
            await createButton.click()
        })
    },

    /**
     * Opens the "New folder" modal via the "Create new" dropdown and creates a folder.
     *
     * Flow:
     * 1. Click "Create new" dropdown button
     * 2. Click the "New folder" menu item
     * 3. Verify the modal opens with "New folder" title
     * 4. Fill in the folder name
     * 5. Wait for the folder creation API response
     * 6. Click "Create" to submit
     */
    createNewFolder: async ({page, uiHelpers}, use) => {
        await use(async (folderName: string) => {
            // Open the dropdown
            const createNewButton = page.getByRole("button", {name: /create new/i}).first()
            await createNewButton.click()

            // Click "New folder" in the dropdown menu
            const newFolderItem = page.getByText("New folder").first()
            await expect(newFolderItem).toBeVisible()
            await newFolderItem.click()

            // Verify the modal opened
            const modal = page.getByRole("dialog").last()
            await expect(modal).toBeVisible()

            const modalTitle = modal.getByText("New folder").first()
            await expect(modalTitle).toBeVisible()

            // Fill in the folder name
            const folderInput = modal.getByPlaceholder("Untitled folder")
            await expect(folderInput).toBeVisible()
            await uiHelpers.typeWithDelay('input[placeholder="Untitled folder"]', folderName)

            // Set up response listener before clicking Create
            const createFolderPromise = page.waitForResponse((response) => {
                if (
                    !response.url().includes("/folders") ||
                    response.request().method() !== "POST"
                ) {
                    return false
                }

                const payload = response.request().postData() || ""
                return payload.includes(folderName) || payload.includes(folderName.toLowerCase())
            })

            // Submit creation
            const createButton = modal.getByRole("button", {name: "Create"})
            await expect(createButton).toBeEnabled()
            await createButton.click()

            const createFolderResponse = await createFolderPromise
            expect(createFolderResponse.ok()).toBe(true)
        })
    },
})

export {expect, testWithPromptsFixtures as test}
