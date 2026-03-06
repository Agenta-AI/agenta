# Tests: settings/model-hub.spec.ts -> settings/model-hub.ts
# Tags: @scope:settings @coverage:smoke @coverage:light @coverage:full @path:happy
#
# Implementation notes:
# - Navigation: /apps -> Settings sidebar link -> Models menu item
# - Direct URL to /settings returns 404 (requires workspace prefix)
# - Settings sidebar uses role="menuitem" (not tabs or links)
# - The custom provider flow is project scoped
# - The test recreates the mock provider to verify the drawer flow end to end

Feature: Settings - Model Hub
  As a user
  I want to configure a project scoped test provider
  So that the playground can run without a real third party API key

  Background:
    Given the user is authenticated

  @smoke @happy
  Scenario: Create the mock custom provider
    Given the user navigates to the Settings page via sidebar
    When the user clicks the "Models" menu item
    And the user opens the "Custom providers" drawer
    And the user chooses "Custom Provider"
    And the user submits provider name "mock"
    And the user submits API key "mock"
    And the user submits API base URL "https://mockgpt.wiremockapi.cloud/v1"
    And the user submits model "gpt-6"
    Then the custom providers table should list "mock"
