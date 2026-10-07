/**
 * The full-screen viewer for chat files: a message's attachments and the images an agent names.
 * One item at a time over a dark mask, with its name, "n of m", Download, and previous / next by
 * arrow buttons, the keyboard, or a swipe. Images render bare on the mask; every other kind reuses
 * the drive renderer registry ({@link DriveFileBody}), fed through {@link DriveFileSourceContext}
 * when the file is not on a mount.
 */
import {useMemo, useRef, useState, type PointerEvent} from "react"

import {resolveDriveFileKind, type DriveFileKind} from "@agenta/entities/drive"
import {type Mount} from "@agenta/entities/session"
import {Button, Dialog, DialogContent, DialogTitle, Spinner} from "@agenta/ui/ui"
import {CaretLeft, CaretRight, DownloadSimple, X} from "@phosphor-icons/react"
import {atom, useAtom} from "jotai"

import {
    DriveFileSourceContext,
    type DriveFileSource,
    useDriveDownload,
    useDriveFileText,
    useDriveMediaSrc,
    useObjectUrl,
} from "./driveFileSource"
import {DriveSessionProvider} from "./driveSessionContext"
import {DownloadCard, DriveFileBody} from "./renderers"
import {isSvgPath, SVG_PREVIEW_CAP, useSvgImage} from "./svgPreview"

/** Where a viewer item's bytes come from. */
export type MediaViewerSource =
    /** An app-authenticated URL, such as a chat attachment's content endpoint. */
    | {kind: "url"; url: string}
    /** A file still in memory, such as one staged in the composer. */
    | {kind: "file"; file: File}
    /** A drive file, by mount and mount-relative path. */
    | {kind: "mount"; mount: Mount; path: string}

export interface MediaViewerItem {
    /** Unique within the list. */
    key: string
    name: string
    /** Decides the kind when the name's extension cannot (attachments carry one; drive files not). */
    mediaType?: string
    /** Bytes, for the registry's too-large-to-preview caps. */
    size?: number | null
    source: MediaViewerSource
}

const MEDIA_TYPE_KINDS: [test: (type: string) => boolean, kind: DriveFileKind][] = [
    [(t) => t.startsWith("image/"), "image"],
    [(t) => t.startsWith("video/"), "video"],
    [(t) => t.startsWith("audio/"), "audio"],
    [(t) => t === "application/pdf", "pdf"],
    [(t) => t === "text/csv" || t === "text/tab-separated-values", "csv"],
    [(t) => t === "text/markdown", "markdown"],
    [(t) => t === "application/json", "json"],
    [(t) => t.startsWith("text/"), "text"],
]

/** The name's extension first (it tells `.py` from plain text), the media type when that fails. */
const mediaViewerKind = (item: Pick<MediaViewerItem, "name" | "mediaType">) => {
    const byName = resolveDriveFileKind(item.name)
    if (byName !== "other" || !item.mediaType) return byName
    return MEDIA_TYPE_KINDS.find(([test]) => test(item.mediaType ?? ""))?.[1] ?? "other"
}

/** Kinds whose body never scrolls or scrubs sideways, so a horizontal swipe can mean "next". */
const SWIPEABLE = new Set<DriveFileKind>(["image", "audio", "other"])
const SWIPE_PX = 60
const KEEPS_ARROWS = "video, audio, input, textarea, [contenteditable='true']"

/** The item as the drive bodies read it: a mount + path, or a path served by a local source. */
function useItemFile(item: MediaViewerItem) {
    const {source} = item
    const file = source.kind === "file" ? source.file : null
    const objectUrl = useObjectUrl(file)
    const url = source.kind === "url" ? source.url : null
    const local = useMemo((): DriveFileSource | null => {
        if (url) return new Map([[item.name, {src: url}]])
        if (file && objectUrl) return new Map([[item.name, {src: objectUrl, file}]])
        return null
    }, [url, file, objectUrl, item.name])
    if (source.kind === "mount") return {mount: source.mount, path: source.path, local: null}
    return {mount: null, path: item.name, local}
}

