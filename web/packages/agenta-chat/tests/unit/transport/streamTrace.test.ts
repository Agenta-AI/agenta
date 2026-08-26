import {afterEach, describe, expect, it, vi} from "vitest"

import {
    recordStreamChunk,
    resetStreamTrace,
    summarizeStreamTrace,
    traceStreamChunks,
} from "../../../src/transport/streamTrace"

/**
 * The client half of the stream inter-arrival trace. What matters is that it measures the gaps
 * it claims to (per kind, ignoring the first sample) and that wrapping the stream changes
 * nothing that flows through it.
 */

afterEach(() => {
    resetStreamTrace()
    vi.restoreAllMocks()
})

const atTimes = (times: number[], record: (i: number) => void) => {
    let i = 0
    vi.spyOn(performance, "now").mockImplementation(() => times[Math.min(i, times.length - 1)])
    for (; i < times.length; i++) record(i)
}

describe("streamTrace", () => {
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
