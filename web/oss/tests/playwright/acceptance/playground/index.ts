import {expect} from "@agenta/web-tests/utils"
import {COMPLETION_MESSAGES, NEW_VARIABLES, PROMPT_MESSAGES} from "./assets/constants"
import {test as basePlaygroundTest} from "./tests"
import {expectAuthenticatedSession} from "../utils/auth"
import {createScenarios} from "../utils/scenarios"
import {buildAcceptanceTags} from "../utils/tags"

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
                    await page.getByRole("button", {name: "Compare"}).click()
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
                    // The playground writes ?revisions= to the URL after initialising.
                    await page.waitForURL(/[?&]revisions=/, {timeout: 15000})
                    const deepLinkUrl = page.url()
                    // Navigate away, then return via the captured deep-link URL.
                    await page.goto(`${apiHelpers.getProjectScopedBasePath()}/apps`, {
                        waitUntil: "domcontentloaded",
                    })
                    await page.goto(deepLinkUrl, {waitUntil: "domcontentloaded"})
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
                "the web_search_preview tool block appears in the prompt section",
                async () => {
                    await expect(page.getByText("web_search_preview").first()).toBeVisible({
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
