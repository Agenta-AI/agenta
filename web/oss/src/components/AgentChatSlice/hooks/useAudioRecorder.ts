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

/** Live capture readouts. Kept in a ref, NOT React state: they tick at animation-frame rate, and
 * this hook is owned by a very large component — putting them in state re-renders the whole
 * conversation 60x a second. `RecordingBar` samples this ref itself, so only it repaints. */
export interface AudioMeter {
    /** Smoothed input level 0–1. Best-effort: metering can fail without affecting capture. */
    level: number
    /** Capture start (epoch ms), 0 when idle. Elapsed is DERIVED from this by the meter UI, so the
     * clock never depends on a polling timer and cannot drift. */
    startedAt: number
}

export interface AudioRecorder {
    supported: boolean
    status: RecorderStatus
    /** True while requesting permission or recording. */
    active: boolean
    /**
     * Whether to show the recording takeover. Recording shows immediately; a pending permission
     * only shows once it is slow enough to be worth explaining — otherwise an instantly-resolved
     * request (already granted, or already denied) flashes the bar in and straight back out.
     */
    takeoverVisible: boolean
    /** Live level + elapsed, sampled by the meter UI (see `AudioMeter`). */
    meterRef: RefObject<AudioMeter>
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
    const meterRef = useRef<AudioMeter>({level: 0, startedAt: 0})

    const recRef = useRef<MediaRecorder | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const chunksRef = useRef<Blob[]>([])
    const startedAtRef = useRef(0)
    // Deadline for the hard cap. A timer, not rAF: rAF pauses in a background tab, which would
    // let a backgrounded recording run past the limit forever.
    const capTimerRef = useRef<number | undefined>(undefined)
    const rafRef = useRef<number | undefined>(undefined)
    const audioCtxRef = useRef<AudioContext | null>(null)
    const cancelledRef = useRef(false)
    const onCompleteRef = useRef(onComplete)
    onCompleteRef.current = onComplete

    const teardown = useCallback(() => {
        window.clearTimeout(capTimerRef.current)
        if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
        rafRef.current = undefined
        audioCtxRef.current?.close().catch(() => {})
        audioCtxRef.current = null
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        recRef.current = null
        meterRef.current = {level: 0, startedAt: 0}
    }, [])

    const meter = useCallback((stream: MediaStream) => {
        const Ctor = getAudioContextCtor()
        if (!Ctor) return
        try {
            const ctx = new Ctor()
            audioCtxRef.current = ctx
            const source = ctx.createMediaStreamSource(stream)
            const analyser = ctx.createAnalyser()
            analyser.fftSize = 256
            source.connect(analyser)
            const buf = new Uint8Array(analyser.frequencyBinCount)
            const tick = () => {
                analyser.getByteTimeDomainData(buf)
                let peak = 0
                for (const v of buf) peak = Math.max(peak, Math.abs(v - 128))
                // Smooth toward the new peak so the meter doesn't strobe. Ref write, no re-render.
                const prev = meterRef.current.level
                meterRef.current.level = prev * 0.6 + Math.min(1, peak / 90) * 0.4
                rafRef.current = requestAnimationFrame(tick)
            }
            rafRef.current = requestAnimationFrame(tick)
        } catch {
            // Metering is a nicety — recording still works without it.
        }
    }, [])

    const start = useCallback(() => {
        if (!supported || recRef.current) return
        setError(null)
        cancelledRef.current = false
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
                const rec = new MediaRecorder(stream, mime ? {mimeType: mime} : undefined)
                chunksRef.current = []
                rec.ondataavailable = (e) => {
                    if (e.data.size) chunksRef.current.push(e.data)
                }
                rec.onerror = () => {
                    teardown()
                    setStatus("error")
                    setError("Recording error")
                }
                rec.onstop = () => {
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
                meterRef.current = {level: 0, startedAt: startedAtRef.current}
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
                setStatus(denied ? "denied" : "error")
                setError(
                    denied
                        ? "Microphone access denied — enable it in your browser settings."
                        : "Could not start recording.",
                )
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

    // A permission request that resolves immediately (already granted, or already denied) would
    // otherwise flash the takeover in and straight back out. Only surface the waiting state once
    // it has actually lasted long enough to be worth explaining.
    const [requestingIsSlow, setRequestingIsSlow] = useState(false)
    useEffect(() => {
        if (status !== "requesting") {
            setRequestingIsSlow(false)
            return
        }
        const t = window.setTimeout(() => setRequestingIsSlow(true), 350)
        return () => window.clearTimeout(t)
    }, [status])

    return {
        supported,
        status,
        active: status === "requesting" || status === "recording",
        takeoverVisible: status === "recording" || (status === "requesting" && requestingIsSlow),
        meterRef,
        error,
        start,
        stop,
        cancel,
        dismissError,
    }
}
