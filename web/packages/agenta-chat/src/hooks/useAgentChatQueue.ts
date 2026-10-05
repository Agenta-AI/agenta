// Canonical since the desktop re-plumb: the OSS copy is deleted and both apps import this.
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import type {PendingInputWriteOutcome} from "@agenta/entities/session"
import {
    approvalContinuationSettled,
    hasRunningApprovalContinuation,
    isHitlPending,
} from "@agenta/playground/agent-chat"
import {generateId} from "@agenta/shared/utils"
import type {FileUIPart, UIMessage} from "ai"

import {countUserMessages, durableUserTurnIds} from "../assets/pendingSendEchoes"
import {
    applyQueueOps,
    pruneQueueOps,
    pruneQueueRowErrors,
    type QueueOp,
    type QueueOps,
    type QueueRowError,
    type QueueRowErrors,
} from "../assets/queueOverlay"
import {getPendingConnectInteractions} from "../clientTools/connectInteractions"
import {getPendingElicitationInteractions} from "../clientTools/elicitationInteractions"

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
    /** The send this server row came from (its `Idempotency-Key`), so its echo can step aside. */
    clientId?: string | null
    /** Offers Remove on a row the server does not list yet (a just-sent message). */
    removable?: boolean
    /** The row's last action did not land. */
    error?: string
    /** An edit that did not save, so the pencil can offer it again instead of losing it. */
    unsavedEdit?: {text: string; fileParts?: FileUIPart[]}
    /** The turn a promoted input started; set only once the server has promoted it. */
    promotedExecutionId?: string | null
}

/** A queue write's outcome, and the snapshot sequence a read must pass to reflect it. */
export interface ServerQueueWriteResult {
    outcome: PendingInputWriteOutcome
    settledSeq: number
}

export interface ServerQueueAdapter {
    busy: boolean
    queued: QueuedMessage[]
    /** Sequence of the read `queued` came from; see `ServerQueueWriteResult.settledSeq`. */
    viewSeq: number
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
            /** The send will start a turn rather than park, as far as this tab can tell. */
            opensTurn?: boolean
            /** The runner admitted this send's turn. */
            onTurnNamed?: () => void
        },
    ) => Promise<"queued" | "running">
    remove: (id: string) => Promise<ServerQueueWriteResult>
    /** `executionId` names the new turn when the server promoted the input on the spot. */
    sendNow?: (id: string) => Promise<ServerQueueWriteResult & {executionId: string | null}>
    edit?: (
        id: string,
        item: {text: string; fileParts?: FileUIPart[]},
    ) => Promise<ServerQueueWriteResult>
    /** Read the queue again; resolves with that read's sequence, or null when it failed. */
    refresh?: (options?: {fresh?: boolean}) => Promise<number | null>
}

const REMOVE_FAILED = "Couldn't remove this message. Try again."
const ALREADY_STARTED = "This message already started."
const NOT_QUEUED = "This message is no longer queued."
const SEND_NOW_FAILED = "Couldn't send this message now. Try again."
const SEND_NOW_BUSY = "Another message is being sent first. Try again once it starts."
const EDIT_FAILED = "Your edit wasn't saved. Edit to try again."

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
    /** This tab's own run is going, which the server snapshot reports a poll late. */
    runActive?: boolean
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

/** Longest the next send waits for this one's turn to be named before it is admitted anyway. */
const ADMISSION_NAME_MAX_MS = 10_000

