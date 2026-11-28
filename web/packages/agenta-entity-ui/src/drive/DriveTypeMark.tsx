/** The Files pane's typed page mark (`tile` 56px with a kind chip, `mini` 15px with a tone bar). */
import {
    type DriveKindTone,
    driveKindTone,
    fileTypeChip,
    resolveDriveFileKind,
} from "@agenta/entities/drive"
import {Folder, FolderOpen} from "@phosphor-icons/react"

/** Chip colours per tone. */
const TONE_CLASS: Record<DriveKindTone, string> = {
    info: "bg-secondary text-info",
    warning: "bg-warning/10 text-warning",
    success: "bg-success/10 text-success",
    error: "bg-destructive/10 text-destructive",
    neutral: "bg-secondary text-muted-foreground",
}
/** The mini mark's colour bar. */
const TONE_BAR_CLASS: Record<DriveKindTone, string> = {
    info: "bg-info",
    warning: "bg-warning",
    success: "bg-success",
    error: "bg-destructive",
    neutral: "bg-border-strong",
}

/**
 * The page glyph. `tight` crops the view box to the drawn page (its stroke included), so the box
 * is the page: the tile draws it at the canvas's 44 x 54. The mini mark keeps the full box, which
 * its tone bar is placed on.
 */
const Page = ({size, tight = false}: {size: number; tight?: boolean}) => (
    <svg
        width={tight ? (size * 43) / 52 : (size * 46) / 56}
        height={size}
        viewBox={tight ? "0 2 43 52" : "0 0 46 56"}
        fill="none"
        aria-hidden
        // `size-auto`: a kit Button would size the svg as its icon.
        className="block size-auto"
    >
        {/* Elevated fill so the page lifts off the pane in dark mode. */}
        <path
            d="M4 3h24l14 14v33a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"
            className="fill-background stroke-border"
            strokeWidth={1.5}
            strokeLinejoin="round"
        />
        <path
            d="M28 3v14h14"
            className="fill-secondary stroke-border dark:fill-secondary"
            strokeWidth={1.5}
            strokeLinejoin="round"
        />
    </svg>
)

export const DriveTypeMark = ({path, size = "mini"}: {path: string; size?: "tile" | "mini"}) => {
    const tone = driveKindTone(resolveDriveFileKind(path), path)
    if (size === "tile")
        return (
            // The same 56 px mark on a phone (M03 draws the full page there too).
            <span className="relative inline-flex h-14 w-14 shrink-0 items-center justify-center">
                <Page size={54} tight />
                <span
                    className={`absolute bottom-2 left-1/2 -translate-x-1/2 rounded-sm px-1 py-px text-caption font-medium ${TONE_CLASS[tone]}`}
                >
                    {fileTypeChip(path)}
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

/**
 * The folder glyph, open while expanded / current. An icon takes the text color (LOUD-04,
 * COLOR-05) and the app icon weight (ICON-01). `drawing` is for the large grid glyph, a drawing
 * rather than an icon: it keeps the filled shape, still neutral.
 */
export const DriveFolderGlyph = ({
    open = false,
    size = 14,
    className = "",
    drawing = false,
}: {
    open?: boolean
    size?: number
    className?: string
    drawing?: boolean
}) => {
    const Glyph = open ? FolderOpen : Folder
    return (
        <Glyph
            size={size}
            weight={drawing ? "fill" : undefined}
            className={`shrink-0 text-muted-foreground ${className}`}
        />
    )
}
