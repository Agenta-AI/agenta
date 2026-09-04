import {describe, expect, it} from "vitest"

import type {SessionDurableEvent} from "@agenta/entities/session"

import {createSessionDurableEventState, reduceSessionDurableEvent} from "../../../src/model"

const durableEvent = (sequence: number, type = "message.completed"): SessionDurableEvent => ({
    version: 1,
    kind: "event",
    session_id: "session-1",
    execution_id: "execution-1",
    frame_or_event_id: `event-${sequence}`,
    sequence,
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

    it("buffers out-of-order arrivals and drains them in sequence order", () => {
        const initial = createSessionDurableEventState(2)
        const gap = reduceSessionDurableEvent(initial, durableEvent(4, "tool.completed"))
        const filled = reduceSessionDurableEvent(gap, durableEvent(3))

        expect(gap.latestSequence).toBe(2)
        expect(filled.latestSequence).toBe(4)
        expect(filled.events.map((event) => event.sequence)).toEqual([3, 4])
        expect(filled.pending).toEqual({})
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
