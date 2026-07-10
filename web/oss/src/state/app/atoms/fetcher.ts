import {
    appWorkflowsListQueryAtom,
    nonArchivedAppWorkflowsAtom,
    workflowDetailQueryAtomFamily,
} from "@agenta/entities/workflow"
import type {Workflow} from "@agenta/entities/workflow"
import {stringStorage} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import {appIdentifiersAtom, appStateSnapshotAtom, requestNavigationAtom} from "@/oss/state/appState"

import {LS_APP_KEY} from "../assets/constants"

const baseRouterAppIdAtom = atom<string | null>(null)

const shouldResetEvaluationContextOnAppSwitch = ({
    restPath,
    pathname,
}: {
    restPath: string[]
    pathname: string
}) =>
    (restPath[0] === "evaluations" && restPath[1] === "results") ||
    pathname.includes("/evaluations/results")

export const routerAppIdAtom = atom(
    (get) => {
        const derived = get(appIdentifiersAtom).appId
        if (derived) return derived
        const fallback = get(baseRouterAppIdAtom)
        if (fallback) return fallback
        if (typeof process !== "undefined" && process.env.NODE_ENV === "test") {
            return process.env.VITEST_TEST_APP_ID || process.env.TEST_APP_ID || null
        }
        return null
    },
    (get, set, update: string | null) => {
        const next =
            typeof update === "function" ? (update as any)(get(baseRouterAppIdAtom)) : update
        set(baseRouterAppIdAtom, next)
    },
)

// Builds the href an app switch would navigate to. Shared by the imperative
// navigation atom below and by anchors that expose the same target as a real
// link (middle-click / open-in-new-tab in the workflow switcher).
export const appSwitchHrefAtom = atom((get) => {
    const {workspaceId, projectId} = get(appIdentifiersAtom)
    const snapshot = get(appStateSnapshotAtom)

    return (next: string): string | null => {
        if (!workspaceId || !projectId) return null

        const base = `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}/apps/${encodeURIComponent(next)}`
        const rest = snapshot.routeLayer === "app" ? snapshot.restPath : []
        const nextRest = shouldResetEvaluationContextOnAppSwitch({
            restPath: rest,
            pathname: snapshot.pathname,
        })
            ? ["evaluations"]
            : rest
        return nextRest.length ? `${base}/${nextRest.join("/")}` : `${base}/overview`
    }
})

export const routerAppNavigationAtom = atom(null, (get, set, next: string | null) => {
    const identifiers = get(appIdentifiersAtom)
    const {workspaceId, projectId, appId: current} = identifiers
    if (!workspaceId || !projectId) return

    if (!next) {
        const href = `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}/apps`
        set(requestNavigationAtom, {type: "href", href, method: "replace"})
        return
    }

    if (next === current) return

    const href = get(appSwitchHrefAtom)(next)
    if (!href) return
    set(requestNavigationAtom, {type: "href", href, method: "push"})
})

export const recentAppIdAtom = atomWithStorage<string | null>(LS_APP_KEY, null, stringStorage)

export const currentAppQueryAtom = atom((get) => {
    const appId = get(routerAppIdAtom) || get(recentAppIdAtom)
    // Resolve via the SHARED by-id workflow query (`workflowDetailQueryAtomFamily`)
    // so app-state dedupes with workflow-state (`currentWorkflowContextAtom`),
    // which reads the same family for the same id. Previously this was a separate
    // `atomWithQuery` with its own key + `include_archived`, so the current
    // workflow was fetched TWICE on every app page (once per state tree).
    return get(workflowDetailQueryAtomFamily(appId))
})

interface WorkflowListQueryState {
    data?: Workflow[]
    isPending?: boolean
    isLoading?: boolean
    isFetching?: boolean
    isError?: boolean
    error?: Error | null
    refetch?: () => unknown
}

// ============================================================================
// APPS QUERY (derived from entity workflow list)
// ============================================================================

/**
 * Apps query atom — derives from entity `appWorkflowsListQueryAtom`.
 *
 * Returns `Workflow[]` directly from the entity layer (non-evaluator, non-archived).
 */
export const appsQueryAtom = atom((get) => {
    const query = get(appWorkflowsListQueryAtom) as WorkflowListQueryState
    const workflows = get(nonArchivedAppWorkflowsAtom)

    return {
        data: workflows,
        isPending: query.isPending ?? false,
        isLoading: query.isLoading ?? query.isPending,
        isFetching: query.isFetching ?? false,
        isError: query.isError ?? false,
        isSuccess: !query.isPending && !query.isError,
        error: query.error ?? null,
        refetch: query.refetch,
    }
})
