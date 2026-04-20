# Tests: app/app-management.spec.ts -> app/app-management.ts
# RTM IDs: WEB-ACC-APP-003, WEB-ACC-APP-004
# Tags: @scope:apps @coverage:smoke @coverage:light @path:happy @case:typical @speed:fast

Feature: Prompt App Management
  As an owner
  I want to manage existing prompt apps
  So that I can keep my project organised

  Background:
    Given the user is authenticated
    And at least one prompt app exists in the project

  @smoke @happy @scope:apps @speed:fast
  Scenario: Delete an app
    Given the user is on the apps list page
    When the user deletes an existing app
    Then the app no longer appears in the apps list

  @smoke @happy @scope:apps @speed:fast
  Scenario: Rename an app
    Given the user is on the apps list page
    When the user renames an existing app with a new unique name
    Then the updated app name is visible in the apps list
