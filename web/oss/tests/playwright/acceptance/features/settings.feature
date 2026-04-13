# Tests: settings/model-hub.spec.ts -> settings/model-hub.ts; settings/api-keys-management.spec.ts -> settings/api-keys.ts
# RTM IDs: WEB-ACC-SETTINGS-001, WEB-ACC-SETTINGS-002
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

  @smoke @happy
  Scenario: Ensure the mock custom provider exists
    When the project scoped mock test provider is configured
    Then the "Custom providers" table lists "mock"

  @light @happy
  Scenario: Create and delete an API key
    Given the user is on the Settings page
    When the user creates a new API key
    Then the fresh API keys list contains the created key
    When the user deletes the first API key from the list
    Then the delete confirmation closes and the user remains on Settings
