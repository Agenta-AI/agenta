import {test as baseTest} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"
import {getProjectScopedBasePath} from "@agenta/web-tests/tests/fixtures/base.fixture/apiHelpers"
import type {Locator, Page} from "@playwright/test"

import type {EvaluatorFixtures} from "./assets/types"

const EVALUATORS_PAGE_TITLE = "Evaluators"
const EVALUATOR_TAB_AUTOMATIC = "Automatic Evaluators"
const EVALUATOR_TAB_HUMAN = "Human Evaluators"
const EVALUATOR_CREATE_BUTTON_LABEL = /Create new/i
const EVALUATOR_SEARCH_PLACEHOLDER = "Search"

const EVALUATOR_TAB_PARAM_AUTOMATIC = "automatic"
const EVALUATOR_TAB_PARAM_HUMAN = "human"

// Template dropdown
const EVALUATOR_TEMPLATE_DROPDOWN_TITLE = "Select evaluator type"
const EVALUATOR_EXACT_MATCH_TEMPLATE_NAME = "Exact Match"

// Drawer (create)
const EVALUATOR_DRAWER_CREATE_TITLE = "New Evaluator"
const EVALUATOR_CORRECT_ANSWER_PROP = /Expected Answer Column/i
const EVALUATOR_DRAWER_CREATE_BUTTON_LABEL = "Create"

// Drawer (view / playground)
const EVALUATOR_TEST_BUTTON_LABEL = "Test Evaluator"

// Commit modal
const EVALUATOR_COMMIT_MODAL_NAME_PLACEHOLDER = "Enter a name..."
const EVALUATOR_COMMIT_MODAL_SUBMIT_LABEL = "Create"

// Feedback
const EVALUATOR_CREATE_SUCCESS_MESSAGE = "Evaluator created successfully"

// Playground - app selection
const EVALUATOR_SELECT_APP_PLACEHOLDER = "Select app"
const EVALUATOR_NO_APPS_TEXT = "No items found"
// Type labels shown on non-completion apps inside the popover
const EVALUATOR_NON_COMPLETION_TYPE_LABELS = ["Chat", "Custom"]

// Playground - run
const EVALUATOR_RUN_BUTTON_LABEL = "Run"
const EVALUATOR_RESULT_CARD_SELECTOR = ".node-result-card"

// Human evaluator drawer (create)
const HUMAN_EVALUATOR_DRAWER_TITLE = "Create new evaluator"
const HUMAN_EVALUATOR_NAME_PLACEHOLDER = "Enter a name"
const HUMAN_EVALUATOR_FEEDBACK_NAME_PLACEHOLDER = "Enter a feedback name"
const HUMAN_EVALUATOR_FEEDBACK_TYPE_PLACEHOLDER = "Select type"
const HUMAN_EVALUATOR_FEEDBACK_TYPE_BOOL_LABEL = "Boolean (True/False)"
const HUMAN_EVALUATOR_CREATE_BUTTON_LABEL = "Create"
const HUMAN_EVALUATOR_CREATE_SUCCESS_MESSAGE = "Evaluator created successfully"

const getEvaluatorsPath = (page: Page) => `${getProjectScopedBasePath(page)}/evaluators`

const getEvaluatorsUrl = (page: Page, tab?: string) => {
    const base = getEvaluatorsPath(page)
    return tab ? `${base}?tab=${tab}` : base
}

const waitForEvaluatorsQuery = async (page: Page) => {
    const response = await page.waitForResponse(
        (response) =>
            response.url().includes("/preview/workflows/query") &&
            response.request().method() === "POST",
    )

    expect(response.ok()).toBe(true)
    return response
}

const goToEvaluators = async (page: Page, tab?: string) => {
    const queryPromise = waitForEvaluatorsQuery(page)

    await page.goto(getEvaluatorsUrl(page, tab), {waitUntil: "domcontentloaded"})
    await expect.poll(() => new URL(page.url()).pathname).toBe(getEvaluatorsPath(page))

    await queryPromise
}

const ensureEvaluatorTab = async (page: Page, tabLabel: string, tabParam: string) => {
    const tab = page.getByRole("tab", {name: tabLabel}).first()
    await expect(tab).toBeVisible()

    if ((await tab.getAttribute("aria-selected")) !== "true") {
        await tab.click()
    }

    await expect(tab).toHaveAttribute("aria-selected", "true")
    await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe(tabParam)
}

const waitForWorkflowCreation = async (page: Page) => {
    const response = await page.waitForResponse(
        (response) =>
            response.url().includes("/preview/workflows/") &&
            !response.url().includes("/query") &&
            !response.url().includes("/variants") &&
            !response.url().includes("/revisions") &&
            !response.url().includes("/interfaces") &&
            !response.url().includes("/archive") &&
            response.request().method() === "POST",
    )

    expect(response.ok()).toBe(true)
    return response
}

