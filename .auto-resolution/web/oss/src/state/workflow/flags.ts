/**
 * Feature flags for the workflow / evaluator full-page UX (PR #4288).
 *
 * The "Phase 5" change routes evaluator table row clicks (and post-create
 * navigation) to a full-page playground at `/apps/<evaluatorId>/playground`,
 * with the drawer reduced to a quick-edit affordance.
 *
 * History:
 *   - #4288 (2026-05-14): shipped the full-page nav.
 *   - #4384 (2026-05-20): disabled via this flag after two blockers surfaced:
 *     (1) the full-page surface had no upstream-app picker (lost on the
 *     generic `PlaygroundHeader`), and (2) the default `trace_type` filter
 *     on `/apps/<evalId>/traces` reverted to `"invocation"`, leaving
 *     evaluator users on an empty page.
 *   - Both fixed: `PlaygroundRouter` now swaps to `ConfigureEvaluatorPage`
 *     for evaluators (carries the app picker via `EvaluatorPlaygroundHeader`),
 *     and `defaultTraceTypeForWorkflow` re-instates the annotation default.
 *
 * Call sites gated by this flag (no longer dark — flag is `true`):
 *   1. `components/Evaluators/index.tsx` — row-click navigation.
 *   2. `components/WorkflowRevisionDrawerWrapper/index.tsx` — post-create
 *      navigation after evaluator commit.
 *   3. `components/PlaygroundRouter/index.tsx` — guard that allows full-page
 *      UX evaluators to stay on `/playground` instead of bouncing to
 *      `/evaluators` + drawer.
 *   4. `components/Sidebar/hooks/useWorkflowSwitcher.tsx` — sidebar switcher
 *      data that lists full-page-eligible evaluators.
 */
export const EVALUATOR_FULL_PAGE_NAV_ENABLED = true
