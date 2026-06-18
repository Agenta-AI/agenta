/**
 * Gateway-trigger API functions.
 *
 * Catalog browse + connection list over the `/triggers/*` endpoints. Each
 * response is validated against the frozen zod schema at the boundary
 * (`safeParseWithLogging`), so a backend drift surfaces as a logged parse
 * failure rather than a downstream crash.
 *
 * `/triggers/connections/query` reads the same shared `gateway_connections`
 * rows as `/tools/connections/query` (WP0); the connection shape is reused
 * from gatewayTool so the two lists stay byte-compatible (F2).
 */

import {safeParseWithLogging} from "../../shared"
import {
    triggerCatalogEventResponseSchema,
    triggerCatalogEventsResponseSchema,
    triggerCatalogProviderResponseSchema,
    triggerCatalogProvidersResponseSchema,
    triggerConnectionsResponseSchema,
    type TriggerCatalogEventResponse,
    type TriggerCatalogEventsResponse,
    type TriggerCatalogProviderResponse,
    type TriggerCatalogProvidersResponse,
    type TriggerConnectionsResponse,
} from "../core/types"

import {axios, projectScopedParams, triggersBaseUrl} from "./client"

// --- Catalog browse ---

export const fetchTriggerProviders = async (): Promise<TriggerCatalogProvidersResponse> => {
    const {data} = await axios.get(`${triggersBaseUrl()}/catalog/providers/`, projectScopedParams())
    return (
        safeParseWithLogging(
            triggerCatalogProvidersResponseSchema,
            data,
            "[fetchTriggerProviders]",
        ) ?? {count: 0, providers: []}
    )
}

export const fetchTriggerProvider = async (
    providerKey: string,
): Promise<TriggerCatalogProviderResponse> => {
    const {data} = await axios.get(
        `${triggersBaseUrl()}/catalog/providers/${providerKey}`,
        projectScopedParams(),
    )
    return (
        safeParseWithLogging(
            triggerCatalogProviderResponseSchema,
            data,
            "[fetchTriggerProvider]",
        ) ?? {count: 0, provider: null}
    )
}

export const fetchTriggerEvents = async (
    providerKey: string,
    integrationKey: string,
    params?: {query?: string; limit?: number; cursor?: string},
): Promise<TriggerCatalogEventsResponse> => {
    const {data} = await axios.get(
        `${triggersBaseUrl()}/catalog/providers/${providerKey}/integrations/${integrationKey}/events/`,
        projectScopedParams({
            query: params?.query,
            limit: params?.limit,
            cursor: params?.cursor,
        }),
    )
    return (
        safeParseWithLogging(triggerCatalogEventsResponseSchema, data, "[fetchTriggerEvents]") ?? {
            count: 0,
            total: 0,
            cursor: null,
            events: [],
        }
    )
}

export const fetchTriggerEvent = async (
    providerKey: string,
    integrationKey: string,
    eventKey: string,
): Promise<TriggerCatalogEventResponse> => {
    const {data} = await axios.get(
        `${triggersBaseUrl()}/catalog/providers/${providerKey}/integrations/${integrationKey}/events/${eventKey}`,
        projectScopedParams(),
    )
    return (
        safeParseWithLogging(triggerCatalogEventResponseSchema, data, "[fetchTriggerEvent]") ?? {
            count: 0,
            event: null,
        }
    )
}

// --- Connections (shared rows, WP0 view; F2) ---

export const queryTriggerConnections = async (params?: {
    provider_key?: string
    integration_key?: string
}): Promise<TriggerConnectionsResponse> => {
    const {data} = await axios.post(
        `${triggersBaseUrl()}/connections/query`,
        {
            provider_key: params?.provider_key,
            integration_key: params?.integration_key,
        },
        projectScopedParams(),
    )
    const validated = safeParseWithLogging(
        triggerConnectionsResponseSchema,
        data,
        "[queryTriggerConnections]",
    )
    return (validated as TriggerConnectionsResponse | null) ?? {count: 0, connections: []}
}
