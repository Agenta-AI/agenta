/**
 * Organization Skeleton Atoms - Loading State Management
 *
 * This module provides skeleton loading states for organization components,
 * following the established patterns from newApps, newVariants, and newEnvironments.
 */

import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"

import {Org, OrgDetails} from "@/oss/lib/Types"

// ============================================================================
// Skeleton Data Generation
// ============================================================================

/**
 * Generate skeleton organization data
 */
const generateSkeletonOrg = (index: number): Org => ({
    id: `skeleton-org-${index}`,
    name: `Organization ${index + 1}`,
    description: "Loading organization details...",
    type: "team",
    is_paying: false,
    members: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
})

/**
 * Generate skeleton organization details
 */
const generateSkeletonOrgDetails = (): OrgDetails => ({
    id: "skeleton-org-details",
    name: "Loading Organization...",
    description: "Loading organization details...",
    type: "team",
    is_paying: false,
    members: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    settings: {},
    billing: null,
    usage: {
        apps: 0,
        environments: 0,
        evaluations: 0,
        api_calls: 0,
    },
})

// ============================================================================
// Skeleton Configuration
// ============================================================================

/**
 * Skeleton configuration atom
 */
export const orgSkeletonConfigAtom = atom({
    orgCount: 3,
    showSkeleton: true,
    animationDelay: 150,
})

// ============================================================================
// Organizations Skeleton Atoms
// ============================================================================

/**
 * Organizations skeleton data atom
 */
export const orgsSkeletonAtom = selectAtom(
    orgSkeletonConfigAtom,
    (config): Org[] => {
        if (!config.showSkeleton) return []

        return Array.from({length: config.orgCount}, (_, index) => generateSkeletonOrg(index))
    },
    deepEqual,
)

/**
 * Organization selector skeleton options atom
 */
export const orgSelectorSkeletonAtom = selectAtom(
    orgsSkeletonAtom,
    (skeletonOrgs): {value: string; label: string; org: Org}[] =>
        skeletonOrgs.map((org) => ({
            value: org.id,
            label: org.name,
            org,
        })),
    deepEqual,
)

/**
 * Selected organization skeleton atom
 */
export const selectedOrgSkeletonAtom = atom<OrgDetails | null>((get) => {
    const config = get(orgSkeletonConfigAtom)
    return config.showSkeleton ? generateSkeletonOrgDetails() : null
})

// ============================================================================
// Organization Table Skeleton Atoms
// ============================================================================

/**
 * Organization table skeleton data atom
 */
export const orgTableSkeletonAtom = selectAtom(
    orgsSkeletonAtom,
    (skeletonOrgs) =>
        skeletonOrgs.map((org, index) => ({
            key: org.id,
            id: org.id,
            name: org.name,
            description: org.description,
            type: org.type,
            memberCount: 0,
            createdAt: org.created_at,
            isLoading: true,
            skeleton: true,
            animationDelay: index * 150,
        })),
    deepEqual,
)

// ============================================================================
// Organization Statistics Skeleton Atoms
// ============================================================================

/**
 * Organization stats skeleton atom
 */
export const orgStatsSkeletonAtom = atom({
    totalOrgs: 0,
    hasOrgs: false,
    hasSelection: false,
    selectedOrgName: null,
    loading: true,
    skeleton: true,
    recommendations: {
        shouldSelectOrg: false,
        hasMultipleOrgs: false,
    },
})

// ============================================================================
// Skeleton Control Atoms
// ============================================================================

/**
 * Organization skeleton visibility atom
 */
export const orgSkeletonVisibilityAtom = atom(
    (get) => get(orgSkeletonConfigAtom).showSkeleton,
    (get, set, show: boolean) => {
        const config = get(orgSkeletonConfigAtom)
        set(orgSkeletonConfigAtom, {
            ...config,
            showSkeleton: show,
        })
    },
)

/**
 * Organization skeleton count atom
 */
export const orgSkeletonCountAtom = atom(
    (get) => get(orgSkeletonConfigAtom).orgCount,
    (get, set, count: number) => {
        const config = get(orgSkeletonConfigAtom)
        set(orgSkeletonConfigAtom, {
            ...config,
            orgCount: Math.max(1, Math.min(10, count)),
        })
    },
)

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if an organization is skeleton data
 */
export const isSkeletonOrg = (org: Org): boolean => {
    return org.id.startsWith("skeleton-org-")
}

/**
 * Check if organization details are skeleton data
 */
export const isSkeletonOrgDetails = (orgDetails: OrgDetails | null): boolean => {
    return orgDetails?.id === "skeleton-org-details"
}

/**
 * Filter out skeleton organizations
 */
export const filterSkeletonOrgs = (orgs: Org[]): Org[] => {
    return orgs.filter((org) => !isSkeletonOrg(org))
}
