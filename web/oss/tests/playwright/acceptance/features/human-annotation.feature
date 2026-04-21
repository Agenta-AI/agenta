# Tests: human-annotation/human-annotation.spec.ts -> human-annotation/index.ts -> human-annotation/tests.ts
# RTM IDs: <WEB-ACC-HUMAN-001>, <WEB-ACC-HUMAN-002>, <WEB-ACC-HUMAN-003>, <WEB-ACC-HUMAN-004>, <WEB-ACC-HUMAN-005>, <WEB-ACC-HUMAN-006>, <WEB-ACC-HUMAN-007>
# Tags: @scope:evaluations @coverage:smoke @coverage:light @coverage:full @path:happy @case:typical @license:oss

Feature: Human Annotation
  As a user
  I want to run and annotate human evaluations
  So that I can collect qualitative feedback on LLM prompt outputs

  Background:
    Given the user is authenticated

  @smoke @happy @scope:evaluations @speed:fast @license:oss
  Scenario: Human evaluation entry point on the human tab
    Given a completion app exists in the project
    When the user navigates to the human evaluations tab for that app
    Then the human evaluation entry point is displayed

  @smoke @happy @scope:evaluations @speed:fast @license:oss
  Scenario: Mismatched testset when configuring a human evaluation
    Given a chat app with at least one variant exists
    When the user opens the New Human Evaluation modal and selects a testset with mismatched columns
    Then the expected input variables note is shown
    And the note does not contain the mismatched column name
    And the modal allows proceeding with the mismatched testset selected

  @smoke @happy @scope:evaluations @speed:slow @license:oss
  Scenario: Create a human evaluation and land on the results page
    Given a completion app with at least one variant exists
    When the user creates a testset and runs a human evaluation
    Then the modal closes
    And the user is navigated to the human evaluation results page
    And the Annotate tab is selected
    And the inputs, outputs, and annotations sections are visible

  @light @happy @scope:evaluations @speed:slow @license:oss
  Scenario: Create evaluator inline and annotate a scenario from the Annotate tab
    Given a completion app with at least one variant exists
    When the user creates a human evaluation run with an inline evaluator metric
    Then the user is navigated to the human evaluation results page
    When the user annotates the current scenario with a boolean metric value
    Then the annotation is submitted successfully

  @light @happy @scope:evaluations @speed:slow @license:oss
  Scenario: Annotate multiple scenarios and see progress in the Scenarios tab
    Given a completion app with at least one variant exists
    And a 3-row testset is created
    When the user creates a human evaluation run with an inline evaluator
    And the user annotates the first scenario
    And the user navigates to the Scenarios tab
    And the user selects and annotates a second scenario
    Then two scenarios show an annotated success status in the Scenarios tab

  @light @happy @scope:evaluations @speed:slow @license:oss
  Scenario: Submit a partial annotation and resume later
    Given a human evaluation run exists with multiple scenarios
    When the user annotates one scenario and navigates away
    And the user returns to the same evaluation run
    Then the previously submitted annotation is still recorded

  @light @happy @scope:evaluations @speed:fast @license:oss
  Scenario: View the Overview tab on a human evaluation results page
    Given at least one human evaluation run exists
    When the user navigates to that run's results page and clicks the Overview tab
    Then the Overview tab is active
    And the Evaluator Scores Overview section is visible
