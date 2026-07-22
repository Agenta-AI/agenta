import {useEffect, useState} from "react"

import {Check, X} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {AnimatePresence, motion} from "motion/react"

import {SESSION_SPRING} from "../assets/sessionMotion"
import {type AudioRecorder, MAX_RECORDING_MS} from "../hooks/useAudioRecorder"

const mmss = (totalSeconds: number): string =>
    `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`

// Fixed level bars; each lights once the smoothed input level crosses its threshold.
const BAR_THRESHOLDS = [0.08, 0.16, 0.26, 0.38, 0.52, 0.68, 0.85]
const MAX_SECONDS = Math.floor(MAX_RECORDING_MS / 1000)

/**
 * The composer's recording takeover, shown only while audio is actually being captured (awaiting
 * the mic permission is the browser's own prompt, so we stay out of its way). Live timer + input
 * level, with delete (discard) and attach (keep) exits.
 */
const RecordingBar = ({recorder, className}: {recorder: AudioRecorder; className?: string}) => {
    const {meterRef, stop, cancel} = recorder

    // One rAF drives both readouts, sampled here rather than in the recorder's owner: this is a
    // small component, so repainting it is cheap; the conversation is not.
    //
    // Both values are QUANTISED to what is actually visible — the meter is N discrete bars and the
    // clock ticks once a second — so a 60Hz loop only causes a render when a bar lights or the
    // second rolls over, not on every frame.
    const [{bars, seconds}, setReadout] = useState({bars: 0, seconds: 0})
    useEffect(() => {
        let raf = 0
        const tick = () => {
            const {level, startedAt} = meterRef.current
            const nextBars = BAR_THRESHOLDS.filter((t) => level >= t).length
            const nextSeconds = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0
            setReadout((prev) =>
                prev.bars === nextBars && prev.seconds === nextSeconds
                    ? prev
                    : {bars: nextBars, seconds: nextSeconds},
            )
            raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [meterRef])

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

            <div className="flex flex-1 items-center gap-1" aria-hidden>
                {BAR_THRESHOLDS.map((_, i) => (
                    <span
                        key={i}
                        className="w-[3px] rounded-full bg-colorError transition-opacity duration-100"
                        style={{height: `${8 + i * 3}px`, opacity: i < bars ? 1 : 0.2}}
                    />
                ))}
            </div>

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
