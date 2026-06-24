import {useEffect, useMemo} from "react"

import {atom} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {previewRunSummaryAtomFamily, type PreviewRunSummary} from "../atoms/runSummaries"

const defaultPreviewSummaryQueryAtom = atom(() => ({
    data: null as PreviewRunSummary | null,
    isLoading: false,
    isFetching: false,
    isPending: false,
}))

/**
 * Cache for run summaries to provide instant display when scrolling back into view.
 */
const summaryCache = new Map<string, PreviewRunSummary>()

const buildCacheKey = (projectId: string, runId: string) => `${projectId}|${runId}`

interface UsePreviewRunSummaryOptions {
    enabled?: boolean
}

export const usePreviewRunSummary = (
    {
        projectId,
        runId,
    }: {
        projectId: string | null
        runId: string | null
    },
    options?: UsePreviewRunSummaryOptions,
) => {
    const enabled = options?.enabled ?? true

    // Check cache first for instant display when scrolling back into view
    const cacheKey = projectId && runId ? buildCacheKey(projectId, runId) : null
    const cachedSummary = cacheKey ? summaryCache.get(cacheKey) : undefined

    const summaryAtom = useMemo(() => {
        if (!enabled || !projectId || !runId) return defaultPreviewSummaryQueryAtom
        return previewRunSummaryAtomFamily({projectId, runId})
    }, [enabled, projectId, runId])

    const summaryQuery = useAtomValueWithSchedule(summaryAtom, {priority: LOW_PRIORITY})
    const querySummary = enabled && projectId && runId ? (summaryQuery?.data ?? null) : null

    // Update cache when we get new data
    useEffect(() => {
        if (!cacheKey || !querySummary) return
        summaryCache.set(cacheKey, querySummary)
    }, [cacheKey, querySummary])

    // Priority: fresh data > cached data > null
    const summary = querySummary ?? cachedSummary ?? null
    const hasSummary = Boolean(summary)
    const isLoading = Boolean(
        enabled &&
        projectId &&
        runId &&
        !hasSummary &&
        (summaryQuery?.isLoading || summaryQuery?.isFetching || summaryQuery?.isPending),
    )

    const stepReferences = summary?.stepReferences as Record<string, unknown> | undefined
    const testsetNames = summary?.testsetNames as Record<string, string | null> | undefined

    return {summary, testsetNames, stepReferences, isLoading}
}

export default usePreviewRunSummary
