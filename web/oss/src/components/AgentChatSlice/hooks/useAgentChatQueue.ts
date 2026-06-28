import {useCallback, useEffect, useRef, useState} from "react"

import {canReleaseQueuedMessage, isHitlPending} from "@agenta/playground"
import {generateId} from "@agenta/shared/utils"
import type {FileUIPart, UIMessage} from "ai"

export interface QueuedMessage {
    id: string
    text: string
    fileParts?: FileUIPart[]
}

interface UseAgentChatQueueArgs {
    status: string
    messages: UIMessage[]
    /** Send one released message into the conversation (wraps `useChat`'s `sendMessage`). Must be
     * referentially stable so the release effect doesn't churn on every streamed token. */
    sendQueued: (item: QueuedMessage) => void
}

/**
 * Holds user messages typed while a turn is in flight and releases them ONE AT A TIME once the
 * stream truly settles. It never releases mid human-in-the-loop (a tool-approval gate) — that
 * decision lives in `canReleaseQueuedMessage`. Releasing one message flips the conversation back
 * to busy, so the next stays queued until that turn settles too.
 */
export const useAgentChatQueue = ({status, messages, sendQueued}: UseAgentChatQueueArgs) => {
    const [queued, setQueued] = useState<QueuedMessage[]>([])

    // Single entry point for a user message: send it now only when the queue is empty AND the turn
    // is releasable — the same gate the release effect uses. Otherwise append, so a new message
    // never jumps ahead of older queued ones (and never fires into a busy/HITL/errored turn).
    const submit = useCallback(
        (item: {text: string; fileParts?: FileUIPart[]}) => {
            const message: QueuedMessage = {...item, id: generateId()}
            if (queued.length === 0 && canReleaseQueuedMessage(status, messages)) {
                sendQueued(message)
            } else {
                setQueued((q) => [...q, message])
            }
        },
        [queued, status, messages, sendQueued],
    )

    const removeQueued = useCallback((id: string) => {
        setQueued((q) => q.filter((m) => m.id !== id))
    }, [])

    const clearQueue = useCallback(() => setQueued([]), [])

    // Release the head of the queue when the stream settles. The ref guards the tick between
    // `sendQueued()` and `status` flipping away from "ready", so a single settle releases exactly
    // one message (not the whole queue in one render).
    const releasingRef = useRef(false)
    useEffect(() => {
        if (status !== "ready") {
            releasingRef.current = false
            return
        }
        if (releasingRef.current || queued.length === 0) return
        if (!canReleaseQueuedMessage(status, messages)) return
        releasingRef.current = true
        const [head, ...rest] = queued
        setQueued(rest)
        sendQueued(head)
    }, [status, messages, queued, sendQueued])

    return {
        queued,
        submit,
        removeQueued,
        clearQueue,
        /** The conversation is paused on a HITL approval — typed messages should queue, not send. */
        hitlPending: isHitlPending(messages),
    }
}
