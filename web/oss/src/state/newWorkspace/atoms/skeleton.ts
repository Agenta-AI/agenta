/**
 * Workspace Skeleton Atoms - Loading State Management
 *
 * This module provides skeleton loading states for workspace components,
 * following the established patterns from newApps, newVariants, newEnvironments, newOrg, and newProfile.
 */

import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"

import {WorkspaceMember, Workspace} from "@/oss/lib/Types"

// ============================================================================
// Skeleton Data Generation
// ============================================================================

/**
 * Generate skeleton workspace member data
 */
const generateSkeletonMember = (index: number): WorkspaceMember => ({
    id: `skeleton-member-${index}`,
    user: {
        id: `skeleton-user-${index}`,
        uid: `skeleton-user-${index}`,
        username: `member${index + 1}`,
        email: `member${index + 1}@example.com`,
    },
    role: index === 0 ? "admin" : "member",
    joined_at: new Date().toISOString(),
})

/**
 * Generate skeleton workspace data
 */
const generateSkeletonWorkspace = (): Workspace => ({
    id: "skeleton-workspace-id",
    name: "Loading Workspace...",
    description: "Loading workspace details...",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    members: [],
})

// ============================================================================
// Skeleton Configuration
// ============================================================================

/**
 * Skeleton configuration atom
 */
export const workspaceSkeletonConfigAtom = atom({
    memberCount: 5,
    showSkeleton: true,
    animationDelay: 150,
})

// ============================================================================
// Workspace Skeleton Atoms
// ============================================================================

/**
 * Workspace skeleton data atom
 */
export const workspaceSkeletonAtom = selectAtom(
    workspaceSkeletonConfigAtom,
    (config): Workspace | null => {
        return config.showSkeleton ? generateSkeletonWorkspace() : null
    },
    deepEqual,
)

/**
 * Workspace members skeleton data atom
 */
export const workspaceMembersSkeletonAtom = selectAtom(
    workspaceSkeletonConfigAtom,
    (config): WorkspaceMember[] => {
        if (!config.showSkeleton) return []

        return Array.from({length: config.memberCount}, (_, index) => generateSkeletonMember(index))
    },
    deepEqual,
)

/**
 * Filtered members skeleton atom
 */
export const filteredMembersSkeletonAtom = selectAtom(
    workspaceMembersSkeletonAtom,
    (skeletonMembers) => skeletonMembers,
    deepEqual,
)

/**
 * Members by role skeleton atom
 */
export const membersByRoleSkeletonAtom = selectAtom(
    workspaceMembersSkeletonAtom,
    (skeletonMembers): Record<string, WorkspaceMember[]> => {
        const roleGroups: Record<string, WorkspaceMember[]> = {
            admin: [],
            member: [],
        }

        skeletonMembers.forEach((member) => {
            const role = member.role || "member"
            if (roleGroups[role]) {
                roleGroups[role].push(member)
            }
        })

        return roleGroups
    },
    deepEqual,
)

/**
 * Current user membership skeleton atom
 */
export const currentUserMembershipSkeletonAtom = atom<WorkspaceMember | null>((get) => {
    const config = get(workspaceSkeletonConfigAtom)
    if (!config.showSkeleton) return null

    return generateSkeletonMember(0) // First member as current user
})

// ============================================================================
// Workspace Statistics Skeleton Atoms
// ============================================================================

/**
 * Workspace stats skeleton atom
 */
export const workspaceStatsSkeletonAtom = atom({
    workspaceId: "skeleton-workspace-id",
    workspaceName: "Loading Workspace...",
    totalMembers: 0,
    adminCount: 0,
    memberCount: 0,
    hasMembers: false,
    hasCurrentUser: false,
    currentUserRole: null,
    loading: true,
    skeleton: true,
    recommendations: {
        shouldInviteMembers: false,
        hasAdmins: false,
        needsMoreAdmins: false,
    },
})

// ============================================================================
// Skeleton Control Atoms
// ============================================================================

/**
 * Workspace skeleton visibility atom
 */
export const workspaceSkeletonVisibilityAtom = atom(
    (get) => get(workspaceSkeletonConfigAtom).showSkeleton,
    (get, set, show: boolean) => {
        const config = get(workspaceSkeletonConfigAtom)
        set(workspaceSkeletonConfigAtom, {
            ...config,
            showSkeleton: show,
        })
    },
)

/**
 * Workspace skeleton member count atom
 */
export const workspaceSkeletonMemberCountAtom = atom(
    (get) => get(workspaceSkeletonConfigAtom).memberCount,
    (get, set, count: number) => {
        const config = get(workspaceSkeletonConfigAtom)
        set(workspaceSkeletonConfigAtom, {
            ...config,
            memberCount: Math.max(1, Math.min(20, count)),
        })
    },
)

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a workspace is skeleton data
 */
export const isSkeletonWorkspace = (workspace: Workspace | null): boolean => {
    return workspace?.id === "skeleton-workspace-id"
}

/**
 * Check if a workspace member is skeleton data
 */
export const isSkeletonMember = (member: WorkspaceMember): boolean => {
    return member.id.startsWith("skeleton-member-")
}

/**
 * Filter out skeleton workspace members
 */
export const filterSkeletonMembers = (members: WorkspaceMember[]): WorkspaceMember[] => {
    return members.filter((member) => !isSkeletonMember(member))
}

/**
 * Filter out skeleton workspace
 */
export const filterSkeletonWorkspace = (workspace: Workspace | null): Workspace | null => {
    return isSkeletonWorkspace(workspace) ? null : workspace
}
