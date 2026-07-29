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
import {type CSSProperties, type ReactNode} from "react"

import {type Mount} from "@agenta/entities/session"
import {ArrowClockwise, CircleNotch, FolderSimple} from "@phosphor-icons/react"
import {Tooltip} from "antd"

import {driveFileIcon} from "./driveIcons"
import {isHiddenPath} from "./driveTree"
import {FileThumb} from "./FileThumb"
import {AGENT_ACCENT, OriginTag} from "./OriginTag"
import {AGENT_FILES_DIR, fileOrigin, type DriveRecentFile} from "./useSessionDrive"

export type DriveFileVariant = "row" | "card" | "tile"

// Themed keyboard-focus ring (replaces the browser's default blue outline, which ignores the row's
// radius and reads harsh). Inset so it stays within the row bounds. Matches the PrettyJsonView rows.
// Exported so the non-DriveFileRow drive surfaces (tree rows, folder tiles) share one focus look.
export const FOCUS_RING =
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--ant-color-primary)]"

/**
 * DriveRetryButton — the retry affordance for a drive's errored state. Reads inline in the flow of the
 * surrounding copy ("Couldn't load files. ↻ Try again"): a retry glyph + link-toned text.
 *
 * ALIGNMENT: the button is `display:inline` (NOT inline-flex) so its TEXT sits on the copy's baseline
 * naturally — `inline-flex align-baseline` synthesises the container baseline as its bottom edge
 * (there's no baseline-aligned flex item), which floated the whole thing above the line. `[font:inherit]`
 * makes it take the copy's font (preflight is off → a raw `<button>` would otherwise fall back to the
 * UA default, Arial 13.3px vs the copy's Inter 12px). Only the ICON is nudged (`-0.15em`) to sit on the
 * text's optical centre. Warning tone (`colorWarning`, correct light AND dark) so it reads as the
 * action for a "couldn't load" state and sits as ONE unit with the amber warning glyph beside it —
 * not a competing blue link; hover underlines. Busy swaps the glyph for a spinner and reads "Loading…",
 * disabled so it can't double-fire.
 */
export const DriveRetryButton = ({onRetry, busy}: {onRetry: () => void; busy?: boolean}) => (
    <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        aria-busy={busy || undefined}
        aria-label="Try loading files again"
        className={`inline cursor-pointer whitespace-nowrap rounded-sm border-0 bg-transparent p-0 [font:inherit] text-colorWarning transition-colors hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-70 ${FOCUS_RING}`}
    >
        {busy ? (
            <CircleNotch size={13} className="mr-1 inline animate-spin align-[-0.15em]" />
        ) : (
            <ArrowClockwise size={13} className="mr-1 inline align-[-0.15em]" />
        )}
        {busy ? "Loading…" : "Try again"}
    </button>
)

/**
 * DriveWarningBadge — overlays a small amber dot on the drive-drawer TRIGGER's folder icon when a
 * mount failed but the drive still browses (`partialErrored`). It rides the folder glyph that's
 * already there (no separate element widening the row), reads as an "attention" notification, and
 * since the folder IS the drawer-opener, a tap reaches the drawer where the retry lives. Tooltip
 * carries the message. `show=false` → renders the children untouched (zero footprint when healthy).
 * `corner` dodges an existing corner badge (the collapsed rail's count pill sits top-right).
 */
export const DriveWarningBadge = ({
    show,
    corner = "tr",
    tooltip = true,
    children,
}: {
    show?: boolean
    corner?: "tr" | "br"
    /** Own tooltip. Set false when the wrapped trigger already has one (swap ITS title instead) so two
     * tooltips don't fire on the same target. */
    tooltip?: boolean
    children: ReactNode
}): ReactNode => {
    // Return the child verbatim when healthy — NOT a fragment, so an outer <Tooltip> still gets a
    // single ref-able element to wrap.
    if (!show) return children
    const pos = corner === "br" ? "-bottom-0.5 -right-0.5" : "-right-0.5 -top-0.5"
    const badged = (
        <span className="relative inline-flex shrink-0">
            {children}
            <span
                role="img"
                aria-label="Some files couldn’t be loaded"
                className={`absolute ${pos} h-2 w-2 rounded-full bg-colorWarning ring-1 ring-[var(--ag-colorBgContainer)]`}
            />
        </span>
    )
    return tooltip ? (
        <Tooltip title="Some files couldn’t be loaded — open to retry">{badged}</Tooltip>
    ) : (
        badged
    )
}

