import {useEffect, useMemo} from "react"

import {
    appWorkflowsListQueryAtom,
    evaluatorsListQueryAtom,
    nonArchivedAppWorkflowsAtom,
    nonArchivedEvaluatorsAtom,
    type Workflow,
} from "@agenta/entities/workflow"
import {useAtom, useAtomValue} from "jotai"

import {useAppState} from "@/oss/state/appState"

import {recentEvaluatorIdAtom, workflowsByIdMapAtom} from "./atoms/fetcher"
import {currentWorkflowAtom, currentWorkflowContextAtom} from "./selectors/workflow"

/**
 * Workflow-typed analog of `useAppsData()`. Returns combined workflows (apps +
 * evaluators) plus per-type slices, current workflow, and loading state.
 *
 * **Authoritative-write rule (eng review decision, see Eng Review Outcome
 * section in design doc):** this hook writes ONLY to `recentEvaluatorIdAtom`
 * (when current workflow is an evaluator). It NEVER writes
 * `recentAppIdAtom` — that remains the sole responsibility of `useAppsData()`
 * to prevent duplicate writes / race conditions when both hooks mount on the
 * same page.
 */
export const useWorkflowsData = () => {
    const map = useAtomValue(workflowsByIdMapAtom)
    const apps = useAtomValue(nonArchivedAppWorkflowsAtom)
    const evaluators = useAtomValue(nonArchivedEvaluatorsAtom)
    const appsQuery = useAtomValue(appWorkflowsListQueryAtom)
    const evalsQuery = useAtomValue(evaluatorsListQueryAtom)
    const currentWorkflow = useAtomValue(currentWorkflowAtom)
    const ctx = useAtomValue(currentWorkflowContextAtom)
    const [recentEvaluatorId, setRecentEvaluatorId] = useAtom(recentEvaluatorIdAtom)
    const {appId, routeLayer} = useAppState()

    // Write recentEvaluatorIdAtom when on an app-level route (/apps/[id]/...)
    // AND the resolved workflow is an evaluator. Mirrors the cadence of
    // useAppsData's recent-id effect ([state/app/hooks.ts:14,26]) so behavior
    // is consistent: per-render-with-match, no id-change gate.
    useEffect(() => {
        if (!appId) return
        if (routeLayer !== "app") return
        if (ctx.isResolving) return
        if (ctx.workflowKind !== "evaluator") return
        if (ctx.workflowId !== appId) return
        if (recentEvaluatorId !== appId) {
            setRecentEvaluatorId(appId)
        }
    }, [
        appId,
        routeLayer,
        ctx.isResolving,
        ctx.workflowKind,
        ctx.workflowId,
        recentEvaluatorId,
        setRecentEvaluatorId,
    ])

    // Drop a stale recentEvaluatorId if the underlying evaluators list no
    // longer contains it (deleted in another tab, etc.). Mirrors useAppsData's
    // second effect at [state/app/hooks.ts:34].
    useEffect(() => {
        if (!recentEvaluatorId) return
        if (map.isLoading) return
        if (!map.data.has(recentEvaluatorId)) {
            setRecentEvaluatorId(null)
        }
    }, [map.data, map.isLoading, recentEvaluatorId, setRecentEvaluatorId])

    const result = useMemo(
        () => ({
            // Combined workflow lookup: O(1) by ID, includes both apps and
            // evaluators. Use this when an ID may be either kind.
            workflowsById: map.data as ReadonlyMap<string, Workflow>,
            // Per-type slices (already filtered for is_archived).
            apps: apps as readonly Workflow[],
            evaluators: evaluators as readonly Workflow[],
            // Current workflow + classification.
            currentWorkflow: currentWorkflow ?? null,
            workflowKind: ctx.workflowKind,
            isApp: ctx.workflowKind === "app",
            isEvaluator: ctx.workflowKind === "evaluator",
            isSnippet: ctx.workflowKind === "snippet",
            // Terminal states (mutually exclusive).
            isResolving: ctx.isResolving,
            isNotFound: ctx.isNotFound,
            isError: ctx.isError,
            // Aggregate loading from underlying queries (TanStack v5 isPending).
            isLoading: map.isLoading,
            // Per-type recent-id (read only — write is internal to this hook).
            recentlyVisitedEvaluatorId: recentEvaluatorId,
            // Refetch handles per source.
            refetchApps: appsQuery.refetch,
            refetchEvaluators: evalsQuery.refetch,
        }),
        [
            map.data,
            map.isLoading,
            apps,
            evaluators,
            currentWorkflow,
            ctx.workflowKind,
            ctx.isResolving,
            ctx.isNotFound,
            ctx.isError,
            recentEvaluatorId,
            appsQuery.refetch,
            evalsQuery.refetch,
        ],
    )

    return result
}

/**
 * Convenience read-only hook — current workflow record only.
 */
export const useCurrentWorkflow = () => useAtomValue(currentWorkflowAtom)
