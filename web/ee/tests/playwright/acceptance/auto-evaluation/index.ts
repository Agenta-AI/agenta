import {test as baseAutoEvalTest} from "./tests"

import {expect} from "@agenta/web-tests/utils"
import {
    createTagString,
    TestCoverage,
    TestPath,
    TestScope,
} from "@agenta/web-tests/playwright/config/testTags"

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
            // 1. Fetch apps, variants from API
            const app = await apiHelpers.getApp("completion")
            const appId = app.id

            const variants = await apiHelpers.getVariants(appId)
            const variantName = variants[0].name

            // 2. Navigate to evaluation
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

            console.log("Testset created:", testset.name)
            console.log("Variant name:", variantName)

            // 4. Run auto evaluation
            await runAutoEvaluation({
                evaluators: ["Exact Match"],
                testset: testset.name,
                variants: [variantName],
            })

            await expect(page.locator(".ant-modal").first()).toHaveCount(0)

            // 10. Check evaluation table
            const evalTable = page.getByRole("table")
            await evalTable.waitFor({state: "visible"})

            const newRow = evalTable.getByRole("row").first()
            await newRow.waitFor({state: "visible"})
            // const evaLoadingState = page.getByText("Running").first()
            // await expect(evaLoadingState).toBeVisible()
            // await expect(evaLoadingState).not.toBeVisible()
            await expect(page.getByText("Completed").first()).toBeVisible()
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
            const variantName = variants[0].name

            // 2. Navigate to evaluation
            await navigateToEvaluation(appId)
            const mismatchedTestset = await apiHelpers.createTestset({
                name: `e2e auto eval mismatched ${Date.now()}`,
                rows: [
                    {
                        input: "Say hello",
                        correct_answer: "Hello",
                    },
                ],
            })

            // 4. Run auto evaluation
            await runAutoEvaluation({
                evaluators: ["Exact Match"],
                testset: mismatchedTestset.name,
                variants: [variantName],
            })

            const message = page.locator(".ant-message").first()
            await expect(message).toBeVisible()
            await expect(message).toHaveText(
                "The testset columns do not match the selected variant input parameters",
            )
        },
    )
}

export default testAutoEval
