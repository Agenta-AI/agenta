// Canonical since the desktop re-plumb: the OSS copy is deleted and both apps import this.
import {useCallback, useEffect, useRef, useState} from "react"

import {
    approvalContinuationSettled,
    canReleaseQueuedMessage,
    hasRunningApprovalContinuation,
    isHitlPending,
} from "@agenta/playground/agent-chat"
import {generateId} from "@agenta/shared/utils"
import type {FileUIPart, UIMessage} from "ai"

import {latestTurnId} from "../assets/agentTurn"

import type {ComposerAttachment} from "./useComposerAttachments"

export interface QueuedMessage {
    id: string
    text: string
    fileParts?: FileUIPart[]
    stagedFiles?: ComposerAttachment[]
}

interface UseAgentChatQueueArgs {
    status: string
    messages: UIMessage[]
    /** The invoke stream disconnected after acceptance, but the shared session run still owns the
     * turn. New messages stay queued until its durable terminal event arrives. */
    acceptedRunPending?: boolean
    /** The last turn was user-stopped (cancelled). A stop voids any pending approval / imminent
     * auto-resume, so the aborted turn's tool parts still reading as mid-HITL must NOT hold a new
     * send — a stopped-and-settled conversation is releasable. */
    stopped: boolean
    /** The tail's "resume imminent" shape is an orphan: it was RESTORED from storage (page
     * reload / pane remount killed the run mid-approval-resume) and no interaction in this
     * mount can fire the auto-resume. Holding for it would freeze the queue forever with no
     * dock and no stop (AGE-3937), so it voids the hold exactly like a user stop. */
    resumeOrphaned?: boolean
    /** The approval answer is durable but its continuation was not delivered. A composer Send
     * keeps the message held and uses the click to retry that continuation first. */
    recoverable?: boolean
    retryContinuation?: () => Promise<boolean>
    /**
     * Execution id of the durable approval continuation this mount just started, read from the
     * respond body (`execution.id`). Non-null means the server owns the next turn: nothing may
     * release until that execution's own terminal record lands in the transcript.
     *
     * It exists because the transcript-derived hold cannot cover the whole window. The
     * `approvalContinuation` metadata only appears once the continuation's FIRST record is
     * persisted — measured at 8 seconds after the answer on a local sandbox — and a transcript
     * adopted inside that gap shows a paused turn with an answered gate, which every release path
     * reads as settled.
     */
    continuationExecutionId?: string | null
    /** Mark this tab as the next run's owner before a released send reaches the transport. */
    markRunOwned: () => void
    /** Send one released message into the conversation (wraps `useChat`'s `sendMessage`). Must be
     * referentially stable so the release effect doesn't churn on every streamed token. */
    sendQueued: (item: QueuedMessage) => void
    /** Persist held messages under this key across pane remounts (route re-entry, tab
     * close/reopen) — a restored queue releases normally once the conversation settles. */
    sessionId?: string
}

// In-memory, page-session lifetime — same as the composer drafts it accompanies.
const queuedBySession = new Map<string, QueuedMessage[]>()

/**
 * Ceiling on the id-keyed continuation hold.
 *
 * A continuation that is never delivered writes no records at all (observed twice in nine
 * approvals), so its terminal record never arrives and an unbounded hold would freeze the queue
 * with no dock to unblock it — the AGE-3937 trap this file already carries scars from. After the
 * ceiling the hold falls back to the transcript-derived one, which is self-clearing: a
 * continuation that produced records always produces a terminal record too. Well past the
 * 8-to-11 seconds a local sandbox needs to write the continuation's first record.
 */
