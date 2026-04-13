# Tests: deployment/deploy-variant.spec.ts -> deployment/index.ts
# RTM ID: WEB-ACC-DEPLOYMENT-001
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
    Given the user is on the app overview page
    When the user opens the Development deployment flow
    Then the following environment cards should be visible:
      | Environment  |
      | Development  |
      | Staging      |
      | Production   |
    And the deployment flow completes without leaving the overview context
