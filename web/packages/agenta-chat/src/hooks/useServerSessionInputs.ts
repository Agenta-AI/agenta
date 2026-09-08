import {useCallback, useEffect, useRef, useState} from "react"

import {
    fetchSessionCapabilitiesAtom,
    fetchSessionSnapshotAtom,
    removePendingSessionInputAtom,
    sendPendingSessionInputNowAtom,
    updatePendingSessionInputAtom,
} from "@agenta/entities/session"
import {buildAgentRequest} from "@agenta/playground/agent-chat"
import {projectIdAtom} from "@agenta/shared/state"
import type {FileUIPart, UIMessage} from "ai"
import {useAtomValue, useSetAtom} from "jotai"

import {attachmentIdForPart} from "../assets/files"
import {reduceSessionPendingInputs, type SessionPendingInputView} from "../assets/pendingInputs"

import type {QueuedMessage} from "./useAgentChatQueue"

/** "queued" parks the input and the dock owns it; "running" starts a turn the transcript adopts. */
export type ServerInputAdmission = "queued" | "running"

/** Reports what became of ONE send, so its echo can retire on evidence about itself. */
export interface ServerInputWatcher {
    /** The run stream named the turn this send started. */
    onAccepted?: (executionId: string) => void
    /** A 202 parked it as this durable input. */
    onParked?: (inputId: string) => void
    /** No turn will ever carry it: refused, errored, or accepted by nothing. */
    onFailed?: () => void
}

export interface ServerSessionInputs {
    capabilities: SessionPendingInputView["capabilities"]
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
    resolveCapabilities: () => Promise<SessionPendingInputView["capabilities"]>
}

const emptyView = reduceSessionPendingInputs(null)

const RUN_ERROR_FRAME_TYPES = new Set(["error", "data-agent-error"])

type RunFrame = {kind: "accepted"; executionId: string} | {kind: "error"} | null

const runFrameFromLine = (line: string): RunFrame => {
    const payload = line.startsWith("data:") ? line.slice(5).trim() : line.trim()
    if (!payload || payload === "[DONE]") return null
    try {
        const frame = JSON.parse(payload) as {type?: unknown; data?: {executionId?: unknown}}
        if (typeof frame.type !== "string") return null
        if (RUN_ERROR_FRAME_TYPES.has(frame.type)) return {kind: "error"}
        if (frame.type !== "data-session-accepted") return null
        const id = frame.data?.executionId
        return typeof id === "string" && id ? {kind: "accepted", executionId: id} : null
    } catch {
        return null
    }
}

/**
 * Drain the run stream and report what it says about this send.
 *
 * An HTTP 200 only proves the request was taken. The runner can refuse inside the stream, so an
 * error frame BEFORE acceptance, or an end with no acceptance at all, means no turn ever carried
 * the message. After acceptance the turn exists and its failure is the transcript's to render, so
 * the echo is left to retire on its saved row.
 */
const readRunAdmission = async (
    response: Response,
    watcher?: ServerInputWatcher,
): Promise<void> => {
    const reader = response.body?.getReader()
    if (!reader) {
        watcher?.onFailed?.()
        return
    }
    const decoder = new TextDecoder()
    let buffer = ""
    let accepted = false
    try {
        for (;;) {
            const {done, value} = await reader.read()
            if (done) break
            if (accepted) continue
            buffer += decoder.decode(value, {stream: true})
            const lines = buffer.split("\n")
            buffer = lines.pop() ?? ""
            for (const line of lines) {
                const frame = runFrameFromLine(line)
                if (!frame) continue
                if (frame.kind === "error") {
                    watcher?.onFailed?.()
                    await reader.cancel().catch(() => undefined)
                    return
                }
                accepted = true
                watcher?.onAccepted?.(frame.executionId)
                break
            }
        }
    } catch {
        // A dropped connection after acceptance says nothing: the runner owns the turn either way.
        if (!accepted) watcher?.onFailed?.()
        return
    }
    if (!accepted) watcher?.onFailed?.()
}

