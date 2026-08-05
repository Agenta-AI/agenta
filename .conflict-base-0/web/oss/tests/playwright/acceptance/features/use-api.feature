# Tests: use-api/use-api.spec.ts -> use-api/index.ts
# RTM IDs: WEB-ACC-USEAPI-001, WEB-ACC-USEAPI-002
# Tags: @scope:deployment @coverage:light @path:happy @speed:fast
#
# Implementation notes:
# - Variant mode: navigate to /apps/{id}/variants, click "Use API" (primary button)
#   → DeploymentsDrawer opens in mode="variant" rendering VariantUseApiContent
#   → Fetch Prompt/Config snippet uses application_variant_ref (variant-keyed endpoint)
#   → Invoke LLM snippet uses axios.post to the variant invocation URL
# - Deployment mode: navigate to /apps/{id}/variants?tab=deployments&selectedEnvName=development
#   → click "Use API" (primary button in the deployments tab header)
#   → DeploymentsDrawer opens in mode="deployment" rendering UseApiContent
#   → Fetch Prompt/Config snippet uses environment_ref (environment-keyed endpoint)
#   → Invoke LLM snippet uses axios.post to the environment invocation URL
# - Both tests assert TypeScript tab only (Python and cURL are separate language concerns).

Feature: Registry Use API — TypeScript snippets
  As a user
  I want to view TypeScript code snippets for calling my app via API
  So that I can integrate Agenta into my TypeScript project

  Background:
    Given the user is authenticated
    And a completion app with at least one variant exists

  @light @happy @scope:deployment @speed:fast
  Scenario: Variant TypeScript snippet shows application_variant_ref in Fetch section
    Given the user is on the Variants registry page
    When the user opens the Use API drawer
    And the user selects the TypeScript tab
    Then the Fetch Prompt/Config section displays the variant TypeScript snippet
    And the Invoke LLM section displays a TypeScript axios snippet

  @light @happy @scope:deployment @speed:fast
  Scenario: Deployment TypeScript snippet shows environment_ref in Fetch section
    Given the user is on the Deployments registry page for the Development environment
    When the user opens the Use API drawer
    And the user selects the TypeScript tab
    Then the Fetch Prompt/Config section displays the deployment TypeScript snippet
    And the Invoke LLM section displays a TypeScript axios snippet
