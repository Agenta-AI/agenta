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
const scenarios = createScenarios(test)

const tags = buildAcceptanceTags({
    scope: [TestScope.SETTINGS],
    coverage: [TestCoverage.SMOKE, TestCoverage.LIGHT, TestCoverage.FULL],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.FAST,
})

const modelHubTests = () => {
    test("should allow full add provider", {tag: tags}, async ({page, testProviderHelpers}) => {
        await scenarios.given("the user is authenticated", async () => {
            await expectAuthenticatedSession(page)
        })

        await scenarios.when("the project scoped mock test provider is configured", async () => {
            await testProviderHelpers.ensureTestProvider()
        })

        await scenarios.then('the "Custom providers" table lists the "mock" provider', async () => {
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
        })
    })
}

export default modelHubTests
