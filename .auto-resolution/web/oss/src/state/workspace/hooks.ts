import {useAtomValue, useSetAtom} from "jotai"

import {
    updateWorkspaceNameActionAtom,
    updateWorkspaceNameAtom,
    workspaceRolesQueryAtom,
} from "./atoms/mutations"
import {
    filteredWorkspaceMembersAtom,
    memberSearchTermAtom,
    workspaceMembersAtom,
} from "./atoms/selectors"

/**
 * Hook for updating workspace name
 * Returns mutation state and action function
 */
export const useUpdateWorkspaceName = () => {
    const mutation = useAtomValue(updateWorkspaceNameAtom)
    const updateWorkspaceName = useSetAtom(updateWorkspaceNameActionAtom)

    return {
        updateWorkspaceName,
        isPending: mutation.isPending,
        isError: mutation.isError,
        error: mutation.error,
        isSuccess: mutation.isSuccess,
    }
}

/**
 * Hook for fetching workspace roles
 * Returns workspace roles data and loading state
 */
export const useWorkspaceRoles = () => {
    const {data: roles, isPending, error, isError, refetch} = useAtomValue(workspaceRolesQueryAtom)

    return {
        roles: roles ?? [],
        isLoading: isPending,
        error,
        isError,
        refetch,
    }
}

/**
 * Hook for workspace members with search functionality
 * Returns filtered members and search controls
 */
export const useWorkspaceMembers = () => {
    const allMembers = useAtomValue(workspaceMembersAtom)
    const filteredMembers = useAtomValue(filteredWorkspaceMembersAtom)
    const setSearchTerm = useSetAtom(memberSearchTermAtom)
    const searchTerm = useAtomValue(memberSearchTermAtom)

    return {
        members: allMembers,
        filteredMembers,
        searchTerm,
        setSearchTerm,
    }
}
