import {getCurrentProject} from "@/oss/contexts/project.context"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"
import {WorkspaceRole} from "@/oss/lib/Types"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchAllWorkspaceRoles = async (ignoreAxiosError = false) => {
    const {projectId} = getCurrentProject()

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
        orgId,
        workspaceId,
        email,
        role,
    }: {orgId: string; workspaceId: string; email: string; role: string},
    ignoreAxiosError = false,
) => {
    const {projectId} = getCurrentProject()

    const response = await axios.post(
        `${getAgentaApiUrl()}/workspaces/${workspaceId}/roles?project_id=${projectId}`,
        {email, organization_id: orgId, role},
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data
}

export const unAssignWorkspaceRole = async (
    {
        orgId,
        workspaceId,
        email,
        role,
    }: {orgId: string; workspaceId: string; email: string; role: string},
    ignoreAxiosError = false,
) => {
    const {projectId} = getCurrentProject()

    const response = await axios.delete(
        `${getAgentaApiUrl()}/workspaces/${workspaceId}/roles?project_id=${projectId}`,
        {
            params: {email, org_id: orgId, role},
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data
}

// workspace invitation
export const inviteToWorkspace = async (
    {
        data,
        orgId,
        workspaceId,
    }: {
        orgId: string
        workspaceId: string
        data: {email: string; roles?: string[]}[]
    },
    ignoreAxiosError = false,
) => {
    const {projectId} = getCurrentProject()

    const response = await axios.post(
        `${getAgentaApiUrl()}/organizations/${orgId}/workspaces/${workspaceId}/invite?project_id=${projectId}`,
        data,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data
}

export const resendInviteToWorkspace = async (
    {email, orgId, workspaceId}: {orgId: string; workspaceId: string; email: string},
    ignoreAxiosError = false,
) => {
    const {projectId} = getCurrentProject()

    const response = await axios.post(
        `${getAgentaApiUrl()}/organizations/${orgId}/workspaces/${workspaceId}/invite/resend?project_id=${projectId}`,
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
        orgId,
        workspaceId,
        projectId,
        email,
    }: {token: string; orgId: string; workspaceId: string; projectId: string; email?: string},
    ignoreAxiosError = false,
) => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/organizations/${orgId}/workspaces/${workspaceId}/invite/accept?project_id=${projectId}`,
        {token, ...(email ? {email} : {})},
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )
    return response.data
}

export const removeFromWorkspace = async (
    {orgId, workspaceId, email}: {orgId: string; workspaceId: string; email: string},
    ignoreAxiosError = false,
) => {
    const {projectId} = getCurrentProject()

    const response = await axios.delete(
        `${getAgentaApiUrl()}/workspaces/${workspaceId}/users?project_id=${projectId}`,
        {params: {email, org_id: orgId}, _ignoreError: ignoreAxiosError} as any,
    )
    return response.data
}

export const updateWorkspace = async (
    {orgId, workspaceId, name}: {orgId: string; workspaceId: string; name: string},
    ignoreAxiosError = false,
) => {
    const {projectId} = getCurrentProject()

    const response = await axios.put(
        `${getAgentaApiUrl()}/organizations/${orgId}/workspaces/${workspaceId}/?project_id=${projectId}`,
        {name},
        {_ignoreError: ignoreAxiosError} as any,
    )
    return response.data
}
