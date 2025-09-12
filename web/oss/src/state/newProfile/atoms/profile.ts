/**
 * New Profile Atoms - Core User Profile State Management
 *
 * This module provides optimized user profile state management following the established patterns
 * from newApps, newVariants, newEnvironments, and newOrg. It includes:
 *
 * - Core profile fetching with caching and background refresh
 * - User authentication state management
 * - Profile update operations
 * - Loading states and error handling
 * - Performance monitoring and analytics
 */

import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"
import Router from "next/router"

import {User} from "@/oss/lib/Types"
import {fetchProfile} from "@/oss/services/profile"

import {sessionExistsAtom} from "../../session"

// ============================================================================
// Constants and Configuration
// ============================================================================

// Environment variable for logging
const logProfile = process.env.NEXT_PUBLIC_LOG_PROFILE_ATOMS === "true"

// Environment variables for test compatibility
const testApiUrl = process.env.VITEST_TEST_API_URL
const isTestMode = !!testApiUrl

// ============================================================================
// Core Profile Query Atoms
// ============================================================================

/**
 * Profile query atom - fetches user profile data
 */
export const profileQueryAtom = atomWithQuery<User>((get) => ({
    queryKey: isTestMode ? ["profile", "test-mode"] : ["profile"],
    queryFn: async (): Promise<User> => {
        try {
            if (isTestMode) {
                console.log("🔍 Profile query test mode:", {
                    testApiUrl,
                    enabled: !!testApiUrl,
                })
                console.log("🌐 Profile query executing...")
            }

            const user = await fetchProfile()

            if (isTestMode) {
                console.log("📋 Fetched profile successfully:", user?.username || user?.email)
            }

            if (logProfile) {
                console.log("👤 Fetched user profile:", user.username || user.email)
            }

            return user
        } catch (error) {
            console.error("Failed to fetch profile:", error)
            throw error
        }
    },
    enabled: isTestMode ? !!testApiUrl : get(sessionExistsAtom),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 2,
    throwOnError: (error, query) => {
        // Redirect to auth on authentication errors
        if (error && typeof window !== "undefined") {
            Router.replace("/auth")
        }
        return false
    },
}))

/**
 * User atom - provides the current user with test environment fallback
 */
export const userAtom = selectAtom(
    profileQueryAtom,
    (query): User | null => {
        const user = query.data

        // In test environment, provide a mock user if no real user is available
        if (!user && typeof process !== "undefined" && process.env.NODE_ENV === "test") {
            return {
                id: process.env.VITEST_TEST_USER_ID || "test-user-id",
                uid: process.env.VITEST_TEST_USER_ID || "test-user-id",
                username: "test-user",
                email: "test@agenta.ai",
            } as User
        }

        return user || null
    },
    deepEqual,
)

/**
 * Profile loading atom
 */
export const profileLoadingAtom = selectAtom(profileQueryAtom, (query) => query.isLoading)

/**
 * Profile error atom
 */
export const profileErrorAtom = selectAtom(profileQueryAtom, (query) => query.error)

/**
 * Authentication status atom
 */
export const authStatusAtom = selectAtom(
    atom((get) => ({
        sessionExists: get(sessionExistsAtom),
        user: get(userAtom),
        loading: get(profileLoadingAtom),
        error: get(profileErrorAtom),
    })),
    ({sessionExists, user, loading, error}) => ({
        isAuthenticated: !!user && sessionExists,
        isLoading: loading,
        hasError: !!error,
        user,
        sessionExists,
    }),
    deepEqual,
)

// ============================================================================
// User Information Atoms
// ============================================================================

/**
 * User ID atom
 */
export const userIdAtom = selectAtom(userAtom, (user) => user?.id || null)

/**
 * User display name atom
 */
export const userDisplayNameAtom = selectAtom(userAtom, (user) => {
    if (!user) return null
    return user.username || user.email || "Unknown User"
})

/**
 * User email atom
 */
export const userEmailAtom = selectAtom(userAtom, (user) => user?.email || null)

/**
 * User preferences atom
 */
export const userPreferencesAtom = selectAtom(
    userAtom,
    (user) => (user as any)?.preferences || {},
    deepEqual,
)

// ============================================================================
// Profile Statistics and Analytics
// ============================================================================

/**
 * Profile stats atom
 */
export const profileStatsAtom = selectAtom(
    atom((get) => ({
        user: get(userAtom),
        loading: get(profileLoadingAtom),
        error: get(profileErrorAtom),
        sessionExists: get(sessionExistsAtom),
    })),
    ({user, loading, error, sessionExists}) => ({
        hasProfile: !!user,
        isAuthenticated: !!user && sessionExists,
        loading,
        hasError: !!error,
        userId: user?.id || null,
        username: user?.username || null,
        email: user?.email || null,
        createdAt: (user as any)?.created_at || null,
        lastUpdated: (user as any)?.updated_at || null,
        recommendations: {
            shouldCompleteProfile: !!user && (!user.username || !user.email),
            hasRecentActivity: !!(user as any)?.updated_at,
        },
    }),
    deepEqual,
)

// ============================================================================
// Utility and Management Atoms
// ============================================================================

/**
 * Profile prefetch atom - triggers prefetching of profile data
 */
export const profilePrefetchAtom = atom(null, async (get, set) => {
    const queryClient = get(queryClientAtom)
    const sessionExists = get(sessionExistsAtom)

    if (sessionExists) {
        await queryClient.prefetchQuery({
            queryKey: ["profile"],
            queryFn: async () => {
                const user = await fetchProfile()
                return user
            },
            staleTime: 5 * 60 * 1000,
        })

        if (logProfile) {
            console.log("👤 Profile prefetched")
        }
    }
})

/**
 * Profile refresh atom - forces refresh of profile data
 */
export const profileRefreshAtom = atom(null, async (get, set) => {
    const queryClient = get(queryClientAtom)
    const sessionExists = get(sessionExistsAtom)

    if (sessionExists) {
        await queryClient.invalidateQueries({
            queryKey: ["profile"],
        })

        if (logProfile) {
            console.log("👤 Profile refreshed")
        }
    }
})

/**
 * Profile reset atom - clears all profile data
 */
export const profileResetAtom = atom(null, (get, set) => {
    const queryClient = get(queryClientAtom)

    // Clear profile query
    queryClient.removeQueries({queryKey: ["profile"]})

    if (logProfile) {
        console.log("👤 Profile reset")
    }
})

// ============================================================================
// Network and Performance Monitoring
// ============================================================================

/**
 * Profile network stats atom - tracks network requests
 */
export const profileNetworkStatsAtom = selectAtom(
    profileQueryAtom,
    (query) => ({
        status: query.status,
        fetchStatus: query.fetchStatus,
        isFetching: query.isFetching,
        isLoading: query.isLoading,
        lastFetch: query.dataUpdatedAt,
        errorCount: query.failureCount,
        isStale: query.isStale,
    }),
    deepEqual,
)
