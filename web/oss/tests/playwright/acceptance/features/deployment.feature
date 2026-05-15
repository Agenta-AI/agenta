# Tests: deployment/deploy-variant.spec.ts -> deployment/index.ts
# RTM IDs: WEB-ACC-DEPLOYMENT-001, WEB-ACC-DEPLOYMENT-002, WEB-ACC-DEPLOYMENT-003
# Tags: @scope:deployment @coverage:smoke @coverage:light @coverage:full @path:happy
#
# Implementation notes:
# - Clicking an environment card on the overview page navigates to /variants?tab=deployments&selectedEnvName=<env>
# - The DeploymentsDashboard on the variants page has a standalone "Deploy" button
# - Clicking "Deploy" opens SelectDeployVariantModal: a table of variants with radio selection
# - Selecting a variant row and clicking Deploy in the footer triggers the publish mutation
# - VersionBadge renders <span title="Version N">vN</span> on the environment card
# - Revert action: MoreOutlined button on older history row → "Revert" menu item → confirmation dialog

Feature: Variant Deployment
  As a user
  I want to deploy a prompt variant to an environment
  So that I can serve it to end users

  Background:
    Given the user is authenticated
    And at least one completion app with a variant exists

  @smoke @happy @scope:deployment @speed:slow
  Scenario: Deploy a variant to the Development environment
    Given the user is on the app overview page
    Then the three environment cards are visible
    When the user opens the Development deployment flow
    And the user opens the deploy dialog
    And the user selects a variant to deploy to Development
    And the user confirms the deployment
    Then the deployment to Development succeeds

  @light @happy @scope:deployment @speed:slow
  Scenario: Deploy a variant to Staging and Production environments
    Given a fresh completion app with at least one variant exists
    When the user deploys the variant to Staging
    And the user deploys the variant to Production
    Then both Staging and Production deployments succeed

  @light @happy @scope:deployment @speed:slow
  Scenario: Verify version badge updates after deploying to Development
    Given a fresh completion app with at least one variant exists
    When the user deploys the variant to Development
    And the user navigates to the app overview page
    Then the Development card shows a version badge
    And the Staging and Production cards still show no deployment