const ViewerImage = ({mount, path, name}: {mount: Mount | null; path: string; name: string}) => {
    const {src, isPending, failed, onError} = useDriveMediaSrc(mount, path, {direct: true})
    const [loaded, setLoaded] = useState<string | null>(null)
    if (failed)
        return (
            <div className="flex w-full max-w-md flex-col rounded-lg bg-background p-2">
                <DownloadCard mount={mount} path={path} title="Couldn't load this image" />
            </div>
        )
    return (
        <>
            {isPending || !src || loaded !== src ? (
                <Spinner className="absolute text-white/70" aria-label="Loading image" />
            ) : null}
            {src ? (
                // A cookie-authenticated or object URL; next/image can optimize neither.
                <img
                    src={src}
                    alt={name}
                    onLoad={() => setLoaded(src)}
                    onError={onError}
                    draggable={false}
                    className={`max-h-full max-w-full select-none object-contain ${
                        loaded === src ? "" : "invisible"
                    }`}
                />
            ) : null}
        </>
    )
}

interface ItemFile {
    mount: Mount | null
    path: string
}

/** An SVG from its text, as an `image/svg+xml` blob in `<img>`: the server's type guess for the
 * download may not say SVG, and the markup never enters the DOM. */
const ViewerSvg = ({mount, path, name}: {mount: Mount | null; path: string; name: string}) => {
    const {data, isPending} = useDriveFileText(mount, path)
    const src = useSvgImage(data)?.src
    if (isPending || (typeof data === "string" && data.length <= SVG_PREVIEW_CAP && !src))
        return <Spinner className="text-white/70" aria-label="Loading image" />
    if (!src)
        return (
            <div className="flex w-full max-w-md flex-col rounded-lg bg-background p-2">
                <DownloadCard mount={mount} path={path} title="Couldn't preview this SVG" />
            </div>
        )
    return (
        <img
            src={src}
            alt={name}
            draggable={false}
            className="max-h-full max-w-full select-none object-contain"
        />
    )
}

const ViewerBody = ({item, file}: {item: MediaViewerItem; file: ItemFile}) => {
    const kind = mediaViewerKind(item)
    if (kind === "image" && (isSvgPath(item.name) || item.mediaType === "image/svg+xml"))
        return <ViewerSvg {...file} name={item.name} />
    if (kind === "image") return <ViewerImage {...file} name={item.name} />
    const fills = kind !== "audio" && kind !== "other"
    return (
        <div
            className={`flex w-full max-w-4xl flex-col rounded-lg bg-background p-2 text-foreground ${
                fills ? "h-full" : "max-h-full"
            }`}
        >
            <DriveFileBody {...file} size={item.size} kind={kind} />
        </div>
    )
}

const DownloadButton = ({name, file}: {name: string; file: ItemFile}) => {
    const download = useDriveDownload(file.mount, file.path)
    return (
        <Button
            variant="ghost"
            size="icon"
            aria-label={`Download ${name}`}
            onClick={download}
            className="text-white hover:bg-white/10 hover:text-white"
        >
            <DownloadSimple />
        </Button>
    )
}

const NavButton = ({side, onClick}: {side: "prev" | "next"; onClick: () => void}) => (
    <Button
        variant="ghost"
        size="icon"
        aria-label={side === "prev" ? "Previous file" : "Next file"}
        onClick={onClick}
        className={`absolute top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 text-white hover:bg-black/60 hover:text-white ${
            side === "prev" ? "left-2 sm:left-4" : "right-2 sm:right-4"
        }`}
    >
        {side === "prev" ? <CaretLeft /> : <CaretRight />}
    </Button>
)

