import {useCallback, useEffect, useRef, useState} from "react"

import {
    fetchSessionSnapshotAtom,
    removePendingSessionInputAtom,
    sendPendingSessionInputNowAtom,
    updatePendingSessionInputAtom,
} from "@agenta/entities/session"
import {buildAgentRequest} from "@agenta/playground/agent-chat"
import {projectIdAtom} from "@agenta/shared/state"
import type {FileUIPart, UIMessage} from "ai"
import {useAtomValue, useSetAtom} from "jotai"

import {buildRequestWithinDeadline, PREPARE_NOT_READY_MESSAGE} from "../assets/boundedRequest"
import {outboundUserParts} from "../assets/displayContent"
import {attachmentIdForPart} from "../assets/files"
import {reduceSessionPendingInputs, type SessionPendingInputView} from "../assets/pendingInputs"
import {startupLabelFromDataPart} from "../assets/startupPhases"
import {readSendRefusal} from "../model/error"

import type {QueuedMessage} from "./useAgentChatQueue"
import {useMountGeneration} from "./useMountGeneration"

/** "queued" parks the input and the dock owns it; "running" starts a turn the transcript adopts. */
export type ServerInputAdmission = "queued" | "running"

/** Snapshot poll cadence while a turn runs or an input is parked: the queue can move any second. */
export const ACTIVE_SNAPSHOT_POLL_MS = 2_000
/** Cadence for an idle session with an empty queue: only another browser's send changes it. */
export const IDLE_SNAPSHOT_POLL_MS = 15_000

/** Reports what became of ONE send, so its echo can retire on evidence about itself. */
export interface ServerInputWatcher {
    /** The run stream named the turn this send started. */
    onAccepted?: (executionId: string) => void
    /** A 202 parked it as this durable input. */
    onParked?: (inputId: string) => void
    /** No turn will ever carry it: refused, errored, or accepted by nothing. */
    onFailed?: () => void
    /**
     * The accepted turn's stream ended on its own and its records have been re-read. If the
     * saved row still has not arrived by now it never will, so the echo stops waiting silently.
     * Not reported for a connection that dropped after acceptance: the turn may still be running,
     * and the liveness poll re-reads the records when it ends.
     */
    onSettled?: () => void
    /** The runner narrated a startup phase (#6047); the run stream is their only source. */
    onStartupPhase?: (label: string) => void
}

export interface ServerSessionInputs {
    executionState: SessionPendingInputView["executionState"]
    busy: boolean
    queued: QueuedMessage[]
    submit: (
        message: QueuedMessage,
        policy: "queue" | "steer",
        watcher?: ServerInputWatcher,
    ) => Promise<ServerInputAdmission>
    remove: (id: string) => Promise<void>
    sendNow: (id: string) => Promise<void>
    edit: (id: string, item: {text: string; fileParts?: FileUIPart[]}) => Promise<void>
    refresh: () => Promise<void>
}

const emptyView = reduceSessionPendingInputs(null)

const RUN_ERROR_FRAME_TYPES = new Set(["error", "data-agent-error"])

type RunFrame =
    | {kind: "accepted"; executionId: string}
    | {kind: "error"}
    | {kind: "started"}
    | {kind: "status"; label: string}
    | null

/**
 * What one run stream said about the send that opened it. `accepted` is whether a frame named the
 * turn; `ended` is whether the stream closed on its own rather than the connection dropping.
 * Only the two together mean "this turn is over", which is what settlement needs.
 */
export interface RunAdmission {
    accepted: boolean
    ended: boolean
}

const runFrameFromLine = (line: string): RunFrame => {
    const payload = line.startsWith("data:") ? line.slice(5).trim() : line.trim()
    if (!payload || payload === "[DONE]") return null
    try {
        const frame = JSON.parse(payload) as {
            type?: unknown
            data?: {executionId?: unknown}
            messageMetadata?: {turnId?: unknown}
        }
        if (typeof frame.type !== "string") return null
        if (RUN_ERROR_FRAME_TYPES.has(frame.type)) return {kind: "error"}
        const label = startupLabelFromDataPart(frame)
        if (label) return {kind: "status", label}
        // The runner emits its `turn` event only after it admits the request, and the Vercel
        // adapter forwards that id as message metadata. It is the only thing in an ordinary
        // request's stream that proves a turn exists.
        //
        // `start` and `start-step` are NOT that evidence, however early they arrive: the adapter
        // yields both before it reads a single runner event, so a request the runner then refuses
        // carries them exactly as a successful one does.
        if (frame.type === "message-metadata") {
            const turnId = frame.messageMetadata?.turnId
            return typeof turnId === "string" && turnId ? {kind: "started"} : null
        }
        if (frame.type !== "data-session-accepted") return null
        const id = frame.data?.executionId
        return typeof id === "string" && id ? {kind: "accepted", executionId: id} : null
    } catch {
        return null
    }
}

