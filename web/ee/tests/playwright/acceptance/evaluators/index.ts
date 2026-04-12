import {
    test,
    expect,
    goToEvaluators,
    ensureEvaluatorTab,
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
    EVALUATOR_EXACT_MATCH_TEMPLATE_NAME,
    EVALUATOR_DRAWER_CREATE_TITLE,
    EVALUATOR_DRAWER_CREATE_BUTTON_LABEL,
    EVALUATOR_COMMIT_MODAL_NAME_PLACEHOLDER,
    EVALUATOR_COMMIT_MODAL_SUBMIT_LABEL,
    EVALUATOR_CREATE_SUCCESS_MESSAGE,
    EVALUATOR_RUN_BUTTON_LABEL,
    EVALUATOR_RESULT_CARD_SELECTOR,
} from "./tests"
import {
    createTagString,
    TestCoverage,
    TestPath,
    TestScope,
} from "@agenta/web-tests/playwright/config/testTags"

const testEvaluators = () => {
    test(
        "should navigate to the evaluators page and display both automatic and human evaluator tabs",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
            ],
        },
        async ({page, navigateToEvaluators}) => {
            // Navigate to the evaluators page and verify the initial state
            await navigateToEvaluators()

            // Verify page title is visible
            await expect(page.getByTitle(EVALUATORS_PAGE_TITLE).first()).toBeVisible()

            // Verify the Automatic Evaluators tab is visible and selected by default
            const automaticTab = page.getByRole("tab", {name: EVALUATOR_TAB_AUTOMATIC}).first()
            await expect(automaticTab).toBeVisible()
            await expect(automaticTab).toHaveAttribute("aria-selected", "true")
            // Note: on initial load the URL param may be absent (null) — the tab atom defaults
            // to "automatic" without writing to the URL. Once a tab is explicitly clicked the
            // param is set, which is what the later assertions verify.

            // Verify the Human Evaluators tab is visible but not selected
            const humanTab = page.getByRole("tab", {name: EVALUATOR_TAB_HUMAN}).first()
            await expect(humanTab).toBeVisible()
            await expect(humanTab).toHaveAttribute("aria-selected", "false")

            // Verify the Create new button is visible on the Automatic tab
            await expect(
                page.getByRole("button", {name: EVALUATOR_CREATE_BUTTON_LABEL}).first(),
            ).toBeVisible()

            // Switch to the Human Evaluators tab
            await ensureEvaluatorTab(page, EVALUATOR_TAB_HUMAN, EVALUATOR_TAB_PARAM_HUMAN)

            // Verify Human tab is now selected and URL updated
            await expect(humanTab).toHaveAttribute("aria-selected", "true")
            await expect(automaticTab).toHaveAttribute("aria-selected", "false")
            await expect
                .poll(() => new URL(page.url()).searchParams.get("tab"))
                .toBe(EVALUATOR_TAB_PARAM_HUMAN)

            // Verify the Create new button is still visible on the Human tab
            await expect(
                page.getByRole("button", {name: EVALUATOR_CREATE_BUTTON_LABEL}).first(),
            ).toBeVisible()

            // Switch back to Automatic tab and verify
            await ensureEvaluatorTab(page, EVALUATOR_TAB_AUTOMATIC, EVALUATOR_TAB_PARAM_AUTOMATIC)
            await expect(automaticTab).toHaveAttribute("aria-selected", "true")
        },
    )

    test(
        "should create an Exact Match evaluator from the template dropdown",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
            ],
        },
        async ({page, navigateToEvaluators}) => {
            const evaluatorName = `e2e-exact-match-${Date.now()}`

            // Navigate to the evaluators page (Automatic tab)
            await navigateToEvaluators()

            // Open the template dropdown and select Exact Match
            const drawer = await selectEvaluatorTemplate(page, EVALUATOR_EXACT_MATCH_TEMPLATE_NAME)

            // Verify the drawer title is "New Evaluator"
            await expect(drawer.getByText(EVALUATOR_DRAWER_CREATE_TITLE).first()).toBeVisible()
            // Note: the Exact Match evaluator's only config property ("Expected Answer Column" /
            // correct_answer_key) is marked x-ag-ui-advanced=True and is hidden by default.
            // We skip that assertion and rely on the drawer title + Create button being present.

            // Click the "Create" button inside the drawer to open the commit modal
            const drawerCreateButton = drawer
                .getByRole("button", {name: EVALUATOR_DRAWER_CREATE_BUTTON_LABEL})
                .first()
            await expect(drawerCreateButton).toBeVisible({timeout: 10000})
            await expect(drawerCreateButton).toBeEnabled()
            await drawerCreateButton.click()

            // Verify the commit modal opens with the name input
            const modal = getEvaluatorCommitModal(page)
            await expect(modal.first()).toBeVisible({timeout: 10000})

            const nameInput = modal
                .locator(`input[placeholder="${EVALUATOR_COMMIT_MODAL_NAME_PLACEHOLDER}"]`)
                .first()
            await expect(nameInput).toBeVisible()

            // Enter the evaluator name
            await nameInput.click()
            await nameInput.fill("")
            await nameInput.fill(evaluatorName)
            await expect(nameInput).toHaveValue(evaluatorName)

            // Intercept the creation API call and submit
            const creationPromise = waitForWorkflowCreation(page)

            const submitButton = modal
                .getByRole("button", {name: EVALUATOR_COMMIT_MODAL_SUBMIT_LABEL})
                .last()
            await expect(submitButton).toBeVisible()
            await expect(submitButton).toBeEnabled()
            await submitButton.click()

            // Wait for the creation API call to complete
            await creationPromise

            // Verify the success message
            await expect(
                page.locator(".ant-message").getByText(EVALUATOR_CREATE_SUCCESS_MESSAGE).first(),
            ).toBeVisible({timeout: 10000})

            // Verify the drawer and modal close after successful creation
            await expect(modal.first()).toHaveCount(0)
            await expect(drawer.first()).toHaveCount(0)

            // Verify the new evaluator appears in the table
            await expect(
                page.locator("tr[data-row-key]").filter({hasText: evaluatorName}).first(),
            ).toBeVisible({timeout: 15000})
        },
    )

    test(
        "should open the evaluator playground, select a completion app, and run the evaluator",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
            ],
        },
        async ({page, navigateToEvaluators}) => {
            const evaluatorName = `e2e-exact-match-${Date.now()}`

            // Step 1: Navigate and create a fresh Exact Match evaluator
            await navigateToEvaluators()

            const drawer = await selectEvaluatorTemplate(page, EVALUATOR_EXACT_MATCH_TEMPLATE_NAME)
            await expect(drawer.getByText(EVALUATOR_DRAWER_CREATE_TITLE).first()).toBeVisible()

            const drawerCreateButton = drawer
                .getByRole("button", {name: EVALUATOR_DRAWER_CREATE_BUTTON_LABEL})
                .first()
            await expect(drawerCreateButton).toBeEnabled({timeout: 10000})
            await drawerCreateButton.click()

            const modal = getEvaluatorCommitModal(page)
            await expect(modal.first()).toBeVisible({timeout: 10000})

            const nameInput = modal
                .locator(`input[placeholder="${EVALUATOR_COMMIT_MODAL_NAME_PLACEHOLDER}"]`)
                .first()
            await nameInput.fill(evaluatorName)
            await expect(nameInput).toHaveValue(evaluatorName)

            const creationPromise = waitForWorkflowCreation(page)
            await modal
                .getByRole("button", {name: EVALUATOR_COMMIT_MODAL_SUBMIT_LABEL})
                .last()
                .click()
            await creationPromise

            await expect(
                page.locator(".ant-message").getByText(EVALUATOR_CREATE_SUCCESS_MESSAGE).first(),
            ).toBeVisible({timeout: 10000})

            // Verify the evaluator appears in the table
            await expect(
                page.locator("tr[data-row-key]").filter({hasText: evaluatorName}).first(),
            ).toBeVisible({timeout: 15000})

            // Step 2: Open the evaluator view drawer by clicking the row
            const viewDrawer = await openEvaluatorViewDrawer(page, evaluatorName)

            // Step 3: Expand the drawer into playground mode
            await expandEvaluatorToPlayground(viewDrawer)

            // Step 4: Select a completion-type app
            // Note 1: Skip if no apps are available in this environment
            // Note 2: Skip if no completion-type app is available
            const appSelectionResult = await selectCompletionAppFromDrawer(page, viewDrawer)

            if (appSelectionResult === "no_apps") {
                test.skip(
                    true,
                    "No apps available in this environment to test the evaluator playground",
                )
                return
            }

            if (appSelectionResult === "no_completion") {
                test.skip(
                    true,
                    "No completion-type app available — evaluator requires a completion app",
                )
                return
            }

            // Step 5: Wait for the testcase fields to appear
            await expect(page.getByText("Testcase Data").first()).toBeVisible({timeout: 15000})

            // Step 6: Fill in the testcase fields
            // The testcase rows appear inside the expanded drawer's playground area.
            // We fill in well-known fields if present; the exact schema depends on
            // the connected app. For the standard "country capitals" completion app,
            // "country" is the app input and "correct_answer" is the evaluator ground truth.
            await fillTestcaseField(page, viewDrawer, "country", "Germany")
            await fillTestcaseField(page, viewDrawer, "correct_answer", "Berlin")

            // Step 7: Click the Run button
            const runButton = viewDrawer
                .getByRole("button", {name: EVALUATOR_RUN_BUTTON_LABEL})
                .first()
            await expect(runButton).toBeVisible({timeout: 10000})
            await expect(runButton).toBeEnabled()
            await runButton.click()

            // Step 8: Verify the evaluation ran — the evaluator result card should appear
            await expect(viewDrawer.locator(EVALUATOR_RESULT_CARD_SELECTOR).first()).toBeVisible({
                timeout: 30000,
            })
        },
    )
}

export default testEvaluators
