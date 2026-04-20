# Tests: playground/run-variant.spec.ts -> playground/index.ts -> playground/tests.ts
# RTM IDs: WEB-ACC-PLAYGROUND-001, WEB-ACC-PLAYGROUND-002, WEB-ACC-PLAYGROUND-003
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

  @smoke @happy @scope:playground @scope:observability @speed:slow
  Scenario: Run single view variant for completion
    Given the active project has a configured test provider
    And the user is on the playground for a completion app
    When the user runs the completion variant with test inputs
    Then the completion variant run succeeds without UI errors

  @smoke @happy @scope:playground @speed:slow
  Scenario: Run single view variant for chat
    Given the active project has a configured test provider
    And the user is on the playground for a chat app
    When the user runs the chat variant with test inputs
    Then the chat variant run succeeds without UI errors

  @smoke @happy @scope:playground @speed:slow
  Scenario: Update prompt and save changes
    Given the user is on the playground for a completion app
    When the user adds new prompt messages
    And the user changes the template variable keys
    And the user commits the changes "As a new version"
    Then the prompt changes are saved successfully
