/**
 * All Workflows (Union of App + Evaluator)
 *
 * Derived atoms that combine app workflows and evaluator workflows into
 * a single "all workflows" view. This avoids the previous approach of
 * fetching ALL workflows in one blanket query (which duplicated evaluator data).
 *
 * Two focused queries:
 * - `appWorkflowsListQueryAtom` → `{is_evaluator: false}` (from store.ts)
 * - `evaluatorsListQueryAtom` → `{is_evaluator: true}` (from evaluatorUtils.ts)
 *
 * Consumers that need ALL workflows (e.g., entity references, selection adapters)
 * read from these union atoms.
 *
 * @packageDocumentation
 */

import {atom} from "jotai"

import type {ListQueryState} from "../../shared"
import type {Workflow} from "../core"

import {evaluatorsListQueryAtom} from "./evaluatorUtils"
import {appWorkflowsListQueryAtom} from "./store"

// ============================================================================
// UNION ATOMS (app + evaluator)
// ============================================================================

/**
 * All workflows data (union of app + evaluator queries).
 * Replaces the old blanket `queryWorkflows({projectId})` call.
 */
export const workflowsListDataAtom = atom<Workflow[]>((get) => {
    const appQuery = get(appWorkflowsListQueryAtom)
    const evalQuery = get(evaluatorsListQueryAtom)
    const apps = appQuery.data?.workflows ?? []
    const evaluators = evalQuery.data?.workflows ?? []
    return [...apps, ...evaluators]
})

/**
 * All non-archived workflows (union of app + evaluator).
 */
export const nonArchivedWorkflowsAtom = atom<Workflow[]>((get) => {
    const workflows = get(workflowsListDataAtom)
    return workflows.filter((w) => !w.deleted_at)
})

/**
 * ListQueryState wrapper for all workflows (union of app + evaluator).
 * isPending is true if EITHER query is still loading.
 * isError is true if EITHER query has errored.
 */
export const workflowsListQueryStateAtom = atom<ListQueryState<Workflow>>((get) => {
    const appQuery = get(appWorkflowsListQueryAtom)
    const evalQuery = get(evaluatorsListQueryAtom)

    const apps = (appQuery.data?.workflows ?? []).filter((w) => !w.deleted_at)
    const evaluators = (evalQuery.data?.workflows ?? []).filter((w) => !w.deleted_at)

    return {
        data: [...apps, ...evaluators],
        isPending: (appQuery.isPending ?? false) || (evalQuery.isPending ?? false),
        isError: (appQuery.isError ?? false) || (evalQuery.isError ?? false),
        error: appQuery.error ?? evalQuery.error ?? null,
    }
})
