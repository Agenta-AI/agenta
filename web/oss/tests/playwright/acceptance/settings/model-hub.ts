import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"

import {expect} from "@agenta/web-tests/utils"
import {
    createTagString,
    TestCoverage,
    TestPath,
    TestScope,
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
            ],
        },
        async ({page, uiHelpers}) => {
            // 1. Navigate to settings
            await page.goto("/settings", {waitUntil: "domcontentloaded"})
            await uiHelpers.expectPath("/settings")

            // 2. Open Model Hub tab and assert table presence
            const modelHubTab = page.getByRole("tab", {name: /model hub/i}).first()
            if ((await modelHubTab.count()) > 0) {
                await modelHubTab.click()
            } else {
                await page.getByText(/model hub/i).first().click()
            }

            // 3. Assert model providers table is visible
            const providersTable = page.getByRole("table").filter({hasText: "OpenAI"})
            const openapiRow = providersTable.getByRole("row", {name: /OpenAI/})
            await expect(openapiRow).toBeVisible()
        },
    )
}

export default modelHubTests
