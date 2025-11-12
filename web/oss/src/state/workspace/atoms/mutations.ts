import {atom} from "jotai"
import {atomWithMutation, atomWithQuery} from "jotai-tanstack-query"

import {message} from "@/oss/components/AppMessageContext"
import {WorkspaceRole} from "@/oss/lib/Types"
import {updateOrganization} from "@/oss/services/organization/api"
import {updateWorkspace, fetchAllWorkspaceRoles} from "@/oss/services/workspace/api"

import {selectedOrganizationQueryAtom, organizationsQueryAtom} from "../../organization/selectors/organization"
import {userAtom} from "../../profile/selectors/user"

/**
 * Mutation atom for updating workspace name
 * Handles both workspace and organization updates, plus cache invalidation
 */
export const updateWorkspaceNameAtom = atomWithMutation<
    void,
    {organizationId: string; workspaceId: string; name: string}
>((get) => ({
    mutationKey: ["updateWorkspaceName"],
    mutationFn: async ({organizationId, workspaceId, name}) => {
        // Update both workspace and organization in parallel
        await Promise.all([
            updateWorkspace({organizationId, workspaceId, name}),
            updateOrganization(organizationId, name),
        ])
    },
    onSuccess: (_, {name, organizationId}) => {
        // Show success message
        message.success("Workspace renamed")

        // Optimistically update the local cache with the new name
        const selectedOrganizationQuery = get(selectedOrganizationQueryAtom)

        // Also trigger a refetch to ensure data consistency
        if (selectedOrganizationQuery.refetch) {
            selectedOrganizationQuery.refetch()
        }

        // Refetch organizations list to ensure sidebar and organization lists reflect the new name
        const organizationsQuery = get(organizationsQueryAtom)
        if (organizationsQuery.refetch) {
            organizationsQuery.refetch()
        }
    },
    onError: (error) => {
        console.error("Failed to update workspace name:", error)
        message.error("Failed to rename workspace")
    },
}))

/**
 * Action atom for updating workspace name with UI state management
 * This handles the complete flow including UI state updates
 */
export const updateWorkspaceNameActionAtom = atom(
    null,
    async (
        get,
        _set,
        {
            organizationId,
            workspaceId,
            name,
            onSuccess,
        }: {
            organizationId: string
            workspaceId: string
            name: string
            onSuccess?: () => void
        },
    ) => {
        try {
            // Execute the mutation using mutateAsync from the mutation atom
            const {mutateAsync} = get(updateWorkspaceNameAtom)
            await mutateAsync({organizationId, workspaceId, name})

            // Call success callback if provided
            if (onSuccess) {
                onSuccess()
            }
        } catch (error) {
            // Error handling is already done in the mutation atom
            throw error
        }
    },
)

/**
 * Query atom for fetching workspace roles
 * Fetches all available workspace roles for the application
 */
export const workspaceRolesQueryAtom = atomWithQuery<Omit<WorkspaceRole, "permissions">[]>(
    (get) => {
        const user = get(userAtom)

        return {
            queryKey: ["workspaceRoles"],
            queryFn: () => fetchAllWorkspaceRoles(),
            staleTime: 1000 * 60 * 10, // 10 minutes - roles don't change often
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            refetchOnMount: false,
            enabled: !!user?.id,
            retry: (failureCount, error) => {
                // Don't retry on client errors (404, etc.)
                if (
                    (error as any)?.response?.status >= 400 &&
                    (error as any)?.response?.status < 500
                ) {
                    return false
                }
                return failureCount < 2
            },
        }
    },
)
