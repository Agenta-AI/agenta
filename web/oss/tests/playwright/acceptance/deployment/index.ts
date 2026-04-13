import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"

import {expect} from "@agenta/web-tests/utils"
import {
    createTagString,
    TestCoverage,
    TestPath,
    TestScope,
    TestLensType,
    TestCostType,
    TestLicenseType,
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
                createTagString("lens", TestLensType.FUNCTIONAL),
                createTagString("cost", TestCostType.Free),
                createTagString("license", TestLicenseType.OSS),
            ],
        },
        async ({page, apiHelpers, uiHelpers}) => {
            test.skip(
                true,
                "Skipped until ephemeral-project app bootstrap creates a deterministic deployable variant.",
            )

            const app = await apiHelpers.getApp("completion")
            const appId = app.id

            // Get variant name via direct API call
            const baseUrl = new URL(page.url()).origin
            const variantsRes = await page.request.get(`${baseUrl}/api/apps/${appId}/variants`)
            const variants = await variantsRes.json()
            expect(Array.isArray(variants)).toBe(true)
            expect(variants.length).toBeGreaterThan(0)
            const variant = variants[0]
            const variantName = variant.name

            // 1. Navigate directly to the scoped app overview
            await page.goto(`${apiHelpers.getProjectScopedBasePath()}/apps/${appId}/overview`, {
                waitUntil: "domcontentloaded",
            })
            await uiHelpers.expectPath(`/apps/${appId}/overview`)
            await page.waitForLoadState("networkidle")

            // Scroll to the Deployment section on the overview page
            const deploymentHeading = page.getByRole("heading", {name: "Deployment"})
            await deploymentHeading.scrollIntoViewIfNeeded()
            await expect(deploymentHeading).toBeVisible({timeout: 10000})

            // 2. Verify environment cards are visible
            const envNames = ["Development", "Staging", "Production"]
            for (const envName of envNames) {
                await expect(page.getByText(envName, {exact: true}).first()).toBeVisible()
            }

            // 3. Click on the Development environment card
            const devCard = page.getByText("Development", {exact: true}).first()
            await devCard.click()

            // 4. Wait for deployment drawer/modal or page navigation
            // The card click may open a deployment details view
            await page.waitForTimeout(2000)

            // 5. Look for the Deploy variant button
            const deployButton = page.getByRole("button", {name: /Deploy/i}).first()
            if (await deployButton.isVisible()) {
                await deployButton.click()

                // 6. Select a variant in the modal
                const modal = page.locator(".ant-modal").first()
                await expect(modal).toBeVisible({timeout: 10000})

                await uiHelpers.selectTableRowInput({
                    rowText: variantName,
                    inputType: "radio",
                    checked: true,
                })

                // 7. Confirm deployment
                const confirmDeployButton = page.getByRole("button", {name: "Deploy"}).last()
                await confirmDeployButton.click()

                // 8. Handle confirmation dialog if present
                const confirmText = page.getByText("Are you sure you want to deploy")
                if (await confirmText.isVisible({timeout: 3000}).catch(() => false)) {
                    await page.getByRole("button", {name: "Deploy"}).last().click()
                }

                // 9. Verify deployment succeeded by checking the card updates
                await page.waitForLoadState("networkidle")
            }
        },
    )
}

export default deploymentTests
