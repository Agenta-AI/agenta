// Canonical since the desktop re-plumb: the OSS copy is deleted and both apps import this.
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    approvalContinuationSettled,
    hasRunningApprovalContinuation,
    isHitlPending,
} from "@agenta/playground/agent-chat"
import {generateId} from "@agenta/shared/utils"
import type {FileUIPart, UIMessage} from "ai"

import type {ComposerAttachment} from "./useComposerAttachments"
import {usePendingSendEchoes} from "./usePendingSendEchoes"

export interface QueuedMessage {
    id: string
    text: string
    executionText?: string
    fileParts?: FileUIPart[]
    stagedFiles?: ComposerAttachment[]
    attachmentCount?: number
    policy?: "queue" | "steer"
    source?: "local" | "server"
    editable?: boolean
}

export interface ServerQueueAdapter {
    busy: boolean
    queued: QueuedMessage[]
    /**
     * Admits one input. `watcher` reports what happened to THIS send: the turn it started, the
     * durable input it was parked as, or its failure.
     */
    submit: (
        message: QueuedMessage,
        policy: "queue" | "steer",
        watcher?: {
            onAccepted?: (executionId: string) => void
            onParked?: (inputId: string) => void
            onFailed?: () => void
            onSettled?: () => void
        },
    ) => Promise<"queued" | "running">
    remove: (id: string) => Promise<void>
    sendNow?: (id: string) => Promise<void>
    edit?: (id: string, item: {text: string; fileParts?: FileUIPart[]}) => Promise<void>
}

interface UseAgentChatQueueArgs {
    messages: UIMessage[]
    /** The last turn was user-stopped (cancelled). A stop voids any pending approval, so the
     * aborted turn's tool parts still reading as mid-HITL are not reported as awaiting. */
    stopped: boolean
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
    /**
     * Hand a refused send back to the composer. Reports whether the composer took it: if it did,
     * the message lives there and its echo row goes; if it could not (no mounted editor), the row
     * stays as the one place the text survives.
     *
     * May answer later than the call. A rich text editor commits a write on a following tick, so a
     * host that reads its own composer back cannot always answer in this one.
     */
    restoreRefusedSend?: (message: QueuedMessage) => boolean | Promise<boolean>
    /** A durable send was admitted: the turn it started, or `null` for a parked input. */
    onSendAccepted?: (message: QueuedMessage, executionId: string | null) => void
    /** A durable send will never become a turn: rejected before it left, or refused after. */
    onSendFailed?: (message: QueuedMessage) => void
    /** The durable session queue. Every send is admitted through it. */
    server: ServerQueueAdapter
}

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
 * Admits every composer send through the durable session queue, keeps an echo row for each send
 * until the transcript or the dock owns it, and edits the server-held queue.
 *
 * The server decides whether a send starts a turn or parks behind the running one, so nothing is
 * held in the browser.
 */
