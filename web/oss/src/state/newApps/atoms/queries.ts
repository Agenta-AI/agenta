/**
 * New Apps Query Atoms
 *
 * Optimized Jotai atoms for app data fetching with:
 * - React Query integration via jotai-tanstack-query
 * - Smart caching strategies
 * - Project-scoped queries
 * - Derived atoms for common use cases
 */

import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {loadable, selectAtom, atomWithStorage} from "jotai/utils"
import {eagerAtom} from "jotai-eager"
import {atomWithQuery} from "jotai-tanstack-query"

import {LS_APP_KEY} from "../../app/assets/constants"
import {projectIdAtom} from "../../project/selectors/project"
import {jwtReadyAtom} from "../../session/jwt"
import {stringStorage} from "../../utils/stringStorage"
import {fetchProjectApps} from "../api/apps"

// Get project ID for queries
const currentProjectIdAtom = atom((get) => {
    const projectId = get(projectIdAtom)

    // In test environment, fall back to environment variable
    const isTestMode = typeof process !== "undefined" && process.env.VITEST_TEST_API_URL
    if (isTestMode) {
        return process.env.VITEST_TEST_PROJECT_ID || null
    }

    return projectId
})

/**
 * Main apps query atom - fetches all apps for the current project
 * Optimized with caching for app management pages
 */
export const appsQueryAtom = atomWithQuery((get) => {
    const projectId = get(currentProjectIdAtom)
    const jwtReady = get(jwtReadyAtom)

    // Support test mode
    const isTestMode = typeof process !== "undefined" && process.env.VITEST_TEST_API_URL
    const testApiUrl = process.env.VITEST_TEST_API_URL

    console.log("🔍 Apps query test mode:", {
        testApiUrl,
        enabled: !!(projectId && (jwtReady.data || isTestMode)),
    })

    return {
        queryKey: ["apps", projectId],
        queryFn: async () => {
            try {
                console.log("🌐 Apps query executing...")
                const apps = await fetchProjectApps(projectId || undefined)
                console.log("📱 Fetched apps:", apps.length)
                return apps
            } catch (error) {
                console.error("❌ Apps query error:", error)
                throw error
            }
        },
        enabled: !!(projectId && (jwtReady.data || isTestMode)),
        staleTime: 60000, // Cache for 1 minute - apps don't change frequently
        gcTime: 300000, // Keep in cache for 5 minutes
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        experimental_prefetchInRender: true, // Enable prefetch for better performance
    }
})

/**
 * Loadable wrapper for apps query - exposes {state, data, error}
 * Used for non-blocking UI updates and loading states
 */
export const appsLoadableAtom = loadable(appsQueryAtom)

/**
 * Eager apps atom - provides immediate access to apps data
 * Uses selectAtom with deepEqual for optimized re-renders
 */
const EmptyApps: any[] = []
export const appsAtom = selectAtom(
    appsQueryAtom,
    (queryResult) => queryResult.data ?? EmptyApps,
    deepEqual,
)

/**
 * Derived atom for app table data - eager evaluation for better performance
 * Transforms raw app data into table-optimized format
 */
export const appTableDataAtom = eagerAtom((get) => {
    const apps = get(appsAtom)

    if (!apps || apps.length === 0) {
        return []
    }

    // Transform for table display with consistent sorting
    return apps
        .map((app) => ({
            key: app.app_id,
            app_id: app.app_id,
            app_name: app.app_name,
            app_type: app.app_type || "custom",
            updated_at: app.updated_at,
            // Add computed fields for table
            displayName: app.app_name,
            typeTag: app.app_type || "custom",
        }))
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
})

/**
 * Derived atom for app selector options - eager evaluation
 * Provides apps in selector-friendly format
 */
export const appSelectorOptionsAtom = eagerAtom((get) => {
    const apps = get(appsAtom)

    if (!apps || apps.length === 0) {
        return []
    }

    return apps.map((app) => ({
        value: app.app_id,
        label: app.app_name,
        app_type: app.app_type,
        updated_at: app.updated_at,
    }))
})

/**
 * Current selected app ID atom
 * Manages app selection state with localStorage persistence
 */
// Storage-backed app selection with test fallback
const selectedAppIdStorageAtom = atomWithStorage<string | null>(LS_APP_KEY, null, stringStorage)

export const selectedAppIdAtom = atom(
    (get) => {
        const stored = get(selectedAppIdStorageAtom)
        if (!stored && typeof process !== "undefined" && process.env.NODE_ENV === "test") {
            return process.env.VITEST_TEST_APP_ID || null
        }
        return stored
    },
    (get, set, update: string | null) => {
        set(selectedAppIdStorageAtom, update)
    },
)

/**
 * Current app atom - eager evaluation for immediate access
 * Returns the full app object for the currently selected app
 */
export const currentAppAtom = eagerAtom((get) => {
    const apps = get(appsAtom)
    const selectedId = get(selectedAppIdAtom)

    if (!selectedId || !apps || apps.length === 0) {
        return null
    }

    return apps.find((app) => app.app_id === selectedId) || null
})

/**
 * App loading states for UI feedback - using selectAtom for performance
 */
export const appsLoadingAtom = selectAtom(appsQueryAtom, (query) => query.isPending)
export const appsErrorAtom = selectAtom(appsQueryAtom, (query) => query.error)

/**
 * Apps count atom for dashboard/stats - eager evaluation
 */
export const appsCountAtom = eagerAtom((get) => {
    const apps = get(appsAtom)
    return apps?.length || 0
})

/**
 * Prefetch atom - mount once to eagerly fetch apps when dependencies are ready
 * This enables non-blocking UI updates
 */
export const appsPrefetchAtom = atom((get) => {
    const loadable = get(appsLoadableAtom)
    return loadable
})
