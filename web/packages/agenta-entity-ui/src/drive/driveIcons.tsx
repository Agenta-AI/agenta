/**
 * Per-kind file glyph for the drive surfaces. Its OWN light module (phosphor + pure kind
 * resolution only): the file row, thumbnail, card, and both drawer shells all need the icon, and
 * none of them should pull the heavy renderer/explorer graph just to draw it.
 */
import {resolveDriveFileKind} from "@agenta/entities/drive"
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


/** Neutral kind tint (recolor spec): a quiet grey in light, 70% white on the dark chip. */
const NEUTRAL_GLYPH = "text-[#616161] dark:text-[rgba(255,255,255,0.7)]"

/** The kind glyph. Pass `colorClassName` (e.g. "text-current") to override the per-kind tint so
 * the icon inherits its container's colour — used by the inline file pill so the glyph reads in
 * the link accent. */
export const driveFileIcon = (path: string, size = 14, colorClassName?: string) => {
    const c = (semantic: string) => colorClassName ?? semantic
    switch (resolveDriveFileKind(path)) {
        case "markdown":
            return <FileText size={size} className={c(NEUTRAL_GLYPH)} />
        case "json":
            return <BracketsCurly size={size} className={c("text-colorWarning")} />
        case "code":
            return <FileCode size={size} className={c("text-colorInfo")} />
        case "html":
            return <FileHtml size={size} className={c("text-colorWarning")} />
        case "csv":
            return <Table size={size} className={c("text-colorInfo")} />
        case "image":
            return <ImageSquare size={size} className={c(NEUTRAL_GLYPH)} />
        case "pdf":
            return <FilePdf size={size} className={c("text-colorError")} />
        case "audio":
            return <MusicNotes size={size} className={c(NEUTRAL_GLYPH)} />
        case "video":
            return <VideoCamera size={size} className={c("text-colorWarning")} />
        default:
            return <File size={size} className={c("text-colorTextTertiary")} />
    }
}
