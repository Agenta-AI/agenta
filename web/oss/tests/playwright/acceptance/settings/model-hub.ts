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
        async ({page, testProviderHelpers}) => {
            await testProviderHelpers.ensureTestProvider()

            const customProvidersSection = page
                .getByText("Custom providers", {exact: true})
                .locator("xpath=ancestor::section[1]")
                .first()
            const providersTable = customProvidersSection.getByRole("table").first()
            const mockRow = providersTable
                .getByRole("row")
                .filter({has: page.getByRole("cell", {name: "mock", exact: true})})
                .first()

            await expect(mockRow).toBeVisible({timeout: 15000})
            await expect(mockRow).toContainText("mock")
        },
    )
}

export default modelHubTests
