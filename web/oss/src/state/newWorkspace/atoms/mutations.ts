/**
 * Workspace Mutation Atoms - Workspace Management Operations
 *
 * This module provides mutation atoms for workspace management operations,
 * following the established patterns from newApps, newVariants, newEnvironments, newOrg, and newProfile.
 */

import {message} from "antd"
import {atom} from "jotai"
import {atomWithMutation, queryClientAtom} from "jotai-tanstack-query"

import {WorkspaceMember} from "@/oss/lib/Types"
import {
    inviteMemberToWorkspace,
    removeMemberFromWorkspace,
    updateMemberRole,
    updateWorkspaceSettings,
} from "@/oss/services/workspace/api"

import {currentWorkspaceAtom, userAtom} from "./workspace"

// ============================================================================
// Member Invitation Mutation
// ============================================================================

export interface InviteMemberInput {
    email: string
    role?: "admin" | "member"
    message?: string
}

/**
 * Invite member to workspace mutation atom
 */
export const inviteMemberMutationAtom = atomWithMutation<WorkspaceMember, InviteMemberInput>(
    (get) => ({
        mutationFn: async (input: InviteMemberInput): Promise<WorkspaceMember> => {
            const workspace = get(currentWorkspaceAtom)
            if (!workspace?.id) {
                throw new Error("No workspace selected")
            }

            const result = await inviteMemberToWorkspace(workspace.id, {
                email: input.email,
                role: input.role || "member",
                message: input.message,
            })
            return result
        },
        onSuccess: (newMember, variables) => {
            const queryClient = get(queryClientAtom)
            const workspace = get(currentWorkspaceAtom)
            const user = get(userAtom)

            if (workspace?.id && user?.id) {
                // Invalidate workspace members query
                queryClient.invalidateQueries({
                    queryKey: ["workspaceMembers", workspace.id, user.id],
                })
            }

            message.success(`Invitation sent to ${variables.email}`)
            console.log("👥 Member invited:", variables.email)
        },
        onError: (error, variables) => {
            console.error("Failed to invite member:", error)
            message.error(`Failed to invite ${variables.email}`)
        },
    }),
)

// ============================================================================
// Member Removal Mutation
// ============================================================================

export interface RemoveMemberInput {
    memberId: string
    memberEmail: string
}

/**
 * Remove member from workspace mutation atom
 */
export const removeMemberMutationAtom = atomWithMutation<void, RemoveMemberInput>((get) => ({
    mutationFn: async (input: RemoveMemberInput): Promise<void> => {
        const workspace = get(currentWorkspaceAtom)
        if (!workspace?.id) {
            throw new Error("No workspace selected")
        }

        await removeMemberFromWorkspace(workspace.id, input.memberId)
    },
    onSuccess: (_, variables) => {
        const queryClient = get(queryClientAtom)
        const workspace = get(currentWorkspaceAtom)
        const user = get(userAtom)

        if (workspace?.id && user?.id) {
            // Invalidate workspace members query
            queryClient.invalidateQueries({
                queryKey: ["workspaceMembers", workspace.id, user.id],
            })
        }

        message.success(`${variables.memberEmail} removed from workspace`)
        console.log("👥 Member removed:", variables.memberEmail)
    },
    onError: (error, variables) => {
        console.error("Failed to remove member:", error)
        message.error(`Failed to remove ${variables.memberEmail}`)
    },
}))

// ============================================================================
// Member Role Update Mutation
// ============================================================================

export interface UpdateMemberRoleInput {
    memberId: string
    memberEmail: string
    newRole: "admin" | "member"
    currentRole: string
}

/**
 * Update member role mutation atom
 */
export const updateMemberRoleMutationAtom = atomWithMutation<
    WorkspaceMember,
    UpdateMemberRoleInput
>((get) => ({
    mutationFn: async (input: UpdateMemberRoleInput): Promise<WorkspaceMember> => {
        const workspace = get(currentWorkspaceAtom)
        if (!workspace?.id) {
            throw new Error("No workspace selected")
        }

        const result = await updateMemberRole(workspace.id, input.memberId, input.newRole)
        return result
    },
    onSuccess: (updatedMember, variables) => {
        const queryClient = get(queryClientAtom)
        const workspace = get(currentWorkspaceAtom)
        const user = get(userAtom)

        if (workspace?.id && user?.id) {
            // Invalidate workspace members query
            queryClient.invalidateQueries({
                queryKey: ["workspaceMembers", workspace.id, user.id],
            })
        }

        message.success(`${variables.memberEmail} role updated to ${variables.newRole}`)
        console.log("👥 Member role updated:", variables.memberEmail, "->", variables.newRole)
    },
    onError: (error, variables) => {
        console.error("Failed to update member role:", error)
        message.error(`Failed to update role for ${variables.memberEmail}`)
    },
}))

