# Tests: observability/observability.spec.ts -> observability/index.ts
# Tags: @scope:observability @coverage:smoke @coverage:light @coverage:full @path:happy
#
# Implementation notes:
# - Navigation: /apps -> Observability sidebar link -> Traces tab
# - Direct URL to /observability returns 404 (requires workspace prefix)
# - Traces data comes from prior playground runs; table should have at least one row
# - Clicking a trace row opens an Ant Design drawer with span details

Feature: Observability Traces
  As a user
  I want to view traces of LLM calls
  So that I can debug and monitor prompt execution

  Background:
    Given the user is authenticated
    And at least one trace exists from a prior playground run

  @smoke @happy
  Scenario: View traces and open trace detail drawer
    Given the user navigates to the Observability page via sidebar
    Then the "Traces" tab should be visible and selected
    And a traces table should be visible with at least one data row
    When the user clicks on the first trace row
    Then a detail drawer should open
