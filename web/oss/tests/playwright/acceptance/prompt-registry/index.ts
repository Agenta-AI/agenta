import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"
import {getProjectScopedBasePath} from "@agenta/web-tests/tests/fixtures/base.fixture/apiHelpers"
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
        async ({page, uiHelpers, apiHelpers}) => {
            // 1. Get or create a completion app
            const app = await apiHelpers.getApp("completion")
            const appId = app.id

            // 2. Navigate to the app-level Registry page
            const basePath = getProjectScopedBasePath(page)
            await page.goto(`${basePath}/apps/${appId}/variants`, {
                waitUntil: "domcontentloaded",
            })
            await uiHelpers.expectPath(`/apps/${appId}/variants`)

            // 3. Wait for the Registry table to load with at least one revision row
            const firstRow = page.locator(".variant-table-row").first()
            await expect(firstRow).toBeVisible({timeout: 30000})

            // 4. Click the first row to open the revision drawer
            await firstRow.click()

            // 5. Verify the "Workflow Revision" drawer opens
            const drawer = page.locator(".ant-drawer").last()
            await expect(drawer).toBeVisible({timeout: 15000})
            await expect(drawer.getByText("Workflow Revision").first()).toBeVisible({
                timeout: 15000,
            })

            // 6. Click the "Playground" button in the drawer header
            const playgroundButton = drawer.getByRole("button", {name: "Playground"})
            await expect(playgroundButton).toBeVisible({timeout: 15000})
            await playgroundButton.click()

            // 7. Verify navigation to the playground page
            await page.waitForURL(/\/apps\/.*\/playground/, {timeout: 15000})
            await uiHelpers.expectPath(`/apps/${appId}/playground`)
        },
    )
}

export default promptRegistryTests
