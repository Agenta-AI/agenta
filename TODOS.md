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

## Query Registry — fast-follows

### Backend query-usage endpoint (enumerate referencing live evals)
- **What:** Add `POST /queries/revisions/{id}/usage` (or `/queries/{id}/usage`) returning the evaluation-run ids that reference a given query revision.
- **Why:** v1 ships a generic "this query may be in use by a live evaluation" confirm before archive, because there is no reverse-lookup today. This endpoint lets the manage drawer name the specific live evals before archiving — real safety instead of a generic warning.
- **Pros:** Turns the safe-archive UX from 7/10 (generic) to 10/10 (enumerated); reuses data that already exists.
- **Cons:** Backend work (new router/service/DAO); a reverse scan of eval-run references.
- **Context:** The reference data exists, flattened, in the evaluations domain under `QUERY_REFERENCE_KEY = "query_revision"` (`api/oss/src/dbs/postgres/evaluations/utils.py`). Eval runs store `data.steps[].references["query_revision"]`. There is currently NO reverse-lookup endpoint and archive does not block in-use queries (`api/oss/src/core/queries/service.py:844` `archive_query_revision` has no reference check). Verified during the eng review of branch `claude/intelligent-bassi-ca4cc0`.
- **Depends on / blocked by:** None. Independent of the FE registry; the FE swaps the generic confirm for enumeration when this lands.

### (RESOLVED) Revision-history expand — no backend change needed
- **What:** The Query Registry's version-history expand is implemented. Each query
  (artifact) row expands to its earlier revisions, lazy-loaded on first expand.
- **Resolution:** Revisions are queried by the **artifact ref** (`query_refs: [{id: queryId}]`),
  not the variant ref — `QueryRevisionQueryRequest` accepts `query_refs`, and the
  service maps `artifact_refs=query_refs`. Simple queries are single-variant, so this
  returns the full version history. The earlier assumption that the list must return
  `variant_id` was wrong; the list already returns the artifact `id` (= queryId), which
  is all the expand needs.
- **Nice-to-have (not blocking):** the simple-queries list could still surface
  `revision_id` so the head row shows its version badge without a fetch, but the expand
  works without it.
