/** A file link's hover card; it reuses the reads the link and the inline figure already make. */
import {useMemo} from "react"

import {
    fileTypeLabel,
    humanSize,
    mountFileThumbnailQueryFamily,
    resolveDriveFileKind,
    type DriveFileKind,
} from "@agenta/entities/drive"
import {mountFileContentQueryFamily} from "@agenta/entities/session"
import {SkeletonBlock} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {CHAT_IMAGE_PREVIEW_PX, isRasterImage, useMountResolver} from "./chatFileLookup"
import {driveFileIcon} from "./driveIcons"
import {useDriveArtifactId, useDriveSessionId} from "./driveSessionContext"
import {isSvgPath, useSvgImage} from "./svgPreview"

const TEXT_KINDS = new Set<DriveFileKind>(["markdown", "text", "code", "json", "csv", "html"])
const SNIPPET_LINES = 10
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

const Footer = ({path, meta}: {path: string; meta: string}) => (
    <div className="flex w-60 min-w-0 items-center gap-2 px-3 py-2">
        <span className="flex shrink-0 items-center">{driveFileIcon(path, 16)}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-popover-foreground">
            {path.split("/").pop() ?? path}
        </span>
        <span className="shrink-0 text-muted-foreground">{meta}</span>
    </div>
)

const PreviewSkeleton = () => (
    <div className="w-[220px] p-2.5">
        <SkeletonBlock className="h-24 w-full" />
    </div>
)

/** The image sets the card's shape; name and facts sit in two lines below it. */
const ImageCard = ({src, name, facts}: {src: string; name: string; facts: string}) => (
    <div className="flex w-fit min-w-40 max-w-[220px] flex-col">
        <div className="flex justify-center bg-muted">
            {/* A data or object URL; next/image cannot optimize it. */}
            <img src={src} alt="" className="block h-auto max-h-[140px] w-auto max-w-[220px]" />
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 px-2.5 py-2">
            <span className="truncate font-medium text-popover-foreground">{name}</span>
            <span className="truncate text-[11px] text-muted-foreground">{facts}</span>
        </div>
    </div>
)

const extensionOf = (path: string) => (path.split(".").pop() ?? "").toUpperCase()

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
    const name = path.split("/").pop() ?? path
    const snippet = useMemo(() => (text === null ? "" : firstLines(text, SNIPPET_LINES)), [text])

    const label = fileTypeLabel(path)
    if (!target) return <Footer path={path} meta={label} />

    if (raster) {
        if (thumbnail.isPending) return <PreviewSkeleton />
        const data = thumbnail.data
        if (!data) return <Footer path={path} meta={label} />
        return (
            <ImageCard
                src={data.src}
                name={name}
                facts={`${extensionOf(path)} · ${data.sourceWidth} × ${data.sourceHeight} · ${humanSize(data.bytes)}`}
            />
        )
    }

    if (readsText && content.isPending) return <PreviewSkeleton />

    if (isSvgPath(path))
        return svg ? (
            <ImageCard src={svg.src} name={name} facts={`SVG · ${humanSize(svg.bytes)}`} />
        ) : (
            <Footer path={path} meta={label} />
        )

    if (TEXT_KINDS.has(kind) && text !== null)
        return (
            <div className="flex w-60 flex-col">
                <pre className="m-0 max-h-40 overflow-hidden whitespace-pre-wrap break-all bg-muted px-3 py-2 font-mono text-[10px] leading-[1.45] text-muted-foreground">
                    {snippet || " "}
                </pre>
                <Footer path={path} meta={label} />
            </div>
        )

    return <Footer path={path} meta={label} />
}
