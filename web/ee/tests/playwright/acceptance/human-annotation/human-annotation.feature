# Tests: human-annotation/human-annotation.spec.ts -> human-annotation/index.ts -> human-annotation/tests.ts
# RTM IDs: WEB-ACC-HUMAN-001, WEB-ACC-HUMAN-002, WEB-ACC-HUMAN-003, WEB-ACC-HUMAN-004
# Tags: @scope:evaluations @coverage:smoke @coverage:light @coverage:full @path:happy @case:typical @license:ee

Feature: Human Annotation
  As a user
  I want to run and annotate human evaluations
  So that I can collect qualitative feedback on LLM prompt outputs

  Background:
    Given the user is authenticated

  @smoke @happy @scope:evaluations @speed:fast
  Scenario: Human evaluation entry point on the human tab
    Given a completion app exists in the project
    When the user navigates to the human evaluations tab for that app
    Then the human evaluation entry point is displayed

  @smoke @happy @scope:evaluations @speed:fast
  Scenario: Mismatched testset when configuring a human evaluation
    Given a chat app with at least one variant exists
    When the user opens the New Human Evaluation modal and selects a testset with mismatched columns
    Then the expected input variables note is shown
    And the note does not contain the mismatched column name
    And the modal allows proceeding with the mismatched testset selected

  @smoke @happy @scope:evaluations @speed:slow
  Scenario: Create a human evaluation and land on the results page
    Given a completion app with at least one variant exists
    When the user creates a testset and runs a human evaluation
    Then the modal closes
    And the user is navigated to the human evaluation results page
    And the Annotate tab is selected
    And the inputs, outputs, and annotations sections are visible

  @light @happy @scope:evaluations @speed:slow
  Scenario: Create evaluator inline and annotate a scenario from the Annotate tab
    Given a completion app with at least one variant exists
    When the user creates a human evaluation run with an inline evaluator metric
    Then the user is navigated to the human evaluation results page
    When the user annotates the current scenario with a boolean metric value
    Then the annotation is submitted successfully
