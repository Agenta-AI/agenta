import {useEffect, useRef, useState} from "react"

import {Pause, Play} from "@phosphor-icons/react"
import {Typography} from "antd"

const {Text} = Typography

const fmt = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00"
    const t = Math.floor(seconds)
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`
}

/**
 * Inline player for an audio attachment. A voice message should be playable wherever it appears —
 * in the composer tray before sending, and in the transcript afterwards — so both surfaces share
 * this rather than showing an inert file chip.
 */
const AudioPlayer = ({src, name, className}: {src: string; name: string; className?: string}) => {
    const audioRef = useRef<HTMLAudioElement>(null)
    // True while we nudge the element to resolve an unknown duration (below); the seek would
    // otherwise show up as a wild current-time reading.
    const probingRef = useRef(false)
    const [playing, setPlaying] = useState(false)
    const [current, setCurrent] = useState(0)
    const [duration, setDuration] = useState(0)

    useEffect(() => {
        const el = audioRef.current
        if (!el) return

        const onPlay = () => setPlaying(true)
        const onPause = () => setPlaying(false)
        const onEnded = () => {
            setPlaying(false)
            setCurrent(0)
        }
        const onTimeUpdate = () => {
            if (!probingRef.current) setCurrent(el.currentTime)
        }
        const finishProbe = () => {
            el.removeEventListener("timeupdate", finishProbe)
            if (Number.isFinite(el.duration)) setDuration(el.duration)
            probingRef.current = false
            el.currentTime = 0
            setCurrent(0)
        }
        const onLoadedMetadata = () => {
            if (Number.isFinite(el.duration)) {
                setDuration(el.duration)
                return
            }
            // A MediaRecorder webm reports an infinite duration until it has been seeked to the
            // end — so send it there once and read the real value back.
            probingRef.current = true
            el.addEventListener("timeupdate", finishProbe)
            el.currentTime = 1e101
        }

        el.addEventListener("play", onPlay)
        el.addEventListener("pause", onPause)
        el.addEventListener("ended", onEnded)
        el.addEventListener("timeupdate", onTimeUpdate)
        el.addEventListener("loadedmetadata", onLoadedMetadata)
        return () => {
            el.removeEventListener("play", onPlay)
            el.removeEventListener("pause", onPause)
            el.removeEventListener("ended", onEnded)
            el.removeEventListener("timeupdate", onTimeUpdate)
            el.removeEventListener("loadedmetadata", onLoadedMetadata)
            el.removeEventListener("timeupdate", finishProbe)
        }
    }, [src])

    const toggle = () => {
        const el = audioRef.current
        if (!el) return
        if (el.paused) el.play().catch(() => {})
        else el.pause()
    }

    const progress = duration > 0 ? Math.min(1, current / duration) : 0

    return (
        <div className={`flex items-center gap-2 ${className ?? ""}`}>
            <button
                type="button"
                onClick={toggle}
                aria-label={playing ? `Pause ${name}` : `Play ${name}`}
                className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-colorFillTertiary text-colorText transition-colors hover:bg-colorFillSecondary"
            >
                {playing ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />}
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Text className="!text-xs truncate" title={name}>
                    {name}
                </Text>
                <div className="h-0.5 w-full overflow-hidden rounded-full bg-colorFillTertiary">
                    <div
                        className="h-full rounded-full bg-colorPrimary"
                        style={{width: `${progress * 100}%`}}
                    />
                </div>
            </div>
            <Text type="secondary" className="!text-[11px] shrink-0 tabular-nums">
                {fmt(current)}
                {duration > 0 ? ` / ${fmt(duration)}` : ""}
            </Text>
            <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
        </div>
    )
}

export default AudioPlayer
