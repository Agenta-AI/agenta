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

    runAutoEvaluation: async ({page, uiHelpers, apiHelpers}, use) => {
        await use(async ({evaluators, testset, variants}: RunAutoEvalFixtureType) => {
            // 1. Click on start new evaluation
            await uiHelpers.clickButton("Start new Evaluation")
            const hasEvalModalOpen = page.locator(".ant-modal")
            await hasEvalModalOpen.first().isVisible()

            const ensureCollapseOpen = async (text: string) => {
                const collapseLocator = await page
                    .locator(".ant-collapse")
                    .filter({hasText: text})
                    .locator(".ant-collapse-header")
                    .first()

                const isCollapseCollapsed = await collapseLocator.getAttribute("aria-expanded")

                if (isCollapseCollapsed === "false") {
                    const collapseHeader = await page.getByRole("button", {name: text})
                    await collapseHeader.click()
                }
            }

            // 2. Select Testset
            // Fetch testsets from API
            const testsets = await apiHelpers.getTestsets()
            const testsetName = testsets[0].name

            await ensureCollapseOpen("Select Testset")
            await uiHelpers.selectTableRowInput({
                rowText: testset || testsetName,
                inputType: "radio",
                checked: true,
            })

            // 3. Select Variant
            await ensureCollapseOpen("Select Variant")
            for (let i = 0; i < variants.length; i++) {
                await uiHelpers.selectTableRowInput({
                    rowText: variants[i],
                    inputType: "checkbox",
                    checked: true,
                })
            }

            // 4. Select Evaluator
            await ensureCollapseOpen("Select Evaluator")
            for (let i = 0; i < evaluators.length; i++) {
                await uiHelpers.selectTableRowInput({
                    rowText: evaluators[i],
                    inputType: "checkbox",
                    checked: true,
                })
            }

            // 5. Click create
            const createButton = page.getByRole("button", {name: "Create"}).last()
            await createButton.scrollIntoViewIfNeeded()
            await createButton.click()

            await expect(page.locator(".ant-modal").first()).not.toBeVisible()
        })
    },
})

export {testWithEvaluationFixtures as test}
