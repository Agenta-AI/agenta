/**
 * Environment Utility Atoms
 *
 * Utility atoms for environment management:
 * - Prefetch and refresh utilities
 * - Network request tracking
 * - Performance monitoring
 * - Cache management
 */

import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"

import {queryClient} from "@/oss/lib/api/queryClient"
import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"

import {environmentsQueryAtom, environmentsLoadingAtom, environmentsErrorAtom} from "./environments"

// ============================================================================
// Network Request Tracking
// ============================================================================

/**
 * Network request counter for environments
 */
class EnvironmentNetworkTracker {
    private requestCount = 0
    private lastRequestTime: Date | null = null
    private requestHistory: {
        timestamp: Date
        type: "fetch" | "mutation"
        success: boolean
        duration?: number
    }[] = []

    incrementRequest(type: "fetch" | "mutation", success = true, duration?: number) {
        this.requestCount++
        this.lastRequestTime = new Date()

        this.requestHistory.unshift({
            timestamp: this.lastRequestTime,
            type,
            success,
            duration,
        })

        // Keep only last 50 requests
        if (this.requestHistory.length > 50) {
            this.requestHistory = this.requestHistory.slice(0, 50)
        }
    }

    getStats() {
        const recentRequests = this.requestHistory.slice(0, 10)
        const successfulRequests = recentRequests.filter((r) => r.success).length
        const failedRequests = recentRequests.length - successfulRequests

        return {
            totalRequests: this.requestCount,
            lastRequestTime: this.lastRequestTime,
            recentRequests: recentRequests.length,
            successfulRequests,
            failedRequests,
            successRate:
                recentRequests.length > 0 ? (successfulRequests / recentRequests.length) * 100 : 0,
            averageDuration:
                recentRequests
                    .filter((r) => r.duration)
                    .reduce((sum, r) => sum + (r.duration || 0), 0) /
                Math.max(recentRequests.filter((r) => r.duration).length, 1),
        }
    }

    reset() {
        this.requestCount = 0
        this.lastRequestTime = null
        this.requestHistory = []
    }
}

const environmentNetworkTracker = new EnvironmentNetworkTracker()

/**
 * Environment network statistics atom
 */
export const environmentNetworkStatsAtom = atom(() => environmentNetworkTracker.getStats())

// ============================================================================
// Prefetch and Refresh Utilities
// ============================================================================

/**
 * Environment prefetch atom
 * Triggers environment data loading without subscribing to results
 */
export const environmentsPrefetchAtom = atom((get) => {
    const loadable = get(environmentsQueryAtom)

    // Track the request
    if (loadable) {
        const isLoading = (loadable as any)?.isLoading
        const error = (loadable as any)?.error

        if (!isLoading) {
            environmentNetworkTracker.incrementRequest("fetch", !error)
        }
    }

    return loadable
})

/**
 * Environment refresh atom (write-only)
 * Manually triggers environment data refresh
 */
export const environmentsRefreshAtom = atom(null, async (get, set) => {
    const appId = get(selectedAppIdAtom)

    if (!appId) {
        console.warn("Cannot refresh environments: no app selected")
        return
    }

    try {
        // Invalidate and refetch environments
        await queryClient.invalidateQueries({
            queryKey: ["newEnvironments", appId],
        })

        // Track successful refresh
        environmentNetworkTracker.incrementRequest("fetch", true)

        console.log("Environment data refreshed successfully")
    } catch (error) {
        console.error("Failed to refresh environment data:", error)
        environmentNetworkTracker.incrementRequest("fetch", false)
    }
})

/**
 * Environment cache invalidation atom (write-only)
 * Clears all environment-related cache entries
 */
export const environmentsCacheInvalidateAtom = atom(null, async (get, set) => {
    try {
        // Invalidate all environment-related queries
        await Promise.all([
            queryClient.invalidateQueries({queryKey: ["newEnvironments"]}),
            queryClient.invalidateQueries({queryKey: ["environments"]}),
            queryClient.invalidateQueries({queryKey: ["environmentDeploymentHistory"]}),
            queryClient.invalidateQueries({queryKey: ["environmentsSkeleton"]}),
        ])

        console.log("Environment cache cleared successfully")
    } catch (error) {
        console.error("Failed to clear environment cache:", error)
    }
})

// ============================================================================
// Performance Monitoring
// ============================================================================

/**
 * Environment performance metrics atom
 */
