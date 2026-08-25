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
import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"
import type {Locator, Page} from "@playwright/test"

import {expectAuthenticatedSession} from "../utils/auth"
import {createScenarios} from "../utils/scenarios"
import {buildAcceptanceTags} from "../utils/tags"

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
const PROVIDER_ADD_BUTTON_LABEL = "Add provider"

/**
 * A data row in one of the provider tables.
 *
 * Anchor on the exact Name cell so provider text in another column cannot select the
 * wrong connection, then use its clickable table-row ancestor.
 */
const providerRow = (section: Locator, name: string) =>
    section.getByRole("cell", {name, exact: true}).locator("xpath=ancestor::tr[1]").first()

const providersSection = (page: Page) =>
    page
        .getByRole("button", {name: PROVIDER_ADD_BUTTON_LABEL})
        .first()
        .locator("xpath=ancestor::section[1]")
        .first()

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

        await scenarios.then('the providers table lists the "mock" connection', async () => {
            const mockRow = providerRow(providersSection(page), "mock")

            await expect(mockRow).toBeVisible({timeout: 15000})
            await expect(mockRow).toContainText("mock")
        })
    })

    test(
        "should test a stored provider connection and keep it listed",
        {tag: tagsLight},
        async ({page, testProviderHelpers}) => {
            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.given("a stored mock provider is listed in Settings", async () => {
                await testProviderHelpers.ensureTestProvider()
            })

            await scenarios.when(
                "the user tests the connection without re-entering its write-only key",
                async () => {
                    const mockRow = providerRow(providersSection(page), "mock")
                    await expect(mockRow).toBeVisible({timeout: 15000})
                    await mockRow.click()

                    const drawer = page.getByRole("dialog").last()
                    await expect(drawer).toBeVisible({timeout: 15000})
                    await expect(drawer.getByText(/Key configured/)).toBeVisible({
                        timeout: 15000,
                    })

                    await drawer.getByRole("button", {name: "Test"}).click()
                    const done = drawer.getByRole("button", {name: "Done"})
                    await expect(done).toBeEnabled({timeout: 30000})
                    await done.click()
                    await expect(drawer).not.toBeVisible({timeout: 15000})
                },
            )

            await scenarios.then(
                "the stored connection remains in the providers table",
                async () => {
                    await expect(providerRow(providersSection(page), "mock")).toBeVisible({
                        timeout: 15000,
                    })
                },
            )
        },
    )

    // Skipped per release-gate decision (Mahmoud, 2026-08-10): rotating environment-sensitive
    // failure in CI (gate run 31401605372). Tracked for repair, not deleted.
    test.skip(
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
                    const customProvidersSection = providersSection(page)

                    // The button that opens the create form. It is rendered twice inside
                    // the section (header + empty-state row), hence `.first()`.
                    const createButton = customProvidersSection
                        .getByRole("button", {
                            name: PROVIDER_ADD_BUTTON_LABEL,
                            exact: true,
                        })
                        .first()
                    await expect(createButton).toBeVisible({timeout: 15000})
                    await createButton.click()

                    // Matched by role: the configure-provider drawer renders through
                    // `EnhancedDrawer`, a facade over the @agenta/ui (Radix) `Sheet`, so
                    // there is no `.ant-drawer-content-wrapper`.
                    const drawer = page.getByRole("dialog").last()
                    await expect(drawer).toBeVisible({timeout: 15000})
                    await expect(drawer.getByText("Configure provider")).toBeVisible({
                        timeout: 15000,
                    })

                    // Select "OpenAI-compatible endpoint" from the provider type dropdown.
                    // This is no longer an antd Select: it is a Radix Popover whose trigger
                    // is a disclosure button (`aria-haspopup="listbox"`) and whose entries
                    // carry `role="option"`.
                    const providerSelect = drawer.locator('button[aria-haspopup="listbox"]').first()
                    await expect(providerSelect).toBeVisible({timeout: 15000})
                    await providerSelect.click()

                    const options = page.getByRole("option")
                    await expect(options.first()).toBeVisible({timeout: 15000})

                    const optionTexts = (await options.allTextContents()).map((t) => t.trim())
                    const customProviderIndex = optionTexts.findIndex(
                        (t) => t === "OpenAI-compatible endpoint",
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
                    const customProvidersSection = providersSection(page)

                    const newRow = providerRow(customProvidersSection, providerName)

                    await expect(newRow).toBeVisible({timeout: 15000})
                },
            )

            await scenarios.when("the user deletes the newly created custom provider", async () => {
                const customProvidersSection = providersSection(page)

                const newRow = providerRow(customProvidersSection, providerName)

                // The row's single button opens its actions menu; deleting is an entry in it.
                await newRow.locator("button").last().click()

                // Scope by name: the sidebar navigation also uses role="menuitem".
                const deleteItem = page.getByRole("menuitem", {name: "Delete endpoint"})
                await expect(deleteItem).toBeVisible({timeout: 10000})
                await deleteItem.click()

                // Matched by role: this confirmation renders through `EnhancedModal`
                // (Radix `Dialog`), so there is no `.ant-modal`.
                const deleteModal = page.getByRole("dialog").last()
                await expect(deleteModal).toBeVisible({timeout: 15000})
                await deleteModal.getByRole("button", {name: "Delete"}).click()
                await expect(deleteModal).not.toBeVisible({timeout: 30000})
            })

            await scenarios.then("the deleted provider row is no longer visible", async () => {
                const customProvidersSection = providersSection(page)

                const deletedRow = providerRow(customProvidersSection, providerName)

                await expect(deletedRow).not.toBeVisible({timeout: 15000})
            })
        },
    )
}

export default modelHubTests
