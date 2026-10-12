import {useEffect, useMemo, useRef, useState} from "react"

import {mediaViewerAtom, useRemoteObjectUrl, type MediaViewerItem} from "@agenta/entity-ui/drive"
import {useInView} from "@agenta/shared/hooks"
import {ImageBroken, Pause, Play} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {typeBadgeFor} from "../assets/attachmentRules"

import {useAudioPlayback} from "./useAudioPlayback"

/** One file on a sent message. `src` is already resolved; the strip never fetches it itself. */
export interface AttachmentStripFile {
    name: string
    mediaType: string
    src?: string
    size?: number
}

export interface AttachmentStripProps {
    files: AttachmentStripFile[]
    /** The side the tiles hug: a user message sits right, an assistant one left. */
    align?: "start" | "end"
    /** Tiles drawn before the last one turns into "+N". */
    maxTiles?: number
}

/** One square for every kind, so a mixed batch reads as one row; a step down on a phone. */
const TILE =
    "relative box-border size-16 shrink-0 overflow-hidden rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary sm:size-[72px]"

/** The whole tile, as the control that opens the viewer. A sibling of any inner control. */
const OPEN_BUTTON =
    "absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-1 border-0 bg-transparent p-1.5 text-colorTextSecondary disabled:cursor-default"

const TileName = ({name}: {name: string}) => (
    <span className="line-clamp-2 w-full break-all text-center text-[10px] leading-3 text-colorTextSecondary">
        {name}
    </span>
)

const ImageTile = ({file, onOpen}: {file: AttachmentStripFile; onOpen?: () => void}) => {
    // Keyed by source, so a fresh URL gets a fresh attempt without an effect racing its load event.
    const [settled, setSettled] = useState<{src: string; ok: boolean} | null>(null)
    const state =
        !settled || settled.src !== file.src ? "loading" : settled.ok ? "loaded" : "failed"
    return (
        <button
            type="button"
            aria-label={`View ${file.name}`}
            disabled={!onOpen}
            onClick={onOpen}
            className={OPEN_BUTTON}
        >
            {state === "failed" || !file.src ? (
                <>
                    <ImageBroken size={18} className="shrink-0 text-colorTextTertiary" />
                    <TileName name={file.name} />
                </>
            ) : (
                <>
                    {state === "loading" ? (
                        <span className="absolute inset-0 bg-colorFillTertiary motion-safe:animate-pulse" />
                    ) : null}
                    {/* A cookie-authenticated URL; next/image cannot optimize it. */}
                    <img
                        src={file.src}
                        alt={file.name}
                        draggable={false}
                        loading="lazy"
                        decoding="async"
                        onLoad={() => setSettled({src: file.src ?? "", ok: true})}
                        onError={() => setSettled({src: file.src ?? "", ok: false})}
                        className={`absolute inset-0 h-full w-full object-cover ${
                            state === "loaded" ? "" : "opacity-0"
                        }`}
                    />
                </>
            )}
        </button>
    )
}

/** Above this a video tile keeps its glyph: its first frame would cost the whole file. */
const VIDEO_FRAME_CAP = 8 * 1024 * 1024

const VideoTile = ({file, onOpen}: {file: AttachmentStripFile; onOpen?: () => void}) => {
    // Fetched whole: the attachments endpoint ignores `Range`, so a URL `src` never loads metadata.
    const small = file.size !== undefined && file.size <= VIDEO_FRAME_CAP
    // Fetched only near the viewport: the transcript is not virtualized.
    const [ref, inView] = useInView<HTMLButtonElement>()
    const {url} = useRemoteObjectUrl(small && inView ? (file.src ?? null) : null)
    return (
        <button
            ref={ref}
            type="button"
            aria-label={`View ${file.name}`}
            disabled={!onOpen}
            onClick={onOpen}
            className={OPEN_BUTTON}
        >
            {url ? (
                // Muted so no autoplay policy applies; seeked just past 0 to paint a frame.
                <video
                    src={url}
                    muted
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={(e) => {
                        e.currentTarget.currentTime = 0.1
                    }}
                    className="absolute inset-0 h-full w-full object-cover"
                />
            ) : null}
            <span className="relative flex size-7 items-center justify-center rounded-full bg-black/50 text-white">
                <Play size={13} weight="fill" />
            </span>
        </button>
    )
}

