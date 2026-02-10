import {test as baseTest} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"
import {RoleType, VariantFixtures} from "./assets/types"

/**
 * Playground-specific test fixtures extending the base test fixture.
 * Provides high-level actions for playground tests.
 */
const testWithVariantFixtures = baseTest.extend<VariantFixtures>({
    navigateToPlayground: async ({page, uiHelpers}, use) => {
        await use(async (appId: string) => {
            await page.goto(`/apps/${appId}/playground`)
            await uiHelpers.expectPath(`/apps/${appId}/playground`)

            await uiHelpers.waitForLoadingState("Loading Playground...")

            // Confirm Playground is loaded
            await uiHelpers.expectText("Generations", {exact: true})
        })
    },

    runCompletionSingleViewVariant: async ({page, uiHelpers, apiHelpers}, use) => {
        await use(async (appId: string, messages: string[]) => {
            for (let i = 0; i < messages.length; i++) {
                // 1. Load the message
                const message = messages[i]
                await expect(typeof message).toBe("string")

                // 2. Find out the empty textbox
                const textboxes = page.locator(
                    '.agenta-shared-editor:has(div:text-is("Enter value")) [role="textbox"]',
                )
                const targetTextbox = textboxes.first()

                await targetTextbox.scrollIntoViewIfNeeded()
                await targetTextbox.click()
                await targetTextbox.pressSequentially(message, {delay: 50})

                // 3. Target the corresponding Run button
                const runButtons = page.getByRole("button", {name: "Run", exact: true})

                await runButtons.nth(i).click()

                await apiHelpers.waitForApiResponse<Record<string, any>>({
                    route: /\/test(\?|$)/,
                    method: "POST",
                })

                await uiHelpers.expectNoText("Click run to generate output")
                await expect(page.getByText("Error").first()).not.toBeVisible()

                // 5. Add a new Testcase
                const testcaseButton = page.getByRole("button", {name: "Test case"})
                await testcaseButton.scrollIntoViewIfNeeded()
                await testcaseButton.click()
            }
        })
    },

    runChatSingleViewVariant: async ({page, uiHelpers, apiHelpers}, use) => {
        await use(async (appId: string, messages: string[]) => {
            let isMessageButtonDisabled = false

            for (let i = 0; i < messages.length; i++) {
                if (isMessageButtonDisabled) {
                    break
                }

                // 1. Load the message
                const message = messages[i]
                await expect(typeof message).toBe("string")

                // 2. Find out the empty chat textbox
                const targetTextbox = page.locator(
                    '.agenta-shared-editor:has(div:text-is("Type a message...")) [role="textbox"]',
                )

                await targetTextbox.scrollIntoViewIfNeeded()
                await targetTextbox.click()
                await targetTextbox.pressSequentially(message, {delay: 50})

                // 3. Target the corresponding Run button
                const runButtons = page.getByRole("button", {name: "Run", exact: true})

                await runButtons.click()

                await apiHelpers.waitForApiResponse<Record<string, any>>({
                    route: /\/test(\?|$)/,
                    method: "POST",
                })

                await expect(page.getByText("Error").first()).not.toBeVisible()

                // 5. Stop the execution if failure is present
                const hasFailureText = await page.getByText("Error").first().isVisible()
                if (hasFailureText) {
                    isMessageButtonDisabled = true
                }
            }
        })
    },

    addNewPrompt: async ({page}, use) => {
        await use(async (promptMessages: {prompt: string; role: RoleType}[]) => {
            for (const {prompt, role} of promptMessages) {
                // 1. Verify the prompt and role are strings
                expect(typeof prompt).toBe("string")
                expect(typeof role).toBe("string")

                // 2. Click on the message button to create a new prompt
                await page.getByRole("button", {name: "Message"}).first().click()

                // 3. Find the empty editor input
                const emptyEditorLocator = page
                    .locator(
                        `.agenta-shared-editor .editor-input[role="textbox"]:has(p:empty), ` +
                            `.agenta-shared-editor .editor-input[role="textbox"]:has(p:has(br:only-child))`,
                    )
                    .first()

                await expect(emptyEditorLocator).toBeVisible()

                // Get the parent agenta-shared-editor element
                const editorContainer = emptyEditorLocator.locator(
                    'xpath=ancestor::div[contains(@class, "agenta-shared-editor")]',
                )

                // Click the role button and select the new role
                const roleButton = editorContainer.getByRole("button").first()
                await roleButton.click()

                // Wait for the dropdown to render and become stable, then click the menu item
                const menuItem = page.getByRole("menuitem", {name: role}).first()
                await expect(menuItem).toBeVisible()
                await menuItem.scrollIntoViewIfNeeded()
                await menuItem.click()

                // 4. Add the prompt
                await emptyEditorLocator.click()
                await emptyEditorLocator.pressSequentially(prompt, {delay: 50})

                // 5. Verify the prompt is added
                await expect(page.getByText(prompt).first()).toBeVisible()
            }
        })
    },

    changeVariableKeys: async ({page}, use) => {
        await use(async (variables: {oldKey: string; newKey: string}[]) => {
            for (const {oldKey, newKey} of variables) {
                // 1. Verify the variable name and value are strings
                expect(typeof oldKey).toBe("string")
                expect(typeof newKey).toBe("string")

                // 2. Find every editor that contains the key
                const editors = page.locator(
                    '.agenta-shared-editor .editor-input[role="textbox"]',
                    {hasText: oldKey},
                )

                // 3. Continuously replace until no editor contains the key
                const editorCount = await editors.count()
                let remaining = editorCount

                while (remaining > 0) {
                    const editor = editors.first()
                    const updated = (await editor.innerText()).replaceAll(oldKey, newKey)
                    await editor.fill(updated)

                    // Re-query to get fresh list after DOM update
                    remaining = await editors.count()
                }

                // 4. Assert the old key no longer exists and new key is present
                await expect(page.getByText(oldKey)).toHaveCount(0)
                await expect(page.getByText(newKey).first()).toBeVisible()
            }
        })
    },

    saveVariant: async ({page, uiHelpers}, use) => {
        await use(
            async (
                type: "version" | "variant",
                note?: string,
                revisionId?: string, // we can make use of it when trying to save something on compare mode
                variantName?: string,
            ) => {
                // Ensure variant name is provided when saving as a new variant
                if (type === "variant" && (!variantName || variantName.trim() === "")) {
                    throw new Error("variantName must be provided when type is 'variant'")
                }

                // 1. Click on the save button
                const commitButton = page.getByRole("button", {name: "Commit"})
                const isCommitButtonDisabled = await commitButton.isDisabled()

                if (!isCommitButtonDisabled) {
                    await commitButton.click()

                    // 2. Select the type
                    await uiHelpers.selectOption({
                        label: type === "variant" ? "As a new variant" : "As a new version",
                    })

                    if (type === "variant") {
                        // If variant, enter the variant name
                        const variantInput = page.getByRole("textbox", {
                            name: "A unique variant name",
                        })
                        await variantInput.click()
                        await variantInput.pressSequentially(variantName || "", {delay: 50})
                    }

                    // 3. Enter the note if provided
                    if (note) {
                        const noteInput = page.getByRole("textbox", {
                            name: "Describe why you are deploying",
                        })
                        await noteInput.click()
                        await noteInput.pressSequentially(note || "", {delay: 50})
                    }

                    // 4. Confirm the modal
                    await uiHelpers.confirmModal("Commit")

                    // 5. Assert the success message
                    await uiHelpers.waitForLoadingState("Updating playground with new revision...")
                }
            },
        )
    },
})

export {testWithVariantFixtures as test}
