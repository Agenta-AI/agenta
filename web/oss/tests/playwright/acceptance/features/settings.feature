# Tests: settings/model-hub.spec.ts -> settings/model-hub.ts
# Tags: @scope:settings @coverage:smoke @coverage:light @coverage:full @path:happy
#
# Implementation notes:
# - Navigation: /apps -> Settings sidebar link -> Models menu item
# - Direct URL to /settings returns 404 (requires workspace prefix)
# - Settings sidebar uses role="menuitem" (not tabs or links)
# - API Keys Management test is permanently skipped (requires extra setup)

Feature: Settings - Model Hub
  As a user
  I want to view and manage LLM provider configurations
  So that I can configure which models are available

  Background:
    Given the user is authenticated

  @smoke @happy
  Scenario: View model providers in the Model Hub
    Given the user navigates to the Settings page via sidebar
    When the user clicks the "Models" menu item
    Then a model providers table should be visible
    And the "OpenAI" provider should be listed
