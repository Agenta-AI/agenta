import {
    TestCoverage,
    TestcaseType,
    TestPath,
    TestScope,
    TestLensType,
    TestCostType,
    TestLicenseType,
    TestRoleType,
    TestSpeedType,
} from "@agenta/web-tests/playwright/config/testTags"
import {expect} from "@agenta/web-tests/utils"

import {expectAuthenticatedSession} from "../utils/auth"
import {createScenarios} from "../utils/scenarios"
import {buildAcceptanceTags} from "../utils/tags"

import {COMPLETION_MESSAGES, NEW_VARIABLES, PROMPT_MESSAGES} from "./assets/constants"
import {Role} from "./assets/types"
import {test as basePlaygroundTest} from "./tests"

const scenarios = createScenarios(basePlaygroundTest)

const sharedTags = {
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
}

const completionRunTags = buildAcceptanceTags({
    scope: [TestScope.PLAYGROUND, TestScope.OBSERVABILITY],
    coverage: [TestCoverage.SMOKE, TestCoverage.LIGHT, TestCoverage.FULL],
    speed: TestSpeedType.SLOW,
    ...sharedTags,
})

const chatRunTags = buildAcceptanceTags({
    scope: [TestScope.PLAYGROUND],
    coverage: [TestCoverage.SMOKE, TestCoverage.LIGHT, TestCoverage.FULL],
    speed: TestSpeedType.SLOW,
    ...sharedTags,
})

const saveVariantTags = buildAcceptanceTags({
    scope: [TestScope.PLAYGROUND],
    coverage: [TestCoverage.SMOKE, TestCoverage.LIGHT, TestCoverage.FULL],
    speed: TestSpeedType.SLOW,
    ...sharedTags,
})

const saveAsNewVariantTags = buildAcceptanceTags({
    scope: [TestScope.PLAYGROUND],
    coverage: [TestCoverage.SMOKE, TestCoverage.LIGHT],
    speed: TestSpeedType.SLOW,
    ...sharedTags,
})

const compareTags = buildAcceptanceTags({
    scope: [TestScope.PLAYGROUND],
    coverage: [TestCoverage.LIGHT, TestCoverage.FULL],
    speed: TestSpeedType.SLOW,
    ...sharedTags,
})

const deepLinkTags = buildAcceptanceTags({
    scope: [TestScope.PLAYGROUND],
    coverage: [TestCoverage.SMOKE, TestCoverage.LIGHT],
    speed: TestSpeedType.FAST,
    ...sharedTags,
})

const configureToolTags = buildAcceptanceTags({
    scope: [TestScope.PLAYGROUND],
    coverage: [TestCoverage.LIGHT, TestCoverage.FULL],
    speed: TestSpeedType.SLOW,
    ...sharedTags,
})

const manageTestcasesTags = buildAcceptanceTags({
    scope: [TestScope.PLAYGROUND, TestScope.DATASETS],
    coverage: [TestCoverage.LIGHT, TestCoverage.FULL],
    speed: TestSpeedType.FAST,
    ...sharedTags,
})

const connectedTestsetCommitTags = buildAcceptanceTags({
    scope: [TestScope.PLAYGROUND, TestScope.DATASETS],
    coverage: [TestCoverage.LIGHT, TestCoverage.FULL],
    speed: TestSpeedType.SLOW,
    ...sharedTags,
})

