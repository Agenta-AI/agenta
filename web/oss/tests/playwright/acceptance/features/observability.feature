# Tests: observability/observability.spec.ts -> observability/index.ts
# RTM ID: WEB-ACC-OBS-001
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
    Given the user is on the Observability page
    When the user opens the traces table
    Then the trace detail drawer opens
