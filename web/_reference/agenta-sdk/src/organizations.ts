/**
 * Agenta TypeScript SDK — Organizations manager.
 *
 * Organization CRUD, domain verification, and SSO provider management.
 */

import type {AgentaClient} from "./client"
import type {
    OrganizationUpdatePayload,
    OrganizationDomain,
    OrganizationProvider,
    OrganizationProviderCreateRequest,
    OrganizationProviderUpdateRequest,
} from "./types"

export class Organizations {
    constructor(private readonly client: AgentaClient) {}

    // Core CRUD

    async list<T = unknown>(): Promise<T[]> {
        return this.client.get<T[]>("/organizations", {legacy: true})
    }

    async get<T = unknown>(orgId: string): Promise<T> {
        return this.client.get<T>(`/organizations/${orgId}`, {legacy: true})
    }

    async create(data: {name: string; description?: string}): Promise<unknown> {
        return this.client.post("/organizations/", data, {legacy: true})
    }

    async update(
        orgId: string,
        payload: OrganizationUpdatePayload | {name: string},
    ): Promise<unknown> {
        return this.client.request("PATCH", `/organizations/${orgId}/`, {
            body: payload,
            legacy: true,
        })
    }

    async delete(orgId: string): Promise<void> {
        await this.client.request("DELETE", `/organizations/${orgId}/`, {legacy: true})
    }

    async checkAccess(orgId: string): Promise<{
        ok: boolean
        response: {data?: {detail?: unknown}; status?: number; statusText?: string}
    }> {
        try {
            const data = await this.client.get(`/auth/access`, {
                legacy: true,
                params: {organization_id: orgId},
            })
            return {ok: true, response: {data: data as {detail?: unknown}}}
        } catch (error: unknown) {
            // Preserve error detail for callers that inspect response.data.detail
            const apiError = error as {detail?: string; status?: number; message?: string}
            const detail = apiError?.detail
                ? (() => {
                      try {
                          return JSON.parse(apiError.detail as string)
                      } catch {
                          return apiError.detail
                      }
                  })()
                : null
            return {
                ok: false,
                response: {data: {detail}, status: apiError?.status, statusText: apiError?.message},
            }
        }
    }

    async transferOwnership(orgId: string, newOwnerId: string): Promise<unknown> {
        return this.client.post(`/organizations/${orgId}/transfer/${newOwnerId}`, null, {
            legacy: true,
        })
    }

    // Domains

    async listDomains(): Promise<OrganizationDomain[]> {
        return this.client.get<OrganizationDomain[]>("/organizations/domains", {legacy: true})
    }

    async createDomain(payload: {
        domain: string
        name: string
        description?: string
    }): Promise<OrganizationDomain> {
        return this.client.post<OrganizationDomain>("/organizations/domains", payload, {
            legacy: true,
        })
    }

    async verifyDomain(domainId: string): Promise<OrganizationDomain> {
        return this.client.post<OrganizationDomain>(
            "/organizations/domains/verify",
            {domain_id: domainId},
            {legacy: true},
        )
    }

    async refreshDomainToken(domainId: string): Promise<OrganizationDomain> {
        return this.client.post<OrganizationDomain>(
            `/organizations/domains/${domainId}/refresh`,
            null,
            {legacy: true},
        )
    }

    async deleteDomain(domainId: string): Promise<void> {
        await this.client.request("DELETE", `/organizations/domains/${domainId}`, {legacy: true})
    }

    // SSO/OIDC Providers

    async listProviders(): Promise<OrganizationProvider[]> {
        return this.client.get<OrganizationProvider[]>("/organizations/providers", {legacy: true})
    }

    async createProvider(
        payload: OrganizationProviderCreateRequest,
    ): Promise<OrganizationProvider> {
        return this.client.post<OrganizationProvider>("/organizations/providers", payload, {
            legacy: true,
        })
    }

    async updateProvider(
        id: string,
        payload: OrganizationProviderUpdateRequest,
    ): Promise<OrganizationProvider> {
        return this.client.request<OrganizationProvider>(
            "PATCH",
            `/organizations/providers/${id}`,
            {body: payload, legacy: true},
        )
    }

    async testProvider(id: string): Promise<OrganizationProvider> {
        return this.client.post<OrganizationProvider>(`/organizations/providers/${id}/test`, null, {
            legacy: true,
        })
    }

    async deleteProvider(id: string): Promise<void> {
        await this.client.request("DELETE", `/organizations/providers/${id}`, {legacy: true})
    }
}
