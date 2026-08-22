import {useCallback, useEffect, useRef, useState, type RefObject} from "react"

/**
 * Records mic audio via MediaRecorder and hands back a `File` on stop (for the attachment tray).
 * This is the "voice message" mode — the actual audio, sent as an attachment, as opposed to
 * `useVoiceInput` which transcribes to text. Broadly supported (incl. Firefox).
 *
 * Exposes the full capture lifecycle so the UI can render it honestly: a permission-pending
 * state, a live input level (so the person sees it is hearing them), an elapsed clock with a hard
 * cap, a persistent denied/error state, and distinct stop (keep) vs cancel (discard) exits. A
 * too-short take is discarded rather than attaching an empty clip.
 */

export type RecorderStatus = "idle" | "requesting" | "recording" | "denied" | "error"

/** Hard cap on a single voice message. Auto-stops (and keeps) at the limit. */
export const MAX_RECORDING_MS = 5 * 60 * 1000
/** Takes shorter than this are discarded — a mis-tap, not a message. */
const MIN_RECORDING_MS = 700

const BLOCKED_MESSAGE = "Microphone access is blocked — enable it in your browser settings."
const DISMISSED_MESSAGE = "Microphone access is needed to record a voice message."

/** The browser's stored decision, or null where the Permissions API can't answer (e.g. Firefox). */
const micPermissionState = async (): Promise<PermissionState | null> => {
    try {
        const perms = navigator.permissions
        if (!perms?.query) return null
        const result = await perms.query({name: "microphone" as PermissionName})
        return result.state
    } catch {
        return null
    }
}

const MIME_CANDIDATES = ["audio/webm", "audio/mp4", "audio/ogg"]

const pickMime = (): string => {
    if (typeof MediaRecorder === "undefined") return ""
    return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? ""
}

const extForMime = (mime: string): string =>
    mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm"

const getAudioContextCtor = (): typeof AudioContext | undefined => {
    if (typeof window === "undefined") return undefined
    const w = window as unknown as {
        AudioContext?: typeof AudioContext
        webkitAudioContext?: typeof AudioContext
    }
    return w.AudioContext ?? w.webkitAudioContext
}

export interface AudioRecorder {
    supported: boolean
    status: RecorderStatus
    /** True while requesting permission or recording. */
    active: boolean
    /** Whether to show the recording takeover — capturing only, never while awaiting permission. */
    takeoverVisible: boolean
    /** Awaiting the browser permission prompt; surface this on the mic itself, not as a takeover. */
    pending: boolean
    /**
     * Live analyser for the waveform, or null when metering is unavailable (it is best-effort and
     * never blocks capture). The view samples and draws from this — visualisation state stays out
     * of React entirely, so it costs no renders.
     */
    analyserRef: RefObject<AnalyserNode | null>
    /** Capture start (epoch ms), 0 when idle. Elapsed is DERIVED from this, so the clock needs no
     * polling timer and cannot drift. */
    startedAtRef: RefObject<number>
    /** Human message for the `denied` / `error` states; null otherwise. */
    error: string | null
    start: () => void
    /** Stop and keep — emits the recorded `File` (unless it was too short). */
    stop: () => void
    /** Stop and discard — no file emitted. */
    cancel: () => void
    dismissError: () => void
}

