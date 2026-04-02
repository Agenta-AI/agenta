import {
    expect,
    goToAutoEvaluationStep,
    openAutoEvaluationRunFromList,
    openAutoEvaluationModal,
    selectAutoEvaluationModalTableInput,
    test as baseAutoEvalTest,
} from "./tests"
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

const testAutoEval = () => {
    baseAutoEvalTest(
        "should run a single evaluation",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
            ],
        },
        async ({page, apiHelpers, runAutoEvaluation, navigateToEvaluation}) => {
            const app = await apiHelpers.getApp("completion")
            const appId = app.id

            const variants = await apiHelpers.getVariants(appId)
            const variantName = getRequiredVariantName(variants[0]?.name)
            const evaluationName = `e2e-auto-results-${Date.now()}`

            await navigateToEvaluation(appId)
            const testset = await apiHelpers.createTestset({
                name: `e2e auto eval completion ${Date.now()}`,
                rows: [
                    {
                        input: "Say hello",
                        correct_answer: "Hello",
                    },
                    {
                        input: "Say goodbye",
                        correct_answer: "Goodbye",
                    },
                ],
            })

            const {name: createdEvaluationName, runId} = await runAutoEvaluation({
                name: evaluationName,
                evaluators: ["Exact Match"],
                testset: testset.name,
                variants: [variantName],
            })

            await expect(page.locator(".ant-modal").first()).toHaveCount(0)

            await openAutoEvaluationRunFromList({
                page,
                evaluationName: createdEvaluationName,
                runId,
            })

            await expect
                .poll(() => new URL(page.url()).pathname)
                .toContain(`${getProjectScopedBasePath(page)}/apps/${appId}/evaluations/results/`)
            await expect.poll(() => new URL(page.url()).searchParams.get("type")).toBe("auto")
        },
    )

    baseAutoEvalTest(
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
        async ({page, apiHelpers, runAutoEvaluation, navigateToEvaluation}) => {
            // 1. Fetch apps, variants from API
            const app = await apiHelpers.getApp("chat")
            const appId = app.id

            const variants = await apiHelpers.getVariants(appId)
            const variantName = getRequiredVariantName(variants[0]?.name)
            const mismatchedColumnName = `unexpected_input_${Date.now()}`

            // 2. Navigate to evaluation
            await navigateToEvaluation(appId)
            const mismatchedTestset = await apiHelpers.createTestset({
                name: `e2e auto eval mismatched ${Date.now()}`,
                rows: [
                    {
                        [mismatchedColumnName]: "Say hello",
                        correct_answer: "Hello",
                    },
                ],
            })

            const modal = await openAutoEvaluationModal(page)
            await modal
                .locator('input[placeholder="Enter a name"]')
                .first()
                .fill(`e2e-auto-mismatch-${Date.now()}`)

            await goToAutoEvaluationStep(modal, "Variant")
            await selectAutoEvaluationModalTableInput({
                modal,
                rowText: variantName,
                inputType: "checkbox",
            })

            await goToAutoEvaluationStep(modal, "Test set")

            const expectedInputsNote = modal
                .locator(".ant-tabs-tabpane-active")
                .last()
                .locator("div")
                .filter({hasText: /Expected input variables for selected variant\(s\):/})
                .first()
            await expect(expectedInputsNote).toBeVisible()
            await expect(expectedInputsNote).not.toContainText(mismatchedColumnName)

            await selectAutoEvaluationModalTableInput({
                modal,
                rowText: mismatchedTestset.name,
                inputType: "radio",
            })

            await expect(modal.getByRole("button", {name: "Start Evaluation"}).last()).toBeVisible()
            await expect(modal).toContainText(mismatchedTestset.name)
        },
    )
}

export default testAutoEval
