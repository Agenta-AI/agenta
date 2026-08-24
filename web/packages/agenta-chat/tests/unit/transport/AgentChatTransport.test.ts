import type {UIMessage, UIMessageChunk} from "ai"
import {describe, expect, it, vi} from "vitest"

import {AgentChatTransport} from "../../../src/transport/AgentChatTransport"

const readAll = async (stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> => {
    const reader = stream.getReader()
    const chunks: UIMessageChunk[] = []
    for (;;) {
        const {done, value} = await reader.read()
        if (done) break
        chunks.push(value)
    }
    return chunks
}

const userMessage = (text: string): UIMessage =>
    ({id: "m1", role: "user", parts: [{type: "text", text}]}) as unknown as UIMessage

describe("AgentChatTransport", () => {
    it("constructs and owns its own fetch (a caller-supplied fetch becomes the negotiator's base)", () => {
        const baseFetch = vi.fn()
        const transport = new AgentChatTransport({api: "/api/agent/invoke", fetch: baseFetch})
        expect(transport).toBeInstanceOf(AgentChatTransport)
    })

    it("parses a batch JSON response (the negotiator's 406 fallback shape) into a UIMessage chunk stream", async () => {
        const batchBody = JSON.stringify({
            session_id: "session-1",
            data: {
                outputs: {
                    messages: [{role: "assistant", content: "hello from batch"}],
                },
            },
        })
        // The negotiator requests SSE first (Accept: text/event-stream); answering 406 there
        // triggers its batch re-request with Accept: application/json — that's the request this
        // stub honours, matching what a handler that can't stream actually does.
        const baseFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            const accept = new Headers(init?.headers).get("accept") ?? ""
            if (accept.includes("text/event-stream")) {
                return new Response(null, {status: 406})
            }
            return new Response(batchBody, {
                status: 200,
                headers: {"content-type": "application/json"},
            })
        })

        const transport = new AgentChatTransport({
            api: "/api/agent/invoke",
            // Mirrors the desktop caller (AgentConversation.tsx): the request builder's headers
            // carry the Accept the negotiator branches on — this transport itself sets none.
            headers: {Accept: "text/event-stream"},
            fetch: baseFetch as unknown as typeof fetch,
        })

        const stream = await transport.sendMessages({
            trigger: "submit-message",
            chatId: "chat-1",
            messageId: undefined,
            messages: [userMessage("hi")],
        })

        const chunks = await readAll(stream)
        expect(chunks[0]).toMatchObject({type: "start"})
        expect(chunks.some((c) => c.type === "text-delta" && c.delta === "hello from batch")).toBe(
            true,
        )
        expect(chunks[chunks.length - 1]).toMatchObject({type: "finish"})
        // Two requests: the stream attempt (406) then the batch fallback.
        expect(baseFetch).toHaveBeenCalledTimes(2)
    })

    // A batch turn carries the call and its result as two blocks sharing one tool_use_id. The
    // AI SDK keys tool parts by that id, so a second input chunk would overwrite the named call.
    it("does not replay an input chunk for the nameless tool_result half of a batch tool turn", async () => {
        const batchBody = JSON.stringify({
            session_id: "session-1",
            data: {
                outputs: {
                    messages: [
                        {
                            role: "assistant",
                            content: [
                                {
                                    type: "tool_use",
                                    id: "call-1",
                                    name: "bash",
                                    input: {command: "echo hi"},
                                },
                                {type: "tool_result", tool_use_id: "call-1", content: "hi"},
                            ],
                        },
                    ],
                },
            },
        })
        const baseFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            const accept = new Headers(init?.headers).get("accept") ?? ""
            if (accept.includes("text/event-stream")) return new Response(null, {status: 406})
            return new Response(batchBody, {
                status: 200,
                headers: {"content-type": "application/json"},
            })
        })

        const transport = new AgentChatTransport({
            api: "/api/agent/invoke",
            headers: {Accept: "text/event-stream"},
            fetch: baseFetch as unknown as typeof fetch,
        })
        const chunks = await readAll(
            await transport.sendMessages({
                trigger: "submit-message",
                chatId: "chat-1",
                messageId: undefined,
                messages: [userMessage("run it")],
            }),
        )

        const inputs = chunks.filter((c) => c.type === "tool-input-available")
        expect(inputs).toHaveLength(1)
        expect(inputs[0]).toMatchObject({toolCallId: "call-1", toolName: "bash"})
        // The result still arrives, under the same id, so the call renders as completed.
        expect(chunks.filter((c) => c.type === "tool-output-available")).toMatchObject([
            {toolCallId: "call-1", output: "hi"},
        ])
    })

    // Smoothing re-emits a coarse backend delta as word-sized pieces. Past the per-chunk time
    // budget the per-piece delay falls below a millisecond, which used to disable yielding
    // altogether and flush the whole thing from one `pull()`. Pieces now carry across pulls, so
    // what must be proved is that the text still reassembles EXACTLY and in order.
    it("re-emits an oversized delta piece by piece without losing or reordering any of it", async () => {
        const words = Array.from({length: 4000}, (_, i) => `w${i}`)
        const text = words.join(" ")
        const sseBody =
            [
                {type: "start", messageId: "assist-1"},
                {type: "start-step"},
                {type: "text-start", id: "t1"},
                {type: "text-delta", id: "t1", delta: text},
                {type: "text-end", id: "t1"},
                {type: "finish-step"},
                {type: "finish"},
            ]
                .map((c) => `data: ${JSON.stringify(c)}\n\n`)
                .join("") + "data: [DONE]\n\n"

        const baseFetch = vi.fn(
            async () =>
                new Response(sseBody, {
                    status: 200,
                    headers: {"content-type": "text/event-stream"},
                }),
        )
        const transport = new AgentChatTransport({
            api: "/api/agent/invoke",
            headers: {Accept: "text/event-stream"},
            fetch: baseFetch as unknown as typeof fetch,
        })
        const chunks = await readAll(
            await transport.sendMessages({
                trigger: "submit-message",
                chatId: "chat-1",
                messageId: undefined,
                messages: [userMessage("write a lot")],
            }),
        )

        const deltas = chunks.filter((c) => c.type === "text-delta") as {delta: string}[]
        // Genuinely split up, not passed through whole…
        expect(deltas.length).toBeGreaterThan(1000)
        // …and byte-identical once reassembled, in order.
        expect(deltas.map((c) => c.delta).join("")).toBe(text)
        // The surrounding chunks keep their positions around it.
        expect(chunks[0]).toMatchObject({type: "start"})
        expect(chunks[chunks.length - 1]).toMatchObject({type: "finish"})
        expect(chunks.filter((c) => c.type === "text-end")).toHaveLength(1)
    })
})
