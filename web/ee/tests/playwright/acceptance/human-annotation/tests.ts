import {test as baseTest} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"
import type {Locator, Page} from "@playwright/test"

import type {HumanEvaluationConfig, HumanEvaluationFixtures} from "./assets/types"
import {getProjectScopedBasePath} from "tests/tests/fixtures/base.fixture/apiHelpers"
import {deriveEvaluationKind} from "@/oss/lib/evaluations/utils/evaluationKind"
import {EvaluationRun} from "@/oss/lib/hooks/usePreviewEvaluations/types"

type EvaluationRunsResponse = {
    runs: EvaluationRun[]
    count: number
}

const DEFAULT_HUMAN_EVALUATOR_METRIC_NAME = "isTestWorking"
const DEFAULT_HUMAN_ANNOTATION_VALUE_LABEL = "True"

const HUMAN_EVALUATION_EMPTY_STATE_TITLE = "Get Started with Human Evaluation"
const HUMAN_EVALUATION_EMPTY_STATE_BUTTON_LABEL = /Create Evaluation/i
const HUMAN_EVALUATION_LIST_BUTTON_LABEL = /New evaluation/i
const HUMAN_EVALUATION_TAB_LABEL = "Human Evals"
const HUMAN_EVALUATION_MODAL_TITLE = "New Human Evaluation"
const HUMAN_EVALUATION_SUBMIT_BUTTON_LABEL = "Start Evaluation"
const HUMAN_RESULTS_TAB_LABELS = ["Overview", "Scenarios", "Configuration", "Annotate"] as const
const EVALUATION_RESULTS_TOUR_ID = "evaluation-results-intro"
const WIDGET_CLOSED_TOUR_ID = "onboarding-widget-closed-tour"
const ONBOARDING_ACTIVE_USER_ID_KEY = "agenta:onboarding:active-user-id"
const ONBOARDING_IS_NEW_USER_KEY_SUFFIX = "is-new-user"
const ONBOARDING_WIDGET_STATUS_KEY_SUFFIX = "widget-status"
const ONBOARDING_WIDGET_UI_KEY_SUFFIX = "widget-ui"
const ONBOARDING_WIDGET_SEEN_CLOSE_TOOLTIP_KEY_SUFFIX = "widget-seen-close-tooltip"
const ONBOARDING_WIDGET_DISMISSED_STATUS = "dismissed"

const HUMAN_EVALUATION_CREATE_BUTTON_LABELS = [
    /Create Evaluation/i,
    /New evaluation/i,
    /Start new evaluation/i,
] as const

const getHumanEvaluationsPath = (page: Page, appId: string) =>
    `${getProjectScopedBasePath(page)}/apps/${appId}/evaluations`

const getHumanEvaluationsUrl = (page: Page, appId: string) =>
    `${getHumanEvaluationsPath(page, appId)}?kind=human`

const getHumanResultsPathPrefix = (page: Page, appId: string) =>
    `${getHumanEvaluationsPath(page, appId)}/results/`

const getHumanAppIdFromEvaluationsPage = (page: Page) => {
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
        console.warn("[Human Evaluation E2E] Failed to parse evaluation runs response:", error)
        return {runs: [], count: 0}
    }
}

