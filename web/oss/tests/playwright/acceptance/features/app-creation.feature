# Tests: app/create.spec.ts -> app/index.ts -> app/test.ts
# RTM IDs: WEB-ACC-APP-001, WEB-ACC-APP-002
# Tags: @scope:apps @scope:playground @scope:evaluations @scope:deployment @scope:observability
#       @coverage:smoke @coverage:light @path:happy @case:typical @speed:fast

Feature: Prompt App Creation
  As a user
  I want to create new prompt apps
  So that I can configure and test LLM prompts

  Background:
    Given the user is authenticated
    And the user is on the Prompts page

  @smoke @happy
  Scenario: Create a new completion prompt app
    When the user creates a "Completion Prompt" app with a unique name
    Then the new completion prompt app is visible after creation

  @smoke @happy
  Scenario: Create a new chat prompt app
    When the user creates a "Chat Prompt" app with a unique name
    Then the new chat prompt app is visible after creation
