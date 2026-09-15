/**
 * DriveTypeMark — the one typed glyph of the Files pane: a page outline carrying the file's kind
 * chip ("MD", "JSON", "PY"…) in the kind's tone. Three sizes: `tile` (the 56px grid icon),
 * `mini` (tree rows, list rows, the breadcrumb leaf) and `badge` (the bare chip for row 2).
 * Folders get the same treatment through {@link DriveFolderGlyph}. Pure presentation over
 * {@link driveKindTone}; the chat rail's `driveFileIcon` stays the compact phosphor glyph.
 */
import {
    type DriveKindTone,
    driveKindTone,
    fileTypeChip,
    resolveDriveFileKind,
} from "@agenta/entities/drive"
import {Folder, FolderOpen} from "@phosphor-icons/react"

/** Chip colours per tone — text on a soft fill, from the theme's semantic pairs. */
const TONE_CLASS: Record<DriveKindTone, string> = {
    info: "bg-colorFillTertiary text-colorInfo",
    warning: "bg-colorWarningBg text-colorWarning",
    success: "bg-colorSuccessBg text-colorSuccess",
    error: "bg-colorErrorBg text-colorError",
    neutral: "bg-colorFillTertiary text-colorTextSecondary",
}
/** Solid tone for the mini mark's colour bar (no room for a chip). */
const TONE_BAR_CLASS: Record<DriveKindTone, string> = {
    info: "bg-colorInfo",
    warning: "bg-colorWarning",
    success: "bg-colorSuccess",
    error: "bg-colorError",
    neutral: "bg-colorTextQuaternary",
}

export const driveToneClass = (path: string): string =>
    TONE_CLASS[driveKindTone(resolveDriveFileKind(path), path)]

const Page = ({size}: {size: number}) => (
    // 46×56 page with a folded corner, scaled by `size` (its height).
    <svg
        width={(size * 46) / 56}
        height={size}
        viewBox="0 0 46 56"
        fill="none"
        aria-hidden
        className="block"
    >
        <path
            d="M4 3h24l14 14v33a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"
            className="fill-colorBgContainer stroke-colorBorder"
            strokeWidth={1.5}
            strokeLinejoin="round"
        />
        <path
            d="M28 3v14h14"
            className="fill-colorFillTertiary stroke-colorBorder"
            strokeWidth={1.5}
            strokeLinejoin="round"
        />
    </svg>
)

export const DriveTypeMark = ({
    path,
    size = "mini",
}: {
    path: string
    size?: "tile" | "mini" | "badge"
}) => {
    const kind = resolveDriveFileKind(path)
    const tone = driveKindTone(kind, path)
    const chip = fileTypeChip(path)
    if (size === "badge")
        return (
            <span
                className={`inline-flex rounded-[3px] px-[5px] py-px text-[8.5px] font-bold uppercase leading-[1.4] tracking-[0.4px] ${TONE_CLASS[tone]}`}
            >
                {chip}
            </span>
        )
    if (size === "tile")
        return (
            <span className="relative inline-flex h-14 w-14 shrink-0 items-center justify-center">
                <Page size={56} />
                <span
                    className={`absolute bottom-[7px] left-1/2 -translate-x-1/2 rounded-[3px] px-[5px] py-px text-[8.5px] font-bold uppercase leading-[1.4] tracking-[0.4px] ${TONE_CLASS[tone]}`}
                >
                    {chip}
                </span>
            </span>
        )
    return (
        <span className="relative inline-flex h-[15px] w-[13px] shrink-0">
            <Page size={15} />
            <span
                className={`absolute bottom-[2.5px] left-[2px] right-[2px] h-[4.5px] rounded-[1px] ${TONE_BAR_CLASS[tone]}`}
            />
        </span>
    )
}

/** The folder glyph in the folder tone: closed by default, open while expanded / current. */
export const DriveFolderGlyph = ({
    open = false,
    size = 14,
    className = "",
}: {
    open?: boolean
    size?: number
    className?: string
}) =>
    open ? (
        <FolderOpen size={size} weight="fill" className={`shrink-0 text-colorInfo ${className}`} />
    ) : (
        <Folder size={size} weight="fill" className={`shrink-0 text-colorInfo ${className}`} />
    )
