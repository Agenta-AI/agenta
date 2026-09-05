import {useEffect, useMemo, useRef} from "react"

import {clearSessionLivePreviewAtom, sessionLivePreviewAtomFamily} from "@agenta/entities/session"
import type {UIMessage} from "ai"
import {useAtom, useSetAtom} from "jotai"

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
    onDisconnect: () => void
}): UIMessage[] => {
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
        let disconnected = false

        const resetAndRefresh = () => {
            clearPreview(sessionId)
            if (disconnected) return
            disconnected = true
            onDisconnectRef.current()
        }

        const open = () => {
            if (disposed || connection || document.visibilityState !== "visible") return
            connection = connectSessionLiveEvents({
                sessionId,
                onFrame: (frame) =>
                    setPreview((current) => reduceSessionLivePreview(current, frame)),
                onReady: () => {
                    // A reconnect has no cursor. Re-read durable history before accepting its new tail.
                    clearPreview(sessionId)
                    onDisconnectRef.current()
                    disconnected = false
                },
                onDisconnect: resetAndRefresh,
            })
        }

        const close = () => {
            connection?.close()
            connection = null
            clearPreview(sessionId)
        }
        const onVisibility = () => {
            if (document.visibilityState === "visible") open()
            else close()
        }

        document.addEventListener("visibilitychange", onVisibility)
        open()
        return () => {
            disposed = true
            document.removeEventListener("visibilitychange", onVisibility)
            close()
        }
    }, [clearPreview, enabled, sessionId, setPreview])

    useEffect(() => {
        if (preview.gapDetected) onDisconnectRef.current()
    }, [preview.gapDetected])

    return useMemo(() => sessionLivePreviewMessages(preview), [preview])
}
