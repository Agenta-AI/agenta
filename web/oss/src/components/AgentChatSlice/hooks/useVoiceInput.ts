import {useCallback, useEffect, useRef, useState} from "react"

/**
 * Voice-to-text for the composer via the browser Web Speech API. Transcribes to plain text, so it
 * is independent of any model/audio capability — the composer receives words, not audio. Returns
 * `supported: false` where the API is absent (e.g. Firefox), so callers can hide the affordance.
 *
 * `liveText` is the running transcript for the active session (finalized words + the current
 * interim guess), so a caller can stream it into the editor as the person speaks.
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
    onresult: ((e: SpeechRecognitionEventLike) => void) | null
    onerror: ((e: {error: string}) => void) | null
    onend: (() => void) | null
    start: () => void
    stop: () => void
    abort: () => void
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

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
    recording: boolean
    /** Finalized words + the current interim guess for the active session. */
    liveText: string
    error: string | null
    start: () => void
    stop: () => void
    reset: () => void
}

export function useVoiceInput(): VoiceInput {
    const ctorRef = useRef<SpeechRecognitionCtor | undefined>(undefined)
    if (ctorRef.current === undefined) ctorRef.current = getRecognitionCtor()
    const supported = !!ctorRef.current

    const [recording, setRecording] = useState(false)
    const [liveText, setLiveText] = useState("")
    const [error, setError] = useState<string | null>(null)

    const recRef = useRef<SpeechRecognitionLike | null>(null)
    const finalRef = useRef("")
    // Chrome auto-ends on silence; we restart until the person actually stops.
    const stoppingRef = useRef(false)

    const reset = useCallback(() => {
        finalRef.current = ""
        setLiveText("")
        setError(null)
    }, [])

    const stop = useCallback(() => {
        stoppingRef.current = true
        recRef.current?.stop()
    }, [])

    const start = useCallback(() => {
        const Ctor = ctorRef.current
        if (!Ctor || recRef.current) return
        setError(null)
        finalRef.current = ""
        setLiveText("")
        stoppingRef.current = false

        const rec = new Ctor()
        rec.continuous = true
        rec.interimResults = true
        rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US"

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
            setLiveText((finalRef.current + " " + interim).trim())
        }
        rec.onerror = (e) => {
            if (e.error === "no-speech" || e.error === "aborted") return
            setError(e.error === "not-allowed" ? "Microphone access denied" : "Voice input error")
            stoppingRef.current = true
        }
        rec.onend = () => {
            if (stoppingRef.current) {
                recRef.current = null
                setRecording(false)
                return
            }
            try {
                rec.start()
            } catch {
                recRef.current = null
                setRecording(false)
            }
        }

        recRef.current = rec
        try {
            rec.start()
            setRecording(true)
        } catch {
            recRef.current = null
        }
    }, [])

    useEffect(
        () => () => {
            stoppingRef.current = true
            recRef.current?.abort()
        },
        [],
    )

    return {supported, recording, liveText, error, start, stop, reset}
}
