/**
 * Event Entity Module
 *
 * Read-only audit-log surface backed by `POST /events/query`. Lists platform
 * events (revision retrieve/fetch/query/log/commit across applications,
 * queries, testsets, evaluators, environments — plus trace and testcase
 * reads) with keyset pagination and audit-table filtering.
 *
 * No draft/commit semantics: unlike `testcase` there is no molecule, no
 * imperative get/set, no isDirty tracking — the audit log only appends.
 *
 * @example
 * ```typescript
 * import {eventsPaginatedStore, eventFilters} from "@agenta/entities/event"
 * ```
 */

// ============================================================================
// CORE - Types + Wire Enums
// ============================================================================

export {EventType, RequestType} from "./core"

export type {
    Event,
    EventQuery,
    EventsQueryResponse,
    EventTableRow,
    EventFilters,
    EventPaginatedMeta,
    EventTimestampRange,
    EventListParams,
    EventsPage,
} from "./core"

// ============================================================================
// API - HTTP Functions
// ============================================================================

export {fetchEventsPage, PAGE_SIZE, getEventsClient, projectScopedRequest} from "./api"

// ============================================================================
// STATE - Paginated Store, Filters, Session Cache
// ============================================================================

export {
    eventsPaginatedStore,
    eventsPaginatedMetaAtom,
    eventTypeFilterAtom,
    requestTypeFilterAtom,
    requestIdFilterAtom,
    eventIdFilterAtom,
    eventTimestampRangeFilterAtom,
    eventFilters,
    eventsByIdAtom,
    upsertEventsAtom,
    eventByIdAtomFamily,
    clearEventsCacheAtom,
} from "./state"
