/**
 * Core Environment Atoms
 *
 * Performance-optimized environment fetching with:
 * - App-scoped queries
 * - Smart caching and invalidation
 * - Loading and error state management
 * - Memory-efficient data structures
 */

import deepEqual from "fast-deep-equal"
// import {atom} from "jotai" // Unused for now
import {selectAtom, unwrap} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

// import {snakeToCamel} from "@/oss/lib/helpers/utils" // Not needed for now
import {Environment} from "@/oss/lib/Types"
import {fetchEnvironments} from "@/oss/services/deployment/api"
import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"
import {projectIdAtom} from "@/oss/state/project"
import {jwtReadyAtom} from "@/oss/state/session/jwt"

// ============================================================================
// Core Query Atom
// ============================================================================

/**
 * Main environments query atom with app-scoped fetching
 * Automatically refetches when app or project changes
 * Supports both production and test environments
 */
export const environmentsQueryAtom = atomWithQuery<Environment[]>((get) => {
    const appId = get(selectedAppIdAtom)
    const projectId = get(projectIdAtom)
    const jwtReady = get(jwtReadyAtom).data ?? false

    // Test mode detection
    const testApiUrl = process.env.VITEST_TEST_API_URL
    const isTestMode = !!testApiUrl
    const enabled = isTestMode ? true : !!appId && !!projectId && jwtReady

    console.log("🔍 Environments query test mode:", {testApiUrl, enabled})

    return {
        queryKey: ["newEnvironments", appId, projectId],
        queryFn: async (): Promise<Environment[]> => {
            if (!isTestMode && !appId) return []

            try {
                console.log("🌐 Environments query executing...")
                const testAppId =
                    process.env.VITEST_TEST_APP_ID || "01988515-0b61-7163-9f07-92b8b285ba58"
                const finalAppId = isTestMode ? testAppId : appId
                console.log("🔍 Using app ID:", {finalAppId, isTestMode, originalAppId: appId})
                const environments = await fetchEnvironments(finalAppId || testAppId)
                console.log("🏢 Fetched environments:", environments.length)
                return environments as Environment[] // Return environments as-is since they're already in the correct format
            } catch (error) {
                console.error("Failed to fetch environments:", error)
                throw error
            }
        },
        enabled,
        staleTime: 5 * 60 * 1000, // 5 minutes
        gcTime: 10 * 60 * 1000, // 10 minutes
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        refetchOnMount: false,
        retry: (failureCount, error) => {
            // Don't retry on authentication errors
            if ((error as any)?.response?.status === 401) return false
            return failureCount < 2
        },
    }
})

// ============================================================================
// Derived Data Atoms
// ============================================================================

const EmptyEnvironments: Environment[] = []

/**
 * Main environments data atom - unwrapped from query
 * Returns empty array during loading to prevent UI flickering
 */
export const environmentsAtom = selectAtom(
    unwrap(environmentsQueryAtom),
    (result) => {
        if (!result) return EmptyEnvironments
        return (result as any)?.data ?? EmptyEnvironments
    },
    deepEqual,
)

/**
 * Loading state atom for environments
 */
export const environmentsLoadingAtom = selectAtom(environmentsQueryAtom, (result) => {
    if (!result) return false
    return (result as any)?.isLoading ?? false
})

/**
 * Error state atom for environments
 */
export const environmentsErrorAtom = selectAtom(environmentsQueryAtom, (result) => {
    if (!result) return null
    return (result as any)?.error ?? null
})

/**
 * Environment count atom for quick stats
 */
export const environmentsCountAtom = selectAtom(
    environmentsAtom,
    (environments) => environments.length,
)

/**
 * Deployed environments count (environments with active deployments)
 */
export const deployedEnvironmentsCountAtom = selectAtom(
    environmentsAtom,
    (environments) =>
        environments.filter(
            (env: Environment) => env.deployed_app_variant_id && env.deployed_variant_name,
        ).length,
)

/**
 * Environment names array for quick lookups
 */
export const environmentNamesAtom = selectAtom(
    environmentsAtom,
    (environments) => environments.map((env) => env.name),
    deepEqual,
)

/**
 * Environment deployment status summary
 */
export const environmentDeploymentSummaryAtom = selectAtom(
    environmentsAtom,
    (environments) => {
        const summary = environments.reduce(
            (acc, env: Environment) => {
                const status = env.deployed_app_variant_id ? "deployed" : "empty"
                acc[status] = (acc[status] || 0) + 1
                return acc
            },
            {} as Record<string, number>,
        )

        const total = environments.length
        const deployed = summary.deployed || 0
        const empty = summary.empty || 0
        const deploymentRate = total > 0 ? (deployed / total) * 100 : 0

        return {
            total,
            deployed,
            empty,
            deploymentRate,
        }
    },
    deepEqual,
)
