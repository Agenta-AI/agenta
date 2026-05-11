import {
    TestCoverage,
    TestcaseType,
    TestRoleType,
    TestPath,
    TestScope,
    TestLensType,
    TestCostType,
    TestSpeedType,
    TestLicenseType,
} from "@agenta/web-tests/playwright/config/testTags"
import {AppType} from "./assets/types"
import {test as baseTest} from "./test"
import {expectAuthenticatedSession} from "../utils/auth"
import {createScenarios} from "../utils/scenarios"
import {buildAcceptanceTags} from "../utils/tags"

const scenarios = createScenarios(baseTest)

const tags = buildAcceptanceTags({
    scope: [
        TestScope.APPS,
        TestScope.PLAYGROUND,
        TestScope.EVALUATIONS,
        TestScope.DEPLOYMENT,
        TestScope.OBSERVABILITY,
    ],
    coverage: [TestCoverage.SMOKE, TestCoverage.LIGHT],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.FAST,
})

const buildAppName = (suffix: string) => `test-${suffix}-app-${Date.now()}`

const tests = () => {
    baseTest(
        `creates new completion prompt app`,
        {tag: tags},
        async ({page, navigateToApps, createNewApp, verifyAppCreation}) => {
            const appName = buildAppName("completion")

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("the user is on the Prompts page", async () => {
                await navigateToApps()
            })

            await scenarios.when(
                'the user creates a "Completion Prompt" app with a unique name',
                async () => {
                    await createNewApp(appName, AppType.COMPLETION_PROMPT)
                },
            )

            await scenarios.then(
                "the new completion prompt app is visible after creation",
                async () => {
                    await verifyAppCreation(appName)
                },
            )
        },
    )

    baseTest(
        `creates new chat prompt app`,
        {tag: tags},
        async ({page, navigateToApps, createNewApp, verifyAppCreation}) => {
            const appName = buildAppName("chat")

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("the user is on the Prompts page", async () => {
                await navigateToApps()
            })

            await scenarios.when(
                'the user creates a "Chat Prompt" app with a unique name',
                async () => {
                    await createNewApp(appName, AppType.CHAT_PROMPT)
                },
            )

            await scenarios.then("the new chat prompt app is visible after creation", async () => {
                await verifyAppCreation(appName)
            })
        },
    )
}

export default tests
export {baseTest as test}
