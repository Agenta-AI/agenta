import {atom} from "jotai"

/** Search term for filtering app workflows by name */
export const appWorkflowSearchTermAtom = atom("")

/**
 * Type filter for the shared workflow paginated store.
 *
 * High-level roles:
 * - "all": no type filter, lists both apps and evaluators
 * - "app": only app workflows (is_evaluator=false)
 * - "evaluator": only evaluator workflows (is_evaluator=true)
 *
 * App subtypes (is_evaluator=false):
 * - "chat": is_chat=true apps
 * - "completion": apps that are neither chat nor custom (derived type)
 * - "custom": is_custom=true apps
 *
 * Evaluator subtypes (is_evaluator=true):
 * - "llm": AI/LLM-based evaluators (e.g. LLM-as-judge)
 * - "match": pattern/classifier/similarity matchers
 * - "code": custom-code evaluators
 * - "hook": webhook evaluators
 */
export type WorkflowTypeFilter =
    | "all"
    | "app"
    | "evaluator"
    | "chat"
    | "completion"
    | "custom"
    | "llm"
    | "match"
    | "code"
    | "hook"

export const workflowTypeFilterAtom = atom<WorkflowTypeFilter>("app")

/**
 * When true, restricts the list to workflows that can be invoked without human
 * input: `has_url=true` (runnable via service URL) and `is_feedback=false`
 * (not a human evaluator). Used by the evaluation-creation modal; app-management
 * leaves this off so users can still see drafts.
 */
export const workflowInvokableOnlyAtom = atom(false)
