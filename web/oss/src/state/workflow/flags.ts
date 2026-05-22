/**
 * Feature flags for the workflow / evaluator full-page UX (PR #4288).
 *
 * The "Phase 5" change routed evaluator table row clicks (and post-create
 * navigation) to a full-page playground at `/apps/<evaluatorId>/playground`,
 * with the drawer reduced to a quick-edit affordance. We're temporarily
 * disabling that routing while follow-up fixes land — when the flag flips to
 * `true`, the new flow takes over again with no other code changes required.
 *
 * Call sites gated by this flag:
 *   1. `components/Evaluators/index.tsx` — row-click navigation.
 *   2. `components/WorkflowRevisionDrawerWrapper/index.tsx` — post-create
 *      navigation after evaluator commit.
 *   3. `components/PlaygroundRouter/index.tsx` — guard that allows full-page
 *      UX evaluators to stay on `/playground`. With the flag off, all
 *      evaluator playground URLs redirect back to `/evaluators` so direct
 *      URL visits also fall back to the drawer flow.
 *   4. `components/Sidebar/components/WorkflowEntityCard.tsx` — sidebar
 *      switcher that lists full-page-eligible evaluators.
 */
export const EVALUATOR_FULL_PAGE_NAV_ENABLED = false