const parkedInputIdFromBody = (body: unknown): string | null => {
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
    isSharedReaderReady,
    onExecuted,
}: {
    entityId: string
    sessionId: string
    messages: UIMessage[]
    locallyBusy: boolean
    /** Read current transport readiness when admitting input, including after reconnect. */
    isSharedReaderReady?: () => boolean
    onExecuted?: () => void
}): ServerSessionInputs => {
    const projectId = useAtomValue(projectIdAtom)
    const scope = JSON.stringify([projectId, sessionId])
    const scopeRef = useRef(scope)
    scopeRef.current = scope
    const fetchSnapshot = useSetAtom(fetchSessionSnapshotAtom)
    const fetchCapabilities = useSetAtom(fetchSessionCapabilitiesAtom)
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
    const isSharedReaderReadyRef = useRef(isSharedReaderReady)
    const loadInFlightRef = useRef<{
        scope: string
        promise: Promise<SessionPendingInputView | null>
    } | null>(null)
    messagesRef.current = messages
    entityIdRef.current = entityId
    onExecutedRef.current = onExecuted
    isSharedReaderReadyRef.current = isSharedReaderReady

    const load = useCallback((): Promise<SessionPendingInputView | null> => {
        if (loadInFlightRef.current?.scope === scope) {
            return loadInFlightRef.current.promise
        }
        const promise = (async () => {
            const capabilities = await fetchCapabilities(sessionId)
            if (!capabilities) return null
            if (!capabilities.queue) return emptyView
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
    }, [fetchCapabilities, fetchSnapshot, sessionId, scope])

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

    // Pending-input events arrive in a later increment. Until then, a small capability-gated
    // snapshot poll gives every mounted browser the same durable order.
    useEffect(() => {
        if (!view.capabilities.queue) return
        const timer = setInterval(() => void refresh(), 2_000)
        return () => clearInterval(timer)
    }, [refresh, view.capabilities.queue])

    const resolveCapabilities = useCallback(async () => {
        const capabilities = await fetchCapabilities(sessionId)
        if (!capabilities || scopeRef.current !== scope) {
            throw new Error("Session capabilities are unavailable. Please try again.")
        }
        return {queue: capabilities.queue, steer: capabilities.steer}
    }, [fetchCapabilities, sessionId, scope])

    const submit = useCallback(
        async (
            message: QueuedMessage,
            policy: "queue" | "steer",
            watcher?: ServerInputWatcher,
        ): Promise<ServerInputAdmission> => {
            const outbound: UIMessage = {
                id: message.id,
                role: "user",
                parts: [
                    ...(message.text ? [{type: "text" as const, text: message.text}] : []),
                    ...(message.fileParts ?? []),
                ],
            }
            const request = await buildAgentRequest(
                entityIdRef.current,
                [...messagesRef.current, outbound],
                {
                    sessionId,
                    ...(isSharedReaderReadyRef.current?.() ? {sharedResponse: true} : {}),
                },
            )
            if (!request) throw new Error("The agent is not ready to accept input.")

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
                await response.body?.cancel()
                throw new Error(`The input was not accepted (${response.status}).`)
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
            void readRunAdmission(response, watcher)
                .then(async () => {
                    await refresh()
                    onExecutedRef.current?.()
                })
                .catch(() => undefined)
            return "running"
        },
        [refresh, sessionId],
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
            if (!view.capabilities.queue) throw new Error("Queue editing is not available.")
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
        [refresh, sessionId, updateInput, view.capabilities.queue],
    )

    const sendNow = useCallback(
        async (id: string) => {
            if (!view.capabilities.queue || !view.capabilities.steer) {
                throw new Error("Send Now is not available for this session.")
            }
            if (!(await sendInputNow({sessionId, inputId: id}))) {
                throw new Error("The queued message could not be sent. Try again.")
            }
            await refresh()
        },
        [refresh, sendInputNow, sessionId, view.capabilities.queue, view.capabilities.steer],
    )

    return {
        capabilities: view.capabilities,
        executionState: view.executionState,
        busy: locallyBusy || view.executionState !== "idle",
        queued: view.queued,
        submit,
        remove,
        sendNow,
        edit,
        refresh,
        resolveCapabilities,
    }
}
