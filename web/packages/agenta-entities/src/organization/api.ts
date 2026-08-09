import {axios, getAgentaApiUrl} from "@agenta/shared/api"

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
    try {
        const {data} = await axios.get(`${getAgentaApiUrl()}/organizations/${organizationId}`)
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

/**
 * Fetch all domains for an organization
 */
export const fetchOrganizationDomains = async (): Promise<OrganizationDomain[]> => {
    const response = await axios.get(`${getAgentaApiUrl()}/organizations/domains/`, {
        _ignoreError: true,
    })
    return response.data
}

/**
 * Create a new domain for verification
 */
export const createOrganizationDomain = async (payload: {
    domain: string
    name?: string
    description?: string
}): Promise<OrganizationDomain> => {
    const response = await axios.post(`${getAgentaApiUrl()}/organizations/domains/`, payload, {
        _ignoreError: true,
    })
    return response.data
}

/**
 * Verify a domain via DNS TXT record
 */
export const verifyOrganizationDomain = async (domainId: string): Promise<OrganizationDomain> => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/organizations/domains/verify`,
        {
            domain_id: domainId,
        },
        {
            _ignoreError: true,
        },
    )
    return response.data
}

/**
 * Refresh the verification token for an unverified domain
 */
export const refreshOrganizationDomainToken = async (
    domainId: string,
): Promise<OrganizationDomain> => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/organizations/domains/${domainId}/refresh`,
        undefined,
        {
            _ignoreError: true,
        },
    )
    return response.data
}

/**
 * Delete a domain from an organization
 */
export const deleteOrganizationDomain = async (domainId: string): Promise<void> => {
    await axios.delete(`${getAgentaApiUrl()}/organizations/domains/${domainId}`, {
        _ignoreError: true,
    })
}

// ============================================================================
// SSO/OIDC Provider API
// ============================================================================

/**
 * Fetch all SSO providers for an organization
 */
export const fetchOrganizationProviders = async (): Promise<OrganizationProvider[]> => {
    const response = await axios.get(`${getAgentaApiUrl()}/organizations/providers/`, {
        _ignoreError: true,
    })
    return response.data
}

/**
 * Create a new SSO/OIDC provider for an organization
 */
export const createOrganizationProvider = async (payload: {
    slug: string
    name?: string
    description?: string
    flags?: Record<string, boolean>
    settings: OrganizationProviderSettings
}): Promise<OrganizationProvider> => {
    const response = await axios.post(`${getAgentaApiUrl()}/organizations/providers/`, payload, {
        _ignoreError: true,
    })
    return response.data
}

/**
 * Update an SSO/OIDC provider
 */
export const updateOrganizationProvider = async (
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
            _ignoreError: true,
        },
    )
    return response.data
}

/**
 * Test an SSO/OIDC provider connection
 */
export const testOrganizationProvider = async (
    providerId: string,
): Promise<OrganizationProvider> => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/organizations/providers/${providerId}/test`,
        undefined,
        {
            _ignoreError: true,
        },
    )
    return response.data
}

/**
 * Delete an SSO/OIDC provider
 */
export const deleteOrganizationProvider = async (providerId: string): Promise<void> => {
    await axios.delete(`${getAgentaApiUrl()}/organizations/providers/${providerId}`, {
        _ignoreError: true,
    })
}
