/**
 * Per-kind file glyph for the drive surfaces. Its OWN light module (phosphor + pure kind
 * resolution only): the file row, thumbnail, card, and both drawer shells all need the icon, and
 * none of them should pull the heavy renderer/explorer graph just to draw it.
 */
import {type DriveKindTone, driveKindTone, resolveDriveFileKind} from "@agenta/entities/drive"
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

// One tone table for every drive glyph (this icon, the type mark, the chips).
const TONE_TEXT: Record<DriveKindTone, string> = {
    info: NEUTRAL_GLYPH,
    warning: "text-colorWarning",
    success: "text-colorSuccess",
    error: "text-colorError",
    neutral: NEUTRAL_GLYPH,
}

/** The kind glyph. Pass `colorClassName` (e.g. "text-current") to override the per-kind tint so
 * the icon inherits its container's colour — used by the inline file pill so the glyph reads in
 * the link accent. */
export const driveFileIcon = (path: string, size = 14, colorClassName?: string) => {
    const kind = resolveDriveFileKind(path)
    const className = colorClassName ?? TONE_TEXT[driveKindTone(kind, path)]
    switch (kind) {
        case "markdown":
            return <FileText size={size} className={className} />
        case "json":
            return <BracketsCurly size={size} className={className} />
        case "code":
            return <FileCode size={size} className={className} />
        case "html":
            return <FileHtml size={size} className={className} />
        case "csv":
            return <Table size={size} className={className} />
        case "image":
            return <ImageSquare size={size} className={className} />
        case "pdf":
            return <FilePdf size={size} className={className} />
        case "audio":
            return <MusicNotes size={size} className={className} />
        case "video":
            return <VideoCamera size={size} className={className} />
        default:
            return <File size={size} className={colorClassName ?? "text-colorTextTertiary"} />
    }
}
