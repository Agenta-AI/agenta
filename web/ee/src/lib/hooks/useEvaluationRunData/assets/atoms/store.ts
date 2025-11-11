import {createStore} from "jotai"

// Global cache for Jotai stores keyed by runId, persists across HMR (survives HMR)
export const globalKey = "__agenta_jotaiStoreCache__"
export const jotaiStoreCache: Map<string, ReturnType<typeof createStore>> = (globalThis as any)[
    globalKey
] || new Map()
;(globalThis as any)[globalKey] = jotaiStoreCache

// Currently active Jotai store key (per evaluation run)
const globalActiveStoreKey = "__agenta_jotaiActiveStoreKey__"
let activeStoreKey: string | null = (globalThis as any)[globalActiveStoreKey] || null

import {attachRunMetricsPrefetch} from "./runMetricsCache"
import {attachScenarioListPrefetch} from "./scenarioList"
import {attachNeighbourPrefetch, attachBulkPrefetch} from "./scenarios"

/**
 * Returns the active Jotai store for the evaluation run. Falls back to a
 * default store so callers never get undefined.
 */
export function evalAtomStore(): ReturnType<typeof createStore> {
    if (activeStoreKey && jotaiStoreCache.has(activeStoreKey)) {
        return jotaiStoreCache.get(activeStoreKey)!
    }
    // Fallback – create a default singleton store (mainly for SSR / initial load)
    if (!jotaiStoreCache.has("default")) {
        jotaiStoreCache.set("default", createStore())
    }
    return jotaiStoreCache.get("default")!
}

export function setActiveStoreKey(runId: string) {
    activeStoreKey = runId
    ;(globalThis as any)[globalActiveStoreKey] = runId

    // Ensure store exists and attach bulk prefetch logic once
    if (!jotaiStoreCache.has(runId)) {
        const store = createStore()
        jotaiStoreCache.set(runId, store)
        attachBulkPrefetch(store)
        attachNeighbourPrefetch(store)
        attachScenarioListPrefetch(store)
        attachRunMetricsPrefetch(store)
    }

    return jotaiStoreCache.get(runId)!
}

export function getActiveStoreKey() {
    return activeStoreKey
}
