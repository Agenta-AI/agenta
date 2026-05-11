# Tests: evaluators/evaluators.spec.ts -> evaluators/index.ts -> evaluators/tests.ts
# RTM IDs: WEB-ACC-EVALUATORS-001, WEB-ACC-EVALUATORS-002, WEB-ACC-EVALUATORS-003, WEB-ACC-EVALUATORS-004, WEB-ACC-EVALUATORS-005, WEB-ACC-EVALUATORS-006
# Tags: @scope:evaluations @coverage:smoke @coverage:light @coverage:full @path:happy @case:typical

Feature: Evaluators
  As a user
  I want to create and manage evaluators
  So that I can assess LLM prompt quality

  Background:
    Given the user is authenticated

  @smoke @happy @scope:evaluations @speed:fast
  Scenario: Navigate to the Evaluators page and verify both tabs
    When the user navigates to the Evaluators page
    Then the Automatic Evaluators tab is visible and selected by default
    And the Human Evaluators tab is visible but not selected
    And the Create new button is visible
    When the user switches to the Human Evaluators tab
    Then the active tab and URL parameter update correctly

  @smoke @happy @scope:evaluations @speed:fast
  Scenario: Create an Exact Match evaluator from the template dropdown
    Given the user is on the Evaluators page
    When the user opens the template dropdown and selects Exact Match
    Then the New Evaluator drawer opens
    When the user clicks Create, enters a name, and submits the commit modal
    Then the evaluator is created and appears in the Automatic Evaluators table

  @light @happy @scope:evaluations @speed:slow
  Scenario: Open evaluator playground, select a completion app, and run
    Given the user is on the Evaluators page
    And at least one completion app exists in the project
    When the user creates a fresh Exact Match evaluator
    And the user opens the evaluator view drawer and expands it to playground mode
    And the user selects a completion-type app and its first revision
    And the user fills in the testcase fields
    When the user clicks Run
    Then the evaluator result card appears

  @smoke @happy @scope:evaluations @speed:fast
  Scenario: Create a human evaluator with a boolean feedback metric
    Given the user is on the Evaluators page on the Human Evaluators tab
    When the user clicks Create new, fills in the evaluator name, feedback name, and selects Boolean type
    Then the human evaluator is created and appears in the Human Evaluators table

  @light @happy @scope:evaluations @speed:fast
  Scenario: Edit an existing evaluator and save a new version
    Given the user is on the Evaluators page
    And at least one automatic evaluator exists
    When the user opens the row context menu and clicks Configure
    Then the evaluator config drawer opens
    When the user clicks Commit and confirms in the modal
    Then the new version is saved successfully

  @smoke @happy @scope:evaluations @speed:fast
  Scenario: Delete an evaluator
    Given the user is on the Evaluators page
    And at least one automatic evaluator exists
    When the user opens the row context menu and clicks Delete
    Then a confirmation modal appears
    When the user confirms the deletion
    Then the evaluator is removed from the table
