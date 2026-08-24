import {describe, expect, it} from "vitest"

import {parseEventStream} from "@/lib/api/stream"

const responseFor = (...frames: Record<string, unknown>[]) => {
    const body = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")
    return new Response(body, {status: 200, headers: {"Content-Type": "text/event-stream"}})
}

async function collect(response: Response, signal?: AbortSignal) {
    const frames = []
    for await (const frame of parseEventStream(response, signal)) frames.push(frame)
    return frames
}

describe("Vercel SSE parser", () => {
    it("parses deltas and completion", async () => {
        const frames = await collect(
            responseFor(
                {type: "text-delta", id: "t1", delta: "Hi"},
                {type: "finish", finishReason: "stop"},
            ),
        )
        expect(frames.map((frame) => frame.type)).toEqual(["text-delta", "finish"])
    })

    it.each([
        [
            "provider error",
            {type: "data-agent-error", data: {code: "provider_error", errorText: "invalid key"}},
        ],
        [
            "runner error",
            {type: "data-agent-error", data: {code: "runner_error", errorText: "runner down"}},
        ],
        ["error frame", {type: "error", errorText: "failed"}],
        ["denied tool", {type: "tool-output-denied", toolCallId: "tool_1"}],
    ])("parses %s", async (_name, frame) => {
        const frames = await collect(responseFor(frame, {type: "finish"}))
        expect(frames[0]).toMatchObject(frame)
    })

    it("classifies an aborted reader as cancellation", async () => {
        const controller = new AbortController()
        controller.abort()
        const stream = new ReadableStream({
            pull() {
                throw new DOMException("aborted", "AbortError")
            },
        })
        await expect(collect(new Response(stream), controller.signal)).rejects.toMatchObject({
            code: "turn_cancelled",
        })
    })

    it("classifies EOF without finish as disconnect", async () => {
        await expect(
            collect(responseFor({type: "text-delta", id: "t1", delta: "partial"})),
        ).rejects.toMatchObject({code: "stream_disconnected", retryable: true})
    })
})
