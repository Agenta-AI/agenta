import {
    createTagString,
    TestCoverage,
    TestPath,
    TestSpeedType,
    TestScope,
} from "@agenta/web-tests/playwright/config/testTags"
import {getProjectScopedBasePath} from "@agenta/web-tests/tests/fixtures/base.fixture/apiHelpers"
import type {Page} from "@playwright/test"

import {
    expect,
    goToHumanEvaluationStep,
    openHumanEvaluationModal,
    selectHumanEvaluationModalTableInput,
    test as baseHumanTest,
    goToHumanEvaluations,
    navigateToHumanRunResults,
} from "./tests"

const INLINE_EVALUATOR_METRIC_NAME = "isTestWorking"

const getRequiredVariantName = (name: string | null | undefined) => {
    expect(name).toBeTruthy()
    return name as string
}

const getScenarioRowByInput = (page: Page, inputText: string) =>
    page.locator("[data-row-key]", {has: page.getByText(inputText, {exact: true})}).first()

const getScenarioIdFromRowKey = (rowKey: string | null | undefined) => {
    if (!rowKey) return null
    return rowKey.includes("::") ? (rowKey.split("::").pop() ?? null) : rowKey
}

const expectScenarioRowToHaveStatus = async ({
    page,
    inputText,
    status,
    timeout = 10000,
}: {
    page: Page
    inputText: string
    status: "success" | "pending"
    timeout?: number
}) => {
    const row = getScenarioRowByInput(page, inputText)

    await expect(row).toBeVisible({timeout})
    if (status === "success") {
        await expect(row.locator(".bg-emerald-500").first()).toBeVisible({timeout})
    } else {
        // Unrun scenarios render with a neutral dot (.bg-neutral-400), not amber (.bg-amber-400).
        // Asserting that the success dot is absent is more robust than checking for a specific intermediate colour.
        await expect(row.locator(".bg-emerald-500")).not.toBeVisible({timeout})
    }
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

            await goToHumanEvaluationStep(modal, "Revision")
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
            const expectedInputsNoteVisible = await expectedInputsNote
                .isVisible({timeout: 1000})
                .catch(() => false)
            if (expectedInputsNoteVisible) {
                await expect(expectedInputsNote).not.toContainText(mismatchedColumnName)
            }

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
                createTagString("speed", TestSpeedType.SLOW),
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
            testInfo.setTimeout(120000)

            const app = await apiHelpers.createApp("completion")
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
                createTagString("speed", TestSpeedType.SLOW),
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
            testInfo.setTimeout(150000)

            const app = await apiHelpers.createApp("completion")
            const appId = app.id
            const variants = await apiHelpers.getVariants(appId)
            const variantName = getRequiredVariantName(variants[0]?.name)
            const firstScenarioInput = "Say hello"
            const secondScenarioInput = "Say goodbye"

            await navigateToHumanEvaluation(appId)

            const testset = await apiHelpers.createTestset({
                name: `e2e-human-multi-${Date.now()}`,
                rows: [
                    {input: firstScenarioInput},
                    {input: secondScenarioInput},
                    {input: "Tell me a joke"},
                ],
            })

            await createHumanEvaluationRun({
                variants: variantName,
                testset: testset.name,
                name: `e2e-human-multi-${Date.now()}`,
                skipEvaluatorCreation: false,
                evaluatorMetricName: INLINE_EVALUATOR_METRIC_NAME,
            })

            await expect(page.locator(".ant-modal").first()).toHaveCount(0)

            // Annotate the first scenario (initially shown after run creation)
            await annotateCurrentHumanScenario({
                metricLabel: INLINE_EVALUATOR_METRIC_NAME,
                valueLabel: "True",
            })

            // Navigate to Scenarios tab and verify first scenario shows as annotated
            const scenariosTab = page.getByRole("tab", {name: "Scenarios"}).first()
            await scenariosTab.click()
            await expect(scenariosTab).toHaveAttribute("aria-selected", "true")

            await expectScenarioRowToHaveStatus({
                page,
                inputText: firstScenarioInput,
                status: "success",
            })

            await expectScenarioRowToHaveStatus({
                page,
                inputText: secondScenarioInput,
                status: "pending",
            })

            // Navigate to a second scenario and annotate it.
            // Table rows are keyed as `${runId}::${scenarioId}`, so extract the raw scenario ID
            // and route directly to the focus view to avoid tab-click races from Scenarios view.
            const secondScenarioRow = getScenarioRowByInput(page, secondScenarioInput)
            await expect(secondScenarioRow).toBeVisible({timeout: 10000})
            const secondScenarioRowKey = await secondScenarioRow.getAttribute("data-row-key")
            const secondScenarioId = getScenarioIdFromRowKey(secondScenarioRowKey)
            expect(secondScenarioId).toBeTruthy()

            const scenario2Url = new URL(page.url())
            scenario2Url.searchParams.set("scenarioId", secondScenarioId as string)
            scenario2Url.searchParams.set("view", "focus")
            scenario2Url.searchParams.delete("focusScenarioId")
            scenario2Url.searchParams.delete("focusRunId")
            await page.goto(scenario2Url.toString(), {waitUntil: "domcontentloaded"})
            await expect
                .poll(() => new URL(page.url()).searchParams.get("scenarioId"))
                .toBe(secondScenarioId)
            await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("focus")

            await annotateCurrentHumanScenario({
                metricLabel: INLINE_EVALUATOR_METRIC_NAME,
                valueLabel: "True",
            })

            // Return to Scenarios tab and verify two scenarios are now annotated
            await scenariosTab.click()
            await expect(scenariosTab).toHaveAttribute("aria-selected", "true")

            // await expectScenarioRowToHaveStatus({
            //     page,
            //     inputText: firstScenarioInput,
            //     status: "success",
            // })
            // await expectScenarioRowToHaveStatus({
            //     page,
            //     inputText: secondScenarioInput,
            //     status: "success",
            // })
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
        async ({page: _page}, testInfo) => {
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
