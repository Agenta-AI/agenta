/**
 * Streaming chat route — Pages Router pattern.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ This is the central Pages-vs-App difference for the spike:  │
 *   │ Pages API routes return a Node ServerResponse, NOT a fetch  │
 *   │ Response. So the AI SDK's toUIMessageStreamResponse() (used │
 *   │ in App Router) doesn't apply — instead we use               │
 *   │ pipeUIMessageStreamToResponse({response, stream}) which     │
 *   │ writes UIMessageChunks straight to the Node res.            │
 *   │                                                             │
 *   │ The useChat client side (in pages/index.tsx) is identical   │
 *   │ to App Router — same DefaultChatTransport({api: '/api/chat'}│
 *   │ pattern works against both router types.                    │
 *   └─────────────────────────────────────────────────────────────┘
 */

import {convertToModelMessages, pipeUIMessageStreamToResponse, type UIMessage} from "ai"
import type {NextApiRequest, NextApiResponse} from "next"

import {flushTraces, runStreamChat} from "../../lib/ai"

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
    if (req.method !== "POST") {
        res.status(405).json({error: "method not allowed"})
        return
    }

    const runId = (req.headers["x-agenta-run-id"] as string | undefined) ?? `chat-${Date.now()}`
    const body = req.body as {messages?: UIMessage[]} | undefined
    const messages = body?.messages ?? []
    if (messages.length === 0) {
        res.status(400).json({error: "messages required"})
        return
    }

    const modelMessages = await convertToModelMessages(messages)

    // Pages req.signal exists from Next 13.4+ but type defs lag — cast.
    const reqSignal = (req as unknown as {signal?: AbortSignal}).signal

    const result = runStreamChat(modelMessages, {userId: runId, sessionId: runId}, reqSignal)

    pipeUIMessageStreamToResponse({
        response: res,
        stream: result.toUIMessageStream({
            onFinish: async () => {
                await flushTraces()
            },
        }),
    })
}
