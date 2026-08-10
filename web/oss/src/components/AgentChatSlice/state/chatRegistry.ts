import {Chat} from "@ai-sdk/react"
import {type ChatInit, type ChatStatus, type UIMessage} from "ai"

import {AgentChatTransport} from "../assets/AgentChatTransport"

/**
 * Live `Chat` instances keyed by session id, owned outside React. A run carrying a `sessionId` is
 * owned by the runner and survives the client disconnect, so binding the SSE read to the component
 * meant a route change threw away the live view of a run still producing (#5724). An instance lives
 * as long as its session tab is open; closing/deleting/archiving that tab tears it down.
 */

type TransportInit = NonNullable<ConstructorParameters<typeof AgentChatTransport>[0]>

/** Per-mount callbacks, rebound on every commit so a preserved chat never runs stale closures. */
export interface SessionChatHooks {
    prepareRequest: NonNullable<TransportInit["prepareSendMessagesRequest"]>
    sendAutomaticallyWhen: NonNullable<ChatInit<UIMessage>["sendAutomaticallyWhen"]>
    onFinish: NonNullable<ChatInit<UIMessage>["onFinish"]>
}

interface Handle {
    chat: Chat<UIMessage>
    hooks: SessionChatHooks
}

const registry = new Map<string, Handle>()

export const isChatBusy = (status: ChatStatus): boolean =>
    status === "submitted" || status === "streaming"

/**
 * This session's live chat, created on first use. `initialMessages` seeds a NEW instance only — an
 * existing one already holds the authoritative, possibly mid-stream transcript, and keeps the
 * callbacks of the last mount that COMMITTED until `bindSessionChatHooks` swaps them.
 */
export const acquireSessionChat = ({
    sessionId,
    initialMessages,
    hooks,
}: {
    sessionId: string
    initialMessages: UIMessage[]
    hooks: SessionChatHooks
}): Chat<UIMessage> => {
    const existing = registry.get(sessionId)
    if (existing) return existing.chat

    const handle = {hooks} as Handle
    handle.chat = new Chat<UIMessage>({
        id: sessionId,
        messages: initialMessages,
        // `api` is a placeholder that `prepareSendMessagesRequest` overrides per request.
        transport: new AgentChatTransport({
            api: "",
            prepareSendMessagesRequest: (args) => handle.hooks.prepareRequest(args),
        }),
        sendAutomaticallyWhen: (args) => handle.hooks.sendAutomaticallyWhen(args),
        onFinish: (event) => handle.hooks.onFinish(event),
        // Swallowed here so an aborted stream doesn't reach the Next.js dev overlay (F-033); the
        // mount renders it in-chat off `useChat`'s own `error`.
        onError: (error) =>
            console.warn("[AgentChatPanel] useChat error (rendered in-chat):", error),
    })
    registry.set(sessionId, handle)
    return handle.chat
}

/**
 * Point this session's chat at the callbacks of the mount that just committed. Called from an effect,
 * never during render: a render can be abandoned, and a preserved chat must not be left running the
 * closures of a render React threw away.
 */
export const bindSessionChatHooks = (sessionId: string, hooks: SessionChatHooks): void => {
    const handle = registry.get(sessionId)
    if (handle) handle.hooks = hooks
}

/**
 * Tear a session's chat down: stop the stream and forget the instance. Exported because a session can
 * die while no mount is holding it (closed, deleted, or archived from another route or another
 * device), and nothing would otherwise release it. Idempotent.
 */
export const dropSessionChat = (sessionId: string): void => {
    const handle = registry.get(sessionId)
    if (!handle) return
    void handle.chat.stop()
    registry.delete(sessionId)
}

/**
 * Drop this mount. A session whose tab is still open keeps its chat: the runner owns an in-flight run
 * (#5724), and holding an idle one means a remount re-binds to the SAME instance — handing `useChat` a
 * fresh instance under the same id would leave it subscribed to the old one. Only a session the user
 * closed/deleted/archived is torn down.
 */
export const releaseSessionChat = (sessionId: string, {stillOpen}: {stillOpen: boolean}): void => {
    if (stillOpen) return
    dropSessionChat(sessionId)
}

/** Test seam: is this session's chat still held? */
export const __hasSessionChat = (sessionId: string): boolean => registry.has(sessionId)
