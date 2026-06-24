import {
    createTagString,
    TestCoverage,
    TestPath,
    TestScope,
    TestSpeedType,
    TestLensType,
    TestCostType,
    TestLicenseType,
    TestRoleType,
    TestcaseType,
} from "@agenta/web-tests/playwright/config/testTags"

import {buildAcceptanceTags} from "../utils/tags"

import {
    test,
    expect,
    ensureEvaluatorTab,
    selectEvaluatorTemplate,
    getEvaluatorCommitModal,
    waitForWorkflowCreation,
    fillTestcaseField,
    createHumanEvaluatorFromDrawer,
    editEvaluatorAndSaveNewVersion,
    deleteEvaluator,
    EVALUATORS_PAGE_TITLE,
    EVALUATOR_TAB_AUTOMATIC,
    EVALUATOR_TAB_HUMAN,
    EVALUATOR_TAB_PARAM_AUTOMATIC,
    EVALUATOR_TAB_PARAM_HUMAN,
    EVALUATOR_CREATE_BUTTON_LABEL,
    EVALUATOR_EXACT_MATCH_TEMPLATE_NAME,
    EVALUATOR_LLM_AS_A_JUDGE_TEMPLATE_NAME,
    EVALUATOR_SELECT_APP_PLACEHOLDER,
    EVALUATOR_NO_APPS_TEXT,
    EVALUATOR_NON_COMPLETION_TYPE_LABELS,
    EVALUATOR_POPOVER_TEST_ID,
    EVALUATOR_POPOVER_ROOT_PANEL_TEST_ID,
    EVALUATOR_POPOVER_CHILD_PANEL_TEST_ID,
    EVALUATOR_DRAWER_CREATE_TITLE,
    EVALUATOR_DRAWER_CREATE_BUTTON_LABEL,
    EVALUATOR_COMMIT_MODAL_NAME_PLACEHOLDER,
    EVALUATOR_COMMIT_MODAL_SUBMIT_LABEL,
    EVALUATOR_CREATE_SUCCESS_MESSAGE,
    EVALUATOR_RUN_BUTTON_LABEL,
    EVALUATOR_RESULT_CARD_SELECTOR,
    HUMAN_EVALUATOR_CREATE_SUCCESS_MESSAGE,
} from "./tests"

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

            // Post-create navigation leads to the full-page playground
            // (EVALUATOR_FULL_PAGE_NAV_ENABLED=true). Assert the redirect first,
            // then navigate back to the evaluators table to verify the new row.
            await expect(page).toHaveURL(/\/apps\/[^/]+\/playground(\?|$|#)/, {timeout: 15000})
            await navigateToEvaluators()

            // Verify the new evaluator appears in the table.
            // Use the search input to narrow results, then poll via [data-row-key]
            // (same approach as the auto-evaluation modal row selection).
            const searchInput = page.locator('input[placeholder="Search"]').first()
            if (await searchInput.isVisible().catch(() => false)) {
                await searchInput.fill(evaluatorName)
            }
            await expect
                .poll(
                    async () =>
                        page.locator("[data-row-key]").filter({hasText: evaluatorName}).count(),
                    {timeout: 15000},
                )
                .toBeGreaterThan(0)
            await expect(
                page.locator("[data-row-key]").filter({hasText: evaluatorName}).first(),
            ).toBeVisible({timeout: 5000})
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

            // Step 2: Post-commit navigates to `/apps/<id>/playground` — the
            // full-page surface introduced by the EVALUATOR_FULL_PAGE_NAV
            // re-enable. Assert the redirect FIRST (no DOM-poll for the
            // registry table). Earlier this test waited on `[data-row-key]`
            // entries before the URL check, which raced against the redirect:
            // once the post-commit navigation won, the table wasn't in the
            // DOM and the poll timed out. The evaluator's presence in the
            // registry is exercised by the post-create-row-click test
            // alongside; here we only care that the create flow leads to
            // the playground page.
            await expect(page).toHaveURL(/\/apps\/[^/]+\/playground(\?|$|#)/, {timeout: 15000})
            const surface = page.locator("body")

            // Step 3: The evaluator-flavored page has a "Select app" picker in the header
            const selectAppButton = page
                .getByRole("button", {name: new RegExp(EVALUATOR_SELECT_APP_PLACEHOLDER)})
                .first()
            await expect(selectAppButton).toBeVisible({timeout: 15000})

            // Step 4: Open the picker and select a completion-type app.
            // Skip gracefully if no apps or no completion app exist in this environment.
            await selectAppButton.click()
            const popover = page.getByTestId(EVALUATOR_POPOVER_TEST_ID).last()
            await expect(popover).toBeVisible({timeout: 5000})

            const noItemsText = popover.getByText(EVALUATOR_NO_APPS_TEXT)
            if (await noItemsText.isVisible().catch(() => false)) {
                test.skip(
                    true,
                    "No apps available in this environment to test the evaluator playground",
                )
                return
            }

            const appItems = popover
                .getByTestId(EVALUATOR_POPOVER_ROOT_PANEL_TEST_ID)
                .locator('[role="option"]')
            await expect(appItems.first()).toBeVisible({timeout: 10000})

            // Pick the first non-Chat / non-Custom app — completion-type.
            const allItems = await appItems.all()
            let completionItem = null
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
                test.skip(
                    true,
                    "No completion-type app available — evaluator requires a completion app",
                )
                return
            }
            await completionItem.click()

            // Wait for and pick the first revision in the right-side panel.
            const revisionPanel = popover.getByTestId(EVALUATOR_POPOVER_CHILD_PANEL_TEST_ID)
            await expect(revisionPanel).toBeVisible({timeout: 5000})
            const revisionItems = revisionPanel.locator('[role="option"]')
            await expect(revisionItems.first()).toBeVisible({timeout: 5000})
            await revisionItems.first().click()

            // Step 5: Verify completion-app UI (Testcase Data section) appears.
            const isCompletionApp = await page
                .getByText("Testcase Data")
                .first()
                .isVisible({timeout: 10000})
                .catch(() => false)
            if (!isCompletionApp) {
                test.skip(
                    true,
                    "Selected app is not a completion type — evaluator playground requires a completion app",
                )
                return
            }

            // Step 6: Fill testcase fields. For the standard country-capitals completion
            // app, "country" is the app input and "correct_answer" is the evaluator
            // ground truth.
            await fillTestcaseField(page, surface, "country", "Germany")
            await fillTestcaseField(page, surface, "correct_answer", "Berlin")

            // Step 7: Click Run
            const runButton = page.getByRole("button", {name: EVALUATOR_RUN_BUTTON_LABEL}).first()
            await expect(runButton).toBeVisible({timeout: 10000})
            await expect(runButton).toBeEnabled()
            await runButton.click()

            // Step 8: Verify the evaluator result card appears
            await expect(page.locator(EVALUATOR_RESULT_CARD_SELECTOR).first()).toBeVisible({
                timeout: 30000,
            })
        },
    )

    test(
        "should create a human evaluator with a boolean feedback metric",
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
            const evaluatorName = `e2e-human-eval-${Date.now()}`
            // Feedback names must be letters/numbers/underscore/dash (no spaces)
            const feedbackName = "quality"

            // Step 1: Navigate to the evaluators page
            await navigateToEvaluators()

            // Step 2: Switch to the Human Evaluators tab
            await ensureEvaluatorTab(page, EVALUATOR_TAB_HUMAN, EVALUATOR_TAB_PARAM_HUMAN)

            // Step 3: Open the create drawer, fill in the form, and submit
            await createHumanEvaluatorFromDrawer(page, {evaluatorName, feedbackName})

            // Step 4: Verify the success message (already checked inside the helper,
            // but we confirm the final state here as well)
            await expect(
                page
                    .locator(".ant-message")
                    .getByText(HUMAN_EVALUATOR_CREATE_SUCCESS_MESSAGE)
                    .first(),
            ).toBeVisible({timeout: 10000})

            // Step 5: Verify the new evaluator appears in the Human tab table.
            // Use the search input to narrow results, then poll via [data-row-key].
            const searchInput = page.locator('input[placeholder="Search"]').first()
            if (await searchInput.isVisible().catch(() => false)) {
                await searchInput.fill(evaluatorName)
            }
            await expect
                .poll(
                    async () =>
                        page.locator("[data-row-key]").filter({hasText: evaluatorName}).count(),
                    {timeout: 15000},
                )
                .toBeGreaterThan(0)
            await expect(
                page.locator("[data-row-key]").filter({hasText: evaluatorName}).first(),
            ).toBeVisible({timeout: 5000})
        },
    )
    test(
        "should edit an existing evaluator and save a new version",
        {
            tag: buildAcceptanceTags({
                scope: [TestScope.EVALUATIONS],
                coverage: [TestCoverage.LIGHT, TestCoverage.FULL],
                path: TestPath.HAPPY,
                lens: TestLensType.FUNCTIONAL,
                cost: TestCostType.Free,
                license: TestLicenseType.OSS,
                role: TestRoleType.Owner,
                caseType: TestcaseType.TYPICAL,
                speed: TestSpeedType.FAST,
            }),
        },
        async ({page, navigateToEvaluators}) => {
            const evaluatorName = `e2e-exact-match-edit-${Date.now()}`

            await navigateToEvaluators()

            // Create a fresh evaluator to edit
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

            const creationPromise = waitForWorkflowCreation(page)
            await modal
                .getByRole("button", {name: EVALUATOR_COMMIT_MODAL_SUBMIT_LABEL})
                .last()
                .click()
            await creationPromise

            await expect(
                page.locator(".ant-message").getByText(EVALUATOR_CREATE_SUCCESS_MESSAGE).first(),
            ).toBeVisible({timeout: 10000})

            // Post-create navigation leads to the full-page playground; navigate back
            // to the evaluators table before attempting to edit via the row menu.
            await expect(page).toHaveURL(/\/apps\/[^/]+\/playground(\?|$|#)/, {timeout: 15000})
            await navigateToEvaluators()

            // Open the row menu → Edit evaluator → Commit modal → confirm
            await editEvaluatorAndSaveNewVersion(page, evaluatorName)
        },
    )

    test(
        "should delete an evaluator",
        {
            tag: buildAcceptanceTags({
                scope: [TestScope.EVALUATIONS],
                coverage: [TestCoverage.SMOKE, TestCoverage.LIGHT],
                path: TestPath.HAPPY,
                lens: TestLensType.FUNCTIONAL,
                cost: TestCostType.Free,
                license: TestLicenseType.OSS,
                role: TestRoleType.Owner,
                caseType: TestcaseType.TYPICAL,
                speed: TestSpeedType.FAST,
            }),
        },
        async ({page, navigateToEvaluators}) => {
            const evaluatorName = `e2e-exact-match-del-${Date.now()}`

            await navigateToEvaluators()

            // Create a fresh evaluator to delete
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

            const creationPromise = waitForWorkflowCreation(page)
            await modal
                .getByRole("button", {name: EVALUATOR_COMMIT_MODAL_SUBMIT_LABEL})
                .last()
                .click()
            await creationPromise

            await expect(
                page.locator(".ant-message").getByText(EVALUATOR_CREATE_SUCCESS_MESSAGE).first(),
            ).toBeVisible({timeout: 10000})

            // Post-create navigation leads to the full-page playground; navigate back
            // to the evaluators table before attempting to delete via the row menu.
            await expect(page).toHaveURL(/\/apps\/[^/]+\/playground(\?|$|#)/, {timeout: 15000})
            await navigateToEvaluators()

            // Open the row menu → Delete → confirm
            await deleteEvaluator(page, evaluatorName)
        },
    )

    // ────────────────────────────────────────────────────────────────────────
    // Full-page evaluator playground (PR #4288 / re-enable after #4384)
    //
    // Every non-archived automatic evaluator opens in the full-page surface
    // at `/apps/<evalId>/playground` (powered by `ConfigureEvaluatorPage`)
    // on row click + post-create + direct URL visit, regardless of template
    // type. Earlier the gate restricted this to LLM/code evaluators only and
    // declarative classifiers fell back to the drawer — that meant several
    // evaluator types had no UI path into the per-evaluator pages (variants,
    // traces, sidebar). The gate is gone now; the drawer remains available
    // as a quick-edit affordance via the row context menu's Configure
    // action.
    // ────────────────────────────────────────────────────────────────────────

    test(
        "should navigate to the full-page playground for a declarative classifier (Exact Match) on post-create",
        {
            tag: buildAcceptanceTags({
                scope: [TestScope.EVALUATIONS],
                coverage: [TestCoverage.LIGHT, TestCoverage.FULL],
                path: TestPath.HAPPY,
                lens: TestLensType.FUNCTIONAL,
                cost: TestCostType.Free,
                license: TestLicenseType.OSS,
                role: TestRoleType.Owner,
                caseType: TestcaseType.TYPICAL,
                speed: TestSpeedType.FAST,
            }),
        },
        async ({page, navigateToEvaluators}) => {
            const evaluatorName = `e2e-exact-match-fullpage-${Date.now()}`

            await navigateToEvaluators()

            // Create a fresh Exact Match evaluator
            const drawer = await selectEvaluatorTemplate(page, EVALUATOR_EXACT_MATCH_TEMPLATE_NAME)
            const drawerCreateButton = drawer
                .getByRole("button", {name: EVALUATOR_DRAWER_CREATE_BUTTON_LABEL})
                .first()
            await expect(drawerCreateButton).toBeEnabled({timeout: 10000})
            await drawerCreateButton.click()

            const modal = getEvaluatorCommitModal(page)
            await expect(modal.first()).toBeVisible({timeout: 10000})
            await modal
                .locator(`input[placeholder="${EVALUATOR_COMMIT_MODAL_NAME_PLACEHOLDER}"]`)
                .first()
                .fill(evaluatorName)

            const creationPromise = waitForWorkflowCreation(page)
            await modal
                .getByRole("button", {name: EVALUATOR_COMMIT_MODAL_SUBMIT_LABEL})
                .last()
                .click()
            await creationPromise

            await expect(
                page.locator(".ant-message").getByText(EVALUATOR_CREATE_SUCCESS_MESSAGE).first(),
            ).toBeVisible({timeout: 10000})

            // Post-create lands on the full-page playground (all evaluator
            // kinds, not just LLM/code).
            await expect(page).toHaveURL(/\/apps\/[^/]+\/playground(\?|$|#)/, {timeout: 15000})
        },
    )

    test(
        "should navigate to the full-page playground when clicking an LLM-as-a-judge row",
        {
            tag: buildAcceptanceTags({
                scope: [TestScope.EVALUATIONS],
                coverage: [TestCoverage.LIGHT, TestCoverage.FULL],
                path: TestPath.HAPPY,
                lens: TestLensType.FUNCTIONAL,
                cost: TestCostType.Free,
                license: TestLicenseType.OSS,
                role: TestRoleType.Owner,
                caseType: TestcaseType.TYPICAL,
                speed: TestSpeedType.SLOW,
            }),
        },
        async ({page, navigateToEvaluators}) => {
            const evaluatorName = `e2e-llm-judge-row-${Date.now()}`

            await navigateToEvaluators()

            // Create an LLM-as-a-judge evaluator (flags.is_llm — full-page eligible)
            const drawer = await selectEvaluatorTemplate(
                page,
                EVALUATOR_LLM_AS_A_JUDGE_TEMPLATE_NAME,
            )
            const drawerCreateButton = drawer
                .getByRole("button", {name: EVALUATOR_DRAWER_CREATE_BUTTON_LABEL})
                .first()
            await expect(drawerCreateButton).toBeEnabled({timeout: 10000})
            await drawerCreateButton.click()

            const modal = getEvaluatorCommitModal(page)
            await expect(modal.first()).toBeVisible({timeout: 10000})
            await modal
                .locator(`input[placeholder="${EVALUATOR_COMMIT_MODAL_NAME_PLACEHOLDER}"]`)
                .first()
                .fill(evaluatorName)

            const creationPromise = waitForWorkflowCreation(page)
            await modal
                .getByRole("button", {name: EVALUATOR_COMMIT_MODAL_SUBMIT_LABEL})
                .last()
                .click()
            await creationPromise

            await expect(
                page.locator(".ant-message").getByText(EVALUATOR_CREATE_SUCCESS_MESSAGE).first(),
            ).toBeVisible({timeout: 10000})

            // Post-create navigation lands directly on the full-page playground
            // (`WorkflowRevisionDrawerWrapper:489-502` evaluator-create branch).
            await expect(page).toHaveURL(/\/apps\/[^/]+\/playground(\?|$|#)/, {timeout: 15000})

            // The full-page evaluator surface renders ConfigureEvaluatorPage's
            // header, whose marker is the upstream-app picker. This is the
            // regression blocker #4384 disabled the flow over — when the swap
            // is wrong the user lands on the generic <Playground /> with no
            // way to pick the app the evaluator scores.
            const selectAppButton = page
                .getByRole("button", {name: new RegExp(EVALUATOR_SELECT_APP_PLACEHOLDER)})
                .first()
            await expect(selectAppButton).toBeVisible({timeout: 15000})

            // Navigate back to /evaluators and click the row — same destination
            // (validates the registry's row-click handler, not just post-create).
            await navigateToEvaluators()
            const searchInput = page.locator('input[placeholder="Search"]').first()
            if (await searchInput.isVisible().catch(() => false)) {
                await searchInput.fill(evaluatorName)
            }
            await expect
                .poll(
                    async () =>
                        page.locator("[data-row-key]").filter({hasText: evaluatorName}).count(),
                    {timeout: 15000},
                )
                .toBeGreaterThan(0)
            const row = page.locator("[data-row-key]").filter({hasText: evaluatorName}).first()
            await row.click()
            await expect(page).toHaveURL(/\/apps\/[^/]+\/playground(\?|$|#)/, {timeout: 15000})
            await expect(
                page
                    .getByRole("button", {name: new RegExp(EVALUATOR_SELECT_APP_PLACEHOLDER)})
                    .first(),
            ).toBeVisible({timeout: 15000})
        },
    )

    test(
        "should navigate to the full-page playground when clicking a declarative classifier row (Exact Match)",
        {
            tag: buildAcceptanceTags({
                scope: [TestScope.EVALUATIONS],
                coverage: [TestCoverage.LIGHT, TestCoverage.FULL],
                path: TestPath.HAPPY,
                lens: TestLensType.FUNCTIONAL,
                cost: TestCostType.Free,
                license: TestLicenseType.OSS,
                role: TestRoleType.Owner,
                caseType: TestcaseType.TYPICAL,
                speed: TestSpeedType.FAST,
            }),
        },
        async ({page, navigateToEvaluators}) => {
            // Verifies T17 (gate removal): declarative classifiers — not just
            // LLM/code evaluators — open the full-page playground on row click.
            const evaluatorName = `e2e-exact-match-rowclick-${Date.now()}`

            await navigateToEvaluators()

            // Create Exact Match
            const drawer = await selectEvaluatorTemplate(page, EVALUATOR_EXACT_MATCH_TEMPLATE_NAME)
            const drawerCreateButton = drawer
                .getByRole("button", {name: EVALUATOR_DRAWER_CREATE_BUTTON_LABEL})
                .first()
            await expect(drawerCreateButton).toBeEnabled({timeout: 10000})
            await drawerCreateButton.click()

            const modal = getEvaluatorCommitModal(page)
            await expect(modal.first()).toBeVisible({timeout: 10000})
            await modal
                .locator(`input[placeholder="${EVALUATOR_COMMIT_MODAL_NAME_PLACEHOLDER}"]`)
                .first()
                .fill(evaluatorName)

            const creationPromise = waitForWorkflowCreation(page)
            await modal
                .getByRole("button", {name: EVALUATOR_COMMIT_MODAL_SUBMIT_LABEL})
                .last()
                .click()
            await creationPromise
            await expect(
                page.locator(".ant-message").getByText(EVALUATOR_CREATE_SUCCESS_MESSAGE).first(),
            ).toBeVisible({timeout: 10000})

            // Navigate back to the registry, then click the row.
            await navigateToEvaluators()
            const searchInput = page.locator('input[placeholder="Search"]').first()
            if (await searchInput.isVisible().catch(() => false)) {
                await searchInput.fill(evaluatorName)
            }
            await expect
                .poll(
                    async () =>
                        page.locator("[data-row-key]").filter({hasText: evaluatorName}).count(),
                    {timeout: 15000},
                )
                .toBeGreaterThan(0)
            const row = page.locator("[data-row-key]").filter({hasText: evaluatorName}).first()
            await row.click()

            // Row click navigates to the full-page playground — same surface as
            // LLM/code evaluators (Phase 6 unification, gate removed in T17).
            await expect(page).toHaveURL(/\/apps\/[^/]+\/playground(\?|$|#)/, {timeout: 15000})
            await expect(
                page
                    .getByRole("button", {name: new RegExp(EVALUATOR_SELECT_APP_PLACEHOLDER)})
                    .first(),
            ).toBeVisible({timeout: 15000})
        },
    )

    test(
        "should render the full-page playground on direct URL visit to /apps/<evalId>/playground",
        {
            tag: buildAcceptanceTags({
                scope: [TestScope.EVALUATIONS],
                coverage: [TestCoverage.LIGHT, TestCoverage.FULL],
                path: TestPath.HAPPY,
                lens: TestLensType.FUNCTIONAL,
                cost: TestCostType.Free,
                license: TestLicenseType.OSS,
                role: TestRoleType.Owner,
                caseType: TestcaseType.TYPICAL,
                speed: TestSpeedType.FAST,
            }),
        },
        async ({page, navigateToEvaluators}) => {
            // Verifies T17: direct URL visits to a declarative classifier's
            // /apps/<evalId>/playground page render the evaluator-flavored
            // surface — no bounce to /evaluators (the bounce was the behavior
            // pre-T17 via the now-removed useEvaluatorPlaygroundGuard).
            const evaluatorName = `e2e-exact-match-direct-${Date.now()}`

            await navigateToEvaluators()
            const drawer = await selectEvaluatorTemplate(page, EVALUATOR_EXACT_MATCH_TEMPLATE_NAME)
            const drawerCreateButton = drawer
                .getByRole("button", {name: EVALUATOR_DRAWER_CREATE_BUTTON_LABEL})
                .first()
            await expect(drawerCreateButton).toBeEnabled({timeout: 10000})
            await drawerCreateButton.click()

            const modal = getEvaluatorCommitModal(page)
            await expect(modal.first()).toBeVisible({timeout: 10000})
            await modal
                .locator(`input[placeholder="${EVALUATOR_COMMIT_MODAL_NAME_PLACEHOLDER}"]`)
                .first()
                .fill(evaluatorName)
            const creationPromise = waitForWorkflowCreation(page)
            await modal
                .getByRole("button", {name: EVALUATOR_COMMIT_MODAL_SUBMIT_LABEL})
                .last()
                .click()
            await creationPromise
            await expect(
                page.locator(".ant-message").getByText(EVALUATOR_CREATE_SUCCESS_MESSAGE).first(),
            ).toBeVisible({timeout: 10000})

            // Capture the post-create URL — it's the playground URL we want to
            // re-visit directly. (Post-create navigation already lands here.)
            await expect(page).toHaveURL(/\/apps\/[^/]+\/playground(\?|$|#)/, {timeout: 15000})
            const playgroundUrl = page.url()

            // Navigate away, then revisit the URL directly. If the guard were
            // still in place, this would bounce to /evaluators?revisionId=...
            await navigateToEvaluators()
            await expect(page).toHaveURL(/\/evaluators(\?|$)/, {timeout: 5000})

            await page.goto(playgroundUrl)
            await expect(page).toHaveURL(/\/apps\/[^/]+\/playground(\?|$|#)/, {timeout: 15000})
            await expect(
                page
                    .getByRole("button", {name: new RegExp(EVALUATOR_SELECT_APP_PLACEHOLDER)})
                    .first(),
            ).toBeVisible({timeout: 15000})
        },
    )

    test(
        "should list declarative classifiers in the sidebar switcher (not just LLM/code evaluators)",
        {
            tag: buildAcceptanceTags({
                scope: [TestScope.EVALUATIONS],
                coverage: [TestCoverage.LIGHT, TestCoverage.FULL],
                path: TestPath.HAPPY,
                lens: TestLensType.FUNCTIONAL,
                cost: TestCostType.Free,
                license: TestLicenseType.OSS,
                role: TestRoleType.Owner,
                caseType: TestcaseType.TYPICAL,
                speed: TestSpeedType.FAST,
            }),
        },
        async ({page, navigateToEvaluators}) => {
            // Verifies T17: the sidebar workflow switcher lists ALL evaluator
            // kinds, not just full-page-eligible (LLM/code) ones. Pre-T17 the
            // dropdown used `fullPagePlaygroundEvaluatorsAtom` which filtered
            // declarative classifiers out — leaving them unreachable via UI
            // navigation from anywhere except the /evaluators table.
            const evaluatorName = `e2e-exact-match-sidebar-${Date.now()}`

            await navigateToEvaluators()
            const drawer = await selectEvaluatorTemplate(page, EVALUATOR_EXACT_MATCH_TEMPLATE_NAME)
            const drawerCreateButton = drawer
                .getByRole("button", {name: EVALUATOR_DRAWER_CREATE_BUTTON_LABEL})
                .first()
            await expect(drawerCreateButton).toBeEnabled({timeout: 10000})
            await drawerCreateButton.click()

            const modal = getEvaluatorCommitModal(page)
            await expect(modal.first()).toBeVisible({timeout: 10000})
            await modal
                .locator(`input[placeholder="${EVALUATOR_COMMIT_MODAL_NAME_PLACEHOLDER}"]`)
                .first()
                .fill(evaluatorName)
            const creationPromise = waitForWorkflowCreation(page)
            await modal
                .getByRole("button", {name: EVALUATOR_COMMIT_MODAL_SUBMIT_LABEL})
                .last()
                .click()
            await creationPromise
            await expect(
                page.locator(".ant-message").getByText(EVALUATOR_CREATE_SUCCESS_MESSAGE).first(),
            ).toBeVisible({timeout: 10000})

            // Post-create lands on the full-page playground; the
            // WorkflowEntityCard switcher appears in the sidebar from there.
            await expect(page).toHaveURL(/\/apps\/[^/]+\/playground(\?|$|#)/, {timeout: 15000})

            // Click the switcher's "Switch workflow" button. The aria-label is
            // only set on the expanded-sidebar variant in WorkflowEntityCard.tsx
            // (the collapsed-sidebar trigger uses just the icon button) — this
            // test therefore assumes the sidebar is expanded, which is the
            // default state. If a test environment ever defaults to collapsed,
            // this finder would need to also match the icon-only button.
            const switchButton = page.getByRole("button", {name: "Switch workflow"}).first()
            await expect(switchButton).toBeVisible({timeout: 15000})
            await switchButton.click()

            // The dropdown opens via AntD's Dropdown. The just-created
            // declarative classifier should be in the list — pre-T17 it
            // wouldn't be (the dropdown filtered to LLM/code-only evaluators).
            await expect(
                page.getByRole("menuitem").filter({hasText: evaluatorName}).first(),
            ).toBeVisible({timeout: 10000})
        },
    )
}

export default testEvaluators
