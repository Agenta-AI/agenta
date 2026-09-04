import {describe, expect, it} from "vitest"

import type {SessionDurableEvent} from "@agenta/entities/session"

import {
    completeSessionDurableEventReplay,
    createSessionDurableEventState,
    reduceSessionDurableEvent,
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
        expect(twice.events.map((event) => event.sequence)).toEqual([5])
        expect(twice).toBe(once)
    })

    it("applies the non-contiguous event sequence seen on the live relay", () => {
        const state = [3, 6, 7, 9].reduce(
            (current, sequence) => reduceSessionDurableEvent(current, durableEvent(sequence)),
            createSessionDurableEventState(1),
        )

        expect(state.latestSequence).toBe(9)
        expect(state.lastEventSequence).toBe(9)
        expect(state.events.map((event) => event.sequence)).toEqual([3, 6, 7, 9])
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
        expect(second.events.map((event) => event.sequence)).toEqual([3, 6])
    })

    it("learns the replay watermark when no typed event was returned", () => {
        const state = completeSessionDurableEventReplay(createSessionDurableEventState(1), 5)

        expect(state.latestSequence).toBe(5)
        expect(state.lastEventSequence).toBe(5)
        expect(state.events).toEqual([])
    })

    it("ignores unknown event payloads while advancing the reconnect cursor", () => {
        const state = reduceSessionDurableEvent(
            createSessionDurableEventState(8),
            durableEvent(9, "future.completed"),
        )

        expect(state.latestSequence).toBe(9)
        expect(state.events).toEqual([])
    })

    it("does not replay cursorless legacy envelopes into the live tail", () => {
        const state = createSessionDurableEventState(0)
        expect(reduceSessionDurableEvent(state, {...durableEvent(1), sequence: null})).toBe(state)
    })
})
