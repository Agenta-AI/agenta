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
const CARD_HEIGHT = "h-9"

/** Leading square — thumbnail, play control or type badge — always the same box. */
const TILE = "h-6 w-6 shrink-0 rounded"

export type AttachmentCardState = "idle" | "uploading" | "error"

/** What sits at the card's trailing edge. The composer removes; a sent message downloads. */
export type AttachmentCardAction = "remove" | "download" | "none"

export interface AttachmentCardProps {
    name: string
    mediaType: string
    /** Thumbnail for images and the source for audio playback; absent while it resolves. */
    src?: string
    /** The source is still resolving — show a placeholder rather than a broken thumbnail. */
    loading?: boolean
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
                className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-colorTextTertiary transition-colors hover:bg-colorFillTertiary hover:text-colorText"
            >
                <X size={10} weight="bold" />
            </button>
        )
    }
    // Revealed on hover of THIS card only: the turn row is itself a bare `group`, so an unnamed
    // group-hover lit up every card in the message at once. Hidden only where hovering exists.
    if (action === "download" && onDownload) {
        return (
            <button
                type="button"
                aria-label={`Download ${name}`}
                onClick={(e) => {
                    e.stopPropagation()
                    onDownload()
                }}
                className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-colorTextTertiary transition-opacity hover:bg-colorFillTertiary hover:text-colorText focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/attachment:opacity-100"
            >
                <DownloadSimple size={12} />
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
                {playing ? <Pause size={11} weight="fill" /> : <Play size={11} weight="fill" />}
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
    loading = false,
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
    // A fresh source deserves a fresh attempt; without this the fallback sticks for the life of
    // the card even after a good URL replaces the one that failed to decode.
    useEffect(() => setThumbFailed(false), [src])
    const isImage = mediaType.startsWith("image/")
    const isAudio = mediaType.startsWith("audio/")
    // Video gets the same play affordance but opens in the viewer — an <audio> element would
    // give it sound and no picture.
    const isVideo = mediaType.startsWith("video/")
    const failed = state === "error"

    // A failed card drops its view and playback affordances — only dismissal is left.
    const tile = failed ? (
        // Bare icon, no tile box: its background is the card's own, so a 32px square would be
        // invisible and would only push the reason away from the icon that introduces it.
        <WarningCircle size={16} weight="fill" className="ml-1 shrink-0 text-colorError" />
    ) : loading ? (
        <div className={`${TILE} animate-pulse bg-colorFillTertiary`} />
    ) : isAudio ? (
        <AudioTile src={src} name={name} />
    ) : isVideo ? (
        <div
            className={`flex ${TILE} items-center justify-center bg-colorFillTertiary text-colorTextSecondary`}
        >
            <Play size={11} weight="fill" />
        </div>
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
            <ImageBroken size={13} />
        </div>
    ) : (
        <div
            className={`flex ${TILE} items-center justify-center bg-colorFillTertiary px-0.5 text-[8px] font-semibold uppercase leading-none text-colorTextSecondary`}
        >
            {typeBadgeFor(mediaType, name)}
        </div>
    )

    // A failure stacks its two facts instead of running them together: at one column wide a
    // single line truncated the reason away, which is the only part worth reading.
    const label = failed ? (
        <span
            className="flex min-w-0 flex-1 flex-col justify-center text-left leading-tight"
            title={`${name} · ${errorReason}`}
        >
            <span className="truncate text-[12px] text-colorError">{name}</span>
            <span className="truncate text-[10px] text-colorError opacity-70">{errorReason}</span>
        </span>
    ) : (
        <span className="min-w-0 flex-1 truncate text-left text-[13px] text-colorText" title={name}>
            {name}
        </span>
    )

    return (
        <div
            className={`group/attachment relative box-border flex ${CARD_HEIGHT} items-center gap-2 overflow-hidden rounded-md border border-solid px-1.5 ${
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
                    className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-colorError transition-colors hover:bg-colorErrorBgHover"
                >
                    <ArrowClockwise size={11} weight="bold" />
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
