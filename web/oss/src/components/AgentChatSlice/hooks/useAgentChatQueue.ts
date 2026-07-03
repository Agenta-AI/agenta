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
    /** The last turn was user-stopped (cancelled). A stop voids any pending approval / imminent
     * auto-resume, so the aborted turn's tool parts still reading as mid-HITL must NOT hold a new
     * send — a stopped-and-settled conversation is releasable. */
    stopped: boolean
    /** Send one released message into the conversation (wraps `useChat`'s `sendMessage`). Must be
     * referentially stable so the release effect doesn't churn on every streamed token. */
    sendQueued: (item: QueuedMessage) => void
}

/**
 * Holds user messages typed while a turn is in flight and releases them ONE AT A TIME once the
 * stream truly settles. It never releases mid human-in-the-loop (a tool-approval gate) — that
 * decision lives in `canReleaseQueuedMessage`. Releasing one message flips the conversation back
 * to busy, so the next stays queued until that turn settles too.
 *
 * Exception: a user STOP. Stopping aborts the run, which cancels any pending approval or the tick
 * before an auto-resume — but the aborted turn's tool parts keep their `approval-requested` /
 * `approval-responded` / client-tool-result shape, so `canReleaseQueuedMessage` would keep holding.
 * When `stopped`, a settled conversation is releasable so a fresh send goes immediately.
 */
export const useAgentChatQueue = ({
    status,
    messages,
    stopped,
    sendQueued,
}: UseAgentChatQueueArgs) => {
    const [queued, setQueued] = useState<QueuedMessage[]>([])

    // Settled = the stream is over (done or failed). A stop lands here (abort → "ready").
    const settled = status === "ready" || status === "error"
    // Releasable now: the normal gate, OR a stopped-and-settled turn (the stop voided its gate).
    const canReleaseNow = canReleaseQueuedMessage(status, messages) || (stopped && settled)

    // A stop voids the gate for release (above), so it must void it for reporting too — else the
    // aborted turn's lingering `approval-requested` part still reads as "awaiting" while `submit`
    // sends immediately. Keep `hitlPending` in lockstep with the release decision.
    const hitlPending = !stopped && isHitlPending(messages)

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
            if (!releasingRef.current && queuedRef.current.length === 0 && canReleaseNow) {
                releasingRef.current = true
                sendQueued(message)
            } else {
                setQueued((q) => [...q, message])
            }
        },
        [canReleaseNow, sendQueued],
    )

    const removeQueued = useCallback((id: string) => {
        setQueued((q) => q.filter((m) => m.id !== id))
    }, [])

    const clearQueue = useCallback(() => setQueued([]), [])

    // Release the queue head once the stream settles; the latch caps it at one per settle. Both
    // "ready" and "error" are settled — releasing on "error" retries the failed turn with the
    // queued message (which clears the error) instead of stranding the queue. "submitted"/
    // "streaming" are in-flight: reset the latch and hold.
    useEffect(() => {
        if (!settled) {
            releasingRef.current = false
            return
        }
        if (releasingRef.current || queued.length === 0) return
        if (!canReleaseNow) return
        releasingRef.current = true
        const [head, ...rest] = queued
        setQueued(rest)
        sendQueued(head)
    }, [settled, canReleaseNow, queued, sendQueued])

    return {
        queued,
        submit,
        removeQueued,
        clearQueue,
        /** The conversation is paused on a HITL approval — typed messages should queue, not send. */
        hitlPending,
    }
}
