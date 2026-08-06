# Test: smoke.spec.ts
# RTM ID: WEB-ACC-AUTH-001
# Tags: @scope:auth @coverage:smoke @path:happy @case:typical @speed:fast

Feature: Authentication and Basic Navigation
  As a user
  I want to log in and access the application
  So that I can verify the deployment is healthy

  Background:
    Given the user has valid credentials for the OSS deployment

  @smoke @happy @scope:auth @speed:fast
  Scenario: Authenticate and navigate to apps
    When the user logs in with their credentials
    Then the user should be redirected to the workspace-scoped apps page
    And the page URL should contain "/apps"