export const CONTINUATION_HOLD_MAX_MS = 45_000

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
    acceptedRunPending = false,
    stopped,
    resumeOrphaned = false,
    recoverable = false,
    retryContinuation,
    continuationExecutionId = null,
    markRunOwned,
    sendQueued,
    sessionId,
}: UseAgentChatQueueArgs) => {
    const [queued, setQueued] = useState<QueuedMessage[]>(
        () => (sessionId && queuedBySession.get(sessionId)) || [],
    )

    // Mirror every queue change into the per-session store so a remount restores it.
    useEffect(() => {
        if (!sessionId) return
        if (queued.length > 0) queuedBySession.set(sessionId, queued)
        else queuedBySession.delete(sessionId)
    }, [queued, sessionId])

    // Settled = the stream is over (done or failed). A stop lands here (abort → "ready").
    const settled = status === "ready" || status === "error"

    // ── The durable-continuation hold ─────────────────────────────────────────────────────────
    // A server-owned continuation is a TURN. Sending into it starts a second turn for the same
    // session, and the runner resolves that collision by superseding: it tears down the warm
    // sandbox mid-call, so the tool the user just approved comes back "Command aborted" and the
    // sent message dies with it. Nothing below may release while one is in flight.
    const [, forceHoldRecheck] = useState(0)
    const holdStartedAtRef = useRef<{id: string; at: number} | null>(null)
    if (continuationExecutionId) {
        if (holdStartedAtRef.current?.id !== continuationExecutionId) {
            holdStartedAtRef.current = {id: continuationExecutionId, at: Date.now()}
        }
    } else {
        holdStartedAtRef.current = null
    }
    const holdStartedAt = holdStartedAtRef.current
    const idHoldExpired =
        !!holdStartedAt && Date.now() - holdStartedAt.at >= CONTINUATION_HOLD_MAX_MS
    const idHold =
        !!continuationExecutionId &&
        !idHoldExpired &&
        !approvalContinuationSettled(messages, continuationExecutionId)
    // The ceiling needs a render to take effect; nothing else re-renders a queue that is holding.
    useEffect(() => {
        if (!holdStartedAt || idHoldExpired) return
        const remaining = holdStartedAt.at + CONTINUATION_HOLD_MAX_MS - Date.now()
        const timer = setTimeout(() => forceHoldRecheck((n) => n + 1), Math.max(remaining, 0))
        return () => clearTimeout(timer)
    }, [holdStartedAt, idHoldExpired])

    // A user stop cancels the continuation too, so it outranks the hold exactly as it outranks
    // every other gate here.
    const continuationHold = !stopped && (idHold || hasRunningApprovalContinuation(messages))
    // Ownership is scoped by the respond body's execution id, so an observer rendering the same
    // continuation records never claims it. Keep ownership past the gap ceiling once that exact
    // execution is visibly running; the ceiling only protects a continuation that wrote nothing.
    const ownsContinuation =
        idHold ||
        (!!continuationExecutionId &&
            hasRunningApprovalContinuation(messages) &&
            !approvalContinuationSettled(messages, continuationExecutionId))

    // Releasable now: the normal gate, OR a settled turn whose hold was voided — by a user stop,
    // or by an orphaned restored resume shape that nothing in this mount can ever fire.
    const canReleaseNow =
        !acceptedRunPending &&
        !continuationHold &&
        (canReleaseQueuedMessage(status, messages) || ((stopped || resumeOrphaned) && settled))

    // A stop voids the gate for release (above), so it must void it for reporting too — else the
    // aborted turn's lingering `approval-requested` part still reads as "awaiting" while `submit`
    // sends immediately. Keep `hitlPending` in lockstep with the release decision.
    const hitlPending = !stopped && isHitlPending(messages)

    // One latch shared by both send paths caps releases to one per settle and preserves FIFO.
    const releasingRef = useRef(false)
    const retryingContinuationRef = useRef(false)
    const queuedRef = useRef(queued)
    useEffect(() => {
        queuedRef.current = queued
    }, [queued])

    // Retained until admission so a refused immediate send can return to the composer.
    const lastSentRef = useRef<QueuedMessage | undefined>(undefined)

    const admittedTurnId = latestTurnId(messages)
    useEffect(() => {
        if (admittedTurnId) lastSentRef.current = undefined
    }, [admittedTurnId])

    /** Take back the last sent message only after an optional placement succeeds. */
    const takeLastSent = useCallback((place?: (message: QueuedMessage) => boolean) => {
        const message = lastSentRef.current
        if (!message || (place && !place(message))) return undefined
        lastSentRef.current = undefined
        return message
    }, [])

    // Send now only if idle, unlatched, and the queue is empty; otherwise append (FIFO).
    const submit = useCallback(
        (item: {text: string; fileParts?: FileUIPart[]; stagedFiles?: ComposerAttachment[]}) => {
            const message: QueuedMessage = {...item, id: generateId()}
            if (recoverable && retryContinuation) {
                setQueued((q) => [...q, message])
                if (!retryingContinuationRef.current) {
                    retryingContinuationRef.current = true
                    void retryContinuation()
                        .catch(() => false)
                        .finally(() => {
                            retryingContinuationRef.current = false
                        })
                }
                return
            }
            if (!releasingRef.current && queuedRef.current.length === 0 && canReleaseNow) {
                releasingRef.current = true
                lastSentRef.current = message
                markRunOwned()
                sendQueued(message)
            } else {
                setQueued((q) => [...q, message])
            }
        },
        [canReleaseNow, recoverable, retryContinuation, markRunOwned, sendQueued],
    )

    const removeQueued = useCallback((id: string) => {
        setQueued((q) => q.filter((m) => m.id !== id))
    }, [])

    // ── Editing a held message ────────────────────────────────────────────────────────────────
    // An edit session BORROWS the composer: the target's text goes in, and whatever the user had
    // already typed is stashed and handed back when the session ends (either way). Without that,
    // clicking edit on a half-written message would silently destroy it.
    const [editingId, setEditingId] = useState<string | null>(null)
    const stashRef = useRef("")

    /** Open a session on `id`, stashing the composer's current draft. */
    const beginEdit = useCallback((id: string, draft = "") => {
        stashRef.current = draft
        setEditingId(id)
    }, [])

    /** Take the stashed draft back, once. Both ends of a session hand the composer back. */
    const takeStash = useCallback(() => {
        const draft = stashRef.current
        stashRef.current = ""
        return draft
    }, [])

    /** Close the session without touching the message. Returns the draft to restore. */
    const cancelEdit = useCallback(() => {
        setEditingId(null)
        return takeStash()
    }, [takeStash])

    /**
     * Apply the composer's content to the message under edit. Deliberately NOT a branch inside
     * `submit`: that one is also called by the steer-on-denial and pending-run paths, which would
     * otherwise overwrite whatever the user happened to be editing.
     *
     * Attachments MERGE rather than replace — the composer only submits newly staged files, so
     * replacing would delete the queued message's originals on every text-only edit.
     *
     * The queue drains on its own, so the target can leave mid-edit. Nothing is left to rewrite
     * then, and the content becomes a new queued message instead of vanishing.
     *
     * Returns the stashed draft, exactly as `cancelEdit` does: committing consumes the composer,
     * so the text the session displaced has to come back here too or it is lost for good.
     */
    const commitEdit = useCallback(
        (item: {text: string; fileParts?: FileUIPart[]; stagedFiles?: ComposerAttachment[]}) => {
            const id = editingId
            setEditingId(null)
            const draft = takeStash()
            const target = id ? queuedRef.current.find((m) => m.id === id) : undefined
            if (!target) {
                submit(item)
                return draft
            }
            const fileParts = [...(target.fileParts ?? []), ...(item.fileParts ?? [])]
            const stagedFiles = [...(target.stagedFiles ?? []), ...(item.stagedFiles ?? [])]
            // Edited down to nothing and carrying no files: there is no message left to hold.
            if (!item.text.trim() && fileParts.length === 0) {
                setQueued((q) => q.filter((m) => m.id !== id))
                return draft
            }
            setQueued((q) =>
                q.map((m) =>
                    m.id === id
                        ? {
                              ...m,
                              text: item.text,
                              fileParts: fileParts.length ? fileParts : undefined,
                              stagedFiles: stagedFiles.length ? stagedFiles : undefined,
                          }
                        : m,
                ),
            )
            return draft
        },
        [editingId, submit, takeStash],
    )

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
        // A released head also needs refusal recovery because it has left the queue.
        lastSentRef.current = head
        markRunOwned()
        sendQueued(head)
    }, [settled, canReleaseNow, queued, markRunOwned, sendQueued])

    return {
        queued,
        submit,
        removeQueued,
        /** This tab received the durable respond body for this still-running execution. */
        ownsContinuation,
        /** The conversation is paused on a HITL approval — typed messages should queue, not send. */
        hitlPending,
        /** Id of the held message the composer is currently editing, or null. */
        editingId,
        beginEdit,
        cancelEdit,
        commitEdit,
        /** Reclaim the last immediately-sent message (e.g. the backend refused it). */
        takeLastSent,
    }
}
