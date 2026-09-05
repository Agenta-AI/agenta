import {useEffect, useMemo, useRef} from "react"

import {
    clearSessionLivePreviewAtom,
    fetchSessionSnapshot,
    querySessionTranscript,
    sessionLivePreviewAtomFamily,
} from "@agenta/entities/session"
import {projectIdAtom} from "@agenta/shared/state"
import type {UIMessage} from "ai"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import type {SessionTranscript} from "../assets/loadSession"
import {transcriptToMessages} from "../assets/transcriptToMessages"
import {
    completeSessionDurableEventReplay,
    createSessionDurableEventState,
    reduceSessionDurableEvent,
    shouldRefetchSessionTranscript,
} from "../model/durableEvents"
import {
    reduceSessionLivePreview,
    sessionLivePreviewMessages,
    shouldSubscribeToSessionLivePreview,
} from "../model/livePreview"
import {
    connectSessionLiveEvents,
    type SessionLiveEventsConnection,
} from "../transport/sessionLiveEvents"

const RECONNECT_INITIAL_DELAY_MS = 5_000
const RECONNECT_MAX_DELAY_MS = 30_000

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
    /** Adopts a bounded transcript or re-fetches after a later gap/disconnect. */
    onDisconnect: (transcript?: SessionTranscript) => boolean | Promise<boolean>
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
        let reconnectDelayMs = RECONNECT_INITIAL_DELAY_MS
        let generation = 0
        let durable = createSessionDurableEventState()

        const close = () => {
            connection?.close()
            connection = null
            clearPreview(sessionId)
        }

        const scheduleReconnect = () => {
            if (disposed || reconnectTimer) return
            const delay = reconnectDelayMs
            reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_DELAY_MS)
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null
                void hydrateAndOpen()
            }, delay)
        }

        const hydrateAndOpen = async () => {
            if (disposed || connection || document.visibilityState !== "visible") return
            const currentGeneration = ++generation
            clearPreview(sessionId)

            const snapshot = projectId ? await fetchSessionSnapshot({sessionId, projectId}) : null
            if (disposed || currentGeneration !== generation) return

            if (snapshot && projectId) {
                const records = await querySessionTranscript({
                    sessionId,
                    projectId,
                    throughSequence: snapshot.read.latest_sequence,
                })
                if (records === null) {
                    scheduleReconnect()
                    return
                }
                if (disposed || currentGeneration !== generation) return
                const adopted = await onDisconnectRef.current({
                    messages: transcriptToMessages(records) ?? [],
                    // Retention can make the bounded page shorter than the durable log. The
                    // snapshot cursor is the exact boundary this transcript represents.
                    recordCount: snapshot.read.latest_sequence,
                })
                if (disposed || currentGeneration !== generation) return
                if (!adopted) {
                    scheduleReconnect()
                    return
                }
            } else {
                await onDisconnectRef.current()
                if (disposed || currentGeneration !== generation) return
            }
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
                    if (!shouldRefetchSessionTranscript(durable, next, event)) {
                        durable = next
                        return
                    }
                    durable = next
                    // Completed durable rows replace temporary frames in the transcript source.
                    clearPreview(sessionId)
                    onDisconnectRef.current()
                },
                onReady: ({watermark}) => {
                    durable = completeSessionDurableEventReplay(durable, watermark)
                    reconnectDelayMs = RECONNECT_INITIAL_DELAY_MS
                },
                onDisconnect: ({reconnect}) => {
                    close()
                    onDisconnectRef.current()
                    if (reconnect) scheduleReconnect()
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
