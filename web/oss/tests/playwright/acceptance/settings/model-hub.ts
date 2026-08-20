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
import {expect, pollLocatorState} from "@agenta/web-tests/utils"
import type {Locator} from "@playwright/test"

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
// Product copy for the custom-providers section. The section header is plural; the
// button that opens its create form is "Add endpoint". Note that the provider-KIND
// label in the type dropdown is still the singular "OpenAI-compatible endpoint" — a
// different string in a different place, deliberately left as-is below.
const CUSTOM_PROVIDERS_SECTION_HEADER = "OpenAI-compatible endpoints"
const CUSTOM_PROVIDER_ADD_BUTTON_LABEL = "Add endpoint"

/**
 * A data row in one of the provider tables.
 *
 * These tables are virtualised: the semantic `<table>` carries only the `<thead>`, and
 * each body row is rendered outside it as a `[data-row-key]` node with no `row`/`cell`
 * role. Matching on `getByRole("row")`/`getByRole("cell")` therefore only ever sees the
 * header. `[data-row-key]` is how the rest of this suite addresses virtualised rows.
 */
const providerRow = (section: Locator, name: string) =>
    section.locator("[data-row-key]").filter({hasText: name}).first()

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
                .getByText(CUSTOM_PROVIDERS_SECTION_HEADER, {exact: true})
                .locator("xpath=ancestor::section[1]")
                .first()
            const mockRow = providerRow(customProvidersSection, "mock")

            await expect(mockRow).toBeVisible({timeout: 15000})
            await expect(mockRow).toContainText("mock")
        })
    })

    test(
        "should configure a standard provider key and verify it is listed",
        {tag: tagsLight},
        async ({page, testProviderHelpers}, testInfo) => {
            // Captured before configuring so the "then" step can assert the count went
            // down. Counting rows instead does not work: the table is virtualised, so the
            // DOM holds only the rows currently in view.
            let configureNowCountBefore = 0

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

                    const hasConfigureNow = await pollLocatorState(() =>
                        configureNowButton.isVisible({timeout: 5000}),
                    )

                    testInfo.skip(
                        !hasConfigureNow,
                        "All standard providers are already configured — skipping standard provider key test",
                    )

                    configureNowCountBefore = await standardProvidersSection
                        .getByRole("button", {name: "Configure now"})
                        .count()

                    await configureNowButton.click()

                    // Matched by role: this modal renders through `EnhancedModal`, a facade
                    // over the @agenta/ui (Radix) `Dialog`, so there is no `.ant-modal`.
                    const modal = page.getByRole("dialog").last()
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

                    // One more provider is configured than before, so one fewer row offers
                    // "Configure now". Comparing against a row count does not work here —
                    // the table is virtualised, so the number of rows in the DOM depends on
                    // the viewport rather than on how many providers exist.
                    await expect
                        .poll(() => configureNowButtons.count(), {timeout: 15000})
                        .toBeLessThan(configureNowCountBefore)
                },
            )

            await scenarios.when(
                "the user deletes the configured standard provider key",
                async () => {
                    const standardProvidersSection = page
                        .getByText("Standard providers", {exact: true})
                        .locator("xpath=ancestor::section[1]")
                        .first()

                    // Deleting is no longer a visible danger button — it is an entry in the
                    // row's actions menu. That menu only renders for rows that already have
                    // a key, so "the first row with an actions button" IS a configured row.
                    const configuredRow = standardProvidersSection
                        .locator("[data-row-key]")
                        .filter({has: page.locator("button")})
                        .first()
                    await expect(configuredRow).toBeVisible({timeout: 15000})
                    await configuredRow.locator("button").last().click()

                    // Scope by name: the sidebar navigation also uses role="menuitem".
                    const removeKeyItem = page.getByRole("menuitem", {name: "Remove key"})
                    await expect(removeKeyItem).toBeVisible({timeout: 10000})
                    await removeKeyItem.click()

                    // Matched by role: this confirmation renders through `EnhancedModal`
                    // (Radix `Dialog`), so there is no `.ant-modal`.
                    const deleteModal = page.getByRole("dialog").last()
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
                    const customProvidersSection = page
                        .getByText(CUSTOM_PROVIDERS_SECTION_HEADER, {exact: true})
                        .locator("xpath=ancestor::section[1]")
                        .first()

                    // The button that opens the create form. It is rendered twice inside
                    // the section (header + empty-state row), hence `.first()`.
                    const createButton = customProvidersSection
                        .getByRole("button", {
                            name: CUSTOM_PROVIDER_ADD_BUTTON_LABEL,
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
                    const customProvidersSection = page
                        .getByText(CUSTOM_PROVIDERS_SECTION_HEADER, {exact: true})
                        .locator("xpath=ancestor::section[1]")
                        .first()

                    const newRow = providerRow(customProvidersSection, providerName)

                    await expect(newRow).toBeVisible({timeout: 15000})
                },
            )

            await scenarios.when("the user deletes the newly created custom provider", async () => {
                const customProvidersSection = page
                    .getByText(CUSTOM_PROVIDERS_SECTION_HEADER, {exact: true})
                    .locator("xpath=ancestor::section[1]")
                    .first()

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
                const customProvidersSection = page
                    .getByText(CUSTOM_PROVIDERS_SECTION_HEADER, {exact: true})
                    .locator("xpath=ancestor::section[1]")
                    .first()

                const deletedRow = providerRow(customProvidersSection, providerName)

                await expect(deletedRow).not.toBeVisible({timeout: 15000})
            })
        },
    )
}

export default modelHubTests