/** Longest a started row stays in the dock while its user row is on its way. */
const RELEASE_HOLD_MAX_MS = 2_000

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
    runActive = false,
}: UseAgentChatQueueArgs) => {
    const serverBusyRef = useRef(server.busy)
    serverBusyRef.current = server.busy
    const runActiveRef = useRef(runActive)
    runActiveRef.current = runActive

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
    // Parked CLIENT TOOLS only, not approvals. The steer guard below reads this, and an approval
    // gate must keep sending a typed message to the queue: answering it is what the dock's buttons
    // are for, and a message is as likely to be consent as a redirect.
    const parkedClientTools =
        !stopped &&
        (getPendingElicitationInteractions(messages).length > 0 ||
            getPendingConnectInteractions(messages).length > 0)
    const parkedClientToolsRef = useRef(parkedClientTools)
    parkedClientToolsRef.current = parkedClientTools

    const restoreRefusedSendRef = useRef(restoreRefusedSend)
    restoreRefusedSendRef.current = restoreRefusedSend
    const onSendAcceptedRef = useRef(onSendAccepted)
    onSendAcceptedRef.current = onSendAccepted
    const onSendFailedRef = useRef(onSendFailed)
    onSendFailedRef.current = onSendFailed

    // Echo rows for durable sends, which the AI SDK chat never receives. Owned by its own hook so
    // this one keeps to admission and editing.
    //
    // Retirement reads EVERY durable row, including the ones the dock hides below: a queued send's
    // echo retires precisely because its row is now in the snapshot, so filtering here would leave
    // it waiting forever.
    const dockedInputIds = useMemo(
        () => new Set(server.queued.map((item) => item.id)),
        [server.queued],
    )
    const echoes = usePendingSendEchoes({messages, dockedInputIds})

    const [editingId, setEditingId] = useState<string | null>(null)
    const stashRef = useRef("")
    const editSessionRef = useRef<{id: string; server: boolean} | null>(null)
    const serverQueuedRef = useRef(server.queued)
    serverQueuedRef.current = server.queued

    // ── Optimistic queue writes ───────────────────────────────────────────────────────────────
    // The approval dock's pattern: the row changes on the click, a failure puts it back with its
    // error, and the overlay goes once a snapshot read that began after the write lands.
    const [ops, setOps] = useState<QueueOps>({})
    const [rowErrors, setRowErrors] = useState<QueueRowErrors>({})
    // Client ids of just-sent rows removed before the server named their input.
    const [deferredRemovals, setDeferredRemovals] = useState<ReadonlySet<string>>(() => new Set())
    const deferredRemovalsRef = useRef(new Set<string>())
    // Rows this tab took out of the queue itself; the started-row hold below leaves them alone.
    const exitedIdsRef = useRef(new Set<string>())
    // Sends wait their turn to be admitted; the count is read synchronously by the next send.
    const admissionChainRef = useRef<Promise<void>>(Promise.resolve())
    const admittingRef = useRef(0)

    const setOp = useCallback((id: string, op: QueueOp | null) => {
        setOps((current) => {
            if (op) return {...current, [id]: op}
            if (!(id in current)) return current
            const next = {...current}
            delete next[id]
            return next
        })
    }, [])
    const settleOp = useCallback((id: string, settledSeq: number) => {
        setOps((current) =>
            current[id] ? {...current, [id]: {...current[id], settledSeq}} : current,
        )
    }, [])
    const setRowError = useCallback((id: string, error: QueueRowError | null) => {
        setRowErrors((current) => {
            if (error) return {...current, [id]: error}
            if (!(id in current)) return current
            const next = {...current}
            delete next[id]
            return next
        })
    }, [])
    /** Reports whether `id` was waiting to be removed, and stops it waiting. */
    const forgetDeferredRemoval = useCallback((id: string) => {
        if (!deferredRemovalsRef.current.delete(id)) return false
        setDeferredRemovals(new Set(deferredRemovalsRef.current))
        return true
    }, [])

    // `ops` too: a write can settle after the read that reflects it has already landed.
    useEffect(() => {
        setOps((current) => pruneQueueOps(current, server.queued, server.viewSeq))
    }, [ops, server.queued, server.viewSeq])
    useEffect(() => {
        setRowErrors((current) => pruneQueueRowErrors(current, server.queued))
    }, [server.queued])

    // A parked input whose echo retired on its saved row is in the transcript now, but the dock's
    // snapshot can still list it for a poll. Hidden until a read that began after the hand-over;
    // a steer the turn never consumed is still listed by that read, and comes back.
    const [handedOver, setHandedOver] = useState<Readonly<Record<string, number | null>>>({})
    const handedOverRef = useRef(handedOver)
    handedOverRef.current = handedOver
    const viewSeqRef = useRef(server.viewSeq)
    viewSeqRef.current = server.viewSeq
    const refreshQueue = server.refresh
    useEffect(() => {
        const ids = [...echoes.retiredParkedIds].filter((id) => !(id in handedOverRef.current))
        if (!ids.length) return
        const settle = (seq: number) =>
            setHandedOver((current) => {
                const next = {...current}
                for (const id of ids) if (id in next) next[id] = seq
                return next
            })
        setHandedOver((current) => ({
            ...current,
            ...Object.fromEntries(ids.map((id) => [id, null])),
        }))
        if (!refreshQueue) {
            settle(viewSeqRef.current + 1)
            return
        }
        void refreshQueue({fresh: true}).then(
            (seq) => settle(seq ?? viewSeqRef.current),
            () => settle(viewSeqRef.current),
        )
    }, [echoes.retiredParkedIds, refreshQueue])
    useEffect(() => {
        const listed = new Set(server.queued.map((row) => row.id))
        setHandedOver((current) => {
            const kept = Object.entries(current).filter(
                ([id, seq]) => listed.has(id) && (seq === null || server.viewSeq < seq),
            )
            return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept)
        })
    }, [server.queued, server.viewSeq])

    // A row the server stops listing has started: hold it until its user row lands (set in render, so no frame lacks it).
    const userCount = countUserMessages(messages)
    const transcriptTurnIds = useMemo(() => durableUserTurnIds(messages), [messages])
    // The user-row count when a snapshot last listed each row. A row whose user row landed after
    // that read is already in the transcript when it drops out, so it is not held.
    const userCountRef = useRef(userCount)
    userCountRef.current = userCount
    const listedAtCountRef = useRef(new Map<string, number>())
    useEffect(() => {
        listedAtCountRef.current = new Map(
            server.queued.map((row) => [row.id, userCountRef.current]),
        )
    }, [server.queued, server.viewSeq])
    // A new user row may be a queued input that started: re-read now rather than show a stale
    // listing of it beside its transcript row until the next poll.
    const lastUserCountRef = useRef(userCount)
    useEffect(() => {
        const grew = userCount > lastUserCountRef.current
        lastUserCountRef.current = userCount
        if (grew && serverQueuedRef.current.length > 0) void refreshQueue?.({fresh: true})
    }, [userCount, refreshQueue])
    const [releasing, setReleasing] = useState<
        {row: QueuedMessage; atUserCount: number; until: number}[]
    >([])
    const queuedKey = server.queued.map((item) => item.id).join("\n")
    const [lastServerQueued, setLastServerQueued] = useState({key: queuedKey, rows: server.queued})
    if (lastServerQueued.key !== queuedKey) {
        setLastServerQueued({key: queuedKey, rows: server.queued})
        const listed = new Set(server.queued.map((item) => item.id))
        // A steer was never a dock row (its echo shows it), so only queued rows are held.
        const started = lastServerQueued.rows
            .filter(
                (item) =>
                    item.policy !== "steer" &&
                    item.id !== editingId &&
                    !listed.has(item.id) &&
                    !exitedIdsRef.current.has(item.id) &&
                    !(item.promotedExecutionId && transcriptTurnIds.has(item.promotedExecutionId)),
            )
            .map((row) => ({
                row: {...row, source: "local" as const, editable: false},
                atUserCount: listedAtCountRef.current.get(row.id) ?? userCount,
            }))
            .filter((item) => userCount <= item.atUserCount)
        if (started.length) {
            const until = Date.now() + RELEASE_HOLD_MAX_MS
            setReleasing((current) => [...current, ...started.map((item) => ({...item, until}))])
        }
    }
    const heldRows = useMemo(
        () =>
            releasing
                .filter(
                    (item) =>
                        userCount <= item.atUserCount &&
                        Date.now() < item.until &&
                        !server.queued.some((row) => row.id === item.row.id),
                )
                .map((item) => item.row),
        [releasing, userCount, server.queued],
    )
    // The time limit needs a render of its own once nothing else changes.
    useEffect(() => {
        if (!releasing.length) return
        const next = Math.min(...releasing.map((item) => item.until)) - Date.now()
        const timer = setTimeout(
            () => setReleasing((current) => current.filter((item) => Date.now() < item.until)),
            Math.max(next, 0),
        )
        return () => clearTimeout(timer)
    }, [releasing])

    // A steer this tab sent is on its way INTO the running turn, not held behind it, so while its
    // echo is on screen the dock leaves the row out rather than showing the same message twice.
    // Derived from the live echoes, so the row comes back the moment the echo stops covering it —
    // an input the turn ended without consuming is visible again, and removable.
    // A docked echo steps aside the moment the server lists the input it became.
    // A promoted input stays listed until its turn is delivered; once the transcript holds that
    // turn's user row, the message is shown there and is not a queued one.
    const dockedServerQueued = useMemo(() => {
        const listedClientIds = new Set(server.queued.map((item) => item.clientId))
        const removing = (clientId?: string | null) => !!clientId && deferredRemovals.has(clientId)
        const inTranscript = (item: QueuedMessage) =>
            item.id in handedOver ||
            echoes.retiredParkedIds.has(item.id) ||
            (!!item.promotedExecutionId && transcriptTurnIds.has(item.promotedExecutionId))
        return [
            ...heldRows,
            ...applyQueueOps(server.queued, ops, rowErrors).filter(
                (item) =>
                    !echoes.dockCoveredIds.has(item.id) &&
                    !removing(item.clientId) &&
                    !inTranscript(item),
            ),
            ...echoes.dockRows
                .filter((item) => !listedClientIds.has(item.id) && !removing(item.id))
                .map((item) => ({...item, removable: true})),
        ]
    }, [
        heldRows,
        server.queued,
        ops,
        rowErrors,
        echoes.dockCoveredIds,
        echoes.dockRows,
        deferredRemovals,
        transcriptTurnIds,
        handedOver,
        echoes.retiredParkedIds,
    ])

    const startRemove = useCallback(
        (id: string) => {
            exitedIdsRef.current.add(id)
            setRowError(id, null)
            setOp(id, {kind: "remove", settledSeq: null})
            const fail = (message: string) => {
                exitedIdsRef.current.delete(id)
                setOp(id, null)
                setRowError(id, {message})
            }
            void server
                .remove(id)
                .then(({outcome, settledSeq}) => {
                    // Gone already is the end state the user asked for.
                    if (outcome === "applied" || outcome === "not_found") settleOp(id, settledSeq)
                    else fail(outcome === "conflict" ? ALREADY_STARTED : REMOVE_FAILED)
                })
                .catch(() => fail(REMOVE_FAILED))
        },
        [server, setOp, setRowError, settleOp],
    )

    // One durable admission for both policies, so a steer gets the same echo and refusal
    // recovery a queued send has.
    const submitDurable = useCallback(
        (message: QueuedMessage, policy: "queue" | "steer"): Promise<void> => {
            // Show it before the request leaves. Every exit is driven by evidence about this
            // send: the turn it started, the dock row (queue) or parked input (steer) it
            // became, or its failure.
            // A queued send while a run is busy lands in the dock, so show it there from the start.
            // So does one behind a send still being admitted: it will park behind that turn.
            const busy =
                serverBusyRef.current ||
                runActiveRef.current ||
                echoes.inFlight ||
                admittingRef.current > 0
            echoes.add({...message, policy, docked: policy === "queue" && busy})
            const waiting = admittingRef.current > 0
            admittingRef.current += 1
            // The next send goes once this one's turn is running: an admission that lands
            // before the runner names the turn still reads the session as idle and runs too.
            let nameTurn = () => {}
            const named = new Promise<void>((resolve) => (nameTurn = resolve))
            const cap = setTimeout(nameTurn, ADMISSION_NAME_MAX_MS)
            const release = () => {
                clearTimeout(cap)
                admittingRef.current -= 1
            }
            const admit = () =>
                server.submit(message, policy, {
                    opensTurn: policy === "queue" && !busy,
                    onTurnNamed: nameTurn,
                    onAccepted: (executionId) => {
                        forgetDeferredRemoval(message.id)
                        echoes.markAccepted(message.id, executionId)
                        onSendAcceptedRef.current?.(message, executionId)
                    },
                    onParked: (inputId) => {
                        onSendAcceptedRef.current?.(message, null)
                        // Removed on its way in: now it has the id the removal needs.
                        if (forgetDeferredRemoval(message.id)) {
                            echoes.drop(message.id)
                            startRemove(inputId)
                            return
                        }
                        echoes.markParked(message.id, inputId)
                    },
                    // One event, one recovery. A refusal that arrives after the promise resolved
                    // goes back to the composer exactly like one that rejected it, so there is a
                    // single place the message lives and a single wording for it. The row is the
                    // fallback only when no composer can take the text.
                    onFailed: () => {
                        nameTurn()
                        // The user removed it already, so there is nothing to give back.
                        if (forgetDeferredRemoval(message.id)) {
                            echoes.drop(message.id)
                            onSendFailedRef.current?.(message)
                            return
                        }
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
                    onSettled: () => {
                        nameTurn()
                        echoes.markFailed(message.id)
                    },
                })
            const admitted = waiting ? admissionChainRef.current.then(admit) : admit()
            admissionChainRef.current = admitted
                .then(
                    (admission) => (admission === "running" ? named : undefined),
                    () => undefined,
                )
                .then(release)
            return admitted.then(
                (admission) => {
                    if (admission !== "running") return
                    // It started a turn, so there is no queued row left to remove.
                    forgetDeferredRemoval(message.id)
                    echoes.markStarted(message.id)
                },
                (error: unknown) => {
                    echoes.drop(message.id)
                    onSendFailedRef.current?.(message)
                    // Removed by the user, so the composer must not get it back.
                    if (forgetDeferredRemoval(message.id)) return
                    throw error
                },
            )
        },
        [echoes, forgetDeferredRemoval, server, startRemove],
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
                startRemove(id)
                return
            }
            // Not listed yet: hidden now, removed once the server names its input.
            if (echoes.dockRows.some((message) => message.id === id)) {
                deferredRemovalsRef.current.add(id)
                setDeferredRemovals(new Set(deferredRemovalsRef.current))
            }
        },
        [echoes.dockRows, server.queued, startRemove],
    )

    const sendQueuedNow = useCallback(
        (id: string) => {
            const row = server.queued.find((message) => message.id === id)
            const sendNow = server.sendNow
            if (!row || !sendNow) return
            const echoId = `send-now-${id}`
            exitedIdsRef.current.add(id)
            setRowError(id, null)
            setOp(id, {kind: "sendNow", settledSeq: null})
            // Into the transcript at once, as a sent message; its saved user row retires it.
            echoes.add({id: echoId, text: row.text, fileParts: row.fileParts})
            const fail = (message: string) => {
                echoes.drop(echoId)
                exitedIdsRef.current.delete(id)
                setOp(id, null)
                setRowError(id, {message})
            }
            void sendNow(id)
                .then(({outcome, settledSeq, executionId}) => {
                    if (outcome !== "applied") {
                        fail(
                            outcome === "busy"
                                ? SEND_NOW_BUSY
                                : outcome === "failed"
                                  ? SEND_NOW_FAILED
                                  : NOT_QUEUED,
                        )
                        return
                    }
                    settleOp(id, settledSeq)
                    if (executionId) echoes.markAccepted(echoId, executionId)
                })
                .catch(() => fail(SEND_NOW_FAILED))
        },
        [echoes, server, setOp, setRowError, settleOp],
    )

    // A stop is already carrying one input into the next turn: Send Now on this tab, or a Steer or
    // Send Now the server lists from anywhere. It binds one input per stop, so a second Send Now
    // is refused until that input starts.
    const pendingSendNowIds = useMemo(() => {
        const ids = new Set<string>()
        for (const [id, op] of Object.entries(ops)) if (op.kind === "sendNow") ids.add(id)
        for (const row of server.queued) {
            if (row.policy === "steer" && !row.promotedExecutionId) ids.add(row.id)
        }
        return [...ids]
    }, [ops, server.queued])

    /**
     * Withdraw the inputs a pending stop would run next, so a Stop ends the work instead of
     * swapping it. Each withdrawn message goes back to the composer, else to a flagged row.
     */
    const cancelPendingSendNow = useCallback(() => {
        for (const id of pendingSendNowIds) {
            const row = server.queued.find((message) => message.id === id)
            const echoIds = [`send-now-${id}`, ...(row?.clientId ? [row.clientId] : [])]
            const previous = ops[id]
            exitedIdsRef.current.add(id)
            setRowError(id, null)
            setOp(id, {kind: "remove", settledSeq: null})
            const restore = () => {
                setOp(id, previous ?? null)
                if (!previous) exitedIdsRef.current.delete(id)
            }
            void server
                .remove(id)
                .then(({outcome, settledSeq}) => {
                    // Already started: it runs, and its echo stays.
                    if (outcome === "conflict") return restore()
                    if (outcome !== "applied" && outcome !== "not_found") {
                        restore()
                        setRowError(id, {message: REMOVE_FAILED})
                        return
                    }
                    settleOp(id, settledSeq)
                    for (const echoId of echoIds) echoes.drop(echoId)
                    if (!row) return
                    const recovery: QueuedMessage = {
                        id: `stopped-${id}`,
                        text: row.text,
                        fileParts: row.fileParts,
                    }
                    void Promise.resolve(restoreRefusedSendRef.current?.(recovery)).then(
                        (taken) => {
                            if (!taken) echoes.markFailed(recovery.id, recovery)
                        },
                    )
                })
                .catch(() => {
                    restore()
                    setRowError(id, {message: REMOVE_FAILED})
                })
        }
    }, [echoes, ops, pendingSendNowIds, server, setOp, setRowError, settleOp])

    const steer = useCallback(
        async (item: {
            text: string
            executionText?: string
            fileParts?: FileUIPart[]
            stagedFiles?: ComposerAttachment[]
        }) => {
            // A run parked on a client tool counts as busy. Its heartbeat is not in the snapshot
            // (a parked run reads `idle`), but the turn is still open server-side: the host's
            // dismiss-then-steer over a parked question or connection resumes it, and the steer
            // lands in the resumed turn. Read through a ref, not the transcript: the call comes
            // straight after the dismiss write, before anything has re-rendered. Approvals are
            // deliberately excluded — see `parkedClientTools`.
            if (!(serverBusyRef.current || parkedClientToolsRef.current)) {
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
            setRowError(id, null)
            setEditingId(id)
        },
        [server, setRowError],
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
     * Save an edit optimistically. A failure on a row still queued puts the old text back with the
     * edit kept on the row; a row that is gone hands the edit to the composer, else a flagged row.
     */
    const saveEdit = useCallback(
        (
            id: string,
            item: {text: string; fileParts?: FileUIPart[]; stagedFiles?: ComposerAttachment[]},
            save: NonNullable<ServerQueueAdapter["edit"]>,
        ) => {
            setOp(id, {kind: "edit", text: item.text, fileParts: item.fileParts, settledSeq: null})
            const fail = (outcome: PendingInputWriteOutcome) => {
                setOp(id, null)
                const listed = serverQueuedRef.current.some((message) => message.id === id)
                if (outcome === "failed" && listed) {
                    setRowError(id, {
                        message: EDIT_FAILED,
                        unsavedEdit: {text: item.text, fileParts: item.fileParts},
                    })
                    return
                }
                const recovery: QueuedMessage = {...item, id: `edit-${id}`}
                void Promise.resolve(restoreRefusedSendRef.current?.(recovery)).then((taken) => {
                    if (!taken) echoes.markFailed(recovery.id, recovery)
                })
            }
            void save(id, {text: item.text, fileParts: item.fileParts})
                .then(({outcome, settledSeq}) =>
                    outcome === "applied" ? settleOp(id, settledSeq) : fail(outcome),
                )
                .catch(() => fail("failed"))
        },
        [echoes, setOp, setRowError, settleOp],
    )

    /**
     * Apply the composer's content to the message under edit. Deliberately NOT a branch inside
     * `submit`: that one is also called by the steer-on-denial and pending-run paths, which would
     * otherwise overwrite whatever the user happened to be editing.
     *
     * A durable edit closes the session at once and saves in the background (`saveEdit`); a
     * target that is no longer held becomes a new message.
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
                const save = server.edit
                if (!save) return Promise.reject(new Error("This queued message cannot be edited."))
                saveEdit(id, item, save)
                editSessionRef.current = null
                setEditingId(null)
                return Promise.resolve(takeStash())
            }
            return submit(item).then(() => {
                setEditingId(null)
                return takeStash()
            })
        },
        [editingId, saveEdit, server, submit, takeStash],
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
        sendQueuedNow: server.sendNow ? sendQueuedNow : undefined,
        /** A stop is carrying a queued input into the next turn; a second Send Now must wait. */
        sendNowPending: pendingSendNowIds.length > 0,
        cancelPendingSendNow,
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
