import {useEffect, useMemo, useRef} from "react"

import {atom} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {
    previewRunMetricStatsSelectorFamily,
    type RunLevelMetricSelection,
} from "@/oss/components/Evaluations/atoms/runMetrics"

const idleMetricSelectionAtom = atom<RunLevelMetricSelection>({
    state: "loading",
})

/**
 * Cache for metric selections keyed by a composite string.
 * This allows cells that scroll out of view and back to instantly
 * display their previously fetched data without re-triggering loading states.
 */
const metricSelectionCache = new Map<string, RunLevelMetricSelection>()

const buildCacheKey = (
    runId: string,
    metricKey?: string,
    metricPath?: string,
    stepKey?: string,
): string => `${runId}|${metricKey ?? ""}|${metricPath ?? ""}|${stepKey ?? ""}`

interface UseRunMetricSelectionArgs {
    runId: string | null | undefined
    metricKey?: string
    metricPath?: string
    stepKey?: string
}

interface UseRunMetricSelectionOptions {
    enabled?: boolean
    debugLabel?: string
}

export const useRunMetricSelection = (
    {runId, metricKey, metricPath, stepKey}: UseRunMetricSelectionArgs,
    {enabled = true}: UseRunMetricSelectionOptions = {},
) => {
    const cacheKey = useMemo(
        () => (runId ? buildCacheKey(runId, metricKey, metricPath, stepKey) : null),
        [runId, metricKey, metricPath, stepKey],
    )

    // Check cache first for instant display when scrolling back into view
    const cachedSelection = cacheKey ? metricSelectionCache.get(cacheKey) : undefined

    const metricAtom = useMemo(() => {
        if (!enabled || !runId) {
            return idleMetricSelectionAtom
        }
        return previewRunMetricStatsSelectorFamily({
            runId,
            metricKey,
            metricPath,
            stepKey,
            includeTemporal: false,
        })
    }, [enabled, runId, metricKey, metricPath, stepKey])

    const lastSelectionRef = useRef<RunLevelMetricSelection>(cachedSelection ?? {state: "loading"})
    const selection = useAtomValueWithSchedule(metricAtom, {priority: LOW_PRIORITY})

    // Update cache when we get new data
    useEffect(() => {
        if (!enabled || !cacheKey) return
        if (!selection || selection.state !== "hasData") return

        // Only cache successful data fetches
        metricSelectionCache.set(cacheKey, selection)
        lastSelectionRef.current = selection
    }, [enabled, cacheKey, selection])

    // Reset ref when params change but preserve cache lookup
    useEffect(() => {
        if (!runId) {
            lastSelectionRef.current = {state: "hasData", stats: undefined, resolvedKey: undefined}
        } else if (cachedSelection) {
            lastSelectionRef.current = cachedSelection
        } else {
            lastSelectionRef.current = {state: "loading"}
        }
    }, [runId, metricKey, metricPath, stepKey, cachedSelection])

    if (!enabled) {
        return lastSelectionRef.current
    }

    // Priority order for returning data:
    // 1. If atom has real data, use it (most up-to-date)
    // 2. If cache has data, use it immediately (prevents blank during scroll)
    // 3. Fall back to loading state
    if (selection?.state === "hasData") {
        return selection
    }

    if (cachedSelection?.state === "hasData") {
        return cachedSelection
    }

    return selection ?? {state: "loading"}
}

/**
 * Clear the metric selection cache. Useful when data needs to be refreshed.
 */
export const clearMetricSelectionCache = () => {
    metricSelectionCache.clear()
}

/**
 * Remove a specific entry from the cache.
 */
export const invalidateMetricSelectionCache = (
    runId: string,
    metricKey?: string,
    metricPath?: string,
    stepKey?: string,
) => {
    const key = buildCacheKey(runId, metricKey, metricPath, stepKey)
    metricSelectionCache.delete(key)
}

export default useRunMetricSelection
