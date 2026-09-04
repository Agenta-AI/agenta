import {useCallback, useEffect, useRef, useState} from "react"

/**
 * Voice-to-text for the composer via the browser Web Speech API. Transcribes to plain text, so it
 * is independent of any model/audio capability — the composer receives words, not audio. Returns
 * `supported: false` where the API is absent (e.g. Firefox), so callers can hide the affordance.
 *
 * Committed words and the volatile tail are reported separately, so the editor can render the
 * provisional part distinctly instead of the caller flattening both into one string.
 *
 * The recogniser's own lifecycle is far slower and far less obedient than the button that drives
 * it: `start()` resolves on a later task, `stop()` only reports back once the browser has flushed a
 * trailing result and closed its speech socket (hundreds of ms, sometimes seconds), and a `start()`
 * issued inside that teardown throws. So INTENT is the source of truth here — {@link
 * VoiceInput.recording} flips the instant the person presses the mic, and the session is driven
 * towards that intent underneath, queueing a start across a teardown and reviving a session the
 * browser ended on its own. Reading the browser's events as the state instead is what strands the
 * mic latched-on after a stop, and silently drops a whole utterance spoken into a dead session.
 */

// Minimal shapes for the bits of the Web Speech API we touch (not in the DOM lib types).
interface SpeechAlternative {
    transcript: string
}
interface SpeechResult {
    isFinal: boolean
    0: SpeechAlternative
}
interface SpeechRecognitionEventLike {
    resultIndex: number
    results: ArrayLike<SpeechResult>
}
interface SpeechRecognitionLike {
    continuous: boolean
    interimResults: boolean
    lang: string
    onstart: (() => void) | null
    onresult: ((e: SpeechRecognitionEventLike) => void) | null
    onerror: ((e: {error: string}) => void) | null
    onend: (() => void) | null
    start: () => void
    stop: () => void
    abort: () => void
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

/** Gap before retrying a `start()` the browser refused while closing the last session. */
const RELAUNCH_DELAY_MS = 150
/** Consecutive failures to get a session open before giving up; reset by every one that starts. */
const MAX_RELAUNCH_ATTEMPTS = 10

const getRecognitionCtor = (): SpeechRecognitionCtor | undefined => {
    if (typeof window === "undefined") return undefined
    const w = window as unknown as {
        SpeechRecognition?: SpeechRecognitionCtor
        webkitSpeechRecognition?: SpeechRecognitionCtor
    }
    return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

export interface VoiceInput {
    supported: boolean
    /** What the person asked for. Flips synchronously on {@link start}/{@link stop}, so the mic
     * never reads as still-recording while the browser takes its time closing the session. */
    recording: boolean
    /**
     * Whether a recogniser session is still open. Trails {@link recording} through the browser's
     * teardown, where a last final result can still land — so the editor's dictation session
     * follows THIS, not `recording`, or those trailing words are dropped.
     */
    active: boolean
    /** Words the recogniser has settled on this session. */
    finalText: string
    /** The volatile tail it is still revising — rendered distinctly by the editor. */
    interimText: string
    error: string | null
    /** Opens a session; returns false when one is already open, so the caller can avoid opening a
     * second editor session over a recogniser that never restarted. */
    start: () => boolean
    stop: () => void
    reset: () => void
}

export function useVoiceInput(): VoiceInput {
    const ctorRef = useRef<SpeechRecognitionCtor | undefined>(undefined)
    if (ctorRef.current === undefined) ctorRef.current = getRecognitionCtor()
    const supported = !!ctorRef.current

    const [recording, setRecording] = useState(false)
    const [active, setActive] = useState(false)
    const [transcript, setTranscript] = useState({finalText: "", interimText: ""})
    const [error, setError] = useState<string | null>(null)

    const recRef = useRef<SpeechRecognitionLike | null>(null)
    const finalRef = useRef("")
    /** The person's intent, read by every callback below. The recogniser's events lag it. */
    const wantRef = useRef(false)
    const relaunchTimerRef = useRef<number | undefined>(undefined)
    const attemptsRef = useRef(0)
    /** Breaks the launch ⇄ relaunch cycle without re-creating either callback. */
    const launchRef = useRef<() => void>(() => {})

    const clearRelaunch = useCallback(() => {
        window.clearTimeout(relaunchTimerRef.current)
        relaunchTimerRef.current = undefined
    }, [])

    /** Retry on a later task — the only moment the browser accepts a `start()` after a close. */
    const relaunch = useCallback(() => {
        if (!wantRef.current) return
        clearRelaunch()
        if (attemptsRef.current >= MAX_RELAUNCH_ATTEMPTS) {
            wantRef.current = false
            setRecording(false)
            setActive(false)
            setError("Voice input stopped unexpectedly")
            return
        }
        attemptsRef.current += 1
        relaunchTimerRef.current = window.setTimeout(() => launchRef.current(), RELAUNCH_DELAY_MS)
    }, [clearRelaunch])

    const launch = useCallback(() => {
        const Ctor = ctorRef.current
        // A session the browser has not finished closing owns the mic. Its `onend` calls back here.
        if (!Ctor || !wantRef.current || recRef.current) return

        const rec = new Ctor()
        rec.continuous = true
        rec.interimResults = true
        rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US"

        // The retry budget is for getting STARTED, not for the silence-restarts that follow.
        rec.onstart = () => {
            attemptsRef.current = 0
            setActive(true)
        }

        rec.onresult = (e) => {
            let interim = ""
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const result = e.results[i]
                const text = result[0].transcript.trim()
                if (result.isFinal) {
                    finalRef.current += (finalRef.current ? " " : "") + text
                } else {
                    interim += result[0].transcript
                }
            }
            setTranscript({finalText: finalRef.current, interimText: interim.trim()})
        }

        rec.onerror = (e) => {
            // Ordinary punctuation in a long dictation; `onend` follows and decides what's next.
            if (e.error === "no-speech" || e.error === "aborted") return
            wantRef.current = false
            clearRelaunch()
            setRecording(false)
            setError(e.error === "not-allowed" ? "Microphone access denied" : "Voice input error")
        }

        rec.onend = () => {
            if (recRef.current === rec) recRef.current = null
            if (!wantRef.current) {
                setActive(false)
                return
            }
            // Chrome ends on silence even with `continuous`, and a queued start waits here too.
            relaunch()
        }

        recRef.current = rec
        try {
            rec.start()
        } catch {
            // Refused mid-teardown — retry rather than drop dictation with the mic still lit.
            recRef.current = null
            relaunch()
        }
    }, [clearRelaunch, relaunch])
    launchRef.current = launch

    const reset = useCallback(() => {
        finalRef.current = ""
        setTranscript({finalText: "", interimText: ""})
        setError(null)
    }, [])

    const start = useCallback(() => {
        if (!ctorRef.current || wantRef.current) return false
        wantRef.current = true
        attemptsRef.current = 0
        setError(null)
        finalRef.current = ""
        setTranscript({finalText: "", interimText: ""})
        // Intent, not the recogniser's `onstart` — the control must latch on the press.
        setRecording(true)
        setActive(true)
        launch()
        return true
    }, [launch])

    const stop = useCallback(() => {
        if (!wantRef.current) return
        wantRef.current = false
        clearRelaunch()
        // Unlatch now; `active` holds until `onend` so the trailing final result still lands.
        setRecording(false)
        if (recRef.current) recRef.current.stop()
        else setActive(false)
    }, [clearRelaunch])

    useEffect(
        () => () => {
            wantRef.current = false
            window.clearTimeout(relaunchTimerRef.current)
            recRef.current?.abort()
        },
        [],
    )

    return {
        supported,
        recording,
        active,
        finalText: transcript.finalText,
        interimText: transcript.interimText,
        error,
        start,
        stop,
        reset,
    }
}
