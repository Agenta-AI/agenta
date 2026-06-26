/**
 * Gateway-trigger entity module.
 *
 * Browser-side state and queries for the `/triggers/*` endpoint family:
 * the read-only events catalog and the shared connection list.
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
    TriggerSchedule,
    TriggerScheduleCreate,
    TriggerScheduleData,
    TriggerScheduleEdit,
    TriggerScheduleFlags,
    TriggerScheduleQuery,
    TriggerScheduleResponse,
    TriggerSchedulesResponse,
    TriggerSelector,
    TriggerStatus,
    TriggerSubscription,
    TriggerSubscriptionCreate,
    TriggerSubscriptionData,
    TriggerSubscriptionEdit,
    TriggerSubscriptionFlags,
    TriggerSubscriptionQuery,
    TriggerSubscriptionResponse,
    TriggerSubscriptionsResponse,
} from "./core"
export {isConnectionActive, isConnectionValid, isEntityActive, isEntityValid} from "./core"
export {describeCron, nextCronRuns, validateCron} from "./core/cron"
export type {CronValidationResult} from "./core/cron"
export {localFaceToUtcIso, utcIsoToLocalFace} from "./core/window"
export {previewValue, resolveSelectorPreview} from "./core/selectorPreview"

// ---------------------------------------------------------------------------
// API — HTTP wrappers (axios + zod boundary validation)
// ---------------------------------------------------------------------------

export {
    createTriggerConnection,
    createTriggerSchedule,
    createTriggerSubscription,
    deleteTriggerConnection,
    deleteTriggerSchedule,
    deleteTriggerSubscription,
    editTriggerSchedule,
    editTriggerSubscription,
    fetchTriggerConnection,
    fetchTriggerDelivery,
    fetchTriggerEvent,
    fetchTriggerEvents,
    fetchTriggerIntegration,
    fetchTriggerIntegrations,
    fetchTriggerProvider,
    fetchTriggerProviders,
    fetchTriggerSchedule,
    fetchTriggerSubscription,
    queryTriggerConnections,
    queryTriggerDeliveries,
    queryTriggerSchedules,
    queryTriggerSubscriptions,
    refreshTriggerConnection,
    refreshTriggerSubscription,
    revokeTriggerConnection,
    revokeTriggerSubscription,
    startTriggerSchedule,
    startTriggerSubscription,
    stopTriggerSchedule,
    stopTriggerSubscription,
    testTriggerSubscription,
    triggerApiErrorMessage,
} from "./api"

// ---------------------------------------------------------------------------
// STATE — drawer + selection atoms
// ---------------------------------------------------------------------------

export {
    applyScheduleActiveOptimistic,
    applySubscriptionActiveOptimistic,
    triggerCatalogDrawerOpenAtom,
    triggerDeliveriesDrawerAtom,
    triggerEventsDrawerAtom,
    triggerEventSearchAtom,
    triggerScheduleDrawerAtom,
    triggerSelectedCatalogEventAtom,
    triggerSubscriptionDrawerAtom,
} from "./state"
export type {
    DeliveriesDrawerState,
    EventsDrawerState,
    ScheduleDrawerState,
    SubscriptionDrawerState,
} from "./state"

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
    triggerScheduleQueryAtomFamily,
    triggerSchedulesQueryAtom,
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
    useTriggerSchedule,
    useTriggerSchedules,
    useTriggerSubscription,
    useTriggerSubscriptions,
} from "./hooks"
