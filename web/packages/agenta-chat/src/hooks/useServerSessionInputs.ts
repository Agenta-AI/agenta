import {useCallback, useEffect, useRef, useState} from "react"

import {fetchSessionSnapshotAtom, removePendingSessionInputAtom} from "@agenta/entities/session"
import {buildAgentRequest} from "@agenta/playground/agent-chat"
import type {UIMessage} from "ai"
import {useSetAtom} from "jotai"

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
}

const emptyView = reduceSessionPendingInputs(null)

export const useServerSessionInputs = ({
    entityId,
    sessionId,
    messages,
    locallyBusy,
    onExecuted,
}: {
    entityId: string
    sessionId: string
    messages: UIMessage[]
    locallyBusy: boolean
    onExecuted?: () => void
}): ServerSessionInputs => {
    const fetchSnapshot = useSetAtom(fetchSessionSnapshotAtom)
    const removeInput = useSetAtom(removePendingSessionInputAtom)
    const [viewState, setViewState] = useState<{sessionId: string; view: SessionPendingInputView}>(
        () => ({sessionId, view: emptyView}),
    )
    const view = viewState.sessionId === sessionId ? viewState.view : emptyView
    const messagesRef = useRef(messages)
    const entityIdRef = useRef(entityId)
    const onExecutedRef = useRef(onExecuted)
    messagesRef.current = messages
    entityIdRef.current = entityId
    onExecutedRef.current = onExecuted

    const refresh = useCallback(async () => {
        const snapshot = await fetchSnapshot(sessionId)
        if (snapshot) setViewState({sessionId, view: reduceSessionPendingInputs(snapshot)})
    }, [fetchSnapshot, sessionId])

    useEffect(() => {
        let cancelled = false
        void fetchSnapshot(sessionId).then((snapshot) => {
            if (!cancelled && snapshot) {
                setViewState({sessionId, view: reduceSessionPendingInputs(snapshot)})
            }
        })
        return () => {
            cancelled = true
        }
    }, [fetchSnapshot, sessionId])

    // Pending-input events arrive in a later increment. Until then, a small capability-gated
    // snapshot poll gives every mounted browser the same durable order.
    useEffect(() => {
        if (!view.capabilities.queue) return
        const timer = setInterval(() => void refresh(), 2_000)
        return () => clearInterval(timer)
    }, [refresh, view.capabilities.queue])

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
                {sessionId},
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

            // The local stream can settle between the click and admission. If the server admits
            // this as a fresh 200 run, keep its sender-owned response alive, then adopt its durable
            // transcript through the host's normal guarded revalidation.
            await response.arrayBuffer()
            await refresh()
            onExecutedRef.current?.()
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
    }
}