export const environmentPerformanceAtom = selectAtom(
    atom((get) => ({
        loading: get(environmentsLoadingAtom),
        error: get(environmentsErrorAtom),
        networkStats: get(environmentNetworkStatsAtom),
        queryState: get(environmentsQueryAtom),
    })),
    ({loading, error, networkStats, queryState}) => {
        const queryInfo = queryState as any

        return {
            isLoading: loading,
            hasError: !!error,
            errorMessage: error?.message || null,

            // Network performance
            totalRequests: networkStats.totalRequests,
            successRate: networkStats.successRate,
            averageResponseTime: networkStats.averageDuration,
            lastRequestTime: networkStats.lastRequestTime,

            // Query performance
            isFetching: queryInfo?.isFetching || false,
            isStale: queryInfo?.isStale || false,
            dataUpdatedAt: queryInfo?.dataUpdatedAt || null,

            // Cache performance
            cacheHit: queryInfo?.isStale === false && !queryInfo?.isFetching,
            cacheStatus: queryInfo?.status || "idle",

            // Performance score (0-100)
            performanceScore: Math.min(
                100,
                Math.max(
                    0,
                    networkStats.successRate * 0.4 +
                        (networkStats.averageDuration < 1000 ? 60 : 30) +
                        (loading ? 0 : 10),
                ),
            ),
        }
    },
    deepEqual,
)

// ============================================================================
// Auto-refresh and Polling
// ============================================================================

/**
 * Environment auto-refresh interval atom
 */
export const environmentAutoRefreshIntervalAtom = atom(5 * 60 * 1000) // 5 minutes

/**
 * Environment auto-refresh enabled atom
 */
export const environmentAutoRefreshEnabledAtom = atom(false)

/**
 * Environment auto-refresh atom
 * Automatically refreshes environment data at specified intervals
 */
export const environmentAutoRefreshAtom = atom(
    (get) => ({
        enabled: get(environmentAutoRefreshEnabledAtom),
        interval: get(environmentAutoRefreshIntervalAtom),
    }),
    (get, set, action: "start" | "stop" | "toggle") => {
        const current = get(environmentAutoRefreshEnabledAtom)

        switch (action) {
            case "start":
                set(environmentAutoRefreshEnabledAtom, true)
                break
            case "stop":
                set(environmentAutoRefreshEnabledAtom, false)
                break
            case "toggle":
                set(environmentAutoRefreshEnabledAtom, !current)
                break
        }
    },
)

// ============================================================================
// Development and Debugging Utilities
// ============================================================================

/**
 * Environment debug info atom
 */
export const environmentDebugInfoAtom = selectAtom(
    atom((get) => ({
        appId: get(selectedAppIdAtom),
        queryState: get(environmentsQueryAtom),
        loading: get(environmentsLoadingAtom),
        error: get(environmentsErrorAtom),
        networkStats: get(environmentNetworkStatsAtom),
        performance: get(environmentPerformanceAtom),
    })),
    (debugData) => ({
        appId: debugData.appId,
        queryEnabled: !!(debugData.queryState as any)?.enabled,
        queryStatus: (debugData.queryState as any)?.status || "idle",
        isLoading: debugData.loading,
        hasError: !!debugData.error,
        errorDetails: debugData.error,
        networkRequests: debugData.networkStats.totalRequests,
        successRate: debugData.networkStats.successRate,
        performanceScore: debugData.performance.performanceScore,
        cacheStatus: debugData.performance.cacheStatus,
        lastUpdate: debugData.performance.dataUpdatedAt,

        // Debugging helpers
        canRefresh: !debugData.loading && !!debugData.appId,
        shouldShowSkeleton: debugData.loading && debugData.networkStats.totalRequests === 0,
        recommendedAction: debugData.hasError
            ? "Check error and retry"
            : debugData.loading
              ? "Wait for loading to complete"
              : debugData.performance.performanceScore < 50
                ? "Consider optimizing performance"
                : "All systems operational",
    }),
    deepEqual,
)

/**
 * Reset environment utilities atom (write-only)
 */
export const resetEnvironmentUtilitiesAtom = atom(null, (get, set) => {
    // Reset network tracker
    environmentNetworkTracker.reset()

    // Stop auto-refresh
    set(environmentAutoRefreshEnabledAtom, false)

    console.log("Environment utilities reset")
})

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Environment batch operations atom
 */
export const environmentBatchOperationsAtom = atom(
    null,
    async (get, set, operation: "refresh-all" | "clear-cache" | "reset-stats") => {
        switch (operation) {
            case "refresh-all":
                await set(environmentsRefreshAtom)
                break

            case "clear-cache":
                await set(environmentsCacheInvalidateAtom)
                break

            case "reset-stats":
                set(resetEnvironmentUtilitiesAtom)
                break
        }
    },
)