// "Just changed" border: a simple, muted accent border (no glow — it read wrong on dense file
// rows). List rows also drop their radius (square) so the accent reads as a crisp edge.
const RECENT_BORDER = `color-mix(in srgb, ${AGENT_ACCENT} 55%, transparent)`

// How many placeholder rows a loading summary list renders — a list, not a promise of a count. The
// summary surfaces (config Files, chat rail, Runtime Files) all show up to 5 recents but cap the
// skeleton lower so the resolve (skeletons → real rows) never has to shrink far.
export const SKELETON_ROW_COUNT = 3

// Shimmer placeholder. `bg-colorFillSecondary` reads as a quiet loading block on every surface tone.
const BAR = "animate-pulse rounded bg-colorFillSecondary"
// Varied name-bar widths so a skeleton list reads as real files, not a barcode. Indexed by row.
const SKELETON_NAME_WIDTHS = ["62%", "44%", "72%"]

export const DriveFileRow = ({
    path = "",
    trailing,
    recent,
    onOpen = () => {},
    variant = "row",
    file,
    mount,
    showOrigin,
    hideFolder,
    isFolder,
    staticThumb,
    loading,
    skeletonIndex = 0,
}: {
    /** Required unless `loading`. */
    path?: string
    /** Right-aligned (row) or secondary-line (card/tile) meta — size / relative time. */
    trailing?: ReactNode
    /** Highlight as just-changed (teal accent). */
    recent?: boolean
    /** Required unless `loading`. */
    onOpen?: () => void
    /** Item look; see file header. Defaults to the compact row. */
    variant?: DriveFileVariant
    /** The file + its mount — required by the card/tile thumbnail preview. */
    file?: DriveRecentFile
    mount?: Mount | null
    /** Show the agent/session origin tag. Pass true only when the drive holds both kinds. */
    showOrigin?: boolean
    /** Drop the folder from the card/tile meta — for the folder view, where every file shares the
     * (already-shown) current folder. */
    hideFolder?: boolean
    /** Render as a folder (folder glyph, no thumbnail preview) — the recency view rolls a whole
     * freshly-written directory into one such row. */
    isFolder?: boolean
    /** card/tile: draw the kind icon instead of fetching a content thumbnail — for the always-mounted
     * summary surfaces, so they don't read every recent file just to preview it. */
    staticThumb?: boolean
    /** Loading placeholder: same shell (dimensions/padding/border) as a real row of this variant, with
     * shimmer bars instead of content — so skeleton→real is a content swap with zero layout shift.
     * Non-interactive (aria-hidden, not a button). `path`/`onOpen` are ignored. */
    loading?: boolean
    /** Row position, only for the loading placeholder — varies the name-bar width so the list of
     * skeletons doesn't read as a barcode. */
    skeletonIndex?: number
}) => {
    if (loading) {
        const nameW = SKELETON_NAME_WIDTHS[skeletonIndex % SKELETON_NAME_WIDTHS.length]
        // ROW placeholder — reuses the real row's shell classes (minus button/hover/cursor) so the
        // padding, gap, transparent left-accent slot, and the `font-mono text-xs` line box that drives
        // the row height all match exactly. Bars sit inside those real containers.
        if (variant === "row") {
            return (
                <div
                    aria-hidden
                    className="flex w-full items-center gap-2 rounded border-y-0 border-l-2 border-r-0 border-solid border-transparent px-1.5 py-1"
                >
                    <span className={`h-3.5 w-3.5 shrink-0 ${BAR}`} />
                    <span className="flex min-w-0 flex-1 items-center font-mono text-xs">
                        <span
                            className={`inline-block h-2.5 align-middle ${BAR}`}
                            style={{width: nameW}}
                        />
                    </span>
                    <span className="shrink-0 text-[11px]">
                        <span className={`inline-block h-2.5 w-9 align-middle ${BAR}`} />
                    </span>
                </div>
            )
        }
        // TILE placeholder — the vertical grid tile (thumb on top + centred name + meta).
        if (variant === "tile") {
            return (
                <div
                    aria-hidden
                    className="flex w-full min-w-0 flex-col gap-2 rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-2"
                >
                    <div className={`aspect-[4/3] w-full ${BAR}`} />
                    <span className="flex h-4 items-center justify-center font-mono text-xs">
                        <span
                            className={`inline-block h-2.5 align-middle ${BAR}`}
                            style={{width: nameW}}
                        />
                    </span>
                    <span className="flex h-4 items-center justify-center text-[11px]">
                        <span className={`inline-block h-2 w-1/3 align-middle ${BAR}`} />
                    </span>
                </div>
            )
        }
        // CARD placeholder (horizontal) — thumb + two stacked meta bars.
        return (
            <div
                aria-hidden
                className="flex w-full items-center gap-2.5 rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-1.5"
            >
                <div className="w-16 shrink-0">
                    <div className={`aspect-[4/3] w-full ${BAR}`} />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-mono text-xs">
                        <span
                            className={`inline-block h-2.5 align-middle ${BAR}`}
                            style={{width: nameW}}
                        />
                    </span>
                    <span className="text-[11px]">
                        <span className={`inline-block h-2 w-1/3 align-middle ${BAR}`} />
                    </span>
                </div>
            </div>
        )
    }
    // Always the basename — folders never bloat the visible name (a nested/long path would
    // truncate the important tail). The full relative path is on the `title` tooltip instead.
    const name = path.split("/").pop() ?? path
    const origin = fileOrigin(path)
    // Dot-prefixed (hidden) files/folders are surfaced but dimmed, like a file browser greys .git.
    const hidden = isHiddenPath(path)
    const isFolderEntry = isFolder ?? file?.is_folder ?? false
    const kindIcon = (size: number) =>
        isFolderEntry ? (
            <FolderSimple size={size} weight="fill" className="text-colorWarning" />
        ) : (
            driveFileIcon(path, size)
        )

    if (variant === "row") {
        return (
            <button
                type="button"
                onClick={onOpen}
                className={`flex w-full cursor-pointer items-center gap-2 border-y-0 border-r-0 border-l-2 border-solid border-transparent bg-transparent px-1.5 py-1 text-left transition-colors hover:bg-colorFillTertiary ${FOCUS_RING} ${recent ? "rounded-none" : "rounded"} ${hidden ? "opacity-60" : ""}`}
                style={recent ? {borderLeftColor: RECENT_BORDER} : undefined}
            >
                <span className="shrink-0">{kindIcon(14)}</span>
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
    const folder = hideFolder
        ? null
        : showOrigin && origin === "agent"
          ? rawFolder === AGENT_FILES_DIR
              ? null
              : (rawFolder?.slice(AGENT_FILES_DIR.length + 1) ?? null)
          : rawFolder
    const thumb =
        file && !isFolderEntry ? (
            <FileThumb file={file} mount={mount ?? null} staticThumb={staticThumb} />
        ) : (
            <div className="flex aspect-[4/3] w-full items-center justify-center rounded bg-colorFillTertiary">
                {kindIcon(22)}
            </div>
        )
    // Just-changed on a card/tile: an accent on the LEFT edge only (matching the list rows); the
    // card keeps its rounded corners and its other borders stay the neutral secondary.
    const recentStyle: CSSProperties | undefined = recent
        ? {borderLeftColor: RECENT_BORDER}
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
                className={`flex w-full min-w-0 cursor-pointer flex-col gap-2 rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-2 transition-colors hover:border-colorBorder hover:bg-colorFillTertiary ${FOCUS_RING} ${hidden ? "opacity-60" : ""}`}
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
            className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-1.5 text-left transition-colors hover:border-colorBorder hover:bg-colorFillTertiary ${FOCUS_RING} ${hidden ? "opacity-60" : ""}`}
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
