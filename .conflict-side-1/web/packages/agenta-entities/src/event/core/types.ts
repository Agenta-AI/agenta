/**
 * Event Entity — Core Types
 *
 * The `event` entity is a read-only audit-log surface backed by the
 * `POST /events/query` endpoint. It has no draft/commit semantics, so the
 * shape here is intentionally minimal: Fern wire types re-exported for
 * consumers, plus the table-row / pagination contracts.
 */

import {AgentaApi} from "@agentaai/api-client"

import type {InfiniteTableRowBase} from "../../shared/tableTypes"

// ============================================================================
// WIRE TYPES (re-exported from the Fern-generated client)
// ============================================================================

/**
 * `EventType` / `RequestType` are re-exported as runtime enums (const + type)
 * so consumers — notably the audit-log filter dropdowns in `web/oss`, which
 * does not depend on `@agentaai/api-client` directly — can build option lists
 * without reaching into the generated client.
 */
export const EventType = AgentaApi.EventType
export type EventType = AgentaApi.EventType
export const RequestType = AgentaApi.RequestType
export type RequestType = AgentaApi.RequestType

/** A single audit-log event as returned by `POST /events/query`. */
export type Event = AgentaApi.Event

/** Filter payload for `POST /events/query` (`request_id` / `request_type` / `event_type`). */
export type EventQuery = AgentaApi.EventQuery

/** Response envelope of `POST /events/query` (`count` + `events`). */
export type EventsQueryResponse = AgentaApi.EventsQueryResponse

// ============================================================================
// TABLE / PAGINATION CONTRACTS
// ============================================================================

/**
 * Identity-only row for the InfiniteVirtualTable.
 *
 * Cell data is read from `eventByIdAtomFamily(id)` — the full payload lives in
 * the session cache (`eventsByIdAtom`), not on the row, so the table renders
 * without duplicating event data per row.
 *
 * `__isSkeleton` is required (not optional as on the base) so the row type
 * also satisfies the stricter `InfiniteTableRowBase` of the OSS table shell.
 */
export interface EventTableRow extends InfiniteTableRowBase {
    id: string
    key: string
    __isSkeleton: boolean
}

/** Filters that map 1:1 to the backend `EventQuery`. */
export interface EventFilters {
    requestType: RequestType | null
    requestId: string | null
    eventType: EventType | null
    eventId: string | null
    timestampRange: EventTimestampRange | null
}

/** Reactive query metadata consumed by the paginated store. */
export interface EventPaginatedMeta {
    projectId: string | null
    requestType: RequestType | null
    requestId: string | null
    eventType: EventType | null
    eventId: string | null
    timestampRange: EventTimestampRange | null
}

export interface EventTimestampRange {
    from?: string | null
    to?: string | null
    preset?: string | null
}

/** Params for a single page fetch. */
export interface EventListParams {
    projectId: string
    filters: EventFilters
    cursor?: string | null
    limit?: number
}

/** Result of one page fetch. */
export interface EventsPage {
    events: Event[]
    /** Number of events in this page (the backend does not return a grand total). */
    count: number
    /** Keyset cursor for the next page, or `null` when the list is exhausted. */
    nextCursor: string | null
    hasMore: boolean
}
