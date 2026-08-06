# Tests: observability/observability.spec.ts -> observability/index.ts
# RTM IDs: WEB-ACC-OBS-001, WEB-ACC-OBS-002, WEB-ACC-OBS-003, WEB-ACC-OBS-004, WEB-ACC-OBS-005, WEB-ACC-OBS-006
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
    And a completion app with a configured test provider exists

  @smoke @happy @scope:observability @speed:slow
  Scenario: View traces and open trace detail drawer
    Given the user is on the Observability page
    When the user opens the traces table
    Then the trace detail drawer opens

  @light @happy @scope:observability @speed:slow
  Scenario: Filter traces by date range and by app
    Given the user runs the completion variant in Playground
    When the user navigates to the Observability page
    And clicks the Refresh button if traces do not appear immediately
    And the user applies a date range filter
    Then the traces table shows only rows matching the selected filter

  @light @happy @scope:observability @speed:slow
  Scenario: Filter traces by span name or attribute
    Given the user runs the completion variant in Playground
    When the user navigates to the Observability page
    And clicks the Refresh button if traces do not appear immediately
    And the user filters by span name or a known attribute value
    Then the traces table narrows to rows matching that filter

  @light @happy @scope:observability @speed:slow
  Scenario: Open a span and drill into attributes
    Given the user runs the completion variant in Playground
    When the user navigates to the Observability page
    And clicks the Refresh button if traces do not appear immediately
    And the user opens the first trace row and expands a span
    Then the span tree renders at least one node inside the trace drawer

  @light @happy @scope:observability @speed:slow
  Scenario: Verify trace tabs switch correctly
    Given the user runs the completion variant in Playground
    When the user navigates to the Observability page
    And clicks the Refresh button if traces do not appear immediately
    And the user switches between the LLM, All, and Root trace tabs
    Then each tab updates the displayed rows accordingly

  @light @happy @scope:observability @speed:slow
  Scenario: Verify a trace is created after a Playground run
    Given the user runs the completion variant in Playground
    When the user navigates to the Observability page
    And clicks the Refresh button if traces do not appear immediately
    Then a new trace row is visible in the traces table for that run
