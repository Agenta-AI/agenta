import {describe, expect, it} from "vitest"

import type {SessionDurableEvent} from "@agenta/entities/session"

import {
    completeSessionDurableEventReplay,
    createSessionDurableEventState,
    reduceSessionDurableEvent,
    shouldRefetchSessionTranscript,
} from "../../../src/model"

const durableEvent = (
    sequence: number,
    type = "message.completed",
    watermark = sequence,
): SessionDurableEvent => ({
    version: 1,
    kind: "event",
    session_id: "session-1",
    execution_id: "execution-1",
    frame_or_event_id: `event-${sequence}`,
    sequence,
    watermark,
    type,
    payload: {},
    created_at: "2026-09-04T00:00:00Z",
})

describe("reduceSessionDurableEvent", () => {
    it("deduplicates retry deliveries by durable sequence", () => {
        const initial = createSessionDurableEventState(4)
        const once = reduceSessionDurableEvent(initial, durableEvent(5))
        const twice = reduceSessionDurableEvent(once, durableEvent(5))

        expect(twice.latestSequence).toBe(5)
        expect(twice.acceptedKnownEventCount).toBe(1)
        expect(twice).toBe(once)
    })

    it("applies the non-contiguous event sequence seen on the live relay", () => {
        const state = [3, 6, 7, 9].reduce(
            (current, sequence) => reduceSessionDurableEvent(current, durableEvent(sequence)),
            createSessionDurableEventState(1),
        )

        expect(state.latestSequence).toBe(9)
        expect(state.lastEventSequence).toBe(9)
        expect(state.acceptedKnownEventCount).toBe(4)
    })

    it("drops a duplicate and an out-of-order older event", () => {
        const initial = [3, 6, 7, 9].reduce(
            (current, sequence) => reduceSessionDurableEvent(current, durableEvent(sequence)),
            createSessionDurableEventState(1),
        )

        expect(reduceSessionDurableEvent(initial, durableEvent(9))).toBe(initial)
        expect(reduceSessionDurableEvent(initial, durableEvent(6))).toBe(initial)
    })

    it("keeps event order separate from an event watermark ahead of it", () => {
        const first = reduceSessionDurableEvent(
            createSessionDurableEventState(1),
            durableEvent(3, "message.completed", 9),
        )
        const second = reduceSessionDurableEvent(first, durableEvent(6, "tool.completed", 9))

        expect(second.latestSequence).toBe(9)
        expect(second.lastEventSequence).toBe(6)
        expect(second.acceptedKnownEventCount).toBe(2)
    })

    it("learns the replay watermark when no typed event was returned", () => {
        const state = completeSessionDurableEventReplay(createSessionDurableEventState(1), 5)

        expect(state.latestSequence).toBe(5)
        expect(state.lastEventSequence).toBe(5)
        expect(state.acceptedKnownEventCount).toBe(0)
    })

    it("ignores unknown event payloads while advancing the reconnect cursor", () => {
        const state = reduceSessionDurableEvent(
            createSessionDurableEventState(8),
            durableEvent(9, "future.completed"),
        )

        expect(state.latestSequence).toBe(9)
        expect(state.acceptedKnownEventCount).toBe(0)
    })

    it("does not replay cursorless legacy envelopes into the live tail", () => {
        const state = createSessionDurableEventState(0)
        expect(reduceSessionDurableEvent(state, {...durableEvent(1), sequence: null})).toBe(state)
    })

    it("refetches for each newly accepted known event", () => {
        const initial = createSessionDurableEventState(4)
        const accepted = reduceSessionDurableEvent(initial, durableEvent(5))
        const duplicate = reduceSessionDurableEvent(accepted, durableEvent(5))

        expect(shouldRefetchSessionTranscript(initial, accepted, durableEvent(5))).toBe(true)
        expect(shouldRefetchSessionTranscript(accepted, duplicate, durableEvent(5))).toBe(false)
    })

    it("refetches once for a sequence gap, not for watermark-only advances", () => {
        let state = createSessionDurableEventState(4)
        let refetches = 0
        const feed = (event: SessionDurableEvent) => {
            const next = reduceSessionDurableEvent(state, event)
            if (shouldRefetchSessionTranscript(state, next, event)) refetches += 1
            state = next
        }

        feed(durableEvent(5, "future.completed", 8))
        feed(durableEvent(6, "future.completed", 9))
        expect(refetches).toBe(0)

        feed(durableEvent(8, "future.completed", 10))
        expect(refetches).toBe(1)
    })
})
