/**
 * Event Paginated Store
 *
 * Wires `POST /events/query` into an InfiniteVirtualTable-compatible paginated
 * store. Read-only: no client rows, no drafts, no soft-deletes — the audit log
 * only ever appends.
 */

import {projectIdAtom} from "@agenta/shared/state"
import {atom, getDefaultStore, type Atom} from "jotai"

import {createPaginatedEntityStore} from "../../shared/paginated"
import type {InfiniteTableFetchResult} from "../../shared/tableTypes"
import {fetchEventsPage} from "../api/api"
import type {
    EventPaginatedMeta,
    EventTableRow,
    EventTimestampRange,
    EventType,
    RequestType,
} from "../core/types"

import {upsertEventsAtom} from "./selectors"

const createDefaultTimestampRange = (): EventTimestampRange => {
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000)
    // Open-ended upper bound: omit `to` so `windowing.newest` is left unset and
    // every fetch/refresh queries up to "now". A fixed `to` captured here (at
    // module init) would freeze the newest boundary, hiding events created after
    // the page was opened until the user changes the date filter. The explicit
    // Refresh action recomputes `from` from the preset (see AuditLogTable).
    return {from: from.toISOString(), to: null, preset: "24 hours"}
}

// ============================================================================
// FILTER ATOMS
// ============================================================================

/** Event-type filter (maps to `EventQuery.event_type`). */
export const eventTypeFilterAtom = atom<EventType | null>(null)

/** Request-type filter (maps to `EventQuery.request_type`). */
export const requestTypeFilterAtom = atom<RequestType | null>(null)

/** Exact request-id filter (maps to `EventQuery.request_id`). */
export const requestIdFilterAtom = atom<string | null>(null)

/** Exact event-id filter (maps to `EventQuery.event_id`). */
export const eventIdFilterAtom = atom<string | null>(null)

/** Timestamp range filter (maps to `Windowing.oldest/newest`). */
export const eventTimestampRangeFilterAtom = atom<EventTimestampRange | null>(
    createDefaultTimestampRange(),
)

// ============================================================================
// META ATOM
// ============================================================================

/** Combined reactive metadata — a change here triggers a fresh page-1 fetch. */
export const eventsPaginatedMetaAtom: Atom<EventPaginatedMeta> = atom((get) => ({
    projectId: get(projectIdAtom),
    eventType: get(eventTypeFilterAtom),
    requestType: get(requestTypeFilterAtom),
    requestId: get(requestIdFilterAtom),
    eventId: get(eventIdFilterAtom),
    timestampRange: get(eventTimestampRangeFilterAtom),
}))

// ============================================================================
// PAGINATED STORE
// ============================================================================

/** Minimal row shape returned by the fetch — full data goes to `eventsByIdAtom`. */
interface FetchedRowIdentity {
    id: string
}

const skeletonDefaults: Partial<EventTableRow> = {
    id: "",
    key: "",
    __isSkeleton: true,
}

/**
 * Fetch one window of events for the paginated store.
 *
 * Returns identity-only rows; full event payloads are merged into the session
 * cache (`eventsByIdAtom`) so cells and the drawer can read them by id.
 */
async function fetchEventsWindow({
    meta,
    limit,
    cursor,
}: {
    meta: EventPaginatedMeta
    limit: number
    cursor?: string | null
}): Promise<InfiniteTableFetchResult<FetchedRowIdentity>> {
    const {projectId, eventType, requestType, requestId, eventId, timestampRange} = meta

    if (!projectId) {
        return {
            rows: [],
            totalCount: 0,
            hasMore: false,
            nextCursor: null,
            nextOffset: null,
            nextWindowing: null,
        }
    }

    try {
        const page = await fetchEventsPage({
            projectId,
            filters: {eventType, requestType, requestId, eventId, timestampRange},
            cursor: cursor || undefined,
            limit,
        })

        getDefaultStore().set(upsertEventsAtom, page.events)

        return {
            rows: page.events.map((event) => ({id: event.event_id})),
            totalCount: page.count,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            nextOffset: null,
            nextWindowing: null,
        }
    } catch (error) {
        console.error("[eventsPaginatedStore] Error fetching events:", error)
        return {
            rows: [],
            totalCount: 0,
            hasMore: false,
            nextCursor: null,
            nextOffset: null,
            nextWindowing: null,
        }
    }
}

/** Paginated store for the audit-log InfiniteVirtualTable. */
export const eventsPaginatedStore = createPaginatedEntityStore<
    EventTableRow,
    FetchedRowIdentity,
    EventPaginatedMeta
>({
    entityName: "event",
    metaAtom: eventsPaginatedMetaAtom,
    fetchPage: fetchEventsWindow,
    rowConfig: {
        getRowId: (row) => row.id,
        skeletonDefaults,
    },
    transformRow: (apiRow): EventTableRow => ({
        id: apiRow.id,
        key: apiRow.id,
        __isSkeleton: false,
    }),
    isEnabled: (meta) => Boolean(meta?.projectId),
    // The backend returns a page count, not a grand total — show "N+".
    listCountsConfig: {
        totalCountMode: "unknown",
    },
})

// ============================================================================
// FILTERS NAMESPACE
// ============================================================================

/** Filter atoms grouped for ergonomic consumption by the audit-log UI. */
export const eventFilters = {
    eventType: eventTypeFilterAtom,
    requestType: requestTypeFilterAtom,
    requestId: requestIdFilterAtom,
    eventId: eventIdFilterAtom,
    timestampRange: eventTimestampRangeFilterAtom,
}
