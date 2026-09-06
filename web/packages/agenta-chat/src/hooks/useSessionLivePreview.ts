import {useEffect, useMemo, useRef, useState} from "react"

import {
    clearSessionLivePreviewAtom,
    fetchSessionInteractionStatesAtom,
    fetchSessionSnapshot,
    querySessionTranscript,
    revalidateSessionInteractionsAtom,
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
    markSessionLivePreviewTerminal,
    retireSessionLivePreview,
    retireCoveredSessionLivePreview,
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
    onExecutionSettled,
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
    /** Reports the shared path's durable terminal verdict for the current execution. */
    onExecutionSettled?: (executionId?: string) => void
    /** Adopts a bounded transcript or re-fetches after a later gap/disconnect. */
    onDisconnect: (transcript?: SessionTranscript) => boolean | Promise<boolean>
}): {
    messages: UIMessage[]
    runningFromSnapshot: boolean
    readerReady: boolean
    sharedSettledAt: number
} => {
    const projectId = useAtomValue(projectIdAtom)
    const [preview, setPreview] = useAtom(sessionLivePreviewAtomFamily(sessionId))
    const clearPreview = useSetAtom(clearSessionLivePreviewAtom)
    const fetchInteractionStates = useSetAtom(fetchSessionInteractionStatesAtom)
    const revalidateInteractionStates = useSetAtom(revalidateSessionInteractionsAtom)
    const [runningFromSnapshot, setRunningFromSnapshot] = useState(false)
    const [readerReady, setReaderReady] = useState(false)
    const [sharedSettledAt, setSharedSettledAt] = useState(0)
    const onDisconnectRef = useRef(onDisconnect)
    onDisconnectRef.current = onDisconnect
    const retryHydrationRef = useRef<() => void>(() => undefined)
    const onReadyChangeRef = useRef(onReadyChange)
    onReadyChangeRef.current = onReadyChange
    const onExecutionSettledRef = useRef(onExecutionSettled)
    onExecutionSettledRef.current = onExecutionSettled
    const subscribed = shouldSubscribeToSessionLivePreview({
        sharedReaderAdvertised,
        runningElsewhere,
        sender,
    })

    useEffect(() => {
        if (!runningElsewhere) setRunningFromSnapshot(false)
    }, [runningElsewhere])

    useEffect(() => {
        clearPreview(sessionId)
        setSharedSettledAt(0)
        setReaderReady(false)
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
            setReaderReady(false)
            onReadyChangeRef.current?.(false)
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

        const readBoundedTranscript = async (
            throughSequence: number,
        ): Promise<{transcript: SessionTranscript; coveredEntityIds: Set<string>} | null> => {
            if (!projectId) return null
            const [records, interactionRowStates] = await Promise.all([
                querySessionTranscript({sessionId, projectId, throughSequence}),
                fetchInteractionStates(sessionId),
            ])
            if (!Array.isArray(records)) return null
            const coveredEntityIds = new Set(
                records.flatMap((record) => {
                    const payload = record.payload
                    if (!payload) return []
                    const id =
                        payload.type === "message" || payload.type === "thought"
                            ? payload.message_id
                            : payload.type === "tool_result"
                              ? payload.id
                              : undefined
                    return typeof id === "string" ? [id] : []
                }),
            )
            return {
                transcript: {
                    messages: transcriptToMessages(records, {interactionRowStates}) ?? [],
                    recordCount: records.length,
                    sequenceCursor: throughSequence,
                    interactionRows: interactionRowStates,
                },
                coveredEntityIds,
            }
        }

        const hydrateAndOpen = async () => {
            if (disposed || connection || document.visibilityState !== "visible") return
            if (reconnectTimer) clearTimeout(reconnectTimer)
            reconnectTimer = null
            const currentGeneration = ++generation

            let snapshot
            try {
                snapshot = projectId ? await fetchSessionSnapshot({sessionId, projectId}) : null
            } catch {
                scheduleReconnect()
                return
            }
            if (disposed || currentGeneration !== generation) return
            const snapshotRunning = isSessionSnapshotRunning(snapshot ?? undefined)
            setRunningFromSnapshot(snapshotRunning)
            if (snapshot?.session && snapshot.read && !snapshotRunning) {
                setSharedSettledAt(Date.now())
                onExecutionSettledRef.current?.()
            }

            if (snapshot?.session && snapshot.read && projectId) {
                try {
                    let previewBoundary: typeof preview | undefined
                    setPreview((current) => {
                        previewBoundary = current
                        return current
                    })
                    const bounded = await readBoundedTranscript(snapshot.read.latest_sequence)
                    if (!bounded) {
                        scheduleReconnect()
                        return
                    }
                    if (disposed || currentGeneration !== generation) return
                    const adopted = await adoptTranscript(bounded.transcript)
                    if (disposed || currentGeneration !== generation) return
                    if (!adopted) {
                        scheduleReconnect()
                        return
                    }
                    if (!snapshotRunning) clearPreview(sessionId)
                    else
                        setPreview((current) => ({
                            ...retireCoveredSessionLivePreview(
                                current,
                                previewBoundary ?? current,
                                bounded.coveredEntityIds,
                                bounded.transcript.messages,
                            ),
                            gapDetected: false,
                        }))
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
                snapshot?.read?.latest_sequence ?? durable.latestSequence,
            )
            connection = connectSessionLiveEvents({
                sessionId,
                after: durable.latestSequence,
                onFrame: (frame) => {
                    if (disposed || currentGeneration !== generation) return
                    setPreview((current) => reduceSessionLivePreview(current, frame))
                },
                onEvent: (event) => {
                    if (disposed || currentGeneration !== generation) return
                    const next = reduceSessionDurableEvent(durable, event)
                    if (!shouldRefetchSessionTranscript(durable, next, event)) {
                        durable = next
                        return
                    }
                    durable = next
                    if (event.type === "execution.started") setRunningFromSnapshot(true)
                    let previewBoundary: typeof preview | undefined
                    setPreview((current) => {
                        previewBoundary = current
                        return ["execution.stopped", "execution.failed", "execution.lost"].includes(
                            event.type,
                        )
                            ? markSessionLivePreviewTerminal(current, event)
                            : current
                    })
                    if (
                        event.type === "execution.stopped" ||
                        event.type === "execution.failed" ||
                        event.type === "execution.lost"
                    ) {
                        setRunningFromSnapshot(false)
                        setSharedSettledAt(Date.now())
                        onExecutionSettledRef.current?.(event.execution_id)
                    }
                    const interactionChanged =
                        event.type === "interaction.requested" ||
                        event.type === "interaction.responded"
                    if (interactionChanged) revalidateInteractionStates(sessionId)
                    void readBoundedTranscript(next.latestSequence)
                        .then(async (bounded) => {
                            if (disposed || currentGeneration !== generation) return
                            const transcript = bounded?.transcript
                            const adopted = transcript ? await adoptTranscript(transcript) : false
                            if (disposed || currentGeneration !== generation) return
                            if (adopted) {
                                setPreview((current) =>
                                    retireSessionLivePreview(
                                        bounded && previewBoundary
                                            ? retireCoveredSessionLivePreview(
                                                  current,
                                                  previewBoundary ?? current,
                                                  bounded.coveredEntityIds,
                                                  bounded.transcript.messages,
                                              )
                                            : current,
                                        event,
                                        previewBoundary,
                                        transcript?.messages,
                                    ),
                                )
                            } else scheduleReconnect()
                        })
                        .catch(() => {
                            if (!disposed && currentGeneration === generation) scheduleReconnect()
                        })
                },
                onReady: ({watermark}) => {
                    if (disposed || currentGeneration !== generation) return
                    durable = completeSessionDurableEventReplay(durable, watermark)
                    reconnectDelayMs = RECONNECT_INITIAL_DELAY_MS
                    setReaderReady(true)
                    onReadyChangeRef.current?.(true)
                },
                onDisconnect: ({reconnect}) => {
                    if (disposed || currentGeneration !== generation) return
                    close()
                    // Reconcile saved records and preview together during snapshot recovery.
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
            clearPreview(sessionId)
        }
    }, [
        clearPreview,
        fetchInteractionStates,
        projectId,
        revalidateInteractionStates,
        sessionId,
        setPreview,
        sharedReaderAdvertised,
        subscribed,
    ])

    useEffect(() => {
        if (!preview.gapDetected) return
        retryHydrationRef.current()
    }, [preview.gapDetected])

    return {
        messages: useMemo(() => sessionLivePreviewMessages(preview), [preview]),
        runningFromSnapshot: sharedReaderAdvertised && runningFromSnapshot,
        readerReady: sharedReaderAdvertised && subscribed && readerReady,
        sharedSettledAt: sharedReaderAdvertised ? sharedSettledAt : 0,
    }
}
