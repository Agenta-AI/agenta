# Tests: testsset/testset.spec.ts -> testsset/index.ts
# Tags: @scope:datasets @coverage:smoke @coverage:light @coverage:full @path:happy
#
# Implementation notes:
# - Navigation: /apps -> "Test sets" sidebar link -> testsets table
# - Direct URL to /testsets returns 404 (requires workspace prefix)
# - Test gracefully skips with test.skip() if no testsets exist on the deployment
# - API interception is set up BEFORE sidebar click to capture the POST /api/preview/testsets/query response
# - Preview endpoint returns 'id' (not '_id') and data.testcases (not csvdata)

Feature: Test Sets
  As a user
  I want to view and manage test sets
  So that I can use them for evaluations

  Background:
    Given the user is authenticated

  @smoke @happy
  Scenario: View the default testset and its details
    Given the user navigates to the Test Sets page via sidebar
    Then the "Test Sets" heading should be visible
    When the testsets API returns data
    Then the test is skipped if no testsets exist
    And a testset should be visible in the table
    When the user clicks on the testset row
    Then the user should be navigated to the testset detail page
    And the testset should have a name and at least one test case
