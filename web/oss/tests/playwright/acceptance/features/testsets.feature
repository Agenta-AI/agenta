# Tests: testsset/testset.spec.ts -> testsset/index.ts
#        testsset/manage.spec.ts -> testsset/manage.ts
# RTM IDs: WEB-ACC-DATASETS-001, WEB-ACC-DATASETS-002, WEB-ACC-DATASETS-003,
#          WEB-ACC-DATASETS-004, WEB-ACC-DATASETS-005, WEB-ACC-DATASETS-006
# Tags: @scope:datasets @coverage:smoke @coverage:light @coverage:full @path:happy @case:typical @speed:fast
#
# Implementation notes:
# - Navigation: /apps -> "Test sets" sidebar link -> testsets table
# - Direct URL to /testsets returns 404 (requires workspace prefix)
# - Test gracefully skips with test.skip() if no testsets exist on the deployment
# - API interception is set up BEFORE sidebar click to capture the POST /api/testsets/query response
# - Preview endpoint returns 'id' (not '_id') and data.testcases (not csvdata)

Feature: Test Sets
  As a user
  I want to view and manage test sets
  So that I can use them for evaluations

  Background:
    Given the user is authenticated

  @smoke @happy @scope:datasets @speed:fast
  Scenario: View the default testset and its details
    Given the user navigates to the Test Sets page via sidebar
    When the testsets API returns data
    Then the test is skipped if no testsets exist
    And the default testset is visible in the table
    When the user opens that testset
    Then the default testset detail page is visible with test cases

  @smoke @happy @scope:datasets @speed:fast
  Scenario: Create a new testset from scratch
    Given the user is on the Test Sets page
    When the user creates a new empty testset with a unique name
    Then the new testset is visible in the testsets list

  @light @happy @scope:datasets @speed:fast
  Scenario: Upload a testset from CSV
    Given the user is on the Test Sets page
    When the user uploads a CSV file as a new testset
    Then the uploaded testset appears in the testsets list with the correct row count

  @light @happy @scope:datasets @speed:fast
  Scenario: Edit a testcase inline and verify the change persists
    Given the user is on the Test Sets page
    And at least one testset exists
    When the user opens that testset and edits a testcase cell inline
    Then the edited value is saved and visible after reload

  @light @happy @scope:datasets @speed:fast
  Scenario: Add and delete rows and columns in a testset
    Given the user is on the Test Sets page
    And at least one testset exists
    When the user opens that testset and adds a new row and a new column
    Then the new row and column are visible in the testset table
    When the user deletes that row and that column
    Then they are no longer present in the testset table

  @smoke @happy @scope:datasets @speed:fast
  Scenario: Delete a testset
    Given the user is on the Test Sets page
    And at least one testset exists
    When the user deletes that testset
    Then the testset no longer appears in the testsets list
