# Tests: prompt-registry/prompt-registry-flow.spec.ts -> prompt-registry/index.ts
# Tags: @scope:playground @coverage:smoke @coverage:light @coverage:full @path:happy
#
# Implementation notes:
# - Navigation: /apps -> Prompts sidebar link -> prompts table -> click app row
# - Direct URL to /prompts returns 404 (requires workspace prefix)
# - Prompts table uses div-based rows (not <tr>); use cursor-class locator for row clicks
# - Clicking a prompt row navigates to the app overview page (not a drawer)

Feature: Prompt Registry
  As a user
  I want to browse the prompt registry
  So that I can view and manage my prompt apps

  Background:
    Given the user is authenticated
    And at least one prompt app exists

  @smoke @happy
  Scenario: Open prompt details from the registry
    Given the user navigates to the Prompts page via sidebar
    Then the "Prompts" heading should be visible
    And a prompts table should be visible
    When the user clicks on the first app row
    Then the user should be navigated to the app overview page
