import {Chat} from "@ai-sdk/react"
import {type ChatInit, type ChatStatus, type UIMessage} from "ai"

import {AgentChatTransport} from "../transport/AgentChatTransport"

/**
 * Live `Chat` instances keyed by session id, owned outside React. A run carrying a `sessionId` is
 * owned by the runner and survives the client disconnect, so binding the SSE read to the component
 * meant a route change threw away the live view of a run still producing (#5724).
 *
 * Shared by both hosts: the desktop slice keeps an instance for as long as its session TAB is open,
 * mobile (which has no tab model — the active session is the URL) keeps one only while its run is
 * streaming. Each host passes that verdict to `releaseSessionChat`; the registry itself has no
 * opinion. Same module-scope-`Map` shape and lifetime as `sessionEphemera`.
 */

type TransportInit = NonNullable<ConstructorParameters<typeof AgentChatTransport>[0]>

/** Per-mount callbacks, rebound on every commit so a preserved chat never runs stale closures. */
export interface SessionChatHooks {
    prepareRequest: NonNullable<TransportInit["prepareSendMessagesRequest"]>
    sendAutomaticallyWhen: NonNullable<ChatInit<UIMessage>["sendAutomaticallyWhen"]>
    onFinish: NonNullable<ChatInit<UIMessage>["onFinish"]>
    onError: NonNullable<ChatInit<UIMessage>["onError"]>
    onData: NonNullable<ChatInit<UIMessage>["onData"]>
}

export interface SessionChatHandle {
    chat: Chat<UIMessage>
    hooks: SessionChatHooks
}

type Handle = SessionChatHandle

const registry = new Map<string, Handle>()

/** False once this session was torn down (or replaced), so a dropped chat's callbacks go nowhere. */
const isLive = (sessionId: string, handle: Handle): boolean => registry.get(sessionId) === handle

export const isChatBusy = (status: ChatStatus): boolean =>
    status === "submitted" || status === "streaming"

/**
 * Build a chat for a session WITHOUT publishing it. Callers create one per mount during render and
 * hand it to `commitSessionChat` from an effect — see `useSessionChat`.
 */
export const createSessionChat = ({
    sessionId,
    initialMessages,
    hooks,
}: {
    sessionId: string
    initialMessages: UIMessage[]
    hooks: SessionChatHooks
}): Handle => {
    const handle = {hooks} as Handle
    handle.chat = new Chat<UIMessage>({
        id: sessionId,
        messages: initialMessages,
        // `api` is a placeholder that `prepareSendMessagesRequest` overrides per request.
        transport: new AgentChatTransport({
            api: "",
            prepareSendMessagesRequest: (args) => handle.hooks.prepareRequest(args),
        }),
        // Both gated: `stop()` aborts the stream, and the SDK still runs `onFinish` (with `isAbort`)
        // and then re-evaluates this predicate, which on a live gate would start a WHOLE NEW request.
        // Neither may reach the mount's callbacks once the session is gone.
        sendAutomaticallyWhen: (args) =>
            isLive(sessionId, handle) && handle.hooks.sendAutomaticallyWhen(args),
        onData: (part) => {
            if (isLive(sessionId, handle)) handle.hooks.onData(part)
        },
        onFinish: (event) => {
            if (!isLive(sessionId, handle)) return
            handle.hooks.onFinish(event)
        },
        // Swallowed here so an aborted stream doesn't reach the Next.js dev overlay (F-033); the
        // mount renders it in-chat off `useChat`'s own `error`. The mount's own handler runs after
        // (gated like the rest) to clear the state a failed stream leaves behind.
        onError: (error) => {
            console.warn("[AgentChatPanel] useChat error (rendered in-chat):", error)
            if (isLive(sessionId, handle)) handle.hooks.onError(error)
        },
    })
    return handle
}

/**
 * This session's published chat, or `undefined` if no mount has committed one yet.
 *
 * Read during render. A render may be ABANDONED, so it must not publish: an abandoned first render
 * that registered its chat would leave the registry holding an instance seeded from messages the
 * user never saw, and the next committed mount would reuse it and ignore its own `initialMessages`.
 * So render only reads; `commitSessionChat` (an effect) is what publishes.
 */
export const peekSessionChat = (sessionId: string): Chat<UIMessage> | undefined =>
    registry.get(sessionId)?.chat

/**
 * Publish the mount's chat if this session has none yet, and point the live one at the callbacks of
 * the mount that just committed. Called from an effect, never during render.
 *
 * Returns the chat that is now authoritative for the session. That is `handle.chat` whenever this
 * mount's chat won the claim; if another mount published first, the winner is returned instead and
 * this mount's provisional chat is discarded — the caller re-renders onto the winner.
 */
export const commitSessionChat = (sessionId: string, handle: Handle): Chat<UIMessage> => {
    const existing = registry.get(sessionId)
    if (!existing) {
        registry.set(sessionId, handle)
        return handle.chat
    }
    existing.hooks = handle.hooks
    return existing.chat
}

/**
 * Tear a session's chat down: stop the stream and forget the instance. Exported because a session can
 * die while no mount is holding it (closed, deleted, or archived from another route or another
 * device), and nothing would otherwise release it. Idempotent.
 */
export const dropSessionChat = (sessionId: string): void => {
    const handle = registry.get(sessionId)
    if (!handle) return
    // Unregistering IS the disposal: the callbacks the stop below triggers check `isLive`, so they
    // can no longer revalidate a session that is gone or resume a run into it.
    registry.delete(sessionId)
    void handle.chat.stop()
}

/**
 * Drop this mount's claim. `preserve` is the host's verdict on whether the session outlives the
 * mount — the desktop's "its tab is still open", mobile's "its run is still streaming". A preserved
 * chat means a remount re-binds to the SAME instance; handing `useChat` a fresh instance under the
 * same id would leave it subscribed to the old one.
 *
 * Matched on the mount's OWN `handle`: a mount that lost the claim (or whose session was already
 * torn down and re-claimed) must not stop the instance a newer mount is now streaming through.
 */
export const releaseSessionChat = (
    sessionId: string,
    handle: Handle,
    {preserve}: {preserve: boolean},
): void => {
    if (preserve) return
    if (registry.get(sessionId) !== handle) return
    dropSessionChat(sessionId)
}

/**
 * Is this session's chat still held? An unmounting conversation reads this to tell "my run was
 * preserved" from "my run is over", so it only clears the session's run-state dot in the latter case.
 */
export const hasSessionChat = (sessionId: string): boolean => registry.has(sessionId)

/** Test seam: forget every instance without stopping streams. */
export const __resetSessionChatsForTest = (): void => {
    registry.clear()
}
