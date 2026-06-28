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

    // One latch shared by both send paths caps releases to one per settle and preserves FIFO.
    const releasingRef = useRef(false)
    const queuedRef = useRef(queued)
    useEffect(() => {
        queuedRef.current = queued
    }, [queued])

    // Send now only if idle, unlatched, and the queue is empty; otherwise append (FIFO).
    const submit = useCallback(
        (item: {text: string; fileParts?: FileUIPart[]}) => {
            const message: QueuedMessage = {...item, id: generateId()}
            if (
                !releasingRef.current &&
                queuedRef.current.length === 0 &&
                canReleaseQueuedMessage(status, messages)
            ) {
                releasingRef.current = true
                sendQueued(message)
            } else {
                setQueued((q) => [...q, message])
            }
        },
        [status, messages, sendQueued],
    )

    const removeQueued = useCallback((id: string) => {
        setQueued((q) => q.filter((m) => m.id !== id))
    }, [])

    const clearQueue = useCallback(() => setQueued([]), [])

    // Release the queue head once the stream settles; the latch caps it at one per settle.
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
