# Tests: playground/run-variant.spec.ts -> playground/index.ts -> playground/tests.ts
# RTM IDs: WEB-ACC-PLAYGROUND-001, WEB-ACC-PLAYGROUND-002, WEB-ACC-PLAYGROUND-003, WEB-ACC-PLAYGROUND-004, WEB-ACC-PLAYGROUND-005, WEB-ACC-PLAYGROUND-006, WEB-ACC-PLAYGROUND-007
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

  @smoke @happy @scope:playground @speed:slow
  Scenario: Save as a new variant
    Given the user is on the playground for a completion app
    When the user modifies the prompt and commits the changes as a new variant
    Then the new variant is visible in the playground

  @light @happy @scope:playground @speed:slow
  Scenario: Open compare mode with two variants
    Given the user is on the playground for a completion app
    When the user opens compare mode and adds a second variant
    Then both variant panels are visible side by side

  @smoke @happy @scope:playground @speed:fast
  Scenario: Deep link with revisions param loads correct variant
    Given a completion app exists with at least one revision
    When the user opens the playground via a deep link with a revisions param
    Then the playground loads with the correct variant ready to use

  @light @happy @scope:playground @speed:slow
  Scenario: Configure output type and tools
    Given the active project has a configured test provider
    And the user is on the playground for a completion app
    When the user connects the OpenAI web search tool
    Then the web_search_preview tool block appears in the prompt section
    When the user runs the completion variant with the web search tool active
    Then the run succeeds without UI errors
