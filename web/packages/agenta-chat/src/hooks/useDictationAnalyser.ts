import {useEffect, useRef, type RefObject} from "react"

import {getAudioContextCtor} from "./audioContext"

/**
 * A live analyser for the voice being DICTATED, so the composer can draw it.
 *
 * Dictation runs on the Web Speech API, which hands back transcripts and no audio at all — there
 * is nothing in that pipeline to visualise. So this opens its own stream alongside the
 * recogniser's purely to be measured: an analyser and nothing else, no `MediaRecorder`, no chunks,
 * nothing captured or kept.
 *
 * The cost of that choice is a SECOND microphone consumer while dictating, and with it a second
 * OS/browser mic indicator. Held only for the length of a dictation and released the moment it
 * ends — a stream kept open between sessions would look like the app is always listening.
 *
 * Failure is silent by design. A refusal (denied, device busy, a platform that will not hand the
 * mic to two consumers) leaves `analyserRef` null and dictation working exactly as before. The
 * recogniser owns the permission conversation and has its own error channel; a second message
 * about a decoration would only add noise to it.
 */
export const useDictationAnalyser = (active: boolean): RefObject<AnalyserNode | null> => {
    const analyserRef = useRef<AnalyserNode | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const audioCtxRef = useRef<AudioContext | null>(null)

    useEffect(() => {
        if (!active) return
        // `getUserMedia` can resolve AFTER this effect is torn down — a dictation shorter than the
        // permission round-trip does exactly that — and the arriving stream would then never be
        // stopped, leaving the mic light on with nothing listening.
        let live = true

        const stop = () => {
            live = false
            analyserRef.current = null
            audioCtxRef.current?.close().catch(() => {})
            audioCtxRef.current = null
            streamRef.current?.getTracks().forEach((track) => track.stop())
            streamRef.current = null
        }

        if (!navigator.mediaDevices?.getUserMedia) return
        navigator.mediaDevices
            .getUserMedia({audio: true})
            .then((stream) => {
                if (!live) {
                    stream.getTracks().forEach((track) => track.stop())
                    return
                }
                streamRef.current = stream
                const Ctor = getAudioContextCtor()
                // Nothing can be measured without one, so the mic has no reason to stay open.
                if (!Ctor) {
                    stop()
                    return
                }
                const ctx = new Ctor()
                audioCtxRef.current = ctx
                const analyser = ctx.createAnalyser()
                // The same graph the recorder meters with, so both waves read alike.
                analyser.fftSize = 512
                analyser.smoothingTimeConstant = 0.7
                ctx.createMediaStreamSource(stream).connect(analyser)
                analyserRef.current = analyser
            })
            .catch(() => {
                // No wave; dictation is unaffected.
            })

        return stop
    }, [active])

    return analyserRef
}
