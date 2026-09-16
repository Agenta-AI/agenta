import {sessionDurableEventTypeSchema, type SessionDurableEvent} from "@agenta/entities/session"

export interface SessionDurableEventState {
    /** Latest committed record cursor reported by the snapshot or event stream. */
    latestSequence: number
    /** Highest event sequence applied within this replay/live connection. */
    lastEventSequence: number
    /** Number of known events accepted after the last snapshot. */
    acceptedKnownEventCount: number
}

export const createSessionDurableEventState = (latestSequence = 0): SessionDurableEventState => ({
    latestSequence,
    lastEventSequence: latestSequence,
    acceptedKnownEventCount: 0,
})

export const completeSessionDurableEventReplay = (
    state: SessionDurableEventState,
    watermark: number,
): SessionDurableEventState => {
    const latestSequence = Math.max(state.latestSequence, watermark)
    const lastEventSequence = Math.max(state.lastEventSequence, watermark)
    if (latestSequence === state.latestSequence && lastEventSequence === state.lastEventSequence)
        return state
    return {...state, latestSequence, lastEventSequence}
}

/**
 * Apply one durable event exactly once. Record sequences can have gaps because only typed records
 * become events. Unknown types still advance the event order and reconnect watermark.
 */
export const reduceSessionDurableEvent = (
    state: SessionDurableEventState,
    event: SessionDurableEvent,
): SessionDurableEventState => {
    const sequence = event.sequence
    if (sequence == null || sequence <= state.lastEventSequence) return state

    return {
        latestSequence: Math.max(state.latestSequence, sequence, event.watermark),
        lastEventSequence: sequence,
        acceptedKnownEventCount:
            state.acceptedKnownEventCount +
            Number(sessionDurableEventTypeSchema.safeParse(event.type).success),
    }
}

export const shouldRefetchSessionTranscript = (
    previous: SessionDurableEventState,
    next: SessionDurableEventState,
    event: SessionDurableEvent,
): boolean =>
    next.acceptedKnownEventCount !== previous.acceptedKnownEventCount ||
    (event.sequence != null && event.sequence > previous.lastEventSequence + 1)
