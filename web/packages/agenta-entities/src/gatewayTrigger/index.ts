/**
 * Gateway-trigger entity module.
 *
 * Browser-side state and queries for the `/triggers/*` endpoint family:
 * the read-only events catalog (WP1) and the shared connection list (WP0).
 *
 * Mirrors `gatewayTool`. The catalog isn't in the Fern client yet, so the API
 * layer uses the shared axios instance with zod validation at the boundary
 * (see `api/api.ts`); it collapses onto the Fern `triggers` resource once the
 * client is regenerated.
 */

// ---------------------------------------------------------------------------
// CORE — domain types
// ---------------------------------------------------------------------------

export type {
    TriggerCatalogEvent,
    TriggerCatalogEventDetails,
    TriggerCatalogEventResponse,
    TriggerCatalogEventsResponse,
    TriggerCatalogIntegration,
    TriggerCatalogIntegrationResponse,
    TriggerCatalogIntegrationsResponse,
    TriggerCatalogProvider,
    TriggerCatalogProviderResponse,
    TriggerCatalogProvidersResponse,
    TriggerConnection,
    TriggerConnectionCreatePayload,
    TriggerConnectionResponse,
    TriggerConnectionsResponse,
    TriggerDelivery,
    TriggerDeliveriesResponse,
    TriggerDeliveryData,
    TriggerDeliveryQuery,
    TriggerDeliveryResponse,
    TriggerProviderKind,
    TriggerReference,
    TriggerSelector,
    TriggerStatus,
    TriggerSubscription,
    TriggerSubscriptionCreate,
    TriggerSubscriptionData,
    TriggerSubscriptionEdit,
    TriggerSubscriptionQuery,
    TriggerSubscriptionResponse,
    TriggerSubscriptionsResponse,
} from "./core"
export {isConnectionActive, isConnectionValid} from "./core"

// ---------------------------------------------------------------------------
// API — HTTP wrappers (axios + zod boundary validation)
// ---------------------------------------------------------------------------

export {
    createTriggerConnection,
    createTriggerSubscription,
    deleteTriggerConnection,
    deleteTriggerSubscription,
    editTriggerSubscription,
    fetchTriggerConnection,
    fetchTriggerDelivery,
    fetchTriggerEvent,
    fetchTriggerEvents,
    fetchTriggerIntegration,
    fetchTriggerIntegrations,
    fetchTriggerProvider,
    fetchTriggerProviders,
    fetchTriggerSubscription,
    queryTriggerConnections,
    queryTriggerDeliveries,
    queryTriggerSubscriptions,
    refreshTriggerConnection,
    refreshTriggerSubscription,
    revokeTriggerConnection,
    revokeTriggerSubscription,
    triggerApiErrorMessage,
} from "./api"

// ---------------------------------------------------------------------------
// STATE — drawer + selection atoms
// ---------------------------------------------------------------------------

export {
    triggerCatalogDrawerOpenAtom,
    triggerDeliveriesDrawerAtom,
    triggerEventsDrawerAtom,
    triggerEventSearchAtom,
    triggerSelectedCatalogEventAtom,
    triggerSubscriptionDrawerAtom,
} from "./state"
export type {DeliveriesDrawerState, EventsDrawerState, SubscriptionDrawerState} from "./state"

// ---------------------------------------------------------------------------
// HOOKS — query hooks for React consumers
// ---------------------------------------------------------------------------

export {
    triggerCatalogEventsInfiniteFamily,
    triggerCatalogIntegrationsInfiniteAtom,
    triggerConnectionsQueryAtom,
    triggerConnectionSubscriptionsAtomFamily,
    triggerDeliveriesAtomFamily,
    triggerEventDetailQueryFamily,
    triggerEventsSearchAtom,
    triggerIntegrationConnectionsAtomFamily,
    triggerIntegrationsSearchAtom,
    triggerSubscriptionQueryAtomFamily,
    triggerSubscriptionsQueryAtom,
    useTriggerCatalogEvents,
    useTriggerCatalogIntegrations,
    useTriggerConnectionActions,
    useTriggerConnectionsQuery,
    useTriggerConnectionSubscriptions,
    useTriggerDeliveries,
    useTriggerEvent,
    useTriggerIntegrationConnections,
    useTriggerSubscription,
    useTriggerSubscriptions,
} from "./hooks"
