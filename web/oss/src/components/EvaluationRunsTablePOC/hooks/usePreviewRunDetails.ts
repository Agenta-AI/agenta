import {useEffect, useMemo} from "react"

import {atom} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {evaluationRunQueryAtomFamily} from "@/oss/components/EvalRunDetails2/atoms/table/run"

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
}

export const usePreviewRunDetails = (
    runId: string | null | undefined,
    options?: UsePreviewRunDetailsOptions,
) => {
    const enabled = options?.enabled ?? true

    // Check cache first for instant display when scrolling back into view
    const cachedDetails = runId ? runDetailsCache.get(runId) : undefined

    const queryAtom = useMemo(() => {
        if (!enabled || !runId) return idleRunQueryAtom
        return evaluationRunQueryAtomFamily(runId)
    }, [enabled, runId])

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
