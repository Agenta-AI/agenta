/**
 * Gateway-tool API functions.
 *
 * Thin wrappers over the Fern-generated `tools` resource client that
 * preserve the call signatures the existing hooks/UI rely on. Return
 * types are the Fern wire shapes verbatim — we no longer maintain a
 * parallel set of DTOs.
 */

import type {
    ToolCall,
    ToolCallResponse,
    ToolCatalogActionResponse,
    ToolCatalogActionsResponse,
    ToolCatalogIntegrationResponse,
    ToolCatalogIntegrationsResponse,
    ToolCatalogProvidersResponse,
    ToolConnectionCreatePayload,
    ToolConnectionResponse,
    ToolConnectionsResponse,
} from "../core/types"

import {getToolsClient, projectScopedRequest} from "./client"

// --- Catalog browse ---

export const fetchProviders = async (): Promise<ToolCatalogProvidersResponse> => {
    return getToolsClient().listToolProviders({}, projectScopedRequest())
}

export const fetchIntegrations = async (
    providerKey: string,
    params?: {search?: string; sort_by?: string; limit?: number; cursor?: string},
): Promise<ToolCatalogIntegrationsResponse> => {
    return getToolsClient().listToolIntegrations(
        {
            provider_key: providerKey,
            search: params?.search,
            sort_by: params?.sort_by,
            limit: params?.limit,
            cursor: params?.cursor,
        },
        projectScopedRequest(),
    )
}

export const fetchIntegrationDetail = async (
    providerKey: string,
    integrationKey: string,
): Promise<ToolCatalogIntegrationResponse> => {
    return getToolsClient().fetchToolIntegration(
        {provider_key: providerKey, integration_key: integrationKey},
        projectScopedRequest(),
    )
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
): Promise<ToolCatalogActionsResponse> => {
    // `important` isn't modelled on Fern's ListToolActionsRequest (the
    // OpenAPI spec hasn't been regenerated to include it) but the backend
    // still honours it as a query param — pass it through alongside the
    // `project_id` scope.
    const scope = projectScopedRequest()
    const queryParams = {
        ...(scope?.queryParams ?? {}),
        ...(params?.important !== undefined ? {important: params.important} : {}),
    }
    return getToolsClient().listToolActions(
        {
            provider_key: providerKey,
            integration_key: integrationKey,
            query: params?.query,
            categories: params?.categories,
            limit: params?.limit,
            cursor: params?.cursor,
        },
        {queryParams},
    )
}

export const fetchActionDetail = async (
    providerKey: string,
    integrationKey: string,
    actionKey: string,
): Promise<ToolCatalogActionResponse> => {
    return getToolsClient().fetchToolAction(
        {
            provider_key: providerKey,
            integration_key: integrationKey,
            action_key: actionKey,
        },
        projectScopedRequest(),
    )
}

// --- Connections ---

export const queryConnections = async (params?: {
    provider_key?: string
    integration_key?: string
}): Promise<ToolConnectionsResponse> => {
    return getToolsClient().queryToolConnections(
        {
            provider_key: params?.provider_key,
            integration_key: params?.integration_key,
        },
        projectScopedRequest(),
    )
}

export const fetchConnection = async (connectionId: string): Promise<ToolConnectionResponse> => {
    return getToolsClient().fetchToolConnection(
        {connection_id: connectionId},
        projectScopedRequest(),
    )
}

export const createConnection = async (
    payload: ToolConnectionCreatePayload,
): Promise<ToolConnectionResponse> => {
    // Cast through Parameters<...> because Fern's typed payload doesn't
    // model the legacy `credentials` field that the backend still accepts.
    return getToolsClient().createToolConnection(
        payload as Parameters<ReturnType<typeof getToolsClient>["createToolConnection"]>[0],
        projectScopedRequest(),
    )
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
): Promise<ToolConnectionResponse> => {
    return getToolsClient().refreshToolConnection(
        {connection_id: connectionId, force},
        projectScopedRequest(),
    )
}

export const revokeToolConnection = async (
    connectionId: string,
): Promise<ToolConnectionResponse> => {
    return getToolsClient().revokeToolConnection(
        {connection_id: connectionId},
        projectScopedRequest(),
    )
}

// --- Tool execution ---

export const executeToolCall = async (payload: ToolCall): Promise<ToolCallResponse> => {
    return getToolsClient().callTool(payload, projectScopedRequest())
}
