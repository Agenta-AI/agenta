import {useEffect} from "react"

import {Check, X} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"

import {type AudioRecorder, MAX_RECORDING_MS} from "../hooks/useAudioRecorder"

const mmss = (ms: number): string => {
    const s = Math.floor(ms / 1000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

// Fixed level bars; each lights once the smoothed input level crosses its threshold.
const BAR_THRESHOLDS = [0.08, 0.16, 0.26, 0.38, 0.52, 0.68, 0.85]

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
            // Red reads as "live", so it only appears once we are actually capturing — waiting on
            // the mic is a neutral state, not an error.
            className={`pointer-events-auto flex h-full items-center gap-3 rounded-xl border border-solid ${
                requesting ? "border-colorBorder" : "border-colorError"
            } bg-colorBgContainer px-3 shadow-sm ${className ?? ""}`}
        >
            <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                {requesting ? (
                    <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-colorTextTertiary" />
                ) : (
                    <>
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-colorError opacity-60" />
                        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-colorError" />
                    </>
                )}
            </span>

            {requesting ? (
                <span className="text-xs text-colorTextSecondary">
                    Allow microphone access to start recording
                </span>
            ) : (
                <>
                    <span
                        className={`text-xs tabular-nums ${
                            nearLimit ? "text-colorError" : "text-colorText"
                        }`}
                    >
                        {mmss(elapsedMs)}
                    </span>
                    <div className="flex flex-1 items-center gap-0.5" aria-hidden>
                        {BAR_THRESHOLDS.map((threshold, i) => (
                            <span
                                key={i}
                                className="w-0.5 rounded-full bg-colorError transition-opacity duration-100"
                                style={{
                                    height: `${6 + i * 2}px`,
                                    opacity: level >= threshold ? 1 : 0.2,
                                }}
                            />
                        ))}
                    </div>
                    {nearLimit && (
                        <span className="text-[11px] text-colorError">{mmss(remaining)} left</span>
                    )}
                </>
            )}

            <div className="ml-auto flex shrink-0 items-center gap-1">
                <Tooltip title={requesting ? "Cancel" : "Delete recording (Esc)"}>
                    <Button
                        type="text"
                        icon={<X size={16} />}
                        onClick={cancel}
                        aria-label={requesting ? "Cancel" : "Delete recording"}
                    />
                </Tooltip>
                {!requesting && (
                    <Tooltip title="Attach to message">
                        <Button
                            type="primary"
                            shape="circle"
                            icon={<Check size={16} />}
                            onClick={stop}
                            aria-label="Stop recording and attach it"
                        />
                    </Tooltip>
                )}
            </div>
        </div>
    )
}

export default RecordingBar
