import {test as baseTest} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"
import {RoleType, VariantFixtures} from "./assets/types"
import {getKnownLatestRevisionId} from "@agenta/web-tests/tests/fixtures/base.fixture/apiHelpers"

const SECRET_PROPAGATION_TIMEOUT_MS = 65_000
const SECRET_PROPAGATION_POLL_MS = 5_000

const isSecretPropagationFailure = (response: Record<string, any> | null): boolean => {
    const raw = JSON.stringify(response ?? {}).toLowerCase()
    return raw.includes("invalid-secrets") || raw.includes("no api key found for model")
}

const waitForSuccessfulRun = async (
    triggerRun: () => Promise<void>,
    waitForRunResponse: () => Promise<Record<string, any> | null>,
) => {
    const deadline = Date.now() + SECRET_PROPAGATION_TIMEOUT_MS
    let attempt = 0
    let lastResponse: Record<string, any> | null = null

    while (Date.now() <= deadline) {
        attempt += 1
        const runResponsePromise = waitForRunResponse()
        await triggerRun()
        lastResponse = await runResponsePromise

        if (!lastResponse || !isSecretPropagationFailure(lastResponse)) {
            return lastResponse
        }

        if (Date.now() + SECRET_PROPAGATION_POLL_MS > deadline) {
            break
        }

        console.warn(
            `[Playground E2E] Run attempt ${attempt} hit secret propagation delay. Retrying...`,
        )
        await new Promise((resolve) => setTimeout(resolve, SECRET_PROPAGATION_POLL_MS))
    }

    throw new Error(
        `Run did not recover from secret propagation within ${SECRET_PROPAGATION_TIMEOUT_MS}ms. Last response: ${JSON.stringify(lastResponse)}`,
    )
}

/**
 * Playground-specific test fixtures extending the base test fixture.
 * Provides high-level actions for playground tests.
 */
const testWithVariantFixtures = baseTest.extend<VariantFixtures>({
    navigateToPlayground: async ({page, uiHelpers}, use) => {
        await use(async (appId: string) => {
            const currentPathname = new URL(page.url()).pathname
            const scopedPrefixMatch = currentPathname.match(/^(\/w\/[^/]+\/p\/[^/]+)/)
            const scopedPrefix = scopedPrefixMatch?.[1] ?? ""
            const appsUrl = scopedPrefix ? `${scopedPrefix}/apps` : "/apps"
            const overviewUrl = scopedPrefix
                ? `${scopedPrefix}/apps/${appId}/overview`
                : `/apps/${appId}/overview`
            const playgroundUrl = scopedPrefix
                ? `${scopedPrefix}/apps/${appId}/playground`
                : `/apps/${appId}/playground`

            await page.goto(appsUrl, {waitUntil: "domcontentloaded"})
            await uiHelpers.expectPath("/apps")

            // Enter the app through its scoped overview route, then switch to Playground
            // from the in-app sidebar. Direct Playground entry is still flaky on this branch.
            await page.goto(overviewUrl, {waitUntil: "domcontentloaded"})
            await uiHelpers.expectPath(`/apps/${appId}/overview`)
            // await page.waitForLoadState("networkidle") // TODO: Re-enable when ready

            const playgroundLink = page.getByRole("link", {name: "Playground"}).first()
            await expect(playgroundLink).toBeVisible({timeout: 10000})
            await playgroundLink.click()

            await uiHelpers.expectPath(`/apps/${appId}/playground`)

            const latestRevisionId = getKnownLatestRevisionId(appId)
            if (latestRevisionId) {
                await page.goto(`${playgroundUrl}?revisions=${latestRevisionId}`, {
                    waitUntil: "domcontentloaded",
                })
                await uiHelpers.expectPath(`/apps/${appId}/playground`)
            }

            await expect(page.getByRole("button", {name: "Run", exact: true}).first()).toBeVisible({
                timeout: 30000,
            })
        })
    },

    runCompletionSingleViewVariant: async (
        {page, uiHelpers, apiHelpers, testProviderHelpers},
        use,
    ) => {
        await use(async (appId: string, messages: string[]) => {
            await testProviderHelpers.selectTestModel()

            for (let i = 0; i < messages.length; i++) {
                // 1. Load the message
                const message = messages[i]
                await expect(typeof message).toBe("string")

                // 2. Find out the empty textbox
                const textboxes = page.locator(
                    '.agenta-shared-editor:has(div:text-is("Enter a value")) [role="textbox"]',
                )
                const targetTextbox = textboxes.first()

                await targetTextbox.scrollIntoViewIfNeeded()
                await targetTextbox.click({force: true})
                await targetTextbox.pressSequentially(message, {delay: 50})

                // 3. Target the corresponding Run button
                const runButtons = page.getByRole("button", {name: "Run", exact: true})
                await waitForSuccessfulRun(
                    async () => {
                        await runButtons.nth(i).click({force: true})
                    },
                    async () => {
                        return await apiHelpers.waitForApiResponse<Record<string, any>>({
                            route: /\/invoke(\?|$)/,
                            method: "POST",
                            validateStatus: false,
                        })
                    },
                )

                await uiHelpers.expectNoText("Click run to generate output")
                await expect(page.getByText("Error").first()).not.toBeVisible()

                if (i === messages.length - 1) {
                    continue
                }

                // 5. Add a new testcase only when another input still needs to be executed.
                const testcaseButton = page.getByRole("button", {name: "Test case"})
                await expect(testcaseButton).toBeVisible()
                await testcaseButton.scrollIntoViewIfNeeded()
                await testcaseButton.click()
            }
        })
    },

    runChatSingleViewVariant: async ({page, uiHelpers, apiHelpers, testProviderHelpers}, use) => {
        await use(async (appId: string, messages: string[]) => {
            let isMessageButtonDisabled = false
            await testProviderHelpers.selectTestModel()

            for (let i = 0; i < messages.length; i++) {
                if (isMessageButtonDisabled) {
                    break
                }

                // 1. Load the message
                const message = messages[i]
                await expect(typeof message).toBe("string")

                // 2. Find out the empty chat textbox
                const targetTextbox = page.locator(
                    '.agenta-shared-editor:has(div:text-is("Type your message\u2026")) [role="textbox"]',
                )

                await targetTextbox.scrollIntoViewIfNeeded()
                await targetTextbox.click({force: true})
                await targetTextbox.pressSequentially(message, {delay: 50})

                // 3. Target the corresponding Run button
                const runButtons = page.getByRole("button", {name: "Run", exact: true})
                await waitForSuccessfulRun(
                    async () => {
                        await runButtons.click({force: true})
                    },
                    async () => {
                        return await apiHelpers.waitForApiResponse<Record<string, any>>({
                            route: /\/invoke(\?|$)/,
                            method: "POST",
                            validateStatus: false,
                        })
                    },
                )

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

                    // 5. Wait for the commit modal to close (indicates success)
                    await expect(page.locator(".ant-modal")).not.toBeVisible({timeout: 30000})
                }
            },
        )
    },
})

export {testWithVariantFixtures as test}
