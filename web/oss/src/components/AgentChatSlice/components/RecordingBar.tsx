import {useEffect, useState} from "react"

import {Check, X} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {AnimatePresence, motion} from "motion/react"

import {SESSION_SPRING} from "../assets/sessionMotion"
import {type AudioRecorder, MAX_RECORDING_MS} from "../hooks/useAudioRecorder"

import RecordingWaveform from "./RecordingWaveform"

const mmss = (totalSeconds: number): string =>
    `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`

const MAX_SECONDS = Math.floor(MAX_RECORDING_MS / 1000)

/**
 * The composer's recording takeover, shown only while audio is actually being captured (awaiting
 * the mic permission is the browser's own prompt, so we stay out of its way). Live timer + input
 * level, with delete (discard) and attach (keep) exits.
 */
const RecordingBar = ({recorder, className}: {recorder: AudioRecorder; className?: string}) => {
    const {analyserRef, startedAtRef, stop, cancel} = recorder

    // Only the clock lives in React, quantised to whole seconds — so this repaints ~1x/s. The
    // waveform draws itself straight to canvas and never renders.
    const [seconds, setSeconds] = useState(0)
    useEffect(() => {
        let raf = 0
        const tick = () => {
            const startedAt = startedAtRef.current
            const next = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0
            setSeconds((prev) => (prev === next ? prev : next))
            raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [startedAtRef])

    const remainingSeconds = Math.max(0, MAX_SECONDS - seconds)
    const nearLimit = remainingSeconds <= 30

    // Esc discards the take (standard for a modal capture).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault()
                cancel()
            }
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [cancel])

    return (
        <div
            role="status"
            aria-live="polite"
            // Matches the composer box exactly (radius / border token / bg / shadow) so the
            // cross-fade reads as the input changing state — a different radius leaves the
            // composer's corners poking out from under this one mid-transition.
            className={`pointer-events-auto flex h-full items-center gap-4 rounded-lg border border-solid border-colorError bg-[var(--ag-colorBgContainer)] px-4 shadow-[var(--ag-surface-chat-shadow)] ${className ?? ""}`}
        >
            <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-colorError opacity-60" />
                <span className="inline-flex h-3 w-3 rounded-full bg-colorError" />
            </span>

            <span
                className={`text-sm tabular-nums transition-colors duration-300 ${
                    nearLimit ? "text-colorError" : "text-colorText"
                }`}
            >
                {mmss(seconds)}
            </span>

            <RecordingWaveform analyserRef={analyserRef} className="flex-1 text-colorError" />

            <AnimatePresence initial={false}>
                {nearLimit && (
                    <motion.span
                        key="left"
                        initial={{opacity: 0}}
                        animate={{opacity: 1}}
                        exit={{opacity: 0}}
                        transition={{duration: 0.15}}
                        className="text-xs text-colorError"
                    >
                        {mmss(remainingSeconds)} left
                    </motion.span>
                )}
            </AnimatePresence>

            <div className="flex shrink-0 items-center gap-1">
                <Tooltip title="Delete recording (Esc)">
                    <Button
                        type="text"
                        icon={<X size={18} />}
                        onClick={cancel}
                        aria-label="Delete recording"
                    />
                </Tooltip>
                <motion.div
                    initial={{opacity: 0, scale: 0.8}}
                    animate={{opacity: 1, scale: 1}}
                    transition={SESSION_SPRING}
                >
                    <Tooltip title="Attach to message">
                        <Button
                            type="primary"
                            shape="circle"
                            icon={<Check size={18} />}
                            onClick={stop}
                            aria-label="Stop recording and attach it"
                        />
                    </Tooltip>
                </motion.div>
            </div>
        </div>
    )
}

export default RecordingBar
