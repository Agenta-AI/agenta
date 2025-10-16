import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {WorkspaceRole, Workspace, WorkspaceMember} from "@/oss/lib/Types"
import {getProjectValues} from "@/oss/state/project"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchAllWorkspaceRoles = async (ignoreAxiosError = false) => {
    const {projectId} = getProjectValues()

    const response = await axios.get(
        `${getAgentaApiUrl()}/workspaces/roles?project_id=${projectId}`,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data as Omit<WorkspaceRole, "permissions">[]
}

export const assignWorkspaceRole = async (
    {
        organizationId,
        workspaceId,
        email,
        role,
    }: {organizationId: string; workspaceId: string; email: string; role: string},
    ignoreAxiosError = false,
) => {
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/workspaces/${workspaceId}/roles?project_id=${projectId}`,
        {email, organization_id: organizationId, role},
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data
}

export const unAssignWorkspaceRole = async (
    {
        organizationId,
        workspaceId,
        email,
        role,
    }: {organizationId: string; workspaceId: string; email: string; role: string},
    ignoreAxiosError = false,
) => {
    const {projectId} = getProjectValues()

    const response = await axios.delete(
        `${getAgentaApiUrl()}/workspaces/${workspaceId}/roles?project_id=${projectId}`,
        {
            params: {email, organization_id: organizationId, role},
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data
}

// workspace invitation
export const inviteToWorkspace = async (
    {
        data,
        organizationId,
        workspaceId,
    }: {
        organizationId: string
        workspaceId: string
        data: {email: string; roles?: string[]}[]
    },
    ignoreAxiosError = false,
) => {
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/organizations/${organizationId}/workspaces/${workspaceId}/invite?project_id=${projectId}`,
        data,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data
}

export const resendInviteToWorkspace = async (
    {
        email,
        organizationId,
        workspaceId,
    }: {organizationId: string; workspaceId: string; email: string},
    ignoreAxiosError = false,
) => {
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/organizations/${organizationId}/workspaces/${workspaceId}/invite/resend?project_id=${projectId}`,
        {email},
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data
}

export const acceptWorkspaceInvite = async (
    {
        token,
        organizationId,
        workspaceId,
        projectId,
        email,
    }: {
        token: string
        organizationId: string
        workspaceId: string
        projectId: string
        email?: string
    },
    ignoreAxiosError = false,
) => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/organizations/${organizationId}/workspaces/${workspaceId}/invite/accept?project_id=${projectId}`,
        {token, ...(email ? {email} : {})},
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data
}

export const removeFromWorkspace = async (
    {
        organizationId,
        workspaceId,
        email,
    }: {organizationId: string; workspaceId: string; email: string},
    ignoreAxiosError = false,
) => {
    const {projectId} = getProjectValues()

    const response = await axios.delete(
        `${getAgentaApiUrl()}/workspaces/${workspaceId}/users?project_id=${projectId}`,
        {params: {email, organization_id: organizationId}, _ignoreError: ignoreAxiosError} as any,
    )
    return response.data
}

export const updateWorkspace = async (
    {
        organizationId,
        workspaceId,
        name,
    }: {organizationId: string; workspaceId: string; name: string},
    ignoreAxiosError = false,
) => {
    const {projectId} = getProjectValues()

    const response = await axios.put(
        `${getAgentaApiUrl()}/organizations/${organizationId}/workspaces/${workspaceId}/?project_id=${projectId}`,
        {name},
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response.data
}

export const fetchWorkspaceDetails = async (
    workspaceId: string,
    ignoreAxiosError = false,
): Promise<Workspace> => {
    const {projectId} = getProjectValues()

    const response = await axios.get(
        `${getAgentaApiUrl()}/workspaces/${workspaceId}?project_id=${projectId}`,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data as Workspace
}

export const fetchWorkspaceMembers = async (
    workspaceId: string,
    ignoreAxiosError = false,
): Promise<WorkspaceMember[]> => {
    const {projectId} = getProjectValues()

    const response = await axios.get(
        `${getAgentaApiUrl()}/workspaces/${workspaceId}/members?project_id=${projectId}`,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data as WorkspaceMember[]
}
