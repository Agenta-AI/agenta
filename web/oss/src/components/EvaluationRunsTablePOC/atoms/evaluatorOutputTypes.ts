import {canonicalizeMetricKey} from "@/oss/lib/metricUtils"

/**
 * Module-level cache for evaluator output types.
 * This is used instead of Jotai atoms because the table component uses its own Jotai store,
 * which means atoms set inside the table are not visible outside.
 * Key format: `${projectId}:${evaluatorSlug}`
 */
const outputTypesCache = new Map<string, Map<string, string | null>>()

/**
 * Listeners for output types changes.
 */
const outputTypesListeners = new Map<string, Set<() => void>>()

/**
 * Version counter to track changes and trigger re-renders.
 */
let globalVersion = 0

/**
 * Creates a key for the evaluator output types cache.
 */
export const createEvaluatorOutputTypesKey = (
    projectId: string | null,
    evaluatorSlug: string | null,
): string => {
    return `${projectId ?? "none"}:${evaluatorSlug ?? "none"}`
}

/**
 * Gets the output types map for a given key.
 */
export const getOutputTypesMap = (key: string): Map<string, string | null> => {
    return outputTypesCache.get(key) ?? new Map()
}

/** Same keys, same values — a rebuilt map with identical content is not a change. */
const sameOutputTypes = (
    a: Map<string, string | null> | undefined,
    b: Map<string, string | null>,
): boolean => {
    if (a === b) return true
    if (!a || a.size !== b.size) return false
    for (const [key, value] of a) {
        if (!b.has(key) || b.get(key) !== value) return false
    }
    return true
}

/**
 * Sets the output types map for a given key and notifies listeners.
 *
 * The equality check is load-bearing, not an optimisation. Callers rebuild the map from an
 * evaluator's schema on render and hand over a NEW Map with the SAME content every time.
 * `useEvaluationRunsColumns` subscribes here and its listener calls `setOutputTypesVersion`,
 * so notifying unconditionally meant: write -> notify -> setState -> re-render -> the caller
 * rebuilds the map and writes again -> notify... React stopped that with "Maximum update depth
 * exceeded" (error #185) and the `/evaluations` list page died.
 *
 * The loop needed evaluator METRIC columns to exist, because the only caller is the metric
 * group header — which is why it reproduced solely on runs whose `data.mappings` produce
 * metric columns, and never on an empty project.
 */
export const setOutputTypesMap = (key: string, map: Map<string, string | null>): void => {
    if (sameOutputTypes(outputTypesCache.get(key), map)) {
        // Keep the cached instance: replacing it with an equal one would hand subscribers a
        // new identity for no reason.
        return
    }

    outputTypesCache.set(key, map)
    globalVersion += 1

    // Notify listeners
    const listeners = outputTypesListeners.get(key)
    if (listeners) {
        listeners.forEach((listener) => listener())
    }
}

/**
 * Subscribes to changes for a given key.
 * Returns an unsubscribe function.
 */
export const subscribeToOutputTypes = (key: string, listener: () => void): (() => void) => {
    let listeners = outputTypesListeners.get(key)
    if (!listeners) {
        listeners = new Set()
        outputTypesListeners.set(key, listeners)
    }
    listeners.add(listener)

    return () => {
        listeners?.delete(listener)
        if (listeners?.size === 0) {
            outputTypesListeners.delete(key)
        }
    }
}

/**
 * Gets the current global version (for dependency tracking).
 */
export const getOutputTypesVersion = (): number => {
    return globalVersion
}

/**
 * Checks if a metric output type is a string type that should be filtered out.
 */
export const isStringOutputType = (outputType: string | null | undefined): boolean => {
    if (!outputType) return false
    const normalized = outputType.toLowerCase()
    return normalized === "string"
}

/**
 * Checks if a metric should be visible based on its output type from the cache.
 */
export const isMetricVisibleByOutputType = (
    metricPath: string,
    outputTypesMap: Map<string, string | null>,
): boolean => {
    const canonicalPath = canonicalizeMetricKey(metricPath)
    const outputType = outputTypesMap.get(canonicalPath)
    // If we don't have output type info, show the column (don't filter)
    if (outputType === undefined) return true
    return !isStringOutputType(outputType)
}