/**
 * Drain the run stream and report only what it actually says about this send.
 *
 * An HTTP 200 proves the request was taken, nothing more, so an error frame before the turn begins
 * is reported as a failure. Silence is NOT: the runner emits the acceptance frame only for a
 * detached request, and this adapter also sends ordinary ones, so a stream that ends without
 * acceptance is usually a perfectly good turn. Those fall back to the count, exactly as before
 * identity existed.
 *
 * "Before the turn begins" is the whole of it, and for an ordinary request the turn id on the
 * `message-metadata` frame is what says so. Live evidence for why this matters: a run whose model
 * call failed mid-turn ("no credits remaining") emitted its error 13 s in, by which time the user's
 * row was saved and rendered. Reading that as a refused send put a second copy of a delivered
 * message on screen under "Message wasn't sent", and handed the text back to the composer. Once a
 * turn exists its failure is the transcript's to render, on the assistant row where it belongs.
 */
export const readRunAdmission = async (
    response: Response,
    watcher?: ServerInputWatcher,
): Promise<RunAdmission> => {
    const reader = response.body?.getReader()
    if (!reader) {
        watcher?.onFailed?.()
        return {accepted: false, ended: true}
    }
    const decoder = new TextDecoder()
    let buffer = ""
    let accepted = false
    let started = false
    const scan = (chunk: string): "error" | "accepted" | null => {
        buffer += chunk
        // CR-only and CRLF framing are both valid SSE.
        const lines = buffer.split(/\r\n|\r|\n/)
        buffer = lines.pop() ?? ""
        for (const line of lines) {
            const frame = runFrameFromLine(line)
            if (!frame) continue
            // Scanning continues past the turn-id frame, because a detached run names its turn in
            // a frame of its own, and that id is what retires the echo on identity.
            if (frame.kind === "status") {
                watcher?.onStartupPhase?.(frame.label)
                continue
            }
            if (frame.kind === "started") {
                started = true
                continue
            }
            if (frame.kind === "error") {
                if (started || accepted) continue
                return "error"
            }
            if (accepted) continue
            accepted = true
            watcher?.onAccepted?.(frame.executionId)
            // The chunk may carry a status frame right behind the acceptance; keep going.
        }
        return null
    }
    try {
        for (;;) {
            const {done, value} = await reader.read()
            if (done) break
            // Still scanned past acceptance: the startup phases arrive after it.
            if (scan(decoder.decode(value, {stream: true})) === "error") {
                watcher?.onFailed?.()
                await reader.cancel().catch(() => undefined)
                return {accepted: false, ended: true}
            }
        }
        // A last frame with no trailing newline is still a frame, and it can be the refusal.
        if (!accepted && buffer.trim() && scan("\n") === "error") {
            watcher?.onFailed?.()
            return {accepted: false, ended: true}
        }
    } catch {
        // A dropped connection says nothing about the turn either way: not a failure, and not an
        // ending. A turn that keeps running on the server after the browser's connection fell
        // over still saves its row, and reading the drop as "finished" put "wasn't sent" under it.
        return {accepted, ended: false}
    }
    return {accepted, ended: true}
}

export const parkedInputIdFromBody = (body: unknown): string | null => {
    if (!body || typeof body !== "object") return null
    const input = (body as {input?: unknown}).input
    if (!input || typeof input !== "object") return null
    const id = (input as {id?: unknown}).id
    return typeof id === "string" && id ? id : null
}

