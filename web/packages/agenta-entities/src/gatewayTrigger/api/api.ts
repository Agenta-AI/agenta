/**
 * Gateway-trigger API functions.
 *
 * Catalog browse + connection list over the `/triggers/*` endpoints. Each
 * response is validated against the frozen zod schema at the boundary
 * (`safeParseWithLogging`), so a backend drift surfaces as a logged parse
 * failure rather than a downstream crash.
 *
 * `/triggers/connections/query` reads the same shared `gateway_connections`
 * rows as `/tools/connections/query`; the connection shape is reused from
 * gatewayTool so the two lists stay byte-compatible.
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
    triggerScheduleResponseSchema,
    triggerSchedulesResponseSchema,
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
    type TriggerScheduleCreate,
    type TriggerScheduleEdit,
    type TriggerScheduleQuery,
    type TriggerScheduleResponse,
    type TriggerSchedulesResponse,
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

// --- Connections (shared `gateway_connections` rows) ---

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

/**
 * One-shot test: create a transient is_test subscription, long-poll for the first
 * captured event, then tear it down — all in a single backend request. The server
 * holds the connection open up to its test timeout (default 60s), so override the
 * axios timeout to outlast it.
 */
export const testTriggerSubscription = async (
    subscription: TriggerSubscriptionCreate,
): Promise<TriggerDeliveryResponse> => {
    const {data} = await axios.post(
        `${triggersBaseUrl()}/subscriptions/test`,
        {subscription},
        {...projectScopedParams(), timeout: 70_000},
    )
    return (
        safeParseWithLogging(triggerDeliveryResponseSchema, data, "[testTriggerSubscription]") ?? {
            count: 0,
            delivery: null,
        }
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

// --- Subscription start/stop ---
// Lifecycle verbs toggling `flags.is_active` via `POST /subscriptions/{id}/<verb>`.

export const startTriggerSubscription = async (
    subscriptionId: string,
): Promise<TriggerSubscriptionResponse> => {
    const {data} = await axios.post(
        `${triggersBaseUrl()}/subscriptions/${subscriptionId}/start`,
        {},
        projectScopedParams(),
    )
    return (
        safeParseWithLogging(
            triggerSubscriptionResponseSchema,
            data,
            "[startTriggerSubscription]",
        ) ?? {count: 0, subscription: null}
    )
}

export const stopTriggerSubscription = async (
    subscriptionId: string,
): Promise<TriggerSubscriptionResponse> => {
    const {data} = await axios.post(
        `${triggersBaseUrl()}/subscriptions/${subscriptionId}/stop`,
        {},
        projectScopedParams(),
    )
    return (
        safeParseWithLogging(
            triggerSubscriptionResponseSchema,
            data,
            "[stopTriggerSubscription]",
        ) ?? {count: 0, subscription: null}
    )
}

// --- Schedules — recurring cron timers binding a tick to a workflow ---

export const queryTriggerSchedules = async (
    schedule?: TriggerScheduleQuery,
): Promise<TriggerSchedulesResponse> => {
    const {data} = await axios.post(
        `${triggersBaseUrl()}/schedules/query`,
        {schedule: schedule ?? null},
        projectScopedParams(),
    )
    return (
        safeParseWithLogging(triggerSchedulesResponseSchema, data, "[queryTriggerSchedules]") ?? {
            count: 0,
            schedules: [],
        }
    )
}

export const fetchTriggerSchedule = async (
    scheduleId: string,
): Promise<TriggerScheduleResponse> => {
    const {data} = await axios.get(
        `${triggersBaseUrl()}/schedules/${scheduleId}`,
        projectScopedParams(),
    )
    return (
        safeParseWithLogging(triggerScheduleResponseSchema, data, "[fetchTriggerSchedule]") ?? {
            count: 0,
            schedule: null,
        }
    )
}

export const createTriggerSchedule = async (
    schedule: TriggerScheduleCreate,
): Promise<TriggerScheduleResponse> => {
    const {data} = await axios.post(
        `${triggersBaseUrl()}/schedules/`,
        {schedule},
        projectScopedParams(),
    )
    return (
        safeParseWithLogging(triggerScheduleResponseSchema, data, "[createTriggerSchedule]") ?? {
            count: 0,
            schedule: null,
        }
    )
}

export const editTriggerSchedule = async (
    schedule: TriggerScheduleEdit,
): Promise<TriggerScheduleResponse> => {
    const {data} = await axios.put(
        `${triggersBaseUrl()}/schedules/${schedule.id}`,
        {schedule},
        projectScopedParams(),
    )
    return (
        safeParseWithLogging(triggerScheduleResponseSchema, data, "[editTriggerSchedule]") ?? {
            count: 0,
            schedule: null,
        }
    )
}

export const deleteTriggerSchedule = async (scheduleId: string): Promise<void> => {
    await axios.delete(`${triggersBaseUrl()}/schedules/${scheduleId}`, projectScopedParams())
}

export const startTriggerSchedule = async (
    scheduleId: string,
): Promise<TriggerScheduleResponse> => {
    const {data} = await axios.post(
        `${triggersBaseUrl()}/schedules/${scheduleId}/start`,
        {},
        projectScopedParams(),
    )
    return (
        safeParseWithLogging(triggerScheduleResponseSchema, data, "[startTriggerSchedule]") ?? {
            count: 0,
            schedule: null,
        }
    )
}

export const stopTriggerSchedule = async (scheduleId: string): Promise<TriggerScheduleResponse> => {
    const {data} = await axios.post(
        `${triggersBaseUrl()}/schedules/${scheduleId}/stop`,
        {},
        projectScopedParams(),
    )
    return (
        safeParseWithLogging(triggerScheduleResponseSchema, data, "[stopTriggerSchedule]") ?? {
            count: 0,
            schedule: null,
        }
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
