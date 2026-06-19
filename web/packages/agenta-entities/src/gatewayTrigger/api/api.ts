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
    triggerCatalogIntegrationResponseSchema,
    triggerCatalogIntegrationsResponseSchema,
    triggerCatalogProviderResponseSchema,
    triggerCatalogProvidersResponseSchema,
    triggerConnectionResponseSchema,
    triggerConnectionsResponseSchema,
    triggerDeliveriesResponseSchema,
    triggerDeliveryResponseSchema,
    triggerSubscriptionResponseSchema,
    triggerSubscriptionsResponseSchema,
    type TriggerCatalogEventResponse,
    type TriggerCatalogEventsResponse,
    type TriggerCatalogIntegrationResponse,
    type TriggerCatalogIntegrationsResponse,
    type TriggerCatalogProviderResponse,
    type TriggerCatalogProvidersResponse,
    type TriggerConnectionCreatePayload,
    type TriggerConnectionResponse,
    type TriggerConnectionsResponse,
    type TriggerDeliveriesResponse,
    type TriggerDeliveryQuery,
    type TriggerDeliveryResponse,
    type TriggerSubscriptionCreate,
    type TriggerSubscriptionEdit,
    type TriggerSubscriptionQuery,
    type TriggerSubscriptionResponse,
    type TriggerSubscriptionsResponse,
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

// --- Integrations (shared catalog with tools; browsed independently) ---

export const fetchTriggerIntegrations = async (
    providerKey: string,
    params?: {search?: string; sort_by?: string; limit?: number; cursor?: string},
): Promise<TriggerCatalogIntegrationsResponse> => {
    const {data} = await axios.get(
        `${triggersBaseUrl()}/catalog/providers/${providerKey}/integrations/`,
        projectScopedParams({
            search: params?.search,
            sort_by: params?.sort_by,
            limit: params?.limit,
            cursor: params?.cursor,
        }),
    )
    return (
        safeParseWithLogging(
            triggerCatalogIntegrationsResponseSchema,
            data,
            "[fetchTriggerIntegrations]",
        ) ?? {count: 0, total: 0, cursor: null, integrations: []}
    )
}

