/**
 * Agenta TypeScript SDK — Tools manager.
 *
 * Catalog browsing, connection management, and tool execution.
 *
 * All endpoints are under /preview/tools/ (standard prefix, no legacy flag).
 */

import type {AgentaClient} from "./client"
import type {
    ToolProvidersResponse,
    ToolIntegrationsResponse,
    ToolIntegrationDetailResponse,
    ToolActionsListResponse,
    ToolActionDetailResponse,
    ToolConnectionCreateRequest,
    ToolConnectionResponse,
    ToolConnectionsQueryResponse,
    ToolCallRequest,
    ToolCallResponse,
} from "./types"

export class Tools {
    constructor(private readonly client: AgentaClient) {}

    // ── Catalog ──────────────────────────────────────────────────────────

    async listProviders(): Promise<ToolProvidersResponse> {
        return this.client.get<ToolProvidersResponse>("/tools/catalog/providers/")
    }

    async listIntegrations(
        providerKey: string,
        params?: {search?: string; sort_by?: string; limit?: number; cursor?: string},
    ): Promise<ToolIntegrationsResponse> {
        const searchParams: Record<string, string> = {}
        if (params?.search) searchParams.search = params.search
        if (params?.sort_by) searchParams.sort_by = params.sort_by
        if (params?.limit) searchParams.limit = String(params.limit)
        if (params?.cursor) searchParams.cursor = params.cursor

        return this.client.get<ToolIntegrationsResponse>(
            `/tools/catalog/providers/${providerKey}/integrations/`,
            {params: searchParams},
        )
    }

    async getIntegration(
        providerKey: string,
        integrationKey: string,
    ): Promise<ToolIntegrationDetailResponse> {
        return this.client.get<ToolIntegrationDetailResponse>(
            `/tools/catalog/providers/${providerKey}/integrations/${integrationKey}`,
        )
    }

    async listActions(
        providerKey: string,
        integrationKey: string,
        params?: {
            query?: string
            categories?: string[]
            limit?: number
            cursor?: string
            important?: boolean
        },
    ): Promise<ToolActionsListResponse> {
        const searchParams: Record<string, string> = {}
        if (params?.query) searchParams.query = params.query
        if (params?.limit) searchParams.limit = String(params.limit)
        if (params?.cursor) searchParams.cursor = params.cursor
        if (params?.important) searchParams.important = String(params.important)

        return this.client.get<ToolActionsListResponse>(
            `/tools/catalog/providers/${providerKey}/integrations/${integrationKey}/actions/`,
            {params: searchParams},
        )
    }

    async getAction(
        providerKey: string,
        integrationKey: string,
        actionKey: string,
    ): Promise<ToolActionDetailResponse> {
        return this.client.get<ToolActionDetailResponse>(
            `/tools/catalog/providers/${providerKey}/integrations/${integrationKey}/actions/${actionKey}`,
        )
    }

    // ── Connections ──────────────────────────────────────────────────────

    async queryConnections(params?: {
        provider_key?: string
        integration_key?: string
    }): Promise<ToolConnectionsQueryResponse> {
        const searchParams: Record<string, string> = {}
        if (params?.provider_key) searchParams.provider_key = params.provider_key
        if (params?.integration_key) searchParams.integration_key = params.integration_key

        return this.client.post<ToolConnectionsQueryResponse>("/tools/connections/query", null, {
            params: searchParams,
        })
    }

    async getConnection(connectionId: string): Promise<ToolConnectionResponse> {
        return this.client.get<ToolConnectionResponse>(`/tools/connections/${connectionId}`)
    }

    async createConnection(request: ToolConnectionCreateRequest): Promise<ToolConnectionResponse> {
        return this.client.post<ToolConnectionResponse>("/tools/connections/", request)
    }

    async deleteConnection(connectionId: string): Promise<void> {
        await this.client.delete(`/tools/connections/${connectionId}`)
    }

    async refreshConnection(
        connectionId: string,
        force?: boolean,
    ): Promise<ToolConnectionResponse> {
        const params: Record<string, string> = {}
        if (force) params.force = "true"

        return this.client.post<ToolConnectionResponse>(
            `/tools/connections/${connectionId}/refresh`,
            null,
            {params},
        )
    }

    async revokeConnection(connectionId: string): Promise<ToolConnectionResponse> {
        return this.client.post<ToolConnectionResponse>(`/tools/connections/${connectionId}/revoke`)
    }

    // ── Execution ────────────────────────────────────────────────────────

    async call(request: ToolCallRequest): Promise<ToolCallResponse> {
        return this.client.post<ToolCallResponse>("/tools/call", request)
    }
}
