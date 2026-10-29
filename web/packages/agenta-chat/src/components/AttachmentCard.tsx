import {useEffect, useState, type ReactNode} from "react"

import {DriveFileGlyph} from "@agenta/entity-ui/drive"
import {SimpleTooltip as Tooltip} from "@agenta/ui/ui"
import {
    ArrowClockwise,
    DownloadSimple,
    ImageBroken,
    Pause,
    Play,
    WarningCircle,
    X,
} from "@phosphor-icons/react"

import {
    ATTACHMENT_TILE as TILE,
    ATTACHMENT_TILE_FACE as FACE,
    AttachmentTileName as TileName,
} from "./attachmentTile"
import {useAudioPlayback} from "./useAudioPlayback"

/** Shown on hover or keyboard focus where hovering exists; always shown on touch. */
const CORNER_BUTTON =
    "absolute right-1 top-1 z-[1] flex size-5 cursor-pointer items-center justify-center rounded-sm border-0 bg-background/90 p-0 text-muted-foreground shadow-sm transition-[color,opacity] hover:text-foreground focus-visible:opacity-100 motion-reduce:transition-none [&_svg]:shrink-0 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/attachment:opacity-100 [@media(hover:hover)]:group-has-[:focus-visible]/attachment:opacity-100"

export type AttachmentCardState = "idle" | "uploading" | "error"

/** What sits in the tile's corner. The composer removes; a sent message downloads. */
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
    /** Shown under the name when `state` is "error" — "too large", "upload failed". */
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

/** A sibling of the view surface: a button inside a button is unreachable. */
const CornerAction = ({
    action,
    name,
    onRemove,
    onDownload,
}: Pick<AttachmentCardProps, "action" | "name" | "onRemove" | "onDownload">) => {
    if (action === "remove" && onRemove)
        return (
            <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={onRemove}
                className={CORNER_BUTTON}
            >
                <X size={10} weight="bold" />
            </button>
        )
    // Named group: the turn row is a bare `group`, so an unnamed one lit every tile at once.
    if (action === "download" && onDownload)
        return (
            <button
                type="button"
                aria-label={`Download ${name}`}
                onClick={onDownload}
                className={CORNER_BUTTON}
            >
                <DownloadSimple size={11} />
            </button>
        )
    return null
}

const AudioFace = ({src, name}: {src?: string; name: string}) => {
    const {ref, playing, toggle} = useAudioPlayback(src)
    return (
        <div className={FACE}>
            <button
                type="button"
                disabled={!src}
                aria-label={`${playing ? "Pause" : "Play"} ${name}`}
                onClick={toggle}
                className="flex size-8 cursor-pointer items-center justify-center rounded-full border-0 bg-background p-0 text-foreground shadow-sm transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-50"
            >
                {playing ? <Pause size={13} weight="fill" /> : <Play size={13} weight="fill" />}
            </button>
            <TileName name={name} />
            {src && <audio ref={ref} src={src} preload="none" className="hidden" />}
        </div>
    )
}

/**
 * One staged attachment as a square tile: a thumbnail or type glyph, the name, a corner action.
 * Never fetches — callers pass `src` already resolved.
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
    // A fresh source deserves a fresh attempt at decoding.
    useEffect(() => setThumbFailed(false), [src])
    const isImage = mediaType.startsWith("image/")
    const isAudio = mediaType.startsWith("audio/")
    // Video opens in the viewer: an <audio> element would give it sound and no picture.
    const isVideo = mediaType.startsWith("video/")
    const failed = state === "error"
    const thumbnail = isImage && src && !thumbFailed && !loading

    const glyph: ReactNode = loading ? (
        <span className="absolute inset-0 bg-accent motion-safe:animate-pulse" />
    ) : thumbnail ? (
        // A blob or cookie-authenticated URL — next/image can optimize neither.
        <img
            src={src}
            alt={name}
            draggable={false}
            onError={() => setThumbFailed(true)}
            className="absolute inset-0 h-full w-full object-cover"
        />
    ) : (
        <>
            {isVideo ? (
                <Play size={18} weight="fill" className="text-muted-foreground" />
            ) : isImage ? (
                <ImageBroken size={18} className="text-muted-foreground" />
            ) : (
                <DriveFileGlyph path={name} />
            )}
            <TileName name={name} />
        </>
    )

    // The tile keeps its shape; the tinted glyph says it failed and the tooltip says why.
    const face = failed ? (
        <Tooltip title={errorReason}>
            <div className={FACE}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-colorErrorBg text-colorError">
                    <WarningCircle size={18} weight="fill" />
                </span>
                <TileName name={name} />
                <span className="sr-only">{errorReason}</span>
                {onRetry ? (
                    <button
                        type="button"
                        aria-label={`Retry ${name}`}
                        onClick={onRetry}
                        className="flex cursor-pointer items-center gap-0.5 rounded border-0 bg-transparent px-1 py-0 text-[10px] leading-3 text-colorError hover:bg-colorErrorBg"
                    >
                        <ArrowClockwise size={10} weight="bold" />
                        Retry
                    </button>
                ) : null}
            </div>
        </Tooltip>
    ) : isAudio && !loading ? (
        <AudioFace src={src} name={name} />
    ) : onView ? (
        <button
            type="button"
            aria-label={`View ${name}`}
            title={name}
            onClick={onView}
            className={`${FACE} cursor-pointer`}
        >
            {glyph}
        </button>
    ) : (
        <div className={FACE} title={name}>
            {glyph}
        </div>
    )

    return (
        <div className={`group/attachment ${TILE} ${className ?? ""}`}>
            {face}
            <CornerAction action={action} name={name} onRemove={onRemove} onDownload={onDownload} />
            {state === "uploading" && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-border">
                    <div
                        className="h-full bg-primary transition-[width] duration-150"
                        style={{width: `${Math.max(0, Math.min(100, Math.round(progress)))}%`}}
                    />
                </div>
            )}
        </div>
    )
}

export default AttachmentCard
