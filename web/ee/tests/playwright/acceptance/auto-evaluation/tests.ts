import {test as baseTest} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"
import {EvaluationFixtures, RunAutoEvalFixtureType} from "./assets/types"
import {getProjectScopedBasePath} from "tests/tests/fixtures/base.fixture/apiHelpers"
import type {Locator, Page} from "@playwright/test"
import {deriveEvaluationKind} from "@/oss/lib/evaluations/utils/evaluationKind"
import {EvaluationRun} from "@/oss/lib/hooks/usePreviewEvaluations/types"

const AUTO_EVALUATION_TAB_LABEL = "Auto Evals"
const AUTO_EVALUATION_EMPTY_STATE_TITLE = "Get Started with Evaluations"
const AUTO_EVALUATION_EMPTY_STATE_BUTTON_LABEL = /Run Evaluation/i
const AUTO_EVALUATION_LIST_BUTTON_LABEL = /New evaluation/i
const AUTO_EVALUATION_MODAL_TITLE = "New Auto Evaluation"
const AUTO_EVALUATION_SUBMIT_BUTTON_LABEL = "Start Evaluation"
const AUTO_RESULTS_TAB_LABELS = ["Overview", "Scenarios", "Configuration"] as const
const AUTO_EVALUATION_CREATE_BUTTON_LABELS = [
    AUTO_EVALUATION_LIST_BUTTON_LABEL,
    /New Evaluation/i,
] as const

type EvaluationRunsResponse = {
    runs: EvaluationRun[]
    count: number
}

const getAutoEvaluationsPath = (page: Page, appId: string) =>
    `${getProjectScopedBasePath(page)}/apps/${appId}/evaluations`

const getAutoEvaluationsUrl = (page: Page, appId: string) =>
    `${getAutoEvaluationsPath(page, appId)}?kind=auto`

const getAutoResultsPathPrefix = (page: Page, appId: string) =>
    `${getAutoEvaluationsPath(page, appId)}/results/`

const getAutoAppIdFromEvaluationsPage = (page: Page) => {
    const match = new URL(page.url()).pathname.match(/\/apps\/([^/]+)\/evaluations\/?$/)
    expect(match).toBeTruthy()
    return match?.[1] as string
}

const typeIntoLocator = async (locator: Locator, text: string) => {
    await expect(locator).toBeVisible()
    await locator.click()
    await locator.fill("")
    await locator.pressSequentially(text, {delay: 20})
}

const waitForEvaluationRuns = async (page: Page, appId: string) => {
    const response = await page.waitForResponse((response) => {
        if (
            !response.url().includes("/api/preview/evaluations/runs/query") ||
            response.request().method() !== "POST"
        ) {
            return false
        }

        return new URL(response.url()).searchParams.get("app_id") === appId
    })

    expect(response.ok()).toBe(true)

    try {
        return (await response.json()) as EvaluationRunsResponse
    } catch (error) {
        console.warn("[Auto Evaluation E2E] Failed to parse evaluation runs response:", error)
        return {runs: [], count: 0}
    }
}

const getAutoEvaluationRuns = (evaluationRuns: EvaluationRunsResponse) => {
    const runs = Array.isArray(evaluationRuns.runs) ? evaluationRuns.runs : []
    return runs.filter((run) => deriveEvaluationKind(run) === "auto")
}

const getVisibleButtonByLabels = async (page: Page, labels: readonly (string | RegExp)[]) => {
    for (const label of labels) {
        const buttons = page.getByRole("button", {name: label})
        const buttonCount = await buttons.count()

        for (let index = 0; index < buttonCount; index += 1) {
            const button = buttons.nth(index)
            if (await button.isVisible().catch(() => false)) {
                return button
            }
        }
    }

    return null
}

