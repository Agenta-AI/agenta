import {useEffect, useState} from "react"

import {isOverlayOpen} from "@agenta/shared/utils"
import {ComposerSendButton} from "@agenta/ui/rich-chat-input"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {Check, X} from "@phosphor-icons/react"
import {AnimatePresence, motion} from "motion/react"

import {SESSION_SPRING} from "../assets/motion"
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
const RecordingBar = ({
    recorder,
    willSend,
    className,
}: {
    recorder: AudioRecorder
    /** Confirm sends the take outright (nothing else composed) rather than parking it in the tray. */
    willSend: boolean
    className?: string
}) => {
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
            // Something on top owns the keyboard. Both halves are load-bearing: Radix cancels
            // Escape for a dialog, menu or popover but still lets it reach us, and an antd modal
            // cancels nothing, so only the overlay check sees that one.
            if (e.defaultPrevented || isOverlayOpen()) return
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
            //
            // Brand, not error: an error border is the form-validation signal, and nothing here is
            // invalid. Red is reserved for the record light alone.
            className={`pointer-events-auto flex h-full items-center gap-4 rounded-lg border border-solid border-colorPrimary bg-[var(--ag-colorBgContainer)] px-4 shadow-[var(--ag-surface-chat-shadow)] ${className ?? ""}`}
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

            <RecordingWaveform analyserRef={analyserRef} className="flex-1 text-colorPrimary" />

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
                <SimpleTooltip title="Delete recording (Esc)">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={cancel}
                        aria-label="Delete recording"
                    >
                        <X size={18} />
                    </Button>
                </SimpleTooltip>
                <motion.div
                    initial={{opacity: 0, scale: 0.8}}
                    animate={{opacity: 1, scale: 1}}
                    transition={SESSION_SPRING}
                >
                    <SimpleTooltip title={willSend ? "Send voice message" : "Attach to message"}>
                        {/* The composer's own send control — sending is one affordance, wherever
                        it is triggered from. Only the glyph changes when the take is being
                        attached to a message in progress rather than sent outright. */}
                        <ComposerSendButton
                            onClick={stop}
                            icon={willSend ? undefined : <Check size={16} weight="bold" />}
                            ariaLabel={
                                willSend
                                    ? "Stop recording and send the voice message"
                                    : "Stop recording and attach it to the message"
                            }
                        />
                    </SimpleTooltip>
                </motion.div>
            </div>
        </div>
    )
}

export default RecordingBar
