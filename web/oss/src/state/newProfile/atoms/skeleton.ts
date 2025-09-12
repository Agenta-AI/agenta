/**
 * Profile Skeleton Atoms - Loading State Management
 *
 * This module provides skeleton loading states for profile components,
 * following the established patterns from newApps, newVariants, newEnvironments, and newOrg.
 */

import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"

import {User} from "@/oss/lib/Types"

// ============================================================================
// Skeleton Data Generation
// ============================================================================

/**
 * Generate skeleton user profile data
 */
const generateSkeletonUser = (): User => ({
    id: "skeleton-user-id",
    username: "Loading...",
    email: "loading@example.com",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    preferences: {},
})

// ============================================================================
// Skeleton Configuration
// ============================================================================

/**
 * Skeleton configuration atom
 */
export const profileSkeletonConfigAtom = atom({
    showSkeleton: true,
    animationDelay: 150,
})

// ============================================================================
// Profile Skeleton Atoms
// ============================================================================

/**
 * Profile skeleton data atom
 */
export const profileSkeletonAtom = selectAtom(
    profileSkeletonConfigAtom,
    (config): User | null => {
        return config.showSkeleton ? generateSkeletonUser() : null
    },
    deepEqual,
)

/**
 * User display name skeleton atom
 */
export const userDisplayNameSkeletonAtom = atom<string | null>((get) => {
    const config = get(profileSkeletonConfigAtom)
    return config.showSkeleton ? "Loading User..." : null
})

/**
 * User email skeleton atom
 */
export const userEmailSkeletonAtom = atom<string | null>((get) => {
    const config = get(profileSkeletonConfigAtom)
    return config.showSkeleton ? "loading@example.com" : null
})

/**
 * Authentication status skeleton atom
 */
export const authStatusSkeletonAtom = atom({
    isAuthenticated: false,
    isLoading: true,
    hasError: false,
    user: null,
    sessionExists: false,
    skeleton: true,
})

// ============================================================================
// Profile Statistics Skeleton Atoms
// ============================================================================

/**
 * Profile stats skeleton atom
 */
export const profileStatsSkeletonAtom = atom({
    hasProfile: false,
    isAuthenticated: false,
    loading: true,
    hasError: false,
    userId: null,
    username: null,
    email: null,
    createdAt: null,
    lastUpdated: null,
    skeleton: true,
    recommendations: {
        shouldCompleteProfile: false,
        hasRecentActivity: false,
    },
})

// ============================================================================
// Skeleton Control Atoms
// ============================================================================

/**
 * Profile skeleton visibility atom
 */
export const profileSkeletonVisibilityAtom = atom(
    (get) => get(profileSkeletonConfigAtom).showSkeleton,
    (get, set, show: boolean) => {
        const config = get(profileSkeletonConfigAtom)
        set(profileSkeletonConfigAtom, {
            ...config,
            showSkeleton: show,
        })
    },
)

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a user is skeleton data
 */
export const isSkeletonUser = (user: User | null): boolean => {
    return user?.id === "skeleton-user-id"
}

/**
 * Filter out skeleton user data
 */
export const filterSkeletonUser = (user: User | null): User | null => {
    return isSkeletonUser(user) ? null : user
}