export const useServerSessionInputs = ({
    entityId,
    sessionId,
    messages,
    locallyBusy,
    remotelyBusy = false,
    isSharedReaderReady,
    onExecuted,
    onStartupPhase,
}: {
    entityId: string
    sessionId: string
    messages: UIMessage[]
    locallyBusy: boolean
    /**
     * Someone else is running this session (the project liveness poll, which the host already
     * reads). Without it the tight cadence could only be entered from the snapshot this poll
     * itself fetches, so a send from ANOTHER browser stayed invisible here for a whole idle
     * interval — the dock and `busy` lag exactly when a second client is active.
     */
    remotelyBusy?: boolean
    /** Read current transport readiness when admitting input, including after reconnect. */
    isSharedReaderReady?: () => boolean
    /**
     * A durable send's run stream ended, so the records may hold rows this browser has not
     * adopted. A host that re-reads them returns the read, resolving `false` when it could not
     * reach the log; settlement waits on it and draws no conclusion from a failed read.
     */
    onExecuted?: () => void | boolean | Promise<void | boolean>
    /** A startup phase the run stream narrated for a send this hook admitted. */
    onStartupPhase?: (label: string) => void
}): ServerSessionInputs => {
    const projectId = useAtomValue(projectIdAtom)
    const scope = JSON.stringify([projectId, sessionId])
    const scopeRef = useRef(scope)
    scopeRef.current = scope
    const fetchSnapshot = useSetAtom(fetchSessionSnapshotAtom)
    const removeInput = useSetAtom(removePendingSessionInputAtom)
    const sendInputNow = useSetAtom(sendPendingSessionInputNowAtom)
    const updateInput = useSetAtom(updatePendingSessionInputAtom)
    const [viewState, setViewState] = useState<{scope: string; view: SessionPendingInputView}>(
        () => ({scope, view: emptyView}),
    )
    const view = viewState.scope === scope ? viewState.view : emptyView
    const messagesRef = useRef(messages)
    const entityIdRef = useRef(entityId)
    const onExecutedRef = useRef(onExecuted)
    const onStartupPhaseRef = useRef(onStartupPhase)
    onStartupPhaseRef.current = onStartupPhase
    const isSharedReaderReadyRef = useRef(isSharedReaderReady)
    const loadInFlightRef = useRef<{
        scope: string
        promise: Promise<SessionPendingInputView | null>
    } | null>(null)
    messagesRef.current = messages
    entityIdRef.current = entityId
    onExecutedRef.current = onExecuted
    isSharedReaderReadyRef.current = isSharedReaderReady

    // A run stream outlives this mount, and the session registry deliberately preserves the same
    // Chat across a remount, so an old completion firing `onExecuted` can adopt a stale snapshot
    // over a newer transcript and persist it. The generation is captured when the chain starts and
    // re-checked after every await. It closes THIS hook's own windows only: `onExecuted` starts a
    // records read of its own, and the host that owns that read guards its adoption with a
    // generation of its own.
    const mount = useMountGeneration()

    const load = useCallback((): Promise<SessionPendingInputView | null> => {
        if (loadInFlightRef.current?.scope === scope) {
            return loadInFlightRef.current.promise
        }
        const promise = (async () => {
            const snapshot = await fetchSnapshot(sessionId)
            return snapshot ? reduceSessionPendingInputs(snapshot) : null
        })()
        const entry = {scope, promise}
        loadInFlightRef.current = entry
        const clear = () => {
            if (loadInFlightRef.current === entry) loadInFlightRef.current = null
        }
        void promise.then(clear, clear)
        return promise
    }, [fetchSnapshot, sessionId, scope])

    const refresh = useCallback(async () => {
        const next = await load()
        if (next && scopeRef.current === scope) setViewState({scope, view: next})
    }, [load, scope])

    useEffect(() => {
        let cancelled = false
        void load().then((next) => {
            if (!cancelled && next) {
                setViewState({scope, view: next})
            }
        })
        return () => {
            cancelled = true
        }
    }, [load, scope])

    // Pending-input events arrive in a later increment. Until then, a small snapshot poll gives
    // every mounted browser the same durable order. Tight only while there is something for it to
    // track — a turn in flight or a parked input — and slow otherwise: an idle session with an
    // empty queue changes only when someone sends, which the transcript's own watch reports.
    // Polling every 2 s for the life of every open session was, by itself, the steadiest source of
    // API traffic the chat produced.
    const tracking =
        locallyBusy || remotelyBusy || view.executionState !== "idle" || view.queued.length > 0
    useEffect(() => {
        const timer = setInterval(
            () => void refresh(),
            tracking ? ACTIVE_SNAPSHOT_POLL_MS : IDLE_SNAPSHOT_POLL_MS,
        )
        return () => clearInterval(timer)
    }, [refresh, tracking])

    const submit = useCallback(
        async (
            message: QueuedMessage,
            policy: "queue" | "steer",
            watcher?: ServerInputWatcher,
        ): Promise<ServerInputAdmission> => {
            // Captured before the first await, so every continuation below is checked against the
            // mount that actually started this send.
            const generation = mount.capture()
            const outbound: UIMessage = {
                id: message.id,
                role: "user",
                ...(message.executionText !== undefined
                    ? {metadata: {display_content: message.text}}
                    : {}),
                parts: outboundUserParts(message),
            }
            // Bounded, not instant: a null build means the workflow has not loaded its invocation
            // URL yet, which the first send to a new agent races (#6042).
            const request = await buildRequestWithinDeadline(() =>
                buildAgentRequest(entityIdRef.current, [...messagesRef.current, outbound], {
                    sessionId,
                    ...(isSharedReaderReadyRef.current?.() ? {sharedResponse: true} : {}),
                }),
            ).catch((error: unknown) => {
                if (error instanceof Error && error.message === PREPARE_NOT_READY_MESSAGE) {
                    throw new Error("The agent is not ready to accept input.")
                }
                throw error
            })
            // The build can wait for the invocation URL. A session switched meanwhile would get a
            // request mixing the new scope's entity and messages with this send's session id.
            // Only the scope is checked, not the mount: durable admission may outlive a remount.
            if (scopeRef.current !== scope) {
                throw new Error("The session changed before the message was sent.")
            }

            const response = await fetch(request.invocationUrl, {
                method: "POST",
                headers: {
                    ...request.headers,
                    "Content-Type": "application/json",
                    "Idempotency-Key": message.id,
                },
                body: JSON.stringify({...request.requestBody, on_busy: policy}),
            })
            if (!response.ok) {
                // Read the body rather than cancelling it: a typed refusal states its reason
                // there, and discarding it left the composer able to say only that the message
                // had not gone — never why, and never what would fix it.
                const body = await response.text().catch(() => "")
                throw readSendRefusal(response.status, body)
            }

            if (response.status === 202) {
                // The body names the durable input this became. The echo retires when the dock is
                // OBSERVED to list that id, not merely because this refresh returned.
                const parkedId = await response
                    .json()
                    .then(parkedInputIdFromBody)
                    .catch(() => null)
                if (parkedId) watcher?.onParked?.(parkedId)
                else watcher?.onFailed?.()
                await refresh()
                return "queued"
            }

            // Admission succeeded when the response headers arrived. Keep consuming a fresh 200
            // run in the background so the composer can admit Queue/Steer while that run streams.
            // A 200 only proves the request was taken: the turn is accepted when the stream's
            // first frame names it, and a stream that ends without one never started a turn.
            void readRunAdmission(response, {
                ...watcher,
                onStartupPhase: (label) => {
                    if (mount.isCurrent(generation)) onStartupPhaseRef.current?.(label)
                },
            })
                .then(async ({accepted, ended}) => {
                    if (!mount.isCurrent(generation)) return
                    await refresh()
                    if (!mount.isCurrent(generation)) return
                    // Settlement WAITS for the re-read it starts. The saved row that retires this
                    // send's echo arrives in that read; reporting before it landed flagged a
                    // delivered, answered message as not sent whenever the read took longer
                    // than the turn (held back 45 s in the browser: the note went up at 6.6 s,
                    // under the reply).
                    const reconciled = await Promise.resolve()
                        .then(() => onExecutedRef.current?.())
                        .catch(() => false)
                    if (!mount.isCurrent(generation)) return
                    // ONLY for a turn this stream actually named, whose stream ended on its own,
                    // once the records were actually read. Silence means the runner never emits
                    // acceptance on this path, not that nothing was sent; a dropped connection
                    // means the turn may still be running; a failed read means nothing is known.
                    // Settling on any of them would put "wasn't sent" under a message that was.
                    if (accepted && ended && reconciled !== false) watcher?.onSettled?.()
                })
                .catch(() => undefined)
            return "running"
        },
        [mount, refresh, scope, sessionId],
    )

    const remove = useCallback(
        async (id: string) => {
            if (!(await removeInput({sessionId, inputId: id}))) {
                throw new Error("The pending input could not be removed.")
            }
            await refresh()
        },
        [refresh, removeInput, sessionId],
    )

    const edit = useCallback(
        async (id: string, item: {text: string; fileParts?: FileUIPart[]}) => {
            const updated = await updateInput({
                sessionId,
                inputId: id,
                text: item.text,
                attachments: item.fileParts?.map((part) => ({
                    uri: part.url,
                    mime_type: part.mediaType,
                    attachment_id: attachmentIdForPart(part) ?? undefined,
                    ...(part.filename ? {filename: part.filename} : {}),
                })),
            })
            if (!updated) throw new Error("The queued message could not be updated. Try again.")
            await refresh()
        },
        [refresh, sessionId, updateInput],
    )

    const sendNow = useCallback(
        async (id: string) => {
            if (!(await sendInputNow({sessionId, inputId: id}))) {
                throw new Error("The queued message could not be sent. Try again.")
            }
            await refresh()
        },
        [refresh, sendInputNow, sessionId],
    )

    return {
        executionState: view.executionState,
        busy: locallyBusy || view.executionState !== "idle",
        queued: view.queued,
        submit,
        remove,
        sendNow,
        edit,
        refresh,
    }
}
