# Context

## Background

After `#4016`, the PR preview workflow changed from deploy-only behavior to deploy-plus-test behavior. The new flow deploys a Railway preview and then immediately runs readiness checks, auth bootstrap, and multiple API/web test suites against the live preview deployment.

## Problem Statement

There is a working hypothesis that the new post-deploy CI activity is destabilizing the preview environment or mutating shared auth state. We need an isolation experiment that keeps preview deployment intact while temporarily disabling CI steps that interact with the deployed preview after rollout.

## Goals

- Keep preview build and deploy behavior intact.
- Disable post-deploy CI jobs that hit the live preview environment.
- Preserve unrelated CI coverage such as linting, unit tests, and other non-preview checks.
- Make the change explicit so reviewers understand it is a diagnostic experiment.

## Non-Goals

- Permanently redesign the Railway workflow.
- Fix the underlying preview/auth regression in this patch.
- Remove unit, lint, or non-preview CI coverage.
