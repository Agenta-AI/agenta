/**
 * Workflow-typed state tree (apps + evaluators + snippets).
 *
 * Lives in parallel to `state/app/` — neither tree derives from the other.
 * Both feed off the same underlying entity-package query atoms
 * (`appWorkflowsListQueryAtom`, `evaluatorsListQueryAtom`); this tree's
 * combined map is the union, while `state/app/` keeps the apps-only view.
 *
 * Migration target for code that currently uses `state/app/`. New consumers
 * that should accept evaluator workflows (e.g., `/apps/[id]/playground` page
 * components, sidebar gating, route guards) should use these atoms/hooks
 * instead of the app-only equivalents.
 *
 * See: ardaerzin-claude-dreamy-franklin-35fadd-design-20260428-162812-workflow-page-unification.md
 */
export {recentEvaluatorIdAtom, workflowsByIdMapAtom, type WorkflowsByIdMap} from "./atoms/fetcher"
export {
    currentWorkflowAtom,
    currentWorkflowContextAtom,
    deriveWorkflowKind,
    type CurrentWorkflowContext,
} from "./selectors/workflow"
export {
    resolveWorkflowDestination,
    type ResolveWorkflowDestinationArgs,
    type WorkflowKind,
    type WorkflowRouteSegment,
} from "./destinations"
export {useWorkflowRouteGuard} from "./hooks/useWorkflowRouteGuard"
export {useCurrentWorkflow, useWorkflowsData} from "./hooks"
