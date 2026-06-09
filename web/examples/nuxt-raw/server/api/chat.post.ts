/**
 * Streaming chat route — Nuxt 3/4 pattern.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ Nitro server routes use `defineEventHandler`. AI SDK's      │
 *   │ `result.toUIMessageStreamResponse()` returns a fetch        │
 *   │ Response — the same sink shape as Next.js App Router and    │
 *   │ TanStack Start. Returning a Response from defineEventHandler│
 *   │ is supported by H3 directly.                                │
 *   │                                                             │
 *   │ File naming `.post.ts` makes this respond only to POST.     │
 *   └─────────────────────────────────────────────────────────────┘
 */

import {convertToModelMessages, type UIMessage} from "ai"

import {flushTraces, runStreamChat} from "../lib/ai"

export default defineEventHandler(async (event) => {
    const runId = getHeader(event, "x-agenta-run-id") ?? `chat-${Date.now()}`
    let body: {messages?: UIMessage[]}
    try {
        body = await readBody<{messages?: UIMessage[]}>(event)
    } catch {
        throw createError({statusCode: 400, statusMessage: "invalid json"})
    }
    const messages = body?.messages ?? []
    if (messages.length === 0) {
        throw createError({statusCode: 400, statusMessage: "messages required"})
    }

    const modelMessages = await convertToModelMessages(messages)
    // P-NUXT-01: No working abort-signal propagation in Nuxt 4 / Nitro /
    // H3 v2 RC. Verified empirically:
    //   - event.req.signal: types claim it exists; runtime says undefined
    //   - event.runtime.node.req: types document it; runtime says undefined
    //   - event.node.req 'close' event: fires but only AFTER the response
    //     stream finishes naturally, not when the client disconnects
    //     mid-stream — so it doesn't help
    // streamText therefore receives no abortSignal here and keeps
    // generating server-side after client abort. Parent span ends ~7-15s
    // late, outside assertion-2's 5s flush window. Assertion-2 in this
    // app's test script uses a 30s window to compensate.
    const result = runStreamChat(modelMessages, {userId: runId, sessionId: runId})

    return result.toUIMessageStreamResponse({
        onFinish: async () => {
            await flushTraces()
        },
    })
})
