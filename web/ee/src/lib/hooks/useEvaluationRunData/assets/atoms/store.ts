import {createStore, getDefaultStore} from "jotai"

import {attachRunMetricsPrefetchForRun} from "./runScopedMetrics"
import {
    attachBulkPrefetchForRun,
    attachNeighbourPrefetchForRun,
    attachScenarioListPrefetchForRun,
} from "./runScopedScenarios"

/**
 * Single global Jotai store for all evaluation runs.
 * Uses run-scoped atom families instead of multiple stores.
 * This is the proper Jotai pattern for multi-entity state management.
 */
const globalStoreKey = "__agenta_globalEvalStore__"

// Create or retrieve the single global store
function createGlobalStore() {
    const store = getDefaultStore()

    return store
}

// Global singleton store that persists across HMR
const globalStore: ReturnType<typeof createStore> =
    (globalThis as any)[globalStoreKey] || createGlobalStore()
;(globalThis as any)[globalStoreKey] = globalStore

// Track which runs have been initialized to avoid duplicate subscriptions
const initializedRuns = new Set<string>()

/**
 * Returns the single global Jotai store.
 * All evaluation runs use the same store with run-scoped atom families.
 */
export function evalAtomStore(): ReturnType<typeof createStore> {
    return getDefaultStore()
}

/**
 * Initialize a run in the global store.
 * This ensures that run-scoped atoms are properly set up for the given runId.
 * Sets up run-specific subscriptions for prefetching.
 */
export function initializeRun(runId: string): void {
    if (!runId) {
        console.warn("[initializeRun] No runId provided")
        return
    }

    // Avoid duplicate initialization
    if (initializedRuns.has(runId)) {
        return
    }

    // Mark as initialized
    initializedRuns.add(runId)

    // Set up run-specific subscriptions for prefetching
    // These will work with run-scoped atom families
    try {
        // Attach scenario list prefetch to fetch scenarios when enriched run is available
        attachScenarioListPrefetchForRun(runId, globalStore)
        attachBulkPrefetchForRun(runId, globalStore)
        attachNeighbourPrefetchForRun(runId, globalStore)

        // Attach metrics prefetch to auto-fetch metrics when evaluators are available
        attachRunMetricsPrefetchForRun(runId, globalStore)
    } catch (error) {
        console.error(`[initializeRun] Error setting up subscriptions for ${runId}:`, error)
        // Remove from initialized set if setup failed
        initializedRuns.delete(runId)
    }
}
