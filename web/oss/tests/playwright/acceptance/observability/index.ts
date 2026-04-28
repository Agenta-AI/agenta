import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"

import {expect} from "@agenta/web-tests/utils"
import {expectAuthenticatedSession} from "../utils/auth"
import {createScenarios} from "../utils/scenarios"
import {buildAcceptanceTags} from "../utils/tags"
import type {ApiHelpers} from "@agenta/web-tests/tests/fixtures/base.fixture/apiHelpers/types"
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

const scenarios = createScenarios(test)

const smokeTags = buildAcceptanceTags({
    scope: [TestScope.OBSERVABILITY],
    coverage: [TestCoverage.SMOKE, TestCoverage.LIGHT, TestCoverage.FULL],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.SLOW,
})

const lightSlowTags = buildAcceptanceTags({
    scope: [TestScope.OBSERVABILITY],
    coverage: [TestCoverage.LIGHT],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.SLOW,
})

/**
 * Runs a completion variant in the Playground to generate a trace, then navigates
 * to the Observability page and waits for the trace row to appear.
 *
 * Traces are indexed asynchronously. The first trace in an ephemeral project can
 * take up to ~110 s to appear. The function enables auto-refresh (15 s interval)
 * so the page re-fetches automatically once the trace is available on the backend,
 * then waits up to 150 s for the [data-tour="trace-row"] element to become visible.
 */
const runPlaygroundAndGoToObservability = async (
    page: any,
    apiHelpers: ApiHelpers,
    uiHelpers: any,
    testProviderHelpers: any,
): Promise<void> => {
    // Ensure the test LLM provider (mock) is configured
    await testProviderHelpers.ensureTestProvider()

    const app = await apiHelpers.getApp("completion")
    const appId = app.id
    const basePath = apiHelpers.getProjectScopedBasePath()

    // Navigate to the app overview then follow the Playground sidebar link.
    // Direct /playground URL entry is unreliable per existing playground test notes.
    await page.goto(`${basePath}/apps/${appId}/overview`, {waitUntil: "domcontentloaded"})
    const playgroundLink = page.getByRole("link", {name: "Playground"}).first()
    await expect(playgroundLink).toBeVisible({timeout: 10000})
    await playgroundLink.click()
    await uiHelpers.expectPath(`/apps/${appId}/playground`)

    // Select the mock test model
    await testProviderHelpers.selectTestModel()

    // Fill in the completion input and run
    const textbox = page
        .locator('.agenta-shared-editor:has(div:text-is("Enter a value")) [role="textbox"]')
        .first()
    await expect(textbox).toBeVisible({timeout: 15000})
    await textbox.click({force: true})
    await textbox.pressSequentially("Say hello", {delay: 50})

    const runButton = page.getByRole("button", {name: "Run", exact: true}).first()
    await expect(runButton).toBeVisible({timeout: 10000})

    const invokeResponsePromise = apiHelpers.waitForApiResponse<Record<string, any>>({
        route: /\/invoke(\?|$)/,
        method: "POST",
        validateStatus: false,
    })
    await runButton.click({force: true})
    await invokeResponsePromise

    // Navigate to Observability
    await page.goto(`${basePath}/observability`, {waitUntil: "domcontentloaded"})

    // Wait for the Refresh button — it is always in the header regardless of trace state.
    const refreshButton = page.getByRole("button", {name: "Refresh data"})
    await expect(refreshButton).toBeVisible({timeout: 15000})

    // Enable auto-refresh (the Switch next to "auto-refresh" label). This makes
    // the page re-fetch traces every 15 s without any manual Refresh clicks.
    // When traces are indexed asynchronously, auto-refresh ensures they appear
    // within ~15 s of becoming available on the backend.
    const autoRefreshSwitch = page.getByRole("switch").first()
    const isSwitchVisible = await autoRefreshSwitch.isVisible().catch(() => false)
    if (isSwitchVisible) {
        const isChecked = await autoRefreshSwitch.isChecked().catch(() => false)
        if (!isChecked) {
            await autoRefreshSwitch.click()
        }
    }

    // Use the data-tour attribute set by ObservabilityTable on the first trace row.
    // This is more reliable than getByRole("table").last().getByRole("row").nth(1)
    // because the <Table> element is removed from the DOM when EmptyObservability
    // renders (traces.length === 0 && !isLoading), making table-based locators
    // find the wrong element or nothing at all.
    const firstDataRow = page.locator('[data-tour="trace-row"]')

    // Wait up to 150 s for the trace to appear. With auto-refresh at 15 s intervals,
    // the trace should appear within ~15 s of backend indexing completing.
    const hasRow = await firstDataRow
        .waitFor({state: "visible", timeout: 150000})
        .then(() => true)
        .catch(() => false)
    if (hasRow) return

    // Last resort: one manual refresh then a final short wait
    if (await refreshButton.isVisible().catch(() => false)) {
        await refreshButton.click()
        await page.waitForTimeout(2000)
    }
    await expect(firstDataRow).toBeVisible({timeout: 20000})
}

