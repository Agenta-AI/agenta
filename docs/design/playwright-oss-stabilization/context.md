# Context

## Problem Statement

Frontend Playwright tests are valuable but currently brittle for deployment validation:

- Auth setup is sensitive to UI flow variations.
- Runner behavior and documentation drifted.
- OSS vs EE targeting is not explicit enough for quick deployment checks.
- Some suites are flaky due to random data and first-item assumptions.

This blocks confidence when validating fixes (like playground payload bugs) on real deployments.

## Goals

1. Make an OSS deployment smoke subset reliable and repeatable.
2. Keep current auth-by-UI design, but harden it.
3. Clarify test structure and ownership (runner, fixtures, suites).
4. Introduce a phased plan to improve coverage quality before broad CI enforcement.

## Non-Goals

- Rewriting all tests to API-seeded auth.
- Large-scale test framework replacement.
- Immediate full-suite gate on every deployment.

## Constraints

- Must run against live deployments (not only localhost).
- Must support OSS and EE trees without breaking current workflows.
- Should avoid destructive cleanup behavior in shared environments.
