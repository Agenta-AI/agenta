# Tests: playground/run-variant.spec.ts -> playground/index.ts -> playground/tests.ts
# Tags: @scope:playground @coverage:smoke @coverage:light @coverage:full @path:happy
#
# Implementation notes:
# - navigateToPlayground uses: /apps -> Prompts sidebar -> search box -> click app -> Overview -> Playground sidebar
# - Direct URL to /apps/{id}/playground renders blank (known frontend issue)
# - The prompts table uses div-based rows, so search box is used to find apps in long lists
# - Runtime tests ensure the active project has a configured test provider before execution
# - Runtime tests select the configured test model before clicking Run

Feature: Playground Variant Execution
  As a user
  I want to run prompt variants in the playground
  So that I can test and iterate on my prompts

  Background:
    Given the user is authenticated
    And at least one completion app and one chat app exist

  @smoke @happy @scope:playground @scope:observability
  Scenario: Run single view variant for completion
    Given the active project has a configured test provider
    And the user navigates to the playground for a completion app
    And the user selects the configured test model
    When the user enters a message in the input field
    And the user clicks the "Run" button
    Then the API should return a successful response
    And the output area should display generated text (not "Click run to generate output")
    And no error message should be visible
    When the user clicks "+ Test case" to add a new test case
    Then a new test case section should appear

  @smoke @happy @scope:playground
  Scenario: Run single view variant for chat
    Given the active project has a configured test provider
    And the user navigates to the playground for a chat app
    And the user selects the configured test model
    When the user types a message in the chat input
    And the user clicks the "Run" button
    Then the API should return a successful response
    And no error message should be visible

  @smoke @happy @scope:playground
  Scenario: Update prompt and save changes
    Given the user navigates to the playground for a completion app
    When the user adds a new prompt message with role "User"
    And the user enters prompt text with a template variable
    And the user modifies the template variable key
    And the user clicks "Commit"
    And the user selects "As a new version"
    And the user confirms the commit
    Then the commit modal should close
    And the variant version number should increment