export const fetchTriggerIntegration = async (
    providerKey: string,
    integrationKey: string,
): Promise<TriggerCatalogIntegrationResponse> => {
    const {data} = await axios.get(
        `${triggersBaseUrl()}/catalog/providers/${providerKey}/integrations/${integrationKey}`,
        projectScopedParams(),
    )
    return (
        safeParseWithLogging(
            triggerCatalogIntegrationResponseSchema,
            data,
            "[fetchTriggerIntegration]",
        ) ?? {count: 0, integration: null}
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

export const fetchTriggerConnection = async (
    connectionId: string,
): Promise<TriggerConnectionResponse> => {
    const {data} = await axios.get(
        `${triggersBaseUrl()}/connections/${connectionId}`,
        projectScopedParams(),
    )
    return (
        (safeParseWithLogging(
            triggerConnectionResponseSchema,
            data,
            "[fetchTriggerConnection]",
        ) as TriggerConnectionResponse | null) ?? {count: 0, connection: null}
    )
}

export const createTriggerConnection = async (
    payload: TriggerConnectionCreatePayload,
): Promise<TriggerConnectionResponse> => {
    const {data} = await axios.post(
        `${triggersBaseUrl()}/connections/`,
        payload,
        projectScopedParams(),
    )
    return (
        (safeParseWithLogging(
            triggerConnectionResponseSchema,
            data,
            "[createTriggerConnection]",
        ) as TriggerConnectionResponse | null) ?? {count: 0, connection: null}
    )
}

export const deleteTriggerConnection = async (connectionId: string): Promise<void> => {
    await axios.delete(`${triggersBaseUrl()}/connections/${connectionId}`, projectScopedParams())
}

export const refreshTriggerConnection = async (
    connectionId: string,
    force?: boolean,
): Promise<TriggerConnectionResponse> => {
    const {data} = await axios.post(
        `${triggersBaseUrl()}/connections/${connectionId}/refresh`,
        null,
        projectScopedParams(force === undefined ? undefined : {force}),
    )
    return (
        (safeParseWithLogging(
            triggerConnectionResponseSchema,
            data,
            "[refreshTriggerConnection]",
        ) as TriggerConnectionResponse | null) ?? {count: 0, connection: null}
    )
}

export const revokeTriggerConnection = async (
    connectionId: string,
): Promise<TriggerConnectionResponse> => {
    const {data} = await axios.post(
        `${triggersBaseUrl()}/connections/${connectionId}/revoke`,
        null,
        projectScopedParams(),
    )
    return (
        (safeParseWithLogging(
            triggerConnectionResponseSchema,
            data,
            "[revokeTriggerConnection]",
        ) as TriggerConnectionResponse | null) ?? {count: 0, connection: null}
    )
}

// --- Subscriptions ---

export const queryTriggerSubscriptions = async (
    subscription?: TriggerSubscriptionQuery,
): Promise<TriggerSubscriptionsResponse> => {
    const {data} = await axios.post(
        `${triggersBaseUrl()}/subscriptions/query`,
        {subscription: subscription ?? null},
        projectScopedParams(),
    )
    return (
        safeParseWithLogging(
            triggerSubscriptionsResponseSchema,
            data,
            "[queryTriggerSubscriptions]",
        ) ?? {count: 0, subscriptions: []}
    )
}

export const fetchTriggerSubscription = async (
    subscriptionId: string,
): Promise<TriggerSubscriptionResponse> => {
    const {data} = await axios.get(
        `${triggersBaseUrl()}/subscriptions/${subscriptionId}`,
        projectScopedParams(),
    )
    return (
        safeParseWithLogging(
            triggerSubscriptionResponseSchema,
            data,
            "[fetchTriggerSubscription]",
        ) ?? {count: 0, subscription: null}
    )
}

export const createTriggerSubscription = async (
    subscription: TriggerSubscriptionCreate,
): Promise<TriggerSubscriptionResponse> => {
    const {data} = await axios.post(
        `${triggersBaseUrl()}/subscriptions/`,
        {subscription},
        projectScopedParams(),
    )
    return (
        safeParseWithLogging(
            triggerSubscriptionResponseSchema,
            data,
            "[createTriggerSubscription]",
        ) ?? {count: 0, subscription: null}
    )
}

export const editTriggerSubscription = async (
    subscription: TriggerSubscriptionEdit,
): Promise<TriggerSubscriptionResponse> => {
    const {data} = await axios.put(
        `${triggersBaseUrl()}/subscriptions/${subscription.id}`,
        {subscription},
        projectScopedParams(),
    )
    return (
        safeParseWithLogging(
            triggerSubscriptionResponseSchema,
            data,
            "[editTriggerSubscription]",
        ) ?? {count: 0, subscription: null}
    )
}

export const refreshTriggerSubscription = async (
    subscriptionId: string,
): Promise<TriggerSubscriptionResponse> => {
    const {data} = await axios.post(
        `${triggersBaseUrl()}/subscriptions/${subscriptionId}/refresh`,
        {},
        projectScopedParams(),
    )
    return (
        safeParseWithLogging(
            triggerSubscriptionResponseSchema,
            data,
            "[refreshTriggerSubscription]",
        ) ?? {count: 0, subscription: null}
    )
}

export const revokeTriggerSubscription = async (
    subscriptionId: string,
): Promise<TriggerSubscriptionResponse> => {
    const {data} = await axios.post(
        `${triggersBaseUrl()}/subscriptions/${subscriptionId}/revoke`,
        {},
        projectScopedParams(),
    )
    return (
        safeParseWithLogging(
            triggerSubscriptionResponseSchema,
            data,
            "[revokeTriggerSubscription]",
        ) ?? {count: 0, subscription: null}
    )
}

export const deleteTriggerSubscription = async (subscriptionId: string): Promise<void> => {
    await axios.delete(
        `${triggersBaseUrl()}/subscriptions/${subscriptionId}`,
        projectScopedParams(),
    )
}

// --- Deliveries (read-only) ---

export const queryTriggerDeliveries = async (
    delivery?: TriggerDeliveryQuery,
): Promise<TriggerDeliveriesResponse> => {
    const {data} = await axios.post(
        `${triggersBaseUrl()}/deliveries/query`,
        {delivery: delivery ?? null},
        projectScopedParams(),
    )
    return (
        safeParseWithLogging(triggerDeliveriesResponseSchema, data, "[queryTriggerDeliveries]") ?? {
            count: 0,
            deliveries: [],
        }
    )
}

export const fetchTriggerDelivery = async (
    deliveryId: string,
): Promise<TriggerDeliveryResponse> => {
    const {data} = await axios.get(
        `${triggersBaseUrl()}/deliveries/${deliveryId}`,
        projectScopedParams(),
    )
    return (
        safeParseWithLogging(triggerDeliveryResponseSchema, data, "[fetchTriggerDelivery]") ?? {
            count: 0,
            delivery: null,
        }
    )
}
