import {atom} from "jotai"

/** Search term for filtering app workflows by name */
export const appWorkflowSearchTermAtom = atom("")

/**
 * Type filter for the shared workflow paginated store.
 * - "app": only app workflows (is_evaluator=false) — default, keeps app-management behavior
 * - "evaluator": only evaluator workflows (is_evaluator=true)
 * - "all": no type filter, lists both apps and evaluators
 */
export type WorkflowTypeFilter = "all" | "app" | "evaluator"

export const workflowTypeFilterAtom = atom<WorkflowTypeFilter>("app")

/**
 * When true, restricts the list to workflows that can be invoked without human
 * input: `has_url=true` (runnable via service URL) and `is_feedback=false`
 * (not a human evaluator). Used by the evaluation-creation modal; app-management
 * leaves this off so users can still see drafts.
 */
export const workflowInvokableOnlyAtom = atom(false)