const playgroundTests = () => {
    basePlaygroundTest(
        "Should run single view variant for completion",
        {tag: completionRunTags},
        async ({
            page,
            apiHelpers,
            navigateToPlayground,
            runCompletionSingleViewVariant,
            testProviderHelpers,
        }) => {
            basePlaygroundTest.setTimeout(120000)
            let appId = ""

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("the active project has a configured test provider", async () => {
                await testProviderHelpers.ensureTestProvider()
            })

            await scenarios.and("the user is on the playground for a completion app", async () => {
                const app = await apiHelpers.getApp("completion")
                appId = app.id
                await navigateToPlayground(appId)
            })

            await scenarios.when(
                "the user runs the completion variant with test inputs",
                async () => {
                    await runCompletionSingleViewVariant(appId, COMPLETION_MESSAGES)
                },
            )

            await scenarios.then(
                "the completion variant run succeeds without UI errors",
                async () => {
                    // Assertions are encapsulated inside the reusable run helper for this existing test.
                },
            )
        },
    )

    basePlaygroundTest(
        "Should run single view variant for chat",
        {tag: chatRunTags},
        async ({
            page,
            apiHelpers,
            navigateToPlayground,
            runChatSingleViewVariant,
            testProviderHelpers,
        }) => {
            basePlaygroundTest.setTimeout(120000)
            let appId = ""

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("the active project has a configured test provider", async () => {
                await testProviderHelpers.ensureTestProvider()
            })

            await scenarios.and("the user is on the playground for a chat app", async () => {
                const app = await apiHelpers.getApp("chat")
                appId = app.id
                await navigateToPlayground(appId)
            })

            await scenarios.when("the user runs the chat variant with test inputs", async () => {
                await runChatSingleViewVariant(appId, COMPLETION_MESSAGES)
            })

            await scenarios.then("the chat variant run succeeds without UI errors", async () => {
                // Assertions are encapsulated inside the reusable run helper for this existing test.
            })
        },
    )

    basePlaygroundTest(
        "Should update the prompt and save the changes",
        {tag: saveVariantTags},
        async ({
            page,
            apiHelpers,
            navigateToPlayground,
            addNewPrompt,
            changeVariableKeys,
            saveVariant,
        }) => {
            let appId = ""

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("the user is on the playground for a completion app", async () => {
                const app = await apiHelpers.getApp("completion")
                appId = app.id
                await navigateToPlayground(appId)
            })

            await scenarios.when("the user adds new prompt messages", async () => {
                await addNewPrompt(PROMPT_MESSAGES)
            })

            await scenarios.and("the user changes the template variable keys", async () => {
                await changeVariableKeys(NEW_VARIABLES)
            })

            await scenarios.and('the user commits the changes "As a new version"', async () => {
                await saveVariant("version")
            })

            await scenarios.then("the prompt changes are saved successfully", async () => {
                // Success is asserted inside the reusable save helper for this existing test.
            })
        },
    )

    basePlaygroundTest(
        "should save the current changes as a new variant",
        {tag: saveAsNewVariantTags},
        async ({page, apiHelpers, navigateToPlayground, addNewPrompt, saveVariant}) => {
            basePlaygroundTest.setTimeout(60000)
            let appId = ""
            const newVariantName = `e2e-variant-${Date.now()}`

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("the user is on the playground for a completion app", async () => {
                const app = await apiHelpers.getApp("completion")
                appId = app.id
                await navigateToPlayground(appId)
            })

            await scenarios.when(
                "the user modifies the prompt and commits the changes as a new variant",
                async () => {
                    await addNewPrompt(PROMPT_MESSAGES)
                    await saveVariant("variant", undefined, undefined, newVariantName)
                },
            )

            await scenarios.then("the new variant is visible in the playground", async () => {
                await expect(page.getByText(newVariantName).first()).toBeVisible({timeout: 15000})
            })
        },
    )

    basePlaygroundTest(
        "should open compare mode and display two variants side by side",
        {tag: compareTags},
        async ({page, apiHelpers, navigateToPlayground}) => {
            basePlaygroundTest.setTimeout(120000)
            let appId = ""

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("the user is on the playground for a completion app", async () => {
                const app = await apiHelpers.getApp("completion")
                appId = app.id
                await navigateToPlayground(appId)
            })

            await scenarios.when(
                "the user opens compare mode and adds a second variant",
                async () => {
                    // The "Compare" button creates a local draft copy of the current revision,
                    // immediately adding a second panel without requiring variant selection.
                    const compareButton = page.getByRole("button", {name: "Compare"})
                    await expect(compareButton).toBeEnabled({timeout: 15000})
                    await compareButton.click()
                },
            )

            await scenarios.then("both variant panels are visible side by side", async () => {
                // PromptComparisonVariantNavigation renders "Variants" heading in compare layout
                await expect(page.getByText("Variants", {exact: true}).first()).toBeVisible({
                    timeout: 10000,
                })
                // Two independent Commit buttons confirm two panels are mounted
                await expect(page.getByRole("button", {name: "Commit"})).toHaveCount(2, {
                    timeout: 10000,
                })
            })
        },
    )

    basePlaygroundTest(
        "should load the correct variant when opened via a deep link with a revisions param",
        {tag: deepLinkTags},
        async ({page, apiHelpers, navigateToPlayground, uiHelpers}) => {
            let appId = ""

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("a completion app exists with at least one revision", async () => {
                const app = await apiHelpers.getApp("completion")
                appId = app.id
                await navigateToPlayground(appId)
            })

            await scenarios.when(
                "the user opens the playground via a deep link with a revisions param",
                async () => {
                    // The playground syncs ?revisions= via history.replaceState, not a full
                    // navigation, so poll the current URL instead of waiting for a load event.
                    await expect
                        .poll(() => new URL(page.url()).searchParams.get("revisions"), {
                            timeout: 15000,
                        })
                        .toBeTruthy()
                    const deepLinkUrl = page.url()
                    const revisionsParam = new URL(deepLinkUrl).searchParams.get("revisions")
                    expect(revisionsParam).toBeTruthy()
                    // Navigate away, then return via the captured deep-link URL.
                    await page.goto(`${apiHelpers.getProjectScopedBasePath()}/apps`, {
                        waitUntil: "domcontentloaded",
                    })
                    await page.goto(deepLinkUrl, {waitUntil: "domcontentloaded"})
                    await expect
                        .poll(() => new URL(page.url()).searchParams.get("revisions"), {
                            timeout: 15000,
                        })
                        .toBe(revisionsParam)
                },
            )

            await scenarios.then(
                "the playground loads with the correct variant ready to use",
                async () => {
                    await uiHelpers.expectPath(`/apps/${appId}/playground`)
                    await expect(
                        page.getByRole("button", {name: "Run", exact: true}).first(),
                    ).toBeVisible({timeout: 30000})
                },
            )
        },
    )

    basePlaygroundTest(
        "should preserve the connected testset when managing testcases",
        {tag: manageTestcasesTags},
        async ({page, apiHelpers, navigateToPlayground}) => {
            basePlaygroundTest.setTimeout(60000)

            const pageErrors: Error[] = []
            page.on("pageerror", (error) => pageErrors.push(error))

            const timestamp = Date.now()
            const rows = [
                {country: "Germany", capital: "Berlin"},
                {country: "France", capital: "Paris"},
                {country: "Spain", capital: "Madrid"},
            ]

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            let connectedTestset: Awaited<ReturnType<typeof apiHelpers.createTestset>>

            await scenarios.and(
                "a multi-row testset and a newer distractor testset exist",
                async () => {
                    connectedTestset = await apiHelpers.createTestset({
                        name: `e2e-manage-connected-${timestamp}`,
                        rows,
                    })
                    await apiHelpers.createTestset({
                        name: `e2e-manage-distractor-${timestamp}`,
                        rows: [{country: "Italy", capital: "Rome"}],
                    })

                    expect(connectedTestset.revisionId).toBeTruthy()
                },
            )

            await scenarios.and("the user is on the playground for a completion app", async () => {
                const app = await apiHelpers.getApp("completion")
                await navigateToPlayground(app.id)
            })

            await scenarios.when(
                "the user connects the multi-row testset and opens Manage testcases",
                async () => {
                    await page.getByRole("button", {name: "Test set", exact: true}).click()
                    await page.getByText("Connect test set", {exact: true}).click()

                    const loadDialog = page.getByRole("dialog", {name: "Load Testset"})
                    await expect(loadDialog).toBeVisible()

                    // Narrow the list to the testset we just created.
                    // testsetsListQueryAtomFamily(null) has refetchOnMount:"always", so
                    // the dialog fires a background refetch on mount. Filling the search
                    // filters the client-side list so only the new testset is visible
                    // once that refetch resolves.
                    await loadDialog
                        .getByPlaceholder("Search testset...")
                        .fill(connectedTestset.name)

                    await loadDialog
                        .getByRole("option", {
                            name: connectedTestset.name,
                            exact: true,
                        })
                        .click()

                    // The EntityPicker sidebar uses an AntD Popover with trigger="hover"
                    // (placement="rightTop"). Playwright's click fires mouseenter before
                    // click, opening the popover. After the click the cursor stays at the
                    // element — mouseleave never fires — so the popover stays open and its
                    // portal (rendered at body z-index) overlaps the table's checkbox
                    // column. Moving to (0,0) fires mouseleave on the testset item, which
                    // closes the popover via AntD's onOpenChange callback.
                    await page.mouse.move(0, 0)

                    // Wait for testcase rows to appear inside the table body.
                    // This is the authoritative signal that the table has finished loading
                    // (EntityTable returns <TableLoadingState> — no thead/checkboxes —
                    // while isFetching && rows.length === 0). Scoping to .ant-table-row
                    // avoids matching "Germany" in the testset-option label or loading
                    // skeleton that might be visible before the rows arrive.
                    await expect(
                        loadDialog.locator(".ant-table-row").filter({hasText: "Germany"}).first(),
                    ).toBeVisible({timeout: 30000})

                    // Click the .ant-checkbox-wrapper label rather than getByRole("checkbox")
                    // or .ant-checkbox-inner. AntD v6 (@rc-component/checkbox v2) removed
                    // the .ant-checkbox-inner span — the visual box is now CSS pseudo-
                    // elements on .ant-checkbox. getByRole("checkbox") is also unreliable
                    // because the native <input> can carry aria-hidden="true" in production
                    // builds. Clicking .ant-checkbox-wrapper (the <label>) triggers the
                    // built-in label → input toggle which fires rowSelection.onChange with
                    // the full computed key set, avoiding stale selectedIdsRef issues.
                    // The CellContentPopover only appears over data cells so the selection
                    // column is free of portal interference.
                    for (let i = 0; i < rows.length; i++) {
                        await loadDialog
                            .locator(".ant-table-row")
                            .filter({hasText: rows[i].country})
                            .first()
                            .locator(".ant-checkbox-wrapper")
                            .click()
                        await expect(
                            loadDialog.getByText(`${i + 1} of ${rows.length} testcases selected`, {
                                exact: true,
                            }),
                        ).toBeVisible({timeout: 5000})
                    }
                    await loadDialog
                        .getByRole("button", {name: "Load Selected", exact: true})
                        .click()
                    await expect(loadDialog).toBeHidden()

                    await page
                        .getByRole("button", {
                            name: connectedTestset.name,
                            exact: false,
                        })
                        .click()
                    await page.getByText("Manage testcases", {exact: true}).click()
                },
            )

            await scenarios.then(
                "the edit modal keeps the connected testset, revision, and selection",
                async () => {
                    const editDialog = page.getByRole("dialog", {
                        name: "Edit Testcase Selection",
                    })
                    await expect(editDialog).toBeVisible()
                    await expect(editDialog.getByText("Germany", {exact: true})).toBeVisible()

                    const managedOption = editDialog.getByRole("option", {
                        name: connectedTestset.name,
                        exact: true,
                    })
                    await expect(managedOption).toHaveAttribute("aria-selected", "true")

                    await managedOption.hover()
                    await expect(
                        page.locator('.ant-popover:visible [role="option"][aria-selected="true"]'),
                    ).toHaveCount(1)

                    await expect(
                        editDialog.getByText(
                            `${rows.length} of ${rows.length} testcases selected`,
                            {exact: true},
                        ),
                    ).toBeVisible()
                    await expect(
                        editDialog.getByRole("button", {
                            name: "Update Selection",
                            exact: true,
                        }),
                    ).toBeVisible()
                    await expect(
                        editDialog.getByRole("button", {
                            name: "Import Selected",
                            exact: true,
                        }),
                    ).toHaveCount(0)
                    await expect(page.getByText("An Error Occurred", {exact: true})).toHaveCount(0)
                    expect(
                        pageErrors.some((error) => error.message.includes("Rendered more hooks")),
                    ).toBe(false)
                },
            )
        },
    )

    basePlaygroundTest.skip(
        "should preserve the connected testset when committing a prompt revision",
        {tag: connectedTestsetCommitTags},
        async ({page, apiHelpers, navigateToPlayground, addNewPrompt, saveVariant}) => {
            basePlaygroundTest.setTimeout(120000)

            const timestamp = Date.now()
            const rows = [
                {country: "Germany", capital: "Berlin"},
                {country: "France", capital: "Paris"},
            ]

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            let connectedTestset: Awaited<ReturnType<typeof apiHelpers.createTestset>>

            await scenarios.and("a testset is available to connect", async () => {
                connectedTestset = await apiHelpers.createTestset({
                    name: `e2e-commit-connected-${timestamp}`,
                    rows,
                })
                expect(connectedTestset.revisionId).toBeTruthy()
            })

            await scenarios.and("the user is on the playground for a completion app", async () => {
                const app = await apiHelpers.getApp("completion")
                await navigateToPlayground(app.id)
            })

            await scenarios.and("the user connects every testcase from the testset", async () => {
                await page.getByRole("button", {name: "Test set", exact: true}).click()
                await page.getByText("Connect test set", {exact: true}).click()

                const loadDialog = page.getByRole("dialog", {name: "Load Testset"})
                await expect(loadDialog).toBeVisible()
                // Narrow the list to the testset we just created.
                // testsetsListQueryAtomFamily(null) has refetchOnMount:"always", so
                // the dialog fires a background refetch on mount. Filling the search
                // filters the client-side list so only the new testset is visible
                // once that refetch resolves.
                await loadDialog.getByPlaceholder("Search testset...").fill(connectedTestset.name)
                await loadDialog
                    .getByRole("option", {
                        name: connectedTestset.name,
                        exact: true,
                    })
                    .click()

                // The EntityPicker sidebar uses an AntD Popover with trigger="hover"
                // (placement="rightTop"). Playwright's click fires mouseenter before
                // click, opening the popover. After the click the cursor stays at the
                // element — mouseleave never fires — so the popover stays open and its
                // portal (rendered at body z-index) overlaps the table's checkbox
                // column. Moving to (0,0) fires mouseleave on the testset item, which
                // closes the popover via AntD's onOpenChange callback.
                await page.mouse.move(0, 0)

                // Wait for testcase rows to appear inside the table body.
                // This is the authoritative signal that the table has finished loading
                // (EntityTable returns <TableLoadingState> — no thead/checkboxes —
                // while isFetching && rows.length === 0). Scoping to .ant-table-row
                // avoids matching "Germany" in the testset-option label or loading
                // skeleton that might be visible before the rows arrive.
                await expect(
                    loadDialog.locator(".ant-table-row").filter({hasText: "Germany"}).first(),
                ).toBeVisible({timeout: 30000})
                for (let i = 0; i < rows.length; i++) {
                    // Click the .ant-checkbox-wrapper label rather than getByRole("checkbox")
                    // or .ant-checkbox-inner. AntD v6 (@rc-component/checkbox v2) removed
                    // the .ant-checkbox-inner span — the visual box is now CSS pseudo-
                    // elements on .ant-checkbox. getByRole("checkbox") is also unreliable
                    // because the native <input> can carry aria-hidden="true" in production
                    // builds. Clicking .ant-checkbox-wrapper (the <label>) triggers the
                    // built-in label → input toggle which fires rowSelection.onChange with
                    // the full computed key set, avoiding stale selectedIdsRef issues.
                    // The CellContentPopover only appears over data cells so the selection
                    // column is free of portal interference.
                    await loadDialog
                        .locator(".ant-table-row")
                        .filter({hasText: rows[i].country})
                        .first()
                        .locator(".ant-checkbox-wrapper")
                        .click()
                    await expect(
                        loadDialog.getByText(`${i + 1} of ${rows.length} testcases selected`, {
                            exact: true,
                        }),
                    ).toBeVisible({timeout: 5000})
                }
                await loadDialog.getByRole("button", {name: "Load Selected", exact: true}).click()
                await expect(loadDialog).toBeHidden()
                await expect(
                    page.getByRole("button", {
                        name: connectedTestset.name,
                        exact: false,
                    }),
                ).toBeVisible()
            })

            await scenarios.when(
                "the user changes the prompt and commits it as a new version",
                async () => {
                    await addNewPrompt([
                        {
                            prompt: `Keep the connected testset after commit ${timestamp}.`,
                            role: Role.USER,
                        },
                    ])
                    await expect(
                        page.locator("button.ant-btn-primary").filter({hasText: "Commit"}).first(),
                    ).toBeEnabled()
                    await saveVariant("version")
                },
            )

            await scenarios.then(
                "the same testset revision and testcase selection remain connected",
                async () => {
                    const testsetButton = page.getByRole("button", {
                        name: connectedTestset.name,
                        exact: false,
                    })
                    await expect(testsetButton).toBeVisible()
                    await testsetButton.click()
                    await page.getByText("Manage testcases", {exact: true}).click()

                    const editDialog = page.getByRole("dialog", {
                        name: "Edit Testcase Selection",
                    })
                    await expect(editDialog).toBeVisible()
                    await expect(
                        editDialog.getByRole("option", {
                            name: connectedTestset.name,
                            exact: true,
                        }),
                    ).toHaveAttribute("aria-selected", "true")
                    await expect(
                        editDialog.getByText(
                            `${rows.length} of ${rows.length} testcases selected`,
                            {exact: true},
                        ),
                    ).toBeVisible()
                },
            )
        },
    )

    basePlaygroundTest(
        "should configure output type and tools and save the changes",
        {tag: configureToolTags},
        async ({
            page,
            apiHelpers,
            navigateToPlayground,
            runCompletionSingleViewVariant,
            testProviderHelpers,
        }) => {
            basePlaygroundTest.setTimeout(120000)
            let appId = ""

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("the active project has a configured test provider", async () => {
                await testProviderHelpers.ensureTestProvider()
            })

            await scenarios.and("the user is on the playground for a completion app", async () => {
                const app = await apiHelpers.getApp("completion")
                appId = app.id
                await navigateToPlayground(appId)
            })

            await scenarios.when("the user connects an OpenAI web search tool", async () => {
                await page.getByRole("button", {name: "Tool"}).click()
                await page.getByRole("button", {name: "OpenAI"}).hover()
                await page.getByRole("button", {name: "Web Search"}).click()
            })

            await scenarios.then(
                "the web_search tool block appears in the prompt section",
                async () => {
                    await expect(page.getByText("web_search").first()).toBeVisible({
                        timeout: 10000,
                    })
                },
            )

            await scenarios.when(
                "the user runs the completion variant with the web search tool active",
                async () => {
                    await runCompletionSingleViewVariant(appId, COMPLETION_MESSAGES)
                },
            )

            await scenarios.then("the run succeeds without UI errors", async () => {
                // Assertions are encapsulated inside the reusable run helper.
            })
        },
    )
}

export default playgroundTests