const openEvaluatorTemplateDropdown = async (page: Page) => {
    const createButton = page.getByRole("button", {name: EVALUATOR_CREATE_BUTTON_LABEL}).first()
    await expect(createButton).toBeVisible()
    await createButton.click()

    const popover = page
        .locator(".ant-popover")
        .filter({hasText: EVALUATOR_TEMPLATE_DROPDOWN_TITLE})
    await expect(popover.first()).toBeVisible({timeout: 5000})
    return popover.first()
}

const selectEvaluatorTemplate = async (page: Page, templateName: string) => {
    const popover = await openEvaluatorTemplateDropdown(page)

    const templateItem = popover.getByText(templateName, {exact: true}).first()
    await expect(templateItem).toBeVisible({timeout: 10000})
    await templateItem.click()

    // Wait for drawer to open
    const drawer = page.locator(".ant-drawer").filter({hasText: EVALUATOR_DRAWER_CREATE_TITLE})
    await expect(drawer.first()).toBeVisible({timeout: 10000})
    return drawer.first()
}

const getEvaluatorCommitModal = (page: Page) =>
    page.locator(".ant-modal").filter({
        has: page.locator(`input[placeholder="${EVALUATOR_COMMIT_MODAL_NAME_PLACEHOLDER}"]`),
    })

/**
 * Opens the evaluator view drawer by clicking the evaluator row in the table.
 * Uses the search input to narrow results (same approach as auto-evaluation modal),
 * then waits for the row via [data-row-key] and clicks it.
 * Returns the drawer locator scoped to the specific "Test Evaluator" button.
 */
const openEvaluatorViewDrawer = async (page: Page, evaluatorName: string) => {
    // Use the search input to filter the table to just this evaluator
    const searchInput = page.locator('input[placeholder="Search"]').first()
    if (await searchInput.isVisible().catch(() => false)) {
        await searchInput.fill(evaluatorName)
    }

    // Poll until at least one matching row appears (virtual table may defer rendering)
    await expect
        .poll(async () => page.locator("[data-row-key]").filter({hasText: evaluatorName}).count(), {
            timeout: 30000,
        })
        .toBeGreaterThan(0)

    // Get a stable locator using the actual data-row-key attribute value
    const targetRow = page.locator("[data-row-key]").filter({hasText: evaluatorName}).first()
    await expect(targetRow).toBeVisible({timeout: 15000})
    const targetRowKey = await targetRow.getAttribute("data-row-key")
    const stableRow = targetRowKey
        ? page.locator(`[data-row-key="${targetRowKey}"]`).first()
        : targetRow

    await stableRow.click()

    // The view drawer contains the "Test Evaluator" expand button
    const viewDrawer = page
        .locator(".ant-drawer")
        .filter({has: page.getByRole("button", {name: EVALUATOR_TEST_BUTTON_LABEL})})
    await expect(viewDrawer.first()).toBeVisible({timeout: 10000})
    return viewDrawer.first()
}

/**
 * Expands the evaluator drawer into playground mode by clicking "Test Evaluator".
 * Waits for the "Select app" button to appear to confirm expansion.
 */
const expandEvaluatorToPlayground = async (drawer: Locator) => {
    const testButton = drawer.getByRole("button", {name: EVALUATOR_TEST_BUTTON_LABEL}).first()
    await expect(testButton).toBeVisible()
    await testButton.click()

    const selectAppButton = drawer
        .getByRole("button", {name: new RegExp(EVALUATOR_SELECT_APP_PLACEHOLDER)})
        .first()
    await expect(selectAppButton).toBeVisible({timeout: 10000})
}

/**
 * Opens the "Select app" popover and selects a completion-type app and its first revision.
 *
 * Returns:
 *   - "no_apps"       — no apps exist in the environment (Note 1)
 *   - "no_completion" — apps exist but none are completion type (Note 2)
 *   - "selected"      — a completion app was found and selected
 */