// ============================================================================
// Workspace Settings Update Mutation
// ============================================================================

export interface UpdateWorkspaceSettingsInput {
    name?: string
    description?: string
    settings?: Record<string, any>
}

/**
 * Update workspace settings mutation atom
 */
export const updateWorkspaceSettingsMutationAtom = atomWithMutation<
    any,
    UpdateWorkspaceSettingsInput
>((get) => ({
    mutationFn: async (input: UpdateWorkspaceSettingsInput): Promise<any> => {
        const workspace = get(currentWorkspaceAtom)
        if (!workspace?.id) {
            throw new Error("No workspace selected")
        }

        const result = await updateWorkspaceSettings(workspace.id, input)
        return result
    },
    onSuccess: (updatedWorkspace, variables) => {
        const queryClient = get(queryClientAtom)

        // Invalidate organization queries to refresh workspace data
        queryClient.invalidateQueries({
            queryKey: ["selectedOrg"],
        })

        message.success("Workspace settings updated successfully")
        console.log("👥 Workspace settings updated")
    },
    onError: (error, variables) => {
        console.error("Failed to update workspace settings:", error)
        message.error("Failed to update workspace settings")
    },
}))

// ============================================================================
// Bulk Member Operations
// ============================================================================

/**
 * Refresh workspace data mutation atom
 */
export const refreshWorkspaceDataMutationAtom = atom(null, async (get, set) => {
    try {
        const queryClient = get(queryClientAtom)
        const workspace = get(currentWorkspaceAtom)
        const user = get(userAtom)

        if (!workspace?.id || !user?.id) return

        // Invalidate all workspace-related queries
        await queryClient.invalidateQueries({
            queryKey: ["workspaceMembers"],
        })

        message.success("Workspace data refreshed")
        console.log("👥 Workspace data refreshed")
    } catch (error) {
        console.error("Failed to refresh workspace data:", error)
        message.error("Failed to refresh workspace data")
    }
})

// ============================================================================
// Search and Filter Operations
// ============================================================================

/**
 * Clear member search mutation atom
 */
export const clearMemberSearchMutationAtom = atom(null, (get, set) => {
    // Import the search term atom to clear it
    const {memberSearchTermAtom} = require("./workspace")
    set(memberSearchTermAtom, "")
    console.log("👥 Member search cleared")
})

// ============================================================================
// Workspace Utilities
// ============================================================================

/**
 * Workspace mutation loading states atom
 */
export const workspaceMutationLoadingAtom = atom((get) => {
    const inviteMutation = get(inviteMemberMutationAtom)
    const removeMutation = get(removeMemberMutationAtom)
    const updateRoleMutation = get(updateMemberRoleMutationAtom)
    const updateSettingsMutation = get(updateWorkspaceSettingsMutationAtom)

    return {
        invitingMember: inviteMutation.isPending,
        removingMember: removeMutation.isPending,
        updatingRole: updateRoleMutation.isPending,
        updatingSettings: updateSettingsMutation.isPending,
        anyLoading:
            inviteMutation.isPending ||
            removeMutation.isPending ||
            updateRoleMutation.isPending ||
            updateSettingsMutation.isPending,
    }
})

/**
 * Workspace mutation errors atom
 */
export const workspaceMutationErrorsAtom = atom((get) => {
    const inviteMutation = get(inviteMemberMutationAtom)
    const removeMutation = get(removeMemberMutationAtom)
    const updateRoleMutation = get(updateMemberRoleMutationAtom)
    const updateSettingsMutation = get(updateWorkspaceSettingsMutationAtom)

    return {
        inviteError: inviteMutation.error,
        removeError: removeMutation.error,
        updateRoleError: updateRoleMutation.error,
        updateSettingsError: updateSettingsMutation.error,
        hasErrors: !!(
            inviteMutation.error ||
            removeMutation.error ||
            updateRoleMutation.error ||
            updateSettingsMutation.error
        ),
    }
})
