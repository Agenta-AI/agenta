import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"

import {toSafeIdSegment} from "./idSegments"
import type {Workspace, WorkspaceMember, WorkspaceRole} from "./types"

/** The scoping project id — the app layer's `getProjectValues()` is unreachable from a package. */
const getProjectValues = () => ({projectId: getDefaultStore().get(projectIdAtom) ?? ""})

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchAllWorkspaceRoles = async (ignoreAxiosError = false) => {
    // Read workspace-scope roles from /access/roles and project to the legacy
    // `{role_name, role_description}` shape callers expect.
    const response = await axios.get(`${getAgentaApiUrl()}/access/roles`, {
        _ignoreError: ignoreAxiosError,
    })
    const data = response.data as Record<
        "organization" | "workspace" | "project",
        {role: string; description?: string | null; permissions: string[]}[]
    >
    const workspaceRoles = data?.workspace ?? []
    return workspaceRoles.map((entry) => ({
        role_name: entry.role,
        role_description: entry.description ?? "",
    })) as Omit<WorkspaceRole, "permissions">[]
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
        },
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
        },
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
        },
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
        },
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
    // The three ids come off the invite link, so they are checked before they reach the URL.
    const orgSegment = toSafeIdSegment(organizationId)
    const workspaceSegment = toSafeIdSegment(workspaceId)
    const projectSegment = toSafeIdSegment(projectId)
    if (orgSegment === null) throw new Error("Invalid organization id in the invite")
    if (workspaceSegment === null) throw new Error("Invalid workspace id in the invite")
    if (projectSegment === null) throw new Error("Invalid project id in the invite")

    const response = await axios.post(
        `${getAgentaApiUrl()}/organizations/${orgSegment}/workspaces/${workspaceSegment}/invite/accept?project_id=${projectSegment}`,
        {token, ...(email ? {email} : {})},
        {
            _ignoreError: ignoreAxiosError,
        },
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
        {params: {email, organization_id: organizationId}, _ignoreError: ignoreAxiosError},
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
        `${getAgentaApiUrl()}/organizations/${organizationId}/workspaces/${workspaceId}?project_id=${projectId}`,
        {name},
        {_ignoreError: ignoreAxiosError},
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
        },
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
        },
    )
    return response.data as WorkspaceMember[]
}
