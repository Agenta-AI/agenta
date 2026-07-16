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

import {driveFileIcon} from "./driveIcons"
import {isHiddenPath} from "./driveTree"
import {FileThumb} from "./FileThumb"
import {AGENT_ACCENT, OriginTag} from "./OriginTag"
import {AGENT_FILES_DIR, fileOrigin, type DriveRecentFile} from "./useSessionDrive"

export type DriveFileVariant = "row" | "card" | "tile"

export const DriveFileRow = ({
    path,
    trailing,
    recent,
    onOpen,
    variant = "row",
    file,
    mount,
    showOrigin,
}: {
    path: string
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
    /** Show the agent/session origin tag. Pass true only when the drive holds both kinds. */
    showOrigin?: boolean
}) => {
    // Always the basename — folders never bloat the visible name (a nested/long path would
    // truncate the important tail). The full relative path is on the `title` tooltip instead.
    const name = path.split("/").pop() ?? path
    const origin = fileOrigin(path)
    // Dot-prefixed (hidden) files/folders are surfaced but dimmed, like a file browser greys .git.
    const hidden = isHiddenPath(path)

    if (variant === "row") {
        return (
            <button
                type="button"
                onClick={onOpen}
                className={`flex w-full cursor-pointer items-center gap-2 rounded border-0 bg-transparent px-1.5 py-1 text-left transition-colors hover:bg-colorFillTertiary ${hidden ? "opacity-60" : ""}`}
                style={recent ? {boxShadow: `inset 2px 0 0 ${AGENT_ACCENT}`} : undefined}
            >
                <span className="shrink-0">{driveFileIcon(path)}</span>
                {/* Name + tag are one left-aligned group so the tag hugs the filename and the size
                    stays in its own right-aligned column (tagged and untagged rows line up). */}
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="min-w-0 truncate font-mono text-xs" title={path}>
                        {name}
                    </span>
                    {showOrigin ? <OriginTag origin={origin} /> : null}
                </span>
                {trailing != null ? (
                    <span className="shrink-0 text-right text-[11px] tabular-nums text-colorTextTertiary">
                        {trailing}
                    </span>
                ) : null}
            </button>
        )
    }

    // card / tile — thumbnail-forward, "avg user friendly". Agent files show their path relative to
    // `agent-files/` (the tag already conveys the origin); session files show their raw folder.
    const rawFolder = path.includes("/") ? path.split("/").slice(0, -1).join("/") : null
    // When the tag is shown, agent files drop the redundant `agent-files/` prefix (the tag conveys
    // it). Without the tag, keep the raw folder so the origin still reads from the path.
    const folder =
        showOrigin && origin === "agent"
            ? rawFolder === AGENT_FILES_DIR
                ? null
                : (rawFolder?.slice(AGENT_FILES_DIR.length + 1) ?? null)
            : rawFolder
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
        showOrigin || folder || trailing != null ? (
            <>
                {showOrigin ? (
                    <>
                        <OriginTag origin={origin} />{" "}
                    </>
                ) : null}
                {folder ? <>{folder} · </> : null}
                {trailing}
            </>
        ) : null

    if (variant === "tile") {
        return (
            // min-w-0 + w-full: without it the grid item's `min-width: auto` lets a long unbreakable
            // path (name or meta) expand the column past its track, which widens the tile and — since
            // the thumb is w-full aspect-[4/3] — blows its height up too. Constrained → truncation wins.
            <button
                type="button"
                onClick={onOpen}
                className={`flex w-full min-w-0 cursor-pointer flex-col gap-2 rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-2 transition-colors hover:border-colorBorder hover:bg-colorFillTertiary ${hidden ? "opacity-60" : ""}`}
                style={recentStyle}
            >
                {thumb}
                <span className="w-full truncate text-center font-mono text-xs" title={path}>
                    {name}
                </span>
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
            className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-1.5 text-left transition-colors hover:border-colorBorder hover:bg-colorFillTertiary ${hidden ? "opacity-60" : ""}`}
            style={recentStyle}
        >
            <div className="w-16 shrink-0">{thumb}</div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-mono text-xs" title={path}>
                    {name}
                </span>
                {meta ? (
                    <span className="truncate text-[11px] text-colorTextTertiary">{meta}</span>
                ) : null}
            </div>
        </button>
    )
}