const getHumanEvaluationRuns = (evaluationRuns: EvaluationRunsResponse) => {
    const runs = Array.isArray(evaluationRuns.runs) ? evaluationRuns.runs : []

    return runs.filter((run) => deriveEvaluationKind(run) === "human")
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

const getHumanEvaluationCreateButton = async (page: Page) => {
    await expect
        .poll(
            async () =>
                Boolean(
                    await getVisibleButtonByLabels(page, HUMAN_EVALUATION_CREATE_BUTTON_LABELS),
                ),
            {timeout: 10000},
        )
        .toBe(true)

    const createButton = await getVisibleButtonByLabels(page, HUMAN_EVALUATION_CREATE_BUTTON_LABELS)
    if (createButton) {
        return createButton
    }

    throw new Error("Could not find a human evaluation create button.")
}

const disableEvaluationResultsOnboardingState = async (page: Page) => {
    await page.evaluate(
        ({
            activeUserIdKey,
            evaluationResultsTourId,
            widgetClosedTourId,
            isNewUserKeySuffix,
            widgetStatusKeySuffix,
            widgetUiKeySuffix,
            widgetSeenCloseTooltipKeySuffix,
            dismissedWidgetStatus,
        }: {
            activeUserIdKey: string
            evaluationResultsTourId: string
            widgetClosedTourId: string
            isNewUserKeySuffix: string
            widgetStatusKeySuffix: string
            widgetUiKeySuffix: string
            widgetSeenCloseTooltipKeySuffix: string
            dismissedWidgetStatus: string
        }) => {
            const userId = window.localStorage.getItem(activeUserIdKey)
            if (!userId) {
                return
            }

            const seenToursKey = `agenta:onboarding:${userId}:seen-tours`
            const isNewUserKey = `agenta:onboarding:${userId}:${isNewUserKeySuffix}`
            const widgetStatusKey = `agenta:onboarding:${userId}:${widgetStatusKeySuffix}`
            const widgetUiKey = `agenta:onboarding:${userId}:${widgetUiKeySuffix}`
            const widgetSeenCloseTooltipKey = `agenta:onboarding:${userId}:${widgetSeenCloseTooltipKeySuffix}`

            const currentSeenTours = window.localStorage.getItem(seenToursKey)
            let parsedSeenTours: Record<string, number | boolean> = {}

            if (currentSeenTours) {
                try {
                    parsedSeenTours = JSON.parse(currentSeenTours) as Record<
                        string,
                        number | boolean
                    >
                } catch {
                    parsedSeenTours = {}
                }
            }

            window.localStorage.setItem(
                seenToursKey,
                JSON.stringify({
                    ...parsedSeenTours,
                    [evaluationResultsTourId]: Date.now(),
                    [widgetClosedTourId]: Date.now(),
                }),
            )
            window.localStorage.setItem(isNewUserKey, JSON.stringify(false))
            window.localStorage.setItem(widgetStatusKey, JSON.stringify(dismissedWidgetStatus))
            window.localStorage.setItem(
                widgetUiKey,
                JSON.stringify({
                    isOpen: false,
                    isMinimized: false,
                }),
            )
            window.localStorage.setItem(widgetSeenCloseTooltipKey, JSON.stringify(true))
        },
        {
            activeUserIdKey: ONBOARDING_ACTIVE_USER_ID_KEY,
            evaluationResultsTourId: EVALUATION_RESULTS_TOUR_ID,
            widgetClosedTourId: WIDGET_CLOSED_TOUR_ID,
            isNewUserKeySuffix: ONBOARDING_IS_NEW_USER_KEY_SUFFIX,
            widgetStatusKeySuffix: ONBOARDING_WIDGET_STATUS_KEY_SUFFIX,
            widgetUiKeySuffix: ONBOARDING_WIDGET_UI_KEY_SUFFIX,
            widgetSeenCloseTooltipKeySuffix: ONBOARDING_WIDGET_SEEN_CLOSE_TOOLTIP_KEY_SUFFIX,
            dismissedWidgetStatus: ONBOARDING_WIDGET_DISMISSED_STATUS,
        },
    )
}

const dismissEvaluationResultsOnboarding = async (page: Page) => {
    await disableEvaluationResultsOnboardingState(page)

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const skipButton = page.getByRole("button", {name: "Skip"}).last()
        if (await skipButton.isVisible().catch(() => false)) {
            await skipButton.click()
            await expect(skipButton).toBeHidden({timeout: 10000})
        }

        const widgetClosedTourButton = page.getByRole("button", {name: "Got it!"}).last()
        if (await widgetClosedTourButton.isVisible().catch(() => false)) {
            await widgetClosedTourButton.click()
            await expect(widgetClosedTourButton).toBeHidden({timeout: 10000})
        }

        const onboardingWidget = page
            .locator("section")
            .filter({hasText: "Get started guide"})
            .first()
        if (await onboardingWidget.isVisible().catch(() => false)) {
            const widgetCloseButton = onboardingWidget.locator("button.ant-btn").last()
            if (await widgetCloseButton.isVisible().catch(() => false)) {
                await widgetCloseButton.click({force: true})
                await page.waitForTimeout(400)
            }
        }

        const hasSkipButton = await skipButton.isVisible().catch(() => false)
        const hasWidgetClosedTourButton = await widgetClosedTourButton
            .isVisible()
            .catch(() => false)
        const hasOnboardingWidget = await onboardingWidget.isVisible().catch(() => false)
        if (!hasSkipButton && !hasWidgetClosedTourButton && !hasOnboardingWidget) {
            break
        }
    }
}

