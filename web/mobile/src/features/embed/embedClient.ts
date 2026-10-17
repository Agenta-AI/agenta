import {dispatchSessionLiveMessage, type SessionLiveHandlers} from "@agenta/chat/transport"
import {sessionRecordSchema, type SessionRecord} from "@agenta/entities/session"
import {z} from "zod"

import {readServerSentEvents} from "./sseReader"

/** Every call sends the visitor key and omits cookies: the widget never acts as a signed-in user. */

const conversationSchema = z.object({
    thread_id: z.string(),
    session_id: z.string(),
    created_at: z.string().nullish(),
    is_active: z.boolean(),
})

const conversationsSchema = z.object({conversations: z.array(conversationSchema)})

const conversationReadSchema = z.object({
    records: z.array(sessionRecordSchema),
    pending_choice: z
        .object({choices: z.array(z.object({label: z.string(), token: z.string()}))})
        .nullish(),
})

export type EmbedConversation = z.infer<typeof conversationSchema>
export interface EmbedConversationRead {
    records: SessionRecord[]
    choiceTokens: string[]
}

/** A file attached to a message, as base64 in the request body. */
export interface EmbedUpload {
    filename: string
    media_type: string
    data: string
}

export interface EmbedSendBody {
    /** Makes a retried send land once: the server deduplicates on it. */
    id: string
    text?: string
    files?: EmbedUpload[]
    type?: "action"
    token?: string
    displayName?: string
    context?: Record<string, unknown>
}

/** A refused request. `status` 401 means the embed is gone or the key is refused. */
export class EmbedRequestError extends Error {
    constructor(
        readonly status: number,
        message: string,
        readonly retryAfterSeconds: number | null = null,
    ) {
        super(message)
    }
}

const refusal = async (response: Response): Promise<EmbedRequestError> => {
    let detail = ""
    try {
        const body = (await response.json()) as {detail?: unknown}
        if (typeof body.detail === "string") detail = body.detail
    } catch {
        // No JSON body: the status alone says what happened.
    }
    const retryAfter = Number(response.headers.get("Retry-After"))
    return new EmbedRequestError(
        response.status,
        detail || `The request failed (${response.status}).`,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    )
}

export interface EmbedLiveConnection {
    close: () => void
}

export const createEmbedClient = ({
    apiUrl,
    embedId,
    visitorKey,
}: {
    apiUrl: string
    embedId: string
    visitorKey: string
}) => {
    const id = encodeURIComponent(embedId)
    const conversations = `${apiUrl}/channels/embed/${id}/conversations`

    const request = async (url: string, init: RequestInit = {}): Promise<Response> => {
        const response = await fetch(url, {
            ...init,
            credentials: "omit",
            cache: "no-store",
            headers: {...init.headers, "X-Agenta-Visitor-Key": visitorKey},
        })
        if (!response.ok) throw await refusal(response)
        return response
    }

    return {
        /** Every visitor action: a message, a command such as `!new`, or a choice answer. */
        send: async (body: EmbedSendBody): Promise<void> => {
            await request(`${apiUrl}/channels/embed/events/${id}/`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(body),
            })
        },

        /** Newest first, one entry per conversation; the first is the one a message goes to. */
        listConversations: async (): Promise<EmbedConversation[]> => {
            const response = await request(conversations)
            return conversationsSchema.parse(await response.json()).conversations
        },

        readConversation: async (threadId: string): Promise<EmbedConversationRead> => {
            const response = await request(`${conversations}/${encodeURIComponent(threadId)}`)
            const body = conversationReadSchema.parse(await response.json())
            return {
                records: body.records,
                choiceTokens: body.pending_choice?.choices.map((choice) => choice.token) ?? [],
            }
        },

        fileBlob: async (threadId: string, fileId: string): Promise<Blob> => {
            const response = await request(
                `${conversations}/${encodeURIComponent(threadId)}/files/${encodeURIComponent(fileId)}`,
            )
            return response.blob()
        },

        /** Live frames and events after `after`; `onDisconnect` fires once, and the caller reconnects. */
        connectLive: (
            {threadId, sessionId, after}: {threadId: string; sessionId: string; after: number},
            handlers: SessionLiveHandlers,
        ): EmbedLiveConnection => {
            const abort = new AbortController()
            let ended = false
            const end = (reason: string, reconnect: boolean) => {
                if (ended) return
                ended = true
                abort.abort()
                if (reason !== "closed") handlers.onDisconnect({reason, reconnect})
            }
            const url = `${conversations}/${encodeURIComponent(threadId)}/live?after=${Math.max(0, after)}`
            void (async () => {
                try {
                    const response = await request(url, {signal: abort.signal})
                    if (!response.body) return end("connection_lost", true)
                    await readServerSentEvents(response.body, (message) => {
                        if (ended) return
                        const keepOpen = dispatchSessionLiveMessage(message, {
                            sessionId,
                            after,
                            ...handlers,
                            // A relay close is reported here, once, by `end`.
                            onDisconnect: ({reason, reconnect}) => end(reason, reconnect),
                        })
                        if (!keepOpen) end("relay_closed", false)
                    })
                    end("connection_lost", true)
                } catch (error) {
                    const status = error instanceof EmbedRequestError ? error.status : 0
                    if (status === 401) end("unauthorized", false)
                    else if (status >= 400 && status < 500 && status !== 429) end("refused", false)
                    else end("connection_lost", true)
                }
            })()
            return {close: () => end("closed", false)}
        },
    }
}

export type EmbedClient = ReturnType<typeof createEmbedClient>
