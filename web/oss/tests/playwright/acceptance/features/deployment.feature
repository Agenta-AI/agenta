# Tests: deployment/deploy-variant.spec.ts -> deployment/index.ts
# Tags: @scope:deployment @coverage:smoke @coverage:light @coverage:full @path:happy
#
# Implementation notes:
# - There is no /deployments sidebar link; deployment section is on the app Overview page
# - Navigation: /apps -> Prompts sidebar -> search app -> click app -> scroll to Deployment section
# - Variant data is fetched via direct API call (page.request.get) to avoid navigation issues

Feature: Variant Deployment
  As a user
  I want to deploy a prompt variant to an environment
  So that I can serve it to end users

  Background:
    Given the user is authenticated
    And at least one completion app with a variant exists

  @smoke @happy
  Scenario: Deploy a variant to development environment
    Given the user navigates to the app overview page
    When the user scrolls to the Deployment section
    Then the following environment cards should be visible:
      | Environment  |
      | Development  |
      | Staging      |
      | Production   |
    When the user clicks on the "Development" environment card
    And the user clicks "Deploy" button
    And the user selects a variant in the deployment modal
    And the user confirms the deployment
    Then the deployment should succeed
