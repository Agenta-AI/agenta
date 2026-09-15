import {driveRootLabel} from "@agenta/entities/drive"
import {House} from "@phosphor-icons/react"

import {DriveFolderGlyph, DriveTypeMark} from "./DriveTypeMark"

/** Clickable path breadcrumb: each folder segment (and the home root) navigates via `onNavigate`
 * (a folder path, "" = root). The last segment is the current file/folder (plain). Scrolls
 * horizontally rather than truncating, so every part stays reachable.
 *
 * `variant="icons"` is the Files pane's row-1 crumb: a house root labelled "All files" when it
 * stands alone, an open-folder glyph per folder, the typed mark for a file leaf, the leaf at
 * weight 500. The default variant is unchanged — the chat file palette renders it too. */
export const DriveBreadcrumb = ({
    shown,
    rootLabel,
    onNavigate,
    variant = "default",
    isFile = false,
}: {
    shown: string
    rootLabel: string
    onNavigate: (folderPath: string) => void
    variant?: "default" | "icons"
    /** The leaf is a file (icons variant draws its type mark instead of a folder). */
    isFile?: boolean
}) => {
    const segs = shown.split("/").filter(Boolean)
    if (variant === "icons") {
        const crumbBtn =
            "flex shrink-0 cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent px-1.5 py-[3px] text-[13px] text-colorTextSecondary hover:bg-colorFillTertiary hover:text-colorText"
        return (
            <div
                className="flex min-w-0 items-center gap-0.5 overflow-x-auto whitespace-nowrap text-[13px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                title={shown}
            >
                {segs.length === 0 ? (
                    <span className="flex shrink-0 items-center gap-1.5 px-1.5 py-[3px] font-medium text-colorText">
                        <House size={15} weight="fill" />
                        All files
                    </span>
                ) : (
                    <button
                        type="button"
                        onClick={() => onNavigate("")}
                        aria-label="All files"
                        title={rootLabel}
                        className={crumbBtn}
                    >
                        <House size={15} weight="fill" />
                    </button>
                )}
                {segs.map((seg, i) => {
                    const path = segs.slice(0, i + 1).join("/")
                    const isLast = i === segs.length - 1
                    return (
                        <span key={path} className="flex shrink-0 items-center gap-0.5">
                            <span className="text-xs text-colorTextQuaternary">/</span>
                            {isLast ? (
                                <span
                                    className={`flex items-center gap-1.5 px-1.5 py-[3px] text-colorText ${isFile ? "" : "font-medium"}`}
                                >
                                    {isFile ? (
                                        <DriveTypeMark path={path} size="mini" />
                                    ) : (
                                        <DriveFolderGlyph open size={15} />
                                    )}
                                    {seg}
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => onNavigate(path)}
                                    className={crumbBtn}
                                >
                                    <DriveFolderGlyph open size={15} className="!text-current" />
                                    {seg}
                                </button>
                            )}
                        </span>
                    )
                })}
            </div>
        )
    }
    return (
        <div
            className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap text-xs text-colorTextTertiary"
            title={shown}
        >
            <button
                type="button"
                onClick={() => onNavigate("")}
                aria-label={rootLabel}
                title={rootLabel}
                // Explicit text-xs: preflight is OFF, so <button>s DON'T inherit the parent
                // font-size — without this the clickable crumbs render larger than the current-crumb
                // span, so a segment appears to change size as you navigate (it becomes a button).
                className="flex shrink-0 cursor-pointer items-center gap-1 rounded border-0 bg-transparent p-0 text-xs text-colorTextTertiary hover:text-colorText"
            >
                <House size={12} />
                {/* Label the root "root" only when it's alone — a bare home icon reads as empty. Once
                    there's a path the icon stays bare (the segments give the context). */}
                {segs.length === 0 ? <span className="font-mono">root</span> : null}
            </button>
            {segs.map((seg, i) => {
                const path = segs.slice(0, i + 1).join("/")
                const isLast = i === segs.length - 1
                return (
                    <span key={path} className="flex shrink-0 items-center gap-1">
                        <span className="text-colorTextQuaternary">/</span>
                        {isLast ? (
                            <span className="font-mono text-xs">{seg}</span>
                        ) : (
                            // text-xs: preflight OFF → this <button> won't inherit 11px, so
                            // without it the ancestor crumbs render bigger than the current span.
                            <button
                                type="button"
                                onClick={() => onNavigate(path)}
                                className="cursor-pointer rounded border-0 bg-transparent p-0 font-mono text-xs text-colorTextTertiary hover:text-colorText hover:underline"
                            >
                                {seg}
                            </button>
                        )}
                    </span>
                )
            })}
        </div>
    )
}

export {driveRootLabel}
