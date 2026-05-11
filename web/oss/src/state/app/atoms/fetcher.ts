import {
    appWorkflowsListQueryAtom,
    nonArchivedAppWorkflowsAtom,
    queryWorkflows,
} from "@agenta/entities/workflow"
import type {Workflow} from "@agenta/entities/workflow"
import {projectIdAtom, sessionAtom, stringStorage} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

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

    const base = `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}/apps/${encodeURIComponent(next)}`
    const snapshot = get(appStateSnapshotAtom)
    const rest = snapshot.routeLayer === "app" ? snapshot.restPath : []
    const nextRest = shouldResetEvaluationContextOnAppSwitch({
        restPath: rest,
        pathname: snapshot.pathname,
    })
        ? ["evaluations"]
        : rest
    const href = nextRest.length ? `${base}/${nextRest.join("/")}` : `${base}/overview`
    set(requestNavigationAtom, {type: "href", href, method: "push"})
})

export const recentAppIdAtom = atomWithStorage<string | null>(LS_APP_KEY, null, stringStorage)

export const currentAppQueryAtom = atomWithQuery<Workflow | null>((get) => {
    const projectId = get(projectIdAtom)
    const appId = get(routerAppIdAtom) || get(recentAppIdAtom)
    const liveApps = get(nonArchivedAppWorkflowsAtom)
    const liveApp = appId ? (liveApps.find((app) => app.id === appId) ?? null) : null

    return {
        queryKey: ["currentApp", projectId, appId],
        queryFn: async () => {
            if (!projectId || !appId) return null

            const response = await queryWorkflows({
                projectId,
                workflowRefs: [{id: appId}],
                includeArchived: true,
            })

            return response.workflows.find((workflow) => workflow.id === appId) ?? null
        },
        enabled: get(sessionAtom) && !!projectId && !!appId && !liveApp,
        initialData: liveApp ?? undefined,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    }
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