/** One item's chrome and stage. Keyed by item, so per-file state never leaks to the next one. */
const ViewerFrame = ({
    item,
    position,
    count,
    go,
    close,
}: {
    item: MediaViewerItem
    position: number
    count: number
    go: (step: -1 | 1) => void
    close: () => void
}) => {
    const {local, ...file} = useItemFile(item)
    const swipeStart = useRef<{x: number; y: number} | null>(null)
    const swipeable = SWIPEABLE.has(mediaViewerKind(item))

    const onPointerDown = (e: PointerEvent) => {
        swipeStart.current = e.pointerType === "touch" ? {x: e.clientX, y: e.clientY} : null
    }
    const onPointerUp = (e: PointerEvent) => {
        const start = swipeStart.current
        swipeStart.current = null
        if (!start || !swipeable) return
        const dx = e.clientX - start.x
        const dy = e.clientY - start.y
        if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy)) return
        go(dx > 0 ? -1 : 1)
    }

    const frame = (
        <DriveFileSourceContext.Provider value={local}>
            <div className="flex h-12 shrink-0 items-center gap-2 pl-4 pr-2">
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                    <DialogTitle className="truncate text-sm font-medium leading-6 text-white">
                        {item.name}
                    </DialogTitle>
                    {count > 1 ? (
                        <span className="shrink-0 text-xs tabular-nums text-white/60">
                            {position + 1} of {count}
                        </span>
                    ) : null}
                </div>
                <DownloadButton name={item.name} file={file} />
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Close"
                    onClick={close}
                    className="text-white hover:bg-white/10 hover:text-white"
                >
                    <X />
                </Button>
            </div>
            <div
                className="relative flex min-h-0 flex-1 items-center justify-center px-3 pb-3 sm:px-16 sm:pb-6"
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUp}
                // A tap on the bare mask closes, as a lightbox does.
                onClick={(e) => e.target === e.currentTarget && close()}
            >
                <ViewerBody item={item} file={file} />
                {count > 1 ? (
                    <>
                        <NavButton side="prev" onClick={() => go(-1)} />
                        <NavButton side="next" onClick={() => go(1)} />
                    </>
                ) : null}
            </div>
        </DriveFileSourceContext.Provider>
    )
    // A file outside the drive has no path a quoted reply could point at.
    return file.mount ? frame : <DriveSessionProvider sessionId="">{frame}</DriveSessionProvider>
}

/** What the app-wide viewer shows, or null when it is closed. Openers set it; the host renders it. */
export const mediaViewerAtom = atom<{items: MediaViewerItem[]; index: number} | null>(null)

/** The one viewer, mounted once by the app, so a remounting opener cannot close it. */
export function MediaViewerHost() {
    const [open, setOpen] = useAtom(mediaViewerAtom)
    const items = open?.items ?? []
    const count = items.length
    const index = open?.index ?? null
    const current = index !== null && index >= 0 && index < count ? index : null
    const item = current !== null ? items[current] : null
    const go = (step: -1 | 1) => {
        if (!open || current === null || count < 2) return
        setOpen({...open, index: (current + step + count) % count})
    }
    const close = () => setOpen(null)

    return (
        <Dialog open={item !== null} onOpenChange={(isOpen) => !isOpen && close()}>
            {item && current !== null ? (
                <DialogContent
                    showCloseButton={false}
                    aria-describedby={undefined}
                    overlayClassName="bg-black/85 motion-reduce:!animate-none"
                    onKeyDown={(e) => {
                        // Arrows inside a player or a field seek or move the caret instead.
                        if ((e.target as HTMLElement).closest?.(KEEPS_ARROWS)) return
                        if (e.key === "ArrowLeft") go(-1)
                        else if (e.key === "ArrowRight") go(1)
                    }}
                    className="fixed inset-0 max-h-none w-auto max-w-none gap-0 overflow-hidden rounded-none bg-transparent p-0 text-white ring-0 motion-reduce:!animate-none"
                >
                    <ViewerFrame
                        key={item.key}
                        item={item}
                        position={current}
                        count={count}
                        go={go}
                        close={close}
                    />
                </DialogContent>
            ) : null}
        </Dialog>
    )
}
