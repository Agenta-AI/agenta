/**
 * DriveFileRow — the ONE file-item shared across every drive surface (chat context rail, config
 * Files section, Runtime Files card, chat Files grid). Its look is gated behind `variant`:
 *
 *   row  (default) — compact list line: icon · name · trailing meta. Dense, dev-facing surfaces.
 *   card           — horizontal thumbnail: a FileThumb preview + name + folder/meta. The friendly
 *                    treatment for the chat rail (recent files a user recognises at a glance).
 *   tile           — vertical thumbnail for the Files grid (thumb on top, centred name + meta).
 *
 * card/tile render a real preview (image/video/pdf/text) via {@link FileThumb} and so need the
 * `file` + `mount`; without them they fall back to the kind icon. The "just changed" teal accent
 * shows as a left bar (row) or a ring (card/tile). Semantic tokens throughout so it sits correctly
 * on any surface. One component so every surface's file items align instead of drifting.
 */
import {type ReactNode} from "react"

import {type Mount} from "@agenta/entities/session"

import {driveFileIcon} from "./DriveDrawer"
import {FileThumb} from "./FileThumb"
import {type DriveRecentFile} from "./useSessionDrive"

// Agent-teal, matching the config self-commit indicator, for a file that just changed.
const AGENT_ACCENT = "var(--ag-c-13C2C2, #13c2c2)"

export type DriveFileVariant = "row" | "card" | "tile"

export const DriveFileRow = ({
    path,
    label,
    trailing,
    recent,
    onOpen,
    variant = "row",
    file,
    mount,
}: {
    path: string
    /** Main label; defaults to the basename. Pass the full relative path for the config surfaces. */
    label?: string
    /** Right-aligned (row) or secondary-line (card/tile) meta — size / relative time. */
    trailing?: ReactNode
    /** Highlight as just-changed (teal accent). */
    recent?: boolean
    onOpen: () => void
    /** Item look; see file header. Defaults to the compact row. */
    variant?: DriveFileVariant
    /** The file + its mount — required by the card/tile thumbnail preview. */
    file?: DriveRecentFile
    mount?: Mount | null
}) => {
    const name = label ?? path.split("/").pop() ?? path

    if (variant === "row") {
        return (
            <button
                type="button"
                onClick={onOpen}
                className="flex w-full cursor-pointer items-center gap-2 rounded border-0 bg-transparent px-1.5 py-1 text-left transition-colors hover:bg-colorFillTertiary"
                style={recent ? {boxShadow: `inset 2px 0 0 ${AGENT_ACCENT}`} : undefined}
            >
                <span className="shrink-0">{driveFileIcon(path)}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{name}</span>
                {trailing != null ? (
                    <span className="ml-auto shrink-0 text-[11px] text-colorTextTertiary">
                        {trailing}
                    </span>
                ) : null}
            </button>
        )
    }

    // card / tile — thumbnail-forward, "avg user friendly".
    const folder = path.includes("/") ? path.split("/").slice(0, -1).join("/") : null
    const thumb = file ? (
        <FileThumb file={file} mount={mount ?? null} />
    ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center rounded bg-colorFillTertiary">
            {driveFileIcon(path, 22)}
        </div>
    )
    const recentStyle = recent
        ? {borderColor: AGENT_ACCENT, boxShadow: `0 0 0 1px ${AGENT_ACCENT}`}
        : undefined
    const meta =
        folder || trailing != null ? (
            <>
                {folder ? <>{folder} · </> : null}
                {trailing}
            </>
        ) : null

    if (variant === "tile") {
        return (
            <button
                type="button"
                onClick={onOpen}
                className="flex cursor-pointer flex-col gap-2 rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-2 transition-colors hover:border-colorBorder hover:bg-colorFillTertiary"
                style={recentStyle}
            >
                {thumb}
                <span className="w-full truncate text-center font-mono text-xs">{name}</span>
                {meta ? (
                    <span className="w-full truncate text-center text-[11px] text-colorTextTertiary">
                        {meta}
                    </span>
                ) : null}
            </button>
        )
    }

    // card (horizontal)
    return (
        <button
            type="button"
            onClick={onOpen}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-1.5 text-left transition-colors hover:border-colorBorder hover:bg-colorFillTertiary"
            style={recentStyle}
        >
            <div className="w-16 shrink-0">{thumb}</div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-mono text-xs">{name}</span>
                {meta ? (
                    <span className="truncate text-[11px] text-colorTextTertiary">{meta}</span>
                ) : null}
            </div>
        </button>
    )
}
