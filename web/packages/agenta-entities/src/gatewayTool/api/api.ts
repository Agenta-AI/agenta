/**
 * Gateway-tool API functions.
 *
 * Thin wrappers over the Fern-generated `tools` resource client that
 * preserve the call signatures the existing hooks/UI rely on. Return
 * types are the Fern wire shapes verbatim — we no longer maintain a
 * parallel set of DTOs.
 */

import {getAgentaApiUrl} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"

import {safeParseWithLogging} from "../../shared"
import {toolCatalogCategoriesResponseSchema} from "../core"
import type {
    ToolCall,
    ToolCallResponse,
    ToolCatalogActionResponse,
    ToolCatalogActionsResponse,
    ToolCatalogCategoriesResponse,
    ToolCatalogIntegrationResponse,
    ToolCatalogIntegrationsResponse,
    ToolCatalogProvidersResponse,
    ToolConnectionCreatePayload,
    ToolConnectionResponse,
    ToolConnectionsResponse,
} from "../core/types"

import {getLowPriorityToolsClient, getToolsClient, projectScopedRequest} from "./client"

// --- Catalog browse ---

export const fetchToolProviders = async (): Promise<ToolCatalogProvidersResponse> => {
    return getToolsClient().listToolProviders({}, projectScopedRequest())
}

export const fetchToolIntegrations = async (
    providerKey: string,
    params?: {
        search?: string
        sort_by?: string
        category?: string
        limit?: number
        cursor?: string
        lowPriority?: boolean
    },
): Promise<ToolCatalogIntegrationsResponse> => {
    // `category` isn't modelled on Fern's ListToolIntegrationsRequest yet (the
    // OpenAPI spec hasn't been regenerated) but the backend honours it as a query
    // param — pass it through alongside the `project_id` scope.
    const scope = projectScopedRequest()
    const requestOptions = params?.category
        ? {queryParams: {...(scope?.queryParams ?? {}), category: params.category}}
        : scope
    const client = params?.lowPriority ? getLowPriorityToolsClient() : getToolsClient()
    return client.listToolIntegrations(
        {
            provider_key: providerKey,
            search: params?.search,
            sort_by: params?.sort_by,
            limit: params?.limit,
            cursor: params?.cursor,
        },
        requestOptions,
    )
}

export const fetchToolCategories = async (
    providerKey: string,
): Promise<ToolCatalogCategoriesResponse> => {
    // New catalog endpoint not yet in the Fern client — call it directly with the
    // same cookie-auth + project scope the SDK uses. Move to the Fern client on regen.
    const projectId = getDefaultStore().get(projectIdAtom)
    const url = new URL(
        `${getAgentaApiUrl()}/tools/catalog/providers/${encodeURIComponent(
            providerKey,
        )}/categories/`,
    )
    if (projectId) url.searchParams.set("project_id", projectId)

    const res = await fetch(url.toString(), {credentials: "include"})
    if (!res.ok) {
        throw new Error(`fetchToolCategories failed: HTTP ${res.status}`)
    }
    // Boundary validation: this endpoint isn't Fern-typed, so the local schema is the
    // only drift check. On a shape mismatch we log and fall back to an empty list.
    const data = safeParseWithLogging(
        toolCatalogCategoriesResponseSchema,
        await res.json(),
        "[fetchToolCategories]",
    )
    return {count: data?.count ?? 0, categories: data?.categories ?? []}
}

export const fetchToolIntegrationDetail = async (
    providerKey: string,
    integrationKey: string,
): Promise<ToolCatalogIntegrationResponse> => {
    return getToolsClient().fetchToolIntegration(
        {provider_key: providerKey, integration_key: integrationKey},
        projectScopedRequest(),
    )
}

export const fetchToolActions = async (
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

export const fetchToolActionDetail = async (
    providerKey: string,
    integrationKey: string,
    actionKey: string,
    params?: {lowPriority?: boolean},
): Promise<ToolCatalogActionResponse> => {
    const client = params?.lowPriority ? getLowPriorityToolsClient() : getToolsClient()
    return client.fetchToolAction(
        {
            provider_key: providerKey,
            integration_key: integrationKey,
            action_key: actionKey,
        },
        projectScopedRequest(),
    )
}

// --- Connections ---

export const queryToolConnections = async (params?: {
    provider_key?: string
    integration_key?: string
    lowPriority?: boolean
}): Promise<ToolConnectionsResponse> => {
    const client = params?.lowPriority ? getLowPriorityToolsClient() : getToolsClient()
    return client.queryToolConnections(
        {
            provider_key: params?.provider_key,
            integration_key: params?.integration_key,
        },
        projectScopedRequest(),
    )
}

export const fetchToolConnection = async (
    connectionId: string,
): Promise<ToolConnectionResponse> => {
    return getToolsClient().fetchToolConnection(
        {connection_id: connectionId},
        projectScopedRequest(),
    )
}

export const createToolConnection = async (
    payload: ToolConnectionCreatePayload,
): Promise<ToolConnectionResponse> => {
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