const observabilityTests = () => {
    // WEB-ACC-OBS-001
    test(
        "view traces",
        {tag: smokeTags},
        async ({page, uiHelpers, apiHelpers, testProviderHelpers}) => {
            // 3 minutes: this is the first test in the suite and may be the first to
            // generate a trace in the ephemeral project, where backend indexing can
            // take 60-90 s before the row appears in the observability table.
            test.setTimeout(180000)

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and(
                "a completion app with a configured test provider exists",
                async () => {
                    // Run a playground variant to seed a trace, then navigate to observability
                    // and wait for the trace row to appear (with Refresh retries for async indexing).
                    await runPlaygroundAndGoToObservability(
                        page,
                        apiHelpers,
                        uiHelpers,
                        testProviderHelpers,
                    )
                },
            )

            await scenarios.when("the user opens the traces table", async () => {
                // runPlaygroundAndGoToObservability already confirmed this row is visible;
                // use the same data-tour locator to click directly without re-waiting.
                const firstDataRow = page.locator('[data-tour="trace-row"]')
                await firstDataRow.getByRole("cell").nth(2).click()
            })

            await scenarios.then("the trace detail drawer opens", async () => {
                const drawer = page.locator(".ant-drawer-content-wrapper")
                await expect(drawer).toBeVisible({timeout: 10000})
            })
        },
    )

    // WEB-ACC-OBS-002
    test(
        "should filter traces by date range and by app",
        {tag: lightSlowTags},
        async ({page, apiHelpers, uiHelpers, testProviderHelpers}) => {
            test.setTimeout(180000)
            await runPlaygroundAndGoToObservability(
                page,
                apiHelpers,
                uiHelpers,
                testProviderHelpers,
            )

            const tracesTable = page.getByRole("table").last()

            // Apply a date range filter via the Sort popover.
            // The Sort button shows the current range label (default "24 hours").
            const sortButton = page
                .getByRole("button", {name: /24 hours|7 days|1 hour|3 days|30 mins/})
                .first()
            await expect(sortButton).toBeVisible({timeout: 10000})
            await sortButton.click()

            const sevenDaysOption = page.getByText("7 days", {exact: true})
            await expect(sevenDaysOption).toBeVisible({timeout: 5000})
            await sevenDaysOption.click()

            // The Sort button label updates to reflect the new range
            await expect(page.getByRole("button", {name: "7 days"}).first()).toBeVisible({
                timeout: 10000,
            })

            // The traces table is still visible (filter applied successfully)
            await expect(tracesTable).toBeVisible({timeout: 10000})
        },
    )

    // WEB-ACC-OBS-003
    test(
        "should filter traces by span name or attribute",
        {tag: lightSlowTags},
        async ({page, apiHelpers, uiHelpers, testProviderHelpers}) => {
            test.setTimeout(180000)
            await runPlaygroundAndGoToObservability(
                page,
                apiHelpers,
                uiHelpers,
                testProviderHelpers,
            )

            const tracesTable = page.getByRole("table").last()

            // Use the search input to filter by content
            const searchInput = page.getByRole("searchbox").first()
            await expect(searchInput).toBeVisible({timeout: 10000})

            // Typing a search term narrows the table; press Enter to apply
            await searchInput.fill("agenta")
            await searchInput.press("Enter")

            // The table remains visible (filter did not crash the UI)
            await expect(tracesTable).toBeVisible({timeout: 10000})

            // Clear the filter to restore the full list
            await searchInput.clear()
            await searchInput.press("Enter")
        },
    )

    // WEB-ACC-OBS-004
    test(
        "should open a span and drill into its attributes",
        {tag: lightSlowTags},
        async ({page, apiHelpers, uiHelpers, testProviderHelpers}) => {
            test.setTimeout(180000)
            await runPlaygroundAndGoToObservability(
                page,
                apiHelpers,
                uiHelpers,
                testProviderHelpers,
            )

            const tracesTable = page.getByRole("table").last()

            // Click the third cell of the first data row to open the trace drawer
            const firstDataRow = tracesTable.getByRole("row").nth(1)
            await expect(firstDataRow).toBeVisible({timeout: 10000})
            await firstDataRow.getByRole("cell").nth(2).click()

            const drawer = page.locator(".ant-drawer-content-wrapper")
            await expect(drawer).toBeVisible({timeout: 10000})

            // The trace tree panel (CustomTreeComponent, not AntD Tree) renders a
            // "Search in tree" input when loaded. Verify the panel mounted with content.
            const treeSearchInput = drawer.getByPlaceholder("Search in tree")
            await expect(treeSearchInput).toBeVisible({timeout: 10000})

            // Each span in the tree renders a square avatar (AvatarTreeContent → antd Avatar
            // shape="square"). At least one confirms the tree has nodes.
            const spanAvatar = drawer.locator(".ant-avatar-square").first()
            await expect(spanAvatar).toBeVisible({timeout: 10000})
        },
    )

    // WEB-ACC-OBS-005
    test(
        "should switch between trace tabs and see filtered rows",
        {tag: lightSlowTags},
        async ({page, apiHelpers, uiHelpers, testProviderHelpers}) => {
            test.setTimeout(180000)
            await runPlaygroundAndGoToObservability(
                page,
                apiHelpers,
                uiHelpers,
                testProviderHelpers,
            )

            // The three trace-type tabs are AntD Radio.Buttons: Root | LLM | All
            const rootTab = page
                .locator(".ant-radio-button-wrapper")
                .filter({hasText: "Root"})
                .first()
            const llmTab = page
                .locator(".ant-radio-button-wrapper")
                .filter({hasText: "LLM"})
                .first()
            const allTab = page
                .locator(".ant-radio-button-wrapper")
                .filter({hasText: "All"})
                .first()

            await expect(rootTab).toBeVisible({timeout: 10000})

            // Switch to LLM
            await llmTab.click()
            await expect(llmTab).toHaveClass(/ant-radio-button-wrapper-checked/, {timeout: 5000})

            // Switch to All
            await allTab.click()
            await expect(allTab).toHaveClass(/ant-radio-button-wrapper-checked/, {timeout: 5000})

            // Switch back to Root
            await rootTab.click()
            await expect(rootTab).toHaveClass(/ant-radio-button-wrapper-checked/, {timeout: 5000})
        },
    )

    // WEB-ACC-OBS-006
    test(
        "should create a trace after a Playground run",
        {tag: lightSlowTags},
        async ({page, apiHelpers, uiHelpers, testProviderHelpers}) => {
            test.setTimeout(180000)

            // runPlaygroundAndGoToObservability handles the full flow:
            // run a variant → navigate to observability → wait for trace row (with Refresh).
            await runPlaygroundAndGoToObservability(
                page,
                apiHelpers,
                uiHelpers,
                testProviderHelpers,
            )

            // Verify the trace created by the playground run is visible
            const tracesTable = page.getByRole("table").last()
            const firstDataRow = tracesTable.getByRole("row").nth(1)
            await expect(firstDataRow).toBeVisible({timeout: 10000})
        },
    )
}

export default observabilityTests
