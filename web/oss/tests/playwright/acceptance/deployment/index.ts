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
        test.skip(
            true,
            "Skipped until ephemeral-project app bootstrap creates a deterministic deployable variant.",
        )

        let appId = ""
        let variantName = ""

        await scenarios.given("the user is authenticated", async () => {
            await expectAuthenticatedSession(page)
        })

        await scenarios.and("a completion app with at least one variant exists", async () => {
            const app = await apiHelpers.getApp("completion")
            appId = app.id

            const baseUrl = new URL(page.url()).origin
            const variantsRes = await page.request.get(`${baseUrl}/api/apps/${appId}/variants`)
            const variants = await variantsRes.json()
            expect(Array.isArray(variants)).toBe(true)
            expect(variants.length).toBeGreaterThan(0)
            variantName = variants[0].name
        })

        await scenarios.and("the user is on the app overview page", async () => {
            await page.goto(`${apiHelpers.getProjectScopedBasePath()}/apps/${appId}/overview`, {
                waitUntil: "domcontentloaded",
            })
            await uiHelpers.expectPath(`/apps/${appId}/overview`)
            await page.waitForLoadState("networkidle")
        })

        await scenarios.when("the user opens the Development deployment flow", async () => {
            const deploymentHeading = page.getByRole("heading", {name: "Deployment"})
            await deploymentHeading.scrollIntoViewIfNeeded()
            await expect(deploymentHeading).toBeVisible({timeout: 10000})

            for (const envName of ["Development", "Staging", "Production"]) {
                await expect(page.getByText(envName, {exact: true}).first()).toBeVisible()
            }

            await page.getByText("Development", {exact: true}).first().click()
            await page.waitForTimeout(2000)

            const deployButton = page.getByRole("button", {name: /Deploy/i}).first()
            if (await deployButton.isVisible()) {
                await deployButton.click()

                const modal = page.locator(".ant-modal").first()
                await expect(modal).toBeVisible({timeout: 10000})

                await uiHelpers.selectTableRowInput({
                    rowText: variantName,
                    inputType: "radio",
                    checked: true,
                })

                await page.getByRole("button", {name: "Deploy"}).last().click()

                const confirmText = page.getByText("Are you sure you want to deploy")
                if (await confirmText.isVisible({timeout: 3000}).catch(() => false)) {
                    await page.getByRole("button", {name: "Deploy"}).last().click()
                }
            }
        })

        await scenarios.then(
            "the deployment flow completes without leaving the overview context",
            async () => {
                await page.waitForLoadState("networkidle")
                await uiHelpers.expectPath(`/apps/${appId}/overview`)
            },
        )
    })
}

export default deploymentTests
