import {useEffect} from "react"

import {Check, X} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {AnimatePresence, motion} from "motion/react"

import {SESSION_SPRING} from "../assets/sessionMotion"
import {type AudioRecorder, MAX_RECORDING_MS} from "../hooks/useAudioRecorder"

const mmss = (ms: number): string => {
    const s = Math.floor(ms / 1000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

// Fixed level bars; each lights once the smoothed input level crosses its threshold.
const BAR_THRESHOLDS = [0.08, 0.16, 0.26, 0.38, 0.52, 0.68, 0.85]

/** Content swap (waiting → capturing) is a wait-mode crossfade so one label never overlaps the other. */
const FADE = {initial: {opacity: 0}, animate: {opacity: 1}, exit: {opacity: 0}}
const FADE_TRANSITION = {duration: 0.15}

/** The composer's recording takeover: shown over the input while a voice message is captured.
 * Live timer + input-level meter, with discard (cancel) and stop-&-attach (keep) exits. */
const RecordingBar = ({recorder, className}: {recorder: AudioRecorder; className?: string}) => {
    const {status, elapsedMs, level, stop, cancel} = recorder
    const requesting = status === "requesting"
    const remaining = Math.max(0, MAX_RECORDING_MS - elapsedMs)
    const nearLimit = !requesting && remaining <= 30_000

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
            // composer's corners poking out from under this one mid-transition. Red reads as
            // "live", so it only eases in once we are actually capturing.
            className={`pointer-events-auto flex h-full items-center gap-4 rounded-lg border border-solid bg-[var(--ag-colorBgContainer)] px-4 shadow-[var(--ag-surface-chat-shadow)] transition-colors duration-300 ${
                requesting ? "border-[var(--ag-composer-border)]" : "border-colorError"
            } ${className ?? ""}`}
        >
            <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
                <AnimatePresence initial={false}>
                    {!requesting && (
                        <motion.span
                            key="ping"
                            initial={{opacity: 0}}
                            animate={{opacity: 0.6}}
                            exit={{opacity: 0}}
                            className="absolute inline-flex h-full w-full animate-ping rounded-full bg-colorError"
                        />
                    )}
                </AnimatePresence>
                <span
                    className={`inline-flex h-3 w-3 rounded-full transition-colors duration-300 ${
                        requesting ? "animate-pulse bg-colorTextTertiary" : "bg-colorError"
                    }`}
                />
            </span>

            <AnimatePresence mode="wait" initial={false}>
                {requesting ? (
                    <motion.span
                        key="waiting"
                        {...FADE}
                        transition={FADE_TRANSITION}
                        className="text-sm text-colorTextSecondary"
                    >
                        Allow microphone access to start recording
                    </motion.span>
                ) : (
                    <motion.div
                        key="capturing"
                        {...FADE}
                        transition={FADE_TRANSITION}
                        className="flex flex-1 items-center gap-3"
                    >
                        <span
                            className={`text-sm tabular-nums transition-colors duration-300 ${
                                nearLimit ? "text-colorError" : "text-colorText"
                            }`}
                        >
                            {mmss(elapsedMs)}
                        </span>
                        <div className="flex flex-1 items-center gap-1" aria-hidden>
                            {BAR_THRESHOLDS.map((threshold, i) => (
                                <span
                                    key={i}
                                    className="w-[3px] rounded-full bg-colorError transition-opacity duration-100"
                                    style={{
                                        height: `${8 + i * 3}px`,
                                        opacity: level >= threshold ? 1 : 0.2,
                                    }}
                                />
                            ))}
                        </div>
                        <AnimatePresence initial={false}>
                            {nearLimit && (
                                <motion.span
                                    key="left"
                                    {...FADE}
                                    transition={FADE_TRANSITION}
                                    className="text-xs text-colorError"
                                >
                                    {mmss(remaining)} left
                                </motion.span>
                            )}
                        </AnimatePresence>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="ml-auto flex shrink-0 items-center gap-1">
                <Tooltip title={requesting ? "Cancel" : "Delete recording (Esc)"}>
                    <Button
                        type="text"
                        icon={<X size={18} />}
                        onClick={cancel}
                        aria-label={requesting ? "Cancel" : "Delete recording"}
                    />
                </Tooltip>
                <AnimatePresence initial={false}>
                    {!requesting && (
                        <motion.div
                            key="attach"
                            initial={{opacity: 0, scale: 0.8}}
                            animate={{opacity: 1, scale: 1}}
                            exit={{opacity: 0, scale: 0.8}}
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
                    )}
                </AnimatePresence>
            </div>
        </div>
    )
}

export default RecordingBar