const goToHumanEvaluations = async (page: Page, appId: string) => {
    const evaluationRunsPromise = waitForEvaluationRuns(page, appId)

    await page.goto(getHumanEvaluationsUrl(page, appId), {waitUntil: "domcontentloaded"})

    await expect.poll(() => new URL(page.url()).pathname).toBe(getHumanEvaluationsPath(page, appId))
    await expect.poll(() => new URL(page.url()).searchParams.get("kind")).toBe("human")
    await expect(page.getByTitle("Evaluations").first()).toBeVisible({timeout: 10000})

    const evaluationRuns = await evaluationRunsPromise

    expect(Array.isArray(evaluationRuns.runs)).toBe(true)

    return getHumanEvaluationRuns(evaluationRuns)
}

const waitForHumanResultsPage = async (page: Page, appId: string) => {
    await expect
        .poll(() => new URL(page.url()).pathname)
        .toContain(getHumanResultsPathPrefix(page, appId))
    await expect.poll(() => new URL(page.url()).searchParams.get("type")).toBe("human")
    await expect.poll(() => Boolean(new URL(page.url()).searchParams.get("scenarioId"))).toBe(true)

    for (const tabLabel of HUMAN_RESULTS_TAB_LABELS) {
        await expect(page.getByRole("tab", {name: tabLabel}).first()).toBeVisible()
    }

    await dismissEvaluationResultsOnboarding(page)
}

const ensureHumanEvaluationsContext = async (page: Page) => {
    await expect.poll(() => new URL(page.url()).searchParams.get("kind")).toBe("human")

    const humanTab = page.getByRole("tab", {name: HUMAN_EVALUATION_TAB_LABEL}).first()
    await expect(humanTab).toBeVisible()

    if ((await humanTab.getAttribute("aria-selected")) !== "true") {
        await humanTab.click()
    }

    await expect(humanTab).toHaveAttribute("aria-selected", "true")
}

const openHumanAnnotateView = async (page: Page) => {
    await dismissEvaluationResultsOnboarding(page)

    const annotateTab = page.getByRole("tab", {name: "Annotate"}).first()
    await expect(annotateTab).toBeVisible()

    if ((await annotateTab.getAttribute("aria-selected")) !== "true") {
        await annotateTab.click()
    }

    await expect(annotateTab).toHaveAttribute("aria-selected", "true")
    await expect(page.locator("#focus-section-inputs")).toBeVisible()
    await expect(page.locator("#focus-section-outputs")).toBeVisible()
    await expect(page.locator("#focus-section-annotations")).toBeVisible()
}

const openHumanEvaluationModal = async (page: Page) => {
    await ensureHumanEvaluationsContext(page)
    await (await getHumanEvaluationCreateButton(page)).click()

    const modal = page.locator(".ant-modal").first()
    await expect(modal).toBeVisible()
    await expect(modal.getByText(HUMAN_EVALUATION_MODAL_TITLE).first()).toBeVisible()
    await expect(
        modal.getByRole("button", {name: HUMAN_EVALUATION_SUBMIT_BUTTON_LABEL}).last(),
    ).toBeVisible()

    return modal
}

