/**
 * Event Entity — Session Cache + Selectors
 *
 * The audit log has no single-event endpoint: events are only ever returned
 * in bulk by `POST /events/query`. To let the detail drawer read a full event
 * payload by id, each fetched page is merged into a session-scoped cache
 * (`eventsByIdAtom`) keyed by `event_id`.
 */

import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {Event} from "../core/types"

/**
 * Session cache of full event payloads, keyed by `event_id`.
 *
 * Populated as pages load via `upsertEventsAtom`; read by the detail drawer.
 * Bounded by what the user has scrolled in the current session and reset by
 * `clearEventsCacheAtom` on filter changes / refresh.
 */
export const eventsByIdAtom = atom<Record<string, Event>>({})

/** Merge a freshly fetched page of events into the session cache. */
export const upsertEventsAtom = atom(null, (get, set, events: Event[]) => {
    if (events.length === 0) return
    const next = {...get(eventsByIdAtom)}
    for (const ev of events) {
        next[ev.event_id] = ev
    }
    set(eventsByIdAtom, next)
})

/** Reactive lookup of a single event by id, for the detail drawer. */
export const eventByIdAtomFamily = atomFamily((eventId: string) =>
    atom((get) => get(eventsByIdAtom)[eventId] ?? null),
)

/** Clear the session cache — call on filter change / refresh to bound memory. */
export const clearEventsCacheAtom = atom(null, (_get, set) => {
    set(eventsByIdAtom, {})
})
