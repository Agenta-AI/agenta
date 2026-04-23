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

const tagsLight = buildAcceptanceTags({
    scope: [TestScope.SETTINGS],
    coverage: [TestCoverage.LIGHT],
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

    test(
        "should configure a standard provider key and verify it is listed",
        {tag: tagsLight},
        async ({page, testProviderHelpers}, testInfo) => {
            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.given("the user is on the Settings models page", async () => {
                await testProviderHelpers.ensureTestProvider()
            })

            await scenarios.when(
                "the user configures a key for the first unconfigured standard provider",
                async () => {
                    const standardProvidersSection = page
                        .getByText("Standard providers", {exact: true})
                        .locator("xpath=ancestor::section[1]")
                        .first()

                    const configureNowButton = standardProvidersSection
                        .getByRole("button", {name: "Configure now"})
                        .first()

                    const hasConfigureNow = await configureNowButton
                        .isVisible({timeout: 5000})
                        .catch(() => false)

                    testInfo.skip(
                        !hasConfigureNow,
                        "All standard providers are already configured — skipping standard provider key test",
                    )

                    await configureNowButton.click()

                    const modal = page.locator(".ant-modal").last()
                    await expect(modal).toBeVisible({timeout: 15000})
                    await modal.getByPlaceholder("Enter API key").fill("sk-test-e2e-cleanup")
                    await modal.getByRole("button", {name: "Confirm"}).click()
                    await expect(modal).not.toBeVisible({timeout: 15000})
                },
            )

            await scenarios.then(
                "the Status column no longer shows Configure now for that row",
                async () => {
                    const standardProvidersSection = page
                        .getByText("Standard providers", {exact: true})
                        .locator("xpath=ancestor::section[1]")
                        .first()

                    const configureNowButtons = standardProvidersSection.getByRole("button", {
                        name: "Configure now",
                    })

                    // At least one provider is now configured (count reduced or a key is visible)
                    const remainingCount = await configureNowButtons.count()
                    const providersTable = standardProvidersSection.getByRole("table").first()
                    const allRows = providersTable.getByRole("row")
                    const rowCount = await allRows.count()
                    // Verify that not all rows still show Configure now
                    expect(remainingCount).toBeLessThan(rowCount - 1)
                },
            )

            await scenarios.when(
                "the user deletes the configured standard provider key",
                async () => {
                    const standardProvidersSection = page
                        .getByText("Standard providers", {exact: true})
                        .locator("xpath=ancestor::section[1]")
                        .first()

                    // AntD renders color="danger" buttons with class ant-btn-color-dangerous
                    // This button only renders in rows where a key is already configured
                    const trashButton = standardProvidersSection
                        .locator(".ant-btn-color-dangerous")
                        .first()

                    await expect(trashButton).toBeVisible({timeout: 15000})
                    await trashButton.click()

                    const deleteModal = page.locator(".ant-modal").last()
                    await expect(deleteModal).toBeVisible({timeout: 15000})
                    await deleteModal.getByRole("button", {name: "Delete"}).click()
                    await expect(deleteModal).not.toBeVisible({timeout: 15000})
                },
            )

            await scenarios.then(
                'the Status column shows "Configure now" again for that provider',
                async () => {
                    const standardProvidersSection = page
                        .getByText("Standard providers", {exact: true})
                        .locator("xpath=ancestor::section[1]")
                        .first()

                    await expect(
                        standardProvidersSection
                            .getByRole("button", {name: "Configure now"})
                            .first(),
                    ).toBeVisible({timeout: 15000})
                },
            )
        },
    )

    test(
        "should add and delete a custom provider via the UI",
        {tag: tagsLight},
        async ({page, testProviderHelpers}) => {
            const providerName = `e2e-test-provider-${Date.now()}`

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.given("the user is on the Settings models page", async () => {
                await testProviderHelpers.ensureTestProvider()
            })

            await scenarios.when(
                "the user creates a new custom provider via the drawer",
                async () => {
                    const customProvidersSection = page
                        .getByText("Custom providers", {exact: true})
                        .locator("xpath=ancestor::section[1]")
                        .first()

                    const createButton = customProvidersSection.getByRole("button", {
                        name: "Create",
                    })
                    await expect(createButton).toBeVisible({timeout: 15000})
                    await createButton.click()

                    const drawer = page.locator(".ant-drawer-content-wrapper").last()
                    await expect(drawer).toBeVisible({timeout: 15000})
                    await expect(drawer.getByText("Configure provider")).toBeVisible({
                        timeout: 15000,
                    })

                    // Select "Custom Provider" from the provider type dropdown
                    const providerSelect = drawer.locator(".ant-select").first()
                    await expect(providerSelect).toBeVisible({timeout: 15000})
                    await providerSelect.click()

                    const options = page.locator(".ant-select-item-option")
                    await expect(options.first()).toBeVisible({timeout: 15000})

                    const optionTexts = (await options.allTextContents()).map((t) => t.trim())
                    const customProviderIndex = optionTexts.findIndex(
                        (t) => t === "Custom Provider",
                    )

                    // Click the target option directly — keyboard ArrowDown navigation is unreliable with AntD v5 selects
                    const targetOption = options.nth(customProviderIndex)
                    await expect(targetOption).toBeVisible({timeout: 15000})
                    await targetOption.click()

                    await expect(drawer.getByPlaceholder("Enter unique name")).toBeVisible({
                        timeout: 15000,
                    })

                    await drawer.getByPlaceholder("Enter unique name").fill(providerName)
                    await drawer.getByPlaceholder("Enter API key").fill("test-key")
                    await drawer
                        .getByPlaceholder("Enter API base URL")
                        .fill("https://test.example.com/v1")
                    await drawer.getByPlaceholder("Enter model name").fill("test-model")

                    const submitButton = drawer.getByRole("button", {name: "Submit"})
                    await expect(submitButton).toBeVisible({timeout: 15000})
                    await submitButton.click()

                    await expect(drawer).not.toBeVisible({timeout: 30000})
                },
            )

            await scenarios.then(
                "the new custom provider row appears in the Custom providers table",
                async () => {
                    const customProvidersSection = page
                        .getByText("Custom providers", {exact: true})
                        .locator("xpath=ancestor::section[1]")
                        .first()

                    const newRow = customProvidersSection
                        .getByRole("table")
                        .first()
                        .getByRole("row")
                        .filter({
                            has: page.getByRole("cell", {name: providerName, exact: true}),
                        })
                        .first()

                    await expect(newRow).toBeVisible({timeout: 15000})
                },
            )

            await scenarios.when("the user deletes the newly created custom provider", async () => {
                const customProvidersSection = page
                    .getByText("Custom providers", {exact: true})
                    .locator("xpath=ancestor::section[1]")
                    .first()

                const newRow = customProvidersSection
                    .getByRole("table")
                    .first()
                    .getByRole("row")
                    .filter({has: page.getByRole("cell", {name: providerName, exact: true})})
                    .first()

                await newRow.locator("button").first().click()

                const deleteModal = page.locator(".ant-modal").last()
                await expect(deleteModal).toBeVisible({timeout: 15000})
                await deleteModal.getByRole("button", {name: "Delete"}).click()
                await expect(deleteModal).not.toBeVisible({timeout: 30000})
            })

            await scenarios.then("the deleted provider row is no longer visible", async () => {
                const customProvidersSection = page
                    .getByText("Custom providers", {exact: true})
                    .locator("xpath=ancestor::section[1]")
                    .first()

                const deletedRow = customProvidersSection
                    .getByRole("table")
                    .first()
                    .getByRole("row")
                    .filter({has: page.getByRole("cell", {name: providerName, exact: true})})
                    .first()

                await expect(deletedRow).not.toBeVisible({timeout: 15000})
            })
        },
    )
}

export default modelHubTests
