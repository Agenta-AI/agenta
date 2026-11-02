/** A file link's hover card; it reuses the reads the link and the inline figure already make. */
import {useMemo, type ReactNode} from "react"

import {
    humanSize,
    mountFileThumbnailQueryFamily,
    resolveDriveFileKind,
    type DriveFileKind,
} from "@agenta/entities/drive"
import {mountFileContentQueryFamily} from "@agenta/entities/session"
import {SkeletonBlock} from "@agenta/ui/ui"
import {Image as ImageIcon} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {CHAT_IMAGE_PREVIEW_PX, isRasterImage, useMountResolver} from "./chatFileLookup"
import {DriveFileGlyph} from "./DriveFileTile"
import {driveFileIcon} from "./driveIcons"
import {useDriveArtifactId, useDriveSessionId} from "./driveSessionContext"
import {isSvgPath, useSvgImage} from "./svgPreview"
import {useDriveFileLookup} from "./useDriveFileLookup"

const TEXT_KINDS = new Set<DriveFileKind>(["markdown", "text", "code", "json", "csv", "html"])
const SNIPPET_LINES = 12
const SNIPPET_CHARS = 4096

/** The first `count` lines, found without splitting the whole body. */
const firstLines = (text: string, count: number): string => {
    let end = -1
    for (let line = 0; line < count; line++) {
        end = text.indexOf("\n", end + 1)
        if (end < 0 || end > SNIPPET_CHARS) return text.slice(0, SNIPPET_CHARS)
    }
    return text.slice(0, end)
}
const NO_FILE = {mountId: "", path: ""}

/** The name, with its size at the row's end; the extension already says the type. */
const Footer = ({path, size}: {path: string; size: string}) => (
    <div className="flex min-w-0 items-center gap-2.5 px-3.5 py-2.5">
        <span className="flex shrink-0 items-center">{driveFileIcon(path, 18)}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-popover-foreground">
            {path.split("/").pop() ?? path}
        </span>
        {size ? <span className="shrink-0 text-xs text-muted-foreground">{size}</span> : null}
    </div>
)

/** The muted bed a preview sits in, with the footer under it. */
const Frame = ({children, path, size}: {children: ReactNode; path: string; size: string}) => (
    <div className="flex w-72 flex-col">
        <div className="h-36 overflow-hidden bg-muted">{children}</div>
        <Footer path={path} size={size} />
    </div>
)

/** A file with nothing to show: its tinted kind square, the name, and why there is no preview. */
const NoPreview = ({path, size}: {path: string; size: string}) => (
    <div className="flex w-64 min-w-0 items-center gap-3 p-3">
        <DriveFileGlyph path={path} />
        <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-medium text-popover-foreground">
                {path.split("/").pop() ?? path}
            </span>
            <span className="truncate text-xs text-muted-foreground">
                {size ? `No preview · ${size}` : "No preview"}
            </span>
        </span>
    </div>
)

/** The image alone, its name over a soft fade at the foot, as the inline reply image shows it. */
const Photo = ({src, path}: {src: string | null; path: string}) => (
    <div className="relative w-72 bg-muted">
        {src ? (
            // A data or object URL; next/image cannot optimize it.
            <img src={src} alt="" className="block h-auto max-h-56 w-full object-cover" />
        ) : (
            <SkeletonBlock className="h-40 w-full rounded-none" />
        )}
        <div className="absolute inset-x-0 bottom-0 flex min-w-0 items-center gap-1.5 bg-gradient-to-t from-black/60 to-transparent px-3 pb-2.5 pt-6 text-xs text-white">
            <ImageIcon size={13} className="shrink-0" />
            <span className="min-w-0 truncate font-medium">{path.split("/").pop() ?? path}</span>
        </div>
    </div>
)

