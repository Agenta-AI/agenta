/**
 * New Workspace Atoms - Core Workspace State Management
 *
 * This module provides optimized workspace state management following the established patterns
 * from newApps, newVariants, newEnvironments, newOrg, and newProfile. It includes:
 *
 * - Core workspace fetching with caching and background refresh
 * - Workspace member management and filtering
 * - Workspace statistics and analytics
 * - Loading states and error handling
 * - Performance monitoring and analytics
 */

import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {WorkspaceMember, Workspace} from "@/oss/lib/Types"
import {fetchWorkspaceMembers} from "@/oss/services/workspace"

import {selectedOrgAtom} from "../../newOrg/atoms/orgs"
import {userAtom} from "../../newProfile/atoms/profile"

// ============================================================================
// Constants and Configuration
// ============================================================================

// Environment variable for logging
const logWorkspace = process.env.NEXT_PUBLIC_LOG_WORKSPACE_ATOMS === "true"

// ============================================================================
// Core Workspace Query Atoms
// ============================================================================

/**
 * Current workspace atom - derived from selected organization
 */
export const currentWorkspaceAtom = selectAtom(
    selectedOrgAtom,
    (org) => org?.default_workspace || null,
    deepEqual,
)

/**
 * Workspace ID atom
 */
export const workspaceIdAtom = selectAtom(
    currentWorkspaceAtom,
    (workspace) => workspace?.id || null,
)

/**
 * Workspace members query atom - fetches members for the current workspace
 */
export const workspaceMembersQueryAtom = atomWithQuery<WorkspaceMember[]>((get) => {
    const workspace = get(currentWorkspaceAtom)
    const user = get(userAtom)

    // Test mode enabling logic (aligned with working variants atoms pattern)
    const testApiUrl = process.env.NEXT_PUBLIC_AGENTA_API_URL
    const testWorkspaceId = process.env.VITEST_TEST_WORKSPACE_ID || ""
    const isTestMode = !!testApiUrl

    // Use test workspace ID in test mode, otherwise use current workspace
    const workspaceId = isTestMode && testWorkspaceId ? testWorkspaceId : workspace?.id

    if (logWorkspace || isTestMode) {
        console.log("🔍 Workspace query test mode:", {
            testApiUrl,
            testWorkspaceId,
            workspaceId,
            enabled: isTestMode,
            usingTestWorkspace: isTestMode && !!testWorkspaceId,
        })
    }

    return {
        queryKey: ["workspaceMembers", workspaceId, user?.id],
        queryFn: async (): Promise<WorkspaceMember[]> => {
            if (!workspaceId) {
                if (logWorkspace || isTestMode) {
                    console.log("⚠️ Workspace query skipped: no workspace ID")
                }
                return []
            }

            if (logWorkspace || isTestMode) {
                console.log("🌐 Workspace query executing...", {workspaceId, isTestMode})
            }

            try {
                const members = await fetchWorkspaceMembers(workspaceId)
                if (logWorkspace || isTestMode) {
                    console.log("📋 Fetched workspace members successfully:", members?.length || 0)
                }
                return members || []
            } catch (error) {
                console.error("❌ Workspace members query failed:", error)
                return []
            }
        },
        enabled: !!workspaceId && (!!user?.id || isTestMode),
        staleTime: 2 * 60 * 1000, // 2 minutes
        gcTime: 5 * 60 * 1000, // 5 minutes
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: 2,
    }
})

/**
 * Workspace members atom - provides the list of workspace members
 */
export const workspaceMembersAtom = selectAtom(
    workspaceMembersQueryAtom,
    (query) => query.data || [],
    deepEqual,
)

/**
 * Workspace members loading atom
 */
export const workspaceMembersLoadingAtom = selectAtom(
    workspaceMembersQueryAtom,
    (query) => query.isLoading,
)

/**
 * Workspace members error atom
 */
export const workspaceMembersErrorAtom = selectAtom(
    workspaceMembersQueryAtom,
    (query) => query.error,
)

/**
 * Workspace members count atom
 */
export const workspaceMembersCountAtom = selectAtom(
    workspaceMembersAtom,
    (members) => members.length,
)

// ============================================================================
// Member Search and Filtering
// ============================================================================

/**
 * Member search term atom
 */
export const memberSearchTermAtom = atom<string>("")

/**
 * Filtered workspace members atom - filters members based on search term
 */
export const filteredWorkspaceMembersAtom = selectAtom(
    atom((get) => ({
        members: get(workspaceMembersAtom),
        searchTerm: get(memberSearchTermAtom),
    })),
    ({members, searchTerm}): WorkspaceMember[] => {
        if (!searchTerm.trim()) {
            return members
        }

        const term = searchTerm.toLowerCase()
        return members.filter((member) => {
            const email = member.user?.email?.toLowerCase() || ""
            const username = member.user?.username?.toLowerCase() || ""
            return email.includes(term) || username.includes(term)
        })
    },
    deepEqual,
)

/**
 * Filtered members count atom
 */
export const filteredMembersCountAtom = selectAtom(
    filteredWorkspaceMembersAtom,
    (members) => members.length,
)