export function useAudioRecorder(onComplete: (file: File) => void): AudioRecorder {
    const supported =
        typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof MediaRecorder !== "undefined"

    const [status, setStatus] = useState<RecorderStatus>("idle")
    const [error, setError] = useState<string | null>(null)

    const recRef = useRef<MediaRecorder | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const chunksRef = useRef<Blob[]>([])
    const startedAtRef = useRef(0)
    // Deadline for the hard cap. A timer, not rAF: rAF pauses in a background tab, which would
    // let a backgrounded recording run past the limit forever.
    const capTimerRef = useRef<number | undefined>(undefined)
    const analyserRef = useRef<AnalyserNode | null>(null)
    const audioCtxRef = useRef<AudioContext | null>(null)
    const cancelledRef = useRef(false)
    // The spec fires `stop` AFTER `error`. Set on error so the trailing `onstop` skips its normal
    // path — otherwise it would flip status error→idle and emit a File from the partial chunks.
    const erroredRef = useRef(false)
    const onCompleteRef = useRef(onComplete)
    onCompleteRef.current = onComplete

    const teardown = useCallback(() => {
        window.clearTimeout(capTimerRef.current)
        analyserRef.current = null
        audioCtxRef.current?.close().catch(() => {})
        audioCtxRef.current = null
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        recRef.current = null
        startedAtRef.current = 0
    }, [])

    /** Build the analysis graph. The view samples it; this only owns its lifecycle. */
    const meter = useCallback((stream: MediaStream) => {
        const Ctor = getAudioContextCtor()
        if (!Ctor) return
        try {
            const ctx = new Ctor()
            audioCtxRef.current = ctx
            const source = ctx.createMediaStreamSource(stream)
            const analyser = ctx.createAnalyser()
            // 512-point FFT: enough spectral detail for a voice waveform without much cost.
            analyser.fftSize = 512
            analyser.smoothingTimeConstant = 0.7
            source.connect(analyser)
            analyserRef.current = analyser
        } catch {
            // Metering is a nicety — recording still works without it.
        }
    }, [])

    const start = useCallback(() => {
        if (!supported || recRef.current) return
        setError(null)
        cancelledRef.current = false
        erroredRef.current = false
        setStatus("requesting")
        navigator.mediaDevices
            .getUserMedia({audio: true})
            .then((stream) => {
                // Cancelled while the permission was still pending: the prompt can only be
                // answered by the person, so honour their cancel by dropping the stream the
                // moment it arrives rather than starting a recording they backed out of.
                if (cancelledRef.current) {
                    stream.getTracks().forEach((t) => t.stop())
                    return
                }
                streamRef.current = stream
                const mime = pickMime()
                // Pin the bitrate: the default is unspecified, and a full-length take at a high
                // one lands near the per-file attachment cap — which would reject (and destroy)
                // the recording at the very end. 64kbps is ample for voice: ~2.4MB at the 5min cap.
                const rec = new MediaRecorder(stream, {
                    ...(mime ? {mimeType: mime} : {}),
                    audioBitsPerSecond: 64_000,
                })
                chunksRef.current = []
                rec.ondataavailable = (e) => {
                    if (e.data.size) chunksRef.current.push(e.data)
                }
                rec.onerror = () => {
                    erroredRef.current = true
                    teardown()
                    setStatus("error")
                    setError("Recording error")
                }
                rec.onstop = () => {
                    // Errored take: onerror already tore down and set the error status. Leave both as-is
                    // and never emit the partial chunks.
                    if (erroredRef.current) return
                    const type = rec.mimeType || mime || "audio/webm"
                    const discard = cancelledRef.current
                    const tooShort = Date.now() - startedAtRef.current < MIN_RECORDING_MS
                    teardown()
                    setStatus("idle")
                    if (discard || tooShort) return
                    const blob = new Blob(chunksRef.current, {type})
                    if (blob.size === 0) return
                    onCompleteRef.current(
                        new File([blob], `Voice message.${extForMime(type)}`, {type}),
                    )
                }
                recRef.current = rec
                startedAtRef.current = Date.now()
                setStatus("recording")
                meter(stream)
                // One deadline instead of polling; auto-stops and keeps at the cap.
                capTimerRef.current = window.setTimeout(() => rec.stop(), MAX_RECORDING_MS)
                rec.start()
            })
            .catch((e: unknown) => {
                teardown()
                // Backed out before answering — not a failure worth reporting.
                if (cancelledRef.current) return
                const denied = e instanceof DOMException && e.name === "NotAllowedError"
                if (!denied) {
                    setStatus("error")
                    setError("Could not start recording.")
                    return
                }
                // Chrome rejects identically whether the prompt was BLOCKED or merely dismissed,
                // so ask the permission store which it was — telling someone to go change browser
                // settings when they could simply try again is a dead end.
                setStatus("denied")
                setError(BLOCKED_MESSAGE)
                micPermissionState().then((state) => {
                    if (state === "prompt") setError(DISMISSED_MESSAGE)
                })
            })
    }, [supported, teardown, meter])

    const stop = useCallback(() => recRef.current?.stop(), [])
    const cancel = useCallback(() => {
        cancelledRef.current = true
        if (recRef.current) {
            recRef.current.stop() // `onstop` sees the flag and discards the take
            return
        }
        // Still waiting on the permission: there is no recorder to stop, so return to idle now.
        // The pending `getUserMedia` resolves into a no-op (see `start`).
        teardown()
        setStatus("idle")
    }, [teardown])
    const dismissError = useCallback(() => {
        setError(null)
        setStatus("idle")
    }, [])

    useEffect(
        () => () => {
            cancelledRef.current = true
            recRef.current?.stop()
            teardown()
        },
        [teardown],
    )

    return {
        supported,
        status,
        active: status === "requesting" || status === "recording",
        // Only once actually capturing. While the permission prompt is up the BROWSER owns the
        // interaction — a page cannot dismiss that prompt, so covering the composer with our own
        // chrome (and a cancel button that cannot cancel it) would only compete with it.
        takeoverVisible: status === "recording",
        pending: status === "requesting",
        analyserRef,
        startedAtRef,
        error,
        start,
        stop,
        cancel,
        dismissError,
    }
}
