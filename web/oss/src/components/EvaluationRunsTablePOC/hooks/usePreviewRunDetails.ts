import {useEffect, useMemo} from "react"

import {atom} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {
    evaluationRunQueryAtomFamily,
    evaluationRunWithProjectQueryAtomFamily,
} from "@/oss/components/EvalRunDetails2/atoms/table/run"

const idleRunQueryAtom = atom({
    data: null,
    isLoading: false,
    isFetching: false,
    isPending: false,
})

/**
 * Cache for run details to provide instant display when scrolling back into view.
 */
const runDetailsCache = new Map<string, {camelRun: unknown; runIndex: unknown}>()

interface UsePreviewRunDetailsOptions {
    enabled?: boolean
    /**
     * Optional project ID. When provided, the hook will use this instead of
     * relying on the global projectIdAtom. This is useful when the global
     * atom may not be set yet (e.g., in a new browser window).
     */
    projectId?: string | null
}

export const usePreviewRunDetails = (
    runId: string | null | undefined,
    options?: UsePreviewRunDetailsOptions,
) => {
    const enabled = options?.enabled ?? true
    const projectId = options?.projectId

    // Check cache first for instant display when scrolling back into view
    const cachedDetails = runId ? runDetailsCache.get(runId) : undefined

    const queryAtom = useMemo(() => {
        if (!enabled || !runId) return idleRunQueryAtom
        // If projectId is explicitly provided, use the atom that accepts both params
        if (projectId) {
            return evaluationRunWithProjectQueryAtomFamily({runId, projectId})
        }
        // Otherwise fall back to the atom that uses the global projectIdAtom
        return evaluationRunQueryAtomFamily(runId)
    }, [enabled, runId, projectId])

    const queryResult = useAtomValueWithSchedule(queryAtom, {priority: LOW_PRIORITY})
    const data = enabled && runId ? (queryResult?.data ?? null) : null
    const queryCamelRun = data?.camelRun ?? data?.rawRun ?? null
    const queryRunIndex = data?.runIndex ?? null

    // Update cache when we get new data
    useEffect(() => {
        if (!runId || !queryCamelRun) return
        runDetailsCache.set(runId, {camelRun: queryCamelRun, runIndex: queryRunIndex})
    }, [runId, queryCamelRun, queryRunIndex])

    // Priority: fresh data > cached data > null
    const camelRun = queryCamelRun ?? cachedDetails?.camelRun ?? null
    const runIndex = queryRunIndex ?? cachedDetails?.runIndex ?? null
    const hasData = Boolean(camelRun)

    const status = useMemo(() => {
        if (!camelRun) return undefined
        const rawStatus = (camelRun as any)?.status
        if (typeof rawStatus === "string") return rawStatus
        if (typeof rawStatus?.value === "string") return rawStatus.value
        return undefined
    }, [camelRun])

    const isLoading =
        Boolean(enabled && runId) &&
        !hasData &&
        Boolean(queryResult?.isLoading || queryResult?.isFetching || queryResult?.isPending)

    return {camelRun, runIndex, status, isLoading}
}

export default usePreviewRunDetails
