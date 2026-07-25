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
})
