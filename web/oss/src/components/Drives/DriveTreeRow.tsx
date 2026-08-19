import {useEffect, useRef} from "react"

import {CaretDown, CaretRight, CircleNotch, FolderSimple} from "@phosphor-icons/react"

import {FOCUS_RING} from "./DriveFileRow"
import {driveFileIcon} from "./driveIcons"
import {humanSize, isHiddenPath, type DriveTreeNode} from "./driveTree"
import {OriginTag} from "./OriginTag"
import {type MountUploadItem} from "./useMountUpload"
import {fileOrigin} from "./useSessionDrive"

/** One tree row (folder or file), indented by depth; selection = fill + primary ring. Renders a
 * SINGLE row — the hierarchy is materialized by {@link flattenTree}, not recursion, so each row is
 * an independent virtualized item. */
export const TreeRow = ({
    node,
    depth,
    isOpen,
    selected,
    showOrigin,
    parent,
    scrollX,
    loading,
    onMeasureContent,
    pending,
    onRetryUpload,
    onDismissUpload,
    onToggle,
    onSelect,
}: {
    node: DriveTreeNode
    depth: number
    isOpen: boolean
    selected: boolean
    /** This folder is expanded and its children are still being fetched — swap the caret for a spinner. */
    loading?: boolean
    /** Tag top-level nodes with their origin (agent-files vs session) — only when mixed. */
    showOrigin?: boolean
    /** The parent folder path — the horizontal-scroll GROUP key (siblings share one offset). */
    parent: string
    /** This group's current horizontal offset, applied as a transform to the row's content. */
    scrollX: number
    /** Report this row's natural content width so the group can clamp its scroll. */
    onMeasureContent: (parent: string, width: number) => void
    /** This node is an in-flight upload — trailing status (spinner+% / Failed·Retry) after the name. */
    pending?: MountUploadItem
    onRetryUpload?: (id: string) => void
    onDismissUpload?: (id: string) => void
    onToggle: (path: string) => void
    onSelect: (path: string) => void
}) => {
    // Dot-prefixed (hidden) entries surface but dimmed, like a file browser greys .git/.claude.
    const hidden = isHiddenPath(node.path)
    const contentRef = useRef<HTMLDivElement>(null)
    // Measure the row's natural width once per node — the group takes the max across its siblings to
    // clamp how far it can scroll. Transform-driven scroll doesn't reflow, so this stays off the hot path.
    useEffect(() => {
        if (contentRef.current) onMeasureContent(parent, contentRef.current.scrollWidth)
    }, [parent, node.path, node.name, node.size, onMeasureContent])
    return (
        // The row background/selection spans the full (visible) width and CLIPS; the inner content is
        // translated by the group's shared offset — so a folder's children scroll together (siblings
        // move as one), while other folders and the vertical axis stay put. The WHOLE row is the click
        // target (select + toggle) — not just the text: clicks on the inner button bubble up here, and
        // the empty space to the right of a short name lands here directly. The caret stops propagation
        // so it stays a select-free collapse control. The inner button remains the keyboard focus stop
        // (Enter/Space fire a click that bubbles here), so a11y is unchanged.
        <div
            onClick={() => {
                onSelect(node.path)
                if (node.isFolder) onToggle(node.path)
            }}
            className={`w-full cursor-pointer overflow-hidden rounded transition-colors ${
                selected
                    ? "bg-colorFillSecondary shadow-[inset_0_0_0_1px_var(--ag-colorPrimary)]"
                    : pending
                      ? // Subtle primary tint marks a pending upload row, matching the grid tile.
                        "bg-[var(--ant-color-primary-bg)]"
                      : "hover:bg-colorFillTertiary"
            } ${hidden ? "opacity-60" : ""}`}
        >
            <div
                ref={contentRef}
                data-tree-row=""
                data-parent={parent}
                className="flex w-max items-center whitespace-nowrap"
                style={{paddingLeft: 6 + depth * 14, transform: `translateX(${-scrollX}px)`}}
            >
                {/* Caret and row both expand/collapse a folder. The caret ALSO stays a collapse-only
                    control that never touches the right-pane selection (collapse a folder while
                    previewing a file inside it and the preview stays); the row selects AND toggles. */}
                {node.isFolder && loading ? (
                    // Expanded + loading: a spinner where the caret sits, so the row itself shows the
                    // fetch is in flight (the shimmer child rows below fill the gap where files land).
                    <span className="flex w-4 shrink-0 items-center justify-center text-colorTextTertiary">
                        <CircleNotch size={10} className="animate-spin" />
                    </span>
                ) : node.isFolder ? (
                    <button
                        type="button"
                        // Not a tab stop — the row's main button is the single stop; arrow keys drive
                        // the rest. The caret stays mouse-clickable for expand/collapse.
                        tabIndex={-1}
                        aria-label={isOpen ? "Collapse folder" : "Expand folder"}
                        onClick={(e) => {
                            e.stopPropagation()
                            onToggle(node.path)
                        }}
                        className={`flex w-4 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-colorTextQuaternary hover:text-colorText ${FOCUS_RING}`}
                    >
                        {isOpen ? <CaretDown size={10} /> : <CaretRight size={10} />}
                    </button>
                ) : null}
                {/* Keyboard focus stop only — the click (mouse and Enter/Space) bubbles to the row
                    container above, which owns select + toggle for the whole row. */}
                <button
                    type="button"
                    data-tree-main=""
                    data-path={node.path}
                    className={`flex cursor-pointer items-center gap-1.5 border-0 bg-transparent py-1 pr-3 text-left text-xs ${FOCUS_RING} ${
                        node.isFolder ? "" : "pl-4"
                    }`}
                >
                    {node.isFolder ? (
                        <FolderSimple size={14} className="shrink-0 text-colorWarning" />
                    ) : (
                        <span className="shrink-0">{driveFileIcon(node.path)}</span>
                    )}
                    {/* Full name (no truncation): long/deep names are read by scrolling the GROUP. */}
                    <span className="font-mono" title={node.path}>
                        {node.name}
                    </span>
                    {/* Only the top-level items carry the tag; nested rows inherit it from their
                        (already-tagged) agent-files folder, so the tree stays quiet. */}
                    {showOrigin && depth === 0 ? (
                        <OriginTag origin={fileOrigin(node.path)} />
                    ) : null}
                    {/* Size flows right after the name (not right-aligned) — a right-aligned size would
                        sit off-screen at the group's scroll edge. */}
                    {!node.isFolder && !pending && node.size != null ? (
                        <span className="shrink-0 text-xs text-colorTextQuaternary">
                            {humanSize(node.size)}
                        </span>
                    ) : null}
                    {/* In-flight upload status, trailing the name — the row is otherwise a normal file row. */}
                    {pending && !pending.error && pending.percent < 100 ? (
                        <span className="flex shrink-0 items-center gap-1 text-xs text-colorTextTertiary">
                            <CircleNotch size={10} className="animate-spin" />
                            {pending.percent}%
                        </span>
                    ) : null}
                    {pending?.error ? (
                        <span className="flex shrink-0 items-center gap-1.5 text-xs">
                            <span className="text-colorError">Failed</span>
                            {onRetryUpload ? (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onRetryUpload(pending.id)
                                    }}
                                    className="cursor-pointer border-0 bg-transparent p-0 text-colorPrimary hover:underline"
                                >
                                    Retry
                                </button>
                            ) : null}
                            {onDismissUpload ? (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onDismissUpload(pending.id)
                                    }}
                                    className="cursor-pointer border-0 bg-transparent p-0 text-colorTextTertiary hover:underline"
                                >
                                    Dismiss
                                </button>
                            ) : null}
                        </span>
                    ) : null}
                </button>
            </div>
        </div>
    )
}

/** A shimmer placeholder row shown under a folder while its children load — indented to the child
 * depth and aligned to the file-row icon column, so real rows swap in without a shift. Not focusable
 * or selectable (it stands for rows that don't exist yet). */
export const TreeLoadingRow = ({depth, width = "58%"}: {depth: number; width?: string}) => (
    // Same box model as a real TreeRow line — `py-1` around a `text-xs` (16px) line — so the row
    // measures the SAME height and content swaps in with no shift. The bar sits in an h-4 line box.
    <div
        className="flex items-center gap-1.5 py-1"
        style={{paddingLeft: 6 + depth * 14 + 16}}
        aria-hidden
    >
        <div className="h-3.5 w-3.5 shrink-0 animate-pulse rounded bg-colorFillSecondary" />
        {/* `flex-1 min-w-0` gives the line box real width so the bar's % width is measured against it
            (without it the box shrink-wraps to 0 and the bar vanishes — only the icon square shows). */}
        <div className="flex h-4 min-w-0 flex-1 items-center">
            <div className="h-2.5 animate-pulse rounded bg-colorFillSecondary" style={{width}} />
        </div>
    </div>
)
