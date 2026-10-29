import {axios, getAgentaApiUrl} from "@agenta/shared/api"

import {toSafeIdSegment} from "./idSegments"
import type {
    Org,
    OrgDetails,
    OrganizationDomain,
    OrganizationProvider,
    OrganizationProviderSettings,
    OrganizationUpdatePayload,
} from "./types"

export const checkOrganizationAccess = async (organizationId: string) => {
    const response = await axios.get(`${getAgentaApiUrl()}/auth/access`, {
        params: {organization_id: organizationId},
        _skipAuthUpgradeRedirect: true,
        _ignoreError: true,
        validateStatus: () => true,
    })

    const detailError = response.data?.detail?.error
    if (response.status >= 200 && response.status < 300 && !detailError) {
        return {ok: true, response}
    }

    return {ok: false, response}
}

/**
 * Both reads go through the shared axios instance, which carries auth via its interceptor — the
 * desktop split them onto a separate fetch client for no behavioural reason, and a package cannot
 * reach that client anyway. Each still answers empty rather than throwing, as its callers expect.
 */
export const fetchAllOrgsList = async (): Promise<Org[]> => {
    try {
        const {data} = await axios.get(`${getAgentaApiUrl()}/organizations`)
        return Array.isArray(data) ? data : []
    } catch (error) {
        if ((error as {response?: {status?: number}})?.response?.status === 401) return []
        console.error("Failed to fetch organizations", error)
        return []
    }
}

export const fetchSingleOrg = async ({
    organizationId,
}: {
    organizationId: string
}): Promise<OrgDetails | null> => {
    const segment = toSafeIdSegment(organizationId)
    if (segment === null) {
        console.error("Refused to fetch organization with an unsafe id", organizationId)
        return null
    }
    try {
        const {data} = await axios.get(`${getAgentaApiUrl()}/organizations/${segment}`)
        return data ?? null
    } catch (error) {
        if ((error as {response?: {status?: number}})?.response?.status === 401) return null
        console.error("Failed to fetch organization", organizationId, error)
        return null
    }
}

export const updateOrganization = async (
    organizationId: string,
    payload: OrganizationUpdatePayload | {name: string},
    ignoreAxiosError = false,
) => {
    const response = await axios.patch(
        `${getAgentaApiUrl()}/organizations/${organizationId}`,
        payload,
        {
            _ignoreError: ignoreAxiosError,
        },
    )
    return response.data
}

export const createOrganization = async (data: {name: string; description?: string}) => {
    const response = await axios.post(`${getAgentaApiUrl()}/organizations/`, data)
    return response.data
}

export const deleteOrganization = async (organizationId: string) => {
    const response = await axios.delete(`${getAgentaApiUrl()}/organizations/${organizationId}`)
    return response.data
}

export const transferOrganizationOwnership = async (organizationId: string, newOwnerId: string) => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/organizations/${organizationId}/transfer/${newOwnerId}`,
    )
    return response.data
}
// ============================================================================
// Domain Verification API
// ============================================================================
// The backend scopes these to the org that owns `project_id`, else the user's default org.

/**
 * Fetch all domains for an organization
 */
export const fetchOrganizationDomains = async (
    projectId: string,
): Promise<OrganizationDomain[]> => {
    const response = await axios.get(`${getAgentaApiUrl()}/organizations/domains/`, {
        params: {project_id: projectId},
        _ignoreError: true,
    })
    return response.data
}

/**
 * Create a new domain for verification
 */
export const createOrganizationDomain = async (
    projectId: string,
    payload: {
        domain: string
        name?: string
        description?: string
    },
): Promise<OrganizationDomain> => {
    const response = await axios.post(`${getAgentaApiUrl()}/organizations/domains/`, payload, {
        params: {project_id: projectId},
        _ignoreError: true,
    })
    return response.data
}

/**
 * Verify a domain via DNS TXT record
 */
export const verifyOrganizationDomain = async (
    projectId: string,
    domainId: string,
): Promise<OrganizationDomain> => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/organizations/domains/verify`,
        {
            domain_id: domainId,
        },
        {
            params: {project_id: projectId},
            _ignoreError: true,
        },
    )
    return response.data
}

/**
 * Refresh the verification token for an unverified domain
 */
export const refreshOrganizationDomainToken = async (
    projectId: string,
    domainId: string,
): Promise<OrganizationDomain> => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/organizations/domains/${domainId}/refresh`,
        undefined,
        {
            params: {project_id: projectId},
            _ignoreError: true,
        },
    )
    return response.data
}

/**
 * Delete a domain from an organization
 */
export const deleteOrganizationDomain = async (
    projectId: string,
    domainId: string,
): Promise<void> => {
    await axios.delete(`${getAgentaApiUrl()}/organizations/domains/${domainId}`, {
        params: {project_id: projectId},
        _ignoreError: true,
    })
}

// ============================================================================
// SSO/OIDC Provider API
// ============================================================================
// Scoped by `project_id`, like the domain routes above.

/**
 * Fetch all SSO providers for an organization
 */
export const fetchOrganizationProviders = async (
    projectId: string,
): Promise<OrganizationProvider[]> => {
    const response = await axios.get(`${getAgentaApiUrl()}/organizations/providers/`, {
        params: {project_id: projectId},
        _ignoreError: true,
    })
    return response.data
}

/**
 * Create a new SSO/OIDC provider for an organization
 */
export const createOrganizationProvider = async (
    projectId: string,
    payload: {
        slug: string
        name?: string
        description?: string
        flags?: Record<string, boolean>
        settings: OrganizationProviderSettings
    },
): Promise<OrganizationProvider> => {
    const response = await axios.post(`${getAgentaApiUrl()}/organizations/providers/`, payload, {
        params: {project_id: projectId},
        _ignoreError: true,
    })
    return response.data
}

/**
 * Update an SSO/OIDC provider
 */
export const updateOrganizationProvider = async (
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
    const response = await axios.patch(
        `${getAgentaApiUrl()}/organizations/providers/${providerId}`,
        payload,
        {
            params: {project_id: projectId},
            _ignoreError: true,
        },
    )
    return response.data
}

/**
 * Test an SSO/OIDC provider connection
 */
export const testOrganizationProvider = async (
    projectId: string,
    providerId: string,
): Promise<OrganizationProvider> => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/organizations/providers/${providerId}/test`,
        undefined,
        {
            params: {project_id: projectId},
            _ignoreError: true,
        },
    )
    return response.data
}

/**
 * Delete an SSO/OIDC provider
 */
export const deleteOrganizationProvider = async (
    projectId: string,
    providerId: string,
): Promise<void> => {
    await axios.delete(`${getAgentaApiUrl()}/organizations/providers/${providerId}`, {
        params: {project_id: projectId},
        _ignoreError: true,
    })
}
