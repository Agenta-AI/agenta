import {test as baseTest} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect, Locator} from "@agenta/web-tests/utils"

import type {HumanEvaluationFixtures, HumanEvaluationConfig} from "./assets/types"
import {waitForApiResponse} from "tests/tests/fixtures/base.fixture/apiHelpers"
import {EvaluationRun} from "@/oss/lib/hooks/usePreviewEvaluations/types"
import {SnakeToCamelCaseKeys} from "@/oss/lib/Types"

const testWithHumanFixtures = baseTest.extend<HumanEvaluationFixtures>({
    navigateToHumanEvaluation: async ({page, uiHelpers, apiHelpers}, use) => {
        await use(async (appId: string) => {
            await page.goto(`/apps/${appId}/evaluations?selectedEvaluation=human_annotation`)
            await expect(page).toHaveURL(
                new RegExp(`/apps/${appId}/evaluations\\?selectedEvaluation=human_annotation`),
            )

            const evaluationRunsResponse = await waitForApiResponse<{
                runs: SnakeToCamelCaseKeys<EvaluationRun>[]
                count: number
            }>(page, {
                route: `/api/preview/evaluations/runs/query`,
                method: "POST",
            })

            const evaluationRuns = await evaluationRunsResponse

            expect(Array.isArray(evaluationRuns.runs)).toBe(true)

            await expect(page.locator("span").filter({hasText: /^Evaluations$/})).toBeVisible()

            await uiHelpers.clickTab("Human annotation")

            if (evaluationRunsResponse.runs.length > 0) {
                await page.locator(".ant-checkbox").first().click()

                // click delete button
                await uiHelpers.clickButton("Delete")

                // confirm delete in modal
                await uiHelpers.confirmModal("Delete")
            }

            await expect(evaluationRunsResponse.runs.length).toBe(0)

            await expect(
                page.locator(".ant-btn-primary", {hasText: "Start new evaluation"}).first(),
            ).toBeVisible()
        })
    },

    navigateToHumanAnnotationRun: async ({page, uiHelpers, apiHelpers}, use) => {
        await use(async (appId: string) => {
            await page.goto(`/apps/${appId}/evaluations?selectedEvaluation=human_annotation`)
            await expect(page).toHaveURL(
                new RegExp(`/apps/${appId}/evaluations\\?selectedEvaluation=human_annotation`),
            )

            const runs = await apiHelpers.getEvaluationRuns()

            await expect(page.locator("span").filter({hasText: /^Evaluations$/})).toBeVisible()

            await uiHelpers.clickTab("Human annotation")

            await page.locator(`tr[data-row-key="${runs[0].id}"]`).click()

            await expect(page).toHaveURL(
                new RegExp(`/apps/${appId}/evaluations/single_model_test/${runs[0].id}(\\?|$)`),
            )

            await expect(page.locator("h4").filter({hasText: runs[0].name})).toBeVisible()
        })
    },

    createHumanEvaluationRun: async ({page, uiHelpers}, use) => {
        await use(async (config: HumanEvaluationConfig) => {
            await uiHelpers.clickButton("Start new evaluation")
            const modal = page.locator(".ant-modal").first()
            await expect(modal).toBeVisible()

            const goToStep = async (step: string) => {
                await modal.getByRole("tab", {name: step}).click()
            }

            await uiHelpers.typeWithDelay('input[placeholder="Enter a name"]', config.name)

            await goToStep("Test set")
            await uiHelpers.selectTableRowInput({
                rowText: config.testset,
                inputType: "radio",
                checked: true,
            })

            await goToStep("Variant")
            const variantRow = page.getByRole("row").filter({
                has: page
                    .locator("td", {hasText: config.variants})
                    .locator(".ant-tag", {hasText: "v1"}),
            })

            await expect(variantRow).toBeVisible()
            await variantRow.getByRole("radio").check()

            await goToStep("Evaluator")

            const evaluatorName = "evaluator_test"

            if (!config.skipEvaluatorCreation) {
                await uiHelpers.clickButton("Create new")
                const evalDrawer = page.locator(".ant-drawer-content")
                await expect(evalDrawer).toBeVisible()
                await expect(evalDrawer).toContainText("Create new evaluator")

                await uiHelpers.typeWithDelay("#evaluatorName", evaluatorName)
                await expect(page.locator("#evaluatorSlug")).toHaveValue(evaluatorName)

                await uiHelpers.typeWithDelay("#metrics_0_name", "isTestWorking")

                await page.locator(".ant-select").click()

                const dropdownOption = page.locator('div[title="Boolean (True/False)"]')
                await expect(dropdownOption).toBeVisible()

                await dropdownOption.click()

                await uiHelpers.clickButton("Save")

                await expect(evalDrawer).toHaveCount(0)

                const successMessage = page
                    .locator(".ant-message")
                    .getByText("Evaluator created successfully")
                await expect(successMessage).toBeVisible()
            }

            await uiHelpers.selectTableRowInput({
                rowText: evaluatorName,
                inputType: "checkbox",
                checked: true,
            })

            await expect
                .poll(async () => {
                    return await page.locator(".ant-tabs-nav-list .ant-tag").count()
                })
                .toBe(3)

            const createButton = modal.getByRole("button", {name: "Create"}).last()
            await createButton.click()
            await expect(createButton).toHaveClass(/ant-btn-loading/)
        })
    },

    verifyStatusUpdate: async ({page, uiHelpers}, use) => {
        await use(async (row: Locator) => {
            await expect(row.locator(".ant-table-cell").nth(1)).toHaveText(/Running|Incomplete/)
            await expect(row.getByRole("button", {name: "Annotate"})).toBeVisible()
        })
    },

    switchToTableView: async ({page, uiHelpers}, use) => {
        await use(async () => {
            await page.locator(".ant-radio-button-wrapper", {hasText: "Table View"}).click()
            await expect(page).toHaveURL(/view=table/)
        })
    },

    runScenarioFromFocusView: async ({page, uiHelpers}, use) => {
        await use(async () => {
            await expect(page.locator("span").filter({hasText: "Pending"})).toBeVisible()
            await page.getByRole("button", {name: "Run Scenario"}).first().click()
            await expect(page.locator("span").filter({hasText: "Running"})).toBeVisible()
            await expect(page.locator("span").filter({hasText: "Incomplete"}).first()).toBeVisible()
        })
    },

    annotateFromFocusView: async ({page}, use) => {
        await use(async () => {
            const collapseBox = page.locator(".ant-collapse-content-box")
            await expect(collapseBox.getByText("isTestWorking")).toBeVisible()

            await collapseBox.locator(".ant-radio-button-wrapper").first().click()

            const annotateBtn = page.getByRole("button", {name: "Annotate"})
            await expect(annotateBtn).toBeEnabled()

            await annotateBtn.click()

            await expect(page.locator("span", {hasText: "Annotating"}).first()).toBeVisible()

            await expect(page.locator("span", {hasText: "Success"})).toHaveCount(2)
        })
    },

    annotateFromTableView: async ({page}, use) => {
        await use(async () => {
            const row = page.locator(".ant-table-row").first()

            await row.getByRole("button", {name: "Annotate"}).click()

            const drawer = page.locator(".ant-drawer-content")
            await expect(drawer).toBeVisible()
            await expect(drawer).toContainText("Annotate scenario")
            await expect(drawer.getByText("isTestWorking")).toBeVisible()

            await drawer.locator(".ant-radio-button-wrapper").first().click()

            const annotateBtn = drawer.getByRole("button", {name: "Annotate"})
            await expect(annotateBtn).toBeEnabled()
            await annotateBtn.click()

            await expect(drawer).toHaveCount(0)
        })
    },

    navigateBetweenScenarios: async ({page}, use) => {
        await use(async () => {
            const prevBtn = page.getByRole("button", {name: "Prev"})
            const nextBtn = page.getByRole("button", {name: "Next"})

            // Initial state
            await expect(prevBtn).toBeDisabled()
            await expect(nextBtn).toBeEnabled()

            // Navigate: 1 → 2
            await expect(page.locator('span[title="Testcase: 1"]').first()).toBeVisible()
            await nextBtn.click()
            await expect(page.locator('span[title="Testcase: 2"]').first()).toBeVisible()

            // Navigate: 2 → 3
            await nextBtn.click()
            await expect(page.locator('span[title="Testcase: 3"]').first()).toBeVisible()

            // Backward: 3 → 2
            await prevBtn.click()
            await expect(page.locator('span[title="Testcase: 2"]').first()).toBeVisible()

            // Backward: 2 → 1
            await prevBtn.click()
            await expect(page.locator('span[title="Testcase: 1"]').first()).toBeVisible()
        })
    },
})

export {testWithHumanFixtures as test, expect}
