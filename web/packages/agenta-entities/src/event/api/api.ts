/**
 * Event API Functions
 *
 * HTTP function for the `/events/query` endpoint, backed by the
 * Fern-generated `@agentaai/api-client` via `@agenta/sdk`.
 *
 * Pagination is keyset-based on `(timestamp, event_id)`: the backend orders
 * descending and does not echo a cursor, so the next-page cursor is derived
 * from the last row of the current page and encoded into a single string.
 */

import type {AgentaApi} from "@agentaai/api-client"

import type {EventListParams, EventsPage} from "../core/types"

import {getEventsClient, projectScopedRequest} from "./client"

/** Default page size for the audit-log table. */
export const PAGE_SIZE = 50

/** Separator between the two keyset components in an encoded cursor. */
const CURSOR_DELIMITER = "|"

/**
 * Decode an opaque cursor string back into its `(newest, next)` keyset parts.
 * `newest` is an ISO timestamp and `next` an event-id UUID — neither contains
 * the delimiter, so a single split on the first delimiter is sufficient.
 */
function decodeCursor(cursor: string): {newest: string; next: string} | null {
    const idx = cursor.indexOf(CURSOR_DELIMITER)
    if (idx === -1) return null
    return {newest: cursor.slice(0, idx), next: cursor.slice(idx + 1)}
}

/** Encode the last row of a page into the cursor for the following page. */
function encodeCursor(event: AgentaApi.Event): string {
    return `${event.timestamp}${CURSOR_DELIMITER}${event.event_id}`
}

/**
 * Fetch a single page of audit-log events.
 *
 * @example
 * ```typescript
 * const page = await fetchEventsPage({
 *   projectId: "proj-123",
 *   filters: {eventType: null, requestType: null, requestId: null},
 *   cursor: null,
 *   limit: 50,
 * })
 * ```
 */
export async function fetchEventsPage(params: EventListParams): Promise<EventsPage> {
    const {projectId, filters, cursor = null, limit = PAGE_SIZE} = params

    if (!projectId) {
        return {events: [], count: 0, nextCursor: null, hasMore: false}
    }

    const event = {
        request_type: filters.requestType || null,
        request_id: filters.requestId || null,
        event_type: filters.eventType || null,
        event_id: filters.eventId || null,
    } as AgentaApi.EventQuery

    const windowing: AgentaApi.Windowing = {
        limit,
        order: "descending",
    }
    if (filters.timestampRange?.from) {
        windowing.oldest = filters.timestampRange.from
    }
    if (filters.timestampRange?.to) {
        windowing.newest = filters.timestampRange.to
    }
    if (cursor) {
        const decoded = decodeCursor(cursor)
        if (decoded) {
            windowing.newest = decoded.newest
            windowing.next = decoded.next
        }
    }

    const response = await getEventsClient().queryEventsRpc(
        {event, windowing},
        projectScopedRequest(projectId),
    )

    const events = response.events ?? []
    const last = events[events.length - 1]
    // A full page implies there may be more; a short page is the last page.
    const hasMore = events.length === limit

    return {
        events,
        count: response.count ?? events.length,
        nextCursor: hasMore && last ? encodeCursor(last) : null,
        hasMore,
    }
}
