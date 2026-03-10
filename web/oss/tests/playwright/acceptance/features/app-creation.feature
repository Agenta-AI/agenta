# Tests: app/create.spec.ts -> app/index.ts -> app/test.ts
# Tags: @scope:apps @scope:playground @scope:evaluations @scope:deployment @scope:observability
#       @coverage:smoke @coverage:light @path:happy

Feature: Prompt App Creation
  As a user
  I want to create new prompt apps
  So that I can configure and test LLM prompts

  Background:
    Given the user is authenticated
    And the user is on the Prompts page

  @smoke @happy
  Scenario: Create a new completion prompt app
    When the user clicks "Create new"
    And the user enters a unique app name
    And the user selects "Completion Prompt" as the app type
    And the user confirms the creation
    Then the app should appear in the prompts table
    And the app type should be "completion"

  @smoke @happy
  Scenario: Create a new chat prompt app
    When the user clicks "Create new"
    And the user enters a unique app name
    And the user selects "Chat Prompt" as the app type
    And the user confirms the creation
    Then the app should appear in the prompts table
    And the app type should be "chat"
