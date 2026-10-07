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
    <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        <span className="flex shrink-0 items-center">{driveFileIcon(path, 16)}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-popover-foreground">
            {path.split("/").pop() ?? path}
        </span>
        <span className="shrink-0 text-muted-foreground">{meta}</span>
    </div>
)

const PreviewSkeleton = () => (
    <div className="p-3">
        <SkeletonBlock className="h-24 w-full" />
    </div>
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
    const svgSrc = useSvgImage(isSvgPath(path) ? text : null)?.src
    const snippet = useMemo(() => (text === null ? "" : firstLines(text, SNIPPET_LINES)), [text])

    const label = fileTypeLabel(path)
    if (!target) return <Footer path={path} meta={label} />

    if (raster) {
        if (thumbnail.isPending) return <PreviewSkeleton />
        const data = thumbnail.data
        return (
            <div className="flex flex-col">
                {data ? (
                    <div className="flex max-h-60 items-center justify-center overflow-hidden bg-muted">
                        {/* A generated data URL; next/image cannot optimize it. */}
                        <img
                            src={data.src}
                            alt=""
                            className="block max-h-60 max-w-full object-contain"
                        />
                    </div>
                ) : null}
                <Footer path={path} meta={data ? humanSize(data.bytes) : label} />
            </div>
        )
    }

    if (readsText && content.isPending) return <PreviewSkeleton />

    if (isSvgPath(path))
        return (
            <div className="flex flex-col">
                {svgSrc ? (
                    <div className="flex max-h-60 items-center justify-center overflow-hidden bg-muted p-2">
                        {/* An image context: the SVG runs no script and loads nothing. */}
                        <img src={svgSrc} alt="" className="block max-h-56 max-w-full" />
                    </div>
                ) : null}
                <Footer path={path} meta={label} />
            </div>
        )

    if (TEXT_KINDS.has(kind) && text !== null)
        return (
            <div className="flex flex-col">
                <pre className="m-0 max-h-40 overflow-hidden whitespace-pre-wrap break-all bg-muted px-3 py-2 font-mono text-[10px] leading-[1.45] text-muted-foreground">
                    {snippet || " "}
                </pre>
                <Footer path={path} meta={label} />
            </div>
        )

    return <Footer path={path} meta={label} />
}
