/**
 * Streaming chat route — App Router pattern.
 *
 * Reads the `useChat` request body (UIMessage[] under `messages`), extracts
 * an x-agenta-run-id header for per-run trace tagging, then streams via
 * AI SDK v6's streamText. `result.toUIMessageStreamResponse()` produces
 * the response shape `useChat` expects.
 *
 * After the stream finishes (or aborts), `flushTraces()` runs in
 * `result.consumeStream`'s finally so spans land in Agenta even on early
 * client disconnect.
 */

import {convertToModelMessages, type UIMessage} from "ai"
import {NextResponse, type NextRequest} from "next/server"

import {runStreamChat, flushTraces} from "../../lib/ai"

export const runtime = "nodejs"

export async function POST(req: NextRequest): Promise<Response> {
    const runId = req.headers.get("x-agenta-run-id") ?? `chat-${Date.now()}`
    let body: {messages?: UIMessage[]} = {}
    try {
        body = await req.json()
    } catch {
        return NextResponse.json({error: "invalid json"}, {status: 400})
    }
    const messages = body.messages ?? []
    if (messages.length === 0) {
        return NextResponse.json({error: "messages required"}, {status: 400})
    }

    const modelMessages = await convertToModelMessages(messages)
    const result = runStreamChat(
        modelMessages,
        {
            userId: runId,
            sessionId: runId,
        },
        req.signal,
    )

    return result.toUIMessageStreamResponse({
        // Force-flush after the stream finishes (or aborts). Even with
        // SimpleSpanProcessor this is defensive — some streamText spans
        // end async after the stream itself completes.
        onFinish: async () => {
            await flushTraces()
        },
    })
}