const selectCompletionAppFromDrawer = async (
    page: Page,
    drawer: Locator,
): Promise<"no_apps" | "no_completion" | "selected"> => {
    const selectAppButton = drawer
        .getByRole("button", {name: new RegExp(EVALUATOR_SELECT_APP_PLACEHOLDER)})
        .first()
    await expect(selectAppButton).toBeVisible()
    await selectAppButton.click()

    // Wait for the popover to open
    const popover = page.locator(".ant-popover").last()
    await expect(popover).toBeVisible({timeout: 5000})

    // Check for empty state — no apps in this environment
    const noItemsText = popover.getByText(EVALUATOR_NO_APPS_TEXT)
    const isEmptyState = await noItemsText.isVisible().catch(() => false)
    if (isEmptyState) {
        return "no_apps"
    }

    // Wait for app items to load in the left panel
    const appItems = popover.locator('[role="option"]')
    await expect(appItems.first()).toBeVisible({timeout: 10000})

    // Find a completion-type app (items without Chat/Custom type badge text)
    const allItems = await appItems.all()
    let completionItem: Locator | null = null

    for (const item of allItems) {
        const itemText = await item.textContent()
        const isNonCompletion = EVALUATOR_NON_COMPLETION_TYPE_LABELS.some((label) =>
            itemText?.includes(label),
        )
        if (!isNonCompletion) {
            completionItem = item
            break
        }
    }

    if (!completionItem) {
        return "no_completion"
    }

    // Click the completion app to reveal the revision panel on the right
    await completionItem.click()

    // The right panel uses a border-l separator from the root panel
    const revisionPanel = popover.locator(".border-l.border-solid").first()
    await expect(revisionPanel).toBeVisible({timeout: 5000})

    // Select the first available revision
    const firstRevision = revisionPanel.locator('[role="option"]').first()
    await expect(firstRevision).toBeVisible({timeout: 10000})
    await firstRevision.click()

    return "selected"
}

/**
 * Fills a Lexical-based contenteditable field by its label name in the testcase editor.
 * Returns true if the field was found and filled, false if not visible.
 */
const fillTestcaseField = async (
    page: Page,
    container: Locator,
    fieldName: string,
    value: string,
): Promise<boolean> => {
    const fieldHeader = container
        .locator(".drill-in-field-header")
        .filter({hasText: fieldName})
        .first()

    const isVisible = await fieldHeader.isVisible().catch(() => false)
    if (!isVisible) return false

    // Navigate up to the field section (parent contains both header and editor)
    const fieldSection = fieldHeader.locator("xpath=..")
    const editor = fieldSection.locator('[contenteditable="true"]').first()

    const editorVisible = await editor.isVisible().catch(() => false)
    if (!editorVisible) return false

    await editor.click()
    // Select all existing content then type new value
    await page.keyboard.press("ControlOrMeta+A")
    await editor.pressSequentially(value, {delay: 20})

    return true
}

/**
 * Opens the "Create new" drawer for a human evaluator, fills in the name,
 * feedback name, and feedback type (boolean by default), then submits.
 * Waits for the creation API call and the success message, then verifies
 * the drawer closes.
 *
 * Returns the evaluator name that was used.
 */
const createHumanEvaluatorFromDrawer = async (
    page: Page,
    {
        evaluatorName,
        feedbackName,
    }: {
        evaluatorName: string
        feedbackName: string
    },
) => {
    // Click the "Create new" button (visible on Human Evaluators tab)
    const createButton = page.getByRole("button", {name: EVALUATOR_CREATE_BUTTON_LABEL}).first()
    await expect(createButton).toBeVisible()
    await createButton.click()

    // Wait for the human evaluator create drawer to open
    const drawer = page
        .locator(".ant-drawer")
        .filter({hasText: HUMAN_EVALUATOR_DRAWER_TITLE})
        .first()
    await expect(drawer).toBeVisible({timeout: 10000})

    // Fill in the evaluator name
    const nameInput = drawer
        .locator(`input[placeholder="${HUMAN_EVALUATOR_NAME_PLACEHOLDER}"]`)
        .first()
    await expect(nameInput).toBeVisible()
    await nameInput.fill(evaluatorName)
    await expect(nameInput).toHaveValue(evaluatorName)

    // Fill in the feedback name (the first metric row)
    const feedbackNameInput = drawer
        .locator(`input[placeholder="${HUMAN_EVALUATOR_FEEDBACK_NAME_PLACEHOLDER}"]`)
        .first()
    await expect(feedbackNameInput).toBeVisible()
    await feedbackNameInput.fill(feedbackName)
    await expect(feedbackNameInput).toHaveValue(feedbackName)

    // Select the feedback type: Boolean (True/False)
    // Filter by the placeholder text to target the feedback-type Select specifically.
    const typeSelect = drawer
        .locator(".ant-select")
        .filter({hasText: HUMAN_EVALUATOR_FEEDBACK_TYPE_PLACEHOLDER})
        .first()
    await expect(typeSelect).toBeVisible({timeout: 5000})
    await typeSelect.click()

    // Wait for the AntD dropdown to appear and pick "Boolean (True/False)"
    const dropdown = page.locator(".ant-select-dropdown").last()
    await expect(dropdown).toBeVisible({timeout: 5000})
    const boolOption = dropdown
        .locator(".ant-select-item-option")
        .filter({hasText: HUMAN_EVALUATOR_FEEDBACK_TYPE_BOOL_LABEL})
        .first()
    await expect(boolOption).toBeVisible({timeout: 5000})
    await boolOption.click()

    // Verify the select now shows the chosen type
    await expect(
        drawer
            .locator(".ant-select")
            .filter({hasText: /Boolean/i})
            .first(),
    ).toBeVisible({timeout: 5000})

    // Intercept the creation API call and click Create
    const creationPromise = waitForWorkflowCreation(page)
    const submitButton = drawer
        .getByRole("button", {name: HUMAN_EVALUATOR_CREATE_BUTTON_LABEL})
        .last()
    await expect(submitButton).toBeVisible()
    await expect(submitButton).toBeEnabled()
    await submitButton.click()

    await creationPromise

    // Verify the success message
    await expect(
        page.locator(".ant-message").getByText(HUMAN_EVALUATOR_CREATE_SUCCESS_MESSAGE).first(),
    ).toBeVisible({timeout: 10000})

    // Verify the drawer closes
    await expect(drawer).toHaveCount(0, {timeout: 10000})

    return evaluatorName
}

