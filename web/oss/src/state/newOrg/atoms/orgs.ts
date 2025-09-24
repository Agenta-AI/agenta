/**
 * New Organization Atoms - Core Organization State Management
 *
 * This module provides optimized organization state management following the established patterns
 * from newApps, newVariants, and newEnvironments. It includes:
 *
 * - Core organization fetching with caching and background refresh
 * - Selected organization state with persistence
 * - Organization selector atoms for UI components
 * - Table-optimized data transformations
 * - Loading states and error handling
 * - Performance monitoring and analytics
 */

import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"
import {queryClientAtom} from "jotai-tanstack-query"

import {Org} from "../../../lib/Types"
import {fetchAllOrgsList} from "../../../services/organization/api"
import {
    orgsQueryAtom as baseOrgsQueryAtom,
    orgsAtom as baseOrgsAtom,
    selectedOrgIdAtom as baseSelectedOrgIdAtom,
    selectedOrgQueryAtom as baseSelectedOrgQueryAtom,
    selectedOrgAtom as baseSelectedOrgAtom,
} from "../../org/selectors/org"
import {userAtom} from "../../profile/selectors/user"

export {LS_ORG_KEY} from "../../org/selectors/org"

// ============================================================================
// Constants and Configuration
// ============================================================================

export const LS_ORG_KEY = "selectedOrg"

// Environment variable for logging
const logOrgs = process.env.NEXT_PUBLIC_LOG_ORG_ATOMS === "true"

// ============================================================================
// Core Organization Query Atoms (aliases to primary org state)
// ============================================================================

export const orgsQueryAtom = baseOrgsQueryAtom
export const orgsAtom = baseOrgsAtom
export const selectedOrgIdAtom = baseSelectedOrgIdAtom
export const selectedOrgQueryAtom = baseSelectedOrgQueryAtom
export const selectedOrgAtom = baseSelectedOrgAtom

/**
 * Organizations loading atom
 */
export const orgsLoadingAtom = selectAtom(orgsQueryAtom, (query) => {
    const result = query as any
    return Boolean(result?.isPending || result?.isFetching || result?.isLoading)
})

/**
 * Organizations error atom
 */
export const orgsErrorAtom = selectAtom(orgsQueryAtom, (query) => (query as any)?.error ?? null)

/**
 * Organizations count atom
 */
export const orgsCountAtom = selectAtom(orgsAtom, (orgs) => orgs.length)

/**
 * Selected organization loading atom
 */
export const selectedOrgLoadingAtom = selectAtom(selectedOrgQueryAtom, (query) => query.isLoading)

// ============================================================================
// Organization Selector Atoms
// ============================================================================

/**
 * Organization selector options atom - provides options for organization dropdowns
 */
export const orgSelectorOptionsAtom = selectAtom(
    orgsAtom,
    (orgs): {value: string; label: string; org: Org}[] =>
        orgs.map((org) => ({
            value: org.id,
            label: org.name,
            org,
        })),
    deepEqual,
)

/**
 * Organization selector state atom - combines options with current selection
 */
export const orgSelectorStateAtom = selectAtom(
    atom((get) => ({
        options: get(orgSelectorOptionsAtom),
        selectedId: get(selectedOrgIdAtom),
        loading: get(orgsLoadingAtom),
    })),
    ({options, selectedId, loading}) => ({
        options,
        selectedValue: selectedId,
        selectedOption: options.find((opt) => opt.value === selectedId) || null,
        hasSelection: !!selectedId,
        loading,
    }),
    deepEqual,
)

// ============================================================================
// Organization Map and Lookup Atoms
// ============================================================================

/**
 * Organization map atom - provides O(1) lookup by ID
 */
export const orgMapAtom = selectAtom(
    orgsAtom,
    (orgs): Record<string, Org> => {
        const map: Record<string, Org> = {}
        orgs.forEach((org) => {
            map[org.id] = org
        })
        return map
    },
    deepEqual,
)

/**
 * Organization lookup atom - provides lookup function
 */
export const orgLookupAtom = selectAtom(
    orgMapAtom,
    (orgMap) =>
        (id: string): Org | null =>
            orgMap[id] || null,
)

// ============================================================================
// Organization Statistics and Analytics
// ============================================================================

/**
 * Organization statistics atom
 */
export const orgStatsAtom = selectAtom(
    atom((get) => ({
        orgs: get(orgsAtom),
        selectedOrg: get(selectedOrgAtom),
        loading: get(orgsLoadingAtom),
    })),
    ({orgs, selectedOrg, loading}) => ({
        totalOrgs: orgs.length,
        hasOrgs: orgs.length > 0,
        hasSelection: !!selectedOrg,
        selectedOrgName: selectedOrg?.name || null,
        loading,
        recommendations: {
            shouldSelectOrg: orgs.length > 0 && !selectedOrg,
            hasMultipleOrgs: orgs.length > 1,
        },
    }),
    deepEqual,
)

// ============================================================================
// Utility and Management Atoms
// ============================================================================

/**
 * Organization prefetch atom - triggers prefetching of organization data
 */
export const orgsPrefetchAtom = atom(null, async (get, set) => {
    const queryClient = get(queryClientAtom)
    const user = get(userAtom)

    const userKey = user?.id || ""

    if (userKey) {
        await queryClient.prefetchQuery({
            queryKey: ["orgs", userKey],
            queryFn: async () => fetchAllOrgsList(),
            staleTime: 2 * 60 * 1000,
        })

        if (logOrgs) {
            console.log("🏢 Organizations prefetched")
        }
    }
})

/**
 * Organization refresh atom - forces refresh of organization data
 */
export const orgsRefreshAtom = atom(null, async (get, set) => {
    const queryClient = get(queryClientAtom)
    const selectedId = get(selectedOrgIdAtom)

    await queryClient.invalidateQueries({queryKey: ["orgs"]})

    if (selectedId) {
        await queryClient.invalidateQueries({queryKey: ["selectedOrg", selectedId]})
    }

    if (logOrgs) {
        console.log("🏢 Organizations refreshed")
    }
})

/**
 * Organization reset atom - clears all organization data
 */
export const orgsResetAtom = atom(null, (get, set) => {
    const queryClient = get(queryClientAtom)

    // Clear all organization queries
    queryClient.removeQueries({queryKey: ["orgs"]})
    queryClient.removeQueries({queryKey: ["selectedOrg"]})

    // Clear selected organization
    set(selectedOrgIdAtom, null)

    if (logOrgs) {
        console.log("🏢 Organizations reset")
    }
})

// ============================================================================
// Network and Performance Monitoring
// ============================================================================

/**
 * Organization network stats atom - tracks network requests
 */
export const orgNetworkStatsAtom = selectAtom(
    atom((get) => ({
        orgsQuery: get(orgsQueryAtom),
        selectedOrgQuery: get(selectedOrgQueryAtom),
    })),
    ({orgsQuery, selectedOrgQuery}) => {
        const requests = []

        if (orgsQuery.fetchStatus === "fetching") requests.push("orgs")
        if (selectedOrgQuery.fetchStatus === "fetching") requests.push("selectedOrg")

        return {
            activeRequests: requests.length,
            requestTypes: requests,
            orgsStatus: orgsQuery.status,
            selectedOrgStatus: selectedOrgQuery.status,
            lastOrgsFetch: orgsQuery.dataUpdatedAt,
            lastSelectedOrgFetch: selectedOrgQuery.dataUpdatedAt,
        }
    },
    deepEqual,
)
