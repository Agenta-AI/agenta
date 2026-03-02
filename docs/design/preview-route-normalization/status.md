# Status

Date: 2026-02-25

## Overall

- State: Phase 1 implemented for all safe-now families.
- Immediate next step: migrate frontend and SDK callers from `/preview/*` to canonical paths.

## Add canonical routes (API)

- done: tracing, invocations, annotations, testcases, testsets (+ simple), queries (+ simple), applications (+ simple), workflows, evaluators (+ simple), evaluations (+ simple)
- open: environments (+ simple) due legacy `/environments` overlap requiring explicit verification

## Frontend migration status

- not-started: tracing, annotations, testcases, testsets (+ simple), queries (+ simple), workflows, evaluators (+ simple), evaluations (+ simple)
- n/a (no current usage found): invocations, applications (+ simple), environments (+ simple)

## SDK migration status

- not-started: tracing, testsets (+ simple), applications (+ simple), workflows, evaluators (+ simple), evaluations (+ simple)
- n/a (no current usage found): invocations, annotations, testcases, queries (+ simple), environments (+ simple)

## Risks and blockers

- OpenAPI duplication risk if preview mounts are left in schema after adding canonical mounts.
- Environments prefix overlap with legacy router may cause ambiguous behavior if not validated carefully.
- High-usage families (evaluations/testsets/testcases/evaluators) need coordinated frontend + SDK migration to avoid long tail preview dependency.

## Decision log

- Use tracing migration pattern broadly: dual-mount + hide preview in schema.
- Treat environments as a dedicated decision point (do not batch into safe-now migration set).
