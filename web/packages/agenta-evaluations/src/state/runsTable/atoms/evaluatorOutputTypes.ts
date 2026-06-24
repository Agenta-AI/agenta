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

/**
 * Sets the output types map for a given key and notifies listeners.
 */
export const setOutputTypesMap = (key: string, map: Map<string, string | null>): void => {
    outputTypesCache.set(key, map)

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
 * Checks if a metric output type is a string type that should be filtered out.
 */
export const isStringOutputType = (outputType: string | null | undefined): boolean => {
    if (!outputType) return false
    const normalized = outputType.toLowerCase()
    return normalized === "string"
}
