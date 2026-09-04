import {useEffect, useMemo, useRef, useState} from "react"

import {
    clearSessionLivePreviewAtom,
    fetchSessionInteractionStatesAtom,
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
    isSessionSnapshotRunning,
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
    sender,
    onReadyChange,
    onDisconnect,
}: {
    sessionId: string
    /** Capability copied from the current backend session snapshot or liveness response. */
    sharedReaderAdvertised: boolean
    /** True only when this browser is not the sender of the running turn. */
    runningElsewhere: boolean
    /** Subscribe before this browser sends its next turn. */
    sender?: boolean
    /** Non-reactive request-pipeline signal: true only while the shared event route is ready. */
    onReadyChange?: (ready: boolean) => void
    /** Adopts a bounded transcript or re-fetches after a later gap/disconnect. */
    onDisconnect: (transcript?: SessionTranscript) => boolean | Promise<boolean>
}): {messages: UIMessage[]; runningFromSnapshot: boolean} => {
    const projectId = useAtomValue(projectIdAtom)
    const [preview, setPreview] = useAtom(sessionLivePreviewAtomFamily(sessionId))
    const clearPreview = useSetAtom(clearSessionLivePreviewAtom)
    const fetchInteractionStates = useSetAtom(fetchSessionInteractionStatesAtom)
    const [runningFromSnapshot, setRunningFromSnapshot] = useState(false)
    const onDisconnectRef = useRef(onDisconnect)
    onDisconnectRef.current = onDisconnect
    const retryHydrationRef = useRef<() => void>(() => undefined)
    const onReadyChangeRef = useRef(onReadyChange)
    onReadyChangeRef.current = onReadyChange
    const subscribed = shouldSubscribeToSessionLivePreview({
        sharedReaderAdvertised,
        runningElsewhere,
        sender,
    })

    useEffect(() => {
        clearPreview(sessionId)
        onReadyChangeRef.current?.(false)
        if (!sharedReaderAdvertised || !sessionId) return
        setRunningFromSnapshot(false)
        if (!subscribed) return
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
            onReadyChangeRef.current?.(false)
            clearPreview(sessionId)
        }

        const scheduleReconnect = () => {
            if (disposed || reconnectTimer) return
            const delay = reconnectDelayMs
            reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_DELAY_MS)
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null
                close()
                void hydrateAndOpen()
            }, delay)
        }
        retryHydrationRef.current = scheduleReconnect

        const adoptTranscript = async (transcript?: SessionTranscript): Promise<boolean> => {
            try {
                return Boolean(await onDisconnectRef.current(transcript))
            } catch {
                return false
            }
        }

        const hydrateAndOpen = async () => {
            if (disposed || connection || document.visibilityState !== "visible") return
            const currentGeneration = ++generation
            clearPreview(sessionId)

            let snapshot
            try {
                snapshot = projectId ? await fetchSessionSnapshot({sessionId, projectId}) : null
            } catch {
                scheduleReconnect()
                return
            }
            if (disposed || currentGeneration !== generation) return
            setRunningFromSnapshot(isSessionSnapshotRunning(snapshot ?? undefined))

            if (snapshot && projectId) {
                try {
                    const [records, interactionRowStates] = await Promise.all([
                        querySessionTranscript({
                            sessionId,
                            projectId,
                            throughSequence: snapshot.read.latest_sequence,
                        }),
                        fetchInteractionStates(sessionId),
                    ])
                    if (!Array.isArray(records)) {
                        scheduleReconnect()
                        return
                    }
                    if (disposed || currentGeneration !== generation) return
                    const adopted = await adoptTranscript({
                        // Use the canonical durable mapper with the same lifecycle join as
                        // loadSessionMessages, so terminal interactions cannot replay as pending.
                        messages: transcriptToMessages(records, {interactionRowStates}) ?? [],
                        recordCount: records.length,
                        // The snapshot cursor stays separate because retained rows can be sparse.
                        sequenceCursor: snapshot.read.latest_sequence,
                        interactionRows: interactionRowStates,
                    })
                    if (disposed || currentGeneration !== generation) return
                    if (!adopted) {
                        scheduleReconnect()
                        return
                    }
                } catch {
                    scheduleReconnect()
                    return
                }
            } else {
                const adopted = await adoptTranscript()
                if (disposed || currentGeneration !== generation) return
                if (!adopted) {
                    scheduleReconnect()
                    return
                }
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
                    if (event.type === "execution.started") setRunningFromSnapshot(true)
                    if (
                        event.type === "execution.stopped" ||
                        event.type === "execution.failed" ||
                        event.type === "execution.lost"
                    )
                        setRunningFromSnapshot(false)
                    // Completed durable rows replace temporary frames in the transcript source.
                    clearPreview(sessionId)
                    void adoptTranscript().then((adopted) => {
                        if (!adopted && !disposed) scheduleReconnect()
                    })
                },
                onReady: ({watermark}) => {
                    durable = completeSessionDurableEventReplay(durable, watermark)
                    reconnectDelayMs = RECONNECT_INITIAL_DELAY_MS
                    onReadyChangeRef.current?.(true)
                },
                onDisconnect: ({reconnect}) => {
                    close()
                    void adoptTranscript()
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
            retryHydrationRef.current = () => undefined
            generation += 1
            onReadyChangeRef.current?.(false)
            if (reconnectTimer) clearTimeout(reconnectTimer)
            document.removeEventListener("visibilitychange", onVisibility)
            close()
        }
    }, [
        clearPreview,
        fetchInteractionStates,
        projectId,
        sessionId,
        setPreview,
        sharedReaderAdvertised,
        subscribed,
    ])

    useEffect(() => {
        if (!preview.gapDetected) return
        const retryHydration = retryHydrationRef.current
        void Promise.resolve(onDisconnectRef.current()).then((adopted) => {
            if (!adopted) retryHydration()
        }, retryHydration)
    }, [preview.gapDetected])

    return {
        messages: useMemo(() => sessionLivePreviewMessages(preview), [preview]),
        runningFromSnapshot: sharedReaderAdvertised && runningFromSnapshot,
    }
}
