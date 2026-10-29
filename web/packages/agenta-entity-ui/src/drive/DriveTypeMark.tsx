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
    info: "bg-colorFillTertiary text-colorInfo",
    warning: "bg-colorWarningBg text-colorWarning",
    success: "bg-colorSuccessBg text-colorSuccess",
    error: "bg-colorErrorBg text-colorError",
    neutral: "bg-colorFillTertiary text-colorTextSecondary",
}
/** The mini mark's colour bar. */
const TONE_BAR_CLASS: Record<DriveKindTone, string> = {
    info: "bg-colorInfo",
    warning: "bg-colorWarning",
    success: "bg-colorSuccess",
    error: "bg-colorError",
    neutral: "bg-colorTextQuaternary",
}

const Page = ({size}: {size: number}) => (
    <svg
        width={(size * 46) / 56}
        height={size}
        viewBox="0 0 46 56"
        fill="none"
        aria-hidden
        // `size-auto`: a kit Button would size the svg as its icon.
        className="block size-auto"
    >
        {/* Elevated fill so the page lifts off the pane in dark mode. */}
        <path
            d="M4 3h24l14 14v33a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"
            className="fill-colorBgElevated stroke-colorBorder"
            strokeWidth={1.5}
            strokeLinejoin="round"
        />
        <path
            d="M28 3v14h14"
            className="fill-colorFillTertiary stroke-colorBorder dark:fill-colorFillSecondary"
            strokeWidth={1.5}
            strokeLinejoin="round"
        />
    </svg>
)

export const DriveTypeMark = ({path, size = "mini"}: {path: string; size?: "tile" | "mini"}) => {
    const tone = driveKindTone(resolveDriveFileKind(path), path)
    if (size === "tile")
        return (
            // A phone's narrower tile scales the whole mark down (page + chip keep their fit).
            <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center max-md:h-11 max-md:w-11">
                <span className="relative inline-flex h-14 w-14 shrink-0 items-center justify-center max-md:scale-[0.78]">
                    <Page size={56} />
                    <span
                        className={`absolute bottom-[7px] left-1/2 -translate-x-1/2 rounded-[3px] px-[5px] py-px text-[8.5px] font-bold uppercase leading-[1.4] tracking-[0.4px] ${TONE_CLASS[tone]}`}
                    >
                        {fileTypeChip(path)}
                    </span>
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

/** The folder glyph, open while expanded / current. */
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
