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
    TriggerCatalogProvider,
    TriggerCatalogProviderResponse,
    TriggerCatalogProvidersResponse,
    TriggerConnection,
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
    createTriggerSubscription,
    deleteTriggerSubscription,
    editTriggerSubscription,
    fetchTriggerDelivery,
    fetchTriggerEvent,
    fetchTriggerEvents,
    fetchTriggerProvider,
    fetchTriggerProviders,
    fetchTriggerSubscription,
    queryTriggerConnections,
    queryTriggerDeliveries,
    queryTriggerSubscriptions,
    refreshTriggerSubscription,
    revokeTriggerSubscription,
} from "./api"

// ---------------------------------------------------------------------------
// STATE — drawer + selection atoms
// ---------------------------------------------------------------------------

export {
    deliveriesDrawerAtom,
    eventsDrawerAtom,
    eventSearchAtom,
    selectedCatalogEventAtom,
    subscriptionDrawerAtom,
} from "./state"
export type {DeliveriesDrawerState, EventsDrawerState, SubscriptionDrawerState} from "./state"

// ---------------------------------------------------------------------------
// HOOKS — query hooks for React consumers
// ---------------------------------------------------------------------------

export {
    catalogEventsInfiniteFamily,
    eventsSearchAtom,
    triggerConnectionsQueryAtom,
    triggerConnectionSubscriptionsAtomFamily,
    triggerDeliveriesAtomFamily,
    triggerEventDetailQueryFamily,
    triggerIntegrationConnectionsAtomFamily,
    triggerSubscriptionQueryAtomFamily,
    triggerSubscriptionsQueryAtom,
    useCatalogEvents,
    useTriggerConnectionsQuery,
    useTriggerConnectionSubscriptions,
    useTriggerDeliveries,
    useTriggerEvent,
    useTriggerIntegrationConnections,
    useTriggerSubscription,
    useTriggerSubscriptions,
} from "./hooks"
