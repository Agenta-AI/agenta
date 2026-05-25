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
import {expect} from "@agenta/web-tests/utils"

import {AppType} from "./assets/types"
import {openCreateAppDrawerForType, test as baseTest} from "./test"
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

    baseTest(
        `closing the create-app drawer without committing fires no /workflows POST`,
        {tag: tags},
        async ({page, navigateToApps}) => {
            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("the user is on the Prompts page", async () => {
                await navigateToApps()
            })

            // Track every POST /workflows request that fires after the drawer
            // opens. The lazy-create-before-commit shift means closing the
            // drawer pre-commit must not hit the create endpoint.
            const workflowPosts: string[] = []
            page.on("request", (request) => {
                if (
                    request.method() === "POST" &&
                    request.url().includes("/workflows") &&
                    !request.url().includes("/query")
                ) {
                    workflowPosts.push(request.url())
                }
            })

            await scenarios.when(
                'the user opens the create-app dropdown and picks "Chat"',
                async () => {
                    await openCreateAppDrawerForType(page, AppType.CHAT_PROMPT)
                    // Confirm the editable name input is present (drawer fully mounted)
                    await expect(page.getByTestId("app-create-name-input").first()).toBeVisible({
                        timeout: 15000,
                    })
                },
            )

            await scenarios.and("the user closes the drawer without committing", async () => {
                const closeButton = page.getByTestId("workflow-revision-drawer-close").first()
                await expect(closeButton).toBeVisible()
                await closeButton.click()
                // Wait long enough that any (incorrect) commit request would have
                // fired. The factory's inspect call may hit /workflows/inspect or
                // similar but the create endpoint is /workflows POST with a body.
                await page.waitForTimeout(800)
            })

            await scenarios.then("no /workflows POST request was made", async () => {
                expect(workflowPosts).toEqual([])
            })

            await scenarios.and("the user remains on the apps page", async () => {
                await expect(page).toHaveURL(/\/apps$/)
            })
        },
    )
}

export default tests
export {baseTest as test}
