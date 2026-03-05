# Playwright OSS Stabilization

This workspace tracks the plan to stabilize frontend Playwright tests, run a reliable OSS subset against deployed environments, and safely roll the improved setup into production CI.

## Files

- `context.md` - Why this work matters, goals, and non-goals.
- `research.md` - Current test architecture, suite inventory, and discovered issues.
- `plan.md` - Execution phases, milestones, and rollout gates.
- `status.md` - Living progress log with decisions and blockers.
- `qa.md` - OSS deployment smoke profile, command matrix, and acceptance criteria.
- `backlog.md` - Prioritized implementation backlog (P0/P1/P2).

## Scope

- Frontend Playwright infrastructure in `web/tests`.
- OSS acceptance suite in `web/oss/tests/playwright/acceptance`.
- EE wrapper/test structure in `web/ee/tests/playwright/acceptance`.
