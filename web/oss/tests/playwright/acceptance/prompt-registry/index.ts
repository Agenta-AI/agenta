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

const promptRegistryTests = () => {
    test(
        "should open prompt details from prompt registry",
        {
            tag: [
                createTagString("scope", TestScope.PLAYGROUND),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
                createTagString("lens", TestLensType.FUNCTIONAL),
                createTagString("cost", TestCostType.Free),
                createTagString("license", TestLicenseType.OSS),
            ],
        },
        async ({page, uiHelpers}) => {
            // Navigate to /apps (which redirects to workspace-scoped URL)
            await page.goto("/apps", {waitUntil: "domcontentloaded"})

            // Click "Prompts" in sidebar to go to the prompts table
            const promptsLink = page.locator('a:has-text("Prompts")').first()
            await expect(promptsLink).toBeVisible({timeout: 10000})
            await promptsLink.click()

            await uiHelpers.expectPath("/prompts")

            // Verify the Prompts heading is visible
            await expect(page.getByRole("heading", {name: /prompts/i}).first()).toBeVisible({
                timeout: 15000,
            })

            // Verify the prompts table is visible (uses div-based rows)
            const promptsTable = page.getByRole("table").first()
            await expect(promptsTable).toBeVisible()

            // Click the first app row - this navigates to the app overview page
            const firstAppRow = page.locator('[class*="cursor"]').first()
            await expect(firstAppRow).toBeVisible()
            await firstAppRow.click()

            // Verify navigation to the app overview page
            await uiHelpers.expectPath("/overview")
        },
    )
}

export default promptRegistryTests
