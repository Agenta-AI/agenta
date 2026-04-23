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
import {test as baseTest} from "./test"
import {expect} from "@agenta/web-tests/utils"
import {expectAuthenticatedSession} from "../utils/auth"
import {createScenarios} from "../utils/scenarios"
import {buildAcceptanceTags} from "../utils/tags"

const scenarios = createScenarios(baseTest)

const tags = buildAcceptanceTags({
    scope: [TestScope.APPS],
    coverage: [TestCoverage.SMOKE, TestCoverage.LIGHT],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.FAST,
})

const lightTags = buildAcceptanceTags({
    scope: [TestScope.APPS],
    coverage: [TestCoverage.LIGHT],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.FAST,
})

const tests = () => {
    baseTest(
        "should delete an app",
        {tag: tags},
        async ({page, navigateToApps, uiHelpers, apiHelpers}) => {
            let appName: string

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("at least one prompt app exists in the project", async () => {
                // getApp navigates to /apps internally and creates an app via UI if none exist.
                // app.name is the correct field (not app.app_name).
                const app = await apiHelpers.getApp()
                appName = app.name
            })

            await scenarios.and("the user is on the apps list page", async () => {
                // Explicitly navigate to /apps after getApp — if getApp created a new app it
                // lands on the playground; this step brings us back to the table.
                await navigateToApps()
            })

            await scenarios.when("the user deletes an existing app", async () => {
                // The actions dropdown trigger (MoreOutlined icon) is the only button in the
                // data row. AntD Tooltip title does not become an accessible name, so we locate
                // the row by text and click its button directly.
                const appRow = page.locator(".ant-table-row").filter({hasText: appName}).first()
                await appRow.hover()
                await appRow.getByRole("button").click()
                await page.getByRole("menuitem", {name: "Archive"}).click()
                await uiHelpers.confirmModal("Yes")
                // confirmModal only clicks the button; the modal stays open while the archive
                // API call runs. Wait for it to close before moving to the Then step, otherwise
                // expectNoText finds 2 matches (table row + modal body text) causing a strict
                // mode violation.
                await page
                    .locator(".ant-modal")
                    .filter({hasText: "Are you sure"})
                    .waitFor({state: "hidden", timeout: 15000})
            })

            await scenarios.then("the app no longer appears in the apps list", async () => {
                await uiHelpers.expectNoText(appName)
            })
        },
    )

    baseTest(
        "should rename an app",
        {tag: tags},
        async ({page, navigateToApps, uiHelpers, apiHelpers}) => {
            // Rename is temporarily disabled in the UI ("TEMPORARY: Disabling name editing").
            // Skip until a rename entry point is added back to the app row actions.
            baseTest.skip(
                true,
                "Rename feature temporarily disabled — re-enable when name editing is available",
            )

            let appName: string
            const newName = `renamed-${Date.now()}`

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("at least one prompt app exists in the project", async () => {
                const app = await apiHelpers.getApp()
                appName = app.name
            })

            await scenarios.and("the user is on the apps list page", async () => {
                await navigateToApps()
            })

            await scenarios.when(
                "the user renames an existing app with a new unique name",
                async () => {
                    const appRow = page.locator(".ant-table-row").filter({hasText: appName}).first()
                    await appRow.hover()
                    await appRow.getByRole("button").click()
                    const renameItem = page.getByRole("menuitem", {name: /rename/i})
                    await renameItem.click()
                    const input = page.locator(".ant-modal input").first()
                    await input.clear()
                    await input.fill(newName)
                    await uiHelpers.confirmModal("Confirm")
                },
            )

            await scenarios.then("the updated app name is visible in the apps list", async () => {
                await uiHelpers.expectText(newName)
            })
        },
    )

    baseTest(
        "should render the app overview page with environment cards and variant list",
        {tag: lightTags},
        async ({page, uiHelpers, apiHelpers}) => {
            let appId: string

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("at least one prompt app exists in the project", async () => {
                const app = await apiHelpers.getApp()
                appId = app.id
            })

            await scenarios.and("the user is on the apps list page", async () => {
                await page.goto(`${apiHelpers.getProjectScopedBasePath()}/apps/${appId}/overview`, {
                    waitUntil: "domcontentloaded",
                })
                await uiHelpers.expectPath(`/apps/${appId}/overview`)
                await page.waitForLoadState("networkidle")
            })

            await scenarios.when("the user opens an existing app", async () => {
                const deploymentHeading = page.getByRole("heading", {name: "Deployment"})
                await deploymentHeading.scrollIntoViewIfNeeded()
                await expect(deploymentHeading).toBeVisible({timeout: 10000})
            })

            await scenarios.then(
                "the app overview page displays the environment cards",
                async () => {
                    for (const envName of ["Development", "Staging", "Production"]) {
                        await expect(page.getByText(envName, {exact: true}).first()).toBeVisible()
                    }
                },
            )

            await scenarios.and("the variant list is visible", async () => {
                await expect(page.getByRole("heading", {name: "Recent Prompts"})).toBeVisible({
                    timeout: 10000,
                })
            })
        },
    )
}

export default tests
export {baseTest as test}
