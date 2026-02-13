import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"

import type {DeploymentRevisions, Environment} from "@/oss/lib/Types"
import {expect} from "@agenta/web-tests/utils"
import {
    createTagString,
    TestCoverage,
    TestPath,
    TestScope,
} from "@agenta/web-tests/playwright/config/testTags"

const deploymentTests = () => {
    test(
        "deploy a variant",
        {
            tag: [
                createTagString("scope", TestScope.DEPLOYMENT),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
            ],
        },
        async ({page, apiHelpers, uiHelpers}) => {
            const app = await apiHelpers.getApp("completion")
            const appId = app.app_id

            const variants = await apiHelpers.getVariants(appId)
            const variant = variants[0]
            const variantName = variant.variant_name || variant.name

            // 1. Navigate to deployments page
            await page.goto(`/apps/${appId}/deployments`)
            await uiHelpers.expectPath(`/apps/${appId}/deployments`)
            await uiHelpers.expectText("Deployment", {exact: true})

            // 2. Listen to the environments endpoint
            const envResponse = await apiHelpers.waitForApiResponse<Environment[]>({
                route: `/apps/${appId}/environments`,
                method: "GET",
            })
            const envs = await envResponse

            // expect name to be there
            const envNames = ["development", "staging", "production"]
            expect(envs.length).toBeGreaterThanOrEqual(2)
            envs.map((env) => expect(envNames).toContain(env.name))

            // 3. Click on deployment environment card
            const environmentName = "development"
            await page.locator(".ant-card").filter({hasText: environmentName}).click()

            // 4. Open use api modal
            await uiHelpers.clickButton("Deploy variant")
            const hasEvalModalOpen = await page.locator(".ant-modal")
            await hasEvalModalOpen.first().isVisible()

            // 5. Select a variant
            await uiHelpers.expectText(`Deploy ${environmentName}`)

            // Find the specific row by variant name and ensure it's unique
            await uiHelpers.selectTableRowInput({
                rowText: variantName,
                inputType: "radio",
                checked: true,
            })
            await uiHelpers.confirmModal("Deploy")

            // 6. Deployment selected variant
            const hasConfirmModalOpen = page.locator(".ant-modal").last()
            await hasConfirmModalOpen.isVisible()

            await uiHelpers.expectText("Are you sure you want to deploy")
            const button = page.getByRole("button", {name: "Deploy"}).last()
            await button.click()

            // 7. Listen to the deployed environment endpoint
            const deployedEnvResponse = await apiHelpers.waitForApiResponse<DeploymentRevisions>({
                route: `/apps/${appId}/revisions/${environmentName}`,
                method: "GET",
            })
            const deployedEnv = await deployedEnvResponse

            expect(Array.isArray(deployedEnv.revisions)).toBe(true)
            expect(deployedEnv.revisions.length).toBeGreaterThan(0)

            const deployedEnvNames = deployedEnv.revisions.map((rev) => rev.deployed_variant_name)
            expect(deployedEnvNames).toContain(variantName)

            // 8. Confirm deployment
            await page.locator(".ant-card").filter({hasText: "staging"}).click()
            await page.locator(".ant-card").filter({hasText: environmentName}).click()
            const envTableRow = page.getByRole("row").filter({hasText: variantName}).first()
            await expect(envTableRow).toBeVisible()
        },
    )
}

export default deploymentTests
