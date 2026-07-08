import {
    readPersistedAgentType,
    workflowAppTypeAtomFamily,
    workflowDetailQueryAtomFamily,
    type Workflow,
    type WorkflowFlags,
} from "@agenta/entities/workflow"
import {atom} from "jotai"

import {routerAppIdAtom} from "@/oss/state/app/atoms/fetcher"

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
export const currentWorkflowAtom = atom<Workflow | null>(
    (get) => get(currentWorkflowContextAtom).workflow,
)

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

    // Resolve THIS ONE workflow by id (app or evaluator) — instead of listing
    // every app AND every evaluator in the project just to look one up. The by-id
    // artifact carries name + role flags (`is_application`/`is_evaluator`), so it's
    // enough to classify the current workflow.
    const detail = get(workflowDetailQueryAtomFamily(id))
    if (detail.isPending) {
        return {
            workflow: null,
            workflowId: id,
            workflowKind: null,
            isResolving: true,
            isNotFound: false,
            isError: false,
        }
    }
    if (detail.isError) {
        return {
            workflow: null,
            workflowId: id,
            workflowKind: null,
            isResolving: false,
            isNotFound: false,
            isError: true,
        }
    }

    // The shared by-id query includes archived workflows (so app-state can resolve
    // archived apps off the same request). Treat archived as not-found here to
    // preserve this atom's non-archived contract — the old list-based resolution
    // read non-archived lists, so an archived id reported `isNotFound`.
    const workflow = (detail.data ?? null) as (Workflow & {deleted_at?: string | null}) | null
    if (!workflow || workflow.deleted_at) {
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

/**
 * Early, app-id-keyed agent signal for the playground shell/header/layout.
 *
 * The node-derived `isAgentModeAtomFamily(rootEntityId)` only resolves after the
 * heavy playground graph + root revision load, so the layout would default to the
 * non-agent (prompt) chrome and flip once it turns out to be an agent — mounting
 * then unmounting the eval stack. This reads the lightweight latest-revision query
 * (already warmed by the sidebar) keyed by the URL app id, giving a definitive
 * answer *before* the graph resolves.
 *
 * "unknown" = no app in URL (project-level) OR the latest-revision query still
 * pending AND nothing persisted from a prior session. Consumers render neutral
 * chrome while unknown, committing to the agent or prompt layout only once confirmed.
 */
export type PlaygroundAgentState = "agent" | "non-agent" | "unknown"

export const playgroundEarlyAgentStateAtom = atom<PlaygroundAgentState>((get) => {
    const appId = get(routerAppIdAtom)
    if (!appId) return "unknown"
    const appType = get(workflowAppTypeAtomFamily(appId))
    if (appType != null) return appType === "agent" ? "agent" : "non-agent"
    // Live query still pending on a cold reload — fall back to the last-known type persisted from a
    // prior session (see persistedAgentType) so the layout commits immediately instead of flashing
    // neutral/non-agent chrome. The live query rewrites the entry, so a stale value self-heals.
    const cached = readPersistedAgentType(appId)
    if (cached) return cached === "agent" ? "agent" : "non-agent"
    return "unknown"
})
