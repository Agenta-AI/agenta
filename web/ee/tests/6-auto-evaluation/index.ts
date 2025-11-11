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
            const app = await apiHelpers.getApp()
            const appId = app.app_id

            const variants = await apiHelpers.getVariants(appId)
            const variantName = variants[0].name || variants[0].variant_name

            // 2. Navigate to evaluation
            await navigateToEvaluation(appId)

            // 4. Run auto evaluation
            await runAutoEvaluation({
                evaluators: ["Exact Match"],
                variants: [variantName],
            })

            // 10. Check evaluation table
            const evalTable = await page.getByRole("table")
            await evalTable.waitFor({state: "visible"})

            const newRow = await evalTable.getByRole("row").first()
            await newRow.waitFor({state: "visible"})
            const evaLoadingState = page.getByText("Running").first()
            await expect(evaLoadingState).toBeVisible()
            await expect(evaLoadingState).not.toBeVisible()
            await expect(page.getByText("Completed").first()).toBeVisible()
        },
    )
}

export default testAutoEval