import {test as baseHumanTest, expect} from "./tests"
import {
    createTagString,
    TestCoverage,
    TestPath,
    TestScope,
} from "@agenta/web-tests/playwright/config/testTags"

const humanAnnotationTests = () => {
    baseHumanTest(
        "should show an error when attempting to create an evaluation with a mismatched testset",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
            ],
        },
        async ({page, apiHelpers, navigateToHumanEvaluation, createHumanEvaluationRun}) => {
            const app = await apiHelpers.getApp("chat")
            const appId = app.app_id

            const variants = await apiHelpers.getVariants(appId)
            const variantName = variants[0].name || variants[0].variant_name

            await navigateToHumanEvaluation(appId)

            await createHumanEvaluationRun({
                variants: variantName,
                name: `e2e-human-${Date.now()}`,
            })

            const message = page.locator(".ant-message").first()
            await expect(message).toBeVisible()
            await expect(message).toHaveText(
                "The testset columns do not match the selected variant input parameters",
            )
        },
    )

    baseHumanTest(
        "should create human evaluation run",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
            ],
        },
        async ({page, apiHelpers, navigateToHumanEvaluation, createHumanEvaluationRun}) => {
            const app = await apiHelpers.getApp()
            const appId = app.app_id

            const variants = await apiHelpers.getVariants(appId)
            const variantName = variants[0].name || variants[0].variant_name

            await navigateToHumanEvaluation(appId)

            await createHumanEvaluationRun({
                variants: variantName,
                name: `e2e-human-${Date.now()}`,
                skipEvaluatorCreation: true,
            })

            await expect(page.locator(".ant-modal").first()).toHaveCount(0)

            await expect(page).toHaveURL(/single_model_test\/.*scenarioId=.*/)
        },
    )

    baseHumanTest(
        "should run scenarios and update status",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
            ],
        },
        async ({
            navigateToHumanAnnotationRun,
            page,
            apiHelpers,
            verifyStatusUpdate,
            switchToTableView,
            runScenarioFromFocusView,
        }) => {
            const app = await apiHelpers.getApp()
            const appId = app.app_id

            await navigateToHumanAnnotationRun(appId)

            // --- Focus View: Single Scenario ---
            await runScenarioFromFocusView()

            // --- Focus View: Run All ---
            // await page.getByRole("button", {name: "Run All"}).click()
            // await expect(page.locator("span").filter({hasText: "Running"})).toBeVisible()
            // await expect(page.locator("span").filter({hasText: "Success"})).toBeVisible()

            // --- Table View ---
            await switchToTableView()

            // Table Row: Run Individual
            const row = page.locator(".ant-table-row").nth(1)
            await row.getByRole("button", {name: "Run"}).click()
            await verifyStatusUpdate(row)

            // Table View: Run All
            await page.getByRole("button", {name: "Run All"}).click()

            const rows = page.locator(".ant-table-row")
            const rowCount = await rows.count()

            for (let i = 0; i < rowCount; i++) {
                const currentRow = rows.nth(i)
                await verifyStatusUpdate(currentRow)
            }
        },
    )

    baseHumanTest(
        "should allow annotating scenarios",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
            ],
        },
        async ({
            navigateToHumanAnnotationRun,
            apiHelpers,
            page,
            switchToTableView,
            annotateFromFocusView,
            annotateFromTableView,
        }) => {
            const app = await apiHelpers.getApp()
            const appId = app.app_id

            await navigateToHumanAnnotationRun(appId)

            await page.locator(".ant-segmented-item").nth(2).click()

            await annotateFromFocusView()

            await switchToTableView()

            // await annotateFromTableView()
        },
    )

    baseHumanTest(
        "should navigate scenarios with filters",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
            ],
        },
        async ({apiHelpers, navigateToHumanAnnotationRun, navigateBetweenScenarios}) => {
            const app = await apiHelpers.getApp()
            const appId = app.app_id

            await navigateToHumanAnnotationRun(appId)

            await navigateBetweenScenarios()
        },
    )
}

export default humanAnnotationTests
