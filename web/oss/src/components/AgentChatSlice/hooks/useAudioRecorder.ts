import {useCallback, useEffect, useRef, useState} from "react"

/**
 * Records mic audio via MediaRecorder and hands back a `File` on stop (for the attachment tray).
 * This is the "voice message" mode — the actual audio, sent as an attachment, as opposed to
 * `useVoiceInput` which transcribes to text. Broadly supported (incl. Firefox).
 */

const MIME_CANDIDATES = ["audio/webm", "audio/mp4", "audio/ogg"]

const pickMime = (): string => {
    if (typeof MediaRecorder === "undefined") return ""
    return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? ""
}

const extForMime = (mime: string): string =>
    mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm"

export interface AudioRecorder {
    supported: boolean
    recording: boolean
    /** Elapsed recording time in ms (for a live mm:ss readout). */
    elapsedMs: number
    error: string | null
    start: () => void
    /** Stop and emit the recorded `File` via the `onComplete` callback. */
    stop: () => void
    /** Stop and discard (no file emitted). */
    cancel: () => void
}

export function useAudioRecorder(onComplete: (file: File) => void): AudioRecorder {
    const supported =
        typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof MediaRecorder !== "undefined"

    const [recording, setRecording] = useState(false)
    const [elapsedMs, setElapsedMs] = useState(0)
    const [error, setError] = useState<string | null>(null)

    const recRef = useRef<MediaRecorder | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const chunksRef = useRef<Blob[]>([])
    const startedAtRef = useRef(0)
    const timerRef = useRef<number | undefined>(undefined)
    const cancelledRef = useRef(false)
    const onCompleteRef = useRef(onComplete)
    onCompleteRef.current = onComplete

    const teardown = useCallback(() => {
        window.clearInterval(timerRef.current)
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        recRef.current = null
    }, [])

    const start = useCallback(() => {
        if (!supported || recRef.current) return
        setError(null)
        cancelledRef.current = false
        navigator.mediaDevices
            .getUserMedia({audio: true})
            .then((stream) => {
                streamRef.current = stream
                const mime = pickMime()
                const rec = new MediaRecorder(stream, mime ? {mimeType: mime} : undefined)
                chunksRef.current = []
                rec.ondataavailable = (e) => {
                    if (e.data.size) chunksRef.current.push(e.data)
                }
                rec.onstop = () => {
                    const type = rec.mimeType || mime || "audio/webm"
                    const discard = cancelledRef.current
                    teardown()
                    setRecording(false)
                    if (discard) return
                    const blob = new Blob(chunksRef.current, {type})
                    onCompleteRef.current(
                        new File([blob], `Voice message.${extForMime(type)}`, {type}),
                    )
                }
                recRef.current = rec
                startedAtRef.current = Date.now()
                setElapsedMs(0)
                timerRef.current = window.setInterval(
                    () => setElapsedMs(Date.now() - startedAtRef.current),
                    200,
                )
                rec.start()
                setRecording(true)
            })
            .catch((e: unknown) => {
                teardown()
                const denied = e instanceof DOMException && e.name === "NotAllowedError"
                setError(denied ? "Microphone access denied" : "Recording error")
            })
    }, [supported, teardown])

    const stop = useCallback(() => recRef.current?.stop(), [])
    const cancel = useCallback(() => {
        cancelledRef.current = true
        recRef.current?.stop()
    }, [])

    useEffect(
        () => () => {
            cancelledRef.current = true
            recRef.current?.stop()
            teardown()
        },
        [teardown],
    )

    return {supported, recording, elapsedMs, error, start, stop, cancel}
}