const ensureAutoEvaluationsContext = async (page: Page) => {
    await expect.poll(() => new URL(page.url()).searchParams.get("kind")).toBe("auto")

    const autoTab = page.getByRole("tab", {name: AUTO_EVALUATION_TAB_LABEL}).first()
    await expect(autoTab).toBeVisible()

    if ((await autoTab.getAttribute("aria-selected")) !== "true") {
        await autoTab.click()
    }

    await expect(autoTab).toHaveAttribute("aria-selected", "true")
}

const goToAutoEvaluations = async (page: Page, appId: string) => {
    const evaluationRunsPromise = waitForEvaluationRuns(page, appId)

    await page.goto(getAutoEvaluationsUrl(page, appId), {waitUntil: "domcontentloaded"})

    await expect.poll(() => new URL(page.url()).pathname).toBe(getAutoEvaluationsPath(page, appId))
    await expect.poll(() => new URL(page.url()).searchParams.get("kind")).toBe("auto")
    await expect(page.getByTitle("Evaluations").first()).toBeVisible({timeout: 10000})

    const evaluationRuns = await evaluationRunsPromise
    expect(Array.isArray(evaluationRuns.runs)).toBe(true)

    return getAutoEvaluationRuns(evaluationRuns)
}

const getAutoEvaluationCreateButton = async (page: Page) => {
    const emptyStateTitle = page
        .getByRole("heading", {name: AUTO_EVALUATION_EMPTY_STATE_TITLE})
        .first()
    const emptyStateButton = page
        .getByRole("button", {name: AUTO_EVALUATION_EMPTY_STATE_BUTTON_LABEL})
        .first()

    await expect
        .poll(
            async () => {
                const isEmptyStateVisible =
                    (await emptyStateTitle.isVisible().catch(() => false)) ||
                    (await emptyStateButton.isVisible().catch(() => false))

                if (isEmptyStateVisible) {
                    return "empty"
                }

                return (await getVisibleButtonByLabels(page, AUTO_EVALUATION_CREATE_BUTTON_LABELS))
                    ? "list"
                    : null
            },
            {timeout: 10000},
        )
        .not.toBeNull()

    if (
        (await emptyStateTitle.isVisible().catch(() => false)) ||
        (await emptyStateButton.isVisible().catch(() => false))
    ) {
        await expect(emptyStateTitle).toBeVisible()
        await expect(emptyStateButton).toBeVisible()
        return emptyStateButton
    }

    const createButton = await getVisibleButtonByLabels(page, AUTO_EVALUATION_CREATE_BUTTON_LABELS)
    if (!createButton) {
        throw new Error("Could not find an auto evaluation create button.")
    }

    await expect(createButton).toBeVisible()
    return createButton
}

const openAutoEvaluationModal = async (page: Page) => {
    await ensureAutoEvaluationsContext(page)
    await (await getAutoEvaluationCreateButton(page)).click()

    const modal = page.locator(".ant-modal").first()
    await expect(modal).toBeVisible()
    await expect(modal.getByText(AUTO_EVALUATION_MODAL_TITLE).first()).toBeVisible()
    await expect(
        modal.getByRole("button", {name: AUTO_EVALUATION_SUBMIT_BUTTON_LABEL}).last(),
    ).toBeVisible()

    return modal
}

const goToAutoEvaluationStep = async (modal: Locator, step: string) => {
    const tab = modal.getByRole("tab", {name: step})
    await expect(tab).toBeVisible()
    await tab.click()
    await expect(tab).toHaveAttribute("aria-selected", "true")
    await expect(modal.locator(".ant-tabs-tabpane-active").last()).toBeVisible()
}

