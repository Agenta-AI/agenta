# Tests: auto-evaluation/run-auto-evaluation.spec.ts -> auto-evaluation/index.ts -> auto-evaluation/tests.ts
# RTM IDs: WEB-ACC-AUTOEVAL-001, WEB-ACC-AUTOEVAL-002, WEB-ACC-AUTOEVAL-003, WEB-ACC-AUTOEVAL-004, WEB-ACC-AUTOEVAL-005, WEB-ACC-AUTOEVAL-006
# Tags: @scope:evaluations @coverage:smoke @coverage:light @coverage:full @path:happy @case:typical @license:oss

Feature: Auto Evaluation
  As a user
  I want to run automatic evaluations against app variants
  So that I can assess LLM prompt quality at scale

  Background:
    Given the user is authenticated

  @smoke @happy @scope:evaluations @speed:slow
  Scenario: Run a single auto evaluation
    Given a completion app with at least one variant exists
    And the user navigates to the auto evaluations page for that app
    When the user creates a testset and runs an auto evaluation with Exact Match
    Then the modal closes
    And the user is navigated to the evaluation results page
    And the URL contains the auto evaluation results path

  @smoke @happy @scope:evaluations @speed:fast
  Scenario: Show error when creating auto evaluation with mismatched testset
    Given a chat app with at least one variant exists
    And the user navigates to the auto evaluations page for that app
    When the user opens the New Auto Evaluation modal and selects a testset with mismatched columns
    Then the expected input variables note is shown
    And the note does not contain the mismatched column name
    And the modal allows proceeding with the mismatched testset selected

  @light @happy @scope:evaluations @speed:fast
  Scenario: View auto evaluation results — Scenarios tab
    Given a completed auto evaluation run exists
    When the user opens the evaluation results page
    Then the Scenarios tab is visible and active by default
    And the scenario rows are displayed with scores

  @light @happy @scope:evaluations @speed:fast
  Scenario: View auto evaluation results — Configuration tab
    Given a completed auto evaluation run exists
    When the user opens the evaluation results page
    And the user switches to the Configuration tab
    Then the evaluator configuration and testset information are displayed

  @smoke @light @happy @scope:evaluations @speed:fast
  Scenario: Delete an auto evaluation run
    Given a completed auto evaluation run exists
    When the user deletes the evaluation run from the list
    Then a confirmation modal appears
    When the user confirms the deletion
    Then the evaluation run is removed from the list

  @light @happy @scope:evaluations @speed:slow
  Scenario: Re-run an existing auto evaluation
    Given a completed auto evaluation run exists
    When the user triggers a re-run of the existing evaluation
    Then a new evaluation run entry appears in the list
