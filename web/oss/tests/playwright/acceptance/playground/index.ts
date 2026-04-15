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
}

export default playgroundTests
