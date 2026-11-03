import {getAccessClient, getOrganizationsClient} from "@agenta/sdk/resources"
import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"
import {z} from "zod"

import {safeParseWithLogging} from "../shared/utils/zodSchema"

import {toSafeIdSegment} from "./idSegments"
import type {
    OrganizationDomain,
    OrganizationProvider,
    OrganizationProviderSettings,
    Workspace,
    WorkspaceMember,
    WorkspaceRole,
} from "./types"

/** The scoping project id — the app layer's `getProjectValues()` is unreachable from a package. */
const getProjectValues = () => ({projectId: getDefaultStore().get(projectIdAtom) ?? ""})

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

/** `/access/roles`: the catalog per scope, and the roles this organization may set now. */
const roleCatalogEntrySchema = z.object({
    role: z.string(),
    description: z.string().nullish(),
    permissions: z.array(z.string()).optional(),
})

const accessRolesResponseSchema = z.object({
    project: z.array(roleCatalogEntrySchema),
    offered: z.object({roles: z.array(z.string()), floor_role: z.string()}),
})

/**
 * The roles an invite or a role change may set in this organization, in catalog order.
 *
 * The plan decides the list, and it never holds `owner`: ownership moves by transfer only, and
 * both routes refuse anything the plan does not offer. Each entry keeps the catalog's
 * description.
 *
 * The route answers for the caller's organization, which the request's auth scope names, so the
 * project rides along: a session with no project is scoped to the default one, which can belong
 * to another organization.
 */
export const fetchOfferedRoles = async (
    projectId?: string,
): Promise<Omit<WorkspaceRole, "permissions">[]> => {
    const raw = await getAccessClient().fetchAccessRoles({
        queryParams: projectId ? {project_id: projectId} : undefined,
    })
    const data = safeParseWithLogging(accessRolesResponseSchema, raw, "[fetchOfferedRoles]")
    if (!data) throw new Error("The roles answer did not validate")
    const offered = new Set(data.offered.roles)
    // The API offers roles from the project catalog, which the access check reads.
    return data.project
        .filter((entry) => offered.has(entry.role))
        .map((entry) => ({
            role_name: entry.role,
            role_description: entry.description ?? "",
        }))
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

// ============================================================================
// Organization access: domains, SSO providers and the immutable slug.
// ============================================================================
// These are the Fern-backed equivalents of the legacy axios calls in `api.ts`.
// The names stay in one object so they do not collide with the existing exports.

const organizationsClient = () => getOrganizationsClient()

export const organizationAccessApi = {
    fetchOrganizationDomains: async (projectId: string): Promise<OrganizationDomain[]> =>
        (await organizationsClient().listOrganizationDomains({
            queryParams: {project_id: projectId},
        })) as unknown as OrganizationDomain[],

    createOrganizationDomain: async (
        projectId: string,
        payload: {domain: string; name?: string; description?: string},
    ): Promise<OrganizationDomain> =>
        (await organizationsClient().createOrganizationDomain(payload, {
            queryParams: {project_id: projectId},
        })) as unknown as OrganizationDomain,

    verifyOrganizationDomain: async (
        projectId: string,
        domainId: string,
    ): Promise<OrganizationDomain> =>
        (await organizationsClient().verifyOrganizationDomain(
            {domain_id: domainId},
            {queryParams: {project_id: projectId}},
        )) as unknown as OrganizationDomain,

    refreshOrganizationDomainToken: async (
        projectId: string,
        domainId: string,
    ): Promise<OrganizationDomain> =>
        (await organizationsClient().refreshOrganizationDomainToken(
            {domain_id: domainId},
            {queryParams: {project_id: projectId}},
        )) as unknown as OrganizationDomain,

    deleteOrganizationDomain: async (projectId: string, domainId: string): Promise<void> => {
        await organizationsClient().deleteOrganizationDomain(
            {domain_id: domainId},
            {queryParams: {project_id: projectId}},
        )
    },

    fetchOrganizationProviders: async (projectId: string): Promise<OrganizationProvider[]> =>
        (await organizationsClient().listOrganizationProviders({
            queryParams: {project_id: projectId},
        })) as unknown as OrganizationProvider[],

    createOrganizationProvider: async (
        projectId: string,
        payload: {
            slug: string
            name?: string
            description?: string
            flags?: Record<string, boolean>
            settings: OrganizationProviderSettings
        },
    ): Promise<OrganizationProvider> => {
        const {settings, ...rest} = payload
        return (await organizationsClient().createOrganizationProvider(
            {...rest, settings: {...settings} as Record<string, unknown>},
            {queryParams: {project_id: projectId}},
        )) as unknown as OrganizationProvider
    },

    updateOrganizationProvider: async (
        projectId: string,
        providerId: string,
        payload: {
            slug?: string
            name?: string
            description?: string
            settings?: OrganizationProviderSettings
            flags?: Record<string, boolean>
        },
    ): Promise<OrganizationProvider> => {
        const {settings, ...rest} = payload
        return (await organizationsClient().updateOrganizationProvider(
            {
                provider_id: providerId,
                ...rest,
                ...(settings ? {settings: {...settings} as Record<string, unknown>} : {}),
            },
            {queryParams: {project_id: projectId}},
        )) as unknown as OrganizationProvider
    },

    testOrganizationProvider: async (
        projectId: string,
        providerId: string,
    ): Promise<OrganizationProvider> =>
        (await organizationsClient().testOrganizationProvider(
            {provider_id: providerId},
            {queryParams: {project_id: projectId}},
        )) as unknown as OrganizationProvider,

    deleteOrganizationProvider: async (projectId: string, providerId: string): Promise<void> => {
        await organizationsClient().deleteOrganizationProvider(
            {provider_id: providerId},
            {queryParams: {project_id: projectId}},
        )
    },

    updateOrganizationSlug: async (organizationId: string, slug: string): Promise<void> => {
        await organizationsClient().patchOrganization({
            organization_id: organizationId,
            body: {slug},
        })
    },
}