// ============================================================================
// Member Role and Permission Management
// ============================================================================

/**
 * Members by role atom - groups members by their roles
 */
export const membersByRoleAtom = selectAtom(
    workspaceMembersAtom,
    (members): Record<string, WorkspaceMember[]> => {
        const roleGroups: Record<string, WorkspaceMember[]> = {}

        members.forEach((member) => {
            const role = member.role || "member"
            if (!roleGroups[role]) {
                roleGroups[role] = []
            }
            roleGroups[role].push(member)
        })

        return roleGroups
    },
    deepEqual,
)

/**
 * Admin members atom
 */
export const adminMembersAtom = selectAtom(
    membersByRoleAtom,
    (roleGroups) => roleGroups.admin || [],
    deepEqual,
)

/**
 * Regular members atom
 */
export const regularMembersAtom = selectAtom(
    membersByRoleAtom,
    (roleGroups) => roleGroups.member || [],
    deepEqual,
)

/**
 * Current user workspace membership atom
 */
export const currentUserMembershipAtom = selectAtom(
    atom((get) => ({
        members: get(workspaceMembersAtom),
        user: get(userAtom),
    })),
    ({members, user}): WorkspaceMember | null => {
        if (!user?.id) return null
        return members.find((member) => member.user?.id === user.id) || null
    },
    deepEqual,
)

/**
 * Current user role atom
 */
export const currentUserRoleAtom = selectAtom(
    currentUserMembershipAtom,
    (membership) => membership?.role || null,
)

/**
 * Current user permissions atom
 */
export const currentUserPermissionsAtom = selectAtom(
    currentUserRoleAtom,
    (role): {canManageMembers: boolean; canManageWorkspace: boolean; isAdmin: boolean} => ({
        canManageMembers: role === "admin" || role === "owner",
        canManageWorkspace: role === "admin" || role === "owner",
        isAdmin: role === "admin" || role === "owner",
    }),
    deepEqual,
)

// ============================================================================
// Workspace Statistics and Analytics
// ============================================================================

/**
 * Workspace statistics atom
 */
export const workspaceStatsAtom = selectAtom(
    atom((get) => ({
        workspace: get(currentWorkspaceAtom),
        members: get(workspaceMembersAtom),
        membersByRole: get(membersByRoleAtom),
        loading: get(workspaceMembersLoadingAtom),
        currentUser: get(currentUserMembershipAtom),
    })),
    ({workspace, members, membersByRole, loading, currentUser}) => ({
        workspaceId: workspace?.id || null,
        workspaceName: workspace?.name || null,
        totalMembers: members.length,
        adminCount: (membersByRole.admin || []).length,
        memberCount: (membersByRole.member || []).length,
        hasMembers: members.length > 0,
        hasCurrentUser: !!currentUser,
        currentUserRole: currentUser?.role || null,
        loading,
        recommendations: {
            shouldInviteMembers: members.length < 2,
            hasAdmins: (membersByRole.admin || []).length > 0,
            needsMoreAdmins: (membersByRole.admin || []).length === 0 && members.length > 5,
        },
    }),
    deepEqual,
)

// ============================================================================
// Utility and Management Atoms
// ============================================================================

/**
 * Workspace prefetch atom - triggers prefetching of workspace data
 */
export const workspacePrefetchAtom = atom(null, async (get, set) => {
    const queryClient = get(queryClientAtom)
    const workspace = get(currentWorkspaceAtom)
    const user = get(userAtom)

    if (workspace?.id && user?.id) {
        await queryClient.prefetchQuery({
            queryKey: ["workspaceMembers", workspace.id, user.id],
            queryFn: async () => {
                const members = await fetchWorkspaceMembers(workspace.id)
                return members || []
            },
            staleTime: 2 * 60 * 1000,
        })

        if (logWorkspace) {
            console.log("👥 Workspace data prefetched")
        }
    }
})

/**
 * Workspace refresh atom - forces refresh of workspace data
 */
export const workspaceRefreshAtom = atom(null, async (get, set) => {
    const queryClient = get(queryClientAtom)
    const workspace = get(currentWorkspaceAtom)
    const user = get(userAtom)

    if (workspace?.id && user?.id) {
        await queryClient.invalidateQueries({
            queryKey: ["workspaceMembers", workspace.id, user.id],
        })

        if (logWorkspace) {
            console.log("👥 Workspace data refreshed")
        }
    }
})

/**
 * Workspace reset atom - clears all workspace data
 */
export const workspaceResetAtom = atom(null, (get, set) => {
    const queryClient = get(queryClientAtom)

    // Clear all workspace queries
    queryClient.removeQueries({queryKey: ["workspaceMembers"]})

    // Clear search term
    set(memberSearchTermAtom, "")

    if (logWorkspace) {
        console.log("👥 Workspace data reset")
    }
})

// ============================================================================
// Network and Performance Monitoring
// ============================================================================

/**
 * Workspace network stats atom - tracks network requests
 */
export const workspaceNetworkStatsAtom = selectAtom(
    workspaceMembersQueryAtom,
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
