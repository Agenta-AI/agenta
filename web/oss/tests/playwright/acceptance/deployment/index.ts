import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"

import {expect} from "@agenta/web-tests/utils"
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

const scenarios = createScenarios(test)

const tags = buildAcceptanceTags({
    scope: [TestScope.DEPLOYMENT],
    coverage: [TestCoverage.SMOKE, TestCoverage.LIGHT, TestCoverage.FULL],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.SLOW,
})

const deploymentTests = () => {
    test("deploy a variant", {tag: tags}, async ({page, apiHelpers, uiHelpers}) => {
        let appId = ""

        await scenarios.given("the user is authenticated", async () => {
            await expectAuthenticatedSession(page)
        })

        await scenarios.and("a completion app with at least one variant exists", async () => {
            const app = await apiHelpers.getApp("completion")
            appId = app.id
        })

        await scenarios.and("the user is on the app overview page", async () => {
            await page.goto(`${apiHelpers.getProjectScopedBasePath()}/apps/${appId}/overview`, {
                waitUntil: "domcontentloaded",
            })
            await uiHelpers.expectPath(`/apps/${appId}/overview`)
            const deploymentHeading = page.getByRole("heading", {name: "Deployment"})
            await deploymentHeading.scrollIntoViewIfNeeded()
            await expect(deploymentHeading).toBeVisible({timeout: 10000})
        })

        await scenarios.then("the three environment cards are visible", async () => {
            for (const envName of ["Development", "Staging", "Production"]) {
                await expect(page.getByText(envName, {exact: true}).first()).toBeVisible()
            }
        })

        await scenarios.when("the user opens the Development deployment flow", async () => {
            // Navigate directly — card click omits the workspace/project URL prefix in test env
            await page.goto(
                `${apiHelpers.getProjectScopedBasePath()}/apps/${appId}/variants?tab=deployments&selectedEnvName=development`,
                {waitUntil: "domcontentloaded"},
            )
            await uiHelpers.expectPath(`/apps/${appId}/variants`)
        })

        await scenarios.and("the user opens the deploy dialog", async () => {
            // The DeploymentsDashboard header has a standalone "Deploy" button
            const deployButton = page.getByRole("button", {name: "Deploy"}).first()
            await expect(deployButton).toBeVisible({timeout: 15000})
            await deployButton.click()
        })

        await scenarios.and("the user selects a variant to deploy to Development", async () => {
            const modal = page.getByRole("dialog", {name: /Deploy Development/i}).last()
            await expect(modal).toBeVisible({timeout: 10000})

            // Virtualized tables render more reliably with [data-row-key] than .ant-table-row.
            const firstRow = modal.locator("[data-row-key]").first()
            await expect(firstRow).toBeVisible({timeout: 10000})
            const radioControl = firstRow
                .locator('.ant-radio-wrapper, .ant-radio, [role="radio"], input[type="radio"]')
                .first()
            await expect(radioControl).toBeVisible({timeout: 10000})
            await radioControl.click({force: true})
        })

        await scenarios.and("the user confirms the deployment", async () => {
            const modal = page.getByRole("dialog", {name: /Deploy Development/i}).last()
            const deployBtn = modal.getByRole("button", {name: "Deploy"})
            await expect(deployBtn).toBeEnabled({timeout: 10000})
            await deployBtn.click()
        })

        await scenarios.then("the deployment to Development succeeds", async () => {
            await expect(page.getByRole("dialog", {name: /Deploy Development/i})).toHaveCount(0, {
                timeout: 30000,
            })
        })
    })
}

export default deploymentTests