/** A page tucked into the bed's corner, fading out at its foot. */
const Sheet = ({children}: {children: ReactNode}) => (
    <div className="h-full pl-4 pt-3">
        <div className="h-[calc(100%+12px)] overflow-hidden rounded-tl-md bg-background px-3.5 py-3 shadow-sm ring-1 ring-border/60 [mask-image:linear-gradient(black_55%,transparent)]">
            {children}
        </div>
    </div>
)

const SheetSkeleton = () => (
    <Sheet>
        <div className="flex flex-col gap-2">
            <SkeletonBlock className="h-3 w-2/3" />
            <SkeletonBlock className="h-2 w-full" />
            <SkeletonBlock className="h-2 w-5/6" />
            <SkeletonBlock className="h-2 w-3/4" />
        </div>
    </Sheet>
)

/** Markdown read as a page: headings bold, the rest muted body text. */
const MarkdownSheet = ({text}: {text: string}) => (
    <div className="flex flex-col gap-1">
        {text
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line, at) => {
                const heading = /^#{1,6}\s/.test(line)
                const plain = line
                    .replace(/^#{1,6}\s+|^[-*+]\s+|^\d+\.\s+/, "")
                    .replace(/[*_`]/g, "")
                return heading ? (
                    <span
                        key={at}
                        className={`font-semibold text-foreground ${at === 0 ? "text-[12.5px]" : "mt-1 text-[11px]"}`}
                    >
                        {plain}
                    </span>
                ) : (
                    <span key={at} className="text-[10.5px] leading-snug text-muted-foreground">
                        {plain}
                    </span>
                )
            })}
    </div>
)

const CodeSheet = ({text}: {text: string}) => (
    <pre className="m-0 whitespace-pre font-mono text-[10px] leading-[1.5] text-muted-foreground">
        {text || " "}
    </pre>
)

export function DriveFileHoverCard({path}: {path: string}) {
    const sessionId = useDriveSessionId() ?? ""
    const target = useMountResolver(sessionId, useDriveArtifactId())(path)
    const kind = resolveDriveFileKind(path)
    const file = target ? {mountId: target.mount.id, path: target.path} : NO_FILE
    const raster = isRasterImage(path)
    const readsText = TEXT_KINDS.has(kind) || isSvgPath(path)

    const thumbnail = useAtomValue(
        mountFileThumbnailQueryFamily(raster ? {...file, px: CHAT_IMAGE_PREVIEW_PX} : NO_FILE),
    )
    const content = useAtomValue(mountFileContentQueryFamily(readsText ? file : NO_FILE))
    const text = typeof content.data === "string" ? content.data : null
    const svg = useSvgImage(isSvgPath(path) ? text : null)
    const snippet = useMemo(() => (text === null ? "" : firstLines(text, SNIPPET_LINES)), [text])

    const listed = useDriveFileLookup()(path).entry?.size
    const textSize = useMemo(() => (text === null ? null : new Blob([text]).size), [text])
    const size = (bytes: number | null | undefined) => (bytes == null ? "" : humanSize(bytes))
    if (!target) return <NoPreview path={path} size={size(listed)} />

    if (raster) {
        if (thumbnail.isPending) return <Photo src={null} path={path} />
        const data = thumbnail.data
        if (!data) return <NoPreview path={path} size={size(listed)} />
        return <Photo src={data.src} path={path} />
    }

    if (isSvgPath(path))
        return svg || content.isPending ? (
            <Photo src={svg?.src ?? null} path={path} />
        ) : (
            <NoPreview path={path} size={size(listed)} />
        )

    if (readsText && content.isPending)
        return (
            <Frame path={path} size={size(listed)}>
                <SheetSkeleton />
            </Frame>
        )

    if (TEXT_KINDS.has(kind) && text !== null)
        return (
            <Frame path={path} size={size(listed ?? textSize)}>
                <Sheet>
                    {kind === "markdown" ? (
                        <MarkdownSheet text={snippet} />
                    ) : (
                        <CodeSheet text={snippet} />
                    )}
                </Sheet>
            </Frame>
        )

    return <NoPreview path={path} size={size(listed)} />
}
