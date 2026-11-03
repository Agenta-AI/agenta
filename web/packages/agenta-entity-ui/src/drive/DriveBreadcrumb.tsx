import {Fragment} from "react"

import {driveRootLabel} from "@agenta/entities/drive"
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
    Button,
} from "@agenta/ui/ui"
import {House} from "@phosphor-icons/react"

import {DriveFolderGlyph, DriveTypeMark} from "./DriveTypeMark"

/** Clickable path breadcrumb: each folder segment (and the home root) navigates via `onNavigate`
 * (a folder path, "" = root). The last segment is the current file/folder (plain). Scrolls
 * horizontally rather than truncating, so every part stays reachable. `variant="icons"` is the
 * Files pane's row-1 crumb (house root, folder glyphs, a typed mark on a file leaf). */
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
    /** The leaf is a file. */
    isFile?: boolean
}) => {
    const segs = shown.split("/").filter(Boolean)
    if (variant === "icons") {
        // `inline-flex` restated: BreadcrumbLink's `inline-block` would stack glyph over label.
        const crumbLink =
            "inline-flex h-auto items-center gap-1.5 px-1.5 py-[3px] text-[13px] font-normal text-colorTextSecondary"
        return (
            <Breadcrumb
                className="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                title={shown}
            >
                <BreadcrumbList className="flex-nowrap gap-0.5 whitespace-nowrap text-[13px] sm:gap-0.5">
                    <BreadcrumbItem>
                        {segs.length === 0 ? (
                            <BreadcrumbPage className="flex h-auto items-center gap-1.5 px-1.5 py-[3px] font-medium">
                                <House size={15} />
                                All files
                            </BreadcrumbPage>
                        ) : (
                            <BreadcrumbLink asChild>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onNavigate("")}
                                    aria-label="All files"
                                    title={rootLabel}
                                    className={crumbLink}
                                >
                                    <House size={15} />
                                </Button>
                            </BreadcrumbLink>
                        )}
                    </BreadcrumbItem>
                    {segs.map((seg, i) => {
                        const path = segs.slice(0, i + 1).join("/")
                        const isLast = i === segs.length - 1
                        return (
                            <Fragment key={path}>
                                <BreadcrumbSeparator className="mx-0.5 h-auto text-colorTextQuaternary" />
                                <BreadcrumbItem>
                                    {isLast ? (
                                        <BreadcrumbPage
                                            className={`flex h-auto items-center gap-1.5 px-1.5 py-[3px] ${isFile ? "" : "font-medium"}`}
                                        >
                                            {isFile ? (
                                                <DriveTypeMark path={path} size="mini" />
                                            ) : (
                                                <DriveFolderGlyph open size={15} />
                                            )}
                                            {seg}
                                        </BreadcrumbPage>
                                    ) : (
                                        <BreadcrumbLink asChild>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => onNavigate(path)}
                                                className={crumbLink}
                                            >
                                                <DriveFolderGlyph
                                                    open
                                                    size={15}
                                                    className="!text-current"
                                                />
                                                {seg}
                                            </Button>
                                        </BreadcrumbLink>
                                    )}
                                </BreadcrumbItem>
                            </Fragment>
                        )
                    })}
                </BreadcrumbList>
            </Breadcrumb>
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
