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

const scenarios = createScenarios(test)

const smokeTags = buildAcceptanceTags({
    scope: [TestScope.DATASETS],
    coverage: [TestCoverage.SMOKE, TestCoverage.LIGHT],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.FAST,
})

const lightTags = buildAcceptanceTags({
    scope: [TestScope.DATASETS],
    coverage: [TestCoverage.LIGHT, TestCoverage.FULL],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.FAST,
})

const navigateToTestsets = async (page: any, uiHelpers: any) => {
    await page.goto("/apps", {waitUntil: "domcontentloaded"})
    const testSetsLink = page.locator('a:has-text("Test sets")').first()
    await expect(testSetsLink).toBeVisible({timeout: 10000})
    await testSetsLink.click()
    await uiHelpers.waitForPath("/testsets")
    await expect(page.getByRole("heading", {name: "Testsets"})).toBeVisible({timeout: 10000})
}

const testsetTests = () => {
    test(
        "Test Sets > should create a new testset from scratch",
        {tag: smokeTags},
        async ({page, uiHelpers, apiHelpers}) => {
            const testsetName = `e2e-scratch-${Date.now()}`

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("the user is on the Test Sets page", async () => {
                await navigateToTestsets(page, uiHelpers)
            })

            await scenarios.when(
                "the user creates a new empty testset with a unique name",
                async () => {
                    await page.getByRole("button", {name: "Create new testset"}).click()
                    await page.getByRole("button", {name: /new via ui/i}).click()
                    const nameInput = page.locator('input[placeholder="Enter a name"]').first()
                    await expect(nameInput).toBeVisible()
                    await nameInput.fill(testsetName)
                    await page.getByRole("button", {name: "Create testset"}).click()
                    await uiHelpers.waitForPath("/testsets/new")

                    // Add a row so there are unsaved changes to commit
                    await page.getByRole("button", {name: "Add row"}).click()

                    // Commit the new testset
                    await page.getByRole("button", {name: "Commit"}).click()
                    const commitModal = page
                        .locator(".ant-modal")
                        .filter({hasText: "Commit Changes"})
                        .first()
                    await expect(commitModal).toBeVisible({timeout: 10000})
                    await commitModal.getByRole("button", {name: "Commit"}).click()

                    // Wait for navigation to the saved revision
                    await page.waitForURL(/\/testsets\/(?!new)/, {timeout: 15000})
                },
            )

            await scenarios.then("the new testset is visible in the testsets list", async () => {
                const basePath = apiHelpers.getProjectScopedBasePath()
                await page.goto(`${basePath}/testsets`, {waitUntil: "domcontentloaded"})
                await uiHelpers.expectText(testsetName)
            })
        },
    )

    test(
        "Test Sets > should upload a testset from CSV",
        {tag: lightTags},
        async ({page, uiHelpers, apiHelpers}) => {
            const testsetName = `e2e-csv-${Date.now()}`
            const csvContent = "column1,column2\nvalue1a,value1b\nvalue2a,value2b"

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("the user is on the Test Sets page", async () => {
                await navigateToTestsets(page, uiHelpers)
            })

            await scenarios.when("the user uploads a CSV file as a new testset", async () => {
                await page.getByRole("button", {name: "Create new testset"}).click()

                // Upload the CSV file via the hidden file input
                const fileInput = page.locator('input[type="file"]').first()
                await fileInput.setInputFiles({
                    name: "testset.csv",
                    mimeType: "text/csv",
                    buffer: Buffer.from(csvContent),
                })

                // After file selection, enter a name and create
                const nameInput = page.locator('input[placeholder="Enter a name"]').first()
                await expect(nameInput).toBeVisible({timeout: 10000})
                await nameInput.clear()
                await nameInput.fill(testsetName)
                await page.getByRole("button", {name: "Create testset"}).click()

                // Wait for navigation to the new testset revision
                await page.waitForURL(/\/testsets\/(?!new)/, {timeout: 15000})
            })

            await scenarios.then(
                "the uploaded testset appears in the testsets list with the correct row count",
                async () => {
                    const basePath = apiHelpers.getProjectScopedBasePath()
                    await page.goto(`${basePath}/testsets`, {waitUntil: "domcontentloaded"})
                    await uiHelpers.expectText(testsetName)

                    // Navigate into the testset to verify row count (2 data rows in the CSV)
                    const row = page
                        .locator("[data-row-key]")
                        .filter({hasText: testsetName})
                        .first()
                    await row.click()
                    await expect(
                        page.locator('[data-testid="testcase-row"], [data-row-key]').filter({
                            hasNot: page.locator("th"),
                        }),
                    ).toHaveCount(2, {timeout: 10000})
                },
            )
        },
    )

    test(
        "Test Sets > should edit a testcase inline and persist the change",
        {tag: lightTags},
        async ({page, uiHelpers, apiHelpers}) => {
            const editedValue = `edited-${Date.now()}`
            let revisionId: string

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("the user is on the Test Sets page", async () => {
                await navigateToTestsets(page, uiHelpers)
            })

            await scenarios.and("at least one testset exists", async () => {
                const created = await apiHelpers.createTestset({
                    name: `e2e-edit-${Date.now()}`,
                    rows: [{input: "original value", expected: "expected"}],
                })
                revisionId = created.revisionId ?? ""
                test.skip(!revisionId, "Testset creation did not return a revisionId")
            })

            await scenarios.when(
                "the user opens that testset and edits a testcase cell inline",
                async () => {
                    const basePath = apiHelpers.getProjectScopedBasePath()
                    await page.goto(`${basePath}/testsets/${revisionId}`, {
                        waitUntil: "domcontentloaded",
                    })

                    // Click a cell to make it editable
                    const cell = page
                        .locator(".ant-table-cell")
                        .filter({hasText: "original value"})
                        .first()
                    await expect(cell).toBeVisible({timeout: 10000})
                    await cell.click()

                    // An inline input or textarea should appear
                    const cellInput = page
                        .locator(".ant-table-cell input, .ant-table-cell textarea")
                        .first()
                    await expect(cellInput).toBeVisible({timeout: 5000})
                    await cellInput.clear()
                    await cellInput.fill(editedValue)
                    await cellInput.press("Tab")

                    // Commit the changes
                    await page.getByRole("button", {name: "Commit"}).click()
                    const commitModal = page
                        .locator(".ant-modal")
                        .filter({hasText: "Commit Changes"})
                        .first()
                    await expect(commitModal).toBeVisible({timeout: 10000})
                    await commitModal.getByRole("button", {name: "Commit"}).click()
                    await page.waitForURL(/\/testsets\/(?!new)/, {timeout: 15000})
                },
            )

            await scenarios.then("the edited value is saved and visible after reload", async () => {
                await page.reload({waitUntil: "domcontentloaded"})
                await uiHelpers.expectText(editedValue)
            })
        },
    )

    test(
        "Test Sets > should add and delete rows and columns",
        {tag: lightTags},
        async ({page, uiHelpers, apiHelpers}) => {
            const newColumnName = `col-${Date.now()}`
            let revisionId: string

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("the user is on the Test Sets page", async () => {
                await navigateToTestsets(page, uiHelpers)
            })

            await scenarios.and("at least one testset exists", async () => {
                const created = await apiHelpers.createTestset({
                    name: `e2e-addrow-${Date.now()}`,
                    rows: [{input: "existing row"}],
                })
                revisionId = created.revisionId ?? ""
                test.skip(!revisionId, "Testset creation did not return a revisionId")
            })

            await scenarios.when(
                "the user opens that testset and adds a new row and a new column",
                async () => {
                    const basePath = apiHelpers.getProjectScopedBasePath()
                    await page.goto(`${basePath}/testsets/${revisionId}`, {
                        waitUntil: "domcontentloaded",
                    })

                    // Add a new row
                    await page.getByRole("button", {name: "Add row"}).click()

                    // Add a new column
                    await page.getByRole("button", {name: "Add column"}).click()
                    const addColumnModal = page
                        .locator(".ant-modal")
                        .filter({hasText: "Add Column"})
                        .first()
                    await expect(addColumnModal).toBeVisible({timeout: 5000})
                    await addColumnModal
                        .locator('input[placeholder="Enter column name"]')
                        .fill(newColumnName)
                    await addColumnModal.getByRole("button", {name: "Add"}).click()
                },
            )

            await scenarios.then(
                "the new row and column are visible in the testset table",
                async () => {
                    // The new column header should be visible
                    await expect(
                        page.locator("th").filter({hasText: newColumnName}).first(),
                    ).toBeVisible({timeout: 5000})

                    // There should be at least 2 rows now (original + new)
                    const dataCells = page.locator(".ant-table-tbody tr")
                    await expect(dataCells).toHaveCount(2, {timeout: 5000})
                },
            )

            await scenarios.when("the user deletes that row and that column", async () => {
                // Delete the last (new) row
                const rows = page.locator(".ant-table-tbody tr")
                const lastRow = rows.last()
                const actionsButton = lastRow.locator('[aria-label="Actions"]').first()
                await actionsButton.click()
                await page.getByRole("menuitem", {name: "Delete"}).click()

                // Delete the new column via its header button
                const columnHeader = page.locator("th").filter({hasText: newColumnName}).first()
                await columnHeader.hover()
                await page
                    .getByRole("button", {name: "Delete column"})
                    .filter({visible: true})
                    .first()
                    .click()
                const deleteColumnModal = page
                    .locator(".ant-modal")
                    .filter({hasText: "Delete Column"})
                    .first()
                await expect(deleteColumnModal).toBeVisible({timeout: 5000})
                await deleteColumnModal.getByRole("button", {name: "Delete"}).click()
            })

            await scenarios.then("they are no longer present in the testset table", async () => {
                // Column should be gone
                await expect(page.locator("th").filter({hasText: newColumnName})).toHaveCount(0, {
                    timeout: 5000,
                })

                // Only 1 original row should remain
                await expect(page.locator(".ant-table-tbody tr")).toHaveCount(1, {timeout: 5000})
            })
        },
    )

    test(
        "Test Sets > should delete a testset",
        {tag: smokeTags},
        async ({page, uiHelpers, apiHelpers}) => {
            let testsetName: string

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("the user is on the Test Sets page", async () => {
                await navigateToTestsets(page, uiHelpers)
            })

            await scenarios.and("at least one testset exists", async () => {
                const created = await apiHelpers.createTestset({
                    name: `e2e-delete-${Date.now()}`,
                    rows: [{input: "test"}],
                })
                testsetName = created.name
                // Refresh the page to see the newly created testset
                await page.reload({waitUntil: "domcontentloaded"})
                await expect(page.getByRole("heading", {name: "Testsets"})).toBeVisible({
                    timeout: 10000,
                })
            })

            await scenarios.when("the user deletes that testset", async () => {
                const testsetRow = page
                    .locator("[data-row-key]")
                    .filter({hasText: testsetName})
                    .first()
                await expect(testsetRow).toBeVisible({timeout: 10000})

                // Click the gear (actions) button on the testset row
                const gearButton = testsetRow.getByRole("button").last()
                await gearButton.click()
                await page.getByRole("menuitem", {name: "Delete"}).click()
                await uiHelpers.confirmModal("Delete")
            })

            await scenarios.then("the testset no longer appears in the testsets list", async () => {
                await uiHelpers.expectNoText(testsetName)
            })
        },
    )
}

export default testsetTests
