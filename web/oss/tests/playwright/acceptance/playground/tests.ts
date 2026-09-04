import {test as baseTest} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {getKnownLatestRevisionId} from "@agenta/web-tests/tests/fixtures/base.fixture/apiHelpers"
import {expect, pollLocatorState} from "@agenta/web-tests/utils"

import {RoleType, VariantFixtures} from "./assets/types"

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
            const playgroundUrl = scopedPrefix
                ? `${scopedPrefix}/apps/${appId}/playground`
                : `/apps/${appId}/playground`

            await page.goto(appsUrl, {waitUntil: "domcontentloaded"})
            await uiHelpers.expectPath("/apps")

            await page.goto(playgroundUrl, {waitUntil: "domcontentloaded"})
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

            // Wait for the playground to finish hydrating: at least one variable-card
            // input or prompt editor must be visible, and no loading spinners should
            // remain. Without this guard, selectTestModel / input locators can race
            // against components that are still mounting after the Run button appears.
            await expect
                .poll(
                    async () => {
                        const hasInput =
                            (await pollLocatorState(() =>
                                page
                                    .locator(
                                        ".agenta-variable-card, .agenta-shared-editor [role='textbox']",
                                    )
                                    .first()
                                    .isVisible(),
                            )) ||
                            (await pollLocatorState(() =>
                                page
                                    .locator(".agenta-shared-editor [role='textbox']")
                                    .first()
                                    .isVisible(),
                            ))
                        const hasSpinner = await pollLocatorState(() =>
                            page.locator(".ant-spin-spinning").isVisible(),
                        )
                        return hasInput && !hasSpinner
                    },
                    {timeout: 20000},
                )
                .toBe(true)
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
                // VariableCard renders antd TextArea (<textarea>), not SharedEditor.
                const textboxes = page.locator(".agenta-variable-card textarea:placeholder-shown")
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

                // 2. Find the empty chat message textbox.
                // Placeholder-based selectors ("Type your message\u2026" / "Enter message...") only
                // work when the editor is empty AND in rich-text mode. When the persisted
                // messageViewModeAtom is "text" (the default), Lexical switches to code/
                // markdown-source mode \u2014 the editor is no longer empty from Lexical's
                // perspective (it contains a CodeNode), so the placeholder div is not
                // rendered. Use the last .editor-input[role="textbox"] instead: in the
                // chat playground the user-message input is always the last editable editor.
                const getChatEditorLocator = () =>
                    page.locator('.agenta-shared-editor .editor-input[role="textbox"]').last()

                let targetTextbox = getChatEditorLocator()

                // If no editor is visible (empty messages array / json mode), click
                // "Message" / "Add message" to create an initial user turn, then re-query.
                const editorVisible = await pollLocatorState(() =>
                    targetTextbox.isVisible({timeout: 5000}),
                )
                if (!editorVisible) {
                    const addMsgButton = page
                        .getByRole("button", {name: /^(Message|Add message)$/i})
                        .first()
                    if (await pollLocatorState(() => addMsgButton.isVisible({timeout: 5000}))) {
                        await addMsgButton.click()
                        await expect(getChatEditorLocator()).toBeVisible({timeout: 10000})
                    }
                    targetTextbox = getChatEditorLocator()
                }

                await targetTextbox.scrollIntoViewIfNeeded()
                await targetTextbox.click({force: true})
                await targetTextbox.pressSequentially(message, {delay: 50})

                // 3. Target the corresponding Run button
                const runButtons = page.getByRole("button", {name: "Run", exact: true})
                await waitForSuccessfulRun(
                    async () => {
                        await runButtons.first().click({force: true})
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

                // 2. Click on the message button to create a new prompt slot.
                // Scope everything to the prompt template's own PromptSchemaControl
                // instance (data-testid="prompt-schema-control") rather than chaining
                // ancestor:: xpath hops off the "Message" button — the chat-turn controls
                // also render a "Message" button and .message-user-select role selectors,
                // and a global nth() can land on those instead of the prompt template.
                const promptControl = page.locator('[data-testid="prompt-schema-control"]').first()
                const messageButton = promptControl.getByRole("button", {
                    name: "Message",
                    exact: true,
                })
                const roleButtons = promptControl.locator(".message-user-select")
                // Each ChatMessageItem renders exactly one role selector and one editor
                // in the same order as the messages array, so the Nth role button and the
                // Nth editor input always belong to the same message row.
                const editorInputs = promptControl.locator('.editor-input[role="textbox"]')
                const msgCountBefore = await roleButtons.count()

                await messageButton.click()

                // 3. Wait for the newly added role selector to appear.
                await expect
                    .poll(async () => roleButtons.count(), {timeout: 15000})
                    .toBeGreaterThan(msgCountBefore)

                // The new role button/editor are always appended last in the template.
                const roleButton = roleButtons.nth(msgCountBefore)
                const emptyEditorLocator = editorInputs.nth(msgCountBefore)

                // Wait for the role button to be enabled (may be briefly disabled while the
                // ChatMessageList state settles after inserting the new message).
                await expect(roleButton).toBeEnabled({timeout: 15000})
                await expect(emptyEditorLocator).toBeVisible({timeout: 10000})

                // 4. Select the role
                await roleButton.click()

                // Wait for the dropdown to render and become stable, then click the menu item
                const menuItem = page.getByRole("menuitem", {name: role}).first()
                await expect(menuItem).toBeVisible()
                await menuItem.scrollIntoViewIfNeeded()
                await menuItem.click()

                // Wait for the role dropdown to fully unmount before continuing — while open
                // (or mid-close) its portal marks the rest of the page aria-hidden, which
                // blinds every getByRole()-based lookup below (see PR #5895 for the underlying
                // Presence/animation fix; this is a plain readiness wait, not a workaround).
                await expect(page.locator('[data-slot="dropdown-menu-content"]')).toHaveCount(0)

                // 5. Add the prompt
                await emptyEditorLocator.scrollIntoViewIfNeeded()
                await emptyEditorLocator.click()
                await emptyEditorLocator.pressSequentially(prompt, {delay: 50})

                // 6. Verify the prompt is added
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

                // 1. Click on the save button. Located by role, not `.ant-btn-primary`: the
                // button renders through EnhancedButton, now a facade over the Radix
                // @agenta/ui Button, which emits no antd classes.
                const commitButton = page.getByRole("button", {name: "Commit"}).first()
                // Assert visibility first — `isDisabled()` on a locator that matches nothing
                // hangs until the test timeout instead of reporting what is missing.
                await expect(commitButton).toBeVisible({timeout: 15000})
                const isCommitButtonDisabled = await commitButton.isDisabled()

                if (!isCommitButtonDisabled) {
                    await commitButton.click()

                    const commitModal = page.getByRole("dialog").last()
                    await expect(commitModal).toBeVisible({timeout: 15000})

                    // 2. Select the type. Agent-style commits use a SectionRail of
                    // plain buttons ("New version" / "New variant"), not a Radio.Group.
                    const saveModeButton = commitModal
                        .getByRole("button", {
                            name: type === "variant" ? "New variant" : "New version",
                            exact: true,
                        })
                        .first()
                    await expect(saveModeButton).toBeVisible({timeout: 15000})
                    await saveModeButton.click()

                    if (type === "variant") {
                        // If variant, enter the variant name
                        const variantInputByLabel = commitModal.getByRole("textbox", {
                            name: /Variant name/i,
                        })
                        const variantInputById = commitModal.locator("#entity-name")
                        const variantInputByPlaceholder =
                            commitModal.getByPlaceholder("Enter a name...")
                        const variantInput = (await pollLocatorState(() =>
                            variantInputByLabel.isVisible(),
                        ))
                            ? variantInputByLabel
                            : (await pollLocatorState(() => variantInputById.isVisible()))
                              ? variantInputById
                              : variantInputByPlaceholder
                        await expect(variantInput).toBeVisible({timeout: 15000})
                        await variantInput.click()
                        await variantInput.fill("")
                        await variantInput.pressSequentially(variantName || "", {delay: 50})
                    }

                    // 3. Enter the note if provided
                    if (note) {
                        const noteInput = commitModal.getByPlaceholder("Describe your changes...")
                        await expect(noteInput).toBeVisible({timeout: 15000})
                        await noteInput.click()
                        await noteInput.fill("")
                        await noteInput.pressSequentially(note || "", {delay: 50})
                    }

                    // 4. Confirm the modal
                    await uiHelpers.confirmModal("Commit")

                    // 5. Wait for the commit modal to close (indicates success)
                    await expect(commitModal).not.toBeVisible({timeout: 30000})
                }
            },
        )
    },
})

export {testWithVariantFixtures as test}
