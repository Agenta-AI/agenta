import {useEffect, useRef, useState} from "react"

import {
    ArrowClockwise,
    DownloadSimple,
    ImageBroken,
    Pause,
    Play,
    WarningCircle,
    X,
} from "@phosphor-icons/react"

import {typeBadgeFor} from "../assets/attachmentRules"

/** One height for every card: uniformity is what lets the grid wrap without ragged rows. */
const CARD_HEIGHT = "h-11"

/** Leading square — thumbnail, play control or type badge — always the same box. */
const TILE = "h-8 w-8 shrink-0 rounded-md"

export type AttachmentCardState = "idle" | "uploading" | "error"

/** What sits at the card's trailing edge. The composer removes; a sent message downloads. */
export type AttachmentCardAction = "remove" | "download" | "none"

export interface AttachmentCardProps {
    name: string
    mediaType: string
    /** Thumbnail for images and the source for audio playback; absent while it resolves. */
    src?: string
    state?: AttachmentCardState
    /** 0-100, drawn as a bar along the bottom edge while `state` is "uploading". */
    progress?: number
    /** Replaces the filename when `state` is "error" — "too large", "upload failed". */
    errorReason?: string
    action?: AttachmentCardAction
    onRemove?: () => void
    onDownload?: () => void
    /** Re-run a failed upload. Rejections never had one, so they pass nothing. */
    onRetry?: () => void
    /** Opens the attachment in a viewer. Audio never uses this: it plays in place. */
    onView?: () => void
    className?: string
}

/** Trailing control, a sibling of the view surface: a button inside a button is unreachable. */
const CardAction = ({
    action,
    name,
    onRemove,
    onDownload,
}: Pick<AttachmentCardProps, "action" | "name" | "onRemove" | "onDownload">) => {
    if (action === "remove" && onRemove) {
        return (
            <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={(e) => {
                    e.stopPropagation()
                    onRemove()
                }}
                className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-colorTextTertiary transition-colors hover:bg-colorFillTertiary hover:text-colorText"
            >
                <X size={11} weight="bold" />
            </button>
        )
    }
    if (action === "download" && onDownload) {
        return (
            <button
                type="button"
                aria-label={`Download ${name}`}
                onClick={(e) => {
                    e.stopPropagation()
                    onDownload()
                }}
                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-colorTextTertiary opacity-0 transition-opacity hover:bg-colorFillTertiary hover:text-colorText focus-visible:opacity-100 group-hover:opacity-100"
            >
                <DownloadSimple size={13} />
            </button>
        )
    }
    return null
}

/** Play/pause only — a transport bar would not fit a one-row card. */
const AudioTile = ({src, name}: {src?: string; name: string}) => {
    const ref = useRef<HTMLAudioElement>(null)
    const [playing, setPlaying] = useState(false)

    useEffect(() => {
        const el = ref.current
        if (!el) return
        const onPlay = () => setPlaying(true)
        const onStop = () => setPlaying(false)
        el.addEventListener("play", onPlay)
        el.addEventListener("pause", onStop)
        el.addEventListener("ended", onStop)
        return () => {
            el.removeEventListener("play", onPlay)
            el.removeEventListener("pause", onStop)
            el.removeEventListener("ended", onStop)
        }
    }, [])

    return (
        <>
            <button
                type="button"
                disabled={!src}
                aria-label={`${playing ? "Pause" : "Play"} ${name}`}
                onClick={(e) => {
                    e.stopPropagation()
                    const el = ref.current
                    if (!el) return
                    if (el.paused) void el.play()
                    else el.pause()
                }}
                className={`flex ${TILE} items-center justify-center border-0 bg-colorFillTertiary p-0 text-colorTextSecondary transition-colors ${src ? "cursor-pointer hover:text-colorText" : "cursor-default opacity-50"}`}
            >
                {playing ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />}
            </button>
            {src && <audio ref={ref} src={src} preload="none" className="hidden" />}
        </>
    )
}

/**
 * One attachment, drawn the same way staged in the composer or replayed on a sent message; only
 * the trailing control differs. Never fetches — callers pass `src` already resolved.
 */
export const AttachmentCard = ({
    name,
    mediaType,
    src,
    state = "idle",
    progress = 0,
    errorReason,
    action = "none",
    onRemove,
    onDownload,
    onRetry,
    onView,
    className,
}: AttachmentCardProps) => {
    const [thumbFailed, setThumbFailed] = useState(false)
    const isImage = mediaType.startsWith("image/")
    const isAudio = mediaType.startsWith("audio/") || mediaType.startsWith("video/")
    const failed = state === "error"

    // A failed card drops its view and playback affordances — only dismissal is left.
    const tile = failed ? (
        <div className={`flex ${TILE} items-center justify-center bg-colorErrorBg text-colorError`}>
            <WarningCircle size={18} weight="fill" />
        </div>
    ) : isAudio ? (
        <AudioTile src={src} name={name} />
    ) : isImage && src && !thumbFailed ? (
        // A blob or cookie-authenticated URL — next/image can optimize neither.
        <img
            src={src}
            alt={name}
            onError={() => setThumbFailed(true)}
            className={`${TILE} border border-solid border-colorBorderSecondary object-cover`}
        />
    ) : isImage ? (
        <div
            className={`flex ${TILE} items-center justify-center bg-colorFillTertiary text-colorTextTertiary`}
        >
            <ImageBroken size={16} />
        </div>
    ) : (
        <div
            className={`flex ${TILE} items-center justify-center bg-colorFillTertiary px-0.5 text-[10px] font-semibold uppercase leading-none text-colorTextSecondary`}
        >
            {typeBadgeFor(mediaType, name)}
        </div>
    )

    const label = (
        <span
            className={`min-w-0 flex-1 truncate text-left text-sm ${failed ? "text-colorError" : "text-colorText"}`}
            title={failed ? `${name} · ${errorReason}` : name}
        >
            {failed ? (
                <>
                    {name} <span className="opacity-70">· {errorReason}</span>
                </>
            ) : (
                name
            )}
        </span>
    )

    return (
        <div
            className={`group relative box-border flex ${CARD_HEIGHT} items-center gap-2.5 overflow-hidden rounded-lg border border-solid px-2 ${
                failed
                    ? "border-colorErrorBorder bg-colorErrorBg"
                    : "border-colorBorderSecondary bg-colorFillQuaternary"
            } ${className ?? ""}`}
        >
            {tile}
            {/* A real button only when there is somewhere to go, an inert span otherwise. */}
            {onView && !failed ? (
                <button
                    type="button"
                    aria-label={`View ${name}`}
                    onClick={onView}
                    className="flex min-w-0 flex-1 cursor-pointer items-center border-0 bg-transparent p-0"
                >
                    {label}
                </button>
            ) : (
                label
            )}
            {failed && onRetry && (
                <button
                    type="button"
                    aria-label={`Retry ${name}`}
                    onClick={(e) => {
                        e.stopPropagation()
                        onRetry()
                    }}
                    className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-colorError transition-colors hover:bg-colorErrorBgHover"
                >
                    <ArrowClockwise size={12} weight="bold" />
                </button>
            )}
            <CardAction action={action} name={name} onRemove={onRemove} onDownload={onDownload} />
            {state === "uploading" && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-colorFillSecondary">
                    <div
                        className="h-full bg-colorPrimary transition-[width] duration-150"
                        style={{width: `${Math.max(0, Math.min(100, Math.round(progress)))}%`}}
                    />
                </div>
            )}
        </div>
    )
}

export default AttachmentCard