const testWithEvaluatorFixtures = baseTest.extend<EvaluatorFixtures>({
    navigateToEvaluators: async ({page}, use) => {
        await use(async () => {
            await goToEvaluators(page)

            await expect(page.getByTitle(EVALUATORS_PAGE_TITLE).first()).toBeVisible({
                timeout: 10000,
            })

            const automaticTab = page.getByRole("tab", {name: EVALUATOR_TAB_AUTOMATIC}).first()
            await expect(automaticTab).toBeVisible()
            await expect(automaticTab).toHaveAttribute("aria-selected", "true")

            const humanTab = page.getByRole("tab", {name: EVALUATOR_TAB_HUMAN}).first()
            await expect(humanTab).toBeVisible()
        })
    },
})

export {
    testWithEvaluatorFixtures as test,
    expect,
    goToEvaluators,
    ensureEvaluatorTab,
    openEvaluatorTemplateDropdown,
    selectEvaluatorTemplate,
    getEvaluatorCommitModal,
    waitForWorkflowCreation,
    openEvaluatorViewDrawer,
    expandEvaluatorToPlayground,
    selectCompletionAppFromDrawer,
    fillTestcaseField,
    EVALUATORS_PAGE_TITLE,
    EVALUATOR_TAB_AUTOMATIC,
    EVALUATOR_TAB_HUMAN,
    EVALUATOR_TAB_PARAM_AUTOMATIC,
    EVALUATOR_TAB_PARAM_HUMAN,
    EVALUATOR_CREATE_BUTTON_LABEL,
    EVALUATOR_SEARCH_PLACEHOLDER,
    EVALUATOR_TEMPLATE_DROPDOWN_TITLE,
    EVALUATOR_EXACT_MATCH_TEMPLATE_NAME,
    EVALUATOR_DRAWER_CREATE_TITLE,
    EVALUATOR_CORRECT_ANSWER_PROP,
    EVALUATOR_DRAWER_CREATE_BUTTON_LABEL,
    EVALUATOR_COMMIT_MODAL_NAME_PLACEHOLDER,
    EVALUATOR_COMMIT_MODAL_SUBMIT_LABEL,
    EVALUATOR_CREATE_SUCCESS_MESSAGE,
    EVALUATOR_TEST_BUTTON_LABEL,
    EVALUATOR_SELECT_APP_PLACEHOLDER,
    EVALUATOR_NO_APPS_TEXT,
    EVALUATOR_NON_COMPLETION_TYPE_LABELS,
    EVALUATOR_RUN_BUTTON_LABEL,
    EVALUATOR_RESULT_CARD_SELECTOR,
    createHumanEvaluatorFromDrawer,
    HUMAN_EVALUATOR_DRAWER_TITLE,
    HUMAN_EVALUATOR_NAME_PLACEHOLDER,
    HUMAN_EVALUATOR_FEEDBACK_NAME_PLACEHOLDER,
    HUMAN_EVALUATOR_FEEDBACK_TYPE_PLACEHOLDER,
    HUMAN_EVALUATOR_FEEDBACK_TYPE_BOOL_LABEL,
    HUMAN_EVALUATOR_CREATE_BUTTON_LABEL,
    HUMAN_EVALUATOR_CREATE_SUCCESS_MESSAGE,
}
