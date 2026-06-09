/**
 * Streaming chat server route — TanStack Start pattern.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ TanStack Start 1.167+ exposes server routes via the         │
 *   │ `server: {handlers: {POST: ...}}` property on               │
 *   │ `createFileRoute` (imported from @tanstack/react-router).   │
 *   │                                                             │
 *   │ The handler receives `{request, params, context}` and       │
 *   │ returns a fetch `Response` — the AI SDK's                   │
 *   │ `result.toUIMessageStreamResponse()` produces exactly that  │
 *   │ shape. Same sink as Next.js App Router; framework-specific  │
 *   │ bit is just the entry shape.                                │
 *   └─────────────────────────────────────────────────────────────┘
 */

import {createFileRoute} from "@tanstack/react-router"
import {convertToModelMessages, type UIMessage} from "ai"

import {flushTraces, runStreamChat} from "../../lib/ai"

export const Route = createFileRoute("/api/chat")({
    server: {
        handlers: {
            POST: async ({request}) => {
                const runId = request.headers.get("x-agenta-run-id") ?? `chat-${Date.now()}`
                let body: {messages?: UIMessage[]} = {}
                try {
                    body = (await request.json()) as {messages?: UIMessage[]}
                } catch {
                    return new Response(JSON.stringify({error: "invalid json"}), {
                        status: 400,
                        headers: {"content-type": "application/json"},
                    })
                }
                const messages = body.messages ?? []
                if (messages.length === 0) {
                    return new Response(JSON.stringify({error: "messages required"}), {
                        status: 400,
                        headers: {"content-type": "application/json"},
                    })
                }

                const modelMessages = await convertToModelMessages(messages)
                const result = runStreamChat(
                    modelMessages,
                    {userId: runId, sessionId: runId},
                    request.signal,
                )

                return result.toUIMessageStreamResponse({
                    onFinish: async () => {
                        await flushTraces()
                    },
                })
            },
        },
    },
})
