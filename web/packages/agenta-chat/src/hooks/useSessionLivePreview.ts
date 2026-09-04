import {useEffect, useMemo, useRef} from "react"

import {
    clearSessionLivePreviewAtom,
    fetchSessionSnapshot,
    sessionLivePreviewAtomFamily,
    type SessionSnapshot,
} from "@agenta/entities/session"
import {projectIdAtom} from "@agenta/shared/state"
import type {UIMessage} from "ai"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {createSessionDurableEventState, reduceSessionDurableEvent} from "../model/durableEvents"
import {
    reduceSessionLivePreview,
    sessionLivePreviewMessages,
    shouldSubscribeToSessionLivePreview,
} from "../model/livePreview"
import {
    connectSessionLiveEvents,
    type SessionLiveEventsConnection,
} from "../transport/sessionLiveEvents"

export const useSessionLivePreview = ({
    sessionId,
    sharedReaderAdvertised,
    runningElsewhere,
    onDisconnect,
}: {
    sessionId: string
    /** Capability copied from the current backend session snapshot. */
    sharedReaderAdvertised: boolean
    /** True only when this browser is not the sender of the running turn. */
    runningElsewhere: boolean
    /** Re-fetches the durable transcript after any gap; preview frames never fill history. */
    onDisconnect: (snapshot?: SessionSnapshot) => void
}): UIMessage[] => {
    const projectId = useAtomValue(projectIdAtom)
    const [preview, setPreview] = useAtom(sessionLivePreviewAtomFamily(sessionId))
    const clearPreview = useSetAtom(clearSessionLivePreviewAtom)
    const onDisconnectRef = useRef(onDisconnect)
    onDisconnectRef.current = onDisconnect
    const enabled = shouldSubscribeToSessionLivePreview({
        sharedReaderAdvertised,
        runningElsewhere,
    })

    useEffect(() => {
        clearPreview(sessionId)
        if (!enabled || !sessionId) return
        if (typeof window === "undefined" || typeof window.EventSource === "undefined") return

        let connection: SessionLiveEventsConnection | null = null
        let disposed = false
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null
        let generation = 0
        let durable = createSessionDurableEventState()

        const close = () => {
            connection?.close()
            connection = null
            clearPreview(sessionId)
        }

        const hydrateAndOpen = async () => {
            if (disposed || connection || document.visibilityState !== "visible") return
            const currentGeneration = ++generation
            clearPreview(sessionId)

            const snapshot = projectId ? await fetchSessionSnapshot({sessionId, projectId}) : null
            if (disposed || currentGeneration !== generation) return

            // The host re-reads durable transcript state after the atomic watermark is known.
            onDisconnectRef.current(snapshot ?? undefined)
            durable = createSessionDurableEventState(
                snapshot?.read.latest_sequence ?? durable.latestSequence,
            )
            connection = connectSessionLiveEvents({
                sessionId,
                after: durable.latestSequence,
                onFrame: (frame) =>
                    setPreview((current) => reduceSessionLivePreview(current, frame)),
                onEvent: (event) => {
                    const next = reduceSessionDurableEvent(durable, event)
                    if (next.latestSequence === durable.latestSequence) {
                        durable = next
                        return
                    }
                    durable = next
                    // Completed durable rows replace temporary frames in the transcript source.
                    clearPreview(sessionId)
                    onDisconnectRef.current()
                },
                onReady: () => {},
                onDisconnect: ({reconnect}) => {
                    close()
                    onDisconnectRef.current()
                    if (!reconnect || disposed || reconnectTimer) return
                    reconnectTimer = setTimeout(() => {
                        reconnectTimer = null
                        void hydrateAndOpen()
                    }, 500)
                },
            })
        }

        const open = () => void hydrateAndOpen()
        const onVisibility = () => {
            if (document.visibilityState === "visible") open()
            else {
                generation += 1
                close()
            }
        }

        document.addEventListener("visibilitychange", onVisibility)
        open()
        return () => {
            disposed = true
            generation += 1
            if (reconnectTimer) clearTimeout(reconnectTimer)
            document.removeEventListener("visibilitychange", onVisibility)
            close()
        }
    }, [clearPreview, enabled, projectId, sessionId, setPreview])

    useEffect(() => {
        if (preview.gapDetected) onDisconnectRef.current()
    }, [preview.gapDetected])

    return useMemo(() => sessionLivePreviewMessages(preview), [preview])
}
