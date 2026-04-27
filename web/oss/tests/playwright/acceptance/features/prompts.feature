# Tests: prompts/prompts.spec.ts -> prompts/index.ts -> prompts/test.ts
# RTM IDs: WEB-ACC-PROMPTS-001, WEB-ACC-PROMPTS-002, WEB-ACC-PROMPTS-003
# Tags: @scope:apps @coverage:smoke @coverage:light @path:happy @case:typical @speed:fast

Feature: Prompts Page
  As a user
  I want to manage prompts and folders on the Prompts page
  So that I can organise and create LLM prompts

  Background:
    Given the user is authenticated

  @smoke @happy @scope:apps @speed:fast
  Scenario: Navigate to the Prompts page
    When the user navigates to the Prompts page
    Then the Prompts page is displayed with the Create new button

  @smoke @happy @scope:apps @speed:fast
  Scenario: Create a new prompt via the Create new dropdown
    Given the user is on the Prompts page
    When the user clicks Create new, selects New prompt, and fills in the form
    Then the new prompt modal was opened and submitted successfully

  @smoke @happy @scope:apps @speed:fast
  Scenario: Create a new folder via the Create new dropdown
    Given the user is on the Prompts page
    When the user clicks Create new, selects New folder, and enters a folder name
    Then the new folder is created and visible in the prompts table
