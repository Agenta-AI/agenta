import {sessionDurableEventTypeSchema, type SessionDurableEvent} from "@agenta/entities/session"

export interface SessionDurableEventState {
    /** Highest contiguous sequence consumed, including unknown forward-compatible event types. */
    latestSequence: number
    /** Known events accepted after the last snapshot, in durable sequence order. */
    events: SessionDurableEvent[]
    /** Out-of-order arrivals held until every preceding sequence arrives. */
    pending: Readonly<Record<number, SessionDurableEvent>>
}

export const createSessionDurableEventState = (latestSequence = 0): SessionDurableEventState => ({
    latestSequence,
    events: [],
    pending: {},
})

/**
 * Apply one durable event exactly once. Sequence is the ordering contract; event prose and Redis
 * arrival order are not. Unknown types still consume their sequence so a newer client event cannot
 * be stranded behind a forward-compatible envelope this build does not render.
 */
export const reduceSessionDurableEvent = (
    state: SessionDurableEventState,
    event: SessionDurableEvent,
): SessionDurableEventState => {
    const sequence = event.sequence
    if (sequence == null || sequence <= state.latestSequence || state.pending[sequence])
        return state

    const pending: Record<number, SessionDurableEvent> = {...state.pending, [sequence]: event}
    const events = [...state.events]
    let latestSequence = state.latestSequence

    while (pending[latestSequence + 1]) {
        const next = pending[latestSequence + 1]
        delete pending[latestSequence + 1]
        latestSequence += 1
        if (sessionDurableEventTypeSchema.safeParse(next.type).success) events.push(next)
    }

    return {latestSequence, events, pending}
}
