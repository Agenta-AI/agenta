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

                    // Add a row — this auto-opens the TestcaseEditDrawer for the new row
                    await page.getByRole("button", {name: "Add row"}).click()

                    // Close the drawer so the Commit button is accessible.
                    // The drawer has closeIcon={null} — no X button. Use the footer "Cancel" button.
                    // "Cancel" on an unedited new row just calls onClose() without discarding.
                    await expect(page.locator(".ant-drawer")).toBeVisible({timeout: 5000})
                    await page.locator(".ant-drawer").getByRole("button", {name: "Cancel"}).click()
                    await expect(page.locator(".ant-drawer")).toBeHidden({timeout: 5000})

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
                "the uploaded testset appears in the testsets list with CSV data",
                async () => {
                    // After the when step we are already on the testset detail page.
                    // Verify CSV column headers and data values are present before navigating away.
                    await expect(page.getByText("column1", {exact: false}).first()).toBeVisible({
                        timeout: 10000,
                    })
                    await expect(page.getByText("value1a", {exact: false}).first()).toBeVisible({
                        timeout: 10000,
                    })

                    // Also confirm the testset appears by name in the testsets list.
                    const basePath = apiHelpers.getProjectScopedBasePath()
                    await page.goto(`${basePath}/testsets`, {waitUntil: "domcontentloaded"})
                    await uiHelpers.expectText(testsetName)
                },
            )
        },
    )

    test(
        "Test Sets > should edit a testcase and persist the change",
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
                "the user opens that testset, edits a testcase via the edit drawer, and commits",
                async () => {
                    const basePath = apiHelpers.getProjectScopedBasePath()
                    await page.goto(`${basePath}/testsets/${revisionId}`, {
                        waitUntil: "domcontentloaded",
                    })

                    // Click a data row cell to open the TestcaseEditDrawer
                    const cell = page
                        .locator(".ant-table-cell")
                        .filter({hasText: "original value"})
                        .first()
                    await expect(cell).toBeVisible({timeout: 10000})
                    await cell.click()

                    // Wait for the edit drawer to open
                    const drawerBody = page.locator(".ant-drawer-body")
                    await expect(drawerBody).toBeVisible({timeout: 10000})

                    // Find the contenteditable Lexical editor field in the drawer
                    const editableField = drawerBody.locator('[contenteditable="true"]').first()
                    await expect(editableField).toBeVisible({timeout: 5000})

                    // Use locator.fill() to replace field content. Playwright's fill() on
                    // contenteditable uses CDP Input.insertText which fires beforeinput events
                    // that Lexical intercepts and uses to update its EditorState. This is more
                    // reliable than keyboard-based select-all + type, which can bypass Lexical's
                    // event handling and leave the draft atom with the original value.
                    await editableField.fill(editedValue)

                    // Verify the field content was replaced
                    await expect(editableField).toContainText(editedValue, {timeout: 5000})

                    // The "Apply and Continue Editing" button becomes enabled only when the
                    // Lexical onChange has fired and updated the draft atom (hasSessionDirty=true).
                    // Wait for it to be enabled before clicking — this implicitly confirms the
                    // draft was updated.
                    const applyButton = page
                        .locator(".ant-drawer")
                        .getByRole("button", {name: "Apply and Continue Editing"})
                    await expect(applyButton).toBeEnabled({timeout: 5000})
                    await applyButton.click()
                    await expect(page.locator(".ant-drawer")).toBeHidden({timeout: 5000})

                    // Commit the changes
                    await page.getByRole("button", {name: "Commit"}).click()
                    const commitModal = page
                        .locator(".ant-modal")
                        .filter({hasText: "Commit Changes"})
                        .first()
                    await expect(commitModal).toBeVisible({timeout: 10000})
                    const preCommitUrl = page.url()
                    await commitModal.getByRole("button", {name: "Commit"}).click()
                    // waitForURL with a regex resolves immediately if the current URL already matches.
                    // Use a function predicate to wait for the URL to actually change to the new revision.
                    await page.waitForURL((url) => url.href !== preCommitUrl, {timeout: 15000})
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
            const testsetName = `e2e-addrow-${Date.now()}`
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
                    name: testsetName,
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

                    // Wait for the testset detail page to hydrate before interacting.
                    // Clicking "Add row" before the schema loads opens an empty drawer.
                    await expect(page.getByRole("heading", {name: testsetName})).toBeVisible({
                        timeout: 10000,
                    })
                    await expect(page.locator("th").filter({hasText: "input"}).first()).toBeVisible(
                        {timeout: 10000},
                    )
                    await expect(page.locator(".ant-table-tbody")).toContainText("existing row", {
                        timeout: 10000,
                    })

                    // Add a new row (auto-opens the edit drawer for the new row)
                    await page.getByRole("button", {name: "Add row"}).click()

                    // The drawer opens for the new row. We must edit the Lexical field in a way
                    // that reliably updates its EditorState before closing the drawer.
                    await expect(page.locator(".ant-drawer")).toBeVisible({timeout: 5000})
                    await expect(page.locator(".ant-drawer-body")).not.toContainText(
                        "No items to display",
                        {timeout: 5000},
                    )
                    const newRowField = page
                        .locator(".ant-drawer-body")
                        .locator('[contenteditable="true"], input, textarea')
                        .first()
                    await expect(newRowField).toBeVisible({timeout: 5000})
                    await newRowField.fill("new-row-value")
                    await expect(newRowField).toContainText("new-row-value", {timeout: 5000})

                    const newRowApplyBtn = page
                        .locator(".ant-drawer")
                        .getByRole("button", {name: "Apply and Continue Editing"})
                    await expect(newRowApplyBtn).toBeEnabled({timeout: 5000})
                    await newRowApplyBtn.click()
                    await expect(page.locator(".ant-drawer")).toBeHidden({timeout: 5000})

                    await expect(
                        page.locator("[data-row-key]").filter({hasText: "new-row-value"}).first(),
                    ).toBeVisible({timeout: 5000})

                    // Add a new column — the button has a PlusOutlined (anticon-plus) icon and
                    // sits in the table header before the column-visibility gear button.
                    // ant-table-cell-fix-right may not be applied without horizontal scroll,
                    // so locate by the AntD icon class which is unique in the thead.
                    await page.locator(".ant-table-thead .anticon-plus").click()

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

                    // The new row with "new-row-value" should be visible.
                    // AntD sets [data-row-key] on every table row including client-side new rows;
                    // .ant-table-row may not match new rows depending on virtual scroll rendering.
                    await expect(
                        page.locator("[data-row-key]").filter({hasText: "new-row-value"}).first(),
                    ).toBeVisible({timeout: 5000})
                },
            )

            await scenarios.when("the user deletes that row and that column", async () => {
                // Delete the new row by finding it via its content ("new-row-value").
                // New rows are prepended (appear above server rows), so we can't rely on
                // rows.last() — instead we locate the row by its unique typed content.
                const newRow = page
                    .locator("[data-row-key]")
                    .filter({hasText: "new-row-value"})
                    .first()
                await expect(newRow).toBeVisible({timeout: 5000})
                const actionsButton = newRow.locator('[aria-label="Actions"]').first()
                await actionsButton.click()
                await page.getByRole("menuitem", {name: "Delete"}).click()

                // Delete the new column — hover the column header to reveal inline action buttons,
                // then click the danger (Trash) button
                const columnHeader = page.locator("th").filter({hasText: newColumnName}).first()
                await columnHeader.hover()
                await columnHeader.locator(".ant-btn-dangerous").click()
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

                // "new-row-value" cell should be gone (the new row was deleted)
                await expect(
                    page.locator("[data-row-key]").filter({hasText: "new-row-value"}),
                ).toHaveCount(0, {timeout: 5000})

                // The original "existing row" should still be present
                await expect(
                    page.locator("[data-row-key]").filter({hasText: "existing row"}).first(),
                ).toBeVisible({timeout: 5000})
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

                // Wait for the confirmation modal to close before asserting absence.
                // The modal body contains the testset name, which would cause a strict-mode
                // violation in expectNoText if the modal is still in the DOM.
                await page
                    .locator(".ant-modal")
                    .filter({hasText: "Are you sure?"})
                    .waitFor({state: "hidden", timeout: 15000})
            })

            await scenarios.then("the testset no longer appears in the testsets list", async () => {
                await uiHelpers.expectNoText(testsetName)
            })
        },
    )
}

export default testsetTests
