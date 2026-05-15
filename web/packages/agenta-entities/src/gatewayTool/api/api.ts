/**
 * Gateway-tool API functions.
 *
 * Thin wrappers over the Fern-generated `tools` resource client that
 * preserve the call signatures the existing hooks/UI rely on. Each wrapper
 * casts the Fern response to the domain type defined in `../core/types`
 * (runtime payload is identical — Fern's generated types are just wider).
 */

import type {
    ActionDetailResponse,
    ActionsListResponse,
    ConnectionCreateRequest,
    ConnectionResponse,
    ConnectionsQueryResponse,
    IntegrationDetailResponse,
    IntegrationsResponse,
    ProvidersResponse,
    ToolCallRequest,
    ToolCallResponse,
} from "../core/types"

import {getToolsClient, projectScopedRequest} from "./client"

// --- Catalog browse ---

export const fetchProviders = async (): Promise<ProvidersResponse> => {
    const result = await getToolsClient().listToolProviders({}, projectScopedRequest())
    return result as unknown as ProvidersResponse
}

export const fetchIntegrations = async (
    providerKey: string,
    params?: {search?: string; sort_by?: string; limit?: number; cursor?: string},
): Promise<IntegrationsResponse> => {
    const result = await getToolsClient().listToolIntegrations(
        {
            provider_key: providerKey,
            search: params?.search,
            sort_by: params?.sort_by,
            limit: params?.limit,
            cursor: params?.cursor,
        },
        projectScopedRequest(),
    )
    return result as unknown as IntegrationsResponse
}

export const fetchIntegrationDetail = async (
    providerKey: string,
    integrationKey: string,
): Promise<IntegrationDetailResponse> => {
    const result = await getToolsClient().fetchToolIntegration(
        {provider_key: providerKey, integration_key: integrationKey},
        projectScopedRequest(),
    )
    return result as unknown as IntegrationDetailResponse
}

export const fetchActions = async (
    providerKey: string,
    integrationKey: string,
    params?: {
        query?: string
        categories?: string[]
        limit?: number
        cursor?: string
        important?: boolean
    },
): Promise<ActionsListResponse> => {
    const result = await getToolsClient().listToolActions(
        {
            provider_key: providerKey,
            integration_key: integrationKey,
            query: params?.query,
            categories: params?.categories,
            limit: params?.limit,
            cursor: params?.cursor,
        },
        projectScopedRequest(),
    )
    return result as unknown as ActionsListResponse
}

export const fetchActionDetail = async (
    providerKey: string,
    integrationKey: string,
    actionKey: string,
): Promise<ActionDetailResponse> => {
    const result = await getToolsClient().fetchToolAction(
        {
            provider_key: providerKey,
            integration_key: integrationKey,
            action_key: actionKey,
        },
        projectScopedRequest(),
    )
    return result as unknown as ActionDetailResponse
}

// --- Connections ---

export const queryConnections = async (params?: {
    provider_key?: string
    integration_key?: string
}): Promise<ConnectionsQueryResponse> => {
    const result = await getToolsClient().queryToolConnections(
        {
            provider_key: params?.provider_key,
            integration_key: params?.integration_key,
        },
        projectScopedRequest(),
    )
    return result as unknown as ConnectionsQueryResponse
}

export const fetchConnection = async (connectionId: string): Promise<ConnectionResponse> => {
    const result = await getToolsClient().fetchToolConnection(
        {connection_id: connectionId},
        projectScopedRequest(),
    )
    return result as unknown as ConnectionResponse
}

export const createConnection = async (
    payload: ConnectionCreateRequest,
): Promise<ConnectionResponse> => {
    const result = await getToolsClient().createToolConnection(
        payload as Parameters<ReturnType<typeof getToolsClient>["createToolConnection"]>[0],
        projectScopedRequest(),
    )
    return result as unknown as ConnectionResponse
}

export const deleteToolConnection = async (connectionId: string): Promise<void> => {
    await getToolsClient().deleteToolConnection(
        {connection_id: connectionId},
        projectScopedRequest(),
    )
}

export const refreshToolConnection = async (
    connectionId: string,
    force?: boolean,
): Promise<ConnectionResponse> => {
    const result = await getToolsClient().refreshToolConnection(
        {connection_id: connectionId, force},
        projectScopedRequest(),
    )
    return result as unknown as ConnectionResponse
}

export const revokeToolConnection = async (connectionId: string): Promise<ConnectionResponse> => {
    const result = await getToolsClient().revokeToolConnection(
        {connection_id: connectionId},
        projectScopedRequest(),
    )
    return result as unknown as ConnectionResponse
}

// --- Tool execution ---

export const executeToolCall = async (payload: ToolCallRequest): Promise<ToolCallResponse> => {
    const result = await getToolsClient().callTool(
        payload as Parameters<ReturnType<typeof getToolsClient>["callTool"]>[0],
        projectScopedRequest(),
    )
    return result as unknown as ToolCallResponse
}
