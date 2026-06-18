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
    TriggerProviderKind,
} from "./core"
export {isConnectionActive, isConnectionValid} from "./core"

// ---------------------------------------------------------------------------
// API — HTTP wrappers (axios + zod boundary validation)
// ---------------------------------------------------------------------------

export {
    fetchTriggerEvent,
    fetchTriggerEvents,
    fetchTriggerProvider,
    fetchTriggerProviders,
    queryTriggerConnections,
} from "./api"

// ---------------------------------------------------------------------------
// STATE — drawer + selection atoms
// ---------------------------------------------------------------------------

export {eventsDrawerAtom, eventSearchAtom, selectedCatalogEventAtom} from "./state"
export type {EventsDrawerState} from "./state"

// ---------------------------------------------------------------------------
// HOOKS — query hooks for React consumers
// ---------------------------------------------------------------------------

export {
    catalogEventsInfiniteFamily,
    eventsSearchAtom,
    triggerConnectionsQueryAtom,
    triggerEventDetailQueryFamily,
    triggerIntegrationConnectionsAtomFamily,
    useCatalogEvents,
    useTriggerConnectionsQuery,
    useTriggerEvent,
    useTriggerIntegrationConnections,
} from "./hooks"
