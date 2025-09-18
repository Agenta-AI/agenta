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
import {selectAtom, atomWithStorage} from "jotai/utils"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {Org, OrgDetails} from "../../../lib/Types"
import {fetchAllOrgsList, fetchSingleOrg} from "../../../services/organization/api"
import {userAtom} from "../../profile/selectors/user"
import {stringStorage} from "../../utils/stringStorage"

// ============================================================================
// Constants and Configuration
// ============================================================================

export const LS_ORG_KEY = "selectedOrg"

// Environment variable for logging
const logOrgs = process.env.NEXT_PUBLIC_LOG_ORG_ATOMS === "true"

// Environment variables for test compatibility
const testApiUrl = process.env.VITEST_TEST_API_URL
const isTestMode = !!testApiUrl

// ============================================================================
// Core Organization Query Atoms
// ============================================================================

/**
 * Organizations query atom - fetches all organizations for the current user
 */
export const orgsQueryAtom = atomWithQuery<Org[]>((get) => {
    const user = get(userAtom)

    return {
        queryKey: isTestMode ? ["orgs", "test-mode"] : ["orgs", user?.id],
        queryFn: async (): Promise<Org[]> => {
            if (isTestMode) {
                console.log("🔍 Organizations query test mode:", {
                    testApiUrl,
                    enabled: !!testApiUrl,
                })
                console.log("🌐 Organizations query executing...")
            }

            if (!isTestMode && !user?.id) return []

            try {
                const data = await fetchAllOrgsList()

                if (isTestMode) {
                    console.log("📋 Fetched organizations successfully:", data?.length || 0)
                }

                if (logOrgs || isTestMode) {
                    console.log("🏢 Fetched organizations:", data?.length || 0)
                }
                return data || []
            } catch (error) {
                console.error("Failed to fetch organizations:", error)
                return []
            }
        },
        enabled: isTestMode ? !!testApiUrl : !!user?.id,
        staleTime: 2 * 60 * 1000, // 2 minutes
        gcTime: 5 * 60 * 1000, // 5 minutes
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: 2,
    }
})

/**
 * Organizations atom - provides the list of organizations with loading state
 */
export const orgsAtom = selectAtom(orgsQueryAtom, (query) => query.data || [], deepEqual)

/**
 * Organizations loading atom
 */
export const orgsLoadingAtom = selectAtom(orgsQueryAtom, (query) => query.isLoading)

/**
 * Organizations error atom
 */
export const orgsErrorAtom = selectAtom(orgsQueryAtom, (query) => query.error)

/**
 * Organizations count atom
 */
export const orgsCountAtom = selectAtom(orgsAtom, (orgs) => orgs.length)

// ============================================================================
// Selected Organization State Management
// ============================================================================

/**
 * Selected organization ID atom with storage-backed persistence
 */
export const selectedOrgIdAtom = atomWithStorage<string | null>(LS_ORG_KEY, null, stringStorage)

/**
 * Selected organization query atom - fetches details for the selected organization
 */
export const selectedOrgQueryAtom = atomWithQuery<OrgDetails | null>((get) => {
    const selectedId = get(selectedOrgIdAtom)
    const user = get(userAtom)

    return {
        queryKey: ["selectedOrg", selectedId, user?.id],
        queryFn: async (): Promise<OrgDetails | null> => {
            if (!selectedId || !user?.id) return null

            try {
                const data = await fetchSingleOrg({orgId: selectedId})
                if (logOrgs) {
                    console.log("🏢 Fetched selected organization:", data?.name || selectedId)
                }
                return data
            } catch (error) {
                console.error("Failed to fetch selected organization:", error)
                return null
            }
        },
        enabled: !!selectedId && !!user?.id,
        staleTime: 2 * 60 * 1000, // 2 minutes
        gcTime: 5 * 60 * 1000, // 5 minutes
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: 2,
    }
})

/**
 * Selected organization atom - provides the selected organization details
 */
export const selectedOrgAtom = selectAtom(
    selectedOrgQueryAtom,
    (query) => query.data || null,
    deepEqual,
)

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

    if (user?.id) {
        await queryClient.prefetchQuery({
            queryKey: ["orgs", user.id],
            queryFn: async () => {
                const data = await fetchAllOrgsList()
                return data || []
            },
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
    const user = get(userAtom)

    if (user?.id) {
        await queryClient.invalidateQueries({
            queryKey: ["orgs", user.id],
        })

        const selectedId = get(selectedOrgIdAtom)
        if (selectedId) {
            await queryClient.invalidateQueries({
                queryKey: ["selectedOrg", selectedId, user.id],
            })
        }

        if (logOrgs) {
            console.log("🏢 Organizations refreshed")
        }
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
