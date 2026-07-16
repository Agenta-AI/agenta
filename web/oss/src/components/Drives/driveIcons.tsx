/**
 * Per-kind file glyph for the drive surfaces. Its OWN light module (phosphor + pure kind
 * resolution only): the file row, thumbnail, card, and both drawer shells all need the icon, and
 * none of them should pull the heavy renderer/explorer graph just to draw it.
 */
import {
    BracketsCurly,
    File,
    FileCode,
    FileHtml,
    FilePdf,
    FileText,
    ImageSquare,
    MusicNotes,
    Table,
    VideoCamera,
} from "@phosphor-icons/react"

import {resolveDriveFileKind} from "./driveKinds"

/** The kind glyph. Pass `colorClassName` (e.g. "text-current") to override the per-kind tint so
 * the icon inherits its container's colour — used by the inline file pill so the glyph reads in
 * the link accent. */
export const driveFileIcon = (path: string, size = 14, colorClassName?: string) => {
    const c = (semantic: string) => colorClassName ?? semantic
    switch (resolveDriveFileKind(path)) {
        case "markdown":
            return <FileText size={size} className={c("text-[#4fd1b5]")} />
        case "json":
            return <BracketsCurly size={size} className={c("text-colorWarning")} />
        case "code":
            return <FileCode size={size} className={c("text-colorInfo")} />
        case "html":
            return <FileHtml size={size} className={c("text-colorWarning")} />
        case "csv":
            return <Table size={size} className={c("text-colorInfo")} />
        case "image":
            return <ImageSquare size={size} className={c("text-[#7fb0ff]")} />
        case "pdf":
            return <FilePdf size={size} className={c("text-colorError")} />
        case "audio":
            return <MusicNotes size={size} className={c("text-[#4fd1b5]")} />
        case "video":
            return <VideoCamera size={size} className={c("text-colorWarning")} />
        default:
            return <File size={size} className={c("text-colorTextTertiary")} />
    }
}
