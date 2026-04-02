import {
    expect,
    goToHumanEvaluationStep,
    openHumanEvaluationModal,
    selectHumanEvaluationModalTableInput,
    test as baseHumanTest,
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
    baseHumanTest(
        "should show the human evaluation entry point on the human tab",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
            ],
        },
        async ({apiHelpers, navigateToHumanEvaluation}) => {
            const app = await apiHelpers.getApp("completion")

            await navigateToHumanEvaluation(app.id)
        },
    )

    baseHumanTest(
        "should use a deliberately mismatched testset when configuring a human evaluation",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
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

    baseHumanTest(
        "should create a human evaluation and land on the results page",
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

    baseHumanTest(
        "should create a new evaluator inline and annotate a scenario from the annotate tab",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
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
}

export default humanAnnotationTests
