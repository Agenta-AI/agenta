/**
 * DriveExplorer — the heavy browsing body of the drive surfaces: search + file tree + breadcrumb +
 * metadata + Download + the kind-matched content viewer. Split into its OWN module so the drawer
 * shells can `next/dynamic`-import it: the tree/renderer/pdfjs/markdown graph then loads only when a
 * drawer actually opens, never with the always-mounted config panel or chat pane.
 *
 * The ONE drawer's body (via {@link FilesDrawer}) for BOTH hosts — the config panel and the chat pane
 * (chrome mode: renders its own single header). Also embeddable headerless. Phase 1 is read-only.
 */
import {
    type KeyboardEvent,
    type ReactNode,
    useCallback,
    useDeferredValue,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
} from "react"

import {type Mount} from "@agenta/entities/session"
import {CopyButton} from "@agenta/ui/components/presentational"
import {
    ArrowsIn,
    ArrowsOut,
    CaretDown,
    CaretRight,
    CircleNotch,
    DotsThree,
    DownloadSimple,
    Eye,
    EyeClosed,
    FileDashed,
    FolderSimple,
    GitBranch,
    House,
    Info,
    MagnifyingGlass,
    SidebarSimple,
    Tray,
    X,
} from "@phosphor-icons/react"
import {useVirtualizer} from "@tanstack/react-virtual"
import {
    Alert,
    App,
    Button,
    Dropdown,
    Input,
    type MenuProps,
    Segmented,
    Splitter,
    Tag,
    Tooltip,
    Typography,
} from "antd"
import {atom, useAtom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {AnimatePresence, motion} from "motion/react"

import {projectIdAtom} from "@/oss/state/project"

import {DriveExplorerSkeleton, TileGridSkeleton} from "./DriveExplorerSkeleton"
import {DriveFileRow, FOCUS_RING} from "./DriveFileRow"
import {driveFileIcon} from "./driveIcons"
import {
    DriveItemContextMenu,
    useCopyDrivePath,
    useCopyText,
    useDriveItemDownload,
} from "./DriveItemContextMenu"
import {resolveDriveFileKind} from "./driveKinds"
import {downloadMountArchive, downloadMountFile} from "./driveMedia"
import {useRepoInfo} from "./driveRepo"
import {
    ancestorPaths,
    buildDriveTree,
    filterDriveTree,
    humanSize,
    isHiddenPath,
    type DriveTreeNode,
} from "./driveTree"
import {DriveFileMetaList} from "./fileMeta"
import {ORIGIN_TIP, OriginTag} from "./OriginTag"
import {isRecentlyChanged, useRecentChangeClock} from "./recentChange"
import {DriveFileBody} from "./renderers"
import {DriveRepoMetaList} from "./repoMeta"
import {useLazyDriveTree} from "./useLazyDriveTree"
import {
    AGENT_FILES_DIR,
    driveHasMixedOrigins,
    fileOrigin,
    type FileOrigin,
    type SessionDriveData,
} from "./useSessionDrive"
import {VirtualTileGrid} from "./VirtualTileGrid"

const {Text} = Typography

/** The drive being inspected: the conversation drive (session) or the app/agent drive (app). */
export type DriveScope = "session" | "app"

/** A raw id surfaced behind the header's overflow menu (a copy affordance, not a label) — the
 * drive/mount id the drawer is about, plus the session/agent it belongs to. */
export interface DriveId {
    key: string
    label: string
    value: string
}

/** Last-viewed file per drive (keyed by mount id), so closing + reopening the drawer restores the
 * selection instead of resetting to the most-recent file. Module-level → survives the drawer's
 * destroyOnClose remount. */
const driveSelectionAtomFamily = atomFamily((_mountId: string) => atom<string | null>(null))

/** Breadcrumb root label. Mount slugs are the RESERVED form (`__ag__<uuid5>__cwd`) — surface
 * only the human tail ("cwd"), never the uuid (spec: raw ids stay out of labels). */
export const driveRootLabel = (mount: Mount | null): string =>
    mount?.slug?.split("__").filter(Boolean).pop() ?? "cwd"

/** Clickable path breadcrumb: each folder segment (and the home root) navigates via `onNavigate`
 * (a folder path, "" = root). The last segment is the current file/folder (plain). Scrolls
 * horizontally rather than truncating, so every part stays reachable. */
export const DriveBreadcrumb = ({
    shown,
    rootLabel,
    onNavigate,
}: {
    shown: string
    rootLabel: string
    onNavigate: (folderPath: string) => void
}) => {
    const segs = shown.split("/").filter(Boolean)
    return (
        <div
            className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap text-[11px] text-colorTextTertiary"
            title={shown}
        >
            <button
                type="button"
                onClick={() => onNavigate("")}
                aria-label={rootLabel}
                title={rootLabel}
                // Explicit text-[11px]: preflight is OFF, so <button>s DON'T inherit the parent
                // font-size — without this the clickable crumbs render larger than the current-crumb
                // span, so a segment appears to change size as you navigate (it becomes a button).
                className="flex shrink-0 cursor-pointer items-center gap-1 rounded border-0 bg-transparent p-0 text-[11px] text-colorTextTertiary hover:text-colorText"
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
                            <span className="font-mono text-[11px]">{seg}</span>
                        ) : (
                            // text-[11px]: preflight OFF → this <button> won't inherit 11px, so
                            // without it the ancestor crumbs render bigger than the current span.
                            <button
                                type="button"
                                onClick={() => onNavigate(path)}
                                className="cursor-pointer rounded border-0 bg-transparent p-0 font-mono text-[11px] text-colorTextTertiary hover:text-colorText hover:underline"
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

/** A visible tree row after {@link flattenTree}: the node plus its indentation depth. A `loading` row
 * is a synthetic shimmer placeholder shown UNDER a folder whose children are still being fetched — it
 * carries no real node (its `path` is a unique sentinel), only a depth + skeleton width. */
interface FlatTreeRow {
    node: DriveTreeNode
    depth: number
    loading?: boolean
    /** Skeleton bar width (%) for a `loading` row, varied so consecutive placeholders don't line up. */
    loadingWidth?: string
}

// Shimmer widths cycled across a loading folder's placeholder rows (so they read as a real list).
const LOADING_WIDTHS = ["58%", "44%", "66%", "48%", "62%", "40%", "54%"]
// Reserve ONE skeleton per expected child (up to this cap) so the placeholders occupy the SAME space
// the real rows will — the load then swaps content in place with no block-height jump. Capped so a huge
// folder doesn't render a wall of shimmer (its overflow rows are virtualized/off-screen anyway).
const SKELETON_ROW_CAP = 24

// Shared empty set — the "no dir just loaded" sentinel, so a render that reveals nothing allocates none.
const EMPTY_STR_SET: ReadonlySet<string> = new Set<string>()

/** Flatten the tree to only the rows currently VISIBLE (a folder's children appear only when it's
 * expanded), pre-tagged with depth. This is what the virtualizer windows — so the DOM never holds
 * more than a screenful of rows even when a 12k-entry folder is expanded (issue #5367).
 *
 * When an expanded folder's children haven't arrived yet (lazy load in flight, `isDirLoading`), a few
 * shimmer placeholder rows stand in — so expanding a slow folder shows immediate progress instead of
 * an empty gap that feels stuck until the files pop in. */
const flattenTree = (
    nodes: DriveTreeNode[],
    expanded: Set<string>,
    isDirLoading?: (path: string) => boolean,
): FlatTreeRow[] => {
    const out: FlatTreeRow[] = []
    const walk = (list: DriveTreeNode[], depth: number) => {
        for (const n of list) {
            out.push({node: n, depth})
            if (!n.isFolder || !expanded.has(n.path)) continue
            if (n.children.length) {
                walk(n.children, depth + 1)
            } else if (isDirLoading?.(n.path)) {
                // Not-yet-loaded expanded folder → ONE skeleton per expected child (capped), so the
                // placeholders reserve the real rows' space and the load swaps in place (no height jump).
                const count = Math.min(Math.max(1, n.itemCount ?? 3), SKELETON_ROW_CAP)
                for (let k = 0; k < count; k++) {
                    out.push({
                        node: {
                            name: "",
                            path: `${n.path}::loading:${k}`,
                            isFolder: false,
                            children: [],
                        },
                        depth: depth + 1,
                        loading: true,
                        loadingWidth: LOADING_WIDTHS[k % LOADING_WIDTHS.length],
                    })
                }
            }
        }
    }
    walk(nodes, 0)
    return out
}

/** One tree row (folder or file), indented by depth; selection = fill + primary ring. Renders a
 * SINGLE row — the hierarchy is materialized by {@link flattenTree}, not recursion, so each row is
 * an independent virtualized item. */
const TreeRow = ({
    node,
    depth,
    isOpen,
    selected,
    showOrigin,
    parent,
    scrollX,
    loading,
    onMeasureContent,
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
                    {!node.isFolder && node.size != null ? (
                        <span className="shrink-0 text-[11px] text-colorTextQuaternary">
                            {humanSize(node.size)}
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
const TreeLoadingRow = ({depth, width = "58%"}: {depth: number; width?: string}) => (
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

/** A row's horizontal-scroll GROUP key = its parent folder path ("" for a top-level row). */
const parentOf = (path: string): string => {
    const i = path.lastIndexOf("/")
    return i < 0 ? "" : path.slice(0, i)
}

/** The content viewer — the renderer registry (build-spec 3): kind-matched body, size caps,
 * Download fallback. Shared by the drawer preview and the chat Quick Look.
 *
 * Crossfade keyed by KIND, not path: switching between files of the same type reconciles the same
 * body in place (unchanged, smooth); switching types swaps the body component entirely (image →
 * markdown), which without this reads as a hard cut. Fading the old kind out and the new one in
 * (`mode="wait"` avoids overlapping two variable-height bodies) turns that swap into a replace. */
export const DriveFileContentViewer = ({
    mount,
    path,
    size,
    displayPath,
    onNavigate,
}: {
    mount: Mount | null
    path: string
    size?: number | null
    /** Presented path + navigate callback — used by the HTML preview to route internal links. */
    displayPath?: string
    onNavigate?: (path: string) => void
}) => {
    const kind = resolveDriveFileKind(path)
    return (
        <AnimatePresence mode="wait" initial={false}>
            <motion.div
                key={kind}
                initial={{opacity: 0}}
                animate={{opacity: 1}}
                exit={{opacity: 0}}
                transition={{duration: 0.15}}
                className="flex min-h-0 flex-1 flex-col"
            >
                <DriveFileBody
                    mount={mount}
                    path={path}
                    size={size}
                    displayPath={displayPath}
                    onNavigate={onNavigate}
                />
            </motion.div>
        </AnimatePresence>
    )
}

/** Download button for one file — raw bytes, so every type round-trips (not just text). */
export const DriveFileDownloadButton = ({mount, path}: {mount: Mount | null; path: string}) => {
    const projectId = useAtomValue(projectIdAtom)
    return (
        <Button
            icon={<DownloadSimple size={13} />}
            disabled={!mount}
            onClick={() => void downloadMountFile({mount, path, projectId})}
        >
            Download
        </Button>
    )
}

/** Right pane: a FIXED header (breadcrumb + name + copy/details/download actions + expandable
 * metadata) over a scrollable content viewer — same shape and interactions as the chat single-file
 * view, so the file info never scrolls away with the content. */
const DriveFilePreview = ({
    mount,
    path,
    displayPath,
    rootLabel,
    showOrigin,
    touchedAt,
    size,
    hideHeader,
    detailsOpen,
    onSelect,
}: {
    mount: Mount | null
    /** Path relative to `mount` — used for reading (content/meta/download). */
    path: string
    /** Path as shown to the user (with the `agent-files/` prefix) — used for the breadcrumb + name.
     * Defaults to `path` when the file is in the cwd mount. */
    displayPath?: string
    rootLabel: string
    /** Tag the file's origin next to its name — only when the drive holds both kinds. */
    showOrigin?: boolean
    touchedAt?: number
    size?: number
    /** Chrome mode: the drawer's single header owns the breadcrumb/name/actions, so drop this pane's
     * header band — render only the meta grid (when `detailsOpen`) above the content viewer. */
    hideHeader?: boolean
    detailsOpen?: boolean
    /** Navigate to a folder (breadcrumb) or file — same selection callback the tree uses. */
    onSelect: (path: string) => void
}) => {
    const shown = displayPath ?? path
    const name = shown.split("/").pop() ?? shown
    const [metaExpanded, setMetaExpanded] = useState(false)
    const metaOpen = hideHeader ? Boolean(detailsOpen) : metaExpanded

    return (
        // h-full (NOT flex-1): the Splitter.Panel isn't a flex parent, so flex-1 gives no bounded
        // height — the pane would grow to content and scroll the header away. h-full pins it to the
        // panel so the header stays and only the content viewer scrolls (mirrors the tree pane).
        <div className="flex h-full min-h-0 w-full flex-col">
            {hideHeader ? (
                // Chrome mode: no header band — just the meta grid when the header's toggle is on.
                // AnimatePresence owns the mount/unmount so the padded band collapses on close; the
                // border/padding sit inside the overflow-hidden reveal so they fold away with it.
                <AnimatePresence initial={false}>
                    {metaOpen ? (
                        <motion.div
                            key="file-meta"
                            {...META_REVEAL}
                            className="shrink-0 overflow-hidden"
                        >
                            <div className="border-0 border-b border-solid border-colorBorderSecondary px-4 py-3">
                                <DriveFileMetaList
                                    mount={mount}
                                    path={path}
                                    size={size}
                                    touchedAt={touchedAt}
                                    expanded
                                />
                            </div>
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            ) : (
                // Fixed header (breadcrumb + name + actions + metadata) — stays put while the content
                // scrolls; the action cluster [copy · details · download] matches the chat file view.
                <div className="flex shrink-0 flex-col gap-2 border-0 border-b border-solid border-colorBorderSecondary p-4 pb-3">
                    <DriveBreadcrumb shown={shown} rootLabel={rootLabel} onNavigate={onSelect} />

                    <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-mono text-[13px] font-semibold">
                                {name}
                            </span>
                            {showOrigin ? <OriginTag origin={fileOrigin(shown)} /> : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            <Tooltip title="Copy path">
                                <CopyButton
                                    text={shown}
                                    buttonText={null}
                                    icon
                                    size="small"
                                    aria-label="Copy file path"
                                    successMessage=""
                                    className="!h-7 !w-7 !p-0 !text-colorTextTertiary hover:!text-colorText"
                                />
                            </Tooltip>
                            <Tooltip title="File details">
                                <Button
                                    type="text"
                                    size="small"
                                    aria-label="File details"
                                    aria-pressed={metaExpanded}
                                    onClick={() => setMetaExpanded((v) => !v)}
                                    icon={
                                        <Info
                                            size={16}
                                            weight={metaExpanded ? "fill" : "regular"}
                                        />
                                    }
                                    className={`!h-7 !w-7 !p-0 ${metaExpanded ? "!text-colorPrimary" : "!text-colorTextTertiary hover:!text-colorText"}`}
                                />
                            </Tooltip>
                            <DriveFileDownloadButton mount={mount} path={path} />
                        </div>
                    </div>

                    <DriveFileMetaList
                        mount={mount}
                        path={path}
                        size={size}
                        touchedAt={touchedAt}
                        expanded={metaExpanded}
                    />
                </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col p-4 pt-3">
                <DriveFileContentViewer
                    mount={mount}
                    path={path}
                    size={size}
                    displayPath={shown}
                    onNavigate={onSelect}
                />
            </div>
        </div>
    )
}

/** A subfolder tile — same shape as the file tile (4:3 icon "thumbnail" + name + meta) so folders
 * and files form ONE uniform grid instead of short folder cards stretching to the file-tile height. */
/** True only after `active` has held for `ms` — so a fast load (data back in <ms) never flashes the
 * loading state; it just crossfades straight to the content. Cancels cleanly on unmount/toggle. */
const useDelayedTrue = (active: boolean, ms: number): boolean => {
    const [on, setOn] = useState(false)
    useEffect(() => {
        if (!active) {
            setOn(false)
            return
        }
        const t = window.setTimeout(() => setOn(true), ms)
        return () => window.clearTimeout(t)
    }, [active, ms])
    return on
}

// One fade for every folder-pane state swap — crossfaded (absolute, overlapping) so nothing hard-cuts.
const PANE_FADE = {
    initial: {opacity: 0},
    animate: {opacity: 1},
    exit: {opacity: 0},
    transition: {duration: 0.16, ease: [0.4, 0, 0.2, 1] as const},
}

// Row/tile ENTRANCE when a level first reveals: a quick UNIFORM opacity fade — no per-item stagger
// (reads as "too much" on a big folder) and no y-shift (which fought the block reshuffling). Because
// the placeholders reserved the space + match height, the real content just fades in over the same
// slots — a crossfade in feel, not a two-step "skeleton gone → items appear". `on=false` → no animation
// (mounts at rest), so scrolling a virtualized row into view never replays it.
const revealFade = (on: boolean) => ({
    initial: on ? {opacity: 0} : false,
    animate: {opacity: 1},
    transition: {duration: 0.18, ease: [0.4, 0, 0.2, 1] as const},
})

// Height+fade reveal for the header's detail panels (file meta / repo meta) as the toggle mounts and
// unmounts them — the enclosing `AnimatePresence` defers the unmount so the collapse plays out.
const META_REVEAL = {
    initial: {height: 0, opacity: 0},
    animate: {height: "auto", opacity: 1},
    exit: {height: 0, opacity: 0},
    transition: {duration: 0.2, ease: [0.4, 0, 0.2, 1] as const},
}

export const FolderTile = ({node, onOpen}: {node: DriveTreeNode; onOpen: () => void}) => {
    const hidden = isHiddenPath(node.path)
    // Backend count when the folder's own level hasn't loaded yet (lazy); else the loaded children.
    const count = node.itemCount ?? node.children.length
    return (
        <button
            type="button"
            onClick={onOpen}
            className={`flex w-full min-w-0 cursor-pointer flex-col gap-2 rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-2 transition-colors hover:border-colorBorder hover:bg-colorFillTertiary ${FOCUS_RING} ${hidden ? "opacity-60" : ""}`}
        >
            <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded bg-colorFillTertiary">
                <FolderSimple size={40} weight="fill" className="text-colorWarning" />
            </div>
            <span className="w-full truncate text-center font-mono text-xs" title={node.path}>
                {node.name}
            </span>
            <span className="w-full truncate text-center text-[11px] text-colorTextTertiary">
                {count} item{count === 1 ? "" : "s"}
            </span>
        </button>
    )
}

/** Right pane when a FOLDER is selected: fixed header (clickable breadcrumb + folder name) over a
 * grid of the folder's immediate children — subfolders drill in, files open the preview. Reuses the
 * chat grid's file tile (DriveFileRow). */
const FolderView = ({
    folderPath,
    nodes,
    rootLabel,
    drive,
    showOrigin,
    loading,
    hideHeader,
    detailsOpen,
    autoFocus,
    onSelect,
}: {
    folderPath: string
    nodes: DriveTreeNode[]
    rootLabel: string
    drive: SessionDriveData
    showOrigin: boolean
    /** This folder's level is still loading (lazy) — show the tile skeleton, not "Empty folder". */
    loading?: boolean
    /** Chrome mode: the drawer's single header owns the breadcrumb/name/repo toggle, so drop this
     * pane's header band — render only the repo meta (when `detailsOpen`) above the grid. */
    hideHeader?: boolean
    detailsOpen?: boolean
    /** Focus the first tile on mount (grid is the primary nav — not the list view's right pane). */
    autoFocus?: boolean
    onSelect: (path: string) => void
}) => {
    const now = useRecentChangeClock(drive.lastTouchedAt)
    const copyPath = useCopyDrivePath()
    const download = useDriveItemDownload(drive)
    const recentsByPath = useMemo(
        () => new Map(drive.recents.map((f) => [f.path, f])),
        [drive.recents],
    )
    const folderName = folderPath === "" ? rootLabel : (folderPath.split("/").pop() ?? folderPath)
    // Which mount + mount-relative path backs this folder, so the repo probe reads its `.git`.
    const resolvedFolder = drive.resolveMount(folderPath)
    // Git facts, probed on demand (self-null for a non-repo folder). Its details render like the
    // file preview's metadata — a bare grid behind a header toggle, NOT an always-on card.
    const repo = useRepoInfo(resolvedFolder?.mount ?? null, resolvedFolder?.path ?? "", true)
    const [repoExpanded, setRepoExpanded] = useState(false)
    // Folders first (matching the tree's sort), then files — one combined list so the grid windows
    // uniformly even when a folder holds thousands of immediate children.
    const entries = useMemo(
        () => [...nodes].sort((a, b) => (a.isFolder === b.isFolder ? 0 : a.isFolder ? -1 : 1)),
        [nodes],
    )
    // Only surface the skeleton if the level is genuinely slow to load (>140ms); a quick load skips
    // straight to the grid so the user never sees a one-frame skeleton flash.
    const showSkeleton = useDelayedTrue(Boolean(loading) && nodes.length === 0, 140)

    // Which meta-open state drives the repo panel: the drawer's single header (chrome) or this pane's
    // own toggle (embedded). One expression so the panel reads the same in both modes.
    const repoOpen = hideHeader ? Boolean(detailsOpen) : repoExpanded

    // One-shot stagger gate for the tile grid — true ONLY on the render where this folder+view's content
    // first appears (folder nav or skeleton→grid), so the tiles cascade in; empty on every render after,
    // so the virtualizer's scroll remounts never replay it (mirrors the tree's reveal). StrictMode-safe:
    // the ref advances in an effect, not during render, so the diff doesn't cancel itself out.
    const gridRevealKey = entries.length > 0 ? `${folderPath}:grid` : null
    const prevGridRevealRef = useRef<string | null>(null)
    const gridRevealNow = gridRevealKey !== null && gridRevealKey !== prevGridRevealRef.current
    useEffect(() => {
        prevGridRevealRef.current = gridRevealKey
    }, [gridRevealKey])

    return (
        <div className="flex h-full min-h-0 w-full flex-col">
            {hideHeader ? (
                // Chrome mode: no header band — just the repo meta when the header's toggle is on.
                // AnimatePresence owns the mount/unmount so the bordered band collapses on close.
                <AnimatePresence initial={false}>
                    {repo.isRepo && repoOpen ? (
                        <motion.div
                            key="repo-meta"
                            {...META_REVEAL}
                            className="shrink-0 overflow-hidden"
                        >
                            <div className="border-0 border-b border-solid border-colorBorderSecondary px-4 py-3">
                                <DriveRepoMetaList info={repo} expanded />
                            </div>
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            ) : (
                <div className="flex shrink-0 flex-col gap-2 border-0 border-b border-solid border-colorBorderSecondary p-4 pb-3">
                    <DriveBreadcrumb
                        shown={folderPath}
                        rootLabel={rootLabel}
                        onNavigate={onSelect}
                    />
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                            <FolderSimple
                                size={16}
                                weight="fill"
                                className="shrink-0 text-colorWarning"
                            />
                            <span className="truncate font-mono text-[13px] font-semibold">
                                {folderName}
                            </span>
                            <span className="shrink-0 text-[11px] text-colorTextTertiary">
                                {nodes.length} item{nodes.length === 1 ? "" : "s"}
                            </span>
                        </div>
                        {/* Action cluster — Copy path mirrors the file preview header; repo-details
                            toggle joins it when this folder is a git repo. Root ("") has no path. */}
                        <div className="flex shrink-0 items-center gap-1">
                            {folderPath ? (
                                <Tooltip title="Copy path">
                                    <CopyButton
                                        text={folderPath}
                                        buttonText={null}
                                        icon
                                        size="small"
                                        aria-label="Copy folder path"
                                        successMessage=""
                                        className="!h-7 !w-7 !p-0 !text-colorTextTertiary hover:!text-colorText"
                                    />
                                </Tooltip>
                            ) : null}
                            {repo.isRepo ? (
                                <Tooltip title="Repository details">
                                    <Button
                                        type="text"
                                        aria-label="Repository details"
                                        aria-pressed={repoExpanded}
                                        onClick={() => setRepoExpanded((v) => !v)}
                                        icon={
                                            <GitBranch
                                                size={16}
                                                weight={repoExpanded ? "fill" : "regular"}
                                            />
                                        }
                                        className={`!h-7 !w-7 !p-0 ${
                                            repoExpanded
                                                ? "!text-colorPrimary"
                                                : "!text-colorTextTertiary hover:!text-colorText"
                                        }`}
                                    />
                                </Tooltip>
                            ) : null}
                        </div>
                    </div>
                    <DriveRepoMetaList info={repo} expanded={repoExpanded} />
                </div>
            )}

            {/* The content region crossfades between its states (absolute + overlapping), so a folder
                swap or skeleton→grid never hard-cuts. The skeleton is DELAYED — a fast load skips it
                entirely and the grid fades straight in from the previous folder. */}
            <div className="relative min-h-0 flex-1">
                <AnimatePresence initial={false}>
                    {nodes.length > 0 ? (
                        <motion.div
                            key={`grid:${folderPath}`}
                            className="absolute inset-0 flex min-h-0 flex-col"
                            // No container fade-in — the tiles carry the entrance (staggered below), so
                            // the reveal doesn't double up opacity. Still fades OUT on leave, so
                            // folder→folder and grid→skeleton stay crossfaded.
                            initial={false}
                            animate={{opacity: 1}}
                            exit={{opacity: 0}}
                            transition={PANE_FADE.transition}
                        >
                            <VirtualTileGrid
                                items={entries}
                                autoFocus={autoFocus}
                                autoFocusKey={folderPath}
                                // Responsive tiles, windowed so a folder with thousands of children
                                // stays smooth.
                                minColumnWidth={200}
                                estimateRowHeight={180}
                                gap={8}
                                className="p-4"
                                // Arrow keys rove the tiles (handled in VirtualTileGrid); Cmd/Ctrl+↓
                                // opens the focused item (folder → drill in, file → preview), Cmd/Ctrl+↑
                                // steps OUT to the current folder's parent (Finder-style).
                                onMetaActivate={(n) => onSelect(n.path)}
                                onMetaBack={() => onSelect(parentOf(folderPath))}
                                getKey={(n) => n.path}
                                renderTile={(n) => {
                                    const open = () => onSelect(n.path)
                                    const file = recentsByPath.get(n.path)
                                    const resolved = drive.resolveMount(n.path)
                                    const content = n.isFolder ? (
                                        <DriveItemContextMenu
                                            path={n.path}
                                            isFolder
                                            onOpen={open}
                                            onCopyPath={copyPath}
                                            onDownload={download}
                                        >
                                            <FolderTile node={n} onOpen={open} />
                                        </DriveItemContextMenu>
                                    ) : (
                                        <DriveItemContextMenu
                                            path={n.path}
                                            isFolder={false}
                                            onOpen={open}
                                            onCopyPath={copyPath}
                                            onDownload={download}
                                        >
                                            <DriveFileRow
                                                variant="tile"
                                                path={n.path}
                                                file={
                                                    resolved && file
                                                        ? {...file, path: resolved.path}
                                                        : file
                                                }
                                                mount={resolved?.mount ?? drive.mount}
                                                showOrigin={showOrigin}
                                                hideFolder
                                                trailing={humanSize(n.size)}
                                                recent={
                                                    file
                                                        ? isRecentlyChanged(file.touchedAt, now)
                                                        : false
                                                }
                                                onOpen={open}
                                            />
                                        </DriveItemContextMenu>
                                    )
                                    // One-shot staggered entrance (see gridRevealNow) — cascades the
                                    // tiles in by index when the level first reveals; `min-w-0` keeps
                                    // the wrapper a shrinkable grid cell so tiles don't overflow.
                                    return (
                                        <motion.div
                                            className="min-w-0"
                                            {...revealFade(gridRevealNow)}
                                        >
                                            {content}
                                        </motion.div>
                                    )
                                }}
                            />
                        </motion.div>
                    ) : showSkeleton ? (
                        <motion.div
                            key="skel"
                            className="absolute inset-0 flex min-h-0 flex-col"
                            {...PANE_FADE}
                        >
                            <TileGridSkeleton className="p-4" />
                        </motion.div>
                    ) : loading ? null : (
                        <motion.div
                            key="empty"
                            className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-8 text-center"
                            {...PANE_FADE}
                        >
                            <Tray size={26} className="text-colorTextQuaternary" />
                            <div className="text-xs font-medium">Empty folder</div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    )
}

/**
 * DriveHeader — the drawer's ONE header. The breadcrumb IS the header (its last crumb the current
 * node), a count/size chip beside it; contextual actions on the right (copy path, a details toggle,
 * download the file), with drive-level bits (raw ids, Download all) folded into the overflow menu.
 * The right/content pane then renders with no header of its own.
 */
const DriveHeader = ({
    selectedPath,
    isFolder,
    rootLabel,
    itemCount,
    totalCount,
    totalCapped,
    fileSize,
    showOrigin,
    isRepo,
    detailsOpen,
    onToggleDetails,
    onNavigate,
    onClose,
    copyText,
    ids,
    downloadMount,
    downloadPath,
    projectId,
    onDownloadAll,
    downloadingAll,
    expanded,
    onToggleExpand,
}: {
    selectedPath: string | null
    isFolder: boolean
    rootLabel: string
    /** Immediate-child count for a non-root folder (null when unknown / at root). */
    itemCount: number | null
    /** Whole-drive file count — the chip at the root, preserving the old "N files". */
    totalCount: number
    totalCapped?: boolean
    fileSize?: number
    showOrigin: boolean
    /** This folder is a git repo → the details toggle reveals repo facts (else file details). */
    isRepo: boolean
    detailsOpen: boolean
    onToggleDetails: () => void
    onNavigate: (path: string) => void
    onClose: () => void
    copyText: (text: string, successMessage?: string) => void
    ids: DriveId[]
    downloadMount: Mount | null
    downloadPath: string
    projectId: string | null
    /** Download the whole drive as a zip (the overflow "Download all"); omitted → item disabled. */
    onDownloadAll?: () => void
    downloadingAll?: boolean
    /** Drawer at expanded (near-full) width — the header's expand toggle reflects/flips this. Omit to
     * hide the toggle (embedded/non-drawer hosts that don't own the drawer width). */
    expanded?: boolean
    onToggleExpand?: () => void
}) => {
    const atRoot = !selectedPath
    // A file always has details (size/modified); a folder only when it's a repo. Nothing selected
    // (transient null before the root auto-selects) → no toggle.
    const hasDetails = isFolder ? isRepo : selectedPath != null
    const overflow: MenuProps["items"] = [
        ...ids.map((id) => ({
            key: id.key,
            label: (
                <div className="flex flex-col gap-0.5 py-0.5">
                    <span className="text-xs font-medium">Copy {id.label}</span>
                    <span className="font-mono text-[10px] text-colorTextTertiary">{id.value}</span>
                </div>
            ),
        })),
        {type: "divider" as const},
        {
            key: "download-all",
            label: downloadingAll ? "Preparing download…" : "Download all",
            icon: <DownloadSimple size={14} />,
            disabled: !onDownloadAll || downloadingAll,
        },
    ]
    return (
        <div className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-colorBorderSecondary px-3 py-2">
            <Tooltip title="Close">
                <Button
                    type="text"
                    aria-label="Close"
                    icon={<X size={16} />}
                    onClick={onClose}
                    className="!h-7 !w-7 !p-0 !text-colorTextSecondary hover:!text-colorText"
                />
            </Tooltip>
            {onToggleExpand ? (
                <Tooltip title={expanded ? "Collapse" : "Expand"}>
                    <Button
                        type="text"
                        aria-label={expanded ? "Collapse drawer" : "Expand drawer"}
                        aria-pressed={expanded}
                        icon={expanded ? <ArrowsIn size={16} /> : <ArrowsOut size={16} />}
                        onClick={onToggleExpand}
                        className="!h-7 !w-7 !p-0 !text-colorTextSecondary hover:!text-colorText"
                    />
                </Tooltip>
            ) : null}
            {/* Breadcrumb takes the slack and scrolls when the path is long; the chip stays pinned. */}
            <div className="flex min-w-0 flex-1 items-center gap-2">
                <DriveBreadcrumb
                    shown={selectedPath ?? ""}
                    rootLabel={rootLabel}
                    onNavigate={onNavigate}
                />
                <span className="shrink-0 text-[11px] text-colorTextTertiary">
                    {atRoot
                        ? `${totalCount}${totalCapped ? "+" : ""} file${totalCount === 1 ? "" : "s"}`
                        : isFolder
                          ? itemCount != null
                              ? `${itemCount} item${itemCount === 1 ? "" : "s"}`
                              : null
                          : fileSize != null
                            ? humanSize(fileSize)
                            : null}
                </span>
                {!isFolder && showOrigin && selectedPath ? (
                    <Tag className="m-0 shrink-0 text-[10px] font-normal">
                        {fileOrigin(selectedPath) === "agent" ? "Agent" : "Session"}
                    </Tag>
                ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
                {selectedPath ? (
                    <Tooltip title="Copy path">
                        <CopyButton
                            text={selectedPath}
                            buttonText={null}
                            icon
                            size="small"
                            aria-label="Copy path"
                            successMessage=""
                            className="!h-7 !w-7 !p-0 !text-colorTextTertiary hover:!text-colorText"
                        />
                    </Tooltip>
                ) : null}
                {hasDetails ? (
                    <Tooltip title={isFolder ? "Repository details" : "File details"}>
                        <Button
                            type="text"
                            aria-label={isFolder ? "Repository details" : "File details"}
                            aria-pressed={detailsOpen}
                            onClick={onToggleDetails}
                            icon={
                                isFolder ? (
                                    <GitBranch
                                        size={16}
                                        weight={detailsOpen ? "fill" : "regular"}
                                    />
                                ) : (
                                    <Info size={16} weight={detailsOpen ? "fill" : "regular"} />
                                )
                            }
                            className={`!h-7 !w-7 !p-0 ${detailsOpen ? "!text-colorPrimary" : "!text-colorTextTertiary hover:!text-colorText"}`}
                        />
                    </Tooltip>
                ) : null}
                {!isFolder && selectedPath ? (
                    <Button
                        icon={<DownloadSimple size={13} />}
                        disabled={!downloadMount}
                        onClick={() =>
                            void downloadMountFile({
                                mount: downloadMount,
                                path: downloadPath,
                                projectId,
                            })
                        }
                    >
                        Download
                    </Button>
                ) : null}
                <Dropdown
                    trigger={["click"]}
                    menu={{
                        items: overflow,
                        onClick: ({key}) => {
                            if (key === "download-all") return onDownloadAll?.()
                            const hit = ids.find((id) => id.key === key)
                            if (hit) copyText(hit.value, `${hit.label} copied`)
                        },
                    }}
                >
                    <Button
                        type="text"
                        aria-label="More actions"
                        icon={<DotsThree size={18} weight="bold" />}
                        className="!h-7 !w-7 !p-0 !text-colorTextTertiary hover:!text-colorText"
                    />
                </Dropdown>
            </div>
        </div>
    )
}

/**
 * The browsing body — loading/empty/error states + the two-pane search/tree/preview. Owns its
 * selection state; initialize with `initialPath` (callers remount per open, so mount-time init
 * is the reset).
 */
export function DriveExplorer({
    drive,
    scope = "session",
    initialPath,
    onClose,
    driveIds,
    expanded: drawerExpanded = false,
    onToggleExpand,
}: {
    drive: SessionDriveData
    scope?: DriveScope
    initialPath?: string | null
    /** When provided, the explorer renders its OWN single header (breadcrumb + node + actions + this
     * close button) + the shared search/filters toolbar. Always provided by {@link FilesDrawer}. */
    onClose?: () => void
    /** Raw ids for the header's overflow menu (drive id + session/agent id). */
    driveIds?: DriveId[]
    /** The host drawer is at expanded (near-full) width — reflected by the header's expand toggle. */
    expanded?: boolean
    onToggleExpand?: () => void
}) {
    const rootLabel = driveRootLabel(drive.mount)
    // Restore the last-viewed file on (re)mount: explicit initialPath wins, else the persisted
    // per-drive selection, else null (the effect below picks the most-recent).
    const [persistedSelection, setPersistedSelection] = useAtom(
        driveSelectionAtomFamily(drive.mount?.id ?? ""),
    )
    // Search + filters live in the drawer's shared toolbar (the header row 2). Self-managed here.
    const [search, setSearch] = useState("")
    const [originFilter, setInternalOrigin] = useState<"all" | FileOrigin>("all")
    const [showHidden, setInternalShowHidden] = useState(true)
    // Show `.gitignore`-matched files (node_modules, build output, …). Off by default — the toggle
    // only appears when we're inside a git repo (see `inGitScope`).
    const [showGitignored, setInternalShowGitignored] = useState(false)
    const [selectedPath, setSelectedPath] = useState<string | null>(
        () => initialPath ?? persistedSelection ?? null,
    )
    const [expanded, setExpanded] = useState<Set<string>>(() => {
        const init = initialPath ?? persistedSelection ?? null
        return new Set(init ? ancestorPaths(init) : [])
    })

    const copyPath = useCopyDrivePath()
    const download = useDriveItemDownload(drive)
    const copyText = useCopyText()
    const projectId = useAtomValue(projectIdAtom)
    const {message} = App.useApp()
    // Chrome mode renders the single header + toolbar (the drawer hosts always pass onClose).
    const chrome = onClose != null
    // Details toggle, lifted so the ONE header owns it (file meta OR repo facts, per selection).
    const [detailsOpen, setDetailsOpen] = useState(false)
    // The one presentation is the tree navigator + content pane; the file TREE pane can be hidden to
    // give the content pane the full width. Searching always forces the tree (its filtered rows ARE
    // the results), so the effective visibility is `showTree || searchActive` (see `treeVisible`).
    const [showTree, setShowTree] = useState(true)
    // Tree-pane width (px), persisted across drags so re-showing restores the last width; the pane
    // collapses to 0 when hidden. `treeAnimating` gates the collapse/expand transition (see toggleTree).
    const [treeSize, setTreeSize] = useState(260)
    const [treeAnimating, setTreeAnimating] = useState(false)
    const treeAnimTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    // Toggle the tree pane. Turn the transition class ON in the SAME commit as the size flip (a late
    // paint would snap), then clear it after the flip so per-frame DRAG stays 1:1 (no transition lag).
    const toggleTree = useCallback(() => {
        setTreeAnimating(true)
        setShowTree((v) => !v)
        if (treeAnimTimer.current) clearTimeout(treeAnimTimer.current)
        treeAnimTimer.current = setTimeout(() => setTreeAnimating(false), 260)
    }, [])
    useEffect(
        () => () => {
            if (treeAnimTimer.current) clearTimeout(treeAnimTimer.current)
        },
        [],
    )

    // "Download all" — ONE streaming zip spanning every mount the drive folds in (cwd at the root,
    // the agent's durable folder under `agent-files/`). The toast rides App.useApp (dark-mode safe).
    const [downloadingAll, setDownloadingAll] = useState(false)
    const archiveMounts = useMemo(() => {
        const cwd = drive.mount
        if (!cwd?.id) return []
        const out = [{mountId: cwd.id, prefix: ""}]
        const agent = drive.resolveMount(AGENT_FILES_DIR)
        if (agent && agent.mount.id !== cwd.id) {
            out.push({mountId: agent.mount.id, prefix: AGENT_FILES_DIR})
        }
        return out
    }, [drive])
    const handleDownloadAll = useCallback(async () => {
        if (!archiveMounts.length || downloadingAll) return
        setDownloadingAll(true)
        const key = "drive-download-all"
        message.open({type: "loading", key, content: "Preparing download…", duration: 0})
        const result = await downloadMountArchive({
            mounts: archiveMounts,
            projectId,
            filename: `${driveRootLabel(drive.mount)}-files.zip`,
        })
        if (result.cancelled) message.destroy(key)
        else if (result.ok) message.open({type: "success", key, content: "Download ready"})
        else message.open({type: "error", key, content: result.error ?? "Download failed"})
        setDownloadingAll(false)
    }, [archiveMounts, drive.mount, projectId, downloadingAll, message])

    // Select a file: update local state AND persist it per drive so reopening restores it.
    const select = useCallback(
        (nextPath: string | null) => {
            setSelectedPath(nextPath)
            setPersistedSelection(nextPath)
        },
        [setPersistedSelection],
    )

    // React to a CHANGED initialPath while already open — the chat host opens the drawer once and
    // then routes a chat link / tile by pushing a new initialPath (its quick-look), so the drawer
    // must re-select it in place. Fires only when the prop value changes, not on every render, so it
    // never fights the user's own tree navigation.
    useEffect(() => {
        if (initialPath != null) select(initialPath)
    }, [initialPath])

    // Nothing was pre-selected — the drawer was opened via the Files COUNT ("browse"), not a file
    // row. Land on the ROOT folder view, not a file preview. `selectedPath != null` (not truthy) so the
    // empty-string root selection doesn't re-trigger.
    useEffect(() => {
        if (selectedPath != null) return
        select("")
    }, [selectedPath, select])

    // Defer the search term so typing stays responsive — the input updates now, the filter/flatten
    // trails a frame (React interrupts it if you keep typing).
    const deferredSearch = useDeferredValue(search)
    const searchActive = deferredSearch.trim() !== ""
    // The tree pane shows whenever the user hasn't hidden it OR a search is active (the filtered tree
    // rows ARE the search results, so search always needs it).
    const treeVisible = showTree || searchActive
    // Directories to keep loaded: the root, every expanded folder, and the open folder. A selection
    // that LOOKS like a file (has an extension) is skipped — its preview reads by path, no dir needed.
    const activePaths = useMemo(() => {
        const set = new Set<string>([""])
        for (const p of expanded) set.add(p)
        if (selectedPath && !/\.[a-z0-9]{1,8}$/i.test(selectedPath.split("/").pop() ?? "")) {
            set.add(selectedPath)
        }
        return [...set]
    }, [expanded, selectedPath])
    // LAZY: load one directory level at a time (root instant, each folder on demand) instead of the
    // whole-tree fetch that blocked the drawer open on huge mounts (#5367). Falls back to the full
    // folded tree ONLY while searching. The tree builder below consumes its accumulated `files`.
    const lazyTree = useLazyDriveTree(drive, activePaths, searchActive, showGitignored)
    // "In git scope" = a `.gitignore` sits in this folder or any ancestor (a `.gitignore` is itself
    // never gitignored, so it always shows in the listing). Only then does the "show git-ignored"
    // toggle make sense — there's something being hidden. Uses raw lazy files (pre hidden/origin
    // filter) so it holds even with hidden files off.
    const inGitScope = useMemo(() => {
        const ancestors = new Set<string>([""])
        if (selectedPath) {
            const segs = selectedPath.split("/")
            for (let i = 1; i <= segs.length; i++) ancestors.add(segs.slice(0, i).join("/"))
        }
        return lazyTree.files.some((f) => {
            const slash = f.path.lastIndexOf("/")
            const dir = slash === -1 ? "" : f.path.slice(0, slash)
            const name = slash === -1 ? f.path : f.path.slice(slash + 1)
            return name === ".gitignore" && ancestors.has(dir)
        })
    }, [lazyTree.files, selectedPath])
    const originFiltered = useMemo(() => {
        let files = lazyTree.files
        if (originFilter !== "all") files = files.filter((f) => fileOrigin(f.path) === originFilter)
        if (!showHidden) files = files.filter((f) => !isHiddenPath(f.path))
        return files
    }, [lazyTree.files, originFilter, showHidden])
    const tree = useMemo(() => buildDriveTree(originFiltered), [originFiltered])
    const shownTree = useMemo(() => filterDriveTree(tree, deferredSearch), [tree, deferredSearch])
    // While searching, show every surviving branch expanded so matches are visible.
    const shownExpanded = useMemo(
        () => (deferredSearch.trim() ? new Set(collectFolderPaths(shownTree)) : expanded),
        [deferredSearch, shownTree, expanded],
    )
    // A folder is "loading" once expanded but its level hasn't resolved yet (or is refetching) — the
    // cue for flattenTree's shimmer rows and the row spinner. Not while searching (the whole tree is
    // fetched in one shot then, so per-folder placeholders would be wrong).
    const isDirLoading = useCallback(
        (path: string) =>
            !searchActive && (lazyTree.fetchingDirs.has(path) || !lazyTree.loadedDirs.has(path)),
        [searchActive, lazyTree.fetchingDirs, lazyTree.loadedDirs],
    )
    // The visible rows, flattened for virtualization (see flattenTree), plus a path→row-index map for
    // O(1) keyboard navigation.
    const flatRows = useMemo(
        () => flattenTree(shownTree, shownExpanded, isDirLoading),
        [shownTree, shownExpanded, isDirLoading],
    )
    const indexByPath = useMemo(() => {
        const map = new Map<string, number>()
        // Skip synthetic loading rows — they carry sentinel paths and are never a nav/selection target.
        flatRows.forEach((r, i) => {
            if (!r.loading) map.set(r.node.path, i)
        })
        return map
    }, [flatRows])
    // Dirs whose level resolved on THIS render (vs the previous COMMITTED one) — so the freshly-appearing
    // child rows carry their entrance `initial` on the exact render they mount, then it's empty again.
    // That one-shot gate is what staggers the reveal in gracefully WITHOUT re-firing every time the
    // virtualizer remounts a row on scroll. The ref is advanced in an effect (NOT during render) so the
    // diff survives StrictMode's double-render, where a write-during-render would cancel itself out.
    const prevLoadedRef = useRef<ReadonlySet<string>>(EMPTY_STR_SET)
    let justLoadedDirs: ReadonlySet<string> = EMPTY_STR_SET
    if (lazyTree.loadedDirs !== prevLoadedRef.current) {
        const prev = prevLoadedRef.current
        const fresh = new Set<string>()
        lazyTree.loadedDirs.forEach((d) => {
            if (!prev.has(d)) fresh.add(d)
        })
        if (fresh.size) justLoadedDirs = fresh
    }
    useEffect(() => {
        prevLoadedRef.current = lazyTree.loadedDirs
    }, [lazyTree.loadedDirs])
    // Flat lookup of every tree node by path, so a selected FOLDER can render its children (folder
    // view) and a selected FILE the preview. Root ("") maps to the top-level nodes.
    const nodeByPath = useMemo(() => {
        const map = new Map<string, DriveTreeNode>()
        const walk = (nodes: DriveTreeNode[]) => {
            for (const n of nodes) {
                map.set(n.path, n)
                if (n.children.length) walk(n.children)
            }
        }
        walk(tree)
        return map
    }, [tree])
    const selectedNode = selectedPath != null ? nodeByPath.get(selectedPath) : undefined
    // The root and any node flagged a folder render the grid; everything else the preview. In lazy
    // mode a not-yet-loaded selection is treated as a FILE (the preview reads by path), so an initial
    // file target shows its preview immediately instead of a wrong "empty folder" flash.
    const selectedIsFolder = selectedPath === "" || selectedNode?.isFolder === true
    const selected = drive.recents.find((f) => f.path === selectedPath) ?? null
    const showOrigin = driveHasMixedOrigins(drive.recents)

    // Repo probe for the header's details toggle (chrome mode) — is the SELECTED folder a git repo?
    // Gated on chrome + folder so it never fires for the embedded explorer or a file selection. The
    // FolderView probes the same (mount, path) for its meta panel; react-query shares the cache.
    const headerResolved = chrome ? drive.resolveMount(selectedPath ?? "") : null
    const headerRepo = useRepoInfo(
        headerResolved?.mount ?? null,
        headerResolved?.path ?? "",
        chrome && selectedIsFolder,
    )
    // A file's size for the header chip (recents first, else the tree node).
    const selectedFileSize = selected?.size ?? selectedNode?.size ?? undefined
    // A non-root folder's immediate-child count (loaded children, else the backend count).
    const selectedItemCount =
        selectedIsFolder && selectedPath
            ? (selectedNode?.itemCount ?? selectedNode?.children.length ?? null)
            : null

    // The tree scroll container is the virtualizer's scroll element — only the visible rows (+
    // overscan) mount, so expanding a folder with thousands of children never floods the DOM.
    const treeRef = useRef<HTMLDivElement>(null)
    const treeVirtualizer = useVirtualizer({
        count: flatRows.length,
        getScrollElement: () => treeRef.current,
        estimateSize: () => 28,
        overscan: 12,
        getItemKey: (i) => flatRows[i]?.node.path ?? i,
    })

    // Row-height measurement for the virtualizer.
    const measureRow = treeVirtualizer.measureElement

    // PER-FOLDER-GROUP horizontal scroll: a folder's children share ONE offset, so reading a long name
    // scrolls all siblings together — never individual rows (that left odd gaps) nor the whole tree.
    // `groupScroll` = parent path → scrollLeft (transform on each row's content); `groupWidth` = parent
    // → widest child content, to clamp. A version bump re-renders the (few) visible rows on scroll.
    const groupScrollRef = useRef(new Map<string, number>())
    const groupWidthRef = useRef(new Map<string, number>())
    const [, bumpGroupScroll] = useReducer((n: number) => n + 1, 0)
    const onMeasureContent = useCallback((parent: string, width: number) => {
        if (width > (groupWidthRef.current.get(parent) ?? 0))
            groupWidthRef.current.set(parent, width)
    }, [])
    // A wholesale listing change (search / gitignore) invalidates the measured widths + offsets.
    useEffect(() => {
        groupWidthRef.current.clear()
        groupScrollRef.current.clear()
        bumpGroupScroll()
    }, [deferredSearch, showGitignored])

    // Own the wheel to route horizontal deltas to the hovered row's group (transform) while vertical
    // stays native. Axis-locked per gesture (biased vertical) so a mostly-vertical swipe never nudges a
    // group sideways. Callback ref (the scroll div mounts after the skeleton) + non-passive listener.
    const detachTreeWheel = useRef<(() => void) | null>(null)
    const treeScrollRef = useCallback((el: HTMLDivElement | null) => {
        treeRef.current = el
        detachTreeWheel.current?.()
        detachTreeWheel.current = null
        if (!el) return
        let axis: "x" | "y" | null = null
        let idle: ReturnType<typeof setTimeout> | undefined
        const onWheel = (e: WheelEvent) => {
            if (e.ctrlKey) return // pinch-zoom
            if (axis === null) axis = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.2 ? "x" : "y"
            if (idle) clearTimeout(idle)
            idle = setTimeout(() => {
                axis = null
            }, 120)
            if (axis !== "x") return // vertical → native list scroll
            e.preventDefault()
            const rowEl = (e.target as HTMLElement | null)?.closest?.("[data-parent]")
            const parent = rowEl?.getAttribute("data-parent") ?? ""
            const unit = e.deltaMode === 1 ? 16 : 1
            const maxScroll = Math.max(
                0,
                (groupWidthRef.current.get(parent) ?? 0) - el.clientWidth + 8,
            )
            const cur = groupScrollRef.current.get(parent) ?? 0
            const next = Math.min(maxScroll, Math.max(0, cur + e.deltaX * unit))
            if (next !== cur) {
                groupScrollRef.current.set(parent, next)
                bumpGroupScroll()
            }
        }
        el.addEventListener("wheel", onWheel, {passive: false})
        detachTreeWheel.current = () => {
            el.removeEventListener("wheel", onWheel)
            if (idle) clearTimeout(idle)
        }
    }, [])

    // Navigating via the GRID tiles / breadcrumb (not the tree) updates `selectedPath` but not the
    // tree's expanded set — so the tree stayed collapsed and didn't follow. Mirror the selection into
    // the tree: expand its ancestors (and the folder itself, matching a tree-row click) so the row is
    // revealed. Idempotent + only adds, so a manual collapse elsewhere isn't fought.
    useEffect(() => {
        if (!selectedPath) return
        setExpanded((prev) => {
            const next = new Set(prev)
            let changed = false
            for (const a of ancestorPaths(selectedPath)) {
                if (!next.has(a)) {
                    next.add(a)
                    changed = true
                }
            }
            if (selectedIsFolder && !next.has(selectedPath)) {
                next.add(selectedPath)
                changed = true
            }
            return changed ? next : prev
        })
    }, [selectedPath, selectedIsFolder])

    // …then scroll the revealed row into view. Read the LIVE index via a ref (not deps) so this fires
    // only on a selection change, not on every unrelated expand; retry across a few frames because the
    // row appears only after the expand above re-flattens the tree.
    const indexByPathRef = useRef(indexByPath)
    indexByPathRef.current = indexByPath
    useEffect(() => {
        if (!selectedPath) return
        let raf = 0
        let tries = 0
        const scroll = () => {
            const idx = indexByPathRef.current.get(selectedPath)
            if (idx != null) treeVirtualizer.scrollToIndex(idx, {align: "auto"})
            else if (tries++ < 5) raf = requestAnimationFrame(scroll)
        }
        raf = requestAnimationFrame(scroll)
        return () => cancelAnimationFrame(raf)
    }, [selectedPath, treeVirtualizer])

    // Focus a row by its flat index, scrolling it into view first (it may not be rendered yet when
    // virtualized). Retries across a few frames until the row exists in the DOM.
    const focusTreeRow = useCallback(
        (index: number, dir: 1 | -1 = 1) => {
            if (!flatRows.length) return
            let target = Math.min(Math.max(index, 0), flatRows.length - 1)
            // Skip synthetic loading rows (no focusable control) in the travel direction.
            while (target >= 0 && target < flatRows.length && flatRows[target]?.loading)
                target += dir
            if (target < 0 || target >= flatRows.length) return
            treeVirtualizer.scrollToIndex(target, {align: "auto"})
            let tries = 0
            const tryFocus = () => {
                const el = treeRef.current?.querySelector<HTMLButtonElement>(
                    `[data-index="${target}"] button[data-tree-main]`,
                )
                if (el) el.focus()
                else if (tries++ < 3) requestAnimationFrame(tryFocus)
            }
            requestAnimationFrame(tryFocus)
        },
        [flatRows, treeVirtualizer],
    )

    // Tree keyboard nav (WAI-ARIA tree pattern) over the FLAT index: ↑/↓ move focus one visible row;
    // → expands a collapsed folder then steps into it; ← collapses an open folder else steps to the
    // parent; Home/End jump to the ends. Enter/Space stay the button's own onClick (select).
    const onTreeKeyDown = useCallback(
        (e: KeyboardEvent<HTMLDivElement>) => {
            const keys = ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"]
            if (!keys.includes(e.key)) return
            if (!flatRows.length) return
            e.preventDefault()
            const activePath = (document.activeElement as HTMLElement | null)?.getAttribute(
                "data-path",
            )
            const idx = activePath != null ? (indexByPath.get(activePath) ?? -1) : -1

            if (e.key === "Home") return focusTreeRow(0, 1)
            if (e.key === "End") return focusTreeRow(flatRows.length - 1, -1)
            if (e.key === "ArrowDown") return focusTreeRow(idx < 0 ? 0 : idx + 1, 1)
            if (e.key === "ArrowUp") return focusTreeRow(idx < 0 ? 0 : idx - 1, -1)

            if (activePath == null) return focusTreeRow(idx < 0 ? 0 : idx)
            const node = nodeByPath.get(activePath)
            const isFolder = node?.isFolder === true
            const isOpen = expanded.has(activePath)

            if (e.key === "ArrowRight") {
                if (isFolder && !isOpen) setExpanded((prev) => new Set(prev).add(activePath))
                else if (isFolder && isOpen) focusTreeRow(idx + 1)
                return
            }
            // ArrowLeft: collapse an open folder, else move focus to the parent row.
            if (isFolder && isOpen) {
                setExpanded((prev) => {
                    const next = new Set(prev)
                    next.delete(activePath)
                    return next
                })
                return
            }
            const parent = activePath.includes("/")
                ? activePath.split("/").slice(0, -1).join("/")
                : null
            if (parent != null) {
                const pIdx = indexByPath.get(parent)
                if (pIdx != null) focusTreeRow(pIdx)
            }
        },
        [flatRows.length, indexByPath, nodeByPath, expanded, focusTreeRow],
    )

    // Initial focus: a <div>'s onKeyDown only fires when something inside is focused, so arrow keys
    // do nothing until a row is clicked. Once the listing is ready, focus the selected (else first)
    // row so keyboard nav works immediately on open. Runs once; won't steal focus from a field the
    // user is typing in (e.g. search) or if focus is already in the tree.
    const didInitialFocus = useRef(false)
    useEffect(() => {
        if (didInitialFocus.current || lazyTree.rootLoading || !flatRows.length) return
        const container = treeRef.current
        const active = document.activeElement as HTMLElement | null
        if (
            active &&
            (/^(input|textarea|select)$/i.test(active.tagName) ||
                Boolean(container?.contains(active)))
        ) {
            didInitialFocus.current = true
            return
        }
        const idx = selectedPath != null ? (indexByPath.get(selectedPath) ?? 0) : 0
        focusTreeRow(idx)
        didInitialFocus.current = true
    }, [lazyTree.rootLoading, selectedPath, flatRows.length, indexByPath, focusTreeRow])

    // Only a TOTAL failure blanks the drawer. A partial failure — e.g. the artifact-scoped agent
    // mount erroring while the session's own files loaded — still has a tree to browse, so fall
    // through and render it rather than hiding the loaded files behind the banner.
    let body: ReactNode
    if (drive.errored && drive.fileCount === 0) {
        body = (
            <div className="w-full p-4">
                <Alert
                    type="warning"
                    showIcon
                    message="Couldn't load this drive"
                    description={
                        <span className="text-xs">
                            The file store may not be configured on this deployment.
                        </span>
                    }
                />
            </div>
        )
    } else if (drive.isLoading || (drive.mount && lazyTree.rootLoading)) {
        // The right pane will be a FILE preview if we're opening onto a file, else the browse GRID.
        // A real extension marks a file; a dot-DIR (`.claude`) or extensionless path is a folder.
        const target = initialPath ?? persistedSelection
        const leaf = target ? (target.split("/").pop() ?? "") : ""
        const isFilePreview = /\.[a-z0-9]{1,8}$/i.test(leaf) && !leaf.startsWith(".")
        body = (
            <DriveExplorerSkeleton
                mode={isFilePreview ? "preview" : "grid"}
                showTree={treeVisible}
            />
        )
    } else if (drive.fileCount === 0) {
        body = (
            <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
                <Tray size={28} className="text-colorTextQuaternary" />
                <div className="text-xs font-medium">This drive is empty</div>
                <div className="text-[11px] text-colorTextTertiary">
                    {scope === "session"
                        ? "Created on the conversation's first run."
                        : "Files the agent keeps across conversations land here."}
                </div>
            </div>
        )
    } else {
        // What shows for the current selection: the folder's children (as a tile grid) or a file's
        // preview. The right pane of the tree navigator (and the whole body when the tree is hidden).
        const contentPane =
            selectedPath == null ? (
                <div className="flex h-full flex-1 items-center justify-center text-xs text-colorTextTertiary">
                    Select a file to preview it.
                </div>
            ) : selectedIsFolder ? (
                <FolderView
                    folderPath={selectedPath}
                    nodes={selectedPath === "" ? tree : (selectedNode?.children ?? [])}
                    rootLabel={rootLabel}
                    drive={drive}
                    showOrigin={showOrigin}
                    loading={
                        selectedPath !== "" &&
                        !searchActive &&
                        !lazyTree.loadedDirs.has(selectedPath)
                    }
                    // Chrome mode: the single header owns the breadcrumb/name/repo toggle, so the pane
                    // drops its header and just shows the meta (when open) + grid.
                    hideHeader={chrome}
                    detailsOpen={detailsOpen}
                    // With the tree hidden, the folder grid is the only nav surface → focus its first
                    // tile on open. With the tree shown, the tree owns focus, so don't.
                    autoFocus={!treeVisible}
                    onSelect={select}
                />
            ) : (
                <DriveFilePreview
                    // Preview reads from the file's own mount (cwd or the nested agent-files mount),
                    // but the breadcrumb/name show the presented path (agent-files/ prefix).
                    mount={drive.resolveMount(selectedPath)?.mount ?? drive.mount}
                    path={drive.resolveMount(selectedPath)?.path ?? selectedPath}
                    displayPath={selectedPath}
                    showOrigin={showOrigin}
                    rootLabel={rootLabel}
                    touchedAt={selected?.touchedAt}
                    size={selected?.size ?? undefined}
                    hideHeader={chrome}
                    detailsOpen={detailsOpen}
                    onSelect={select}
                />
            )
        // The one presentation: the file TREE pane (unless hidden) + the content pane. The tree pane is
        // draggable (widen it to read truncated long names) and COLLAPSES to width 0 when hidden — the
        // Splitter stays mounted (both panes) so the toggle animates, via a controlled `size` + the
        // `ag-drive-tree-splitter--animating` transition class (gated to the flip so drag stays 1:1).
        body = (
            <Splitter
                className={`ag-drive-tree-splitter min-h-0 w-full flex-1${treeAnimating ? " ag-drive-tree-splitter--animating" : ""}`}
                onResize={(sizes) => {
                    const s = sizes[0]
                    if (treeVisible && typeof s === "number") setTreeSize(s)
                }}
            >
                <Splitter.Panel
                    size={treeVisible ? treeSize : 0}
                    min={treeVisible ? 180 : 0}
                    max="65%"
                    resizable={treeVisible}
                >
                    {/* No own search box when controlled → drop the top padding so the tree isn't pushed
                    down by empty space (the embedding toolbar already spaces it). `box-border`: preflight
                    is off, so without it `h-full` + padding overflows the (overflow:auto) Splitter panel,
                    giving a SECOND scrollbar nested inside the tree's own — QA's "nested scrollbars".
                    `overflow-hidden` clips the tree cleanly as the pane collapses to 0. */}
                    <div className="box-border flex h-full min-h-0 flex-col overflow-hidden px-3 pb-3 pt-2">
                        <div
                            ref={treeScrollRef}
                            // Vertical scroll is native; horizontal is intercepted (treeScrollRef)
                            // and routed to the hovered row's FOLDER GROUP (transform), so siblings
                            // scroll together. `overscroll-contain` stops rubber-band chaining.
                            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
                            onKeyDown={onTreeKeyDown}
                        >
                            {flatRows.length === 0 ? (
                                <Text type="secondary" className="px-1 !text-[11px]">
                                    {lazyTree.searchLoading
                                        ? "Searching all files…"
                                        : "No files match."}
                                </Text>
                            ) : (
                                // Only the visible rows mount. Full pane width; each row handles its
                                // own horizontal overflow, so there's no tree-wide horizontal axis.
                                <div
                                    style={{
                                        height: treeVirtualizer.getTotalSize(),
                                        position: "relative",
                                        width: "100%",
                                    }}
                                >
                                    {treeVirtualizer.getVirtualItems().map((vRow) => {
                                        const row = flatRows[vRow.index]
                                        const {node, depth} = row
                                        const parent = parentOf(node.path)
                                        // One-shot entrance: only the rows of a level that resolved
                                        // THIS render animate in (staggered by sibling order), so the
                                        // skeleton→content swap settles gracefully. Empty on every
                                        // other render → the virtualizer's scroll remounts don't replay.
                                        const reveal = !row.loading && justLoadedDirs.has(parent)
                                        return (
                                            <div
                                                key={vRow.key}
                                                data-index={vRow.index}
                                                ref={measureRow}
                                                style={{
                                                    position: "absolute",
                                                    top: 0,
                                                    left: 0,
                                                    width: "100%",
                                                    transform: `translateY(${vRow.start}px)`,
                                                }}
                                            >
                                                <motion.div {...revealFade(reveal)}>
                                                    {row.loading ? (
                                                        <TreeLoadingRow
                                                            depth={depth}
                                                            width={row.loadingWidth}
                                                        />
                                                    ) : (
                                                        <DriveItemContextMenu
                                                            path={node.path}
                                                            isFolder={node.isFolder}
                                                            onOpen={() => select(node.path)}
                                                            onCopyPath={copyPath}
                                                            onDownload={download}
                                                            className="w-full"
                                                        >
                                                            <TreeRow
                                                                node={node}
                                                                depth={depth}
                                                                isOpen={shownExpanded.has(
                                                                    node.path,
                                                                )}
                                                                selected={
                                                                    node.path === selectedPath
                                                                }
                                                                loading={
                                                                    node.isFolder &&
                                                                    shownExpanded.has(node.path) &&
                                                                    node.children.length === 0 &&
                                                                    isDirLoading(node.path)
                                                                }
                                                                showOrigin={showOrigin}
                                                                parent={parent}
                                                                scrollX={
                                                                    groupScrollRef.current.get(
                                                                        parent,
                                                                    ) ?? 0
                                                                }
                                                                onMeasureContent={onMeasureContent}
                                                                onToggle={(path) =>
                                                                    setExpanded((prev) => {
                                                                        const next = new Set(prev)
                                                                        if (next.has(path))
                                                                            next.delete(path)
                                                                        else next.add(path)
                                                                        return next
                                                                    })
                                                                }
                                                                onSelect={select}
                                                            />
                                                        </DriveItemContextMenu>
                                                    )}
                                                </motion.div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </Splitter.Panel>
                <Splitter.Panel>{contentPane}</Splitter.Panel>
            </Splitter>
        )
    }
    // The lazy per-directory subscribers render alongside EVERY branch (skeleton/empty/tree) so the
    // root query fires even while the skeleton shows — otherwise the drawer would never leave loading.
    return (
        <>
            {lazyTree.subscribers}
            {onClose ? (
                <div className="flex h-full min-h-0 w-full flex-col">
                    <DriveHeader
                        selectedPath={selectedPath}
                        isFolder={selectedIsFolder}
                        rootLabel={rootLabel}
                        itemCount={selectedItemCount}
                        totalCount={drive.fileCount}
                        totalCapped={drive.fileCountCapped}
                        fileSize={selectedFileSize}
                        showOrigin={showOrigin}
                        isRepo={headerRepo.isRepo}
                        detailsOpen={detailsOpen}
                        onToggleDetails={() => setDetailsOpen((v) => !v)}
                        onNavigate={select}
                        onClose={onClose}
                        copyText={copyText}
                        ids={driveIds ?? []}
                        downloadMount={
                            selectedPath ? (drive.resolveMount(selectedPath)?.mount ?? null) : null
                        }
                        downloadPath={
                            selectedPath
                                ? (drive.resolveMount(selectedPath)?.path ?? selectedPath)
                                : ""
                        }
                        projectId={projectId}
                        onDownloadAll={archiveMounts.length ? handleDownloadAll : undefined}
                        downloadingAll={downloadingAll}
                        expanded={drawerExpanded}
                        onToggleExpand={onToggleExpand}
                    />
                    {/* Shared toolbar — the show/hide tree toggle sits FIRST (left), directly above the
                        tree pane it controls; then search + filters. Search forces the tree of matches
                        (see body), so the toggle is disabled while searching. */}
                    <div className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-colorBorderSecondary px-3 py-2">
                        <Tooltip
                            title={
                                searchActive
                                    ? "Tree shown while searching"
                                    : showTree
                                      ? "Hide file tree"
                                      : "Show file tree"
                            }
                        >
                            <Button
                                type="text"
                                aria-label={showTree ? "Hide file tree" : "Show file tree"}
                                aria-pressed={treeVisible}
                                disabled={searchActive}
                                icon={
                                    <SidebarSimple
                                        size={16}
                                        weight={treeVisible ? "fill" : "regular"}
                                        className="block"
                                    />
                                }
                                onClick={toggleTree}
                                className={
                                    treeVisible ? "!text-colorPrimary" : "!text-colorTextTertiary"
                                }
                            />
                        </Tooltip>
                        <Input
                            allowClear
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search files"
                            className="w-[220px] max-w-[45%]"
                            prefix={
                                <MagnifyingGlass size={12} className="text-colorTextQuaternary" />
                            }
                        />
                        {showOrigin ? (
                            <Segmented
                                value={originFilter}
                                onChange={(v) => setInternalOrigin(v as "all" | FileOrigin)}
                                options={[
                                    {value: "all", label: "All"},
                                    {
                                        value: "agent",
                                        label: (
                                            <Tooltip title={ORIGIN_TIP.agent}>
                                                <span>Agent</span>
                                            </Tooltip>
                                        ),
                                    },
                                    {
                                        value: "session",
                                        label: (
                                            <Tooltip title={ORIGIN_TIP.session}>
                                                <span>Session</span>
                                            </Tooltip>
                                        ),
                                    },
                                ]}
                            />
                        ) : null}
                        <Tooltip title={showHidden ? "Hide hidden files" : "Show hidden files"}>
                            <Button
                                type="text"
                                aria-label={showHidden ? "Hide hidden files" : "Show hidden files"}
                                aria-pressed={!showHidden}
                                icon={
                                    showHidden ? (
                                        <Eye size={16} className="block" />
                                    ) : (
                                        <EyeClosed size={16} className="block" />
                                    )
                                }
                                onClick={() => setInternalShowHidden((v) => !v)}
                                className={
                                    showHidden ? "!text-colorTextTertiary" : "!text-colorPrimary"
                                }
                            />
                        </Tooltip>
                        {/* Git-ignored files hidden by default; the toggle appears only inside a repo. */}
                        {inGitScope ? (
                            <Tooltip
                                title={
                                    showGitignored
                                        ? "Hide git-ignored files"
                                        : "Show git-ignored files"
                                }
                            >
                                <Button
                                    type="text"
                                    aria-label={
                                        showGitignored
                                            ? "Hide git-ignored files"
                                            : "Show git-ignored files"
                                    }
                                    aria-pressed={showGitignored}
                                    icon={<FileDashed size={16} className="block" />}
                                    onClick={() => setInternalShowGitignored((v) => !v)}
                                    className={
                                        showGitignored
                                            ? "!text-colorPrimary"
                                            : "!text-colorTextTertiary"
                                    }
                                />
                            </Tooltip>
                        ) : null}
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col">{body}</div>
                </div>
            ) : (
                body
            )}
        </>
    )
}

const collectFolderPaths = (nodes: DriveTreeNode[]): string[] =>
    nodes.flatMap((n) => (n.isFolder ? [n.path, ...collectFolderPaths(n.children)] : []))
