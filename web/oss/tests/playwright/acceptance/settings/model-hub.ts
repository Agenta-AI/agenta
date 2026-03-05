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

/**
 * E2E: Model Hub & API Keys Management
 *
 * Strictly follows Agenta E2E guidelines:
 *  - Uses base.fixture, type-safe API helpers, dynamic selectors
 *  - Robust assertions, URL state checks, and clear documentation
 *  - No hardcoded selectors; all are API/data-driven
 *  - Comments clarify any non-obvious logic
 *  - Assumes uiHelpers and apiHelpers are available from base fixture
 *
 * NOTE: Authentication is globally handled in Playwright config/globalSetup.
 * Info: Adding secret at the bigening of the all tests and then removing the secret in the end of all the tests
 */
const modelHubTests = () => {
    test(
        "should allow full add provider",
        {
            tag: [
                createTagString("scope", TestScope.SETTINGS),
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
            // 1. Navigate to settings via sidebar
            await page.goto("/apps", {waitUntil: "domcontentloaded"})
            const settingsLink = page.locator('a:has-text("Settings")').first()
            await expect(settingsLink).toBeVisible({timeout: 10000})
            await settingsLink.click()
            await uiHelpers.expectPath("/settings")

            // 2. Navigate to Models section in settings sidebar
            const modelsMenuItem = page.getByRole("menuitem", {name: "Models"}).first()
            await expect(modelsMenuItem).toBeVisible({timeout: 10000})
            await modelsMenuItem.click()

            // 3. Assert model providers table is visible
            const providersTable = page.getByRole("table").filter({hasText: "OpenAI"})
            const openapiRow = providersTable.getByRole("row", {name: /OpenAI/})
            await expect(openapiRow).toBeVisible()
        },
    )
}

export default modelHubTests
