import {test as baseHumanTest, expect} from "./tests"
import {
    createTagString,
    TestCoverage,
    TestPath,
    TestScope,
} from "@agenta/web-tests/playwright/config/testTags"
import {getProjectScopedBasePath} from "tests/tests/fixtures/base.fixture/apiHelpers"

const getRequiredVariantName = (name: string | null | undefined) => {
    expect(name).toBeTruthy()
    return name as string
}

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
            const appId = app.id

            const variants = await apiHelpers.getVariants(appId)
            const variantName = getRequiredVariantName(variants[0]?.name)

            await navigateToHumanEvaluation(appId)

            const mismatchedTestset = await apiHelpers.createTestset({
                name: `e2e human eval mismatched ${Date.now()}`,
                rows: [{input: "Say hello"}],
            })

            await createHumanEvaluationRun({
                variants: variantName,
                testset: mismatchedTestset.name,
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
            const appId = app.id

            const variants = await apiHelpers.getVariants(appId)
            const variantName = getRequiredVariantName(variants[0]?.name)

            await navigateToHumanEvaluation(appId)

            const testset = await apiHelpers.createTestset({
                name: `e2e human eval completion ${Date.now()}`,
                rows: [{input: "Say hello"}, {input: "Say goodbye"}, {input: "Tell me a joke"}],
            })

            await createHumanEvaluationRun({
                variants: variantName,
                testset: testset.name,
                name: `e2e-human-${Date.now()}`,
                skipEvaluatorCreation: true,
            })

            await expect(page.locator(".ant-modal").first()).toHaveCount(0)

            await expect
                .poll(() => new URL(page.url()).pathname)
                .toContain(`${getProjectScopedBasePath(page)}/apps/${appId}/evaluations/results/`)
            await expect.poll(() => new URL(page.url()).searchParams.get("type")).toBe("human")
            await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("focus")
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
            const appId = app.id

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
        }) => {
            const app = await apiHelpers.getApp()
            const appId = app.id

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
            const appId = app.id

            await navigateToHumanAnnotationRun(appId)

            await navigateBetweenScenarios()
        },
    )
}

export default humanAnnotationTests
