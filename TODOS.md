# TODOS

## Backend: atomic create-evaluation-run endpoint

- **What:** Add a transactional backend endpoint that creates an evaluation run plus its
  scenarios and step results in a single operation (`createEvaluationRunAtomic` or
  equivalent), instead of the current separate `createRuns` → `createScenarios` →
  `setResults`/steps calls.
- **Why:** The frontend evaluations migration (branch `fe-chore/move-evals-to-packages`)
  has to build a client-side orchestration controller with rollback (`deleteRuns` on
  partial failure) purely because no atomic create exists. An atomic endpoint deletes the
  entire FE rollback path and the orphaned-scenario / rollback-failure edge cases.
- **Pros:** FE `createEvaluationRun` controller collapses to one call; no orphan runs; no
  rollback-failure reconciliation story; transactional integrity owned where it belongs
  (the DB), per "systems over heroes."
- **Cons:** Backend work + a new endpoint contract; FE must then migrate off the
  multi-call path (small follow-up).
- **Context:** During `/plan-eng-review` (2026-06-07) the FE chose controller-owned
  rollback as the pragmatic FE-only solution. This TODO is the documented path to remove
  that complexity later. See design doc
  `~/.gstack/projects/Agenta-AI-agenta/ardaerzin-fe-chore-move-evals-to-packages-design-20260607-192109.md`
  (Eng Review Decisions → run-creation orchestration).
- **Depends on / blocked by:** Backend team; relates to the FE evaluations migration
  landing first (FE rollback is the interim state).
