# Tests: settings/model-hub.spec.ts -> settings/model-hub.ts; settings/api-keys-management.spec.ts -> settings/api-keys.ts
# RTM IDs: WEB-ACC-SETTINGS-001, WEB-ACC-SETTINGS-002, WEB-ACC-SETTINGS-003, WEB-ACC-SETTINGS-004
# Tags: @scope:settings @coverage:smoke @coverage:light @coverage:full @path:happy
#
# Implementation notes:
# - The model hub test uses the reusable ensureTestProvider helper instead of driving each form field inline
# - The API key flow test is currently wrapped in a skipped spec until its setup is ready across deployments
# - Direct URL to /settings returns 404 on some deployments without the scoped prefix, so flows rely on existing helpers where needed

Feature: Settings - Model Hub
  As a user
  I want the settings helpers to keep provider and API key flows deterministic
  So that acceptance coverage remains reusable and easier to extend

  Background:
    Given the user is authenticated

  @smoke @happy @scope:settings @speed:fast
  Scenario: Ensure the mock custom provider exists
    When the project scoped mock test provider is configured
    Then the "Custom providers" table lists "mock"

  @light @happy @scope:settings @speed:slow
  Scenario: Create and delete an API key
    Given the user is on the Settings page
    When the user creates a new API key
    Then the fresh API keys list contains the created key
    When the user deletes the first API key from the list
    Then the delete confirmation closes and the user remains on Settings

  @light @happy @scope:settings @speed:fast
  Scenario: Configure a standard provider key and verify it is listed
    Given the user is authenticated
    And the user is on the Settings models page
    When the user clicks Configure now on the first unconfigured standard provider
    And fills in a fake API key and confirms
    Then the Status column no longer shows Configure now for that provider
    When the user deletes the configured standard provider key
    Then the Status column shows Configure now again for that provider

  @light @happy @scope:settings @speed:fast
  Scenario: Add a custom provider via the UI and then delete it
    Given the user is authenticated
    And the user is on the Settings models page
    When the user clicks Create in the Custom providers section
    And fills in a unique name, API key, base URL, and model in the Configure provider drawer
    And submits the drawer
    Then the new provider row appears in the Custom providers table
    When the user deletes the new custom provider row
    Then the deleted provider row is no longer visible
