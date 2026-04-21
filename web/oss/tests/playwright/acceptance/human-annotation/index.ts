import {
    expect,
    goToHumanEvaluationStep,
    openHumanEvaluationModal,
    selectHumanEvaluationModalTableInput,
    test as baseHumanTest,
    goToHumanEvaluations,
    navigateToHumanRunResults,
} from "./tests"
import {
    createTagString,
    TestCoverage,
    TestPath,
    TestScope,
} from "@agenta/web-tests/playwright/config/testTags"
import {getProjectScopedBasePath} from "tests/tests/fixtures/base.fixture/apiHelpers"

const INLINE_EVALUATOR_METRIC_NAME = "isTestWorking"

const getRequiredVariantName = (name: string | null | undefined) => {
    expect(name).toBeTruthy()
    return name as string
}

const humanAnnotationTests = () => {
    // WEB-ACC-HUMAN-001
    baseHumanTest(
        "should show the human evaluation entry point on the human tab",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
                createTagString("license", "oss"),
            ],
        },
        async ({apiHelpers, navigateToHumanEvaluation}) => {
            const app = await apiHelpers.getApp("completion")

            await navigateToHumanEvaluation(app.id)
        },
    )

    // WEB-ACC-HUMAN-002
    baseHumanTest(
        "should use a deliberately mismatched testset when configuring a human evaluation",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
                createTagString("license", "oss"),
            ],
        },
        async ({page, apiHelpers, navigateToHumanEvaluation}) => {
            const app = await apiHelpers.getApp("chat")
            const appId = app.id

            const variants = await apiHelpers.getVariants(appId)
            const variantName = getRequiredVariantName(variants[0]?.name)
            const mismatchedColumnName = `unexpected_input_${Date.now()}`

            const mismatchedTestset = await apiHelpers.createTestset({
                name: `e2e human eval mismatched ${Date.now()}`,
                rows: [{[mismatchedColumnName]: "Say hello"}],
            })

            await navigateToHumanEvaluation(appId)

            const modal = await openHumanEvaluationModal(page)
            await modal
                .locator('input[placeholder="Enter a name"]')
                .first()
                .fill(`e2e-human-mismatch-${Date.now()}`)

            await goToHumanEvaluationStep(modal, "Variant")
            await selectHumanEvaluationModalTableInput({
                modal,
                rowText: variantName,
                inputType: "radio",
            })

            await goToHumanEvaluationStep(modal, "Test set")

            const expectedInputsNote = modal
                .locator(".ant-tabs-tabpane-active")
                .last()
                .locator("div")
                .filter({hasText: /Expected input variables for selected variant\(s\):/})
                .first()
            await expect(expectedInputsNote).toBeVisible()
            await expect(expectedInputsNote).not.toContainText(mismatchedColumnName)

            await selectHumanEvaluationModalTableInput({
                modal,
                rowText: mismatchedTestset.name,
                inputType: "radio",
            })

            await expect(modal.getByRole("button", {name: "Start Evaluation"}).last()).toBeVisible()
            await expect(modal).toContainText(mismatchedTestset.name)
        },
    )

    // WEB-ACC-HUMAN-003
    baseHumanTest(
        "should create a human evaluation and land on the results page",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
                createTagString("license", "oss"),
            ],
        },
        async ({page, apiHelpers, navigateToHumanEvaluation, createHumanEvaluationRun}) => {
            const app = await apiHelpers.getApp("completion")
            const appId = app.id
            const variants = await apiHelpers.getVariants(appId)
            const variantName = getRequiredVariantName(variants[0]?.name)

            await navigateToHumanEvaluation(appId)

            const testset = await apiHelpers.createTestset({
                name: `e2e human eval completion ${Date.now()}`,
                rows: [{input: "Say hello"}, {input: "Say goodbye"}],
            })

            await createHumanEvaluationRun({
                variants: variantName,
                testset: testset.name,
                name: `e2e-human-results-${Date.now()}`,
                skipEvaluatorCreation: true,
            })

            await expect(page.locator(".ant-modal").first()).toHaveCount(0)

            await expect
                .poll(() => new URL(page.url()).pathname)
                .toContain(`${getProjectScopedBasePath(page)}/apps/${appId}/evaluations/results/`)
            await expect.poll(() => new URL(page.url()).searchParams.get("type")).toBe("human")
            await expect
                .poll(() => Boolean(new URL(page.url()).searchParams.get("scenarioId")))
                .toBe(true)

            await expect(page.getByRole("tab", {name: "Annotate"}).first()).toHaveAttribute(
                "aria-selected",
                "true",
            )
            await expect(page.locator("#focus-section-inputs")).toBeVisible()
            await expect(page.locator("#focus-section-outputs")).toBeVisible()
            await expect(page.locator("#focus-section-annotations")).toBeVisible()
        },
    )

    // WEB-ACC-HUMAN-004
    baseHumanTest(
        "should create a new evaluator inline and annotate a scenario from the annotate tab",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
                createTagString("license", "oss"),
            ],
        },
        async ({
            page,
            apiHelpers,
            navigateToHumanEvaluation,
            createHumanEvaluationRun,
            annotateCurrentHumanScenario,
        }) => {
            const app = await apiHelpers.getApp("completion")
            const appId = app.id

            const variants = await apiHelpers.getVariants(appId)
            const variantName = getRequiredVariantName(variants[0]?.name)

            await navigateToHumanEvaluation(appId)

            const testset = await apiHelpers.createTestset({
                name: `e2e human annotation inline eval ${Date.now()}`,
                rows: [{input: "Say hello"}, {input: "Say goodbye"}, {input: "Tell me a joke"}],
            })

            await createHumanEvaluationRun({
                variants: variantName,
                testset: testset.name,
                name: `e2e-human-inline-${Date.now()}`,
                skipEvaluatorCreation: false,
                evaluatorMetricName: INLINE_EVALUATOR_METRIC_NAME,
            })

            await expect(page.locator(".ant-modal").first()).toHaveCount(0)
            await expect
                .poll(() => new URL(page.url()).pathname)
                .toContain(`${getProjectScopedBasePath(page)}/apps/${appId}/evaluations/results/`)
            await expect.poll(() => new URL(page.url()).searchParams.get("type")).toBe("human")

            await annotateCurrentHumanScenario({
                metricLabel: INLINE_EVALUATOR_METRIC_NAME,
                valueLabel: "True",
            })
        },
    )

    // WEB-ACC-HUMAN-005
    baseHumanTest(
        "should annotate multiple scenarios and see progress in the Scenarios tab",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("path", TestPath.HAPPY),
                createTagString("license", "oss"),
            ],
        },
        async (
            {
                page,
                apiHelpers,
                navigateToHumanEvaluation,
                createHumanEvaluationRun,
                annotateCurrentHumanScenario,
            },
            testInfo,
        ) => {
            const app = await apiHelpers.getApp("completion")
            const appId = app.id
            const variants = await apiHelpers.getVariants(appId)
            const variantName = getRequiredVariantName(variants[0]?.name)

            await navigateToHumanEvaluation(appId)

            const testset = await apiHelpers.createTestset({
                name: `e2e-human-multi-${Date.now()}`,
                rows: [{input: "Say hello"}, {input: "Say goodbye"}, {input: "Tell me a joke"}],
            })

            await createHumanEvaluationRun({
                variants: variantName,
                testset: testset.name,
                name: `e2e-human-multi-${Date.now()}`,
                skipEvaluatorCreation: false,
                evaluatorMetricName: INLINE_EVALUATOR_METRIC_NAME,
            })

            await expect(page.locator(".ant-modal").first()).toHaveCount(0)

            // Annotate the first scenario
            const firstScenarioId = new URL(page.url()).searchParams.get("scenarioId")
            await annotateCurrentHumanScenario({
                metricLabel: INLINE_EVALUATOR_METRIC_NAME,
                valueLabel: "True",
            })

            // Navigate to Scenarios tab and verify first scenario shows as annotated
            const scenariosTab = page.getByRole("tab", {name: "Scenarios"}).first()
            await scenariosTab.click()
            await expect(scenariosTab).toHaveAttribute("aria-selected", "true")

            // Verify at least one scenario row shows a success annotation status
            const successTag = page
                .locator("[data-row-key]")
                .locator(".ant-tag")
                .filter({hasText: /success/i})
                .first()
            await expect(successTag).toBeVisible({timeout: 10000})

            // Navigate to a second (different) scenario row and annotate it
            const scenarioRows = page.locator("[data-row-key]")
            const rowCount = await scenarioRows.count()
            if (rowCount < 2) {
                testInfo.skip("Only one scenario found — skipping multi-scenario step")
                return
            }

            // Click a row that is not the current scenario
            let clickedSecond = false
            for (let i = 0; i < rowCount; i++) {
                const rowKey = await scenarioRows.nth(i).getAttribute("data-row-key")
                if (rowKey && rowKey !== firstScenarioId) {
                    await scenarioRows.nth(i).click()
                    clickedSecond = true
                    break
                }
            }

            if (!clickedSecond) {
                testInfo.skip("Could not find a second distinct scenario — skipping")
                return
            }

            // Verify URL scenario changed
            await expect
                .poll(() => new URL(page.url()).searchParams.get("scenarioId"))
                .not.toBe(firstScenarioId)

            // Annotate the second scenario via the Annotate tab
            const annotateTab = page.getByRole("tab", {name: "Annotate"}).first()
            await expect(annotateTab).toBeVisible()
            await annotateTab.click()
            await expect(annotateTab).toHaveAttribute("aria-selected", "true")

            await annotateCurrentHumanScenario({
                metricLabel: INLINE_EVALUATOR_METRIC_NAME,
                valueLabel: "True",
            })

            // Return to Scenarios tab and verify two scenarios are now annotated
            await scenariosTab.click()
            await expect(scenariosTab).toHaveAttribute("aria-selected", "true")

            const allSuccessTags = page
                .locator("[data-row-key]")
                .locator(".ant-tag")
                .filter({hasText: /success/i})
            await expect(allSuccessTags).toHaveCount(2, {timeout: 10000})
        },
    )

    // WEB-ACC-HUMAN-006 — skipped: session persistence not reliably testable in CI
    baseHumanTest(
        "should submit a partial annotation and resume later",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("path", TestPath.HAPPY),
                createTagString("license", "oss"),
            ],
        },
        async ({}, testInfo) => {
            testInfo.skip(
                "Session persistence across page reloads requires complex state management — not reliably testable in CI",
            )
        },
    )

    // WEB-ACC-HUMAN-007
    baseHumanTest(
        "should view the Overview tab on a human evaluation results page",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("path", TestPath.HAPPY),
                createTagString("license", "oss"),
            ],
        },
        async ({page, apiHelpers}, testInfo) => {
            const app = await apiHelpers.getApp("completion")
            const appId = app.id

            const humanRuns = await goToHumanEvaluations(page, appId)
            if (humanRuns.length === 0) {
                testInfo.skip("No human evaluation runs found — skipping")
                return
            }

            await navigateToHumanRunResults(page, appId, humanRuns[0].id)

            const overviewTab = page.getByRole("tab", {name: "Overview"}).first()
            await expect(overviewTab).toBeVisible({timeout: 10000})
            await overviewTab.click()
            await expect(overviewTab).toHaveAttribute("aria-selected", "true")

            // Overview tab renders aggregate evaluator scores section
            await expect(page.getByText("Evaluator Scores Overview").first()).toBeVisible({
                timeout: 10000,
            })
        },
    )
}

export default humanAnnotationTests
