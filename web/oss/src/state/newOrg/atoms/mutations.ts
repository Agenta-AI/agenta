/**
 * Organization Mutation Atoms - Organization Management Operations
 *
 * This module provides mutation atoms for organization management operations,
 * following the established patterns from newApps, newVariants, and newEnvironments.
 */

import {message} from "antd"
import {atom} from "jotai"
import {atomWithMutation, queryClientAtom} from "jotai-tanstack-query"

import {Org, OrgDetails} from "@/oss/lib/Types"
import {
    createOrganization,
    updateOrganization,
    deleteOrganization,
} from "@/oss/services/organization/api"

import {selectedOrgIdAtom, userAtom} from "../atoms/orgs"

// ============================================================================
// Organization Creation Mutation
// ============================================================================

export interface CreateOrgInput {
    name: string
    description?: string
    type?: "personal" | "team"
}

/**
 * Create organization mutation atom
 */
export const createOrgMutationAtom = atomWithMutation<Org, CreateOrgInput>((get) => ({
    mutationFn: async (input: CreateOrgInput): Promise<Org> => {
        const result = await createOrganization(input)
        return result
    },
    onSuccess: (newOrg, variables) => {
        const queryClient = get(queryClientAtom)
        const user = get(userAtom)

        // Invalidate organizations list
        queryClient.invalidateQueries({
            queryKey: ["orgs", user?.id],
        })

        message.success(`Organization "${newOrg.name}" created successfully`)

        console.log("🏢 Organization created:", newOrg.name)
    },
    onError: (error, variables) => {
        console.error("Failed to create organization:", error)
        message.error(`Failed to create organization "${variables.name}"`)
    },
}))

// ============================================================================
// Organization Update Mutation
// ============================================================================

export interface UpdateOrgInput {
    orgId: string
    name?: string
    description?: string
    settings?: Record<string, any>
}

/**
 * Update organization mutation atom
 */
export const updateOrgMutationAtom = atomWithMutation<OrgDetails, UpdateOrgInput>((get) => ({
    mutationFn: async (input: UpdateOrgInput): Promise<OrgDetails> => {
        const result = await updateOrganization(input.orgId, {
            name: input.name,
            description: input.description,
            settings: input.settings,
        })
        return result
    },
    onSuccess: (updatedOrg, variables) => {
        const queryClient = get(queryClientAtom)
        const user = get(userAtom)

        // Update organizations list
        queryClient.invalidateQueries({
            queryKey: ["orgs", user?.id],
        })

        // Update selected organization if it's the one being updated
        const selectedId = get(selectedOrgIdAtom)
        if (selectedId === variables.orgId) {
            queryClient.invalidateQueries({
                queryKey: ["selectedOrg", selectedId, user?.id],
            })
        }

        message.success(`Organization "${updatedOrg.name}" updated successfully`)

        console.log("🏢 Organization updated:", updatedOrg.name)
    },
    onError: (error, variables) => {
        console.error("Failed to update organization:", error)
        message.error("Failed to update organization")
    },
}))

// ============================================================================
// Organization Deletion Mutation
// ============================================================================

export interface DeleteOrgInput {
    orgId: string
    orgName: string
}

/**
 * Delete organization mutation atom
 */
export const deleteOrgMutationAtom = atomWithMutation<void, DeleteOrgInput>((get) => ({
    mutationFn: async (input: DeleteOrgInput): Promise<void> => {
        await deleteOrganization(input.orgId)
    },
    onSuccess: (_, variables) => {
        const queryClient = get(queryClientAtom)
        const user = get(userAtom)

        // Invalidate organizations list
        queryClient.invalidateQueries({
            queryKey: ["orgs", user?.id],
        })

        // Clear selected organization if it was the deleted one
        const selectedId = get(selectedOrgIdAtom)
        if (selectedId === variables.orgId) {
            // Reset to null, will trigger selection of first available org
            queryClient.setQueryData(["selectedOrg", selectedId, user?.id], null)
        }

        message.success(`Organization "${variables.orgName}" deleted successfully`)

        console.log("🏢 Organization deleted:", variables.orgName)
    },
    onError: (error, variables) => {
        console.error("Failed to delete organization:", error)
        message.error(`Failed to delete organization "${variables.orgName}"`)
    },
}))

// ============================================================================
// Organization Selection Mutation
// ============================================================================

export interface SelectOrgInput {
    orgId: string | null
    orgName?: string
}

/**
 * Select organization mutation atom
 */
export const selectOrgMutationAtom = atom(null, async (get, set, input: SelectOrgInput) => {
    try {
        // Update selected organization ID
        set(selectedOrgIdAtom, input.orgId)

        if (input.orgId && input.orgName) {
            message.success(`Switched to organization "${input.orgName}"`)
            console.log("🏢 Organization selected:", input.orgName)
        } else {
            message.info("Organization selection cleared")
            console.log("🏢 Organization selection cleared")
        }
    } catch (error) {
        console.error("Failed to select organization:", error)
        message.error("Failed to switch organization")
    }
})

// ============================================================================
// Bulk Organization Operations
// ============================================================================

/**
 * Refresh all organization data mutation atom
 */
export const refreshOrgDataMutationAtom = atom(null, async (get, set) => {
    try {
        const queryClient = get(queryClientAtom)
        const user = get(userAtom)

        if (!user?.id) return

        // Invalidate all organization-related queries
        await queryClient.invalidateQueries({
            queryKey: ["orgs"],
        })

        await queryClient.invalidateQueries({
            queryKey: ["selectedOrg"],
        })

        message.success("Organization data refreshed")
        console.log("🏢 Organization data refreshed")
    } catch (error) {
        console.error("Failed to refresh organization data:", error)
        message.error("Failed to refresh organization data")
    }
})

// ============================================================================
// Organization Utilities
// ============================================================================

/**
 * Organization mutation loading states atom
 */
export const orgMutationLoadingAtom = atom((get) => {
    const createMutation = get(createOrgMutationAtom)
    const updateMutation = get(updateOrgMutationAtom)
    const deleteMutation = get(deleteOrgMutationAtom)

    return {
        creating: createMutation.isPending,
        updating: updateMutation.isPending,
        deleting: deleteMutation.isPending,
        anyLoading:
            createMutation.isPending || updateMutation.isPending || deleteMutation.isPending,
    }
})

/**
 * Organization mutation errors atom
 */
export const orgMutationErrorsAtom = atom((get) => {
    const createMutation = get(createOrgMutationAtom)
    const updateMutation = get(updateOrgMutationAtom)
    const deleteMutation = get(deleteOrgMutationAtom)

    return {
        createError: createMutation.error,
        updateError: updateMutation.error,
        deleteError: deleteMutation.error,
        hasErrors: !!(createMutation.error || updateMutation.error || deleteMutation.error),
    }
})
