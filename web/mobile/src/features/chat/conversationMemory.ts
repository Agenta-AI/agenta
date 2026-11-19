import {useCallback, useState} from "react"

/**
 * What a conversation shows that is not in its records, kept per session id so a remount (a move
 * between the session page and an agent page) can put it back. The composer text has its own
 * store (`composerDraftBySession` in `@agenta/chat`). Only small values live here: no messages.
 */
export interface ConversationMemory {
    /**
     * How far the transcript was scrolled up from its end, in pixels. Measured from the end, not
     * the top: a remount renders only the newest turns, so a top offset points somewhere else.
     */
    scrollFromBottom: number
    /** The transcript was at the latest message: a return lands on the latest again. */
    atLatest: boolean
    /** The open quick action of a new builder chat, by its id. */
    quickAction: string | null
}

const memoryBySession = new Map<string, ConversationMemory>()

const EMPTY: ConversationMemory = {scrollFromBottom: 0, atLatest: true, quickAction: null}

export const readConversationMemory = (sessionId: string): ConversationMemory | undefined =>
    memoryBySession.get(sessionId)

export const writeConversationMemory = (sessionId: string, patch: Partial<ConversationMemory>) => {
    memoryBySession.set(sessionId, {...(memoryBySession.get(sessionId) ?? EMPTY), ...patch})
}

/** The open quick action of a conversation, restored after a remount. */
export const useConversationQuickAction = (sessionId: string) => {
    const [held, setHeld] = useState(() => ({
        sessionId,
        value: memoryBySession.get(sessionId)?.quickAction ?? null,
    }))
    // A host that stays mounted across a chat switch reads the other chat's value, not the held one.
    const quickAction =
        held.sessionId === sessionId
            ? held.value
            : (memoryBySession.get(sessionId)?.quickAction ?? null)
    const setQuickAction = useCallback(
        (next: string | null) => {
            setHeld({sessionId, value: next})
            writeConversationMemory(sessionId, {quickAction: next})
        },
        [sessionId],
    )
    return [quickAction, setQuickAction] as const
}