const goToHumanEvaluationStep = async (modal: Locator, step: string) => {
    const stepTab = modal.getByRole("tab", {name: step})
    await expect(stepTab).toBeVisible()
    await stepTab.click()
    await expect(stepTab).toHaveAttribute("aria-selected", "true")
    await expect(modal.locator(".ant-tabs-tabpane-active").last()).toBeVisible()
}

const getActiveHumanEvaluationPane = (modal: Locator) =>
    modal.locator(".ant-tabs-tabpane-active").last()

const selectHumanEvaluationModalTableInput = async ({
    modal,
    rowText,
    inputType: _inputType,
}: {
    modal: Locator
    rowText?: string | RegExp
    inputType: "checkbox" | "radio"
}) => {
    const activePane = getActiveHumanEvaluationPane(modal)
    const searchInput = activePane.locator('input[placeholder="Search"]').first()
    const inputSelector =
        'input[type="checkbox"], input[type="radio"], .ant-checkbox-input, .ant-radio-input'
    const controlSelector =
        '.ant-checkbox, .ant-checkbox-wrapper, .ant-radio, .ant-radio-wrapper, [role="checkbox"], [role="radio"]'
    const selectedTags = modal.locator(".ant-tabs-tab .ant-tag")

    if (typeof rowText === "string" && (await searchInput.isVisible().catch(() => false))) {
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
    const stableSelectionInput = targetRowKey
        ? modal.locator(`[data-row-key="${targetRowKey}"]`).locator(inputSelector).first()
        : targetRow.locator(inputSelector).first()
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

        if ((await stableSelectionInput.count().catch(() => 0)) > 0) {
            return await stableSelectionInput.isChecked().catch(() => false)
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

    if (_inputType === "radio" && typeof rowText === "string") {
        await expect
            .poll(
                async () => {
                    if (await isSelected()) {
                        return true
                    }

                    return (await selectedTags.filter({hasText: rowText}).count()) > 0
                },
                {timeout: 30000},
            )
            .toBe(true)
        return
    }

    await expect.poll(isSelected, {timeout: 30000}).toBe(true)
}

const waitForHumanEvaluatorPane = async (modal: Locator) => {
    const activePane = getActiveHumanEvaluationPane(modal)
    const searchInput = activePane.locator('input[placeholder="Search"]').first()

    await expect(searchInput).toBeVisible({timeout: 30000})
    await expect
        .poll(
            async () => {
                const rowCount = await activePane.locator("[data-row-key]").count()
                if (rowCount > 0) return true

                const hasEmptyState = await activePane
                    .getByText("No evaluators yet")
                    .first()
                    .isVisible()
                    .catch(() => false)
                const hasNoSearchResults = await activePane
                    .getByText("No evaluators match your search")
                    .first()
                    .isVisible()
                    .catch(() => false)

                return hasEmptyState || hasNoSearchResults
            },
            {timeout: 30000},
        )
        .toBe(true)

    return activePane
}

const ensureSingleHumanEvaluatorSelection = async ({
    modal,
    evaluatorName,
}: {
    modal: Locator
    evaluatorName?: string
}) => {
    const activePane = await waitForHumanEvaluatorPane(modal)

    if (!evaluatorName) {
        const firstEvaluatorRow = activePane.locator("[data-row-key]").first()
        const hasSelectedEvaluator = async () => {
            const selectedRows = await activePane
                .locator("[data-row-key]")
                .evaluateAll((rows) =>
                    rows.some(
                        (row) =>
                            row.className.includes("ant-table-row-selected") ||
                            row.getAttribute("aria-selected") === "true",
                    ),
                )
                .catch(() => false)

            if (selectedRows) {
                return true
            }

            return (
                (await activePane
                    .locator('input[type="checkbox"]:checked, input[type="radio"]:checked')
                    .count()) > 0
            )
        }

        await expect(firstEvaluatorRow).toBeVisible({timeout: 30000})

        await expect
            .poll(
                async () => {
                    if (await hasSelectedEvaluator()) return true

                    // Try the row first, then fall back to the explicit checkbox
                    const checkboxes = activePane.getByRole("checkbox")
                    if ((await checkboxes.count()) > 1) {
                        await checkboxes
                            .nth(1)
                            .click({force: true})
                            .catch(() => null)
                    } else {
                        await firstEvaluatorRow.click({force: true}).catch(() => null)
                    }

                    return hasSelectedEvaluator()
                },
                {timeout: 30000},
            )
            .toBe(true)
        return
    }

    await selectHumanEvaluationModalTableInput({
        modal,
        rowText: evaluatorName,
        inputType: "checkbox",
    })
}

const testWithHumanFixtures = baseTest.extend<HumanEvaluationFixtures>({
    navigateToHumanEvaluation: async ({page}, use) => {
        await use(async (appId: string) => {
            const humanEvaluationRuns = await goToHumanEvaluations(page, appId)

            if (humanEvaluationRuns.length > 0) {
                expect(humanEvaluationRuns.length).toBeGreaterThan(0)
                await expect(
                    page.getByRole("button", {name: HUMAN_EVALUATION_LIST_BUTTON_LABEL}).first(),
                ).toBeVisible()
                return
            }

            expect(humanEvaluationRuns).toHaveLength(0)
            await expect(page.getByText(HUMAN_EVALUATION_EMPTY_STATE_TITLE).first()).toBeVisible()
            await expect(
                page.getByRole("button", {name: HUMAN_EVALUATION_EMPTY_STATE_BUTTON_LABEL}).first(),
            ).toBeVisible()
        })
    },

    createHumanEvaluationRun: async ({page}, use) => {
        await use(async (config: HumanEvaluationConfig) => {
            const modal = await openHumanEvaluationModal(page)
            const appId = getHumanAppIdFromEvaluationsPage(page)

            await typeIntoLocator(
                modal.locator('input[placeholder="Enter a name"]').first(),
                config.name,
            )

            await goToHumanEvaluationStep(modal, "Variant")
            await selectHumanEvaluationModalTableInput({
                modal,
                rowText: config.variants,
                inputType: "radio",
            })

            await goToHumanEvaluationStep(modal, "Test set")
            await selectHumanEvaluationModalTableInput({
                modal,
                rowText: config.testset,
                inputType: "radio",
            })

            await goToHumanEvaluationStep(modal, "Evaluators")

            let evaluatorName: string | null = null
            const evaluatorMetricName =
                config.evaluatorMetricName ?? DEFAULT_HUMAN_EVALUATOR_METRIC_NAME
            const evaluatorPane = await waitForHumanEvaluatorPane(modal)
            const hasExistingEvaluator = (await evaluatorPane.locator("[data-row-key]").count()) > 0

            if (!config.skipEvaluatorCreation || !hasExistingEvaluator) {
                evaluatorName = `evaluator-${Date.now()}`

                const createEvaluatorButton = modal
                    .getByRole("button", {
                        name: /Create (new|your first) evaluator/i,
                    })
                    .first()
                await expect(createEvaluatorButton).toBeVisible()
                await createEvaluatorButton.click()

                const evaluatorDrawer = page
                    .locator(".ant-drawer-content-wrapper")
                    .filter({
                        has: page.locator('input[placeholder="Enter a unique slug"]'),
                    })
                    .last()
                const evaluatorNameInput = evaluatorDrawer
                    .locator('input[placeholder="Enter a name"]')
                    .first()
                const evaluatorSlugInput = evaluatorDrawer
                    .locator('input[placeholder="Enter a unique slug"]')
                    .first()
                const feedbackNameInput = evaluatorDrawer
                    .locator('input[placeholder="Enter a feedback name"]')
                    .first()

                await expect(evaluatorDrawer).toBeVisible()
                await expect(evaluatorSlugInput).toBeVisible()

                await typeIntoLocator(evaluatorNameInput, evaluatorName)
                await expect(evaluatorSlugInput).toHaveValue(evaluatorName)
                await typeIntoLocator(feedbackNameInput, evaluatorMetricName)

                await evaluatorDrawer.locator(".ant-select").last().click()
                const dropdownOption = page.getByText("Boolean (True/False)", {exact: true}).last()
                await expect(dropdownOption).toBeVisible()
                await dropdownOption.click()

                const createEvaluatorSubmitButton = evaluatorDrawer
                    .getByRole("button", {name: "Create"})
                    .last()
                await expect(createEvaluatorSubmitButton).toBeEnabled()
                await createEvaluatorSubmitButton.click()

                await expect(evaluatorSlugInput).toHaveCount(0)
                await expect(
                    page.locator(".ant-message").getByText("Evaluator created successfully"),
                ).toBeVisible()
            }

            await ensureSingleHumanEvaluatorSelection({
                modal,
                evaluatorName: evaluatorName ?? undefined,
            })

            await disableEvaluationResultsOnboardingState(page)

            const createButton = modal
                .getByRole("button", {name: HUMAN_EVALUATION_SUBMIT_BUTTON_LABEL})
                .last()
            await expect(createButton).toBeEnabled()
            await createButton.click()

            await waitForHumanResultsPage(page, appId)
        })
    },

    annotateCurrentHumanScenario: async ({page}, use) => {
        await use(
            async ({
                metricLabel = DEFAULT_HUMAN_EVALUATOR_METRIC_NAME,
                valueLabel = DEFAULT_HUMAN_ANNOTATION_VALUE_LABEL,
            }: {
                metricLabel?: string | RegExp
                valueLabel?: string | RegExp
            } = {}) => {
                await openHumanAnnotateView(page)
                await dismissEvaluationResultsOnboarding(page)

                const annotationsCard = page.locator("#focus-section-annotations")
                const overlayMessage = annotationsCard
                    .getByText(/Generate output to annotate|Generating output/i)
                    .first()
                const runButton = annotationsCard.getByRole("button", {name: /^Run$/}).first()

                if (await runButton.isVisible().catch(() => false)) {
                    await runButton.click()
                }

                await expect
                    .poll(async () => await overlayMessage.isVisible().catch(() => false), {
                        timeout: 60000,
                    })
                    .toBe(false)

                await dismissEvaluationResultsOnboarding(page)

                const metricField = annotationsCard
                    .locator(".playground-property-control")
                    .filter({hasText: metricLabel})
                    .first()

                await expect(metricField).toBeVisible({
                    timeout: 60000,
                })

                await dismissEvaluationResultsOnboarding(page)

                const visibleBooleanOption = metricField
                    .locator(".ant-radio-button-wrapper")
                    .filter({hasText: valueLabel})
                    .first()
                await expect(visibleBooleanOption).toBeVisible()
                await visibleBooleanOption.scrollIntoViewIfNeeded()
                await visibleBooleanOption.click({force: true})
                await expect(visibleBooleanOption).toHaveClass(/ant-radio-button-wrapper-checked/)

                const annotateButton = annotationsCard
                    .getByRole("button", {name: "Annotate"})
                    .first()
                await expect(annotateButton).toBeEnabled()
                await annotateButton.click()

                await expect(
                    page.locator(".ant-message").getByText("Annotations saved successfully"),
                ).toBeVisible()

                await expect(
                    page
                        .locator(".ant-tag")
                        .filter({hasText: /^success$/i})
                        .first(),
                ).toBeVisible({
                    timeout: 60000,
                })
            },
        )
    },
})

export {
    testWithHumanFixtures as test,
    expect,
    openHumanEvaluationModal,
    goToHumanEvaluationStep,
    selectHumanEvaluationModalTableInput,
}