const selectAutoEvaluationModalTableInput = async ({
    modal,
    rowText,
    inputType: _inputType,
}: {
    modal: Locator
    rowText?: string
    inputType: "checkbox" | "radio"
}) => {
    const activePane = modal.locator(".ant-tabs-tabpane-active").last()
    const searchInput = activePane.locator('input[placeholder="Search"]').first()
    const inputSelector =
        'input[type="checkbox"], input[type="radio"], .ant-checkbox-input, .ant-radio-input'
    const controlSelector =
        '.ant-checkbox, .ant-checkbox-wrapper, .ant-radio, .ant-radio-wrapper, [role="checkbox"], [role="radio"]'
    const selectedTags = modal.locator(".ant-tabs-tab .ant-tag")

    if (rowText && (await searchInput.isVisible().catch(() => false))) {
        await typeIntoLocator(searchInput, rowText)
        await expect(searchInput).toHaveValue(rowText)
        await expect
            .poll(
                async () =>
                    await activePane.locator("[data-row-key]").filter({hasText: rowText}).count(),
                {timeout: 30000},
            )
            .toBeGreaterThan(0)
    }

    const targetRow = rowText
        ? activePane.locator("[data-row-key]").filter({hasText: rowText}).first()
        : activePane.locator("[data-row-key]").first()
    await expect(targetRow).toBeVisible({timeout: 30000})

    const targetRowKey = await targetRow.getAttribute("data-row-key")
    const stableRow = targetRowKey
        ? modal.locator(`[data-row-key="${targetRowKey}"]`).first()
        : targetRow
    await expect(stableRow).toBeVisible({timeout: 30000})

    const isSelected = async () => {
        const rowClassName = await stableRow.getAttribute("class").catch(() => null)
        if (rowClassName?.includes("ant-table-row-selected")) {
            return true
        }

        const ariaSelected = await stableRow.getAttribute("aria-selected").catch(() => null)
        if (ariaSelected === "true") {
            return true
        }

        const selectionInput = stableRow.locator(inputSelector).first()
        if ((await selectionInput.count().catch(() => 0)) > 0) {
            return await selectionInput.isChecked().catch(() => false)
        }

        if (typeof rowText === "string") {
            return (await selectedTags.filter({hasText: rowText}).count()) > 0
        }

        return false
    }

    if (!(await isSelected())) {
        const selectionControl = stableRow.locator(controlSelector).first()
        if ((await selectionControl.count().catch(() => 0)) > 0) {
            await selectionControl.click({force: true})
        } else {
            await stableRow.click({force: true})
        }
    }

    await expect.poll(isSelected, {timeout: 30000}).toBe(true)
}

const waitForAutoResultsPage = async (page: Page, appId: string) => {
    await expect
        .poll(() => new URL(page.url()).pathname)
        .toContain(getAutoResultsPathPrefix(page, appId))
    await expect.poll(() => new URL(page.url()).searchParams.get("type")).toBe("auto")

    for (const tabLabel of AUTO_RESULTS_TAB_LABELS) {
        await expect(page.getByRole("tab", {name: tabLabel}).first()).toBeVisible()
    }
}

const openAutoEvaluationRunFromList = async ({
    page,
    evaluationName,
    runId,
}: {
    page: Page
    evaluationName: string
    runId?: string | null
}) => {
    await ensureAutoEvaluationsContext(page)

    const evaluationsSearchInput = page.locator('input[placeholder="Search evaluations"]').first()
    if (await evaluationsSearchInput.isVisible().catch(() => false)) {
        await typeIntoLocator(evaluationsSearchInput, evaluationName)
        await expect(evaluationsSearchInput).toHaveValue(evaluationName)
    }

    const visibleRowCandidates = async () => {
        const candidateLocators: Locator[] = []

        if (runId) {
            candidateLocators.push(page.locator(`[data-row-key="preview::${runId}"]`))
        }

        candidateLocators.push(page.locator("tr[data-row-key]").filter({hasText: evaluationName}))

        for (const candidates of candidateLocators) {
            const count = await candidates.count()
            for (let index = 0; index < count; index += 1) {
                const row = candidates.nth(index)
                if (await row.isVisible().catch(() => false)) {
                    return row
                }
            }
        }

        return null
    }

    let createdEvaluationRow: Locator | null = null
    await expect
        .poll(
            async () => {
                createdEvaluationRow = await visibleRowCandidates()
                return Boolean(createdEvaluationRow)
            },
            {timeout: 60000},
        )
        .toBe(true)

    await expect(createdEvaluationRow!).toBeVisible()
    await createdEvaluationRow!.click()
}

