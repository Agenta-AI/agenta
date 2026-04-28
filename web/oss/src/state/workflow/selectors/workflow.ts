import type {Workflow, WorkflowFlags} from "@agenta/entities/workflow"
import {atom} from "jotai"

import {routerAppIdAtom} from "@/oss/state/app/atoms/fetcher"

import {workflowsByIdMapAtom} from "../atoms/fetcher"
import type {WorkflowKind} from "../destinations"

/**
 * Derive `workflowKind` from a workflow's role flags.
 *
 * **Eng review decision 1.1:** `is_evaluator` is canonical. A workflow with
 * both `is_application: true AND is_evaluator: true` classifies as `"evaluator"`
 * because the design explicitly DISABLES 4 sub-routes for evaluators — the
 * more-restrictive UX path is the safer default.
 *
 * Logs a dev-mode warning when multiple role flags are set so we can find
 * such workflows at the data layer.
 */
export function deriveWorkflowKind(flags: WorkflowFlags | null | undefined): WorkflowKind | null {
    if (!flags) return null

    const isApp = !!flags.is_application
    const isEval = !!flags.is_evaluator
    const isSnippet = !!flags.is_snippet

    if (process.env.NODE_ENV !== "production") {
        const setCount = Number(isApp) + Number(isEval) + Number(isSnippet)
        if (setCount > 1) {
            console.warn(
                "[workflow-kind] multi-flag workflow detected",
                {is_application: isApp, is_evaluator: isEval, is_snippet: isSnippet},
                "— classifying as 'evaluator' (is_evaluator is canonical)",
            )
        }
    }

    if (isEval) return "evaluator"
    if (isApp) return "app"
    if (isSnippet) return "snippet"
    return null
}

/**
 * Look up the current workflow by ID from the URL.
 *
 * Returns `Workflow | null`. **`null` does NOT distinguish "not loaded" from
 * "not found"** — callers should read terminal state via
 * `currentWorkflowContextAtom` (which exposes `isResolving` / `isNotFound` /
 * `isError`).
 */
export const currentWorkflowAtom = atom<Workflow | null>((get) => {
    const id = get(routerAppIdAtom)
    if (!id) return null
    const {data, isLoading} = get(workflowsByIdMapAtom)
    if (isLoading) return null
    return data.get(id) ?? null
})

/**
 * Minimal context shape for current workflow (eng review decision 2.1).
 *
 * 6 fields: 3 data + 3 terminal-state booleans. Convenience booleans like
 * `isApp` / `isEvaluator` are NOT exposed — consumers compare
 * `workflowKind === "evaluator"` inline. Dropping derivable fields prevents
 * the same fact being read via multiple paths.
 *
 * Terminal states are mutually exclusive in the steady state:
 *  - `isResolving: true` — at least one underlying query still pending; do not
 *    render content, do not redirect.
 *  - `isError: true` — both queries settled but at least one returned an error.
 *    Render an error fallback rather than redirecting (over-render is safer
 *    than wrong-redirect).
 *  - `isNotFound: true` — both queries settled, ID not in map.
 *  - none of the above + `workflow != null` — workflow loaded; render normally.
 */
export interface CurrentWorkflowContext {
    workflow: Workflow | null
    workflowId: string | null
    workflowKind: WorkflowKind | null
    isResolving: boolean
    isNotFound: boolean
    isError: boolean
}

export const currentWorkflowContextAtom = atom<CurrentWorkflowContext>((get) => {
    const id = get(routerAppIdAtom)
    const {data, isLoading, isError} = get(workflowsByIdMapAtom)

    if (!id) {
        return {
            workflow: null,
            workflowId: null,
            workflowKind: null,
            isResolving: false,
            isNotFound: false,
            isError: false,
        }
    }

    if (isLoading) {
        return {
            workflow: null,
            workflowId: id,
            workflowKind: null,
            isResolving: true,
            isNotFound: false,
            isError: false,
        }
    }

    if (isError) {
        return {
            workflow: null,
            workflowId: id,
            workflowKind: null,
            isResolving: false,
            isNotFound: false,
            isError: true,
        }
    }

    const workflow = data.get(id) ?? null
    if (!workflow) {
        return {
            workflow: null,
            workflowId: id,
            workflowKind: null,
            isResolving: false,
            isNotFound: true,
            isError: false,
        }
    }

    return {
        workflow,
        workflowId: id,
        workflowKind: deriveWorkflowKind(workflow.flags),
        isResolving: false,
        isNotFound: false,
        isError: false,
    }
})
