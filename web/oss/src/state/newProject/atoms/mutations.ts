/**
 * Project Mutation Atoms - Project Management Operations
 *
 * This module provides mutation atoms for project management operations,
 * following the established patterns from newApps, newVariants, newEnvironments,
 * newOrg, newProfile, and newWorkspace.
 */

import {message} from "antd"
import {atom} from "jotai"
import {atomWithMutation, queryClientAtom} from "jotai-tanstack-query"

import {createProject, updateProject, deleteProject} from "@/oss/services/project"
import {ProjectsResponse} from "@/oss/services/project/types"

import {selectedOrgIdAtom} from "../../newOrg/atoms/orgs"
import {userAtom} from "../../newProfile/atoms/profile"

// ============================================================================
// Project Creation Mutation
// ============================================================================

export interface CreateProjectInput {
    project_name: string
    workspace_id?: string
    description?: string
}

/**
 * Create project mutation atom
 */
export const createProjectMutationAtom = atomWithMutation<ProjectsResponse, CreateProjectInput>(
    (get) => ({
        mutationFn: async (input: CreateProjectInput): Promise<ProjectsResponse> => {
            const result = await createProject(input)
            return result
        },
        onSuccess: (newProject, variables) => {
            const queryClient = get(queryClientAtom)
            const orgId = get(selectedOrgIdAtom)
            const user = get(userAtom)

            // Invalidate projects list
            if (orgId && user?.id) {
                queryClient.invalidateQueries({
                    queryKey: ["projects", orgId, user.id],
                })
            }

            message.success(`Project "${newProject.project_name}" created successfully`)
            console.log("📋 Project created:", newProject.project_name)
        },
        onError: (error, variables) => {
            console.error("Failed to create project:", error)
            message.error(`Failed to create project "${variables.project_name}"`)
        },
    }),
)

// ============================================================================
// Project Update Mutation
// ============================================================================

export interface UpdateProjectInput {
    project_id: string
    project_name?: string
    description?: string
}

/**
 * Update project mutation atom
 */
export const updateProjectMutationAtom = atomWithMutation<ProjectsResponse, UpdateProjectInput>(
    (get) => ({
        mutationFn: async (input: UpdateProjectInput): Promise<ProjectsResponse> => {
            const result = await updateProject(input.project_id, {
                project_name: input.project_name,
                description: input.description,
            })
            return result
        },
        onSuccess: (updatedProject, variables) => {
            const queryClient = get(queryClientAtom)
            const orgId = get(selectedOrgIdAtom)
            const user = get(userAtom)

            // Invalidate projects list
            if (orgId && user?.id) {
                queryClient.invalidateQueries({
                    queryKey: ["projects", orgId, user.id],
                })
            }

            message.success(`Project "${updatedProject.project_name}" updated successfully`)
            console.log("📋 Project updated:", updatedProject.project_name)
        },
        onError: (error, variables) => {
            console.error("Failed to update project:", error)
            message.error("Failed to update project")
        },
    }),
)

// ============================================================================
// Project Deletion Mutation
// ============================================================================

export interface DeleteProjectInput {
    project_id: string
    project_name: string
}

/**
 * Delete project mutation atom
 */
export const deleteProjectMutationAtom = atomWithMutation<void, DeleteProjectInput>((get) => ({
    mutationFn: async (input: DeleteProjectInput): Promise<void> => {
        await deleteProject(input.project_id)
    },
    onSuccess: (_, variables) => {
        const queryClient = get(queryClientAtom)
        const orgId = get(selectedOrgIdAtom)
        const user = get(userAtom)

        // Invalidate projects list
        if (orgId && user?.id) {
            queryClient.invalidateQueries({
                queryKey: ["projects", orgId, user.id],
            })
        }

        message.success(`Project "${variables.project_name}" deleted successfully`)
        console.log("📋 Project deleted:", variables.project_name)
    },
    onError: (error, variables) => {
        console.error("Failed to delete project:", error)
        message.error(`Failed to delete project "${variables.project_name}"`)
    },
}))

// ============================================================================
// Bulk Project Operations
// ============================================================================

/**
 * Refresh all project data mutation atom
 */
export const refreshProjectDataMutationAtom = atom(null, async (get, set) => {
    try {
        const queryClient = get(queryClientAtom)
        const orgId = get(selectedOrgIdAtom)
        const user = get(userAtom)

        if (!orgId || !user?.id) return

        // Invalidate all project-related queries
        await queryClient.invalidateQueries({
            queryKey: ["projects"],
        })

        message.success("Project data refreshed")
        console.log("📋 Project data refreshed")
    } catch (error) {
        console.error("Failed to refresh project data:", error)
        message.error("Failed to refresh project data")
    }
})

// ============================================================================
// Search and Filter Operations
// ============================================================================

/**
 * Clear project search mutation atom
 */
export const clearProjectSearchMutationAtom = atom(null, (get, set) => {
    // Import the search term atom to clear it
    const {projectSearchTermAtom} = require("./project")
    set(projectSearchTermAtom, "")
    console.log("📋 Project search cleared")
})

// ============================================================================
// Project Utilities
// ============================================================================

/**
 * Project mutation loading states atom
 */
export const projectMutationLoadingAtom = atom((get) => {
    const createMutation = get(createProjectMutationAtom)
    const updateMutation = get(updateProjectMutationAtom)
    const deleteMutation = get(deleteProjectMutationAtom)

    return {
        creating: createMutation.isPending,
        updating: updateMutation.isPending,
        deleting: deleteMutation.isPending,
        anyLoading:
            createMutation.isPending || updateMutation.isPending || deleteMutation.isPending,
    }
})

/**
 * Project mutation errors atom
 */
export const projectMutationErrorsAtom = atom((get) => {
    const createMutation = get(createProjectMutationAtom)
    const updateMutation = get(updateProjectMutationAtom)
    const deleteMutation = get(deleteProjectMutationAtom)

    return {
        createError: createMutation.error,
        updateError: updateMutation.error,
        deleteError: deleteMutation.error,
        hasErrors: !!(createMutation.error || updateMutation.error || deleteMutation.error),
    }
})