/**
 * Evaluation-specific test fixtures extending the base test fixture.
 * Provides high-level actions for evaluation tests.
 */
const testWithEvaluationFixtures = baseTest.extend<EvaluationFixtures>({
    navigateToEvaluation: async ({page}, use) => {
        await use(async (appId: string) => {
            const autoEvaluationRuns = await goToAutoEvaluations(page, appId)

            if (autoEvaluationRuns.length > 0) {
                expect(autoEvaluationRuns.length).toBeGreaterThan(0)
                await expect(await getAutoEvaluationCreateButton(page)).toBeVisible()
                return
            }

            expect(autoEvaluationRuns).toHaveLength(0)
            await expect(await getAutoEvaluationCreateButton(page)).toBeVisible()
        })
    },

    runAutoEvaluation: async ({page}, use) => {
        await use(async ({evaluators, testset, variants, name}: RunAutoEvalFixtureType) => {
            const modal = await openAutoEvaluationModal(page)
            const appId = getAutoAppIdFromEvaluationsPage(page)
            const evaluationName = name ?? `e2e-auto-eval-${Date.now()}`

            await typeIntoLocator(
                modal.locator('input[placeholder="Enter a name"]').first(),
                evaluationName,
            )

            await goToAutoEvaluationStep(modal, "Variant")
            for (const variant of variants) {
                await selectAutoEvaluationModalTableInput({
                    rowText: variant,
                    inputType: "checkbox",
                    modal,
                })
            }

            await goToAutoEvaluationStep(modal, "Test set")
            await selectAutoEvaluationModalTableInput({
                rowText: testset,
                inputType: "radio",
                modal,
            })
            await expect(
                modal
                    .locator(".ant-tabs-tab", {hasText: "Test set"})
                    .locator(".ant-tag", {hasText: testset}),
            ).toBeVisible()

            await goToAutoEvaluationStep(modal, "Evaluators")
            for (const evaluator of evaluators) {
                await selectAutoEvaluationModalTableInput({
                    rowText: evaluator,
                    inputType: "checkbox",
                    modal,
                })
                await expect(
                    modal
                        .locator(".ant-tabs-tab", {hasText: "Evaluators"})
                        .locator(".ant-tag", {hasText: evaluator}),
                ).toBeVisible()
            }

            const createButton = modal
                .getByRole("button", {name: AUTO_EVALUATION_SUBMIT_BUTTON_LABEL})
                .last()

            const createResponsePromise = page.waitForResponse(
                (response) =>
                    response.url().includes("/api/preview/simple/evaluations/") &&
                    response.request().method() === "POST",
            )
            const runsRefreshPromise = page.waitForResponse(
                (response) =>
                    response.url().includes("/api/preview/evaluations/runs/query") &&
                    response.request().method() === "POST" &&
                    new URL(response.url()).searchParams.get("app_id") === appId,
            )

            await expect(createButton).toBeEnabled()
            await createButton.click()

            const createResponse = await createResponsePromise
            expect(createResponse.ok()).toBe(true)

            let runId: string | null = null
            try {
                const payload = (await createResponse.json()) as {
                    evaluation?: {id?: string}
                    data?: {evaluation?: {id?: string}}
                }
                runId = payload.evaluation?.id ?? payload.data?.evaluation?.id ?? null
            } catch {
                runId = null
            }

            await expect(modal).toHaveCount(0)
            await runsRefreshPromise

            return {name: evaluationName, runId}
        })
    },
})

export {
    testWithEvaluationFixtures as test,
    expect,
    openAutoEvaluationModal,
    goToAutoEvaluationStep,
    selectAutoEvaluationModalTableInput,
    openAutoEvaluationRunFromList,
}
