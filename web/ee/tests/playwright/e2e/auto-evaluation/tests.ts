import {test as baseTest} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"
import {EvaluationFixtures, RunAutoEvalFixtureType} from "./assets/types"

/**
 * Evaluation-specific test fixtures extending the base test fixture.
 * Provides high-level actions for evaluation tests.
 */
const testWithEvaluationFixtures = baseTest.extend<EvaluationFixtures>({
    navigateToEvaluation: async ({page, uiHelpers}, use) => {
        await use(async (appId: string) => {
            await page.goto(`/apps/${appId}/evaluations`)
            await uiHelpers.expectPath(`/apps/${appId}/evaluations`)

            // Move to Automatic Evaluation tab
            await uiHelpers.clickTab("Automatic Evaluation")
            await page.locator("span").filter({hasText: /^Evaluations$/})

            // Wait for Evaluations to load
            const spinner = page.locator(".ant-spin").first()
            if (await spinner.count()) {
                await spinner.waitFor({state: "hidden"})
            }
        })
    },

    runAutoEvaluation: async ({page, uiHelpers}, use) => {
        await use(async ({evaluators, testset, variants}: RunAutoEvalFixtureType) => {
            // 1. Open modal
            await uiHelpers.clickButton("Start new Evaluation")
            const modal = page.locator(".ant-modal").first()
            await expect(modal).toBeVisible()

            // Helper: Select tab by name
            const goToStep = async (step: string) => {
                const tab = modal.getByRole("tab", {name: step})
                await tab.click()
            }

            // 2. Select Testset
            const selectedTestset = testset

            await goToStep("Test set")
            await uiHelpers.selectTableRowInput({
                rowText: selectedTestset,
                inputType: "radio",
                checked: true,
            })
            await expect(
                page
                    .locator(".ant-tabs-tab", {hasText: "Test set"})
                    .locator(".ant-tag", {hasText: selectedTestset}),
            ).toBeVisible()

            // 3. Select Variant(s)
            await goToStep("Variant")
            const variantRow = page.getByRole("row").filter({
                has: page
                    .locator("td", {hasText: variants[0]})
                    .locator(".ant-tag", {hasText: "v1"}),
            })

            await expect(variantRow).toBeVisible()
            await variantRow.getByRole("radio").check()

            // 4. Select Evaluator(s)
            await goToStep("Evaluator")
            for (const evaluator of evaluators) {
                await uiHelpers.selectTableRowInput({
                    rowText: evaluator,
                    inputType: "checkbox",
                    checked: true,
                })
                await expect(
                    page
                        .locator(".ant-tabs-tab", {hasText: "Evaluator"})
                        .locator(".ant-tag", {hasText: evaluator}),
                ).toBeVisible()
            }

            await expect
                .poll(async () => {
                    return await page.locator(".ant-tabs-nav-list .ant-tag").count()
                })
                .toBe(3)

            // 5. Create Evaluation
            const createButton = page.getByRole("button", {name: "Create"}).last()
            await createButton.scrollIntoViewIfNeeded()
            await createButton.click()

            await expect(createButton).toHaveClass(/ant-btn-loading/)
        })
    },
})

export {testWithEvaluationFixtures as test}
