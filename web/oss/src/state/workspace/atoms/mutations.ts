import {message} from "antd"
import {atom} from "jotai"
import {atomWithMutation, atomWithQuery} from "jotai-tanstack-query"

import {WorkspaceRole, OrgDetails} from "@/oss/lib/Types"
import {updateOrganization} from "@/oss/services/organization/api"
import {updateWorkspace, fetchAllWorkspaceRoles} from "@/oss/services/workspace/api"

import {selectedOrgQueryAtom} from "../../org/selectors/org"
import {userAtom} from "../../profile/selectors/user"

/**
 * Mutation atom for updating workspace name
 * Handles both workspace and organization updates, plus cache invalidation
 */
export const updateWorkspaceNameAtom = atomWithMutation<
    void,
    {orgId: string; workspaceId: string; name: string}
>((get) => ({
    mutationKey: ["updateWorkspaceName"],
    mutationFn: async ({orgId, workspaceId, name}) => {
        // Update both workspace and organization in parallel
        await Promise.all([
            updateWorkspace({orgId, workspaceId, name}),
            updateOrganization(orgId, name),
        ])
    },
    onSuccess: (_, {name, orgId}) => {
        // Show success message
        message.success("Workspace renamed")

        // Optimistically update the local cache with the new name
        const selectedOrgQuery = get(selectedOrgQueryAtom)
        if (selectedOrgQuery.data) {
            // Update the query cache directly with the new name
            const updatedOrg: OrgDetails = {
                ...selectedOrgQuery.data,
                name,
                default_workspace: {
                    ...selectedOrgQuery.data.default_workspace,
                    name,
                },
            }

            // Set the updated data in the cache
            selectedOrgQuery.queryClient?.setQueryData(["selectedOrg", orgId], updatedOrg)
        }

        // Also trigger a refetch to ensure data consistency
        if (selectedOrgQuery.refetch) {
            selectedOrgQuery.refetch()
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
        set,
        {
            orgId,
            workspaceId,
            name,
            onSuccess,
        }: {
            orgId: string
            workspaceId: string
            name: string
            onSuccess?: () => void
        },
    ) => {
        try {
            // Execute the mutation
            await set(updateWorkspaceNameAtom, {orgId, workspaceId, name})

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
