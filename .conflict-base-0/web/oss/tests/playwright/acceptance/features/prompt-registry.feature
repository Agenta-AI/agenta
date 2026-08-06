# Tests: prompt-registry/prompt-registry-flow.spec.ts -> prompt-registry/index.ts
# RTM ID: WEB-ACC-REGISTRY-001
# Tags: @scope:playground @coverage:smoke @coverage:light @coverage:full @path:happy
#
# Implementation notes:
# - Navigation: open the app workflow revisions page directly via the scoped project path
# - The registry data comes from POST /api/workflows/revisions/query
# - The first published workflow revision is opened via its data-row-key
# - The drawer action transitions the user into Playground with a revisionId query parameter

Feature: Prompt Registry Workflow Revisions
  As a user
  I want to browse workflow revisions from the prompt registry
  So that I can jump into Playground for a selected revision

  Background:
    Given the user is authenticated
    And at least one completion app exists

  @smoke @happy @scope:playground @speed:fast
  Scenario: Open Playground from the first published workflow revision
    Given the user is on the workflow revisions page for that app
    When the user opens the first published workflow revision
    And the workflow revision drawer is visible
    And the user opens Playground from that drawer
    Then the Playground opens for the selected revision
