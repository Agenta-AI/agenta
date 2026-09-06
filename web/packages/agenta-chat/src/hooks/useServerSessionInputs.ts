import {useCallback, useEffect, useRef, useState} from "react"

import {
    fetchSessionCapabilitiesAtom,
    fetchSessionSnapshotAtom,
    removePendingSessionInputAtom,
} from "@agenta/entities/session"
import {buildAgentRequest} from "@agenta/playground/agent-chat"
import {projectIdAtom} from "@agenta/shared/state"
import type {UIMessage} from "ai"
import {useAtomValue, useSetAtom} from "jotai"

import {reduceSessionPendingInputs, type SessionPendingInputView} from "../assets/pendingInputs"

import type {QueuedMessage} from "./useAgentChatQueue"

export interface ServerSessionInputs {
    capabilities: SessionPendingInputView["capabilities"]
    executionState: SessionPendingInputView["executionState"]
    busy: boolean
    queued: QueuedMessage[]
    submit: (message: QueuedMessage, policy: "queue" | "steer") => Promise<void>
    remove: (id: string) => Promise<void>
    refresh: () => Promise<void>
    resolveCapabilities: () => Promise<SessionPendingInputView["capabilities"]>
}

const emptyView = reduceSessionPendingInputs(null)

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
        async (message: QueuedMessage, policy: "queue" | "steer") => {
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
                await response.body?.cancel()
                await refresh()
                return
            }

            // Admission succeeded when the response headers arrived. Keep consuming a fresh 200
            // run in the background so the composer can admit Queue/Steer while that run streams.
            void response
                .arrayBuffer()
                .catch(() => undefined)
                .then(async () => {
                    await refresh()
                    onExecutedRef.current?.()
                })
                .catch(() => undefined)
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

    return {
        capabilities: view.capabilities,
        executionState: view.executionState,
        busy: locallyBusy || view.executionState !== "idle",
        queued: view.queued,
        submit,
        remove,
        refresh,
        resolveCapabilities,
    }
}