export const useAgentChatQueue = ({
    messages,
    stopped,
    continuationExecutionId = null,
    restoreRefusedSend,
    onSendAccepted,
    onSendFailed,
    server,
}: UseAgentChatQueueArgs) => {
    const serverBusyRef = useRef(server.busy)
    serverBusyRef.current = server.busy

    // ── The durable-continuation hold ─────────────────────────────────────────────────────────
    // A server-owned continuation is a TURN. The tab that answered the approval owns it until
    // that execution's own terminal record lands.
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
    // The ceiling needs a render to take effect; nothing else re-renders a hold that is waiting.
    useEffect(() => {
        if (!holdStartedAt || idHoldExpired) return
        const remaining = holdStartedAt.at + CONTINUATION_HOLD_MAX_MS - Date.now()
        const timer = setTimeout(() => forceHoldRecheck((n) => n + 1), Math.max(remaining, 0))
        return () => clearTimeout(timer)
    }, [holdStartedAt, idHoldExpired])

    // Ownership is scoped by the respond body's execution id, so an observer rendering the same
    // continuation records never claims it. Keep ownership past the gap ceiling once that exact
    // execution is visibly running; the ceiling only protects a continuation that wrote nothing.
    const ownsContinuation =
        idHold ||
        (!!continuationExecutionId &&
            hasRunningApprovalContinuation(messages) &&
            !approvalContinuationSettled(messages, continuationExecutionId))

    // A stop voids the approval gate, so the aborted turn's lingering `approval-requested` part
    // must not read as "awaiting".
    const hitlPending = !stopped && isHitlPending(messages)
    const hitlPendingRef = useRef(hitlPending)
    hitlPendingRef.current = hitlPending

    const restoreRefusedSendRef = useRef(restoreRefusedSend)
    restoreRefusedSendRef.current = restoreRefusedSend
    const onSendAcceptedRef = useRef(onSendAccepted)
    onSendAcceptedRef.current = onSendAccepted
    const onSendFailedRef = useRef(onSendFailed)
    onSendFailedRef.current = onSendFailed

    // A steer this tab sent is on its way in, not held: it stays a transcript echo until the run
    // saves it as a user row, and never becomes a dock row. Keyed by the durable input id the 202
    // named, so the dock filter and the echo's retirement agree on which rows those are.
    const steeredInputIdsRef = useRef(new Set<string>())
    const dockedServerQueued = useMemo(
        () => server.queued.filter((item) => !steeredInputIdsRef.current.has(item.id)),
        [server.queued],
    )

    // Echo rows for durable sends, which the AI SDK chat never receives. Owned by its own hook so
    // this one keeps to admission and editing.
    const dockedInputIds = useMemo(
        () => new Set(dockedServerQueued.map((item) => item.id)),
        [dockedServerQueued],
    )
    const echoes = usePendingSendEchoes({messages, dockedInputIds})

    const [editingId, setEditingId] = useState<string | null>(null)
    const stashRef = useRef("")
    const editSessionRef = useRef<{id: string; server: boolean} | null>(null)

    // One durable admission for both policies, so a steer gets the same echo and refusal
    // recovery a queued send has.
    const submitDurable = useCallback(
        (message: QueuedMessage, policy: "queue" | "steer"): Promise<void> => {
            // Show it before the request leaves. Every exit is driven by evidence about this
            // send: the turn it started, the dock row (queue) or parked input (steer) it
            // became, or its failure.
            echoes.add(message)
            return server
                .submit(message, policy, {
                    onAccepted: (executionId) => {
                        echoes.markAccepted(message.id, executionId)
                        onSendAcceptedRef.current?.(message, executionId)
                    },
                    onParked: (inputId) => {
                        if (policy === "steer") steeredInputIdsRef.current.add(inputId)
                        echoes.markParked(message.id, inputId)
                        onSendAcceptedRef.current?.(message, null)
                    },
                    // One event, one recovery. A refusal that arrives after the promise resolved
                    // goes back to the composer exactly like one that rejected it, so there is a
                    // single place the message lives and a single wording for it. The row is the
                    // fallback only when no composer can take the text.
                    onFailed: () => {
                        // The row goes up FIRST and comes down only once the composer confirms it
                        // took the text. It is the safe side to fail to: the message must never be
                        // in neither place, and a host cannot always answer in this tick, because
                        // its editor commits a write on a following one. Deciding on a same-tick
                        // answer left a refused message in the transcript AND the composer, where
                        // it could be sent twice (staging, `66ed5a6c57`).
                        //
                        // Passing the message re-creates the row when the count rule has already
                        // retired it, so a late refusal always has somewhere to be.
                        echoes.markFailed(message.id, message)
                        onSendFailedRef.current?.(message)
                        const restoring = restoreRefusedSendRef.current?.(message)
                        if (!restoring) return
                        void Promise.resolve(restoring).then((taken) => {
                            if (taken) echoes.drop(message.id)
                        })
                    },
                    // The turn ended and its records were re-read. An echo still on screen is one
                    // whose row was never persisted, so it stops waiting silently; a row that
                    // arrives later still retires it.
                    // Settlement never touches the composer. It only marks an echo that is STILL
                    // waiting, and marking one that has already retired is a no-op. Restoring
                    // here would write a delivered message back into the input under "wasn't
                    // sent", which is the normal accepted path: row adopted, echo retired, stream
                    // ends.
                    onSettled: () => echoes.markFailed(message.id),
                })
                .then(
                    () => undefined,
                    (error: unknown) => {
                        echoes.drop(message.id)
                        onSendFailedRef.current?.(message)
                        throw error
                    },
                )
        },
        [echoes, server],
    )

    const submit = useCallback(
        (item: {
            text: string
            executionText?: string
            fileParts?: FileUIPart[]
            stagedFiles?: ComposerAttachment[]
        }) => {
            const message: QueuedMessage = {
                ...item,
                id: generateId(),
                ...(item.executionText !== undefined ? {editable: false} : {}),
            }
            return submitDurable(message, "queue")
        },
        [submitDurable],
    )

    const removeQueued = useCallback(
        (id: string) => {
            if (server.queued.some((message) => message.id === id)) {
                void server.remove(id).catch(() => {})
            }
        },
        [server],
    )

    const steer = useCallback(
        async (item: {
            text: string
            executionText?: string
            fileParts?: FileUIPart[]
            stagedFiles?: ComposerAttachment[]
        }) => {
            // A run parked on the user counts as busy. Its heartbeat is not in the snapshot (a
            // parked run reads `idle`), but the turn is still open server-side: the host's
            // dismiss-then-steer over a parked question resumes it, and the steer lands in the
            // resumed turn. Read through a ref, not the transcript: the call comes straight after
            // the dismiss write, before anything has re-rendered.
            if (!(serverBusyRef.current || hitlPendingRef.current)) {
                throw new Error("The session is not ready to accept a Steer input.")
            }
            const message: QueuedMessage = {
                ...item,
                id: generateId(),
                ...(item.executionText !== undefined ? {editable: false} : {}),
            }
            await submitDurable(message, "steer")
        },
        [submitDurable],
    )

    // ── Editing a held message ────────────────────────────────────────────────────────────────
    // An edit session BORROWS the composer: the target's text goes in, and whatever the user had
    // already typed is stashed and handed back when the session ends (either way). Without that,
    // clicking edit on a half-written message would silently destroy it.

    /** Open a session on `id`, stashing the composer's current draft. */
    const beginEdit = useCallback(
        (id: string, draft = "") => {
            editSessionRef.current = {
                id,
                server: server.queued.some((message) => message.id === id),
            }
            stashRef.current = draft
            setEditingId(id)
        },
        [server],
    )

    /** Take the stashed draft back, once. Both ends of a session hand the composer back. */
    const takeStash = useCallback(() => {
        const draft = stashRef.current
        stashRef.current = ""
        return draft
    }, [])

    /** Close the session without touching the message. Returns the draft to restore. */
    const cancelEdit = useCallback(() => {
        editSessionRef.current = null
        setEditingId(null)
        return takeStash()
    }, [takeStash])

    /**
     * Apply the composer's content to the message under edit. Deliberately NOT a branch inside
     * `submit`: that one is also called by the steer-on-denial and pending-run paths, which would
     * otherwise overwrite whatever the user happened to be editing.
     *
     * A durable edit preserves the server's refusal; a target that is no longer held becomes a
     * new message.
     *
     * Returns the stashed draft, exactly as `cancelEdit` does: committing consumes the composer,
     * so the text the session displaced has to come back here too or it is lost for good.
     */
    const commitEdit = useCallback(
        (item: {
            text: string
            executionText?: string
            fileParts?: FileUIPart[]
            stagedFiles?: ComposerAttachment[]
        }) => {
            const id = editingId
            const editSession = editSessionRef.current
            const serverOwnsInput =
                editSession?.server || server.queued.some((message) => message.id === id)
            if (id && serverOwnsInput) {
                // Once seen as server-held, it stays so: a later snapshot that misses the row
                // must not turn a failed edit into a second send.
                if (editSession) editSession.server = true
                const save = server.edit
                if (!save) return Promise.reject(new Error("This queued message cannot be edited."))
                return save(id, item).then(
                    () => {
                        if (editSessionRef.current !== editSession) return ""
                        editSessionRef.current = null
                        setEditingId(null)
                        return takeStash()
                    },
                    (error: unknown) => {
                        if (editSessionRef.current !== editSession) return ""
                        throw error
                    },
                )
            }
            return submit(item).then(() => {
                setEditingId(null)
                return takeStash()
            })
        },
        [editingId, server, submit, takeStash],
    )

    return {
        queued: dockedServerQueued,
        /** Sent-but-not-yet-saved user rows; merge with `mergePendingSendEchoRows`. */
        pendingSendRows: echoes.rows,
        /** A send of this mount is on its way: admitted, not yet named by the runner or refused.
         * The server-owned path never moves `useChat`'s `status` off "ready", so this is the only
         * local evidence a turn was just submitted. */
        sendInFlight: echoes.inFlight,
        submit,
        steer,
        removeQueued,
        sendQueuedNow: server.sendNow,
        /** This tab received the durable respond body for this still-running execution. */
        ownsContinuation,
        serverBusy: server.busy,
        /** The conversation is paused on a HITL approval — typed messages should queue, not send. */
        hitlPending,
        /** Id of the held message the composer is currently editing, or null. */
        editingId,
        beginEdit,
        cancelEdit,
        commitEdit,
    }
}
