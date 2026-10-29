import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    recordStreamChunk,
    resetStreamTrace,
    setStreamTraceArmed,
    summarizeStreamTrace,
    traceStreamChunks,
} from "../../../src/transport/streamTrace"

/**
 * The client half of the stream inter-arrival trace. What matters is that it records nothing
 * until armed, that it measures the gaps it claims to (per kind, never across a turn), and that
 * wrapping the stream changes nothing that flows through it.
 */

beforeEach(() => {
    setStreamTraceArmed(true)
})

afterEach(() => {
    resetStreamTrace()
    setStreamTraceArmed(undefined)
    vi.restoreAllMocks()
})

const atTimes = (times: number[], record: (i: number) => void) => {
    let i = 0
    vi.spyOn(performance, "now").mockImplementation(() => times[Math.min(i, times.length - 1)])
    for (; i < times.length; i++) record(i)
}

describe("streamTrace", () => {
    it("records nothing until armed", () => {
        setStreamTraceArmed(false)
        atTimes([0, 400], () => recordStreamChunk({type: "text-delta", delta: "hi"}))
        expect(summarizeStreamTrace().count).toBe(0)
    })

    /**
     * The gap that matters is between deltas of ONE turn. Idle time while the user reads and
     * types the next prompt is not an inter-arrival gap, and letting it into the histogram
     * would report a multi-second p90 for a stream that never stalled.
     */
    it("never measures a gap across a turn boundary", () => {
        let clock = 0
        vi.spyOn(performance, "now").mockImplementation(() => clock)

        recordStreamChunk({type: "start", messageId: "a"})
        recordStreamChunk({type: "text-delta", delta: "one"})
        clock = 100
        recordStreamChunk({type: "text-delta", delta: "two"})
        clock = 30_000 // the user read the answer, then sent another prompt
        recordStreamChunk({type: "start", messageId: "b"})
        recordStreamChunk({type: "text-delta", delta: "three"})
        clock = 30_150
        recordStreamChunk({type: "text-delta", delta: "four"})

        const {gaps} = summarizeStreamTrace()
        expect(gaps.text.n).toBe(2)
        expect(gaps.text.max).toBe(150)
    })

    it("keeps only the newest entries once the ring is full", () => {
        let clock = 0
        vi.spyOn(performance, "now").mockImplementation(() => clock)
        for (let i = 0; i < 2100; i++) {
            clock = i
            recordStreamChunk({type: "text-delta", delta: "x"})
        }
        const {count, entries} = summarizeStreamTrace()
        expect(count).toBe(2000)
        // Ascending and ending at the newest sample: the ring did not scramble the order.
        expect(entries[entries.length - 1].at).toBe(2099)
        expect(entries[0].at).toBe(100)
    })

    it("measures gaps per kind and ignores the first sample of each", () => {
        atTimes([0, 400, 800], () =>
            recordStreamChunk({type: "reasoning-delta", delta: "Research"}),
        )

        const {gaps, count} = summarizeStreamTrace()
        expect(count).toBe(3)
        expect(gaps.reasoning.n).toBe(2)
        expect(gaps.reasoning.max).toBe(400)
        expect(gaps.text).toBeUndefined()
    })

    it("ignores chunks that carry no prose", () => {
        recordStreamChunk({type: "tool-input-start", toolCallId: "t1"})
        recordStreamChunk({type: "finish"})
        recordStreamChunk(undefined)

        expect(summarizeStreamTrace().count).toBe(0)
    })

    it("passes every chunk through unchanged", async () => {
        const input = [
            {type: "text-start", id: "t"},
            {type: "text-delta", id: "t", delta: "hi"},
            {type: "text-end", id: "t"},
        ]
        const source = new ReadableStream({
            start(controller) {
                for (const chunk of input) controller.enqueue(chunk)
                controller.close()
            },
        })

        const seen: unknown[] = []
        const reader = traceStreamChunks(source).getReader()
        for (;;) {
            const {done, value} = await reader.read()
            if (done) break
            seen.push(value)
        }

        expect(seen).toEqual(input)
        expect(summarizeStreamTrace().count).toBe(1)
    })
})