/** Plays in place, fetching its bytes on the first Play; the rest of the tile opens the viewer. */
const AudioTile = ({file, onOpen}: {file: AttachmentStripFile; onOpen?: () => void}) => {
    const [requested, setRequested] = useState(false)
    const {url, isPending, failed} = useRemoteObjectUrl(requested ? (file.src ?? null) : null)
    const {ref, playing, toggle} = useAudioPlayback(url ?? undefined)
    // The first Play waits for the bytes, then starts once the element has them.
    const playWhenReady = useRef(false)
    useEffect(() => {
        if (!url || !playWhenReady.current) return
        playWhenReady.current = false
        void ref.current?.play()
    }, [url, ref])
    const onPlay = () => {
        if (url) return toggle()
        playWhenReady.current = true
        setRequested(true)
    }
    return (
        <>
            <button
                type="button"
                aria-label={`View ${file.name}`}
                disabled={!onOpen}
                onClick={onOpen}
                className={`${OPEN_BUTTON} justify-end`}
            >
                <TileName name={file.name} />
            </button>
            <button
                type="button"
                disabled={!file.src || failed}
                aria-label={`${playing ? "Pause" : "Play"} ${file.name}`}
                aria-busy={isPending}
                onClick={onPlay}
                className={`absolute left-1/2 top-2 flex size-8 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-colorFillSecondary p-0 text-colorText transition-colors hover:bg-colorFill disabled:cursor-default disabled:opacity-50 ${
                    isPending ? "motion-safe:animate-pulse" : ""
                }`}
            >
                {playing ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />}
            </button>
            {url ? <audio ref={ref} src={url} preload="auto" className="hidden" /> : null}
        </>
    )
}

const DocumentTile = ({file, onOpen}: {file: AttachmentStripFile; onOpen?: () => void}) => (
    <button
        type="button"
        aria-label={`View ${file.name}`}
        disabled={!onOpen}
        onClick={onOpen}
        className={OPEN_BUTTON}
    >
        <span className="rounded bg-colorFillTertiary px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-4 text-colorTextSecondary">
            {typeBadgeFor(file.mediaType, file.name)}
        </span>
        <TileName name={file.name} />
    </button>
)

const tileFor = (mediaType: string) =>
    mediaType.startsWith("image/")
        ? ImageTile
        : mediaType.startsWith("video/")
          ? VideoTile
          : mediaType.startsWith("audio/")
            ? AudioTile
            : DocumentTile

/** "+N" over the first hidden file: its picture when it is an image, a plain fill otherwise. */
const OverflowTile = ({
    count,
    first,
    onOpen,
}: {
    count: number
    first: AttachmentStripFile
    onOpen?: () => void
}) => (
    <div className={TILE}>
        {first.src && first.mediaType.startsWith("image/") ? (
            <img
                src={first.src}
                alt=""
                draggable={false}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover"
            />
        ) : null}
        <button
            type="button"
            aria-label={`View ${count} more files`}
            disabled={!onOpen}
            onClick={onOpen}
            className={`${OPEN_BUTTON} bg-black/50 text-sm font-semibold text-white`}
        >
            +{count}
        </button>
    </div>
)

/** A message's files as tiles that open the app viewer; past `maxTiles` the last reads "+N". */
export const AttachmentStrip = ({files, align = "end", maxTiles = 4}: AttachmentStripProps) => {
    const openViewer = useSetAtom(mediaViewerAtom)
    // Only a file with a source can be viewed; the viewer pages through those alone.
    const viewable = useMemo(
        () => files.flatMap((file, at) => (file.src ? [{file, at, src: file.src}] : [])),
        [files],
    )
    const items = useMemo<MediaViewerItem[]>(
        () =>
            viewable.map(({file, at, src}) => ({
                key: `${at}:${src}`,
                name: file.name,
                mediaType: file.mediaType,
                size: file.size,
                source: {kind: "url", url: src},
            })),
        [viewable],
    )
    const openAt = (at: number) => {
        const index = viewable.findIndex((entry) => entry.at === at)
        return index < 0 ? undefined : () => openViewer({items, index})
    }

    const overflow = files.length > maxTiles ? files.length - (maxTiles - 1) : 0
    const shown = overflow ? files.slice(0, maxTiles - 1) : files

    return (
        <div
            className={`flex flex-wrap gap-1.5 ${align === "end" ? "justify-end" : "justify-start"}`}
        >
            {shown.map((file, at) => {
                const Tile = tileFor(file.mediaType)
                return (
                    <div key={`${at}:${file.src ?? file.name}`} className={TILE} title={file.name}>
                        <Tile file={file} onOpen={openAt(at)} />
                    </div>
                )
            })}
            {overflow ? (
                <OverflowTile
                    count={overflow}
                    first={files[maxTiles - 1]}
                    onOpen={openAt(maxTiles - 1)}
                />
            ) : null}
        </div>
    )
}

export default AttachmentStrip
